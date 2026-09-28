/* npm run measure — poids réel de chaque page, après `npm run build`.

   Ce que le navigateur télécharge à l'ouverture : le point d'entrée,
   tout ce qu'il précharge (modulepreload) et ses feuilles de style,
   compressés en gzip -9. Les imports dynamiques sont comptés à part :
   ils ne bloquent pas l'affichage.

   Depuis W4, l'application charge à la demande la source de données
   choisie (supabase, api), et chacune tire ses propres dépendances
   (supabase-js, le client Socket.IO). Chaque morceau chargé à la
   demande est donc compté avec tout ce qu'il importe à son tour, et
   détaillé : une seule source est chargée à la fois, les additionner
   n'aurait pas de sens.

   Usage : npm run measure [-- --json] [-- --dir dist]                    */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const argDir = process.argv.indexOf("--dir");
const dir = argDir > -1 ? process.argv[argDir + 1] : "apps/web/dist";
if (!existsSync(join(dir, "index.html"))) {
  console.error(`Rien à mesurer dans ${dir}/ : lance d’abord npm run build.`);
  process.exit(1);
}

const gz = (f: string): number => gzipSync(readFileSync(join(dir, f)), { level: 9 }).length;
const kb = (n: number): string => (n / 1000).toFixed(1) + " ko";

/* Les imports d'un morceau, relatifs à assets/ : statiques et dynamiques. */
function imports(f: string): { statiques: string[]; dynamiques: string[] } {
  const src = readFileSync(join(dir, f), "utf8");
  const vers = (m: RegExpMatchArray) => "assets/" + m[1];
  return {
    statiques: [...src.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)].map(vers),
    dynamiques: [...src.matchAll(/import\(\s*["']\.\/([^"']+\.js)["']\s*\)/g)].map(vers)
  };
}

/* Un morceau à la demande et tout ce qu'il charge à son tour (statique
   ou dynamique : pour sa source, tout finit par venir), hors ce qui est
   déjà là. */
function avecDependances(racine: string, deja: Set<string>): string[] {
  const vus = new Set<string>();
  const pile = [racine];
  while (pile.length) {
    const f = pile.pop()!;
    if (vus.has(f) || deja.has(f)) continue;
    vus.add(f);
    const i = imports(f);
    pile.push(...i.statiques, ...i.dynamiques);
  }
  return [...vus];
}

interface Paquet { nom: string; poids: number }
interface Entry { page: string; js: number; css: number; lazy: Paquet[]; files: string[] }

function measure(page: string): Entry {
  const html = readFileSync(join(dir, page), "utf8");
  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="\/?(assets\/[^"]+)"/g)].map(m => m[1]!);
  const files = [...new Set(refs)];
  const js = files.filter(f => f.endsWith(".js")).reduce((a, f) => a + gz(f), 0);
  const css = files.filter(f => f.endsWith(".css")).reduce((a, f) => a + gz(f), 0);
  const deja = new Set(files);
  const racines = new Set(files.filter(f => f.endsWith(".js")).flatMap(f => imports(f).dynamiques).filter(f => !deja.has(f)));
  const lazy = [...racines].map(r => ({
    nom: r.replace(/^assets\//, "").replace(/-[A-Za-z0-9_-]{8}\.js$/, ""),
    poids: avecDependances(r, deja).reduce((a, f) => a + gz(f), 0)
  })).sort((a, b) => a.nom.localeCompare(b.nom));
  return { page, js, css, lazy, files };
}

const pages = readdirSync(dir).filter(f => f.endsWith(".html")).sort();
const rows = pages.map(measure);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(rows.map(r => ({ page: r.page, js: r.js, css: r.css, total: r.js + r.css, lazy: r.lazy })), null, 2));
} else {
  console.log("Page".padEnd(14) + "JS".padStart(10) + "CSS".padStart(10) + "Total".padStart(11) + "  À la demande");
  for (const r of rows)
    console.log(r.page.padEnd(14) + kb(r.js).padStart(10) + kb(r.css).padStart(10) + kb(r.js + r.css).padStart(11) + "  " +
      (r.lazy.length ? r.lazy.map(l => l.nom + " " + kb(l.poids)).join(" · ") : "—"));
}
