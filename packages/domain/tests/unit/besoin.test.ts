/* Le besoin d'un chantier, vu depuis l'étape en cours. C'est l'entrée
   de tout le moteur d'affectation : une erreur ici déplace chaque
   compagnon. Les valeurs du chantier neuf sont recalculées à la main dans
   les commentaires, pour que la reconstruction sache d'où elles viennent. */

import { describe, expect, it } from "vitest";
import {
  PHASES, SK, SOON, siteNeed, uncovered, coverage, type Levels, type Site
} from "../../src/domain.ts";
import { annuaire, avancement, chantier, compagnon, niveaux } from "./fabriques.ts";

const somme = (l: Levels): number => SK.reduce((a, k) => a + l[k], 0);

/* Un chantier dont une seule étape reste à faire, à `d` étapes de l'étape
   en cours. L'astuce : les étapes d'avant sont toutes cochées mais
   laissées à 99 %. Elles ne pèsent plus rien, et pourtant l'étape en
   cours reste la première — donc l'étape visée est bien à distance `d`. */
function seuleEtape(d: number): Site {
  const ph = avancement(12);
  const tasks: Record<string, boolean[]> = {};
  for (let i = 0; i < d; i++) {
    ph[i] = 99;
    tasks[String(i)] = PHASES[i].tasks.map(() => true);
  }
  ph[d] = 0;
  return chantier({ ph, tasks });
}

describe("siteNeed sur un chantier neuf", () => {
  const nd = siteNeed(chantier());

  it("ouvre six fronts : cinq missions de démolition et deux saignées à demi", () => {
    expect(nd.fronts).toBe(6);
  });

  it("pèse 13,2 jh dans les étapes proches : démolition entière, saignées à 0,4", () => {
    // 10 + 0,4 × (3 + 5)
    expect(nd.nearW).toBeCloseTo(13.2, 10);
    expect(nd.proches).toHaveLength(7);
    expect(nd.proches.map(m => m.sk)).toEqual([null, null, null, null, null, "elec", "platre"]);
  });

  it("répartit la charge pondérée par métier, en décroissance franche 0,4^d", () => {
    expect(nd.need.elec).toBeCloseTo(3 * 0.4 + 3 * 0.4 ** 2 + 5 * 0.4 ** 4, 10);        // 1,808
    expect(nd.need.plomb).toBeCloseTo(4 * 0.4 ** 2 + 4 * 0.4 ** 6, 10);
    expect(nd.need.platre).toBeCloseTo(5 * 0.4 + 12 * 0.4 ** 3 + 3 * 0.4 ** 4 + 12 * 0.4 ** 5
      + 1 * 0.4 ** 6 + 10 * 0.4 ** 7, 10);
    expect(nd.need.peint).toBeCloseTo(7 * 0.4 ** 8 + 3 * 0.4 ** 11, 10);
    expect(nd.need.menuis).toBeCloseTo(12 * 0.4 ** 9 + 10 * 0.4 ** 10, 10);
    expect(nd.poly).toBeCloseTo(10 + 7 * 0.4 ** 8 + 3 * 0.4 ** 11, 10);
    expect(nd.poly).toBeCloseTo(10.005, 3);
    expect(nd.total).toBeCloseTo(15.466, 3);
    expect(nd.total).toBeCloseTo(somme(nd.need) + nd.poly, 10);
  });

  it("voit plus loin en décroissance douce 0,75^d pour les surnuméraires", () => {
    expect(nd.large.elec).toBeCloseTo(3 * 0.75 + 3 * 0.75 ** 2 + 5 * 0.75 ** 4, 10);   // 5,5195
    expect(nd.totalLarge).toBeCloseTo(35.723, 3);
    expect(nd.totalLarge).toBeCloseTo(somme(nd.large) + nd.polyLarge, 10);
    expect(nd.polyLarge).toBeCloseTo(10 + 7 * 0.75 ** 8 + 3 * 0.75 ** 11, 10);
  });

  it("exige sur tout le chantier le niveau le plus haut de chaque métier", () => {
    expect(nd.req).toEqual({ elec: 4, plomb: 4, platre: 4, peint: 3, menuis: 5 });
  });

  it("n'exige bientôt que ce que demandent l'étape en cours et la suivante", () => {
    expect(SOON).toBe(1);
    expect(nd.soon).toEqual({ elec: 3, plomb: 0, platre: 2, peint: 0, menuis: 0 });
  });

  it("réclame le permis, et tout de suite, pour l'amenée du matériel", () => {
    expect(nd.permis).toBe(true);
    expect(nd.permisSoon).toBe(true);
  });
});

describe("siteNeed à d'autres stades", () => {
  it("compte à moitié une étape en cours faite à 50 % sans coche", () => {
    const nd = siteNeed(chantier({ ph: avancement(3, { 3: 50 }) }));
    // Plâtre à 50 % (12 × 0,5), puis l'étape Élec à 0,4.
    expect(nd.proches).toEqual([
      { sk: "platre", lv: 3, w: expect.closeTo(6, 10) },
      { sk: "elec", lv: 3, w: expect.closeTo(2, 10) },
      { sk: "platre", lv: 2, w: expect.closeTo(1.2, 10) }
    ]);
    expect(nd.nearW).toBeCloseTo(9.2, 10);
    // 0,5 front en cours + 2 × 0,5 pour l'étape suivante = 1,5, arrondi à 2.
    expect(nd.fronts).toBe(2);
    expect(nd.need.elec).toBeCloseTo(2, 10);
    expect(nd.soon).toEqual({ elec: 3, plomb: 0, platre: 3, peint: 0, menuis: 0 });
    expect(nd.req).toEqual({ elec: 3, plomb: 4, platre: 4, peint: 3, menuis: 5 });
    expect(nd.permis).toBe(false);
    expect(nd.permisSoon).toBe(false);
  });

  it("ignore les missions cochées de l'étape en cours", () => {
    // Ponçage coché : restent l'aspiration et le nettoyage, de la main-d'oeuvre.
    const nd = siteNeed(chantier({ ph: avancement(8, { 8: 33 }), tasks: { "8": [true, false, false] } }));
    expect(nd.soon.peint).toBe(0);
    expect(nd.req.peint).toBe(3);                // les retouches de finition restent
    expect(nd.soon.menuis).toBe(4);              // le parquet, à l'étape suivante
    expect(nd.need.menuis).toBeCloseTo(12 * 0.4 + 10 * 0.4 ** 2, 10);
    expect(nd.poly).toBeCloseTo(7 + 3 * 0.4 ** 3, 10);
    expect(nd.fronts).toBe(4);                   // 2 missions + 4 × 0,5
    expect(nd.nearW).toBeCloseTo(7 + 12 * 0.4, 10);
  });

  it("multiplie charges et poids par le coefficient, mais pas les fronts ni les niveaux", () => {
    const base = siteNeed(chantier({ ph: avancement(3, { 3: 50 }) }));
    const gros = siteNeed(chantier({ ph: avancement(3, { 3: 50 }), coef: 1.2 }));
    expect(gros.total).toBeCloseTo(base.total * 1.2, 10);
    expect(gros.totalLarge).toBeCloseTo(base.totalLarge * 1.2, 10);
    expect(gros.nearW).toBeCloseTo(base.nearW * 1.2, 10);
    expect(gros.fronts).toBe(base.fronts);
    expect(gros.req).toEqual(base.req);
  });

  it("traite un coefficient nul comme 1, comme loadLeft", () => {
    // normSite l'interdit (0,3 au moins) ; seul un chantier brut peut l'avoir.
    expect(siteNeed(chantier({ coef: 0 }))).toEqual(siteNeed(chantier()));
  });

  it("donne un besoin nul et un front sur un chantier fini", () => {
    const nd = siteNeed(chantier({ ph: avancement(12) }));
    expect(nd.need).toEqual(niveaux(0));
    expect(nd.req).toEqual(niveaux(0));
    expect(nd.total).toBe(0);
    expect(nd.totalLarge).toBe(0);
    expect(nd.nearW).toBe(0);
    expect(nd.proches).toEqual([]);
    expect(nd.fronts).toBe(1);                   // jamais moins d'un front
    expect(nd.permis).toBe(false);
  });
});

describe("poids de proximité", () => {
  it("pèse 0,4^d en franc et 0,75^d en élargi, pour chaque étape isolée", () => {
    for (let d = 0; d < 12; d++) {
      const nd = siteNeed(seuleEtape(d));
      const jh = PHASES[d].jh;
      expect(nd.total).toBeCloseTo(jh * 0.4 ** d, 10);
      expect(nd.totalLarge).toBeCloseTo(jh * 0.75 ** d, 10);
    }
  });

  it("ne met dans les étapes proches que l'étape en cours et la suivante", () => {
    expect(siteNeed(seuleEtape(1)).proches).toHaveLength(2);
    expect(siteNeed(seuleEtape(1)).fronts).toBe(1);            // 2 × 0,5
    expect(siteNeed(seuleEtape(2)).proches).toEqual([]);
    expect(siteNeed(seuleEtape(2)).nearW).toBe(0);
    expect(siteNeed(seuleEtape(2)).soon).toEqual(niveaux(0));
    // Le niveau exigé, lui, vaut quelle que soit la distance.
    expect(siteNeed(seuleEtape(10)).req.menuis).toBe(5);
  });
});

describe("uncovered", () => {
  const people = [
    compagnon("p_conf"),                                            // 3 partout
    compagnon("p_elec", { elec: 5, plomb: 1, platre: 1, peint: 1, menuis: 1 }),
    compagnon("p_novice", niveaux(1))
  ];
  const qui = annuaire(people);

  it("liste, sans équipe, toutes les missions de métier restantes avec un niveau nul", () => {
    const u = uncovered(chantier(), [], qui);
    expect(u).toHaveLength(22);
    expect(u.every(x => x.have === 0)).toBe(true);
    expect(u[0]).toEqual({ task: PHASES[1].tasks[0], phase: 1, index: 0, need: 3, have: 0 });
  });

  it("ignore les missions sans métier, même hors de portée de l'équipe", () => {
    // « Levée des réserves » exige 3 de moyenne ; le novice n'y est pas, et
    // pourtant elle n'apparaît pas : seules les missions de métier bloquent.
    const u = uncovered(chantier({ ph: avancement(11) }), ["p_novice"], qui);
    expect(u.map(x => x.task.t)).toEqual(["Retouches peinture"]);
    expect(u[0]).toMatchObject({ phase: 11, index: 0, need: 3, have: 1 });
  });

  it("retient le meilleur niveau de l'équipe dans chaque métier", () => {
    const u = uncovered(chantier(), ["p_conf", "p_elec"], qui);
    expect(u.map(x => [x.phase, x.index, x.need, x.have])).toEqual([
      [6, 0, 4, 3], [7, 1, 4, 3], [9, 2, 4, 3], [10, 0, 5, 3]
    ]);
  });

  it("ignore les missions cochées et les identifiants inconnus", () => {
    const s = chantier({ ph: avancement(10, { 10: 50 }), tasks: { "10": [true, false] } });
    expect(uncovered(s, ["p_inconnu", "p_novice"], qui).map(x => x.task.t))
      .toEqual(["Pose des électroménagers encastrés", "Retouches peinture"]);
  });
});

describe("coverage", () => {
  const qui = annuaire([
    compagnon("p_a", { elec: 5, plomb: 1, platre: 2, peint: 1, menuis: 1 }),
    compagnon("p_b", { elec: 2, plomb: 4, platre: 2, peint: 1, menuis: 3 })
  ]);

  it("donne le meilleur niveau de l'équipe dans chaque métier", () => {
    expect(coverage(["p_a", "p_b"], qui)).toEqual({ elec: 5, plomb: 4, platre: 2, peint: 1, menuis: 3 });
  });

  it("vaut zéro partout pour une équipe vide ou inconnue", () => {
    expect(coverage([], qui)).toEqual(niveaux(0));
    expect(coverage(["p_z"], qui)).toEqual(niveaux(0));
  });
});
