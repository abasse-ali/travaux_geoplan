/* Le prix d'un restyle (ADR-005).

   Des pièces se restylent à chaque image d'une animation : la puce qui
   glisse à sa place, l'îlot du vivier qui change de taille (une centaine
   de restyles par changement de jour), le remplissage d'une barre qui
   suit une mission cochée, le fantôme qui suit le doigt, le toast qui
   entre. Leurs classes n'emploient donc pas celles de Tailwind qui
   composent des variables déclarées (@property --tw-*) : bordure, ombre,
   graisse, interligne, transition, filtres, transformations. Le
   navigateur les résout à chaque restyle ; avec elles, W5 perdait moitié
   plus d'images que W4 sur un changement de jour. Écrites en propriétés
   directes ([border-style:solid], [box-shadow:…]), elles donnent le même
   dessin.

   Seules les classes sans variante comptent : une variante (active:,
   in-[.dragging]:, after:…) ne s'applique pas à chaque image. */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normPerson, normSite, type Person, type Site } from "@geoplan/domain";
import { puce } from "../src/ui/puce";
import Island, { type IslandProps } from "../src/ui/Island";
import Chantiers from "../src/ui/Chantiers";
import { Toasts } from "../src/ui/bits";
import { FANTOME } from "../src/ui/useDrag";
import { Vue } from "../src/donnees/vue";
import type { Actions } from "../src/ui/types";

/* Le premier chantier de l'effectif de référence (9MD49) déplié, et son
   étape en cours : sans cela, aucune barre d'étape n'est rendue. Côté
   serveur, Zustand ne lit que l'état initial du magasin ; on lui en
   donne un autre pour ce fichier. */
vi.mock("../src/ui/etat", async importOriginal => {
  const orig = await importOriginal<typeof import("../src/ui/etat")>();
  type Etat = ReturnType<typeof orig.useUi.getState>;
  const deplie = { openSite: "s_9md49", openPhase: "s_9md49#0" };
  const useUi = Object.assign(<T,>(choisir: (s: Etat) => T): T => choisir({ ...orig.useUi.getState(), ...deplie }), orig.useUi);
  return { ...orig, useUi };
});

/* Une largeur de bordure ou de contour : un nombre, ou une valeur
   arbitraire qui commence par un chiffre (pas une couleur). */
const LARGEUR = "(?:-(?:\\d+|\\[\\d[^\\]]*\\]))?";
const COMPOSEES = new RegExp("^(?:" + [
  "border(?:-[xytrblse])?" + LARGEUR, "border-(?:solid|dashed|dotted|double|hidden|none)",
  "outline" + LARGEUR, "outline-(?:solid|dashed|dotted|double|hidden|none)", "divide-.+",
  "shadow(?:-.+)?", "inset-shadow-.+", "ring(?:-.+)?", "inset-ring-.+",
  "font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)",
  "leading-.+", "tracking-.+",
  "transition(?:-.+)?", "duration-.+", "ease-.+",
  "(?:backdrop-)?(?:blur|brightness|contrast|grayscale|hue-rotate|invert|saturate|sepia|drop-shadow)(?:-.+)?",
  "backdrop-opacity-.+", "-?(?:translate|rotate|scale|skew)-.+",
  "(?:tabular|oldstyle|lining|proportional|diagonal|stacked)-nums", "ordinal", "slashed-zero",
  "content-.+", "from-.+", "via-.+", "to-.+"
].join("|") + ")$");

/* Framer Motion cherche SVGElement en rendant un élément `layout`, même
   côté serveur ; Node n'en a pas. */
(globalThis as { SVGElement?: unknown }).SVGElement ??= class {};

/* Les classes sans variante qui composent des variables déclarées. */
const composees = (classes: string): string[] =>
  classes.split(/\s+/).filter(c => c && !c.includes(":") && COMPOSEES.test(c));

const ilot = (state: IslandProps["state"]): string => renderToStaticMarkup(createElement(Island, {
  free: [], daysOf: () => [], week: "2026-09-21", dayIndex: 0,
  state, setState: () => undefined, urgence: false, setUrgence: () => undefined
}));

/* Les classes de la section #vivier et de ses visages (enfants directs). */
function classesDeLIlot(html: string): string[] {
  const section = html.match(/^<section[^>]*\bclass="([^"]*)"/);
  if (!section) throw new Error("l'îlot n'a pas été rendu : " + html.slice(0, 120));
  const visages: string[] = [];
  let profondeur = 0;
  for (const m of html.matchAll(/<(\/?)([a-z]+)([^>]*?)(\/?)>/g)) {
    if (m[1]) { profondeur--; continue; }
    if (profondeur === 1) visages.push(m[3]!.match(/\bclass="([^"]*)"/)?.[1] ?? "");
    if (!m[4] && !["br", "img", "input", "path", "circle", "line", "rect"].includes(m[2]!)) profondeur++;
  }
  return [section[1]!, ...visages];
}

/* L'écran Chantiers, rendu avec l'effectif de référence, trois compagnons
   posés par chantier le mercredi ; le premier chantier déplié, et son
   étape en cours, pour que les barres d'étape soient là. */
function chantiers(): string {
  const e = JSON.parse(readFileSync(new URL("../../../packages/domain/sim/effectif-reference.json", import.meta.url), "utf8")) as
    { people: Person[]; sites: Site[] };
  const semaine = "2026-09-21", mercredi = "2026-09-23";
  const ids = e.people.map(p => p.id);
  const vue = new Vue({
    people: e.people.map(p => normPerson(p.id, p)),
    sites: e.sites.map((s, i) => normSite(s.id, { ...s, plan: { [mercredi]: ids.slice(i * 3, i * 3 + 3) } })),
    avail: []
  });
  const act = new Proxy({}, { get: () => () => undefined }) as Actions;
  return renderToStaticMarkup(createElement(Chantiers, {
    vue, act, day: mercredi, dayIdx: 2,
    ui: { tab: "chantiers", poolState: "open", urgence: false, week: semaine, day: 2 }
  }));
}

describe("les pièces redessinées à chaque image n'emploient pas de classes composées", () => {
  it("la puce", () => {
    expect(composees(puce())).toEqual([]);
  });

  it("l'îlot et ses deux visages, déplié et replié", () => {
    for (const state of ["open", "bubble"] as const) {
      const classes = classesDeLIlot(ilot(state));
      expect(classes.length).toBeGreaterThan(1);
      for (const c of classes) expect(composees(c), `${state} : ${c}`).toEqual([]);
    }
  });

  it("les puces posées, les barres des étapes et leur échelle, sur chaque fiche", () => {
    const html = chantiers();
    const puces = [...html.matchAll(/<button\b[^>]*\bdata-pid="[^"]*"[^>]*>/g)].map(m => m[0].match(/\bclass="([^"]*)"/)?.[1] ?? "");
    const echelles = [...html.matchAll(/<div\b[^>]*\bdata-echelle[^>]*>(.*?)<\/div>/g)];
    const echelle = echelles.flatMap(m => [...m[1]!.matchAll(/<b\b[^>]*\bclass="([^"]*)"/g)].map(b => b[1]!));
    const curseurs = [...html.matchAll(/role="slider"[^>]*>(?:(?!role="slider").)*?<b\b[^>]*\bclass="([^"]*)"/g)].map(m => m[1]!);
    expect(puces.length).toBeGreaterThan(3);
    expect(echelle.length).toBeGreaterThanOrEqual(12);
    expect(curseurs).toHaveLength(12);
    for (const c of [...puces, ...echelle, ...curseurs]) expect(composees(c), c).toEqual([]);
  });

  it("le fantôme qui suit le doigt, le toast qui entre", () => {
    expect(composees(FANTOME)).toEqual([]);
    const html = renderToStaticMarkup(createElement(Toasts, { items: [{ id: "t", html: "<b>Nixon</b> posé" }] }));
    const toast = html.match(/<[a-z]+\b[^>]*\bdata-toast\b[^>]*>/)?.[0].match(/\bclass="([^"]*)"/)?.[1];
    expect(toast).toBeTruthy();
    expect(composees(toast!)).toEqual([]);
  });

  it("le détecteur reconnaît ce qu'il doit refuser", () => {
    expect(composees("flex border shadow-carte font-semibold transition-opacity duration-[.2s] backdrop-blur-[10px]"))
      .toEqual(["border", "shadow-carte", "font-semibold", "transition-opacity", "duration-[.2s]", "backdrop-blur-[10px]"]);
    // Relecture adversariale de W5 : ces quatre-là passaient.
    expect(composees("border-[1.5px] outline-[1.5px] border-dashed border-l-[3px]"))
      .toEqual(["border-[1.5px]", "outline-[1.5px]", "border-dashed", "border-l-[3px]"]);
    expect(composees("border-line-2 border-[color-mix(in_srgb,var(--ink)_9%,transparent)] outline-offset-[1.5px]"
      + " [border-style:solid] in-[.dragging]:border-dashed active:[transform:scale(.97)] after:-inset-[3px]"))
      .toEqual([]);
  });
});
