/* ============================================================
   Fabriques des tests unitaires du domaine

   Les compagnons et les chantiers sont construits À LA MAIN, sans
   passer par normPerson ni normSite : un test de scorePick ne doit pas
   échouer parce que la normalisation a changé, et inversement.
   ============================================================ */

import type { Levels, Need, Person, PersonLookup, Site } from "../../src/domain.ts";

export const LUN_VEN: boolean[] = [true, true, true, true, true, false, false];

/** Cinq niveaux identiques, sauf ceux qu'on précise. */
export function niveaux(base: number, sk: Partial<Levels> = {}): Levels {
  return { elec: base, plomb: base, platre: base, peint: base, menuis: base, ...sk };
}

/** Un compagnon confirmé (niveau 3 partout, donc ni novice ni hors d'état
    d'encadrer), disponible du lundi au vendredi, sans permis. */
export function compagnon(id: string, sk: Partial<Levels> = {}, extra: Partial<Person> = {}): Person {
  return {
    id, name: id, phone: "", email: "",
    days: LUN_VEN.slice(), permis: false, sk: niveaux(3, sk), note: "",
    ...extra
  };
}

/** Un chantier neuf de deux mois, ouvert le lundi 31 août 2026. */
export function chantier(extra: Partial<Site> = {}): Site {
  return {
    id: "s", code: "S", addr: "",
    start: "2026-08-31", months: 2, coef: 1,
    ph: Array.from({ length: 12 }, () => 0),
    note: "", plan: {}, tasks: {},
    ...extra
  };
}

/** Les `n` premières étapes finies, puis les pourcentages précisés. */
export function avancement(n: number, extra: Record<number, number> = {}): number[] {
  return Array.from({ length: 12 }, (_, i) => (i < n ? 100 : (extra[i] ?? 0)));
}

export const annuaire = (people: Person[]): PersonLookup =>
  (id: string) => people.find(p => p.id === id);

/** Un besoin entièrement nul, à compléter : scorePick accepte le besoin
    tout fait, ce qui permet d'isoler chacune de ses branches. `fronts` à
    10 par défaut, pour que les rendements décroissants ne se mêlent pas
    des tests qui ne les visent pas. */
export function besoin(extra: Partial<Need> = {}): Need {
  return {
    need: niveaux(0), req: niveaux(0), soon: niveaux(0), large: niveaux(0),
    polyLarge: 0, totalLarge: 0, proches: [], nearW: 0, fronts: 10,
    poly: 0, permis: false, permisSoon: false, total: 0,
    ...extra
  };
}

/** Pour passer au domaine une donnée volontairement mal typée, comme en
    produit un fichier importé ou une base partagée. */
export const brut = <T>(o: unknown): T => o as T;

/** Exécute `fn` sous un autre fuseau, puis rétablit le fuseau d'origine
    quoi qu'il arrive. Node relit TZ quand on l'affecte dans le processus
    (y compris sous Windows) ; il ne faut surtout pas écrire `undefined`,
    qui deviendrait la chaîne « undefined ». */
export function sousFuseau<T>(tz: string, fn: () => T): T {
  const avant = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (avant === undefined) delete process.env.TZ;
    else process.env.TZ = avant;
  }
}
