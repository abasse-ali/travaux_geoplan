/* ============================================================
   La source API : le serveur de W3 (ADR-002, ADR-003)

   Même origine que l'application : le cookie de session part de lui-
   même, et aucune clé ne vit dans le paquet. Chaque geste est une
   requête de la route qui lui correspond, avec son Idempotency-Key :
   rejouée après une coupure, elle n'est jamais appliquée deux fois.

   Les fiches portent une version (verrou optimiste). Un 409 rend la
   fiche actuelle : le geste y est rejoué, sous la même clé. Cocher la
   mission 2 de l'étape 5 reste « cocher la mission 2 de l'étape 5 ».

   Ce module n'est chargé que si la source est `api` ; le client
   Socket.IO, lui, n'est chargé qu'une fois l'application ouverte.
   ============================================================ */

import {
  normAvail, normPerson, normSite, setTeamOn, teamOn, type Avail, type Person, type Site
} from "@geoplan/domain";
import { appliquer } from "@geoplan/domain/operations";
import {
  Injoignable, NonConnecte, RefusDefinitif,
  type Compte, type Depot, type Donnees, type Instantane, type LienDispo, type Operation
} from "./types";

type Fiche<T> = T & { version: number };
interface Equipes { chantiers: Record<string, { plan: Record<string, string[]> }> }

/* Le dernier compte connu, pour ouvrir l'application hors ligne sur son
   cache plutôt que sur l'écran de connexion (constat S10). */
const CLE_COMPTE = "geoplan.compte.v4:api";
const retenir = (c: Compte | null): void => {
  try { if (c) localStorage.setItem(CLE_COMPTE, JSON.stringify(c)); else localStorage.removeItem(CLE_COMPTE); }
  catch { /* stockage refusé : on redemandera la connexion hors ligne */ }
};
const dernierCompte = (): Compte | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CLE_COMPTE) || "null") as Compte | null;
    return c && typeof c.id === "string" && typeof c.email === "string" ? c : null;
  } catch { return null; }
};
const compteDe = (email: string): Compte => ({ id: email.trim().toLowerCase(), email: email.trim().toLowerCase() });

/* ---------- les requêtes ---------- */

interface Reponse { statut: number; corps: unknown }

async function appel(methode: string, chemin: string, corps?: unknown, cle?: string): Promise<Reponse> {
  const entetes: Record<string, string> = {};
  if (corps !== undefined) entetes["content-type"] = "application/json";
  if (cle) entetes["idempotency-key"] = cle;
  let r: Response;
  try {
    r = await fetch(chemin, {
      method: methode, credentials: "same-origin", cache: "no-store", headers: entetes,
      body: corps === undefined ? undefined : JSON.stringify(corps)
    });
  } catch { throw new Injoignable("Serveur injoignable"); }
  const texte = await r.text().catch(() => "");
  let lu: unknown = null;
  try { lu = texte ? JSON.parse(texte) : null; } catch { /* corps non JSON : ignoré */ }
  return { statut: r.status, corps: lu };
}

const messageDe = (r: Reponse): string =>
  (r.corps as { message?: string } | null)?.message || "Refusé par le serveur (" + r.statut + ")";

interface CorpsErreur { erreur?: string; regle?: string; actuel?: unknown }
const corpsErreur = (r: Reponse): CorpsErreur => (r.corps as CorpsErreur | null) ?? {};

/** Une réponse qui n'est pas un succès, rangée selon ce qu'il faut en faire. */
function echec(r: Reponse): Error {
  if (r.statut === 401) return new NonConnecte(messageDe(r));
  /* 403 : l'origine refusée, une configuration à corriger côté serveur.
     Jeter chaque geste ne corrigerait rien : ils attendent. */
  if (r.statut === 403) return new Injoignable(messageDe(r));
  if (r.statut === 409) {
    /* « en-cours » : ce geste est déjà en train de passer (une autre
       tentative) ; « un-homme-un-jour » : deux appareils au même
       instant, le serveur a tranché ; une version qui bouge encore après
       trois rejeux. Réessayer aboutira. Tout autre 409 est un refus :
       le ranger dans « réessayer » bloquait la file pour toujours. */
    const c = corpsErreur(r);
    if (c.erreur === "en-cours" || c.regle === "un-homme-un-jour" || c.actuel) return new Injoignable(messageDe(r));
    return new RefusDefinitif(messageDe(r));
  }
  if (r.statut === 429 || r.statut === 408 || r.statut >= 500) return new Injoignable(messageDe(r));
  return new RefusDefinitif(messageDe(r));
}

function succes<T>(r: Reponse): T {
  if (r.statut >= 200 && r.statut < 300) return r.corps as T;
  throw echec(r);
}

/* Une création refusée parce que l'identifiant existe déjà : c'est la
   nôtre, déjà faite (réponse perdue, et le serveur ne se souvient plus
   de la clé : Redis en panne, ou plus de sept jours). Les identifiants
   sont tirés au hasard, et seul l'identifiant est unique. */
const dejaCree = (r: Reponse): boolean => {
  const c = corpsErreur(r);
  return r.statut === 409 && c.erreur === "conflit" && !c.actuel && !c.regle;
};

/* ---------- ce qu'une réponse change à l'instantané ---------- */

const cleVersion = (genre: "site" | "person", id: string): string => genre + ":" + id;

function remplacer<T extends { id: string }>(liste: T[], x: T): T[] {
  return liste.some(y => y.id === x.id) ? liste.map(y => (y.id === x.id ? x : y)) : [...liste, x];
}

function avecChantier(i: Instantane, f: Fiche<Site>): Instantane {
  return {
    donnees: { ...i.donnees, sites: remplacer(i.donnees.sites, normSite(f.id, f)) },
    versions: { ...i.versions, [cleVersion("site", f.id)]: f.version }
  };
}

function avecCompagnon(i: Instantane, f: Fiche<Person>): Instantane {
  return {
    donnees: { ...i.donnees, people: remplacer(i.donnees.people, normPerson(f.id, f)) },
    versions: { ...i.versions, [cleVersion("person", f.id)]: f.version }
  };
}

/* Les équipes que rend une opération d'affectation : chantier par
   chantier, jour par jour, y compris les chantiers d'où quelqu'un a été
   retiré pour être posé ailleurs. */
function avecEquipes(i: Instantane, e: Equipes): Instantane {
  const sites = i.donnees.sites.map(s => {
    const c = e.chantiers[s.id];
    if (!c) return s;
    const copie: Site = { ...s, plan: { ...s.plan } };
    for (const [jour, ids] of Object.entries(c.plan))
      if (teamOn(copie, jour).join("|") !== ids.join("|")) setTeamOn(copie, jour, ids);
    return copie;
  });
  return { ...i, donnees: { ...i.donnees, sites } };
}

function instantaneDe(d: { people: Fiche<Person>[]; sites: Fiche<Site>[]; avail: Avail[] }): Instantane {
  const versions: Record<string, number> = {};
  for (const p of d.people) versions[cleVersion("person", p.id)] = p.version;
  for (const s of d.sites) versions[cleVersion("site", s.id)] = s.version;
  const donnees: Donnees = {
    people: d.people.map(p => normPerson(p.id, p)),
    sites: d.sites.map(s => normSite(s.id, s)),
    avail: d.avail.map(a => normAvail(a.id, a))
  };
  return { donnees, versions };
}

/* ---------- les gestes ---------- */

const enc = encodeURIComponent;

type Semaine = Record<string, Record<string, string[]>>;
const sansAbsents = (s: Semaine, absents: Set<string>): Semaine => Object.fromEntries(
  Object.entries(s).filter(([sid]) => !absents.has(sid)).map(([sid, jours]) => [sid,
    Object.fromEntries(Object.entries(jours).map(([j, ids]) => [j, ids.filter(id => !absents.has(id))]))]));

/** Un PATCH sous verrou optimiste : sur un 409, le geste est rejoué sur
    la fiche actuelle, sous la même clé (le serveur ne garde pas un 409). */
async function corriger<T>(chemin: string, version: number, champs: object, cle: string): Promise<Fiche<T>> {
  for (let essai = 0; ; essai++) {
    const r = await appel("PATCH", chemin, { version, ...champs }, cle);
    if (r.statut === 200) return r.corps as Fiche<T>;
    const actuel = (r.corps as { erreur?: string; actuel?: Fiche<T> } | null);
    if (r.statut === 409 && actuel?.erreur === "conflit" && actuel.actuel && essai < 3) {
      version = actuel.actuel.version;
      continue;
    }
    throw echec(r);
  }
}

/** Supprimer ce qui n'existe déjà plus n'est pas un échec. */
async function supprimer(chemin: string, cle: string): Promise<void> {
  const r = await appel("DELETE", chemin, undefined, cle);
  if (r.statut === 200 || r.statut === 404) return;
  throw echec(r);
}

async function envoyer(op: Operation, cle: string, confirme: Instantane): Promise<(i: Instantane) => Instantane> {
  const version = (genre: "site" | "person", id: string) => confirme.versions[cleVersion(genre, id)] ?? 1;
  switch (op.type) {
    case "poser": {
      const e = succes<Equipes>(await appel("POST", "/api/affectations/poser",
        { chantierId: op.site, jour: op.jour, compagnonId: op.compagnon, urgence: op.urgence }, cle));
      return i => avecEquipes(i, e);
    }
    case "retirer": {
      const e = succes<Equipes>(await appel("POST", "/api/affectations/retirer",
        { jour: op.jour, compagnonId: op.compagnon, chantierId: op.site ?? null }, cle));
      return i => avecEquipes(i, e);
    }
    case "equipe": {
      const e = succes<Equipes>(await appel("PUT", "/api/affectations/equipe",
        { chantierId: op.site, jour: op.jour, compagnonIds: op.compagnons, avant: op.avant, urgence: op.urgence }, cle));
      return i => avecEquipes(i, e);
    }
    case "plan": {
      let { plan, avant } = op;
      for (let essai = 0; ; essai++) {
        const r = await appel("POST", "/api/affectations/plan",
          { semaine: op.semaine, plan, avant, urgence: op.urgence }, cle);
        const absents = (r.corps as { ids?: unknown } | null)?.ids;
        /* Un chantier ou un compagnon du plan supprimé entre-temps, depuis
           un autre appareil : le serveur refuse tout le plan. Le reste de
           la semaine s'applique, comme le domaine le fait pour les
           sources local et supabase — plutôt que de perdre la semaine
           entière. Même clé : le serveur ne garde que les succès. */
        if (r.statut === 404 && Array.isArray(absents) && absents.length && essai < 2) {
          const sans = new Set(absents.map(String));
          plan = sansAbsents(plan, sans);
          avant = sansAbsents(avant, sans);
          continue;
        }
        const e = succes<Equipes>(r);
        return i => avecEquipes(i, e);
      }
    }
    case "cocher": {
      const f = succes<Fiche<Site>>(await appel("POST", `/api/chantiers/${enc(op.site)}/missions`,
        { etape: op.etape, mission: op.mission, faite: op.faite }, cle));
      return i => avecChantier(i, f);
    }
    case "regler": {
      const f = succes<Fiche<Site>>(await appel("POST", `/api/chantiers/${enc(op.site)}/etapes`,
        { etape: op.etape, pourcentage: op.pourcentage }, cle));
      return i => avecChantier(i, f);
    }
    case "modifierChantier": {
      const f = await corriger<Site>(`/api/chantiers/${enc(op.site)}`, version("site", op.site), op.champs, cle);
      return i => avecChantier(i, f);
    }
    case "creerChantier": {
      const s = op.chantier;
      const r = await appel("POST", "/api/chantiers", {
        id: s.id, code: s.code, addr: s.addr, start: s.start, months: s.months, coef: s.coef,
        note: s.note, ph: s.ph, tasks: s.tasks
      }, cle);
      if (dejaCree(r)) return i => ({ ...i, donnees: appliquer(i.donnees, op) });
      const f = succes<Fiche<Site>>(r);
      return i => avecChantier(i, f);
    }
    case "supprimerChantier": {
      await supprimer(`/api/chantiers/${enc(op.site)}`, cle);
      return i => ({ ...i, donnees: appliquer(i.donnees, op) });
    }
    case "creerCompagnon": {
      const { id, ...champs } = op.compagnon;
      const r = await appel("POST", "/api/compagnons", { id, ...champs }, cle);
      if (dejaCree(r)) return i => ({ ...i, donnees: appliquer(i.donnees, op) });
      const f = succes<Fiche<Person>>(r);
      return i => avecCompagnon(i, f);
    }
    case "modifierCompagnon": {
      const f = await corriger<Person>(`/api/compagnons/${enc(op.compagnon)}`, version("person", op.compagnon), op.champs, cle);
      return i => avecCompagnon(i, f);
    }
    case "supprimerCompagnon": {
      await supprimer(`/api/compagnons/${enc(op.compagnon)}`, cle);
      return i => ({ ...i, donnees: appliquer(i.donnees, op) });
    }
    case "remplacerTout": {
      const d = succes<{ people: Fiche<Person>[]; sites: Fiche<Site>[]; avail: Avail[] }>(
        await appel("PUT", "/api/donnees", { people: op.people, sites: op.sites }, cle));
      return () => instantaneDe(d);
    }
  }
}

/* ---------- le dépôt ---------- */

export function depotApi(): Depot {
  return {
    source: "api",

    compte: async () => {
      let r: Reponse;
      try { r = await appel("GET", "/api/session"); }
      catch { return dernierCompte(); }                // hors ligne : le dernier compte connu
      if (r.statut === 200) {
        const c = compteDe(String((r.corps as { email?: string } | null)?.email ?? ""));
        retenir(c);
        return c;
      }
      if (r.statut === 401) { retenir(null); return null; }
      return dernierCompte();                          // serveur en difficulté : on garde le cache
    },

    connecter: async (email, motDePasse) => {
      let r: Reponse;
      try { r = await appel("POST", "/api/session", { email, password: motDePasse }); }
      catch { throw new Error("Serveur injoignable : vérifiez le réseau."); }
      if (r.statut === 204) { const c = compteDe(email); retenir(c); return c; }
      if (r.statut === 401) throw new Error("Adresse ou mot de passe incorrect.");
      if (r.statut === 429) {
        const s = Number((r.corps as { reessayerDans?: number } | null)?.reessayerDans) || 900;
        throw new Error(`Trop de tentatives. Réessayez dans ${Math.ceil(s / 60)} min.`);
      }
      throw new Error(messageDe(r));
    },

    /* Hors ligne, la session ne peut pas être révoquée : le cookie
       resterait valable, et l'application rouvrirait la session au
       lancement suivant. On le dit plutôt que de faire semblant. */
    deconnecter: async () => {
      let r: Reponse;
      try { r = await appel("DELETE", "/api/session"); }
      catch { throw new Injoignable("Hors ligne : la déconnexion attendra le réseau."); }
      if (r.statut >= 500) throw new Injoignable("Serveur en difficulté : réessayez dans un instant.");
      retenir(null);
    },

    charger: async () => instantaneDe(succes(await appel("GET", "/api/donnees"))),

    envoyer,

    demanderDispos: async (ids, semaine): Promise<LienDispo[]> => {
      const lignes = succes<{ avail: Avail; url: string }[]>(
        await appel("POST", "/api/dispos/demandes", { compagnonIds: ids, semaine }));
      return lignes.map(l => ({ avail: normAvail(l.avail.id, l.avail), url: l.url }));
    },

    ecouter: surAnnonce => {
      let fini = false;
      let fermer: () => void = () => {};
      void import("socket.io-client").then(({ io }) => {
        if (fini) return;
        const socket = io({ path: "/socket.io", withCredentials: true });
        let dejaConnecte = false;
        socket.on("changement", (c: { mutation?: string }) => surAnnonce({ mutation: c?.mutation }));
        /* Reconnecté après une coupure : ce qui a changé entre-temps n'a
           pas été annoncé, on relit tout (constat S5). */
        socket.on("connect", () => { if (dejaConnecte) surAnnonce({ reprise: true }); dejaConnecte = true; });
        fermer = () => { socket.close(); };
      }).catch(() => { /* sans temps réel, la relecture au premier plan suffit */ });
      return () => { fini = true; fermer(); };
    }
  };
}
