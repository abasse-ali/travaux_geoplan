/* npm run verifier-css — quatre garde-fous de W5, après `npm run build`.

   1. Aucune classe de la couche « etats » (etats.css : ce que le glisser
      pose hors de React ; pendant la migration, l'ancienne feuille) ne
      porte le nom d'une classe de Tailwind. Tailwind fabrique ses classes à
      partir de tous les mots du code source : un élément qui s'appelle
      encore « grid » recevrait `display:grid` par-dessus sa règle, qui
      perdrait (la couche des classes passe après). Premier cas trouvé :
      la grille de compétences de l'écran Équipe.
   2. Aucune animation définie deux fois. Tailwind garde ses propres
      @keyframes (pulse, spin…) dès qu'une feuille cite leur nom, hors
      de toute couche : ils écrasaient en silence ceux de l'ancienne
      feuille — le point d'état aurait clignoté autrement.
   3. Aucune classe de la couche « etats » que plus rien n'utilise : son
      nom n'apparaît dans aucune chaîne du code de src/. Du CSS mort.
   4. Aucune classe de Tailwind qu'aucune chaîne n'écrit : Tailwind en
      fabrique aussi à partir des commentaires et du texte (le mot
      « invisible » d'un commentaire donnait `.invisible`). Du CSS mort
      aussi.
   Les chaînes, pas les mots : un identifiant (`ghost`) ou un mot de
   commentaire ne compte pas comme un usage.

   Usage : npm run verifier-css [-- --dir apps/web/dist]                */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { parseAst } from "rollup/parseAst";

const argDir = process.argv.indexOf("--dir");
const dir = argDir > -1 ? process.argv[argDir + 1] : "apps/web/dist";
const src = "apps/web/src";
if (!existsSync(join(dir, "assets"))) {
  console.error(`Rien à vérifier dans ${dir}/ : lance d’abord npm run build.`);
  process.exit(1);
}

/* Une construction plus ancienne que les sources vérifierait autre chose
   que le code : refusé. En W6, un « ✓ » a porté sur la construction de
   la veille. */
const plusRecent = (d: string): number => readdirSync(d).reduce((m, n) => {
  const p = join(d, n), s = statSync(p);
  return Math.max(m, s.isDirectory() ? plusRecent(p) : /\.(tsx?|css|html)$/.test(n) ? s.mtimeMs : 0);
}, 0);
const sources = Math.max(plusRecent(src),
  ...readdirSync("apps/web").filter(f => f.endsWith(".html")).map(f => statSync(join("apps/web", f)).mtimeMs));
const construite = Math.min(...readdirSync(join(dir, "assets")).filter(f => f.endsWith(".css"))
  .map(f => statSync(join(dir, "assets", f)).mtimeMs));
if (construite < sources) {
  console.error(`La construction de ${dir}/ est plus ancienne que les sources : lance d’abord npm run build.`);
  process.exit(1);
}

/* Le contenu de chaque bloc `@layer nom{…}` d'une feuille minifiée. */
function couche(css: string, nom: string): string {
  let out = "";
  const ouverture = `@layer ${nom}{`;
  for (let i = css.indexOf(ouverture); i > -1; i = css.indexOf(ouverture, i + 1)) {
    let prof = 1, j = i + ouverture.length;
    for (; j < css.length && prof > 0; j++) {
      if (css[j] === "{") prof++;
      else if (css[j] === "}") prof--;
    }
    out += css.slice(i + ouverture.length, j - 1) + "\n";
  }
  return out;
}

/* Les noms de classe des sélecteurs d'un bloc (pas des déclarations ni
   des étapes d'une animation), déséchappés : `.p-2\.25` → `p-2.25`.
   `enTete` : seulement la classe qui ouvre chaque sélecteur — pour les
   classes de Tailwind, leur nom propre. Une classe qui en CITE une autre
   (`in-[.dragging]:overflow-hidden`, dont le sélecteur contient
   `.dragging`) ne fabrique pas pour autant une classe « dragging ». */
function classes(bloc: string, enTete = false): Set<string> {
  const noms = new Set<string>();
  const selecteurs = [...bloc.matchAll(/(?:^|[{};])([^{};]+)\{/g)].map(m => m[1].trim())
    .filter(s => !s.startsWith("@"));
  const nom = (brut: string) => { if (/^-?[_a-zA-Z]/.test(brut)) noms.add(brut.replace(/\\(.)/g, "$1")); };
  for (const s of selecteurs) {
    if (enTete) {
      // Pas aux virgules échappées d'une valeur : .bg-\[color-mix\(a\,b\)\]
      for (const partie of s.split(/(?<!\\),/)) {
        const m = /^\s*\.((?:\\.|[\w-])+)/.exec(partie);
        if (m) nom(m[1]);
      }
    } else for (const m of s.matchAll(/\.((?:\\.|[\w-])+)/g)) nom(m[1]);
  }
  return noms;
}

function fichiers(d: string): string[] {
  return readdirSync(d).flatMap(n => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? fichiers(p) : /\.(tsx?|html)$/.test(n) ? [p] : [];
  });
}

/* Les mots que le code écrit dans ses chaînes : chaque chaîne et chaque
   morceau de gabarit, découpés aux espaces, plus les classes d'un
   sélecteur (`closest(".chip")` → chip), plus les attributs class des
   pages HTML. Les commentaires et les identifiants n'en sont pas :
   esbuild retire types, JSX et commentaires, l'analyseur de Rollup
   relève les chaînes (TypeScript 7, natif, n'a plus d'API en JavaScript).
   Relecture adversariale de W5 : chercher les noms comme des mots
   laissait passer `.ghost` (un identifiant de useDrag) et fabriquer
   `.invisible` (un mot de commentaire). */
function motsDesChaines(): Set<string> {
  const mots = new Set<string>();
  const ajouter = (s: string) => {
    for (const m of s.split(/\s+/)) if (m) mots.add(m);
    for (const m of s.matchAll(/\.((?:\\.|[\w-])+)/g)) mots.add(m[1]!);
  };
  const marche = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const noeud = n as { type?: string; value?: unknown };
    if (noeud.type === "Literal" && typeof noeud.value === "string") ajouter(noeud.value);
    if (noeud.type === "TemplateElement") ajouter((noeud.value as { cooked?: string }).cooked ?? "");
    for (const v of Object.values(n)) marche(v);
  };
  for (const f of fichiers(src).filter(f => /\.tsx?$/.test(f))) {
    const js = transformSync(readFileSync(f, "utf8"), { loader: f.endsWith(".tsx") ? "tsx" : "ts", jsx: "automatic" }).code;
    marche(parseAst(js));
  }
  for (const f of readdirSync("apps/web").filter(f => f.endsWith(".html")))
    for (const m of readFileSync(join("apps/web", f), "utf8").matchAll(/\bclass="([^"]*)"/g)) ajouter(m[1]!);
  return mots;
}

const feuilles = readdirSync(join(dir, "assets")).filter(f => f.endsWith(".css"));
const mots = motsDesChaines();
const citee = (nom: string) => mots.has(nom);

let echecs = 0;
const mortes = new Set<string>();
const fabriquees = new Set<string>();
for (const f of feuilles) {
  const css = readFileSync(join(dir, "assets", f), "utf8");
  const anciennes = classes(couche(css, "etats"));
  const tailwind = classes(couche(css, "utilities"), true);
  const communes = [...anciennes].filter(c => tailwind.has(c));
  if (communes.length) {
    echecs++;
    console.error(`✗ ${f} : classes d'etats.css aussi fabriquées par Tailwind : ${communes.join(", ")}`);
  }
  const animations = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]);
  const doubles = animations.filter((a, i) => animations.indexOf(a) !== i);
  if (doubles.length) {
    echecs++;
    console.error(`✗ ${f} : animations définies deux fois : ${[...new Set(doubles)].join(", ")}`);
  }
  for (const c of anciennes) if (!citee(c)) mortes.add(c);
  for (const c of tailwind) if (!citee(c)) fabriquees.add(c);
  console.log(`${f} : ${anciennes.size} classes d'état (etats.css), ${tailwind.size} classes Tailwind`);
}
if (mortes.size) {
  echecs++;
  console.error(`✗ classes d'etats.css citées dans aucune chaîne de src/ : ${[...mortes].sort().join(", ")}`);
}
if (fabriquees.size) {
  echecs++;
  console.error(`✗ classes Tailwind qu'aucune chaîne de src/ n'écrit (un mot de commentaire, de texte ?) : ${[...fabriquees].sort().join(", ")}`);
}
if (echecs) process.exit(1);
console.log("✓ aucune collision, aucune animation en double, aucune classe morte ni fabriquée par mégarde");
