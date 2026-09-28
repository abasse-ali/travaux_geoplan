/* Les missions cochées et la barre d'avancement. Deux sources pour une
   même vérité : les cases (ce qui est fait) et le pourcentage de l'étape
   (ce que la barre montre). Ces tests figent qui écrit quoi, et ce que
   « reste à faire » veut dire quand les deux ne concordent pas. */

import { describe, expect, it } from "vitest";
import {
  PHASES, taskDone, taskCount, tasksTicked, setTask, setPhasePct, phaseSteps,
  eachRemaining, type Site
} from "../../src/domain.ts";
import { avancement, brut, chantier } from "./fabriques.ts";

/** [étape, mission, part restante] de chaque mission parcourue. */
function restes(s: Site): [number, number, number][] {
  const out: [number, number, number][] = [];
  eachRemaining(s, (_T, rest, i, j) => { out.push([i, j, rest]); });
  return out;
}

describe("taskDone, taskCount, tasksTicked", () => {
  it("taskCount donne le nombre de missions de l'étape", () => {
    expect(PHASES.map((_, i) => taskCount(i))).toEqual([5, 2, 3, 1, 2, 2, 2, 2, 3, 4, 2, 3]);
  });

  it("taskDone rend les cases de l'étape, ou une liste vide", () => {
    const s = chantier({ tasks: { "9": [true, false, true, false] } });
    expect(taskDone(s, 9)).toEqual([true, false, true, false]);
    expect(taskDone(s, 8)).toEqual([]);
    // Un chantier venu d'une version sans missions n'a pas de `tasks` du tout.
    expect(taskDone(brut<Site>({ ...chantier(), tasks: undefined }), 9)).toEqual([]);
  });

  it("tasksTicked compte les cases cochées", () => {
    const s = chantier({ tasks: { "9": [true, false, true, false] } });
    expect(tasksTicked(s, 9)).toBe(2);
    expect(tasksTicked(s, 3)).toBe(0);
  });
});

describe("setTask", () => {
  it("coche une mission et rend le pourcentage de l'étape", () => {
    const s = chantier();
    expect(setTask(s, 9, 1, true)).toBe(25);
    expect(s.tasks["9"]).toEqual([false, true, false, false]);
    expect(setTask(s, 9, 0, true)).toBe(50);
    expect(s.tasks["9"]).toEqual([true, true, false, false]);
  });

  it("arrondit le pourcentage d'une étape à trois missions", () => {
    const s = chantier();
    expect(setTask(s, 2, 0, true)).toBe(33);
    expect(setTask(s, 2, 1, true)).toBe(67);
    expect(setTask(s, 2, 2, true)).toBe(100);
  });

  it("ne touche PAS à l'avancement : c'est à l'appelant de l'écrire", () => {
    const s = chantier({ ph: avancement(0, { 9: 10 }) });
    setTask(s, 9, 0, true);
    expect(s.ph[9]).toBe(10);
  });

  it("retire l'étape quand tout est décoché", () => {
    const s = chantier();
    setTask(s, 9, 1, true);
    expect(setTask(s, 9, 1, false)).toBe(0);
    expect("9" in s.tasks).toBe(false);
  });

  it("travaille sur une copie : l'ancien tableau reste intact", () => {
    // L'interface compare les références pour savoir quoi redessiner.
    const avant = [true, false, false, false];
    const s = chantier({ tasks: { "9": avant } });
    setTask(s, 9, 3, true);
    expect(avant).toEqual([true, false, false, false]);
    expect(s.tasks["9"]).not.toBe(avant);
  });

  it("crée `tasks` sur un chantier qui n'en a pas", () => {
    const s = brut<Site>({ ...chantier(), tasks: undefined });
    expect(setTask(s, 3, 0, true)).toBe(100);
    expect(s.tasks).toEqual({ "3": [true] });
  });

  it("crée un tableau troué pour une mission hors bornes", () => {
    // ⚠ constat D6 — comportement actuel figé, voir docs/reconstruction/JOURNAL.md
    // L'étape 3 n'a qu'une mission ; cocher la huitième allonge le tableau
    // à huit cases dont six n'existent pas, et l'étape s'affiche à 100 %.
    const s = chantier();
    expect(setTask(s, 3, 7, true)).toBe(100);
    expect(s.tasks["3"]).toHaveLength(8);
    expect(1 in s.tasks["3"]).toBe(false);
    expect(s.tasks["3"][7]).toBe(true);
    // Un indice négatif devient une propriété du tableau, invisible au
    // décompte : l'appel est ignoré sans bruit.
    const t = chantier();
    expect(setTask(t, 9, -1, true)).toBe(0);
    expect(t.tasks).toEqual({});
  });
});

describe("setPhasePct", () => {
  it("cale la barre sur le cran le plus proche : 25 % sur deux missions font 50 %", () => {
    const s = chantier();
    expect(setPhasePct(s, 1, 25)).toBe(50);
    expect(s.tasks["1"]).toEqual([true, false]);
    expect(s.ph[1]).toBe(50);
  });

  it("arrondit au cran inférieur ou supérieur : 17 → 0 et 83 → 100", () => {
    const s = chantier();
    expect(setPhasePct(s, 1, 17)).toBe(0);
    expect(setPhasePct(s, 1, 83)).toBe(100);
    expect(s.tasks["1"]).toEqual([true, true]);
  });

  it("arrondit la demi-mission vers le haut : 50 % sur cinq missions font 60 %", () => {
    const s = chantier();
    expect(setPhasePct(s, 0, 50)).toBe(60);
    expect(s.tasks["0"]).toEqual([true, true, true, false, false]);
  });

  it("à zéro, décoche tout et retire l'étape", () => {
    const s = chantier({ tasks: { "9": [true, true, false, false] }, ph: avancement(0, { 9: 50 }) });
    expect(setPhasePct(s, 9, 0)).toBe(0);
    expect("9" in s.tasks).toBe(false);
    expect(s.ph[9]).toBe(0);
  });

  it("coche les N premières missions, quelles que soient celles qui l'étaient", () => {
    const s = chantier({ tasks: { "9": [false, false, false, true] } });
    expect(setPhasePct(s, 9, 25)).toBe(25);
    expect(s.tasks["9"]).toEqual([true, false, false, false]);
  });

  it("borne la valeur entre 0 et 100", () => {
    const s = chantier();
    expect(setPhasePct(s, 9, 150)).toBe(100);
    expect(s.tasks["9"]).toEqual([true, true, true, true]);
    expect(setPhasePct(s, 9, -10)).toBe(0);
  });

  it("une étape à mission unique ne vaut que 0 ou 100 %", () => {
    const s = chantier();
    expect(setPhasePct(s, 3, 49)).toBe(0);
    expect(setPhasePct(s, 3, 50)).toBe(100);
  });

  it("crée `tasks` sur un chantier qui n'en a pas", () => {
    const s = brut<Site>({ ...chantier(), tasks: undefined });
    expect(setPhasePct(s, 3, 100)).toBe(100);
    expect(s.tasks).toEqual({ "3": [true] });
  });

  it("écrit NaN dans l'avancement quand on lui passe NaN", () => {
    // ⚠ constat D6 — comportement actuel figé, voir docs/reconstruction/JOURNAL.md
    const s = chantier({ tasks: { "9": [true, false, false, false] } });
    expect(setPhasePct(s, 9, NaN)).toBeNaN();
    expect(s.ph[9]).toBeNaN();
    expect("9" in s.tasks).toBe(false);
  });
});

describe("phaseSteps", () => {
  it("offre un cran par mission", () => {
    expect(PHASES.map((_, i) => phaseSteps(i))).toEqual([5, 2, 3, 1, 2, 2, 2, 2, 3, 4, 2, 3]);
  });
});

describe("eachRemaining", () => {
  it("parcourt toutes les missions d'un chantier neuf, dans l'ordre, chacune entière", () => {
    const r = restes(chantier());
    expect(r).toHaveLength(31);
    expect(r.every(([, , rest]) => rest === 1)).toBe(true);
    expect(r.slice(0, 6)).toEqual([[0, 0, 1], [0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1], [1, 0, 1]]);
    expect(r[30]).toEqual([11, 2, 1]);
  });

  it("passe une étape à 100 %, même si ses cases disent le contraire", () => {
    const s = chantier({ ph: avancement(1), tasks: { "0": [true, false, false, false, false] } });
    expect(restes(s).some(([i]) => i === 0)).toBe(false);
  });

  it("avec des coches, une mission reste entière ou pas du tout, quel que soit le pourcentage", () => {
    const s = chantier({ ph: avancement(9, { 9: 90 }), tasks: { "9": [true, false, true, false] } });
    expect(restes(s).filter(([i]) => i === 9)).toEqual([[9, 1, 1], [9, 3, 1]]);
  });

  it("sans coche, applique l'avancement de l'étape uniformément à chaque mission", () => {
    // Reprise de données antérieures aux missions : seul le pourcentage existe.
    const s = chantier({ ph: avancement(8, { 8: 33 }) });
    const r = restes(s).filter(([i]) => i === 8);
    expect(r.map(([, j]) => j)).toEqual([0, 1, 2]);
    for (const [, , rest] of r) expect(rest).toBeCloseTo(0.67, 12);
  });

  it("ne rend rien d'une étape toute cochée mais pas encore à 100 %", () => {
    const s = chantier({ ph: avancement(0, { 1: 99 }), tasks: { "1": [true, true] } });
    expect(restes(s).some(([i]) => i === 1)).toBe(false);
  });

  it("ne rend rien d'un chantier fini", () => {
    expect(restes(chantier({ ph: avancement(12) }))).toEqual([]);
  });
});
