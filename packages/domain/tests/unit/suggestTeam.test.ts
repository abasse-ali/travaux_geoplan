/* Le bouton « Composer » d'un chantier : un glouton qui prend, tour à
   tour, le compagnon au meilleur gain, pondéré par le nombre de jours où
   il peut venir. La dernière série de tests fige la composition obtenue
   sur l'effectif réel de Geoffrey. */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  suggestTeam, scorePick, siteNeed, pressure, normPerson, normSite, neededHeadcount,
  type Person, type Site
} from "../../src/domain.ts";
import { avancement, chantier, compagnon, niveaux } from "./fabriques.ts";

const WK = "2026-08-31";
const TOUS_LES_JOURS = [true, true, true, true, true, true, true];
const ids = (r: { team: { p: Person }[] }) => r.team.map(t => t.p.id);

describe("suggestTeam", () => {
  const s = chantier();

  it("respecte la taille demandée", () => {
    const people = Array.from({ length: 5 }, (_, i) => compagnon("p" + i));
    expect(suggestTeam(s, 2, WK, people).team).toHaveLength(2);
    expect(suggestTeam(s, 0, WK, people).team).toEqual([]);
  });

  it("ne prend jamais deux fois la même personne, même si on en demande trop", () => {
    const people = [compagnon("a"), compagnon("b"), compagnon("c")];
    const r = suggestTeam(s, 10, WK, people);
    expect(new Set(ids(r)).size).toBe(ids(r).length);
    expect(ids(r).length).toBeLessThanOrEqual(3);
  });

  it("écarte qui n'a aucun jour utilisable, même le meilleur", () => {
    const star = compagnon("star", niveaux(5), { permis: true });
    const people = [star, compagnon("a"), compagnon("b")];
    expect(ids(suggestTeam(s, 3, WK, people, p => (p.id === "star" ? 0 : 5)))).not.toContain("star");
    // Sans fonction fournie, ce sont les jours habituels qui comptent.
    const absent = compagnon("star", niveaux(5), { permis: true, days: TOUS_LES_JOURS.map(() => false) });
    expect(ids(suggestTeam(s, 3, WK, [absent, compagnon("a")]))).toEqual(["a"]);
  });

  it("pondère le gain par 0,72 + 0,28 × jours / 7 et note les jours", () => {
    const a = compagnon("a");
    const b = compagnon("b", {}, { days: TOUS_LES_JOURS.slice() });
    const r = suggestTeam(s, 2, WK, [a, b]);
    // À compétences égales, celui qui vient sept jours passe devant.
    expect(ids(r)).toEqual(["b", "a"]);
    expect(r.team.map(t => t.days)).toEqual([7, 5]);
    const ctx = { need: siteNeed(s), pressure: pressure(s, WK), wasYesterday: false };
    expect(r.team[0].gain).toBeCloseTo(scorePick(s, [], b, ctx).gain * 1, 12);
    expect(r.team[1].gain).toBeCloseTo(scorePick(s, [b], a, ctx).gain * (0.72 + 0.28 * 5 / 7), 12);
    expect(r.team[1].why).toEqual(scorePick(s, [b], a, ctx).why);
  });

  it("utilise les jours rendus par usableDays, pas les jours habituels", () => {
    const r = suggestTeam(s, 1, WK, [compagnon("a")], () => 2);
    expect(r.team[0].days).toBe(2);
    const ctx = { need: siteNeed(s), pressure: pressure(s, WK), wasYesterday: false };
    expect(r.team[0].gain).toBeCloseTo(scorePick(s, [], compagnon("a"), ctx).gain * (0.72 + 0.28 * 2 / 7), 12);
  });

  it("à égalité, garde l'ordre de la liste des compagnons", () => {
    const x = compagnon("x"), y = compagnon("y");
    expect(ids(suggestTeam(s, 1, WK, [x, y]))).toEqual(["x"]);
    expect(ids(suggestTeam(s, 1, WK, [y, x]))).toEqual(["y"]);
  });

  it("fait passer devant qui était là la veille", () => {
    const x = compagnon("x"), y = compagnon("y");
    const r = suggestTeam(s, 1, WK, [x, y], null, p => p.id === "y");
    expect(ids(r)).toEqual(["y"]);
    expect(r.team[0].why).toContainEqual({ type: "suite" });
  });

  it("s'arrête quand plus personne n'apporte plus de 0,0001", () => {
    // Chantier fini : besoin nul, tous les gains sont nuls.
    const r = suggestTeam(chantier({ ph: avancement(12) }), 3, WK, [compagnon("a"), compagnon("b")]);
    expect(r.team).toEqual([]);
    expect(r.need.total).toBe(0);
  });

  it("rend aussi le besoin du chantier, tel que siteNeed le calcule", () => {
    expect(suggestTeam(s, 1, WK, [compagnon("a")]).need).toEqual(siteNeed(s));
  });

  it("ne touche ni au chantier ni à la liste des compagnons", () => {
    const people = [compagnon("a"), compagnon("b")];
    const avant = JSON.stringify({ s, people });
    suggestTeam(s, 2, WK, people);
    expect(JSON.stringify({ s, people })).toBe(avant);
  });
});

describe("suggestTeam sur l'effectif réel", () => {
  const raw = JSON.parse(readFileSync(
    new URL("../../sim/effectif-reference.json", import.meta.url), "utf8")) as {
      people: (Partial<Person> & { id: string })[];
      sites: (Partial<Site> & { id: string })[];
    };
  const people = raw.people.map(o => normPerson(o.id, o));
  const site = (() => {
    const o = raw.sites.find(x => x.id === "s_9md49");
    if (!o) throw new Error("s_9md49 absent de l'effectif de référence");
    return normSite(o.id, o);
  })();
  const r = suggestTeam(site, 4, "2026-08-31", people);

  it("compose 9MD49 avec Geoffrey, Morgan, Quentin et Erwan", () => {
    expect(r.team.map(t => t.p.name)).toEqual(["Geoffrey", "Morgan", "Quentin", "Erwan"]);
    expect(r.team.map(t => t.days)).toEqual([4, 4, 3, 4]);
  });

  it("garde les gains de référence", () => {
    const gains = r.team.map(t => t.gain);
    expect(gains[0]).toBeCloseTo(17.401371312170298, 9);
    expect(gains[1]).toBeCloseTo(4.27297154644993, 9);
    expect(gains[2]).toBeCloseTo(2.192560429473835, 9);
    expect(gains[3]).toBeCloseTo(1.3059718629457029, 9);
  });

  it("garde les raisons de référence", () => {
    expect(r.team.map(t => t.why)).toEqual([
      [{ type: "gate", k: "elec", lv: 4 }, { type: "gate", k: "platre", lv: 4 },
       { type: "gate", k: "peint", lv: 3 }, { type: "permis" }, { type: "retard" }],
      [{ type: "gate", k: "plomb", lv: 4 }, { type: "poly" }, { type: "retard" }],
      // ⚠ constat D2 — « débloque menuiserie 5 » sur un chantier en démolition.
      [{ type: "gate", k: "menuis", lv: 5 }, { type: "poly" }, { type: "retard" }],
      [{ type: "poly" }, { type: "retard" }]
    ]);
  });

  it("dit « retard » d'un chantier qui ouvre cette semaine, dans les temps", () => {
    // ⚠ NOUVEAU CONSTAT — la pression prend pour référence un binôme
    // (2 × 4,6 jh par semaine). Un T2/T3 de 114 jh sur deux mois en demande
    // 12,7 : il est « en retard » dès son premier jour, alors que
    // neededHeadcount le juge tenable à trois. Le mot affiché à Geoffrey
    // est trompeur ; le poids donné à l'urgence, lui, est voulu.
    // Comportement actuel figé.
    expect(site.start).toBe("2026-08-31");
    expect(pressure(site, "2026-08-31")).toBeGreaterThan(1.2);
    expect(neededHeadcount(site, "2026-08-31")).toBe(3);
  });
});
