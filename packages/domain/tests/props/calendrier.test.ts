/* ============================================================
   Propriétés du calendrier, sous trois fuseaux

   Tout le calendrier du domaine passe par des dates LOCALES (parse
   fabrique minuit dans le fuseau du processus). Trois fuseaux :
     • Europe/Paris — celui de Geoffrey, et de la configuration ;
     • America/Santiago — le Chili change d'heure À MINUIT : le
       « minuit » que fabrique parse n'existe pas certains jours ;
       c'est le fuseau le plus hostile à ce code ;
     • UTC — sans aucun changement d'heure, la référence.

   Le fuseau est changé À L'EXÉCUTION (process.env.TZ) : Node le prend
   en compte dans le processus, y compris sous Windows (vérifié en W0).
   Chaque bloc commence par vérifier que le fuseau est réellement actif,
   sans quoi les propriétés passeraient sans rien prouver. Il est
   restauré dans un finally, quoi qu'il arrive.

   Les dates attendues sont calculées en UTC pur (tUTC, isoUTC), jamais
   avec les fonctions testées.

   Graine : GRAINE (arbitraires.ts). 1 000 dates par propriété et par
   fuseau.
   ============================================================ */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, dayIndex, iso, mondayOf, parse, weekDates, weekNum
} from "../../src/domain.ts";
import { arbDate, GRAINE, isoUTC, JOUR_MS, tUTC } from "./arbitraires.ts";

fc.configureGlobal({ seed: GRAINE, numRuns: 1000 });

function sousFuseau(tz: string, f: () => void): void {
  const avant = process.env.TZ;
  process.env.TZ = tz;
  try { f(); }
  finally {
    if (avant === undefined) delete process.env.TZ;
    else process.env.TZ = avant;
  }
}

/* Décalage attendu (Date#getTimezoneOffset, en minutes, positif à
   l'ouest) à la mi-janvier et à la mi-juillet 2025. */
const FUSEAUX = [
  { tz: "Europe/Paris",     janvier: -60, juillet: -120 },
  { tz: "America/Santiago", janvier: 180, juillet: 240 },   // été austral en janvier
  { tz: "UTC",              janvier: 0,   juillet: 0 }
] as const;

/* Numéro de semaine ISO 8601, en UTC pur : la semaine du jeudi. */
function semaineIso(d: string): number {
  const t = tUTC(d);
  const jeudi = t + (3 - (new Date(t).getUTCDay() + 6) % 7) * JOUR_MS;
  const debut = Date.UTC(new Date(jeudi).getUTCFullYear(), 0, 1);
  return Math.floor((jeudi - debut) / JOUR_MS / 7) + 1;
}
/* Jours où minuit n'existe pas à Santiago (parse y rend 1 h du matin :
   vérifié sous Node), et deux retours à l'heure d'hiver. Un tirage de
   1 000 dates sur 111 ans n'en touche que quelques-uns : on les impose
   à chaque propriété, dans les trois fuseaux. */
const JOURS_PIEGES = [
  "1999-10-10", "2022-09-11", "2023-09-03", "2024-09-08", "2025-09-07",
  "2024-04-07", "2025-04-06",
  "2026-03-29", "2026-10-25"          // Paris : passage à l'heure d'été et d'hiver
];
const exemples: [string][] = JOURS_PIEGES.map(d => [d]);
const exemplesDecales: [string, number][] =
  JOURS_PIEGES.flatMap(d => [[d, 1], [d, -1], [d, 7], [d, -7], [d, 365]] as [string, number][]);

const indexUTC = (d: string): number => (new Date(tUTC(d)).getUTCDay() + 6) % 7;
const ecartJours = (a: string, b: string): number => (tUTC(b) - tUTC(a)) / JOUR_MS;

for (const { tz, janvier, juillet } of FUSEAUX) {
  describe(`calendrier — ${tz}`, () => {

    it("s'exécute bien dans ce fuseau", () => {
      sousFuseau(tz, () => {
        expect(new Date(Date.UTC(2025, 0, 15, 12)).getTimezoneOffset()).toBe(janvier);
        expect(new Date(Date.UTC(2025, 6, 15, 12)).getTimezoneOffset()).toBe(juillet);
      });
    });

    it("relit une date à l'identique : iso(parse(d)) === d", () => {
      sousFuseau(tz, () => fc.assert(fc.property(arbDate, d => {
        expect(iso(parse(d))).toBe(d);
      }), { examples: exemples }));
    });

    it("mondayOf rend le lundi de la semaine, au plus six jours avant", () => {
      sousFuseau(tz, () => fc.assert(fc.property(arbDate, d => {
        const m = mondayOf(d);
        expect(dayIndex(d)).toBe(indexUTC(d));
        expect(dayIndex(m)).toBe(0);
        expect(indexUTC(m)).toBe(0);
        expect(m <= d).toBe(true);
        expect(ecartJours(m, d)).toBe(indexUTC(d));   // donc entre 0 et 6
      }), { examples: exemples }));
    });

    it("weekDates donne sept dates consécutives et distinctes, du lundi au dimanche", () => {
      sousFuseau(tz, () => fc.assert(fc.property(arbDate, d => {
        const wk = mondayOf(d);
        const jours = weekDates(wk);
        expect(jours).toHaveLength(7);
        expect(new Set(jours).size).toBe(7);
        expect(jours[0]).toBe(wk);
        jours.forEach((j, i) => {
          expect(j).toBe(isoUTC(tUTC(wk) + i * JOUR_MS));
          expect(dayIndex(j)).toBe(i);
        });
      }), { examples: exemples }));
    });

    it("addDays avance d'exactement n jours, et addDays(addDays(d, n), -n) === d", () => {
      sousFuseau(tz, () => fc.assert(fc.property(arbDate, fc.integer({ min: -1500, max: 1500 }), (d, n) => {
        const e = addDays(d, n);
        expect(ecartJours(d, e)).toBe(n);
        expect(addDays(e, -n)).toBe(d);
      }), { examples: exemplesDecales }));
    });

    it("weekNum reste entre 1 et 53, et donne la semaine ISO du lundi", () => {
      sousFuseau(tz, () => fc.assert(fc.property(arbDate, d => {
        const n = weekNum(d);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(53);
        expect(weekNum(mondayOf(d))).toBe(semaineIso(d));
      }), { examples: exemples }));
    });
  });
}

describe("calendrier — addMonths", () => {

  /* Constat D5 (connu, JOURNAL.md) — figé tel quel.
     addMonths déborde en fin de mois : un chantier commencé un 31 finit
     un mois trop tard. Contre-exemple réduit par fast-check (graine
     GRAINE, 64e tirage) : addMonths("2100-12-29", 2) = "2101-03-01" —
     février 2101 n'a pas de 29. Ce test passera en `it` le jour où D5
     sera corrigé. */
  it.fails("tombe toujours dans le n-ième mois suivant (D5)", () => {
    fc.assert(fc.property(arbDate, fc.integer({ min: 1, max: 12 }), (d, n) => {
      const r = addMonths(d, n);
      const mois = (x: string) => +x.slice(0, 4) * 12 + (+x.slice(5, 7) - 1);
      expect(mois(r), `addMonths(${d}, ${n}) = ${r}`).toBe(mois(d) + n);
    }), { endOnFailure: true });
  });
});
