/* ============================================================
   Propriétés du besoin d'un chantier et de la valeur d'un compagnon

   siteNeed, scorePick et suggestTeam sont les briques d'optimizeWeek
   et du bouton « Composer ». Leurs bornes (un gain jamais négatif ni
   infini, au moins un front ouvert, un niveau exigé cohérent avec le
   niveau « bientôt » exigé) sont ce qui permet au glouton de s'arrêter
   et de comparer des chantiers entre eux.

   Graine : GRAINE (arbitraires.ts). 500 tirages par propriété : ces
   fonctions coûtent quelques microsecondes.
   ============================================================ */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  SK,
  countDays, loadLeft, neededHeadcount, pressure, scorePick, siteNeed, suggestTeam,
  type Person, type PickContext
} from "../../src/domain.ts";
import { arbSpecCasChantier, casChantier, EFFECTIF_MAX, GRAINE } from "./arbitraires.ts";

fc.configureGlobal({ seed: GRAINE, numRuns: 500 });

/* Un choix à évaluer : une équipe déjà posée, un candidat qui n'en fait
   pas partie, et l'un des quatre contextes que l'application passe
   réellement (rien ; le besoin précalculé ; la pression ; tout). */
const arbChoix = fc.record({
  cas: arbSpecCasChantier(1, 8),
  equipe: fc.uniqueArray(fc.nat({ max: 7 }), { maxLength: 7 }),
  candidat: fc.nat({ max: 7 }),
  contexte: fc.integer({ min: 0, max: 3 }),
  veille: fc.boolean()
});

type SpecChoix = typeof arbChoix extends fc.Arbitrary<infer T> ? T : never;

function choix(spec: SpecChoix) {
  const { wk, s, people } = casChantier(spec.cas);
  const p = people[spec.candidat % people.length];
  const team: Person[] = [...new Set(spec.equipe.map(i => people[i % people.length]))]
    .filter(t => t !== p);
  const ctx: PickContext | undefined =
    spec.contexte === 0 ? undefined
    : spec.contexte === 1 ? { need: siteNeed(s) }
    : spec.contexte === 2 ? { pressure: pressure(s, wk) }
    : { need: siteNeed(s), pressure: pressure(s, wk), wasYesterday: spec.veille };
  return { wk, s, people, p, team, ctx };
}

describe("siteNeed — propriétés", () => {

  it("ouvre au moins un front, demande une charge positive, et exige au moins le niveau « bientôt »", () => {
    fc.assert(fc.property(arbSpecCasChantier(0, 0), spec => {
      const { s } = casChantier(spec);
      const nd = siteNeed(s);
      expect(Number.isInteger(nd.fronts)).toBe(true);
      expect(nd.fronts).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(nd.total)).toBe(true);
      expect(nd.total).toBeGreaterThanOrEqual(0);
      for (const k of SK) {
        /* req porte sur tout le chantier, soon sur les étapes proches :
           le second est une partie du premier. */
        expect(nd.req[k], k).toBeGreaterThanOrEqual(nd.soon[k]);
        expect(nd.need[k], k).toBeGreaterThanOrEqual(0);
        expect(nd.large[k], k).toBeGreaterThanOrEqual(0);
      }
    }));
  });

  it("ne demande rien à un chantier où il ne reste rien", () => {
    /* Un chantier fini sur deux est forcé (douze étapes à 100 %) : un
       tirage libre n'en donnerait qu'un sur treize. Les autres finissent
       par leurs coches ou leurs pourcentages. */
    const arbFini = fc.oneof(
      arbSpecCasChantier(0, 0).map(c => ({ ...c, chantier: { ...c.chantier, finies: 12 } })),
      arbSpecCasChantier(0, 0));
    fc.assert(fc.property(arbFini, spec => {
      const { s } = casChantier(spec);
      if (loadLeft(s) > 0) return;
      const nd = siteNeed(s);
      expect(nd.total).toBe(0);
      expect(nd.fronts).toBe(1);
      for (const k of SK) expect(nd.req[k] + nd.soon[k] + nd.need[k], k).toBe(0);
    }));
  });
});

describe("charge, effectif et pression — propriétés", () => {

  it("bornent l'effectif réclamé entre 1 et 6 tant qu'il reste du travail, et à 0 sinon", () => {
    fc.assert(fc.property(arbSpecCasChantier(0, 0), spec => {
      const { wk, s } = casChantier(spec);
      const reste = loadLeft(s);
      expect(Number.isFinite(reste) && reste >= 0).toBe(true);
      const n = neededHeadcount(s, wk), pr = pressure(s, wk);
      expect(Number.isInteger(n)).toBe(true);
      expect(Number.isFinite(pr) && pr >= 0).toBe(true);
      if (reste < 0.5) { expect(n).toBe(0); expect(pr).toBe(0); }
      else { expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(6); expect(pr).toBeGreaterThan(0); }
    }));
  });
});

describe("scorePick — propriétés", () => {

  it("rend un gain fini et positif, et une liste de raisons", () => {
    /* Le glouton compare des gains et s'arrête sous un plancher : un gain
       NaN passerait toutes les comparaisons à faux et serait posé. */
    fc.assert(fc.property(arbChoix, spec => {
      const { s, p, team, ctx } = choix(spec);
      const r = scorePick(s, team, p, ctx);
      expect(Number.isFinite(r.gain)).toBe(true);
      expect(r.gain).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(r.why)).toBe(true);
      for (const w of r.why) expect(typeof w.type).toBe("string");
    }));
  });

  it("donne le même résultat, que le besoin soit précalculé ou non", () => {
    /* optimizeWeek passe siteNeed en cache ; « Composer » aussi. Le cache
       ne doit rien changer au choix. */
    fc.assert(fc.property(arbChoix, spec => {
      const { s, p, team, ctx } = choix(spec);
      const sans = { ...ctx, need: undefined };
      expect(scorePick(s, team, p, { ...sans, need: siteNeed(s) })).toEqual(scorePick(s, team, p, sans));
    }));
  });

  /* Constat D2 (connu, JOURNAL.md, « à confirmer par test ») — confirmé
     ici et figé tel quel. Le bonus « débloque » se déclenche sur `req`
     (le niveau exigé sur TOUT le chantier) et non sur `soon` (les
     étapes proches), contrairement au commentaire de siteNeed : « un
     seuil ne vaut d'être signalé que s'il tombe bientôt ».
     Contre-exemple réduit par fast-check (graine GRAINE, 2e tirage,
     30 réductions) : un chantier en démolition (étape 0 en cours, rien
     de coché ; ph = [0,0,0,100,0,0,100,0,0,0,0,0], coef 0,5), équipe
     vide, sans contexte ; candidat peintre niveau 3, niveau 1 partout
     ailleurs. Raisons rendues : [gate peint 3, seul] — alors que
     soon.peint = 0 : la peinture niveau 3 (« Retouches peinture ») est
     à l'étape 11. Si D2 est corrigé, ce test échouera : il faudra le
     passer en `it`. */
  it.fails("ne promet de débloquer qu'un seuil des étapes proches (D2)", () => {
    fc.assert(fc.property(arbChoix, spec => {
      const { s, p, team, ctx } = choix(spec);
      const nd = siteNeed(s);
      for (const w of scorePick(s, team, p, ctx).why)
        if (w.type === "gate") expect(w.lv, w.k).toBeLessThanOrEqual(nd.soon[w.k!]);
    }), { endOnFailure: true });
  });
});

describe("suggestTeam — propriétés", () => {

  const arbComposer = fc.record({
    cas: arbSpecCasChantier(0, EFFECTIF_MAX),
    taille: fc.integer({ min: 0, max: 8 }),
    jours: fc.array(fc.integer({ min: 0, max: 7 }), { minLength: EFFECTIF_MAX, maxLength: EFFECTIF_MAX }),
    avecJours: fc.boolean(),
    veilles: fc.array(fc.boolean(), { minLength: EFFECTIF_MAX, maxLength: EFFECTIF_MAX }),
    avecVeille: fc.boolean()
  });

  it("compose une équipe sans doublon, à la taille demandée au plus, de gens qui peuvent venir", () => {
    fc.assert(fc.property(arbComposer, spec => {
      const { wk, s, people } = casChantier(spec.cas);
      const rang = new Map(people.map((p, i) => [p.id, i] as const));
      const usable = spec.avecJours ? (p: Person) => spec.jours[rang.get(p.id)!] : null;
      const veille = spec.avecVeille ? (p: Person) => spec.veilles[rang.get(p.id)!] : null;
      const libre = (p: Person) => (usable ? usable(p) : countDays(p.days));
      const avant = structuredClone(people);

      const { team, need } = suggestTeam(s, spec.taille, wk, people, usable, veille);

      expect(team.length).toBeLessThanOrEqual(spec.taille);
      expect(new Set(team.map(t => t.p.id)).size).toBe(team.length);
      for (const t of team) {
        expect(people).toContain(t.p);              // un membre de l'effectif, pas une copie
        expect(libre(t.p), t.p.id).toBeGreaterThan(0);
        expect(t.days).toBe(libre(t.p));
        expect(t.gain).toBeGreaterThan(0.0001);     // sous ce seuil, « Composer » s'arrête
        expect(Array.isArray(t.why)).toBe(true);
      }
      expect(need).toEqual(siteNeed(s));
      expect(people).toStrictEqual(avant);
    }));
  });
});
