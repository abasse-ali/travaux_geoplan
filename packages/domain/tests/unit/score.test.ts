/* La valeur d'un compagnon pour un chantier. scorePick accepte le besoin
   tout fait : chaque branche est isolée ici avec un besoin construit à
   la main, où tout est nul sauf ce que le test regarde. Les gains
   attendus sont recalculés dans les commentaires, formule par formule. */

import { describe, expect, it } from "vitest";
import { scorePick, siteNeed, type Need, type Person, type PickContext } from "../../src/domain.ts";
import { besoin, chantier, compagnon, niveaux } from "./fabriques.ts";

const S = chantier();                       // ignoré dès que le besoin est fourni

const score = (team: Person[], p: Person, nd: Need, ctx: Omit<PickContext, "need"> = {}) =>
  scorePick(S, team, p, { ...ctx, need: nd });

const types = (team: Person[], p: Person, nd: Need, ctx: Omit<PickContext, "need"> = {}) =>
  score(team, p, nd, ctx).why.map(w => w.type);

/* Un électricien confirmé face à 10 jh d'électricité : 10 × 4 / 5 = 8. */
const elec10 = besoin({ need: niveaux(0, { elec: 10 }), total: 10 });
const elec4 = compagnon("p", { elec: 4 });

describe("scorePick : couvrir la charge d'un métier (sk)", () => {
  it("rapporte la charge du métier fois le niveau apporté, sur 5", () => {
    expect(score([], elec4, elec10)).toEqual({ gain: 8, why: [{ type: "sk", k: "elec", lv: 4 }] });
  });

  it("ne compte que l'écart avec le meilleur de l'équipe", () => {
    // 10 × (4 − 3) / 5 = 2, puis rendements décroissants : / (1 + 0,3).
    const r = score([compagnon("t", { elec: 3 })], elec4, elec10);
    expect(r.gain).toBeCloseTo(2 / 1.3, 12);
    expect(r.why).toEqual([{ type: "sk", k: "elec", lv: 4 }]);
  });

  it("n'apporte rien dans un métier où l'équipe est déjà meilleure", () => {
    expect(score([compagnon("t", { elec: 5 })], elec4, elec10)).toEqual({ gain: 0, why: [] });
  });

  it("ne donne la raison que si l'apport dépasse 5 % de la charge totale", () => {
    // 1 × 3 / 5 = 0,6, sous les 5 % de 100 : compté mais pas affiché.
    const r = score([], compagnon("p"), besoin({ need: niveaux(0, { elec: 1 }), total: 100 }));
    expect(r.gain).toBeCloseTo(0.6, 12);
    expect(r.why).toEqual([]);
  });
});

describe("scorePick : franchir un seuil (gate)", () => {
  const nd = besoin({ need: niveaux(0, { elec: 10 }), req: niveaux(0, { elec: 4 }), total: 10 });

  it("récompense celui qui amène l'équipe au niveau exigé", () => {
    // 10 × 1 / 5 = 2, plus le seuil 10 × 0,6 + 0,8 = 6,8 ; le tout / 1,3.
    const r = score([compagnon("t", { elec: 3 })], elec4, nd);
    expect(r.gain).toBeCloseTo(8.8 / 1.3, 12);
    expect(r.why).toEqual([{ type: "gate", k: "elec", lv: 4 }]);
  });

  it("ne joue plus quand l'équipe a déjà le niveau", () => {
    const r = score([compagnon("t", { elec: 4 })], compagnon("p", { elec: 5 }), nd);
    expect(r.gain).toBeCloseTo(2 / 1.3, 12);
    expect(r.why).toEqual([{ type: "sk", k: "elec", lv: 5 }]);
  });

  it("ne joue pas pour qui reste sous le niveau exigé", () => {
    const r = score([compagnon("t", { elec: 1 })], compagnon("p", { elec: 3 }), nd);
    expect(r.gain).toBeCloseTo(4 / 1.3, 12);
    expect(r.why).toEqual([{ type: "sk", k: "elec", lv: 3 }]);
  });

  it("vaut 0,8 même sans aucune charge restante dans le métier", () => {
    const r = score([], compagnon("p", { menuis: 5 }),
      besoin({ req: niveaux(0, { menuis: 5 }) }));
    expect(r).toEqual({ gain: 0.8, why: [{ type: "gate", k: "menuis", lv: 5 }] });
  });

  it("se déclenche sur le niveau de tout le chantier, pas sur celui des étapes proches", () => {
    // ⚠ constat D2 — comportement actuel figé, voir docs/reconstruction/JOURNAL.md
    // Chantier en démolition : aucune menuiserie avant deux mois (soon = 0),
    // et pourtant un menuisier 5 « débloque la menuiserie ».
    const s = chantier();
    expect(siteNeed(s).soon.menuis).toBe(0);
    const quentin = compagnon("q", { elec: 2, plomb: 2, platre: 3, peint: 3, menuis: 5 });
    expect(scorePick(s, [], quentin).why).toContainEqual({ type: "gate", k: "menuis", lv: 5 });
  });
});

describe("scorePick : main-d'oeuvre polyvalente (poly)", () => {
  it("rapporte la charge sans métier fois le niveau moyen sur 5, fois 0,35", () => {
    // 10 × 3/5 × 0,35 = 2,1
    const r = score([], compagnon("p"), besoin({ poly: 10, total: 10 }));
    expect(r.gain).toBeCloseTo(2.1, 12);
    expect(r.why).toEqual([{ type: "poly" }]);
    expect(score([], compagnon("p", niveaux(5)), besoin({ poly: 10, total: 10 })).gain).toBeCloseTo(3.5, 12);
  });

  it("ne donne la raison que si la polyvalence fait plus de 45 % du gain", () => {
    // 20 × 3/5 = 12 d'électricité contre 0,21 de polyvalence.
    const r = score([], compagnon("p"), besoin({ need: niveaux(0, { elec: 20 }), poly: 1, total: 21 }));
    expect(r.gain).toBeCloseTo(12.21, 12);
    expect(r.why.map(w => w.type)).toEqual(["sk"]);
  });
});

describe("scorePick : permis", () => {
  const nd = besoin({ permis: true, total: 10 });
  const chauffeur = compagnon("p", {}, { permis: true });

  it("rapporte 7 % de la charge plus 0,4, tant que personne dans l'équipe ne l'a", () => {
    expect(score([], chauffeur, nd)).toEqual({ gain: expect.closeTo(1.1, 12), why: [{ type: "permis" }] });
  });

  it("ne rapporte rien si un équipier a déjà le permis", () => {
    expect(score([compagnon("t", {}, { permis: true })], chauffeur, nd)).toEqual({ gain: 0, why: [] });
  });

  it("ne rapporte rien si le chantier n'en a pas besoin, ou sans permis", () => {
    expect(score([], chauffeur, besoin({ total: 10 })).gain).toBe(0);
    expect(score([], compagnon("p"), nd).gain).toBe(0);
  });
});

describe("scorePick : continuité (suite)", () => {
  it("multiplie le gain par 1,25 pour qui était là la veille", () => {
    expect(score([], elec4, elec10, { wasYesterday: true })).toEqual({
      gain: 10, why: [{ type: "sk", k: "elec", lv: 4 }, { type: "suite" }]
    });
    expect(score([], elec4, elec10, { wasYesterday: false }).gain).toBe(8);
  });
});

describe("scorePick : novice", () => {
  // Moyenne 1,4 : novice. Mentor : moyenne 3 pile, et faible en électricité
  // pour que l'écart d'électricité du novice reste le même.
  const novice = compagnon("n", { elec: 3, plomb: 1, platre: 1, peint: 1, menuis: 1 });
  const mentor = compagnon("m", { elec: 1, plomb: 5, platre: 4, peint: 4, menuis: 1 });

  it("laissé seul, ne vaut que 45 % de son gain", () => {
    // 10 × 3 / 5 = 6, × 0,45
    const r = score([], novice, elec10);
    expect(r.gain).toBeCloseTo(2.7, 12);
    expect(r.why).toEqual([{ type: "sk", k: "elec", lv: 3 }, { type: "seul" }]);
  });

  it("encadré par un équipier de moyenne 3 au moins, garde tout son gain", () => {
    // 10 × (3 − 1) / 5 = 4, × 1, / 1,3
    const r = score([mentor], novice, elec10);
    expect(r.gain).toBeCloseTo(4 / 1.3, 12);
    expect(r.why.map(w => w.type)).toEqual(["sk", "encadre"]);
  });

  it("n'est pas encadré par un équipier de moyenne 2,8", () => {
    const presque = compagnon("m", { elec: 1, plomb: 4, platre: 4, peint: 4, menuis: 1 });
    const r = score([presque], novice, elec10);
    expect(r.gain).toBeCloseTo(4 * 0.45 / 1.3, 12);
    expect(r.why.map(w => w.type)).toEqual(["sk", "seul"]);
  });

  it("commence strictement sous 1,8 de moyenne", () => {
    const limite = compagnon("l", { elec: 3, plomb: 2, platre: 2, peint: 1, menuis: 1 });   // 9 / 5
    expect(score([], limite, elec10)).toEqual({ gain: 6, why: [{ type: "sk", k: "elec", lv: 3 }] });
  });
});

describe("scorePick : rien à prendre (rien)", () => {
  // Deux missions proches : électricité niveau 3, et main-d'oeuvre niveau 2.
  const nd = besoin({
    need: niveaux(0, { elec: 10 }), total: 10, nearW: 3,
    proches: [{ sk: "elec", lv: 3, w: 2 }, { sk: null, lv: 2, w: 1 }]
  });

  it("coupe à 5 % le gain de qui n'a le niveau d'aucune mission proche", () => {
    // Moyenne 1,8 (pas novice) mais sous 2, électricité 2 sous 3 : rien à prendre.
    const p = compagnon("p", { elec: 2, plomb: 2, platre: 2, peint: 2, menuis: 1 });
    const r = score([], p, nd);
    expect(r.gain).toBeCloseTo(4 * 0.05, 12);
    expect(r.why).toEqual([{ type: "sk", k: "elec", lv: 2 }, { type: "rien" }]);
  });

  it("ne coupe pas qui peut prendre une mission de métier", () => {
    expect(types([], compagnon("p"), nd)).toEqual(["sk"]);
  });

  it("ne coupe pas qui peut prendre la main-d'oeuvre, même sans le métier", () => {
    const r = score([], compagnon("p", niveaux(2)), nd);
    expect(r.gain).toBeCloseTo(4, 12);
    expect(r.why.map(w => w.type)).toEqual(["sk"]);
  });

  it("coupe franchement, même quand la part prenable est infime mais non nulle", () => {
    const infime = besoin({
      need: niveaux(0, { elec: 10 }), total: 10, nearW: 1.0005,
      proches: [{ sk: "elec", lv: 3, w: 1 }, { sk: null, lv: 1, w: 0.0005 }]
    });
    expect(score([], compagnon("p", niveaux(2)), infime).gain).toBeCloseTo(0.2, 12);
  });

  it("ne s'applique pas sans charge proche", () => {
    const sansProche = besoin({ need: niveaux(0, { elec: 10 }), total: 10, nearW: 0,
      proches: [{ sk: "elec", lv: 3, w: 1 }] });
    expect(score([], compagnon("p", niveaux(2)), sansProche).gain).toBeCloseTo(4, 12);
  });
});

describe("scorePick : urgence (retard)", () => {
  it("multiplie le gain par 0,75 + 0,5 × pression, plafonnée à 2", () => {
    expect(score([], elec4, elec10, { pressure: 0 }).gain).toBeCloseTo(6, 12);
    expect(score([], elec4, elec10, { pressure: 1 }).gain).toBeCloseTo(10, 12);
    expect(score([], elec4, elec10, { pressure: 2 }).gain).toBeCloseTo(14, 12);
    expect(score([], elec4, elec10, { pressure: 3 }).gain).toBeCloseTo(14, 12);
  });

  it("ne dit « retard » qu'au-dessus de 1,2", () => {
    expect(score([], elec4, elec10, { pressure: 1.2 }).gain).toBeCloseTo(10.8, 12);
    expect(types([], elec4, elec10, { pressure: 1.2 })).toEqual(["sk"]);
    expect(types([], elec4, elec10, { pressure: 1.21 })).toEqual(["sk", "retard"]);
  });

  it("ne touche à rien sans pression connue", () => {
    expect(score([], elec4, elec10).gain).toBe(8);
  });
});

describe("scorePick : rendements décroissants", () => {
  // Gain de polyvalence 2,1 : il ne dépend pas de l'équipe, seul le diviseur change.
  const nd = (fronts: number) => besoin({ poly: 10, total: 10, polyLarge: 10, totalLarge: 10, fronts });
  const equipe = (n: number) => Array.from({ length: n }, (_, i) => compagnon("t" + i));
  const p = compagnon("p");

  it("divise par 1 + 0,3 par équipier tant qu'il reste des fronts", () => {
    expect(score([], p, nd(10)).gain).toBeCloseTo(2.1, 12);
    expect(score(equipe(2), p, nd(10)).gain).toBeCloseTo(2.1 / 1.6, 12);
  });

  it("ajoute 0,9 par homme de trop une fois les fronts pourvus", () => {
    expect(score(equipe(1), p, nd(1)).gain).toBeCloseTo(2.1 / 2.2, 12);   // trop = 1
    expect(score(equipe(2), p, nd(2)).gain).toBeCloseTo(2.1 / 2.5, 12);   // trop = 1
    expect(score(equipe(3), p, nd(2)).gain).toBeCloseTo(2.1 / 3.7, 12);   // trop = 2
  });

  it("compte des fronts à zéro pour un", () => {
    for (const n of [0, 1, 2]) expect(score(equipe(n), p, nd(0))).toEqual(score(equipe(n), p, nd(1)));
  });
});

describe("scorePick : horizon élargi des surnuméraires", () => {
  // Rien à faire à l'étape en cours pour un électricien ; 10 jh plus loin.
  const nd = besoin({ large: niveaux(0, { elec: 10 }), totalLarge: 10, fronts: 1 });
  const t = compagnon("t", { elec: 1 });

  it("regarde le besoin franc tant que les fronts ne sont pas pourvus", () => {
    expect(score([], elec4, nd)).toEqual({ gain: 0, why: [] });
  });

  it("bascule sur l'horizon élargi dès que l'équipe atteint le nombre de fronts", () => {
    // 10 × (4 − 1) / 5 = 6, / (1 + 0,3 + 0,9)
    const r = score([t], elec4, nd);
    expect(r.gain).toBeCloseTo(6 / 2.2, 12);
    expect(r.why).toEqual([{ type: "sk", k: "elec", lv: 4 }]);
  });

  it("prend aussi la main-d'oeuvre de l'horizon élargi", () => {
    const r = score([compagnon("t")], compagnon("p"), besoin({ polyLarge: 10, totalLarge: 10, fronts: 1 }));
    expect(r.gain).toBeCloseTo(2.1 / 2.2, 12);
    expect(r.why).toEqual([{ type: "poly" }]);
  });

  it("reste coupé s'il ne peut rien prendre aujourd'hui : « rien » regarde toujours l'étape proche", () => {
    const proche = { ...nd, nearW: 1, proches: [{ sk: "platre" as const, lv: 3, w: 1 }] };
    const r = score([t], compagnon("p", { elec: 4, platre: 2 }), proche);
    expect(r.gain).toBeCloseTo(6 * 0.05 / 2.2, 12);
    expect(r.why.map(w => w.type)).toEqual(["sk", "rien"]);
  });
});

describe("scorePick : assemblage", () => {
  it("empile les raisons dans un ordre fixe : métiers, poly, permis, suite, retard", () => {
    const nd = besoin({ need: niveaux(0, { elec: 10, plomb: 10 }), req: niveaux(0, { plomb: 4 }),
      total: 20, permis: true });
    const p = compagnon("p", { elec: 4, plomb: 4 }, { permis: true });
    // (8) + (8 + 6,8) + (20 × 0,07 + 0,4) = 24,6 ; × 1,25 ; × (0,75 + 0,75)
    const r = score([], p, nd, { wasYesterday: true, pressure: 1.5 });
    expect(r.gain).toBeCloseTo(24.6 * 1.25 * 1.5, 10);
    expect(r.why).toEqual([
      { type: "sk", k: "elec", lv: 4 }, { type: "gate", k: "plomb", lv: 4 },
      { type: "permis" }, { type: "suite" }, { type: "retard" }
    ]);
  });

  it("calcule lui-même le besoin du chantier quand l'appelant ne le donne pas", () => {
    const s = chantier();
    const p = compagnon("p", { elec: 5 }, { permis: true });
    expect(scorePick(s, [], p)).toEqual(scorePick(s, [], p, { need: siteNeed(s) }));
    expect(scorePick(s, [], p, {})).toEqual(scorePick(s, [], p));
  });
});
