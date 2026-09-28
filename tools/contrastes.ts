/* npm run contrastes — le contraste de chaque couple texte / fond des
   jetons (apps/web/src/jetons.css), en clair et en sombre, contre le
   seuil AA des WCAG 2.2 : 4,5 pour un texte courant, 3 pour un grand
   texte (au moins 24 px, ou 18,7 px en gras) et pour les éléments
   graphiques qui portent un sens (bordure d'un champ, état d'une case).

   Lu dans la feuille elle-même : un jeton qui change est revérifié.

   Usage : npm run contrastes [-- --json] [-- --jetons autre.css]                                  */

import { readFileSync } from "node:fs";

const iJetons = process.argv.indexOf("--jetons");
const css = readFileSync(iJetons > -1 ? process.argv[iJetons + 1] : "apps/web/src/jetons.css", "utf8");

/* Les deux blocs de valeurs : le premier :root (clair), celui du media
   query sombre. */
function jetons(bloc: string): Record<string, string> {
  const t: Record<string, string> = {};
  for (const m of bloc.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) t[m[1]] = m[2];
  return t;
}
const iSombre = css.indexOf("prefers-color-scheme:dark");
const clair = jetons(css.slice(0, iSombre));
const sombre = { ...clair, ...jetons(css.slice(iSombre)) };

const lin = (c: number): number => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map(x => x + x).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contraste = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* Un fond teinté, comme color-mix(in srgb, <jeton> <pct>%, <base>) : le
   texte d'un badge repose sur sa propre couleur, éclaircie. S'écrit
   « jeton pct% sur base ». */
function couleur(nom: string, t: Record<string, string>): string {
  const m = /^([\w-]+) (\d+)% sur ([\w-]+)$/.exec(nom);
  if (!m) return t[nom];
  const [a, b, p] = [t[m[1]], t[m[3]], Number(m[2]) / 100];
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [ca, cb] = [rgb(a), rgb(b)];
  return "#" + ca.map((v, i) => Math.round(v * p + cb[i] * (1 - p)).toString(16).padStart(2, "0")).join("");
}

/* Les couples réellement employés par l'interface : [texte, fond, seuil]. */
const FONDS = ["ground", "surface", "surface-2"];
const couples: [string, string, number][] = [
  ...["ink", "ink-2", "muted", "blue", "accent-texte", "urgence-texte", "ok-texte", "warn-texte"]
    .flatMap(t => FONDS.map(f => [t, f, 4.5] as [string, string, number])),
  /* les teintes des métiers ne sont jamais du texte : pastilles, barres,
     jauges, qui doivent se détacher de leur fond (3:1) */
  ...["t-elec", "t-plomb", "t-platre", "t-peint", "t-menuis", "t-poly"]
    .flatMap(t => FONDS.map(f => [t, f, 3] as [string, string, number])),
  ["muted", "surface-3", 4.5], ["ink-2", "surface-3", 4.5],
  ["on-accent", "accent", 4.5], ["on-blue", "blue", 4.5], ["ground", "ink", 4.5],
  /* l'étiquette de l'étape en cours : son texte sur la teinte du métier, ou sur ok (« Chantier livré ») */
  ...["t-elec", "t-plomb", "t-platre", "t-peint", "t-menuis", "t-poly", "ok"]
    .map(f => ["on-blue", f, 4.5] as [string, string, number]),
  /* les badges : un texte sur sa propre couleur éclaircie */
  ["ok-texte", "ok 16% sur surface-2", 4.5], ["warn-texte", "warn 16% sur surface-2", 4.5],
  ["accent-texte", "accent 13% sur surface-2", 4.5], ["urgence-texte", "urgence 14% sur surface-2", 4.5],
  /* éléments graphiques qui identifient un contrôle : le contour d'un
     champ, d'un interrupteur, d'une case à cocher (les filets des cartes
     et des séparateurs sont décoratifs, et les boutons ont leur texte) */
  ["line-champ", "surface-2", 3], ["line-champ", "surface", 3], ["line-champ", "ground", 3],

  /* Les fonds mêlés d'une teinte (color-mix), avec les textes qui s'y
     posent. Relecture adversariale de W5 : l'outil ne voyait que des
     fonds unis, et le « +N » de la grille Semaine échouait. */
  // Semaine : une case pleine, de week-end, en conflit (initiales et « +N »,
  // à l'encre ink-2 : le « +N » gris y tombait à 4,2 et 4,0)
  ...["blue 16% sur surface", "blue 10% sur surface", "urgence 18% sur surface"]
    .map(f => ["ink-2", f, 4.5] as [string, string, number]),
  // les drapeaux d'une fiche (prévision) et les badges de l'équipe, sur la carte
  ["warn-texte", "warn 16% sur surface", 4.5], ["urgence-texte", "urgence 14% sur surface", 4.5],
  ["ok-texte", "ok 15% sur surface", 4.5], ["warn-texte", "warn 15% sur surface", 4.5],
  // l'étape en cours : son numéro, son nom, ses missions, son pourcentage
  ...["ink", "ink-2", "muted"].map(t => [t, "accent 7% sur surface", 4.5] as [string, string, number]),
  // le bandeau du mode local
  ["ink-2", "warn 14% sur surface", 4.5], ["warn-texte", "warn 14% sur surface", 4.5],
  // pendant un glisser : la zone survolée (et en urgence), l'îlot survolé
  ["muted", "accent 13% sur surface", 4.5], ["muted", "urgence 11% sur surface", 4.5],
  ...["ink", "ink-2", "muted"].map(t => [t, "accent 12% sur surface", 4.5] as [string, string, number]),
  // la page compagnon : un jour coché (le jour, sa date)
  ["ink", "accent 9% sur surface", 4.5], ["accent-texte", "accent 9% sur surface", 4.5]
];

const lignes = couples.map(([t, f, seuil]) => {
  const c = contraste(couleur(t, clair), couleur(f, clair)), s = contraste(couleur(t, sombre), couleur(f, sombre));
  return { texte: t, fond: f, seuil, clair: +c.toFixed(2), sombre: +s.toFixed(2), ok: c >= seuil && s >= seuil };
});

if (process.argv.includes("--json")) console.log(JSON.stringify(lignes, null, 2));
else {
  console.log("texte        fond        seuil   clair  sombre");
  for (const l of lignes)
    console.log(`${l.ok ? " " : "✗"} ${l.texte.padEnd(11)} ${l.fond.padEnd(10)} ${String(l.seuil).padStart(5)}  ${l.clair.toFixed(2).padStart(6)}  ${l.sombre.toFixed(2).padStart(6)}`);
  const ko = lignes.filter(l => !l.ok).length;
  console.log(ko ? `\n${ko} couple(s) sous le seuil AA.` : "\nTous les couples passent le seuil AA.");
}
