/* « Répartir toute l'équipe » : tous les chantiers en concurrence, jour
   par jour. Ce sont des exemples, choisis pour qu'on voie chaque règle
   agir ; les propriétés générales (jamais deux chantiers le même jour,
   etc.) sont vérifiées ailleurs, par tirage aléatoire. */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  optimizeWeek, normPerson, normSite, dayIndex, weekDates, neededHeadcount, siteNeed,
  type AvailableOn, type Person, type Site, type WeekPlan
} from "../../src/domain.ts";
import { avancement, chantier, compagnon, niveaux } from "./fabriques.ts";
import { referencePeople, referenceSites } from "../../sim/scenario.ts";

const WK = "2026-09-21";
const MARDI = "2026-09-22";
const toujours: AvailableOn = () => true;
const lundiSeul: AvailableOn = (_pid, day) => day === WK;

const VIDE: WeekPlan = { plan: {}, why: {}, gaps: [], bench: [], posed: 0, targets: [] };

/** Les affectations sous forme de clés « chantier#jour#id », comme `why`. */
function poses(r: WeekPlan): string[] {
  const out: string[] = [];
  for (const sid of Object.keys(r.plan))
    for (const day of Object.keys(r.plan[sid]))
      for (const pid of r.plan[sid][day]) out.push(sid + "#" + day + "#" + pid);
  return out.sort();
}

describe("optimizeWeek : chantiers à pourvoir", () => {
  it("rend un plan vide, banc compris, quand il n'y a aucun chantier", () => {
    // `bench` manquait autrefois dans ce retour anticipé. Il est vide même
    // si des compagnons sont disponibles : personne n'est listé au repos.
    expect(optimizeWeek([], [compagnon("a")], WK, toujours)).toEqual(VIDE);
  });

  it("rend le même plan vide quand aucun chantier n'est ouvert ou qu'ils sont finis", () => {
    const pasCommence = chantier({ id: "futur", start: "2026-10-05" });
    const fini = chantier({ id: "fini", ph: avancement(12) });
    expect(optimizeWeek([pasCommence, fini], [compagnon("a")], WK, toujours)).toEqual(VIDE);
  });

  it("pourvoit les chantiers ouverts où il reste du travail, en retard compris", () => {
    const sites = [
      chantier({ id: "neuf", start: WK }),                              // ouvre ce lundi
      chantier({ id: "futur", start: "2026-09-28" }),
      chantier({ id: "fini", ph: avancement(12) }),
      chantier({ id: "retard", start: "2026-01-05", months: 1 })        // date dépassée depuis juin
    ];
    const r = optimizeWeek(sites, [compagnon("a")], WK, toujours, { floor: 1e9 });
    expect(r.targets.map(s => s.id)).toEqual(["neuf", "retard"]);
    expect(r.targets[0]).toBe(sites[0]);                                // les objets d'origine
    expect(Object.keys(r.plan)).toEqual(["neuf", "retard"]);
  });

  it("ne pourvoit pas un chantier à qui il reste exactement 0,5 jh", () => {
    // ⚠ constat D8 — comportement actuel figé, voir docs/reconstruction/JOURNAL.md
    // forecast, neededHeadcount et pressure le tiennent pour non fini.
    const demi = chantier({ id: "demi", ph: avancement(11, { 11: 67 }),
      tasks: { "11": [true, true, false] }, coef: 0.5 });
    expect(optimizeWeek([demi], [compagnon("a")], WK, toujours).targets).toEqual([]);
  });

  it("pourvoit dès le lundi un chantier qui n'ouvre que le mercredi", () => {
    // ⚠ NOUVEAU CONSTAT — le filtre compare la semaine au lundi de la
    // semaine d'ouverture, et rien ne regarde ensuite la date d'ouverture
    // jour par jour : un compagnon est posé lundi et mardi sur un chantier
    // qui ouvre le mercredi 23. Comportement actuel figé.
    const mercredi = chantier({ id: "mer", start: "2026-09-23" });
    const r = optimizeWeek([mercredi], [compagnon("x")], WK, (_p, d) => d <= MARDI);
    expect(r.plan.mer).toEqual({ [WK]: ["x"], [MARDI]: ["x"] });
  });
});

describe("optimizeWeek : plafond par chantier", () => {
  const huit = Array.from({ length: 8 }, (_, i) => compagnon("p" + i));

  it("pose au plus l'effectif nécessaire plus un", () => {
    // Chantier neuf de deux mois : 3 personnes nécessaires, 6 fronts. Plafond 4.
    const neuf = chantier({ id: "neuf", start: WK });
    expect(neededHeadcount(neuf, WK)).toBe(3);
    const r = optimizeWeek([neuf], huit, WK, toujours, { floor: 0 });
    expect(weekDates(WK).map(d => r.plan.neuf[d].length)).toEqual([4, 4, 4, 4, 4, 4, 4]);
    expect(r.posed).toBe(28);
    expect(r.bench).toHaveLength(28);
  });

  it("pose au plus un de plus que les fronts ouverts", () => {
    // Étape Plâtre : une mission en cours et deux à demi → 2 fronts, plafond 3,
    // bien que l'effectif nécessaire (3) en autoriserait 4.
    const platre = chantier({ id: "pl", start: WK, ph: avancement(3) });
    expect(siteNeed(platre).fronts).toBe(2);
    expect(neededHeadcount(platre, WK)).toBe(3);
    const r = optimizeWeek([platre], huit, WK, lundiSeul, { floor: 0 });
    expect(r.plan.pl[WK]).toHaveLength(3);
  });
});

describe("optimizeWeek : plancher", () => {
  const platre = chantier({ id: "pl", start: WK, ph: avancement(3) });
  // Un confirmé et six novices incapables de toute mission de plâtrerie.
  const equipe = [compagnon("conf"), ...Array.from({ length: 6 }, (_, i) => compagnon("n" + i, niveaux(1)))];

  it("laisse au banc, par défaut, ceux qui n'apporteraient presque rien", () => {
    const r = optimizeWeek([platre], equipe, WK, lundiSeul);
    expect(r.plan.pl[WK]).toEqual(["conf"]);
    expect(r.bench.map(b => b.pid)).toEqual(["n0", "n1", "n2", "n3", "n4", "n5"]);
    // Le plancher par défaut vaut 0,3.
    expect(optimizeWeek([platre], equipe, WK, lundiSeul, { floor: 0.3 })).toEqual(r);
  });

  it("à zéro, pose jusqu'au plafond, même qui n'a rien à prendre", () => {
    const r = optimizeWeek([platre], equipe, WK, lundiSeul, { floor: 0 });
    expect(r.plan.pl[WK]).toEqual(["conf", "n0", "n1"]);
    expect(r.why["pl#" + WK + "#n0"].map(w => w.type)).toEqual(["poly", "encadre", "rien"]);
  });

  it("très haut, ne pose personne : le chantier reste au plan, vide", () => {
    const r = optimizeWeek([platre], equipe, WK, lundiSeul, { floor: 1e9 });
    expect(r.plan).toEqual({ pl: {} });
    expect(r.posed).toBe(0);
    expect(r.why).toEqual({});
    expect(r.gaps).toEqual([]);
    expect(r.bench).toHaveLength(7);
  });
});

describe("optimizeWeek : banc, décompte et raisons", () => {
  const neuf = chantier({ id: "neuf", start: WK });
  const people = [compagnon("a"), compagnon("b"), compagnon("c")];
  // a toute la semaine, b le lundi, c jamais.
  const dispo: AvailableOn = (pid, day) => pid === "a" || (pid === "b" && day === WK);

  it("met au banc chaque journée disponible non employée, jour par jour", () => {
    const r = optimizeWeek([neuf], people, WK, dispo, { floor: 1e9 });
    expect(r.bench).toEqual([
      { day: WK, pid: "a" }, { day: WK, pid: "b" },
      ...weekDates(WK).slice(1).map(day => ({ day, pid: "a" }))
    ]);
  });

  it("n'écrit rien un jour où personne n'est disponible", () => {
    const r = optimizeWeek([neuf], people, WK, (pid, day) => pid === "a" && day === MARDI);
    expect(Object.keys(r.plan.neuf)).toEqual([MARDI]);
    expect(r.bench).toEqual([]);
  });

  it("compte dans `posed` chaque journée posée", () => {
    const r = optimizeWeek([neuf], people, WK, dispo);
    expect(r.posed).toBe(poses(r).length);
    expect(r.posed).toBe(8);                        // a sept jours, b le lundi
  });

  it("donne une raison à chaque journée posée, sous la clé chantier#jour#id", () => {
    // Un seul chantier : pas d'échange possible, les raisons restent justes.
    const r = optimizeWeek([neuf], people, WK, dispo);
    expect(Object.keys(r.why).sort()).toEqual(poses(r));
    expect(r.why["neuf#" + WK + "#a"].length).toBeGreaterThan(0);
  });

  it("ne modifie pas les chantiers qu'on lui passe", () => {
    const s = chantier({ id: "neuf", start: WK, plan: { "2026-09-20": ["a"] } });
    const avant = JSON.stringify(s);
    optimizeWeek([s], people, WK, dispo);
    expect(JSON.stringify(s)).toBe(avant);
  });
});

describe("optimizeWeek : concurrence entre chantiers", () => {
  // Un chantier à l'étape Élec, l'autre à l'étape Plomberie.
  const elec = chantier({ id: "A", start: WK, ph: avancement(4) });
  const plomb = chantier({ id: "B", start: WK, ph: avancement(6) });
  const electricien = compagnon("E", { elec: 5, plomb: 2, platre: 2, peint: 2, menuis: 2 });
  const plombier = compagnon("P", { elec: 2, plomb: 5, platre: 2, peint: 2, menuis: 2 });

  it("envoie chacun là où son métier se joue, quel que soit l'ordre des listes", () => {
    for (const [sites, people] of [
      [[elec, plomb], [plombier, electricien]],
      [[plomb, elec], [electricien, plombier]]
    ] as [Site[], Person[]][]) {
      const r = optimizeWeek(sites, people, WK, lundiSeul);
      expect(r.plan.A[WK]).toEqual(["E"]);
      expect(r.plan.B[WK]).toEqual(["P"]);
      expect(r.why["A#" + WK + "#E"]).toContainEqual({ type: "gate", k: "elec", lv: 3 });
      expect(r.why["B#" + WK + "#P"]).toContainEqual({ type: "gate", k: "plomb", lv: 4 });
    }
  });
});

describe("optimizeWeek : trous de couverture", () => {
  const deux = [compagnon("a", niveaux(2)), compagnon("b", niveaux(2))];

  it("signale un métier proche que l'équipe du jour n'atteint pas", () => {
    // Chantier neuf : les saignées exigent un électricien 3 et un plâtrier 2.
    const g = chantier({ id: "g", start: WK });
    const r = optimizeWeek([g], deux, WK, lundiSeul);
    expect(r.plan.g[WK]).toEqual(["a", "b"]);
    expect(r.gaps).toEqual([{ site: g, day: WK, sk: "elec", need: 3, have: 2 }]);
  });

  it("tait un métier qui pèse moins de 8 % du besoin, même non couvert", () => {
    // Cuisine en cours, retouches de peinture presque faites (niveau 3 exigé,
    // 0,12 jh sur 10,24) : seul le menuisier 5 manque vraiment.
    const cuisine = chantier({ id: "cu", ph: avancement(10, { 11: 90 }) });
    expect(siteNeed(cuisine).soon.peint).toBe(3);
    const r = optimizeWeek([cuisine], deux, WK, lundiSeul);
    expect(r.gaps.map(g => [g.sk, g.need, g.have])).toEqual([["menuis", 5, 2]]);
  });

  it("ne dit rien d'un chantier où personne n'est posé", () => {
    const g = chantier({ id: "g", start: WK });
    expect(optimizeWeek([g], deux, WK, lundiSeul, { floor: 1e9 }).gaps).toEqual([]);
  });
});

describe("optimizeWeek : continuité", () => {
  const x = compagnon("x");

  it("ne compte pas la continuité le lundi, même si la personne était là dimanche", () => {
    const s = chantier({ id: "c", plan: { "2026-09-20": ["x"] } });
    const r = optimizeWeek([s], [x], WK, (_p, d) => d <= MARDI);
    expect(r.why["c#" + WK + "#x"]).not.toContainEqual({ type: "suite" });
    // Le mardi, elle reprend l'équipe qu'optimizeWeek vient de poser lundi.
    expect(r.why["c#" + MARDI + "#x"]).toContainEqual({ type: "suite" });
  });

  it("compte aussi l'équipe déjà inscrite au plan du chantier la veille", () => {
    // x n'est pas disponible lundi, mais le plan existant l'y pose.
    const s = chantier({ id: "c", plan: { [WK]: ["x"] } });
    const r = optimizeWeek([s], [x], WK, (_p, d) => d === MARDI);
    expect(r.why["c#" + MARDI + "#x"]).toContainEqual({ type: "suite" });
  });
});

describe("optimizeWeek sur l'effectif de départ", () => {
  const raw = JSON.parse(readFileSync(
    new URL("../../sim/effectif-reference.json", import.meta.url), "utf8")) as {
      people: (Partial<Person> & { id: string })[];
      sites: (Partial<Site> & { id: string })[];
    };
  const people = raw.people.map(o => normPerson(o.id, o));
  const sites = raw.sites.map(o => normSite(o.id, o));
  const habituels: AvailableOn = (pid, day) =>
    !!people.find(p => p.id === pid)?.days[dayIndex(day)];
  const r = optimizeWeek(sites, people, "2026-08-31", habituels);

  it("pose 45 journées, sans personne au banc, au plus quatre par chantier et par jour", () => {
    expect(r.posed).toBe(45);
    expect(r.bench).toEqual([]);
    for (const sid of Object.keys(r.plan))
      for (const day of Object.keys(r.plan[sid])) expect(r.plan[sid][day].length).toBeLessThanOrEqual(4);
  });

  it("garde à chaque personne posée sa raison, après la passe d'échanges", () => {
    // Constat D1, corrigé : les raisons restaient attachées au choix du
    // glouton, et l'échange déplaçait la personne sans sa raison. Sur cet
    // effectif, 4 journées posées n'avaient aucune raison, et 4 raisons
    // désignaient une affectation disparue.
    const posees = poses(r);
    const raisons = Object.keys(r.why).sort();
    expect(posees.filter(k => !raisons.includes(k))).toEqual([]);
    expect(raisons.filter(k => !posees.includes(k))).toEqual([]);
  });

  it("casse par échange des équipes que le glouton avait reconduites", () => {
    // ⚠ constat D3 — comportement actuel figé, voir docs/reconstruction/JOURNAL.md
    // Lundi, Geoffrey est sur 9MD49 et Erwan sur 30JA90. Mardi, l'échange
    // les intervertit : l'objectif de la passe d'échanges ignore la
    // continuité. Aucun des deux n'a donc la raison « suite » ce mardi-là.
    expect(r.plan.s_9md49["2026-08-31"]).toContain("p_geoffrey");
    expect(r.plan.s_30ja90["2026-08-31"]).toContain("p_erwan");
    expect(r.plan.s_9md49["2026-09-01"]).toContain("p_erwan");
    expect(r.plan.s_30ja90["2026-09-01"]).toContain("p_geoffrey");
    expect(r.why["s_30ja90#2026-09-01#p_geoffrey"]).not.toContainEqual({ type: "suite" });
    expect(r.why["s_9md49#2026-09-01#p_erwan"]).not.toContainEqual({ type: "suite" });
  });

  it("signale l'électricien 3 qui manque, jour après jour", () => {
    expect(r.gaps.map(g => [g.site.id, g.day, g.sk, g.need, g.have])).toEqual([
      ["s_30ja90", "2026-08-31", "elec", 3, 2],
      ["s_9md49", "2026-09-01", "elec", 3, 2],
      ["s_9md49", "2026-09-02", "elec", 3, 2],
      ["s_9md49", "2026-09-03", "elec", 3, 2],
      ["s_9md49", "2026-09-04", "elec", 3, 2],
      ["s_12ab49", "2026-09-04", "elec", 3, 1],
      ["s_30ja90", "2026-09-04", "elec", 3, 2]
    ]);
  });
});

describe("optimizeWeek — le plancher par défaut", () => {
  it("vaut 0,3 : un apport entre 0,2 et 0,3 reste au banc", () => {
    /* Relecture adversariale : passer le plancher à 0,2 n'était attrapé
       que par le golden master. Sur la semaine de référence du 14
       septembre, un plancher de 0,2 pose une journée de plus. */
    const raw = JSON.parse(readFileSync(new URL("../../sim/effectif-reference.json", import.meta.url), "utf8"));
    const people = referencePeople(raw);
    const byId = new Map(people.map(p => [p.id, p]));
    const av: AvailableOn = (pid, d) => !!byId.get(pid)!.days[dayIndex(d)];
    const wk = "2026-09-14";
    const parDefaut = optimizeWeek(referenceSites(), people, wk, av);
    const a03 = optimizeWeek(referenceSites(), people, wk, av, { floor: 0.3 });
    const a02 = optimizeWeek(referenceSites(), people, wk, av, { floor: 0.2 });
    expect(parDefaut).toEqual(a03);
    expect(a02.posed).toBeGreaterThan(a03.posed);   // ici, le plancher décide
  });
});
