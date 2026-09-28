/* ============================================================
   La source locale : les données restent dans ce navigateur

   Aucune configuration, aucun compte : l'application marche tout de
   suite. La clé et le format sont ceux d'avant W4 (« geoplan.cache.v1 »),
   pour qu'une installation existante retrouve ses données : une fois
   mise à jour, elle continue exactement où elle en était.

   Un geste s'applique ici avec les fonctions du domaine, et s'écrit
   aussitôt. Rien n'attend jamais d'être envoyé (constat S9).
   ============================================================ */

import { normAvail, normPerson, normSite, type Avail, type Person, type Site } from "@geoplan/domain";
import { appliquer } from "@geoplan/domain/operations";
import { RefusDefinitif, type Compte, type Depot, type Donnees } from "./types";

export const CLE_LOCALE = "geoplan.cache.v1";
export const COMPTE_LOCAL: Compte = { id: "local", email: "" };

/* Le cache tel qu'écrit par une version quelconque de l'application :
   on ne fait confiance à aucun champ. */
interface Forme {
  people?: (Partial<Person> & { id?: string })[];
  sites?: (Partial<Site> & { id?: string })[];
  avail?: (Partial<Avail> & { id: string })[];
}

/** Ce que contient le cache sous la clé d'avant W4 ; vide s'il n'y a rien
    ou s'il est illisible. Les fiches sans identifiant sont écartées :
    leur en inventer un créerait une fiche nouvelle à chaque lecture. */
export function lireCacheV1(): Donnees {
  let brut: string | null = null;
  try { brut = localStorage.getItem(CLE_LOCALE); } catch { /* stockage refusé : rien à lire */ }
  if (!brut) return { people: [], sites: [], avail: [] };
  try {
    const c = JSON.parse(brut) as Forme | null;
    if (!c || typeof c !== "object") return { people: [], sites: [], avail: [] };
    const tableau = <T,>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
    return {
      people: tableau<Partial<Person> & { id?: string }>(c.people)
        .filter(p => p && typeof p.id === "string").map(p => normPerson(p.id!, p)),
      sites: tableau<Partial<Site> & { id?: string }>(c.sites)
        .filter(s => s && typeof s.id === "string").map(s => normSite(s.id!, s)),
      avail: tableau<Partial<Avail> & { id: string }>(c.avail)
        .filter(a => a && typeof a.id === "string").map(a => normAvail(a.id, a))
    };
  } catch { return { people: [], sites: [], avail: [] }; }
}

/* L'écriture peut échouer (quota plein, navigation privée) : l'erreur
   remonte, et la file la signale (constat S6). */
function ecrire(d: Donnees): void {
  localStorage.setItem(CLE_LOCALE, JSON.stringify({
    people: d.people, sites: d.sites, avail: d.avail, dirty: [], gone: []
  }));
}

export function depotLocal(): Depot {
  /* Lu une fois, puis tenu en mémoire : relire et renormaliser tout le
     cache à chaque geste était du travail perdu, en plein geste. */
  let courant: Donnees | null = null;
  const lire = (): Donnees => (courant ??= lireCacheV1());
  return {
    source: "local",
    compte: async () => COMPTE_LOCAL,
    connecter: async () => COMPTE_LOCAL,
    deconnecter: async () => {},
    charger: async () => ({ donnees: lire(), versions: {} }),
    envoyer: async op => {
      const suivant = appliquer(lire(), op);
      ecrire(suivant);                       // si l'écriture échoue, la mémoire ne bouge pas
      courant = suivant;
      return i => ({ ...i, donnees: appliquer(i.donnees, op) });
    },
    /* Un lien de disponibilité doit s'ouvrir sur un autre téléphone :
       il lui faut une base. La feuille le dit sans appeler ceci. */
    demanderDispos: async () => { throw new RefusDefinitif("Cette fonction a besoin d'une base"); },
    ecouter: () => () => {}
  };
}
