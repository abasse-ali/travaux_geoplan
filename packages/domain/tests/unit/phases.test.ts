/* Les douze étapes et leurs missions : le catalogue d'où tout le reste
   se déduit. Une mission retouchée par mégarde change la charge de tous
   les chantiers, le besoin par métier et chaque affectation : le
   catalogue est donc figé ligne à ligne. */

import { describe, expect, it } from "vitest";
import {
  PHASES, TOTAL_JH, SKILLS, SK,
  phaseColor, phaseTrades, skLabel, skColor,
  type SkillId
} from "../../src/domain.ts";

/* [métier, niveau minimum, jours-homme] de chaque mission, étape par étape. */
const CATALOGUE: [SkillId | null, number, number][][] = [
  [[null, 2, 1], [null, 1, 2], [null, 1, 1], [null, 1, 4], [null, 1, 2]],
  [["elec", 3, 3], ["platre", 2, 5]],
  [["plomb", 3, 3], ["plomb", 2, 1], ["elec", 4, 3]],
  [["platre", 3, 12]],
  [["elec", 3, 5], ["platre", 2, 3]],
  [["platre", 3, 6], ["platre", 2, 6]],
  [["plomb", 4, 4], ["platre", 2, 1]],
  [["platre", 3, 5], ["platre", 4, 5]],
  [["peint", 2, 7], [null, 1, 3], [null, 1, 4]],
  [["menuis", 2, 3], ["menuis", 2, 1], ["menuis", 4, 6], ["menuis", 3, 2]],
  [["menuis", 5, 7], ["menuis", 3, 3]],
  [["peint", 3, 3], [null, 1, 2], [null, 3, 1]]
];

describe("les douze étapes", () => {
  it("se suivent dans l'ordre du chantier", () => {
    expect(PHASES.map(P => P.n)).toEqual([
      "Démolition", "Saignées & passages réseaux", "Plomberie / Élec", "Plâtre",
      "Élec", "Placo", "Plomberie", "Jointeur", "Ponçage & peinture",
      "Sols & plinthes", "Cuisine & ameublement", "Finition"
    ]);
    expect(PHASES.map(P => P.wk)).toEqual([1, 1, 1, 2, 2, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("gardent leurs missions : métier, niveau exigé et charge", () => {
    expect(PHASES.map(P => P.tasks.map(T => [T.sk, T.lv, T.jh]))).toEqual(CATALOGUE);
  });

  it("n'exigent jamais un niveau hors de 1 à 5", () => {
    for (const P of PHASES) for (const T of P.tasks) {
      expect(T.lv).toBeGreaterThanOrEqual(1);
      expect(T.lv).toBeLessThanOrEqual(5);
    }
  });

  it("pèsent chacune la somme de leurs missions, rien n'est saisi deux fois", () => {
    for (const P of PHASES) expect(P.jh).toBe(P.tasks.reduce((a, T) => a + T.jh, 0));
    expect(PHASES.map(P => P.jh)).toEqual([10, 8, 7, 12, 8, 12, 5, 10, 14, 12, 10, 6]);
  });

  it("font 114 jours-homme pour un T2/T3 neuf", () => {
    expect(TOTAL_JH).toBe(114);
    expect(TOTAL_JH).toBe(PHASES.reduce((a, P) => a + P.jh, 0));
  });

  it("donnent à chaque métier sa part des jours-homme de l'étape", () => {
    for (const P of PHASES) {
      for (const k of SK) {
        const jh = P.tasks.filter(T => T.sk === k).reduce((a, T) => a + T.jh, 0);
        if (jh) expect(P.w[k]).toBeCloseTo(jh / P.jh, 12);
        else expect(P.w[k]).toBeUndefined();
      }
    }
  });

  it("ne comptent la main-d'oeuvre dans aucun poids : les poids ne somment pas toujours à 1", () => {
    // La démolition n'a aucun métier : son poids est vide, pas nul.
    expect(PHASES[0].w).toEqual({});
    // Ponçage & peinture : la moitié de la charge est de la main-d'oeuvre.
    expect(PHASES[8].w).toEqual({ peint: 0.5 });
    expect(PHASES[11].w).toEqual({ peint: 0.5 });
    // Le parquet et ses voisins font 12 jh sur 12 : la somme de quatre
    // fractions flottantes donne 0,999…, d'où la comparaison approchée.
    expect(PHASES[9].w.menuis).toBeCloseTo(1, 12);
    expect(PHASES[1].w).toEqual({ elec: 3 / 8, platre: 5 / 8 });
    expect(PHASES[2].w.plomb).toBeCloseTo(4 / 7, 12);
    expect(PHASES[2].w.elec).toBeCloseTo(3 / 7, 12);
  });

  it("ne supposent le permis qu'en démolition, pour l'amenée du matériel", () => {
    expect(PHASES.map(P => P.permis)).toEqual([true, ...Array.from({ length: 11 }, () => false)]);
    expect(PHASES[0].tasks.filter(T => T.permis).map(T => T.t)).toEqual(["Amenée matérielle"]);
  });
});

describe("phaseColor", () => {
  it("prend la couleur du métier qui pèse le plus dans l'étape", () => {
    expect(PHASES.map((_, i) => phaseColor(i))).toEqual([
      "var(--t-poly)", "var(--t-platre)", "var(--t-plomb)", "var(--t-platre)",
      "var(--t-elec)", "var(--t-platre)", "var(--t-plomb)", "var(--t-platre)",
      "var(--t-peint)", "var(--t-menuis)", "var(--t-menuis)", "var(--t-peint)"
    ]);
  });

  it("donne la couleur polyvalente à une étape sans métier", () => {
    expect(phaseColor(0)).toBe("var(--t-poly)");
  });
});

describe("phaseTrades", () => {
  it("liste les métiers de l'étape dans l'ordre de leurs missions", () => {
    expect(phaseTrades(1)).toEqual(["elec", "platre"]);
    expect(phaseTrades(2)).toEqual(["plomb", "elec"]);
    expect(phaseTrades(8)).toEqual(["peint"]);
  });

  it("rend null, et non une liste vide, pour une étape sans métier", () => {
    expect(phaseTrades(0)).toBeNull();
  });
});

describe("corps de métier", () => {
  it("sont cinq, dans un ordre qui fixe celui des raisons affichées", () => {
    expect(SK).toEqual(["elec", "plomb", "platre", "peint", "menuis"]);
    expect(SKILLS.map(s => s.id)).toEqual(SK);
    expect(SKILLS.map(s => s.ab)).toEqual(["ÉLE", "PLO", "PLÂ", "PEI", "MEN"]);
  });

  it("ont un libellé lisible", () => {
    expect(SK.map(skLabel)).toEqual([
      "Électricité", "Plomberie", "Plâtrerie", "Peinture & finition", "Menuiserie"
    ]);
  });

  it("rendent l'identifiant tel quel quand le métier est inconnu", () => {
    // Une donnée importée d'une version future ne doit pas faire planter l'affichage.
    expect(skLabel("charpente" as SkillId)).toBe("charpente");
  });

  it("ont une couleur, et la main-d'oeuvre la couleur polyvalente", () => {
    expect(skColor("elec")).toBe("var(--t-elec)");
    expect(skColor("menuis")).toBe("var(--t-menuis)");
    expect(skColor(null)).toBe("var(--t-poly)");
    expect(skColor("charpente" as SkillId)).toBe("var(--t-poly)");
  });
});
