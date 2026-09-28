/* ============================================================
   Les opérations : ce que fait un geste, écrit une fois

   Chaque geste de Geoffrey (poser, retirer, appliquer un plan, cocher
   une mission…) est une intention (ADR-003). Ce module dit ce qu'elle
   produit sur les données, exactement comme les actions d'App le
   faisaient en modifiant les objets sur place — mais sans rien modifier :
   il rend de nouvelles données, où seuls les chantiers et compagnons
   touchés sont de nouveaux objets. C'est ce qui permet à l'écran de
   savoir, par simple identité, quelle fiche redessiner.

   Servent ces fonctions : l'affichage immédiat d'un geste (avant la
   réponse du réseau), la source locale, la source Supabase, et les
   tests qui confrontent l'API à cette définition.

   Règle cardinale : un homme, un chantier, par jour — sauf urgence
   explicite. Hors urgence, poser quelqu'un le retire de ses autres
   chantiers ce jour-là.

   « Remplacer l'équipe » et « Appliquer ce plan » portent l'équipe que
   l'appareil voyait au moment du geste (`avant`). Seul l'écart entre
   `avant` et l'équipe voulue est appliqué : un geste fait entre-temps
   sur un autre appareil n'est jamais effacé en silence, et rejouer le
   même geste ne change plus rien (voir fusionnerEquipe).
   ============================================================ */

import {
  normPerson, normSite, setPhasePct, setTask, setTeamOn, teamOn, weekDates,
  type Avail, type Person, type Site
} from "./domain.ts";

export interface Donnees { people: Person[]; sites: Site[]; avail: Avail[] }

/** Les champs d'un chantier qu'on règle dans sa fiche. */
export type ChampsChantier = Partial<Pick<Site, "code" | "addr" | "start" | "months" | "coef" | "note">>;
/** Les champs d'un compagnon qu'on règle dans sa fiche. */
export type ChampsCompagnon = Partial<Omit<Person, "id">>;

export type Operation =
  | { type: "poser"; site: string; jour: string; compagnon: string; urgence: boolean }
  /** `site` absent : retiré de tous ses chantiers ce jour-là (retour au vivier). */
  | { type: "retirer"; jour: string; compagnon: string; site?: string | null }
  /** Remplace l'équipe d'un chantier un jour donné (liste vide : plus
      personne). Chacun suit la règle de « poser » : hors urgence, qui
      n'était pas déjà là quitte ses autres chantiers ; qui était déjà là
      n'est pas touché ailleurs. `avant` : l'équipe que l'appareil voyait. */
  | { type: "equipe"; site: string; jour: string; compagnons: string[]; avant: string[]; urgence: boolean }
  /** « Appliquer ce plan » (Répartir toute l'équipe) : pour chaque
      chantier cité, les SEPT jours de la semaine sont réécrits — un jour
      absent du plan est vidé, comme le faisait applyPlan. Hors urgence,
      chacun quitte ses autres chantiers ce jour-là, même s'il était déjà
      posé ici. `avant` : pour chaque chantier cité, les équipes que
      l'appareil voyait cette semaine-là (un jour absent : personne). */
  | { type: "plan"; semaine: string; plan: Record<string, Record<string, string[]>>;
      avant: Record<string, Record<string, string[]>>; urgence: boolean }
  | { type: "cocher"; site: string; etape: number; mission: number; faite: boolean }
  | { type: "regler"; site: string; etape: number; pourcentage: number }
  | { type: "modifierChantier"; site: string; champs: ChampsChantier }
  | { type: "creerChantier"; chantier: Site }
  | { type: "supprimerChantier"; site: string }
  | { type: "creerCompagnon"; compagnon: Person }
  | { type: "modifierCompagnon"; compagnon: string; champs: ChampsCompagnon }
  | { type: "supprimerCompagnon"; compagnon: string }
  | { type: "remplacerTout"; people: Person[]; sites: Site[] };

/* ---------- outils : copier ce qu'on touche, et rien d'autre ---------- */

const copieChantier = (s: Site): Site => ({
  ...s,
  ph: s.ph.slice(),
  plan: Object.fromEntries(Object.entries(s.plan).map(([d, ids]) => [d, ids.slice()])),
  tasks: Object.fromEntries(Object.entries(s.tasks).map(([k, v]) => [k, v.slice()]))
});

/** Un espace de travail : les chantiers copiés à la demande, une fois. */
function atelier(d: Donnees) {
  const copies = new Map<string, Site>();
  const chantier = (id: string): Site | undefined => {
    const deja = copies.get(id);
    if (deja) return deja;
    const s = d.sites.find(x => x.id === id);
    if (!s) return undefined;
    const c = copieChantier(s);
    copies.set(id, c);
    return c;
  };
  /* Pour lire sans copier : la version en cours si elle existe. */
  const lire = (s: Site): Site => copies.get(s.id) ?? s;
  const rendre = (): Donnees => copies.size
    ? { ...d, sites: d.sites.map(s => copies.get(s.id) ?? s) }
    : d;
  return { chantier, lire, rendre };
}

/* Retirer une personne des chantiers où elle est ce jour-là, sauf `garde`. */
function retirerAilleurs(d: Donnees, a: ReturnType<typeof atelier>, jour: string, pid: string, garde?: string): void {
  for (const s of d.sites) {
    if (s.id === garde || !teamOn(a.lire(s), jour).includes(pid)) continue;
    const c = a.chantier(s.id)!;
    setTeamOn(c, jour, teamOn(c, jour).filter(x => x !== pid));
  }
}

/* ---------- la fusion à trois voies ---------- */

/**
 * L'équipe à écrire quand l'appareil voulait passer de `avant` à
 * `cible`, alors que l'équipe est, au moment où le geste arrive,
 * `actuelle`. Pour chaque compagnon :
 *
 * • ajouté par le geste (dans `cible`, pas dans `avant`) : présent ;
 * • retiré par le geste (dans `avant`, pas dans `cible`) : absent ;
 * • laissé tel quel par le geste : comme dans `actuelle` — ce qu'un
 *   autre appareil a fait entre-temps (poser Nixon, retirer Erwan) tient.
 *
 * L'ordre : ceux de `cible`, dans l'ordre de `cible`, puis ceux qu'un
 * autre appareil a ajoutés, dans leur ordre actuel.
 *
 * Sans geste concurrent (`actuelle` = `avant`), le résultat est `cible`,
 * sans doublons ; rejoué (`actuelle` = `cible`), il est encore `cible`.
 */
export function fusionnerEquipe(avant: readonly string[], cible: readonly string[],
                                actuelle: readonly string[]): string[] {
  const vu = new Set(avant), voulu = new Set(cible), est = new Set(actuelle);
  const miens = [...voulu].filter(pid => !vu.has(pid) || est.has(pid));
  const autres = [...est].filter(pid => !vu.has(pid) && !voulu.has(pid));
  return [...miens, ...autres];
}

/**
 * Le plan d'une semaine après fusion, calculé sur l'état d'AVANT le
 * geste : les étapes d'un même plan ne doivent pas se prendre l'une
 * l'autre pour des gestes concurrents. Chantiers inconnus ignorés.
 */
export function fusionnerPlan(sites: readonly Site[], semaine: string,
                              plan: Record<string, Record<string, string[]>>,
                              avant: Record<string, Record<string, string[]>>): Record<string, Record<string, string[]>> {
  const jours = weekDates(semaine);
  const fusion: Record<string, Record<string, string[]>> = {};
  for (const sid of Object.keys(plan)) {
    const s = sites.find(x => x.id === sid);
    if (!s) continue;
    fusion[sid] = Object.fromEntries(jours.map(j =>
      [j, fusionnerEquipe(avant[sid]?.[j] ?? [], plan[sid][j] ?? [], teamOn(s, j))]));
  }
  return fusion;
}

/**
 * Au moment d'écrire un jour d'un plan fusionné : ceux que le plan veut
 * sont posés (et, hors urgence, quittent leurs autres chantiers) ; ceux
 * qu'un autre appareil avait ajoutés ne restent que s'ils sont encore là
 * — une étape précédente du même plan a pu les poser ailleurs, et on ne
 * les y reprend pas.
 */
export const equipeAEcrire = (fusionnee: readonly string[], voulue: readonly string[],
                              presente: readonly string[]): string[] =>
  fusionnee.filter(pid => voulue.includes(pid) || presente.includes(pid));

/* ---------- appliquer ---------- */

export function appliquer(d: Donnees, op: Operation): Donnees {
  switch (op.type) {

    case "poser": {
      const cible = d.sites.find(s => s.id === op.site);
      /* Chantier inconnu, ou déjà posé là ce jour-là : rien à faire —
         c'est ce que faisait assignDay. */
      if (!cible || teamOn(cible, op.jour).includes(op.compagnon)) return d;
      const a = atelier(d);
      if (!op.urgence) retirerAilleurs(d, a, op.jour, op.compagnon, op.site);
      const c = a.chantier(op.site)!;
      setTeamOn(c, op.jour, [...teamOn(c, op.jour), op.compagnon]);
      return a.rendre();
    }

    case "retirer": {
      const a = atelier(d);
      if (op.site) {
        const c = d.sites.find(s => s.id === op.site);
        if (!c || !teamOn(c, op.jour).includes(op.compagnon)) return d;
        const w = a.chantier(op.site)!;
        setTeamOn(w, op.jour, teamOn(w, op.jour).filter(x => x !== op.compagnon));
      } else retirerAilleurs(d, a, op.jour, op.compagnon);
      return a.rendre();
    }

    case "equipe": {
      const avant = d.sites.find(s => s.id === op.site);
      if (!avant) return d;
      const deja = teamOn(avant, op.jour);
      const equipe = fusionnerEquipe(op.avant, op.compagnons, deja);
      const a = atelier(d);
      if (!op.urgence)
        for (const pid of equipe) if (!deja.includes(pid)) retirerAilleurs(d, a, op.jour, pid, op.site);
      setTeamOn(a.chantier(op.site)!, op.jour, equipe);
      return a.rendre();
    }

    case "plan": {
      /* Le même ordre qu'applyPlan : chantier par chantier, jour par jour ;
         hors urgence, chacun quitte d'abord ses autres chantiers ce jour-là. */
      const a = atelier(d);
      const jours = weekDates(op.semaine);
      const fusion = fusionnerPlan(d.sites, op.semaine, op.plan, op.avant);
      for (const sid of Object.keys(fusion)) {
        const s = d.sites.find(x => x.id === sid)!;
        for (const jour of jours) {
          const voulue = op.plan[sid][jour] ?? [];
          const ids = equipeAEcrire(fusion[sid][jour], voulue, teamOn(a.lire(s), jour));
          if (!op.urgence) for (const pid of ids) if (voulue.includes(pid)) retirerAilleurs(d, a, jour, pid, sid);
          setTeamOn(a.chantier(sid)!, jour, ids);
        }
      }
      return a.rendre();
    }

    case "cocher": {
      if (!d.sites.some(s => s.id === op.site)) return d;
      const a = atelier(d);
      const c = a.chantier(op.site)!;
      c.ph[op.etape] = setTask(c, op.etape, op.mission, op.faite);
      return a.rendre();
    }

    case "regler": {
      if (!d.sites.some(s => s.id === op.site)) return d;
      const a = atelier(d);
      setPhasePct(a.chantier(op.site)!, op.etape, op.pourcentage);
      return a.rendre();
    }

    case "modifierChantier": {
      const s = d.sites.find(x => x.id === op.site);
      if (!s) return d;
      const neuf = normSite(s.id, { ...s, ...op.champs });
      return { ...d, sites: d.sites.map(x => (x.id === s.id ? neuf : x)) };
    }

    case "creerChantier": {
      const neuf = normSite(op.chantier.id, op.chantier);
      return d.sites.some(x => x.id === neuf.id)
        ? { ...d, sites: d.sites.map(x => (x.id === neuf.id ? neuf : x)) }
        : { ...d, sites: [...d.sites, neuf] };
    }

    case "supprimerChantier":
      return { ...d, sites: d.sites.filter(s => s.id !== op.site) };

    case "creerCompagnon": {
      const neuf = normPerson(op.compagnon.id, op.compagnon);
      return d.people.some(x => x.id === neuf.id)
        ? { ...d, people: d.people.map(x => (x.id === neuf.id ? neuf : x)) }
        : { ...d, people: [...d.people, neuf] };
    }

    case "modifierCompagnon": {
      const p = d.people.find(x => x.id === op.compagnon);
      if (!p) return d;
      const neuf = normPerson(p.id, { ...p, ...op.champs });
      return { ...d, people: d.people.map(x => (x.id === p.id ? neuf : x)) };
    }

    case "supprimerCompagnon": {
      /* Comme deletePerson : le compagnon quitte aussi tous les plans, et
         ses demandes de disponibilité disparaissent avec lui. */
      const a = atelier(d);
      for (const s of d.sites)
        for (const jour of Object.keys(s.plan))
          if (s.plan[jour].includes(op.compagnon)) {
            const c = a.chantier(s.id)!;
            setTeamOn(c, jour, teamOn(c, jour).filter(x => x !== op.compagnon));
          }
      const r = a.rendre();
      return {
        people: r.people.filter(p => p.id !== op.compagnon),
        sites: r.sites,
        avail: r.avail.filter(x => x.personId !== op.compagnon)
      };
    }

    case "remplacerTout":
      return {
        people: op.people.map(p => normPerson(p.id, p)),
        sites: op.sites.map(s => normSite(s.id, s)),
        avail: d.avail.filter(a => op.people.some(p => p.id === a.personId))
      };
  }
}

/** Les chantiers et compagnons qu'une opération touche : ce que la
    source doit écrire, et ce que les autres appareils doivent relire. */
export function touches(avant: Donnees, apres: Donnees): { sites: string[]; people: string[] } {
  const sites = apres.sites.filter(s => !avant.sites.includes(s)).map(s => s.id)
    .concat(avant.sites.filter(s => !apres.sites.some(x => x.id === s.id)).map(s => s.id));
  const people = apres.people.filter(p => !avant.people.includes(p)).map(p => p.id)
    .concat(avant.people.filter(p => !apres.people.some(x => x.id === p.id)).map(p => p.id));
  return { sites: [...new Set(sites)], people: [...new Set(people)] };
}
