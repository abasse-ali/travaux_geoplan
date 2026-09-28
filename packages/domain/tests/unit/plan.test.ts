/* Lecture et écriture du plan journalier, et les petits indicateurs
   qu'on en tire. Le plan est indexé par date ISO : une journée vide
   n'existe pas, une semaine se lit du lundi au dimanche. */

import { describe, expect, it } from "vitest";
import {
  teamOn, setTeamOn, weekRoster, daysOnSite, dispoOf, avgLv, siteProgress,
  currentPhase, span, isActive, type Site
} from "../../src/domain.ts";
import { avancement, brut, chantier, compagnon } from "./fabriques.ts";

const WK = "2026-09-21";

describe("teamOn", () => {
  it("rend l'équipe du jour, ou personne", () => {
    const s = chantier({ plan: { [WK]: ["p_a", "p_b"] } });
    expect(teamOn(s, WK)).toEqual(["p_a", "p_b"]);
    expect(teamOn(s, "2026-09-22")).toEqual([]);
    expect(teamOn(brut<Site>({ ...chantier(), plan: undefined }), WK)).toEqual([]);
  });
});

describe("setTeamOn", () => {
  it("écrit l'équipe du jour sans doublon, dans l'ordre d'arrivée", () => {
    const s = chantier();
    setTeamOn(s, WK, ["p_b", "p_a", "p_b"]);
    expect(s.plan[WK]).toEqual(["p_b", "p_a"]);
  });

  it("fait disparaître du plan une journée vidée", () => {
    const s = chantier({ plan: { [WK]: ["p_a"] } });
    setTeamOn(s, WK, []);
    expect(WK in s.plan).toBe(false);
  });

  it("ne garde pas la liste passée en argument", () => {
    const s = chantier();
    const ids = ["p_a"];
    setTeamOn(s, WK, ids);
    ids.push("p_z");
    expect(s.plan[WK]).toEqual(["p_a"]);
  });

  it("crée le plan d'un chantier qui n'en a pas", () => {
    const s = brut<Site>({ ...chantier(), plan: undefined });
    setTeamOn(s, WK, ["p_a"]);
    expect(s.plan).toEqual({ [WK]: ["p_a"] });
  });
});

describe("weekRoster et daysOnSite", () => {
  const s = chantier({
    plan: {
      "2026-09-20": ["p_avant"],                  // dimanche de la semaine d'avant
      "2026-09-21": ["p_a", "p_b"],
      "2026-09-23": ["p_b", "p_c"],
      "2026-09-27": ["p_d"],                      // dimanche : la semaine a sept jours
      "2026-09-28": ["p_apres"]
    }
  });

  it("weekRoster liste qui passe sur le chantier dans la semaine, par ordre d'apparition", () => {
    expect(weekRoster(s, WK)).toEqual(["p_a", "p_b", "p_c", "p_d"]);
    expect(weekRoster(s, "2026-10-05")).toEqual([]);
  });

  it("daysOnSite donne les sept cases d'un compagnon", () => {
    expect(daysOnSite(s, "p_b", WK)).toEqual([true, false, true, false, false, false, false]);
    expect(daysOnSite(s, "p_d", WK)).toEqual([false, false, false, false, false, false, true]);
    expect(daysOnSite(s, "p_x", WK)).toEqual([false, false, false, false, false, false, false]);
  });
});

describe("dispoOf et avgLv", () => {
  it("dispoOf compte les jours habituels", () => {
    expect(dispoOf(compagnon("p"))).toBe(5);
    expect(dispoOf(compagnon("p", {}, { days: [true, true, true, false, false, false, false] }))).toBe(3);
  });

  it("avgLv fait la moyenne des cinq métiers", () => {
    expect(avgLv(compagnon("p", { elec: 5, plomb: 2, platre: 4, peint: 4, menuis: 3 }))).toBeCloseTo(3.6, 12);
    expect(avgLv(compagnon("p", { elec: 1, plomb: 1, platre: 1, peint: 1, menuis: 1 }))).toBe(1);
  });
});

describe("siteProgress", () => {
  it("fait la moyenne arrondie des douze étapes, sans les pondérer par leur charge", () => {
    expect(siteProgress(chantier())).toBe(0);
    expect(siteProgress(chantier({ ph: avancement(0, { 0: 100, 1: 50 }) }))).toBe(13);   // 150 / 12 = 12,5
    expect(siteProgress(chantier({ ph: avancement(3) }))).toBe(25);
    expect(siteProgress(chantier({ ph: avancement(12) }))).toBe(100);
  });
});

describe("currentPhase", () => {
  it("désigne la première étape qui n'est pas à 100 %", () => {
    expect(currentPhase(chantier())).toBe(0);
    expect(currentPhase(chantier({ ph: avancement(3, { 3: 50 }) }))).toBe(3);
    // Une étape non finie en tête l'emporte sur celles qui suivent, même finies.
    expect(currentPhase(chantier({ ph: [0, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0] }))).toBe(0);
  });

  it("reste sur la finition quand tout est à 100 % : fini et en finition se confondent", () => {
    expect(currentPhase(chantier({ ph: avancement(12) }))).toBe(11);
    expect(currentPhase(chantier({ ph: avancement(11) }))).toBe(11);
  });
});

describe("span et isActive", () => {
  it("span va du lundi du début au lundi de la semaine de fin annoncée", () => {
    expect(span(chantier({ start: "2026-08-31", months: 2 })))
      .toEqual({ first: "2026-08-31", last: "2026-10-26" });
    expect(span(chantier({ start: "2026-09-02", months: 1 })))
      .toEqual({ first: "2026-08-31", last: "2026-09-28" });
  });

  it("span d'un chantier ouvert un 31 déborde d'une semaine", () => {
    // ⚠ constat D5 — comportement actuel figé, voir docs/reconstruction/JOURNAL.md
    // 31 janvier + 1 mois = 3 mars : la dernière semaine est celle du 2 mars
    // au lieu de celle du 23 février.
    expect(span(chantier({ start: "2026-01-31", months: 1 })).last).toBe("2026-03-02");
  });

  it("isActive inclut la première et la dernière semaine", () => {
    const s = chantier({ start: "2026-08-31", months: 2 });
    expect(isActive(s, "2026-08-24")).toBe(false);
    expect(isActive(s, "2026-08-31")).toBe(true);
    expect(isActive(s, "2026-10-26")).toBe(true);
    expect(isActive(s, "2026-11-02")).toBe(false);
  });
});
