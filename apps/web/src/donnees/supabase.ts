/* ============================================================
   La source Supabase : la production jusqu'à la bascule (W7)

   Le comportement d'avant W4, à l'identique pour la base : un geste
   s'applique à l'instantané confirmé avec les fonctions du domaine, puis
   chaque LIGNE ENTIÈRE qu'il touche part par `upsert`. Le dernier arrivé
   gagne (constat S4, assumé : la production ne change pas avant la
   bascule). Le temps réel déclenche une relecture.

   Ce qui change, et ne se voit pas dans la base : les lignes envoyées
   sont calculées au moment de l'envoi, depuis l'état du serveur et les
   gestes déjà confirmés. Une modification faite pendant un envoi n'est
   donc plus perdue (constat S1).

   Ce module n'est chargé que si la source est `supabase` : supabase-js
   ne pèse rien sur les autres.
   ============================================================ */

import {
  createClient, isAuthRetryableFetchError, type PostgrestError, type RealtimeChannel, type User
} from "@supabase/supabase-js";
import {
  normAvail, normPerson, normSite, type Avail, type Levels, type Person, type Site
} from "@geoplan/domain";
import { appliquer, touches } from "@geoplan/domain/operations";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";
import {
  Injoignable, NonConnecte, RefusDefinitif,
  type Compte, type Depot, type Donnees, type LienDispo
} from "./types";

/* Les lignes telles que Supabase les stocke (supabase/schema.sql). Le
   seul renommage est `start` ↔ `start_date` ; `weeks` est l'ancien plan
   hebdomadaire, que normSite sait encore relire. */
interface PersonRow {
  id: string; name: string; phone: string; email: string; days: boolean[];
  permis: boolean; sk: Levels; note: string; updated_at?: string;
}
interface SiteRow {
  id: string; code: string; addr: string; start_date: string; months: number;
  coef: number; ph: number[]; note: string;
  plan: Record<string, string[]>; tasks: Record<string, boolean[]>;
  weeks?: unknown; updated_at?: string;
}
interface AvailRow {
  id: string; token: string; person_id: string; week: string;
  days: boolean[] | null; note: string; answered_at: string | null;
}

const rowToPerson = (r: PersonRow): Person => normPerson(r.id, {
  name: r.name, phone: r.phone, email: r.email, days: r.days,
  permis: r.permis, sk: r.sk, note: r.note });
const personToRow = (p: Person): PersonRow => ({
  id: p.id, name: p.name, phone: p.phone, email: p.email, days: p.days,
  permis: p.permis, sk: p.sk, note: p.note, updated_at: new Date().toISOString() });

const rowToSite = (r: SiteRow): Site => {
  const src: Partial<Site> & { weeks?: unknown } = {
    code: r.code, addr: r.addr, start: r.start_date, months: r.months,
    coef: r.coef, ph: r.ph, note: r.note, plan: r.plan, tasks: r.tasks, weeks: r.weeks };
  return normSite(r.id, src);
};
const siteToRow = (s: Site): SiteRow => ({
  id: s.id, code: s.code, addr: s.addr, start_date: s.start, months: s.months,
  coef: s.coef, ph: s.ph, note: s.note, plan: s.plan, tasks: s.tasks,
  updated_at: new Date().toISOString() });

const rowToAvail = (r: AvailRow): Avail => normAvail(r.id, {
  token: r.token, personId: r.person_id, week: r.week, days: r.days,
  note: r.note, answeredAt: r.answered_at });

const AVAIL_TABLE = "avail_requests";

const rnd = (n: number): string => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
};

/* Une erreur de PostgREST, rangée selon ce qu'il faut en faire. */
function classer(e: PostgrestError | Error | null, statut: number): Error {
  const message = e?.message || "erreur";
  if (statut === 401) return new NonConnecte(message);
  if (statut === 0 || statut === 408 || statut === 429 || statut >= 500 || /fetch|network|réseau/i.test(message))
    return new Injoignable(message);
  return new RefusDefinitif(message);
}

async function verifier<T>(p: PromiseLike<{ data: T | null; error: PostgrestError | null; status: number }>): Promise<T> {
  let r: { data: T | null; error: PostgrestError | null; status: number };
  try { r = await p; }
  catch (e) { throw new Injoignable((e as Error)?.message || "réseau indisponible"); }
  if (r.error) throw classer(r.error, r.status);
  return r.data as T;
}

/* Ce que le serveur contient désormais : l'instantané `base`, où les
   fiches touchées par le geste sont celles qu'on vient d'écrire. */
function reporter(base: Donnees, apres: Donnees, t: { sites: string[]; people: string[] }): Donnees {
  const remplacer = <T extends { id: string }>(liste: T[], neuves: T[], ids: string[]): T[] => {
    const touches = new Set(ids);
    const par = new Map(neuves.filter(x => touches.has(x.id)).map(x => [x.id, x]));
    const out = liste.filter(x => !touches.has(x.id) || par.has(x.id)).map(x => par.get(x.id) ?? x);
    for (const x of par.values()) if (!liste.some(y => y.id === x.id)) out.push(x);
    return out;
  };
  const people = remplacer(base.people, apres.people, t.people);
  const restants = new Set(people.map(p => p.id));
  return {
    people,
    sites: remplacer(base.sites, apres.sites, t.sites),
    avail: base.avail.filter(a => restants.has(a.personId))
  };
}

export function depotSupabase(): Depot {
  const url = SUPABASE_URL.trim().replace(/\/$/, "");
  const sb = createClient(url, SUPABASE_ANON_KEY.trim(), {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  /* Là où supabase-js range la session (sa clé par défaut). */
  const cleSession = "sb-" + new URL(url).hostname.split(".")[0] + "-auth-token";
  const sessionGardee = (): User | null => {
    try {
      const s = JSON.parse(localStorage.getItem(cleSession) || "null") as { user?: User } | null;
      return s?.user?.id ? s.user : null;
    } catch { return null; }
  };
  /* Un lien de réinitialisation ouvre l'application avec un jeton dans
     l'adresse : une fois lu, on l'efface de la barre d'adresse. */
  sb.auth.onAuthStateChange(() => {
    if (location.hash.includes("access_token"))
      history.replaceState(null, "", location.pathname + location.search);
  });
  const compteDe = (u: User): Compte => ({ id: u.id, email: u.email ?? "" });

  const ecrireLigne = async (table: "people" | "sites", id: string, apres: Donnees): Promise<void> => {
    if (table === "people") {
      const p = apres.people.find(x => x.id === id);
      await verifier(p ? sb.from("people").upsert(personToRow(p)) : sb.from("people").delete().eq("id", id));
    } else {
      const s = apres.sites.find(x => x.id === id);
      await verifier(s ? sb.from("sites").upsert(siteToRow(s)) : sb.from("sites").delete().eq("id", id));
    }
  };

  return {
    source: "supabase",

    /* La session enregistrée se relit sans réseau. Hors ligne, un jeton
       expiré ne peut pas être rafraîchi : supabase-js ne rend alors plus
       de session, mais il la garde. On rouvre l'application sur son
       cache avec le compte qu'elle porte, au lieu de l'écran de
       connexion (constat S10) ; le jeton sera rafraîchi au retour du
       réseau, avant la première requête. */
    compte: async () => {
      /* D'abord la session gardée, sans attendre le réseau : hors ligne,
         getSession retente le rafraîchissement d'un jeton expiré pendant
         une demi-minute avant d'abandonner. Un lien de réinitialisation
         (jeton dans l'adresse) passe, lui, par getSession. */
      if (!location.hash.includes("access_token")) {
        const u = sessionGardee();
        if (u) return compteDe(u);
      }
      const { data, error } = await sb.auth.getSession();
      const u = data?.session?.user;
      if (u) return compteDe(u);
      if (error && isAuthRetryableFetchError(error)) {
        const g = sessionGardee();
        if (g) return compteDe(g);
      }
      return null;
    },
    connecter: async (email, motDePasse) => {
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: motDePasse });
      if (error) throw error;
      return compteDe(data.user);
    },
    deconnecter: async () => { try { await sb.auth.signOut(); } catch { /* la session locale part quand même */ } },
    inscrire: async (email, motDePasse) => {
      const { data, error } = await sb.auth.signUp({ email: email.trim().toLowerCase(), password: motDePasse });
      if (error) throw error;
      return data.session && data.user ? compteDe(data.user) : null;
    },
    reinitialiser: async email => {
      const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(),
        { redirectTo: location.origin + location.pathname });
      if (error) throw error;
    },

    charger: async () => {
      const people = await verifier(sb.from("people").select("*")) as PersonRow[];
      const sites = await verifier(sb.from("sites").select("*")) as SiteRow[];
      const avail = await verifier(sb.from(AVAIL_TABLE).select("*")) as AvailRow[];
      return {
        donnees: { people: people.map(rowToPerson), sites: sites.map(rowToSite), avail: avail.map(rowToAvail) },
        versions: {}
      };
    },

    envoyer: async (op, _cle, confirme) => {
      const avant = confirme.donnees;
      if (op.type === "remplacerTout") {
        /* Restaurer une sauvegarde : ce qu'elle n'a pas disparaît, tout
           ce qu'elle a est réécrit, comme replaceAll avant W4. */
        const apres = appliquer(avant, op);
        for (const p of avant.people) if (!apres.people.some(x => x.id === p.id)) await ecrireLigne("people", p.id, apres);
        for (const s of avant.sites) if (!apres.sites.some(x => x.id === s.id)) await ecrireLigne("sites", s.id, apres);
        if (apres.people.length) await verifier(sb.from("people").upsert(apres.people.map(personToRow)));
        if (apres.sites.length) await verifier(sb.from("sites").upsert(apres.sites.map(siteToRow)));
        return i => ({ ...i, donnees: appliquer(i.donnees, op) });
      }
      const apres = appliquer(avant, op);
      const t = touches(avant, apres);
      /* Les chantiers d'abord, puis les compagnons : supprimer quelqu'un
         le retire des plans avant de retirer sa fiche, dans l'ordre
         qu'avait la file d'avant W4. */
      for (const id of t.sites) await ecrireLigne("sites", id, apres);
      for (const id of t.people) await ecrireLigne("people", id, apres);
      return i => ({ ...i, donnees: reporter(i.donnees, apres, t) });
    },

    /* Une ligne par compagnon et par semaine, réutilisée si elle existe :
       relancer quelqu'un ne casse pas le lien déjà envoyé, et il peut
       corriger sa réponse tant que la demande n'a pas expiré. */
    demanderDispos: async (ids, semaine) => {
      const rows = ids.map(pid => ({ id: pid + "@" + semaine, token: rnd(18), person_id: pid, week: semaine }));
      /* ignoreDuplicates préserve le jeton d'origine et la réponse. */
      await verifier(sb.from(AVAIL_TABLE).upsert(rows, { onConflict: "id", ignoreDuplicates: true }));
      const lues = await verifier(sb.from(AVAIL_TABLE).select("*").in("id", rows.map(r => r.id))) as AvailRow[];
      const base = location.origin + location.pathname.replace(/[^/]*$/, "");
      return lues.map(rowToAvail).map((avail): LienDispo => ({ avail, url: base + "dispo.html?t=" + avail.token }));
    },

    ecouter: surAnnonce => {
      let abonne = false;
      const canal: RealtimeChannel = sb.channel("geoplan");
      for (const table of ["people", "sites", AVAIL_TABLE])
        canal.on("postgres_changes", { event: "*", schema: "public", table }, () => surAnnonce({}));
      canal.subscribe(etat => {
        /* Réabonné après une coupure : ce qui a changé entre-temps n'a
           pas été annoncé, on relit tout (constat S5). */
        if (etat === "SUBSCRIBED") { if (abonne) surAnnonce({ reprise: true }); abonne = true; }
      });
      return () => { void sb.removeChannel(canal); };
    }
  };
}
