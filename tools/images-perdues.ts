/* ============================================================
   npm run images-perdues -- --a <dossier> --b <dossier> [--n 50]

   Le protocole de mesure de la reconstruction (section 7) : les images
   perdues par geste, en A/B ALTERNÉ dans la même session de navigateur,
   processeur bridé ×4. Jamais une mesure isolée d'une version contre une
   mesure isolée d'une autre : le bruit entre deux sessions dépasse les
   effets recherchés.

   Les deux dossiers sont des constructions de l'application en mode
   local (npx vite build --config e2e/vite.config.ts). Chacune est servie
   sur son port ; une seule instance de Chromium les ouvre dans deux
   onglets, amorcés du même effectif, et joue chaque geste tour à tour
   dans A puis dans B.

   Pour chaque geste, un enregistreur requestAnimationFrame relève les
   intervalles entre images pendant 100 ms avant et 700 ms après : une
   image perdue, c'est un intervalle qui en couvre plus d'une (seuil
   16,7 ms). On rapporte la moyenne d'images perdues par geste, et la
   pire image.

   Chromium, parce que seul lui sait brider le processeur (CDP) : WebKit
   sous Windows ne dit rien d'un iPhone de toute façon, et c'est l'écart
   entre A et B qui compte, pas la valeur absolue.
   ============================================================ */

import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium, devices, type Page } from "@playwright/test";

const arg = (nom: string, defaut?: string): string => {
  const i = process.argv.indexOf("--" + nom);
  if (i > -1 && process.argv[i + 1]) return process.argv[i + 1]!;
  if (defaut === undefined) { console.error(`--${nom} manquant`); process.exit(2); }
  return defaut;
};
const DOSSIERS = { A: resolve(arg("a")), B: resolve(arg("b")) };
const N = Number(arg("n", "50"));
const BRIDAGE = Number(arg("bridage", "4"));
const GESTES = arg("gestes", "jour,onglet,mission").split(",");

const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml"
};

function servir(dossier: string, hote: string, port: number): Promise<Server> {
  const s = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url || "/").split("?")[0]!);
    let f = join(dossier, chemin);
    if (!existsSync(f) || statSync(f).isDirectory()) f = join(dossier, "index.html");
    res.setHeader("content-type", TYPES[extname(f)] ?? "application/octet-stream");
    res.end(readFileSync(f));
  });
  return new Promise(ok => s.listen(port, hote, () => ok(s)));
}

/* L'effectif de référence, avec des équipes posées cette semaine : des
   fiches pleines, comme un jour ordinaire.

   La semaine est la VRAIE semaine en cours. Figer l'heure avec
   page.clock aurait été plus simple, mais l'horloge de Playwright
   remplace aussi les minuteries et requestAnimationFrame par les
   siennes : on mesurait alors des images simulées, dont la cadence
   dépendait des minuteries factices. C'est ce qui faisait perdre à W4
   deux images de plus par changement de jour (vérifié en profilant les
   deux versions ensemble : l'écart était dans le code de l'horloge). */
const lundi = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
})();
const JOURS = Array.from({ length: 5 }, (_, i) => {
  const d = new Date(lundi);
  d.setDate(lundi.getDate() + i);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
});
function amorce(): unknown {
  const e = JSON.parse(readFileSync(new URL("../packages/domain/sim/effectif-reference.json", import.meta.url), "utf8")) as
    { people: { id: string }[]; sites: { id: string; plan?: Record<string, string[]> }[] };
  const ids = e.people.map(p => p.id);
  e.sites.forEach((s, i) => {
    s.plan = Object.fromEntries(JOURS.map(j => [j, ids.slice(i * 4, i * 4 + 4)]));
  });
  return { people: e.people, sites: e.sites, avail: [], dirty: [], gone: [] };
}

const ENREGISTREUR = `(() => {
  const m = window.__mesure = { t: [], on: false,
    start() { this.t = []; this.on = true; const loop = ts => { this.t.push(ts); if (this.on) requestAnimationFrame(loop); }; requestAnimationFrame(loop); },
    stop() { this.on = false; const d = []; for (let i = 1; i < this.t.length; i++) d.push(this.t[i] - this.t[i - 1]); return d; } };
})();`;

/* Deux aides, installées dans la page avec l'enregistreur.

   Un appui complet (appui, relâché, clic), comme un doigt sur l'iPhone :
   depuis W5, les onglets (Radix) choisissent à l'appui, pas au clic — un
   simple .click() ne changeait plus de jour, et la mesure aurait été
   faussement bonne.

   Un glisser au doigt : appui au centre de l'élément, douze pas d'une
   image chacun jusqu'au centre de la cible, relâché. useDrag écoute le
   document ; il soulève la puce passé 8 px. */
const AIDES = `(() => {
  window.__appuyer = el => {
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      el.dispatchEvent(new (t.startsWith("pointer") ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, button: 0 }));
    el.click();
  };
  window.__glisser = async (el, cible) => {
    const a = el.getBoundingClientRect(), b = cible.getBoundingClientRect();
    const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2, x1 = b.x + b.width / 2, y1 = b.y + b.height / 2;
    const ev = (t, x, y, sur) => sur.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, button: 0,
      clientX: x, clientY: y, pointerId: 7, isPrimary: true, pointerType: "touch" }));
    ev("pointerdown", x0, y0, el);
    for (let k = 1; k <= 12; k++) {
      await new Promise(r => requestAnimationFrame(r));
      ev("pointermove", x0 + (x1 - x0) * k / 12, y0 + (y1 - y0) * k / 12, document);
    }
    await new Promise(r => requestAnimationFrame(r));
    ev("pointerup", x1, y1, document);
  };
})();`;

async function brider(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: BRIDAGE });
}

async function ouvrir(page: Page, url: string): Promise<void> {
  const donnees = amorce();
  await page.addInitScript(({ d, rec }) => {
    if (!sessionStorage.getItem("__amorce")) {
      sessionStorage.setItem("__amorce", "1");
      localStorage.setItem("geoplan.cache.v1", JSON.stringify(d));
      localStorage.setItem("geoplan.ui.v3", JSON.stringify({ tab: "chantiers", poolState: "open", urgence: false }));
    }
    (0, eval)(rec);
  }, { d: donnees, rec: ENREGISTREUR + AIDES });
  await page.goto(url);
  await page.locator("article[data-site]").first().waitFor();
  await brider(page);
  /* Pour « cocher » : les étapes du premier chantier dépliées, ce qui
     déplie aussi l'étape en cours. */
  await page.locator("article[data-site]").first().getByRole("button", { name: /Les 12 étapes/ }).click();
  await page.locator("article[data-site]").first().locator(MISSION).first().waitFor();
}

/* Les éléments, par rôle et attribut : les mêmes avant et après W5, dont
   les classes ont changé. */
const MISSION = "ul li > button[aria-pressed]";
const appuyer = (el: string) => `__appuyer(${el})`;
const bouton = (texte: string) => `[...document.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(texte)})`;
const PREMIERE = `document.querySelector("article[data-site]")`;
const JOUR = (i: number) => `document.querySelectorAll('[aria-label="Jour affiché"] [role=tab]')[${i}]`;
const VIVIER = `document.querySelector("#vivier")`;

/* Un geste : ce qu'il déclenche, joué dans la page (sans l'attente de
   Playwright entre le départ de l'enregistreur et le geste) ; et ce
   qu'il change, lu avant et après, hors de l'enregistrement. Un geste
   sans effet (un sélecteur qui ne trouve plus rien, un clic que la
   version ignore) passerait pour parfaitement fluide.
   `preparer` met la page dans l'état voulu avant chaque geste, hors de
   l'enregistrement ; `serie`, avant chaque série. `apres` : ce qu'on
   enregistre après le geste (700 ms par défaut). */
interface Geste {
  jouer: (i: number) => string;
  etat: string;
  preparer?: (page: Page, i: number) => Promise<void>;
  serie?: (page: Page) => Promise<void>;
  apres?: number;
}

/* Sur Chantiers, un mercredi de la semaine en cours (la semaine amorcée,
   des équipes posées), le vivier ouvert. */
async function chantiersMercredi(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const auj = ${bouton("Auj.")}; if (auj) __appuyer(auj);
    __appuyer(document.querySelectorAll("nav [role=tab]")[0]);
  })()`);
  await page.waitForTimeout(400);
  await page.evaluate(`__appuyer(${JOUR(2)})`);
  await page.waitForTimeout(400);
  await page.evaluate(`(() => { const v = ${VIVIER}; if (v && v.dataset.state !== "open") __appuyer(v.querySelector("button")); })()`);
  await page.waitForTimeout(600);
}

const GESTES_CONNUS: Record<string, Geste> = {
  jour: {
    jouer: i => appuyer(JOUR(i % 2 ? 3 : 2)),
    etat: `document.querySelector('[aria-label="Jour affiché"] [aria-selected="true"]')?.textContent ?? ""`
  },
  onglet: {
    jouer: i => appuyer(`document.querySelectorAll("nav [role=tab]")[${i % 2 ? 1 : 0}]`),
    etat: `document.querySelector('nav [aria-selected="true"]')?.textContent ?? ""`
  },
  mission: {
    jouer: () => appuyer(`document.querySelector("article[data-site] ${MISSION}")`),
    etat: `document.querySelector("article[data-site] ${MISSION}")?.getAttribute("aria-pressed") ?? ""`
  },
  /* Une puce du premier chantier glissée dans le vivier, puis ramenée :
     un aller, un retour. Le compagnon est choisi une fois par série. On
     la lâche sur la tête du vivier, au-dessus du toast du dépôt
     précédent : avant W6, le toast prenait le doigt (constat U22), et
     le dépôt ne visait plus rien. */
  glisser: {
    serie: async page => {
      await chantiersMercredi(page);
      await page.evaluate(`(() => {
        const zone = ${PREMIERE}.querySelector("[data-drop]");
        window.__pid = zone.querySelector(".chip").dataset.pid;
        zone.scrollIntoView({ block: "center" });
      })()`);
      await page.waitForTimeout(400);
    },
    jouer: () => `(async () => {
      const puce = document.querySelector('.chip[data-pid="' + __pid + '"]');
      const cible = puce.dataset.site ? ${VIVIER}.querySelector("[data-vivier-titre]") : ${PREMIERE}.querySelector("[data-drop]");
      await __glisser(puce, cible);
    })()`,
    etat: `document.querySelector('.chip[data-pid="' + __pid + '"]')?.dataset.site ?? "vivier"`
  },
  /* Le vivier ouvert, puis replié. */
  vivier: {
    serie: chantiersMercredi,
    jouer: () => `(() => { const v = ${VIVIER};
      __appuyer(v.dataset.state === "open" ? v.querySelector('[aria-label="Réduire le vivier"]') : v.querySelector("button")); })()`,
    etat: `${VIVIER}?.dataset.state ?? ""`
  },
  /* La semaine suivante, puis la précédente. */
  semaine: {
    serie: chantiersMercredi,
    jouer: i => appuyer(`document.querySelector('[aria-label="Semaine ${i % 2 ? "précédente" : "suivante"}"]')`),
    etat: `document.querySelector("[data-semaine]")?.dataset.semaine ?? ""`
  },
  /* La fiche d'une puce, ouverte d'un appui, puis fermée par « Fermer ». */
  feuille: {
    serie: async page => {
      await chantiersMercredi(page);
      await page.evaluate(`${PREMIERE}.querySelector("[data-drop]").scrollIntoView({ block: "center" })`);
      await page.waitForTimeout(400);
    },
    jouer: () => `(() => { const f = document.querySelector("[role=dialog]");
      __appuyer(f ? f.querySelector('[aria-label="Fermer"]') : ${PREMIERE}.querySelector("[data-drop] .chip")); })()`,
    etat: `document.querySelector("[role=dialog]") ? "ouverte" : "fermée"`,
    apres: 900
  },
  /* Une étape du premier chantier dépliée, puis sa voisine. */
  deplier: {
    serie: chantiersMercredi,
    jouer: i => appuyer(`${PREMIERE}.querySelectorAll("[data-etape-nom]")[${i % 2 ? 0 : 1}].closest("button")`),
    etat: `[...${PREMIERE}.querySelectorAll("[data-etape-nom]")].findIndex(n => n.closest("button").getAttribute("aria-expanded") === "true")`
  },
  /* « Appliquer ce plan » de « Répartir la semaine », depuis la semaine
     amorcée : chaque geste repart d'elle (données remises, page
     rechargée), sans quoi le même plan appliqué deux fois ne change rien. */
  repartir: {
    preparer: async page => {
      await page.evaluate(({ d }) => {
        for (const k of Object.keys(localStorage))
          if (k.startsWith("geoplan.instantane.") || k.startsWith("geoplan.file.")) localStorage.removeItem(k);
        localStorage.setItem("geoplan.cache.v1", JSON.stringify(d));
        localStorage.setItem("geoplan.ui.v3", JSON.stringify({ tab: "semaine", poolState: "open", urgence: false }));
      }, { d: amorce() });
      await page.reload();
      await page.locator('[data-carte="bilan"]').waitFor();
      await brider(page);
      await page.waitForTimeout(1500);             // les feuilles se chargent au repos
      await page.evaluate(appuyer(bouton("Répartir toute l'équipe sur la semaine")));
      await page.getByRole("button", { name: "Appliquer ce plan" }).waitFor();
      await page.waitForTimeout(900);              // la feuille posée, sa garde passée
    },
    jouer: () => appuyer(bouton("Appliquer ce plan")),
    etat: `document.querySelector('[data-carte="bilan"] p')?.textContent ?? ""`,
    apres: 1500
  }
};
for (const g of GESTES)
  if (!GESTES_CONNUS[g]) { console.error(`Geste inconnu : ${g} (connus : ${Object.keys(GESTES_CONNUS).join(", ")})`); process.exit(2); }

async function mesurer(page: Page, geste: string, i: number): Promise<{ perdues: number; pire: number; effet: boolean }> {
  const g = GESTES_CONNUS[geste]!;
  if (g.preparer) await g.preparer(page, i);
  const avant = await page.evaluate(g.etat);
  await page.evaluate(() => (window as unknown as { __mesure: { start(): void } }).__mesure.start());
  await page.waitForTimeout(100);
  await page.evaluate(g.jouer(i));
  await page.waitForTimeout(g.apres ?? 700);
  const d = await page.evaluate(() => (window as unknown as { __mesure: { stop(): number[] } }).__mesure.stop());
  return {
    perdues: d.reduce((a, x) => a + Math.max(0, Math.round(x / 16.667) - 1), 0),
    pire: Math.max(0, ...d),
    effet: avant !== await page.evaluate(g.etat)
  };
}

/* Deux sites distincts (127.0.0.1 et 127.0.0.2) : Chromium loge alors
   chaque version dans son propre processus. Sur le même site, elles
   pouvaient partager un fil d'exécution, et le travail de l'une se
   compter dans les images de l'autre. */
const serveurs = [await servir(DOSSIERS.A, "127.0.0.1", 5311), await servir(DOSSIERS.B, "127.0.0.2", 5312)];
/* GEOPLAN_E2E_CHROMIUM : un Chromium déjà installé, si ce n'est pas celui
   que Playwright attend (comme pour le filet, playwright.config.ts). Pour
   la mesure, son « headless shell » : le Chromium complet, sans écran, met
   en veille l'onglet qui n'est pas au premier plan, et la version qui y
   joue ne dessine plus rien (vérifié : 0 image perdue par changement de
   jour d'un côté, 383 par glisser de l'autre). */
const navigateur = await chromium.launch(process.env.GEOPLAN_E2E_CHROMIUM
  ? { executablePath: process.env.GEOPLAN_E2E_CHROMIUM } : {});
const contexte = await navigateur.newContext({ ...devices["iPhone 15"], locale: "fr-FR", timezoneId: "Europe/Paris" });
const pages = { A: await contexte.newPage(), B: await contexte.newPage() };
await ouvrir(pages.A, "http://127.0.0.1:5311/");
await ouvrir(pages.B, "http://127.0.0.2:5312/");

const moyenne = (v: number[]) => v.reduce((a, x) => a + x, 0) / v.length;
const quantile = (v: number[], q: number) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(q * v.length))]!;
const resultats: Record<string, Record<"A" | "B", { perdues: number[]; pire: number[]; sansEffet: number }>> = {};

for (const geste of GESTES) {
  const r = resultats[geste] = {
    A: { perdues: [] as number[], pire: [] as number[], sansEffet: 0 },
    B: { perdues: [] as number[], pire: [] as number[], sansEffet: 0 }
  };
  /* Chaque série part de l'onglet Chantiers : « onglet » peut s'être
     arrêté sur Semaine, où il n'y a rien à cocher. */
  const serie = GESTES_CONNUS[geste]!.serie;
  for (const v of ["A", "B"] as const)
    if (serie) await serie(pages[v]); else await pages[v].evaluate(GESTES_CONNUS.onglet!.jouer(0));
  await pages.A.waitForTimeout(500);
  for (let i = 0; i < 4; i++) for (const v of ["A", "B"] as const) await mesurer(pages[v], geste, i);   // échauffement
  for (let i = 0; i < N; i++) {
    /* Alterné, et l'ordre du couple alterne aussi : aucune version ne
       passe toujours la première. */
    for (const v of (i % 2 ? ["B", "A"] : ["A", "B"]) as ("A" | "B")[]) {
      const m = await mesurer(pages[v], geste, i);
      r[v].perdues.push(m.perdues);
      r[v].pire.push(m.pire);
      if (!m.effet) r[v].sansEffet++;
    }
  }
}

await navigateur.close();
for (const s of serveurs) s.close();

console.log(`Images perdues par geste — ${N} gestes par version, alternés A/B, processeur bridé ×${BRIDAGE}`);
console.log("Geste".padEnd(10) + "Version".padEnd(9) + "Perdues/geste".padStart(14) + "Pire p50".padStart(10) + "Pire p95".padStart(10) + "Pire max".padStart(10));
for (const [geste, r] of Object.entries(resultats))
  for (const v of ["A", "B"] as const)
    console.log(geste.padEnd(10) + v.padEnd(9) + moyenne(r[v].perdues).toFixed(2).padStart(14) +
      (quantile(r[v].pire, 0.5).toFixed(0) + " ms").padStart(10) +
      (quantile(r[v].pire, 0.95).toFixed(0) + " ms").padStart(10) +
      (Math.max(...r[v].pire).toFixed(0) + " ms").padStart(10));
const ignores = Object.entries(resultats).flatMap(([geste, r]) =>
  (["A", "B"] as const).filter(v => r[v].sansEffet).map(v => `${geste} ${v} : ${r[v].sansEffet} sur ${N}`));
console.log(ignores.length ? "ATTENTION, gestes sans effet (mesure faussée) : " + ignores.join(" ; ") : "Chaque geste a eu son effet, dans les deux versions.");
if (process.argv.includes("--json")) console.log(JSON.stringify(resultats));
