/* ============================================================
   La vue : ce que les écrans lisent

   Construite une fois par état des données affichées, en lecture
   seule, avec les méthodes que les écrans appelaient sur le magasin
   (`person`, `site`, `availOf`, `daysOf`, `availableOn`). Les index
   rendent chaque lecture directe : `availableOn` est appelée des
   centaines de fois par rendu.
   ============================================================ */

import { dayIndex, mondayOf, type Avail, type Person, type Site } from "@geoplan/domain";
import type { Donnees } from "./types";

/* Deux valeurs de même contenu, quel que soit l'ordre des clés. */
function egal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => egal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** `apres`, où chaque fiche égale à celle d'`avant` reprend son identité,
    et chaque liste inchangée aussi. Un geste confirmé repasse de la file
    à l'instantané : même contenu, objets neufs. Sans ceci, les fiches
    mémorisées se redessineraient une seconde fois pour rien. */
export function stabiliser(avant: Donnees, apres: Donnees): Donnees {
  const liste = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const par = new Map(a.map(x => [x.id, x]));
    let meme = a.length === b.length;
    const out = b.map((x, i) => {
      const y = par.get(x.id);
      const garde = y && (y === x || egal(y, x)) ? y : x;
      if (garde !== a[i]) meme = false;
      return garde;
    });
    return meme ? a : out;
  };
  const people = liste(avant.people, apres.people);
  const sites = liste(avant.sites, apres.sites);
  const avail = liste(avant.avail, apres.avail);
  return people === avant.people && sites === avant.sites && avail === avant.avail
    ? avant : { people, sites, avail };
}

export class Vue {
  readonly people: Person[];
  readonly sites: Site[];
  readonly avail: Avail[];
  private readonly parPersonne: Map<string, Person>;
  private readonly parChantier: Map<string, Site>;
  private readonly demandes: Map<string, Avail>;

  constructor(readonly donnees: Donnees) {
    this.people = donnees.people;
    this.sites = donnees.sites;
    this.avail = donnees.avail;
    this.parPersonne = new Map(donnees.people.map(p => [p.id, p]));
    this.parChantier = new Map(donnees.sites.map(s => [s.id, s]));
    /* La première demande d'un compagnon pour une semaine, comme le
       `find` du magasin d'avant (la base n'en garde qu'une de toute façon). */
    this.demandes = new Map();
    for (const a of donnees.avail) {
      const k = a.personId + "@" + a.week;
      if (!this.demandes.has(k)) this.demandes.set(k, a);
    }
  }

  person(id: string): Person | undefined { return this.parPersonne.get(id); }
  site(id: string): Site | undefined { return this.parChantier.get(id); }

  /** Demande — répondue ou non — pour un compagnon et une semaine. */
  availOf(pid: string, wk: string): Avail | undefined { return this.demandes.get(pid + "@" + wk); }

  /** Jours de présence effectifs sur une semaine : la réponse du
      compagnon s'il en a donné une, sinon sa disponibilité habituelle. */
  daysOf(p: Person, wk: string): boolean[] {
    const a = this.availOf(p.id, wk);
    return a && a.days ? a.days : p.days;
  }

  /** Le compagnon est-il disponible CE jour-là ? */
  availableOn = (pid: string, day: string): boolean => {
    const p = this.person(pid);
    if (!p) return false;
    return !!this.daysOf(p, mondayOf(day))[dayIndex(day)];
  };
}
