/* ============================================================
   Arbitraires partagés des tests de propriétés

   On tire des SPÉCIFICATIONS brutes (des nombres, des booléens), puis
   on les transforme en objets du domaine par normPerson / normSite.
   Deux raisons :
     • fast-check réduit un contre-exemple en réduisant ces nombres :
       le cas minimal reste lisible (« deux chantiers, un compagnon ») ;
     • les objets passent par la même normalisation que les données
       réelles : on ne teste pas le moteur sur des chantiers que
       l'application ne pourrait jamais contenir.

   Tout ce qui dépend de la semaine visée (date de début d'un chantier,
   plan déjà saisi) est tiré RELATIVEMENT à cette semaine, pour que le
   filtre des cibles d'optimizeWeek voie à coup sûr des chantiers pas
   encore ouverts, en cours, et en retard sur leur date annoncée.
   ============================================================ */

import fc from "fast-check";
import {
  PHASES,
  addDays, mondayOf, weekDates,
  normPerson, normSite,
  type AvailableOn, type Levels, type OptimizeOptions, type Person, type Site
} from "../../src/domain.ts";

/** Graine commune : toute exécution rejoue exactement les mêmes cas. */
export const GRAINE = 20260925;

/* ---------- semaine ----------
   Un lundi entre le 6 janvier 2025 et le 25 décembre 2028 : quatre
   années, deux changements d'heure par an, et 2026 qui compte
   53 semaines. */
export const JOURS_MAX_SEMAINE = 1450;
export const lundi = (n: number): string => mondayOf(addDays("2025-01-06", n));
export const arbSemaine: fc.Arbitrary<string> =
  fc.integer({ min: 0, max: JOURS_MAX_SEMAINE }).map(lundi);

/* ---------- compagnons ---------- */

export interface SpecPersonne {
  n: number;            // donne l'identifiant, unique dans un effectif
  sk: Levels;
  days: boolean[];
  permis: boolean;
}

const niveau = (max: number) => fc.integer({ min: 1, max });
const niveaux = (max: number): fc.Arbitrary<Levels> => fc.record({
  elec: niveau(max), plomb: niveau(max), platre: niveau(max),
  peint: niveau(max), menuis: niveau(max)
});

export const arbSpecPersonne: fc.Arbitrary<SpecPersonne> = fc.record({
  n: fc.nat({ max: 36 ** 3 - 1 }),
  /* Un compagnon sur cinq est un débutant (tous métiers à 1 ou 2) :
     sans ce poids, la branche « novice » de scorePick (moyenne < 1,8)
     ne sortirait presque jamais d'un tirage uniforme. */
  sk: fc.oneof({ arbitrary: niveaux(5), weight: 4 }, { arbitrary: niveaux(2), weight: 1 }),
  days: fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
  permis: fc.boolean()
});

/* Identifiant à la manière d'uid("p_") : un préfixe et un suffixe en
   base 36, jamais un entier — un entier changerait l'ordre des clés. */
export function personne(spec: SpecPersonne): Person {
  const suffixe = spec.n.toString(36);
  return normPerson("p_" + suffixe, {
    name: "Compagnon " + suffixe, days: spec.days, permis: spec.permis, sk: spec.sk
  });
}

export const arbSpecEffectif = (min: number, max: number): fc.Arbitrary<SpecPersonne[]> =>
  fc.uniqueArray(arbSpecPersonne, { minLength: min, maxLength: max, selector: p => p.n });

/* ---------- chantiers ---------- */

export interface SpecChantier {
  n: number;
  finies: number;                 // étapes finies en tête (à 100 %)
  reste: number[];                // avancement des étapes suivantes
  coches: (boolean[] | null)[];   // missions cochées, étape par étape
  decalage: number;               // début du chantier, en jours depuis la semaine visée
  months: number;
  coef: number;
  plan: { jour: number; qui: number }[];   // plan déjà saisi dans la semaine
}

/* Au-delà de l'étape en cours, la plupart des étapes sont à zéro ; les
   autres valeurs (partielles, voire 100 après une étape inachevée)
   viennent de saisies réelles au doigt et doivent être supportées. */
const arbPct = fc.oneof(
  { arbitrary: fc.constant(0), weight: 2 },
  { arbitrary: fc.integer({ min: 0, max: 100 }), weight: 2 },
  { arbitrary: fc.constant(100), weight: 1 }
);

/* Pour chaque étape, un tableau de coches de la bonne longueur, présent
   une fois sur trois : un chantier repris d'une version antérieure n'a
   aucune coche, et taskRest suit alors le pourcentage. */
const arbCoches: fc.Arbitrary<(boolean[] | null)[]> = fc.tuple(...PHASES.map(P => fc.oneof(
  { arbitrary: fc.constant(null), weight: 2 },
  { arbitrary: fc.array(fc.boolean(), { minLength: P.tasks.length, maxLength: P.tasks.length }), weight: 1 }
)));

/* `qui` au-delà de l'effectif désigne un compagnon parti : un vieux plan
   peut citer quelqu'un qui n'est plus dans la liste. */
export const QUI_PARTI = 20;

export const arbSpecChantier: fc.Arbitrary<SpecChantier> = fc.record({
  n: fc.nat({ max: 36 ** 3 - 1 }),
  finies: fc.integer({ min: 0, max: 12 }),
  reste: fc.array(arbPct, { minLength: 12, maxLength: 12 }),
  coches: arbCoches,
  /* De 230 jours avant à 4 semaines après : avec 1 à 6 mois de durée,
     on obtient des chantiers en retard (échéance passée), en cours,
     ouverts dans la semaine même, et pas encore ouverts. */
  decalage: fc.integer({ min: -230, max: 28 }),
  months: fc.integer({ min: 1, max: 6 }),
  coef: fc.double({ min: 0.5, max: 2, noNaN: true }),
  plan: fc.oneof(
    { arbitrary: fc.constant<SpecChantier["plan"]>([]), weight: 1 },
    { arbitrary: fc.array(fc.record({
        jour: fc.integer({ min: 0, max: 6 }),
        qui: fc.integer({ min: 0, max: QUI_PARTI })
      }), { minLength: 1, maxLength: 14 }), weight: 1 }
  )
});

export function chantier(spec: SpecChantier, wk: string, effectif: Person[]): Site {
  const ph = spec.reste.map((v, i) => (i < spec.finies ? 100 : v));
  const tasks: Record<string, boolean[]> = {};
  spec.coches.forEach((c, i) => { if (c) tasks[String(i)] = c; });
  const plan: Record<string, string[]> = {};
  for (const { jour, qui } of spec.plan) {
    const pid = qui >= QUI_PARTI || !effectif.length
      ? "p_parti" : effectif[qui % effectif.length].id;
    (plan[addDays(wk, jour)] ||= []).push(pid);
  }
  const suffixe = spec.n.toString(36);
  return normSite("s_" + suffixe, {
    code: suffixe.toUpperCase(), addr: "Chantier " + suffixe,
    start: addDays(wk, spec.decalage), months: spec.months, coef: spec.coef,
    ph, tasks, plan
  });
}

export const arbSpecChantiers = (min: number, max: number): fc.Arbitrary<SpecChantier[]> =>
  fc.uniqueArray(arbSpecChantier, { minLength: min, maxLength: max, selector: s => s.n });

/* ---------- disponibilité ----------
   Une matrice personne × jour. Trois cases sur quatre disent « dispo » :
   c'est l'ordre de grandeur d'une vraie semaine, et la réduction d'un
   contre-exemple tend vers « personne n'est là », donc vers le cas le
   plus simple. */
export const EFFECTIF_MAX = 14;
const arbCase = fc.integer({ min: 0, max: 3 }).map(v => v > 0);
export const arbDispo: fc.Arbitrary<boolean[][]> = fc.array(
  fc.array(arbCase, { minLength: 7, maxLength: 7 }),
  { minLength: EFFECTIF_MAX, maxLength: EFFECTIF_MAX }
);

export function disponibilite(people: Person[], wk: string, dispo: boolean[][]): AvailableOn {
  const dates = weekDates(wk);
  const rang = new Map(people.map((p, i) => [p.id, i] as const));
  return (pid, day) => {
    const i = rang.get(pid), j = dates.indexOf(day);
    return i !== undefined && j >= 0 && dispo[i][j];
  };
}

/* ---------- scénario complet d'optimizeWeek ---------- */

export interface SpecScenario {
  semaine: number;
  personnes: SpecPersonne[];
  chantiers: SpecChantier[];
  dispo: boolean[][];
  plancher: number | null;       // null : l'option par défaut (0,3)
}

export interface Scenario {
  wk: string;
  people: Person[];
  sites: Site[];
  dispo: boolean[][];
  availableOn: AvailableOn;
  opts: OptimizeOptions | undefined;
}

export const arbSpecScenario: fc.Arbitrary<SpecScenario> = fc.record({
  semaine: fc.integer({ min: 0, max: JOURS_MAX_SEMAINE }),
  personnes: arbSpecEffectif(1, EFFECTIF_MAX),
  chantiers: arbSpecChantiers(0, 5),
  dispo: arbDispo,
  plancher: fc.oneof(
    { arbitrary: fc.constant(null), weight: 4 },
    { arbitrary: fc.constantFrom(0, 0.3, 1), weight: 1 }
  )
});

export function scenario(spec: SpecScenario): Scenario {
  const wk = lundi(spec.semaine);
  const people = spec.personnes.map(personne);
  const sites = spec.chantiers.map(c => chantier(c, wk, people));
  return {
    wk, people, sites, dispo: spec.dispo,
    availableOn: disponibilite(people, wk, spec.dispo),
    opts: spec.plancher === null ? undefined : { floor: spec.plancher }
  };
}

/* Le même scénario, mais sans aucun chantier à pourvoir : un sur deux
   est fini, les autres ne sont pas encore ouverts. C'est le retour
   anticipé d'optimizeWeek, celui où `bench` manquait. */
export const arbSpecScenarioSansCible: fc.Arbitrary<SpecScenario> = arbSpecScenario
  .map(sp => ({
    ...sp,
    chantiers: sp.chantiers.map((c, i) => i % 2
      ? { ...c, finies: 12 }
      : { ...c, decalage: 7 + (Math.abs(c.decalage) % 60) })
  }));

/* ---------- un chantier seul, pour scorePick et suggestTeam ---------- */

export interface SpecCasChantier { semaine: number; personnes: SpecPersonne[]; chantier: SpecChantier }
export interface CasChantier { wk: string; s: Site; people: Person[] }

export const arbSpecCasChantier = (minPers: number, maxPers: number): fc.Arbitrary<SpecCasChantier> =>
  fc.record({
    semaine: fc.integer({ min: 0, max: JOURS_MAX_SEMAINE }),
    personnes: arbSpecEffectif(minPers, maxPers),
    chantier: arbSpecChantier
  });

export function casChantier(spec: SpecCasChantier): CasChantier {
  const wk = lundi(spec.semaine);
  const people = spec.personnes.map(personne);
  return { wk, s: chantier(spec.chantier, wk, people), people };
}

/* ---------- dates du calendrier ----------
   Une date ISO entre le 1er janvier 1990 et le 31 décembre 2100,
   fabriquée en UTC pur : elle ne doit rien au fuseau ni au code testé. */
export const JOUR_MS = 86_400_000;
const T_1990 = Date.UTC(1990, 0, 1);
const NB_JOURS_1990_2100 = (Date.UTC(2100, 11, 31) - T_1990) / JOUR_MS;

export const isoUTC = (t: number): string => new Date(t).toISOString().slice(0, 10);
export const tUTC = (d: string): number =>
  Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

export const arbDate: fc.Arbitrary<string> =
  fc.integer({ min: 0, max: NB_JOURS_1990_2100 }).map(n => isoUTC(T_1990 + n * JOUR_MS));
