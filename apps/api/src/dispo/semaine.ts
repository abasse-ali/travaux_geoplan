/* ============================================================
   Quelle semaine ?

   La relance part le samedi matin et demande les jours de la semaine
   SUIVANTE. « Samedi » et « lundi » s'entendent à l'heure de Paris :
   à 0 h 30 un lundi à Paris, il est encore dimanche en UTC. La date du
   jour se lit donc explicitement dans le fuseau de la relance, puis le
   calcul de semaine passe par le domaine, comme dans l'application.
   ============================================================ */

import { addDays, iso, mondayOf, parse } from "@geoplan/domain";

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Vrai pour une date réelle (pas « 2026-02-30 ») qui tombe un lundi. */
export function estLundi(s: string): boolean {
  if (!DATE_ISO.test(s)) return false;
  /* Une date impossible glisse (le 30 février devient le 2 mars) ou
     devient NaN : dans les deux cas elle ne se relit pas à l'identique. */
  if (iso(parse(s)) !== s) return false;
  return mondayOf(s) === s;
}

/** La date du jour (AAAA-MM-JJ) telle qu'on la lit dans `fuseau`. */
export function dateDans(maintenant: Date, fuseau: string): string {
  const morceaux = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(maintenant);
  const v = (t: string): string => morceaux.find(m => m.type === t)?.value ?? "";
  return v("year") + "-" + v("month") + "-" + v("day");
}

/** Le lundi qui suit `maintenant`, à l'heure de `fuseau`. Un samedi
    comme un dimanche visent le lendemain de ce dimanche ; un lundi vise
    le lundi d'après. */
export function semaineVisee(maintenant: Date, fuseau = "Europe/Paris"): string {
  return addDays(mondayOf(dateDans(maintenant, fuseau)), 7);
}
