/* Charge restante, capacité et prévisionnel. C'est ce que Geoffrey lit
   sur la carte d'un chantier (« fin prévue le… », « en retard ») et ce
   qui règle, en coulisse, l'effectif et l'urgence donnés au moteur. */

import { describe, expect, it } from "vitest";
import {
  loadLeft, capacity, conflicts, forecast, JH_SEMAINE, neededHeadcount, pressure,
  type AvailableOn
} from "../../src/domain.ts";
import { avancement, chantier, sousFuseau } from "./fabriques.ts";

const WK = "2026-08-31";                    // semaine d'ouverture du chantier type

/* Deux compagnons du lundi au vendredi : dix journées posées. */
const binome = {
  "2026-08-31": ["p_a", "p_b"], "2026-09-01": ["p_a", "p_b"], "2026-09-02": ["p_a", "p_b"],
  "2026-09-03": ["p_a", "p_b"], "2026-09-04": ["p_a", "p_b"]
};

/* Il ne reste que « Levée des réserves » (1 jh), au coefficient 0,5 :
   exactement 0,5 jour-homme. C'est le seuil où les fonctions divergent. */
const demiJournee = () => chantier({
  ph: avancement(11, { 11: 67 }), tasks: { "11": [true, true, false] }, coef: 0.5
});

describe("loadLeft", () => {
  it("vaut 114 jours-homme sur un chantier neuf", () => {
    expect(loadLeft(chantier())).toBe(114);
  });

  it("est multipliée par le coefficient du logement", () => {
    expect(loadLeft(chantier({ coef: 1.5 }))).toBe(171);
    expect(loadLeft(chantier({ coef: 0.8 }))).toBeCloseTo(91.2, 10);
  });

  it("traite un coefficient nul comme 1", () => {
    // normSite borne le coefficient à 0,3 au moins : ce cas ne vient que
    // d'un chantier construit sans passer par la normalisation.
    expect(loadLeft(chantier({ coef: 0 }))).toBe(114);
  });

  it("déduit les étapes finies et la part faite d'une étape sans coche", () => {
    // 114 − (10 + 8 + 7) − 12 × 50 %
    expect(loadLeft(chantier({ ph: avancement(3, { 3: 50 }) }))).toBe(83);
  });

  it("déduit les missions cochées, pas le pourcentage", () => {
    // Étape 9 : parquet, plinthes et barres de seuil restent (1 + 6 + 2), puis 10 et 6.
    expect(loadLeft(chantier({ ph: avancement(9, { 9: 90 }), tasks: { "9": [true, false, false, false] } }))).toBe(25);
  });

  it("vaut zéro sur un chantier fini", () => {
    expect(loadLeft(chantier({ ph: avancement(12) }))).toBe(0);
  });
});

describe("capacity et conflicts", () => {
  const s = chantier({
    plan: {
      "2026-08-30": ["p_a"],                     // dimanche d'avant : hors semaine
      "2026-08-31": ["p_a", "p_b"],
      "2026-09-01": ["p_a"],
      "2026-09-06": ["p_c"],                     // dimanche : dans la semaine
      "2026-09-07": ["p_a"]
    }
  });
  const absentMardi: AvailableOn = (pid, day) => !(pid === "p_a" && day === "2026-09-01");

  it("capacity compte les journées posées dans la semaine", () => {
    expect(capacity(s, WK)).toBe(4);
  });

  it("capacity ne compte pas une journée posée sur un absent", () => {
    expect(capacity(s, WK, absentMardi)).toBe(3);
  });

  it("conflicts liste les journées posées sur un absent", () => {
    expect(conflicts(s, WK, absentMardi)).toEqual([{ pid: "p_a", day: "2026-09-01" }]);
  });

  it("conflicts ne signale rien sans disponibilités connues", () => {
    expect(conflicts(s, WK)).toEqual([]);
  });
});

describe("forecast", () => {
  it("annonce un chantier fini, avec sa date annoncée", () => {
    // La date annoncée est le dimanche de la dernière semaine.
    expect(forecast(chantier({ ph: avancement(12) }), WK)).toEqual({ done: true, planned: "2026-11-01" });
  });

  it("annonce un chantier à l'arrêt quand personne n'y est posé", () => {
    expect(forecast(chantier(), WK)).toEqual({ stalled: true, rest: 114, planned: "2026-11-01" });
  });

  it("projette la fin au rythme de la semaine, et la dit en retard", () => {
    // 114 jh à 10 journées par semaine : 12 semaines, jusqu'au dimanche 22 novembre.
    expect(forecast(chantier({ plan: binome }), WK)).toEqual({
      rest: 114, cap: 10, weeks: 12, end: "2026-11-22", planned: "2026-11-01", late: true
    });
  });

  it("n'est pas en retard quand la fin tombe le jour annoncé", () => {
    // 83 jh à 10 par semaine : 9 semaines, fin le dimanche 1er novembre pile.
    const f = forecast(chantier({ ph: avancement(3, { 3: 50 }), plan: binome }), WK);
    expect(f.end).toBe("2026-11-01");
    expect(f.late).toBe(false);
  });

  it("ne compte que les journées où le compagnon est disponible", () => {
    const seulA: AvailableOn = pid => pid === "p_a";
    expect(forecast(chantier({ plan: binome }), WK, seulA)).toMatchObject({ cap: 5, weeks: 23 });
    expect(forecast(chantier({ plan: binome }), WK, () => false))
      .toEqual({ stalled: true, rest: 114, planned: "2026-11-01" });
  });

  it("ne tient pas pour fini un chantier à qui il reste exactement 0,5 jh", () => {
    // ⚠ constat D8 — comportement actuel figé, voir docs/reconstruction/JOURNAL.md
    // Fini se dit « moins de 0,5 » ici, mais optimizeWeek ne pourvoit que
    // « plus de 0,5 » : à 0,5 pile, le chantier n'est ni fini ni pourvu.
    expect(loadLeft(demiJournee())).toBe(0.5);
    expect(forecast(demiJournee(), WK)).toEqual({ stalled: true, rest: 0.5, planned: "2026-11-01" });
  });
});

describe("neededHeadcount", () => {
  it("prend 4,6 journées utiles par semaine et par personne", () => {
    expect(JH_SEMAINE).toBe(4.6);
  });

  it("calcule l'effectif qui tient la date : 114 jh en 9 semaines font 3 personnes", () => {
    expect(neededHeadcount(chantier(), WK)).toBe(3);
  });

  it("vaut au moins 1 tant qu'il reste du travail", () => {
    expect(neededHeadcount(chantier({ ph: avancement(11) }), WK)).toBe(1);
    // ⚠ constat D8 — à 0,5 jh pile, il faut encore quelqu'un.
    expect(neededHeadcount(demiJournee(), WK)).toBe(1);
  });

  it("plafonne à 6 quand la date est proche ou dépassée", () => {
    expect(neededHeadcount(chantier(), "2026-10-26")).toBe(6);
    expect(neededHeadcount(chantier(), "2026-12-28")).toBe(6);
  });

  it("vaut 0 sur un chantier fini", () => {
    expect(neededHeadcount(chantier({ ph: avancement(12) }), WK)).toBe(0);
  });

  it("ne dépend pas du fuseau : l'écart en semaines est arrondi", () => {
    expect(sousFuseau("UTC", () => neededHeadcount(chantier(), WK))).toBe(3);
  });
});

describe("pressure", () => {
  it("vaut 0 sur un chantier fini", () => {
    expect(pressure(chantier({ ph: avancement(12) }), WK)).toBe(0);
  });

  it("rapporte la charge restante à un binôme à plein temps jusqu'à la date annoncée", () => {
    // Période sans changement d'heure : 9 semaines pleines, 114 / (9 × 4,6 × 2).
    const s = chantier({ start: "2026-04-06", months: 2 });
    expect(pressure(s, "2026-04-06")).toBeCloseTo(114 / (9 * JH_SEMAINE * 2), 12);
    // À la dernière semaine, il reste une semaine.
    expect(pressure(s, "2026-06-01")).toBeCloseTo(114 / (JH_SEMAINE * 2), 12);
  });

  it("garde un plancher d'une demi-semaine une fois la date dépassée", () => {
    const plancher = 114 / (0.5 * JH_SEMAINE * 2);
    expect(pressure(chantier(), "2026-11-02")).toBeCloseTo(plancher, 12);
    expect(pressure(chantier(), "2026-12-28")).toBeCloseTo(plancher, 12);
  });

  it("reste positive à 0,5 jh pile", () => {
    // ⚠ constat D8 — le chantier « à pourvoir » selon pressure ne l'est pas pour optimizeWeek.
    expect(pressure(demiJournee(), WK)).toBeGreaterThan(0);
  });

  it("dépend du fuseau quand la période traverse un changement d'heure", () => {
    // ⚠ constat D4 — comportement actuel figé, voir docs/reconstruction/JOURNAL.md
    // Du 31 août au 26 octobre, l'heure d'hiver ajoute une heure à Paris :
    // 9 semaines + 1/168, au lieu de 9 pile en UTC.
    const paris = pressure(chantier(), WK);
    const utc = sousFuseau("UTC", () => pressure(chantier(), WK));
    expect(paris).toBeCloseTo(114 / ((9 + 1 / 168) * JH_SEMAINE * 2), 12);
    expect(paris).toBeCloseTo(1.3759016, 6);
    expect(utc).toBeCloseTo(114 / (9 * JH_SEMAINE * 2), 12);
    expect(utc).not.toBe(paris);
  });
});
