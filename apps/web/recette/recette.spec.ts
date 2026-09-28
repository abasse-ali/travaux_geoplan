/* ============================================================
   La recette de W8 : chaque ligne de GESTES.md, jouée sur la pile
   Docker locale (voir recette/playwright.config.ts et
   docs/reconstruction/RECETTE.md). Chaque ligne : son geste, ce qu'on
   vérifie, une capture ; un échec est noté et la recette continue.
   Le bilan est écrit en JSON dans recette/.resultats/.

   Elle part de la base préparée (l'effectif de référence, un compte, rien
   de posé) et s'en assure ; le jour est celui de l'horloge : les gestes
   visent la semaine en cours, où les trois chantiers sont ouverts.
   Avant tout geste, elle vérifie aussi qu'elle joue sur une pile locale :
   l'API s'y sert en local, et le seul compte est celui de la recette.
   ============================================================ */

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { addDays, dayIndex, fmtDay, mondayOf, parse, todayISO, weekNum } from "@geoplan/domain";
import { carte, feuille, glisser, jours, montrerZone, noterLesToasts, onglet, puceSur, puceVivier, toastsVus, vivier, vuToast, zone } from "../e2e/helpers";

const RACINE = fileURLToPath(new URL("../../../", import.meta.url));
/* Les captures et le bilan d'un passage, dans un dossier vidé au départ :
   rien d'un passage précédent ne peut passer pour une preuve. Le vidage
   de la base (base.sh) reste à côté, dans .resultats/. */
const SORTIE = process.env.RECETTE_SORTIE || fileURLToPath(new URL("./.resultats/passage", import.meta.url));
const URL_PILE = process.env.RECETTE_URL || "http://localhost:8080";
const MDP = process.env.RECETTE_MDP!;
const EMAIL = process.env.RECETTE_EMAIL || "geoffrey@recette.test";
const S9 = "s_9md49", S12 = "s_12ab49", S30 = "s_30ja90";
const COMPOSE = `docker compose -f ${RACINE}infra/docker-compose.yml`;
rmSync(SORTIE, { recursive: true, force: true });
mkdirSync(SORTIE, { recursive: true });

/* La semaine en cours, calculée comme l'application la calcule. Les
   demandes de dispos visent la semaine suivante à partir du vendredi
   (G5) : la recette se joue du lundi au jeudi. */
const AUJ = todayISO(), LUNDI = mondayOf(AUJ), N = weekNum(LUNDI);
const jour = (i: number): string => addDays(LUNDI, i);
const semaine = (k: number): number => weekNum(addDays(LUNDI, 7 * k));
const echapper = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Une requête SQL sur la base de la pile, par le client du conteneur. */
const sql = (requete: string): string => execSync(COMPOSE + " exec -T mysql sh -c 'mysql -u root -p\"$MYSQL_ROOT_PASSWORD\" geoplan -N 2>/dev/null'",
  { input: requete, encoding: "utf8" }).trim();

interface Ligne { ref: string; verdict: string; note: string; capture?: string }
const bilan: Ligne[] = [];
const refus: string[] = [];
const erreurs: string[] = [];

async function ligne(page: Page, ref: string, geste: () => Promise<string | void>): Promise<void> {
  const debut = Date.now();
  try {
    const note = (await geste()) || "";
    const capture = `${SORTIE}/${ref}.png`;
    await page.screenshot({ path: capture }).catch(() => {});
    bilan.push({ ref, verdict: "fonctionne", note: note + ` (${Math.round((Date.now() - debut) / 100) / 10} s)`, capture });
  } catch (e) {
    const capture = `${SORTIE}/${ref}-echec.png`;
    await page.screenshot({ path: capture }).catch(() => {});
    bilan.push({ ref, verdict: "ÉCHEC", note: String((e as Error).message || e).replace(/\s+/g, " ").slice(0, 500), capture });
  }
  writeFileSync(`${SORTIE}/bilan.json`, JSON.stringify({ bilan, refus, erreurs }, null, 2));
}
const nonJoue = (ref: string, pourquoi: string) => { bilan.push({ ref, verdict: "non joué ici", note: pourquoi }); };

/* Un appareil : un contexte, ses refus de politique de sécurité et ses
   erreurs notés. Les polices de Google répondent une feuille vide, au
   niveau du contexte : dans Chromium, les requêtes du service worker y
   passent aussi, et chaque demande est comptée (constat R2). */
const polices: string[] = [];
async function appareil(context: BrowserContext, nom: string): Promise<Page> {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL_PILE }).catch(() => {});
  const page = await context.newPage();
  /* Ce que l'application écrit dans le presse-papiers, relevé au passage :
     WebKit ne laisse pas le test le relire. L'écriture elle-même a lieu. */
  await page.addInitScript(() => {
    const w = window as unknown as { __presse?: string };
    const cp = navigator.clipboard;
    if (!cp) return;
    const texte = cp.writeText?.bind(cp), ecrire = cp.write?.bind(cp);
    if (texte) cp.writeText = async (t: string) => { w.__presse = t; return texte(t); };
    if (ecrire) cp.write = async (items: ClipboardItem[]) => {
      const it = items[0];
      if (it) w.__presse = await (await it.getType("text/plain")).text();
      return ecrire(items);
    };
  });
  await context.route(/fonts\.googleapis\.com/, r => { polices.push(nom); return r.fulfill({ contentType: "text/css", body: "/* polices */" }); });
  await context.route(/fonts\.gstatic\.com/, r => r.fulfill({ status: 404 }));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", e =>
      console.error("CSP-REFUS " + e.effectiveDirective + " " + (e.blockedURI || "en ligne")));
  });
  page.on("console", m => {
    if (m.text().startsWith("CSP-REFUS")) refus.push(nom + " : " + m.text());
    else if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erreurs.push(nom + " : " + m.text().slice(0, 200));
  });
  page.on("pageerror", e => erreurs.push(nom + " (exception) : " + e.message.slice(0, 200)));
  await noterLesToasts(page);
  return page;
}

/* Tout ce qui bouge (K3) : animation ou transition CSS de plus de 1 ms
   ou à délai, animation de script ; et les entrées (K6). */
async function releverLesMouvements(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __mvt: string[] };
    w.__mvt = [];
    const qui = (el: Element) => (el.id ? "#" + el.id : el.tagName.toLowerCase())
      + (el.closest("[data-name]") ? "[" + el.closest("[data-name]")!.getAttribute("data-name") + "]" : "")
      + (el.closest("[data-name]") ? "" : " « " + (el.textContent || "").trim().slice(0, 40) + " »");
    const ms = (v: string) => Math.max(...v.split(",").map(x => x.trim().endsWith("ms") ? parseFloat(x) : parseFloat(x) * 1000));
    document.addEventListener("animationstart", e => {
      const cs = getComputedStyle(e.target as Element);
      if (ms(cs.animationDuration) > 1 || ms(cs.animationDelay) > 0) w.__mvt.push("css " + e.animationName + " " + ms(cs.animationDuration) + " ms @ " + qui(e.target as Element));
    }, true);
    document.addEventListener("transitionrun", e => {
      const cs = getComputedStyle(e.target as Element);
      if (ms(cs.transitionDuration) > 1 || ms(cs.transitionDelay) > 0) w.__mvt.push("transition " + e.propertyName + " @ " + qui(e.target as Element));
    }, true);
    const animer = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, k: Keyframe[] | PropertyIndexedKeyframes | null, o?: number | KeyframeAnimationOptions) {
      const d = typeof o === "number" ? o : Number(o?.duration) || 0;
      if (d > 1) w.__mvt.push("script " + d + " ms @ " + qui(this));
      return animer.call(this, k, o);
    };
  });
}
const mouvements = async (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __mvt: string[] }).__mvt.splice(0));

/* Un tour des gestes qui bougent (K3). */
async function tour(p: Page): Promise<void> {
  await jours(p).nth(2).click(); await p.waitForTimeout(400);
  await p.getByRole("button", { name: "Semaine suivante" }).click(); await p.waitForTimeout(400);
  await p.getByRole("button", { name: "Auj." }).click(); await p.waitForTimeout(400);
  await jours(p).nth(0).click(); await p.waitForTimeout(400);
  for (const o of ["Semaine", "Équipe", "Chantiers"] as const) { await onglet(p, o).click(); await p.waitForTimeout(400); }
  await carte(p, S30).getByRole("button", { name: /^Les 12 étapes/ }).click(); await p.waitForTimeout(500);
  await carte(p, S30).getByRole("button", { name: /^Les 12 étapes/ }).click(); await p.waitForTimeout(500);
  await vivier(p).getByRole("button", { name: "Réduire le vivier" }).click(); await p.waitForTimeout(500);
  await vivier(p).getByRole("button", { name: /^Ouvrir le vivier/ }).click(); await p.waitForTimeout(500);
  await p.getByRole("button", { name: "État des données" }).click(); await p.waitForTimeout(700);
  await p.keyboard.press("Escape"); await p.waitForTimeout(700);
}

async function connecter(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder("vous@exemple.fr").fill(EMAIL);
  await page.getByPlaceholder("Mot de passe").fill(MDP);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.locator("article[data-site]").first()).toBeVisible({ timeout: 20_000 });
}

const presse = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { __presse?: string }).__presse ?? "");
const etat = (page: Page) => page.getByRole("button", { name: "État des données" });
const aJour = (page: Page) => expect(etat(page)).toHaveText(/^à jour$/i, { timeout: 15_000 });
/* La puce posée d'un compagnon, ce jour-là, amenée à l'écran : son
   chantier, et la puce. */
async function pucePosee(page: Page, nom: string): Promise<{ sid: string; puce: ReturnType<Page["locator"]> }> {
  const puce = page.locator(`[data-drop] [data-name="${nom}"]`).first();
  await expect(puce).toBeAttached();
  const sid = await puce.evaluate(e => e.closest("[data-drop]")!.getAttribute("data-drop")!);
  await montrerZone(page, sid);
  return { sid, puce: puceSur(page, sid, nom) };
}

const titreEtape = (page: Page, sid: string, nom: string) => carte(page, sid).getByRole("button")
  .filter({ has: page.locator("[data-etape-nom]", { hasText: new RegExp("^" + nom + "$") }) });

test("Recette W8 — GESTES.md, ligne par ligne, sur la pile Docker", async ({ browser, browserName }) => {
  test.setTimeout(1_800_000);
  expect(dayIndex(AUJ), "la recette se joue du lundi au jeudi : à partir du vendredi, les demandes de dispos visent la semaine suivante").toBeLessThan(4);
  /* La garde : l'adresse (playwright.config.ts) ne suffit pas, Docker peut
     viser une autre machine, et sur le VPS la production écoute aussi en
     local. Comme recette/base.sh : une API qui se sert en local, et une
     base dont le seul compte est celui de la recette. */
  const origine = execSync(COMPOSE + " exec -T api printenv APP_ORIGIN", { encoding: "utf8", stdio: "pipe" }).trim();
  expect(origine, "l'API de la pile se sert en local").toMatch(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/);
  expect(sql("SELECT COUNT(*), MIN(email) FROM users;").split(/\s+/), "le seul compte est celui de la recette").toEqual(["1", EMAIL]);
  const depart = sql("SELECT (SELECT COUNT(*) FROM people), (SELECT COUNT(*) FROM sites), (SELECT COUNT(*) FROM assignments), (SELECT COUNT(*) FROM avail_requests);");
  expect(depart.split(/\s+/), "la base de départ : 13 compagnons, 3 chantiers, rien de posé, aucune demande (recette/base.sh remettre)").toEqual(["13", "3", "0", "0"]);
  const geoffrey = await browser.newContext();
  const page = await appareil(geoffrey, "Geoffrey");

  /* ---------- I. Connexion ---------- */
  await ligne(page, "I1", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Geoplan" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByPlaceholder("vous@exemple.fr")).toHaveAttribute("autocomplete", "username");
    await expect(page.getByPlaceholder("Mot de passe")).toHaveAttribute("autocomplete", "current-password");
    await page.getByPlaceholder("vous@exemple.fr").fill(EMAIL);
    await page.getByPlaceholder("Mot de passe").fill("12345");
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeDisabled();
    await expect(page.getByText("le responsable du serveur le crée ou le change", { exact: false })).toBeVisible();
    return "écran de connexion, champs nommés pour le trousseau, bouton inactif sous 6 caractères";
  });
  await ligne(page, "I2", async () => {
    await page.getByPlaceholder("Mot de passe").fill("mauvais-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByText("Adresse ou mot de passe incorrect.")).toBeVisible();
    return "« Adresse ou mot de passe incorrect. »";
  });
  await ligne(page, "I1-bis", async () => {
    await page.getByPlaceholder("Mot de passe").fill(MDP);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.locator("article[data-site]")).toHaveCount(3, { timeout: 20_000 });
    await aJour(page);
    return "le bon mot de passe ouvre l'application : 3 chantiers, « À jour »";
  });

  /* ---------- A. Le temps ---------- */
  const lundi = jours(page).nth(0);
  await ligne(page, "A1", async () => {
    await jours(page).nth(2).click();
    await expect(jours(page).nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-bandeau-resume]")).toContainText(fmtDay(jour(2)));
    await lundi.click();
    await expect(lundi).toHaveAttribute("aria-selected", "true");
    return "le jour choisi s'affiche, le résumé suit";
  });
  await ligne(page, "A2", async () => {
    const suivante = page.getByRole("button", { name: "Semaine suivante" });
    await suivante.click();
    await expect(page.locator("[data-semaine]")).toHaveText(new RegExp("^Sem\\. " + semaine(1) + " "));
    await expect(page.locator("[data-semaine]")).toHaveAttribute("data-hors-semaine", "true");
    await suivante.click(); await suivante.click();
    await expect(page.locator("[data-semaine]")).toHaveText(new RegExp("^Sem\\. " + semaine(3) + " "));
    await expect(lundi).toHaveAttribute("aria-selected", "true");
    return "±7 jours, jour gardé, deux appuis rapides : deux semaines, libellé hors semaine marqué";
  });
  await ligne(page, "A3", async () => {
    await page.getByRole("button", { name: "Auj." }).click();
    await expect(page.locator("[data-semaine]")).toHaveText(new RegExp("^Sem\\. " + N + " "));
    await expect(page.getByRole("button", { name: "Auj." })).toHaveCount(0);
    return "retour à aujourd'hui, « Auj. » disparaît";
  });
  await ligne(page, "A4", async () => {
    await onglet(page, "Semaine").click();
    await expect(page.getByRole("button", { name: "Répartir toute l'équipe sur la semaine" })).toBeVisible();
    await onglet(page, "Équipe").click();
    await expect(page.getByText("Effectif · semaine " + N)).toBeVisible();
    await onglet(page, "Chantiers").click();
    await expect(carte(page, S9)).toBeVisible();
    return "trois écrans";
  });
  await ligne(page, "A5", async () => {
    await onglet(page, "Semaine").click();
    await page.locator(`[data-ligne="entete"] [data-case="${jour(3)}"]`).click();
    await expect(onglet(page, "Chantiers")).toHaveAttribute("aria-selected", "true");
    await expect(jours(page).nth(3)).toHaveAttribute("aria-selected", "true");
    await lundi.click();
    return "l'en-tête du jeudi ramène aux chantiers, au jeudi";
  });

  /* ---------- B. Affecter ---------- */
  await ligne(page, "B1", async () => {
    await montrerZone(page, S9);
    await glisser(page, puceVivier(page, "Nixon"), zone(page, S9), { appuiLong: true });
    await vuToast(page, "Nixon sur 9MD49");
    await expect(puceSur(page, S9, "Nixon")).toBeVisible();
    await expect(puceVivier(page, "Nixon")).toHaveCount(0);
    return "posé par appui long puis glisser ; toast, la puce quitte le vivier";
  });
  await ligne(page, "B2", async () => {
    await montrerZone(page, S9);
    await glisser(page, puceSur(page, S9, "Nixon"), zone(page, S12), { pendant: () => montrerZone(page, S12) });
    await vuToast(page, "Nixon : 9MD49 → 12AB49");
    await expect(puceSur(page, S12, "Nixon")).toBeVisible();
    await expect(puceSur(page, S9, "Nixon")).toHaveCount(0);
    return "déplacé de 9MD49 à 12AB49";
  });
  await ligne(page, "B3", async () => {
    await glisser(page, puceSur(page, S12, "Nixon"), vivier(page));
    await vuToast(page, "Nixon retiré");
    await expect(puceVivier(page, "Nixon")).toBeVisible();
    return "rendu au vivier";
  });
  await ligne(page, "B4", async () => {
    const avant = await page.locator("[data-toast]").count();
    await glisser(page, puceVivier(page, "Giorgi"), page.locator("[data-semaine]"));
    await page.waitForTimeout(700);
    await expect(puceVivier(page, "Giorgi")).toBeVisible();
    await expect(page.locator(".chip.lifted, .chip.atterrit, [data-fantome]:not([hidden])")).toHaveCount(0);
    return `lâchée hors cible : rien ne change (${avant} toast avant)`;
  });
  await ligne(page, "B7", async () => {
    await puceVivier(page, "Giorgi").click();
    await expect(feuille(page, "Giorgi")).toBeVisible();
    await expect(feuille(page, "Giorgi").getByText(/Jours sur/)).toHaveCount(0);
    return "fiche du compagnon, sans « Jours sur… »";
  });
  await ligne(page, "B8", async () => {
    const f = feuille(page, "Giorgi");
    await f.getByRole("button", { name: /^9MD49/ }).click();
    await expect(f).toBeHidden();
    await expect(puceSur(page, S9, "Giorgi")).toBeVisible();
    return "« Poser sur » 9MD49 pose et ferme";
  });
  await ligne(page, "B6", async () => {
    await puceSur(page, S9, "Giorgi").click();
    const f = feuille(page, "Giorgi");
    await expect(f.getByText("Jours sur 9MD49 · sem. " + N)).toBeVisible();
    await expect(f.getByRole("group").first().getByRole("button")).toHaveCount(7);
    return "fiche et ses sept jours sur 9MD49";
  });
  await ligne(page, "B9", async () => {
    await feuille(page, "Giorgi").getByRole("button", { name: "Retirer de ce jour" }).click();
    await expect(feuille(page, "Giorgi")).toBeHidden();
    await expect(puceSur(page, S9, "Giorgi")).toHaveCount(0);
    return "retiré de ce jour";
  });
  await ligne(page, "B11", async () => {
    for (const nom of ["Aklan", "Erwan"]) {
      await puceVivier(page, nom).click();
      await feuille(page, nom).getByRole("button", { name: /^9MD49/ }).click();
      await expect(puceSur(page, S9, nom)).toBeVisible();
    }
    await jours(page).nth(1).click();
    await montrerZone(page, S9);
    await zone(page, S9).getByRole("button", { name: "Reprendre l'équipe de la veille" }).click();
    await vuToast(page, "reconduit");
    await expect(puceSur(page, S9, "Aklan")).toBeVisible();
    await expect(puceSur(page, S9, "Erwan")).toBeVisible();
    return "mardi : l'équipe du lundi reconduite";
  });
  await ligne(page, "B12", async () => {
    const urgence = vivier(page).getByRole("switch", { name: "Urgence" });
    await urgence.click();
    await vuToast(page, "Mode urgence");
    await montrerZone(page, S9);
    await glisser(page, puceSur(page, S9, "Aklan"), zone(page, S12), { pendant: () => montrerZone(page, S12) });
    await expect(puceSur(page, S12, "Aklan")).toBeVisible();
    await expect(puceSur(page, S9, "Aklan")).toBeVisible();
    await urgence.click();
    await expect(urgence).toHaveAttribute("aria-checked", "false");
    return "en urgence, glisser copie ; désactivée, le doublon reste";
  });
  await ligne(page, "B13", async () => {
    await montrerZone(page, S9);
    await glisser(page, puceSur(page, S9, "Erwan"), zone(page, S30), { pendant: () => montrerZone(page, S30) });
    await expect(puceSur(page, S30, "Erwan")).toBeVisible();
    await expect(puceSur(page, S9, "Erwan")).toHaveCount(0);
    return "hors urgence, glisser déplace";
  });
  await ligne(page, "B14", async () => {
    const noms = await vivier(page).locator(".chip").evaluateAll(els => els.map(e => e.getAttribute("data-name")));
    expect(noms).toContain("Chaggy");                  // le mardi seulement
    for (const n of ["Aklan", "Erwan"]) expect(noms, n + " est posé").not.toContain(n);
    for (const n of ["Kia", "Mojtaba"]) expect(noms, n + " ne vient pas le mardi").not.toContain(n);
    return "mardi : " + noms.join(", ");
  });
  await ligne(page, "B15", async () => {
    await vivier(page).getByRole("button", { name: "Réduire le vivier" }).click();
    const pastille = vivier(page).getByRole("button", { name: /^Ouvrir le vivier — \d+ disponible/ });
    await expect(pastille).toBeVisible();
    await page.screenshot({ path: `${SORTIE}/B15-replie.png` });
    await pastille.click();
    await expect(vivier(page).getByRole("button", { name: "Réduire le vivier" })).toBeVisible();
    return "replié puis rouvert";
  });
  await lundi.click();

  /* ---------- C. Avancement ---------- */
  await ligne(page, "C1", async () => {
    await carte(page, S9).getByRole("button", { name: /^Les 12 étapes/ }).click();
    await expect(titreEtape(page, S9, "Démolition")).toHaveAttribute("aria-expanded", "true");
    return "déplie l'étape en cours (Démolition)";
  });
  await ligne(page, "C2", async () => {
    await titreEtape(page, S9, "Sols & plinthes").click();
    await expect(titreEtape(page, S9, "Sols & plinthes")).toHaveAttribute("aria-expanded", "true");
    await expect(titreEtape(page, S9, "Démolition")).toHaveAttribute("aria-expanded", "false");
    return "une seule étape ouverte";
  });
  const barre = carte(page, S9).getByRole("slider", { name: "Étape 10 Sols & plinthes" });
  await ligne(page, "C3", async () => {
    const missions = carte(page, S9).getByRole("list").getByRole("button");
    for (let i = 0; i < 3; i++) await missions.nth(i).click();
    await expect(barre).toHaveAttribute("aria-valuenow", "75");
    await missions.nth(2).click();
    await expect(barre).toHaveAttribute("aria-valuenow", "50");
    return "trois missions sur quatre : 75 % ; une décochée : 50 %";
  });
  await ligne(page, "C4", async () => {
    await barre.evaluate(el => el.scrollIntoView({ block: "center" }));
    await barre.hover();
    const b = (await barre.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.02, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.99, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(barre).toHaveAttribute("aria-valuenow", "100");
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 1, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(barre).toHaveAttribute("aria-valuenow", "0");
    return "glissée à droite : 100 % ; à gauche : 0 %";
  });
  await ligne(page, "C5", async () => {
    await barre.click();
    await expect(barre).toHaveAttribute("aria-valuenow", "100");
    await barre.click();
    await expect(barre).toHaveAttribute("aria-valuenow", "0");
    return "un appui bascule 0 / 100 % (U4, gardé en l'état)";
  });
  await ligne(page, "C6", async () => {
    await barre.press("ArrowRight");
    await expect(barre).toHaveAttribute("aria-valuenow", "25");
    await barre.press("ArrowLeft");
    await expect(barre).toHaveAttribute("aria-valuenow", "0");
    return "au clavier, un cran par flèche";
  });
  await ligne(page, "C7", async () => {
    const c = carte(page, S12);
    await c.scrollIntoViewIfNeeded();
    await expect(c.locator("[data-echelle] i")).toHaveCount(12);
    return "carte : " + (await c.innerText()).split("\n").slice(0, 6).join(" · ");
  });
  await ligne(page, "C8", async () => {
    const c = carte(page, S9);
    await c.getByRole("button", { name: /^Note de chantier/ }).click();
    await c.getByRole("textbox").fill("Clés chez la gardienne");
    await page.waitForTimeout(800);
    return "note écrite (relue après rechargement, en I3)";
  });

  /* ---------- D. Composer ---------- */
  await ligne(page, "D1", async () => {
    await montrerZone(page, S12);
    await zone(page, S12).getByRole("button", { name: "Composer" }).click();
    const f = feuille(page, "Composition · 12AB49");
    await expect(f).toBeVisible();
    await expect(f.getByText(/Il reste/)).toBeVisible();
    return "feuille « Composition · 12AB49 », rappel de charge";
  });
  await ligne(page, "D2", async () => {
    const f = feuille(page, "Composition · 12AB49");
    await f.getByRole("button", { name: "3", exact: true }).click();
    await expect(f.locator("[data-compagnon]")).toHaveCount(3);
    return "taille 3 : " + (await f.locator("[data-compagnon] [data-nom]").allInnerTexts()).join(", ");
  });
  await ligne(page, "D3", async () => {
    await feuille(page, "Composition · 12AB49").getByRole("button", { name: "Affecter" }).click();
    await vuToast(page, /12AB49 : \d+ journées? posées?/);
    return "équipe posée";
  });

  /* ---------- E. Répartir ---------- */
  await ligne(page, "E1", async () => {
    await onglet(page, "Semaine").click();
    await page.getByRole("button", { name: "Répartir toute l'équipe sur la semaine" }).click();
    const f = feuille(page, "Répartir la semaine");
    await expect(f.getByText(/journées réparties sur \d+ chantiers?/)).toBeVisible();
    return (await f.getByText(/journées réparties sur/).innerText()).trim();
  });
  await ligne(page, "E2", async () => {
    await feuille(page, "Répartir la semaine").getByRole("button", { name: "Appliquer ce plan" }).click();
    await vuToast(page, new RegExp("journées posées sur la semaine " + N));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SORTIE}/E2-vague.png` });
    return "plan appliqué, la vague se pose";
  });
  await ligne(page, "E3", async () => {
    /* La semaine d'avant l'ouverture des trois chantiers de l'effectif
       (le 31 août 2026) : aucun n'est à pourvoir. Après leur fin prévue,
       si : un chantier en retard le reste tant qu'il n'est pas livré. */
    const avant = mondayOf("2026-08-24");
    const recul = Math.round((parse(LUNDI).getTime() - parse(avant).getTime()) / 604_800_000);
    const precedente = page.getByRole("button", { name: "Semaine précédente" });
    for (let k = 0; k < recul; k++) await precedente.click();
    await expect(page.locator("[data-semaine]")).toHaveText(new RegExp("^Sem\\. " + weekNum(avant) + " "));
    await page.getByRole("button", { name: "Répartir toute l'équipe sur la semaine" }).click();
    await expect(feuille(page, "Répartir la semaine").getByText("Aucun chantier actif à pourvoir cette semaine.")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Auj." }).click();
    await expect(page.locator("[data-semaine]")).toHaveText(new RegExp("^Sem\\. " + N + " "));
    return `semaine ${weekNum(avant)}, avant l'ouverture des chantiers : « Aucun chantier actif à pourvoir cette semaine. »`;
  });
  await ligne(page, "E4", async () => {
    await page.waitForTimeout(1_000);
    await expect(page.locator("[data-grille-semaine] [data-ligne]")).toHaveCount(5);
    return "grille chantiers × 7 jours et ligne des libres";
  });
  await onglet(page, "Chantiers").click();

  /* ---------- F. Chantiers ---------- */
  await ligne(page, "F1", async () => {
    await page.getByRole("button", { name: "Ajouter" }).click();
    const f = feuille(page, "Nouveau chantier");
    await f.getByPlaceholder("151 Henri Desbals apt 7").fill("151 Henri Desbals apt 7");
    await expect(f.getByPlaceholder("151HD7")).toHaveValue("151HD7");
    return "le code suit l'adresse";
  });
  await ligne(page, "F2", async () => {
    await feuille(page, "Nouveau chantier").getByRole("button", { name: "Ouvrir le chantier" }).click();
    await vuToast(page, "151HD7 ouvert");
    await expect(page.locator("article[data-site]")).toHaveCount(4);
    return "ouvert, quatre fiches";
  });
  await ligne(page, "F3", async () => {
    const nouveau = page.locator("article[data-site]", { has: page.locator("[data-code]", { hasText: /^151HD7$/ }) });
    await nouveau.getByRole("button", { name: "Modifier le chantier" }).click();
    const m = feuille(page, "151HD7");
    await m.getByRole("button", { name: "Supprimer le chantier" }).click();
    await m.getByRole("button", { name: "Confirmer — l'équipe sera libérée" }).click();
    await vuToast(page, "151HD7 supprimé");
    await expect(page.locator("article[data-site]")).toHaveCount(3);
    return "supprimé en deux temps";
  });
  await ligne(page, "F4", async () => {
    // Un autre jour que celui de l'ouverture : le brief est celui du jour affiché (U1).
    const i = dayIndex(AUJ) === 2 ? 1 : 2;
    await jours(page).nth(i).click();
    await page.getByRole("button", { name: "Partager le brief" }).click();
    await vuToast(page, "Copié — collez-le dans votre message");
    const texte = await presse(page);
    await lundi.click();
    const attendu = "GEOPLAN — " + ["Lundi", "Mardi", "Mercredi"][i] + " " + fmtDay(jour(i));
    expect(texte.startsWith(attendu), attendu).toBe(true);
    return "copié, le jour affiché : " + texte.split("\n").slice(0, 3).join(" / ");
  });

  /* ---------- G. Équipe ---------- */
  await onglet(page, "Équipe").click();
  await ligne(page, "G1", async () => {
    await page.getByRole("button", { name: "Ajouter" }).click();
    await expect(feuille(page, "Nouveau compagnon")).toBeVisible();
    return "feuille « Nouveau compagnon »";
  });
  await ligne(page, "G2", async () => {
    const f = feuille(page, "Nouveau compagnon");
    await f.getByRole("button", { name: "Ajouter au vivier" }).click();
    await vuToast(page, "Il manque le nom");
    await f.getByPlaceholder("Prénom").fill("Recette");
    await f.getByPlaceholder("06 12 34 56 78").fill("12");
    await f.getByRole("button", { name: "Ajouter au vivier" }).click();
    await vuToast(page, "Ce numéro n'a pas l'air valide");
    await f.getByPlaceholder("06 12 34 56 78").fill("");
    const lun = f.getByRole("button", { name: /^Lundi|^Lun/ }).first();
    if ((await lun.getAttribute("aria-pressed")) !== "true") await lun.click();
    await f.getByRole("button", { name: "Ajouter au vivier" }).click();
    await vuToast(page, "Recette ajouté au vivier");
    return "contrôles dans l'ordre, puis ajouté";
  });
  await ligne(page, "G3", async () => {
    for (const [nom, courriel, tel] of [["Nixon", "nixon@exemple.fr", "06 12 34 56 78"], ["Giorgi", "giorgi@exemple.fr", ""]] as const) {
      await page.locator("[data-personne]").filter({ hasText: nom }).first().click();
      const f = feuille(page, nom);
      await f.getByPlaceholder("erwan@exemple.fr").fill(courriel);
      if (tel) await f.getByPlaceholder("06 12 34 56 78").fill(tel);
      await f.getByRole("button", { name: "Enregistrer" }).click();
      await vuToast(page, nom + " enregistré");
    }
    return "fiches modifiées : e-mail et téléphone de Nixon, e-mail de Giorgi";
  });
  await ligne(page, "G4", async () => {
    await page.locator("[data-personne]").filter({ hasText: "Recette" }).first().click();
    const f = feuille(page, "Recette");
    await f.getByRole("button", { name: "Supprimer Recette" }).click();
    await f.getByRole("button", { name: "Confirmer la suppression" }).click();
    await vuToast(page, "Recette supprimé");
    return "supprimé en deux temps";
  });
  let lienNixon = "", lienGiorgi = "";
  await ligne(page, "G5", async () => {
    await page.getByRole("button", { name: new RegExp("^Demander les dispos · semaine " + N) }).click();
    const f = feuille(page, "Demander les dispos");
    await expect(f.locator("[data-compagnon]")).toHaveCount(2);
    expect(sql("SELECT COUNT(*) FROM avail_requests;"), "ouvrir la feuille ne crée rien (U11)").toBe("0");
    await expect(f.locator('[data-compagnon="p_nixon"]').getByRole("button", { name: "SMS" })).toBeVisible();
    await f.locator('[data-compagnon="p_nixon"]').getByRole("button", { name: "Lien" }).click();
    await vuToast(page, "Lien copié");
    await expect.poll(() => presse(page)).toMatch(/dispo\.html/);
    lienNixon = await presse(page);
    await f.locator('[data-compagnon="p_giorgi"]').getByRole("button", { name: "Lien" }).click();
    await expect.poll(() => presse(page)).not.toBe(lienNixon);
    lienGiorgi = await presse(page);
    expect(sql("SELECT COUNT(*) FROM avail_requests;"), "un lien par compagnon touché").toBe("2");
    expect(lienNixon.startsWith(URL_PILE + "/dispo.html?t=")).toBe(true);
    expect(lienNixon).toMatch(/\?t=[\w-]{16,}$/);
    await page.keyboard.press("Escape");
    return "liens créés à la demande : " + lienNixon.replace(/t=(.{6}).*/, "t=$1…");
  });
  await onglet(page, "Chantiers").click();
  await ligne(page, "B10", async () => {
    await (await pucePosee(page, "Nixon")).puce.click();
    const f = feuille(page, "Nixon");
    const liens = await f.locator("a[href]").evaluateAll(els => els.map(a => a.textContent + " → " + a.getAttribute("href")));
    expect(liens.join(" ")).toContain("tel:+33612345678");
    expect(liens.join(" ")).toContain("wa.me/33612345678");
    await page.keyboard.press("Escape");
    return liens.join(" ; ");
  });

  /* ---------- J. La page du compagnon, sur un autre téléphone ---------- */
  const telephone = await browser.newContext();
  const compagnon = await appareil(telephone, "Nixon");
  await ligne(compagnon, "J1", async () => {
    await compagnon.goto(lienNixon);
    await expect(compagnon.getByRole("heading", { name: "Bonjour Nixon" })).toBeVisible({ timeout: 20_000 });
    await expect(compagnon.getByRole("button", { name: /^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)/ })).toHaveCount(7);
    return (await compagnon.locator("main, body").first().innerText()).split("\n").slice(0, 3).join(" · ");
  });
  await ligne(compagnon, "J2", async () => {
    for (const j of ["Lundi", "Mercredi"]) await compagnon.getByRole("button", { name: new RegExp("^" + j) }).click();
    await expect(compagnon.getByRole("button", { name: /^Lundi/ })).toHaveAttribute("aria-pressed", "true");
    return "lundi et mercredi cochés";
  });
  await ligne(compagnon, "J3", async () => {
    await compagnon.getByPlaceholder("Un mot à ajouter ? (facultatif)").fill("Je finis tôt le mercredi");
    return "un mot";
  });
  await ligne(compagnon, "J4", async () => {
    await compagnon.getByRole("button", { name: "Envoyer mes disponibilités" }).click();
    await expect(compagnon.getByRole("heading", { name: "C'est envoyé, merci Nixon" })).toBeVisible();
    await expect(compagnon.getByText(/disponible : lundi, mercredi/)).toBeVisible();
    await expect(compagnon.getByText(/Message transmis/)).toContainText("« Je finis tôt le mercredi »");
    return "envoyé ; « tu es noté disponible : lundi, mercredi », et le mot transmis";
  });
  await ligne(page, "G6", async () => {
    await vuToast(page, "Nixon a répondu pour la semaine " + N, 15_000);
    return "l'application de Geoffrey, restée ouverte, l'a su aussitôt";
  });
  await ligne(compagnon, "J9", async () => {
    await compagnon.goto(lienNixon);
    await expect(compagnon.getByRole("button", { name: "Mettre à jour ma réponse" })).toBeVisible({ timeout: 20_000 });
    await expect(compagnon.getByRole("button", { name: /^Mercredi/ })).toHaveAttribute("aria-pressed", "true");
    return "la réponse revient, « Mettre à jour ma réponse »";
  });
  await ligne(compagnon, "J10", async () => {
    await compagnon.goto(lienGiorgi);
    await expect(compagnon.getByRole("heading", { name: "Bonjour Giorgi" })).toBeVisible({ timeout: 20_000 });
    const sw = await compagnon.evaluate(async () => !!(await navigator.serviceWorker?.getRegistration()));
    return "un autre lien, le service worker installé (" + sw + ") : le formulaire, pas l'application";
  });
  await ligne(compagnon, "J6", async () => {
    await compagnon.goto("/dispo.html");
    await expect(compagnon.getByText("Lien incomplet")).toBeVisible({ timeout: 20_000 });
    return "« Lien incomplet »";
  });
  await ligne(compagnon, "J7", async () => {
    await compagnon.goto("/dispo.html?t=jeton-inconnu-0123456789");
    await expect(compagnon.getByText("Lien expiré")).toBeVisible({ timeout: 20_000 });
    return "« Lien expiré »";
  });
  await ligne(compagnon, "J5", async () => {
    await compagnon.goto(lienGiorgi);
    await expect(compagnon.getByRole("heading", { name: "Bonjour Giorgi" })).toBeVisible({ timeout: 20_000 });
    await telephone.setOffline(true);
    await compagnon.getByRole("button", { name: /^Mardi/ }).click();
    await compagnon.getByRole("button", { name: "Envoyer mes disponibilités" }).click();
    await expect(compagnon.getByText("L'envoi n'a pas abouti", { exact: false })).toBeVisible();
    await expect(compagnon.getByRole("button", { name: "Envoyer mes disponibilités" })).toBeEnabled();
    await telephone.setOffline(false);
    return "réseau coupé : « L'envoi n'a pas abouti… », et le bouton se libère";
  });
  await ligne(compagnon, "J4-300", async () => {
    const mot = "Je peux venir le mardi mais pas avant dix heures, la voiture est au garage. ".repeat(5).trim();
    await compagnon.getByPlaceholder("Un mot à ajouter ? (facultatif)").fill(mot);
    await compagnon.getByRole("button", { name: "Envoyer mes disponibilités" }).click();
    await expect(compagnon.getByRole("heading", { name: "C'est envoyé, merci Giorgi" })).toBeVisible();
    const affiche = (await compagnon.getByText(/Message transmis/).innerText()).replace(/^.*« /s, "").replace(/ »\s*$/s, "");
    const enBase = sql("SELECT CHAR_LENGTH(note) FROM avail_requests WHERE person_id = 'p_giorgi';");
    expect(enBase, "tronqué à 300 caractères à l'envoi").toBe("300");
    return `mot de ${mot.length} caractères : la base en a ${enBase} ; l'écran en montre ${affiche.length} (U14, gardé tel quel)`;
  });
  await ligne(compagnon, "J8", async () => {
    execSync(COMPOSE + " stop api", { stdio: "ignore" });
    let duree = 0;
    try {
      const debut = Date.now();
      await compagnon.goto(lienGiorgi);
      await expect(compagnon.getByText("Connexion impossible")).toBeVisible({ timeout: 90_000 });
      duree = Date.now() - debut;
      expect(duree).toBeLessThan(10_000);
    } finally {
      execSync(COMPOSE + " start api", { stdio: "ignore" });
      await expect.poll(async () => (await page.request.get("/api/health").catch(() => null))?.status(), { timeout: 60_000 }).toBe(200);
    }
    return `API arrêtée : « Connexion impossible » en ${(duree / 1000).toFixed(1)} s ; relancée`;
  });
  await ligne(compagnon, "J11", async () => {
    /* Ce qui passe sur le fil, demandé comme un navigateur (gzip) : la
       page et ce qu'elle charge à l'ouverture. Le poids calculé sur les
       fichiers ne disait rien de ce que nginx envoyait (constat R4). */
    const surLeFil = (chemin: string): Promise<{ octets: number; corps: string }> => new Promise((ok, ko) => {
      request(URL_PILE + chemin, { headers: { "accept-encoding": "gzip" } }, r => {
        const morceaux: Buffer[] = [];
        r.on("data", (m: Buffer) => morceaux.push(m));
        r.on("end", () => ok({ octets: Buffer.concat(morceaux).length, corps: r.headers["content-encoding"] ? "" : Buffer.concat(morceaux).toString("utf8") }));
      }).on("error", ko).end();
    });
    const poids: Record<string, number> = {};
    for (const pagePoids of ["/dispo.html", "/index.html"]) {
      const html = await (await compagnon.request.get(pagePoids)).text();
      const fichiers = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]!))];
      let total = (await surLeFil(pagePoids)).octets;
      for (const f of fichiers) total += (await surLeFil(f)).octets;
      poids[pagePoids] = total;
    }
    expect(poids["/dispo.html"]!, "dispo.html : la référence, 158,9 ko, plus 10 %").toBeLessThan(158_900 * 1.1);
    return `sur le fil : dispo.html ${(poids["/dispo.html"]! / 1000).toFixed(1)} ko, index.html ${(poids["/index.html"]! / 1000).toFixed(1)} ko`;
  });

  /* ---------- B5 : un compagnon posé un jour où il s'est dit absent ---------- */
  await ligne(page, "B5", async () => {
    // Mardi : Nixon a répondu qu'il ne venait pas (J2). « Répartir » l'y
    // avait posé avant sa réponse ; on le déplace d'un chantier à l'autre.
    await jours(page).nth(1).click();
    const { sid, puce } = await pucePosee(page, "Nixon");
    await expect(puce.locator("s").nth(1)).toHaveAttribute("data-etat", "absent");
    const vers = sid === S12 ? S30 : S12;
    await glisser(page, puce, zone(page, vers), { pendant: () => montrerZone(page, vers) });
    const mardi = "mardi " + fmtDay(jour(1));
    await vuToast(page, new RegExp("^Nixon : .+ · " + echapper(mardi) + "$"));
    await expect(puceSur(page, vers, "Nixon")).toBeVisible();
    await expect(puceSur(page, vers, "Nixon").locator("s").nth(1)).toHaveAttribute("data-etat", "absent");
    await vuToast(page, "Attention : Nixon s'est déclaré absent ce jour-là", 8_000);
    const t = await toastsVus(page);
    const pose = t.filter(x => x.texte.startsWith("Nixon : ") && x.texte.endsWith(" · " + mardi)).at(-1)!, avert = t.filter(x => x.texte.startsWith("Attention : Nixon")).at(-1)!;
    await lundi.click();
    return `déplacé de ${sid} à ${vers} ; l'avertissement ${Math.round(avert.t - pose.t)} ms après le toast du geste ; pastille du mardi « absent »`;
  });

  /* ---------- H. Données ---------- */
  await ligne(page, "H1", async () => {
    await aJour(page);
    await geoffrey.setOffline(true);
    await carte(page, S12).getByRole("button", { name: /^Les 12 étapes/ }).click();
    await carte(page, S12).getByRole("list").getByRole("button").first().click();
    await expect(etat(page)).toHaveText(/1 en attente/i, { timeout: 10_000 });
    await page.screenshot({ path: `${SORTIE}/H1-hors-ligne.png` });
    await geoffrey.setOffline(false);
    await aJour(page);
    return "hors ligne : « 1 en attente » ; le réseau revenu : « À jour »";
  });
  await ligne(page, "H2", async () => {
    await etat(page).click();
    const f = feuille(page, "Données");
    await expect(f.getByText("Synchronisé")).toBeVisible();
    await expect(f.getByText(EMAIL, { exact: false })).toBeVisible();
    return (await f.getByText(/compagnons? · \d+ chantiers?/).innerText()).trim();
  });
  let sauvegarde = "";
  await ligne(page, "H3", async () => {
    const [telecharge] = await Promise.all([
      page.waitForEvent("download"),
      feuille(page, "Données").getByRole("button", { name: "Exporter un fichier de sauvegarde" }).click()
    ]);
    const chemin = `${SORTIE}/${telecharge.suggestedFilename()}`;
    await telecharge.saveAs(chemin);
    sauvegarde = readFileSync(chemin, "utf8");
    const o = JSON.parse(sauvegarde) as { app: string; v: number; people: unknown[]; sites: unknown[] };
    expect(o.app).toBe("geoplan");
    return `${telecharge.suggestedFilename()} : ${o.people.length} compagnons, ${o.sites.length} chantiers, v${o.v}`;
  });
  await ligne(page, "H4", async () => {
    const f = feuille(page, "Données");
    await f.getByRole("textbox", { name: "Contenu d'une sauvegarde" }).fill(sauvegarde);
    await f.getByRole("button", { name: "Remplacer les données" }).click();
    await f.getByRole("button", { name: "Confirmer : tout sera remplacé" }).click();
    await vuToast(page, /restaurés/);
    return "la sauvegarde remise telle quelle";
  });
  await page.keyboard.press("Escape");

  const second = await browser.newContext();
  const autre = await appareil(second, "Deuxième appareil");
  await releverLesMouvements(autre);
  let mouvementsH7: string[] | null = null;
  await ligne(autre, "H7", async () => {
    await connecter(autre);
    await jours(autre).nth(0).click();                        // le lundi, comme le premier appareil
    await expect(autre.locator('[data-drop] [data-name="Morgan"]')).toHaveCount(1);
    await autre.waitForTimeout(1_500);
    await mouvements(autre);
    // Sur le premier appareil : Morgan retiré de ce lundi, puis posé sur 12AB49.
    await (await pucePosee(page, "Morgan")).puce.click();
    await feuille(page, "Morgan").getByRole("button", { name: "Retirer de ce jour" }).click();
    await expect(autre.locator('#vivier [data-name="Morgan"]')).toBeVisible({ timeout: 10_000 });
    await expect(autre.locator('[data-drop] [data-name="Morgan"]')).toHaveCount(0);
    await puceVivier(page, "Morgan").click();
    await feuille(page, "Morgan").getByRole("button", { name: /^12AB49/ }).click();
    await expect(autre.locator(`[data-drop="${S12}"] [data-name="Morgan"]`)).toBeVisible({ timeout: 10_000 });
    await autre.waitForTimeout(800);
    mouvementsH7 = await mouvements(autre);
    return "retiré puis posé sur un appareil : l'autre suit, sans recharger";
  });
  await ligne(autre, "K6", async () => {
    expect(mouvementsH7, "relevés pendant H7 : sans H7 réussi, pas de K6").not.toBeNull();
    const vus = mouvementsH7!;
    const entrees = vus.filter(v => /^css /.test(v));
    // Ce qui arrive vraiment : les puces de Morgan, et « Personne de libre » quand le vivier se vide de nouveau.
    const autres = entrees.filter(v => !/\[Morgan\]|« Personne de libre/.test(v));
    expect(autres).toEqual([]);
    return "redessiné deux fois par le temps réel, l'autre appareil n'a rejoué aucune entrée ; seules celles de ce qui arrive : " + (entrees.join(" ; ") || "aucune");
  });

  await ligne(page, "H5", async () => {
    await geoffrey.setOffline(true);
    await page.reload();
    await expect(page.locator("article[data-site]").first()).toBeVisible({ timeout: 20_000 });
    await jours(page).nth(0).click();                         // relancée, elle repart d'aujourd'hui
    await expect(puceSur(page, S12, "Morgan")).toBeAttached();
    await expect(etat(page), "rien n'attend : « Hors ligne », pas « 0 en attente » (U29)").toHaveText(/^hors ligne$/i, { timeout: 15_000 });
    const libelle = await etat(page).innerText();
    await geoffrey.setOffline(false);
    await aJour(page);
    return "relancée hors ligne : l'écran vient du cache, Morgan sur 12AB49 ; bouton d'état « " + libelle + " », puis « À jour » au retour du réseau";
  });

  /* ---------- I (suite), K ---------- */
  await ligne(page, "I3", async () => {
    const avant = polices.filter(n => n === "Geoffrey").length;
    await page.reload();
    await expect(page.locator("article[data-site]").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Se connecter" })).toHaveCount(0);
    await carte(page, S9).getByRole("button", { name: /^Note de chantier/ }).click();
    await expect(carte(page, S9).getByRole("textbox")).toHaveValue("Clés chez la gardienne");
    /* Sous le service worker, c'est lui qui demande les polices ; seul
       Chromium laisse le test voir ses requêtes (R2). */
    const sousSw = browserName === "chromium" && await page.evaluate(() => !!navigator.serviceWorker?.controller);
    if (sousSw)
      await expect.poll(() => polices.filter(n => n === "Geoffrey").length, { message: "les polices demandées sous le service worker (R2)" }).toBeGreaterThan(avant);
    return "rechargée : toujours connectée, la note est là" + (sousSw ? ", les polices demandées par le service worker" : "");
  });
  await ligne(page, "K4", async () => {
    await etat(page).click();
    const f = feuille(page, "Données");
    await expect(f).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(f).toBeHidden();
    await etat(page).click();
    await expect(f).toBeVisible();
    await page.waitForTimeout(600);
    const tirette = (await f.boundingBox())!;
    await page.mouse.move(tirette.x + tirette.width / 2, tirette.y + 20);
    await page.mouse.down();
    await page.mouse.move(tirette.x + tirette.width / 2, tirette.y + 420, { steps: 12 });
    await page.mouse.up();
    await expect(f).toBeHidden({ timeout: 5_000 });
    const touch = await page.evaluate(() => {
      const d = document.createElement("div"); d.setAttribute("data-vaul-drawer", ""); document.body.appendChild(d);
      const t = getComputedStyle(d).touchAction; d.remove(); return t;
    });
    return "Échap ferme ; glissée vers le bas, elle se ferme ; touch-action de la feuille : " + touch;
  });
  await ligne(page, "K7", async () => {
    await etat(page).click();
    const son = feuille(page, "Données").getByRole("switch", { name: "Sons des gestes" });
    await expect(son).toHaveAttribute("aria-checked", "false");
    await son.click();
    await page.keyboard.press("Escape");
    await page.reload();
    await etat(page).click({ timeout: 20_000 });
    await expect(feuille(page, "Données").getByRole("switch", { name: "Sons des gestes" })).toHaveAttribute("aria-checked", "true");
    await feuille(page, "Données").getByRole("switch", { name: "Sons des gestes" }).click();
    await page.keyboard.press("Escape");
    return "éteint par défaut ; allumé, retenu après rechargement ; éteint de nouveau";
  });
  await ligne(page, "K8", async () => {
    const sortie = execSync(COMPOSE + " exec -T api node --disable-warning=ExperimentalWarning apps/api/src/cli/rappel.ts", { encoding: "utf8", stdio: "pipe" });
    const bilanRappel = JSON.parse(sortie) as { statut: string; aBlanc: boolean; envoyes: number; erreurs: unknown[] };
    const encore = JSON.parse(execSync(COMPOSE + " exec -T api node --disable-warning=ExperimentalWarning apps/api/src/cli/rappel.ts", { encoding: "utf8", stdio: "pipe" })) as { statut: string; envoyes: number };
    /* Nixon et Giorgi ont une adresse (G3), et aucune réponse pour la
       semaine qui vient : deux e-mails prévus, à blanc. L'envoi réel
       (P4 : jamais deux fois) est tenu par les tests de l'API, contre un
       faux Brevo : la recette n'envoie jamais rien. */
    expect(bilanRappel).toMatchObject({ statut: "fait", aBlanc: true, envoyes: 2, erreurs: [] });
    expect(encore).toMatchObject({ statut: "deja-faite", envoyes: 0 });
    return "à blanc : " + JSON.stringify(bilanRappel).slice(0, 200) + " ; relancée : « " + encore.statut + " »";
  });
  await ligne(page, "K5", async () => {
    await page.evaluate(() => {
      const w = window as unknown as { __k5: { max: number; vies: number[]; nes: Map<Node, number> } };
      w.__k5 = { max: 0, vies: [], nes: new Map() };
      new MutationObserver(ms => {
        for (const m of ms) {
          for (const n of Array.from(m.addedNodes)) if (n instanceof HTMLElement && n.hasAttribute("data-toast")) w.__k5.nes.set(n, performance.now());
          for (const n of Array.from(m.removedNodes)) if (w.__k5.nes.has(n)) w.__k5.vies.push(performance.now() - w.__k5.nes.get(n)!);
        }
        w.__k5.max = Math.max(w.__k5.max, document.querySelectorAll("[data-toast]").length);
      }).observe(document.body, { childList: true, subtree: true });
    });
    const brief = page.getByRole("button", { name: "Partager le brief" });
    for (let i = 0; i < 3; i++) await brief.click();
    const t = page.locator("[data-toast]").last();
    await expect(t).toBeVisible();
    await page.waitForTimeout(400);
    const geo = await t.evaluate(el => {
      const b = el.getBoundingClientRect();
      const dessous = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { centre: b.x + b.width / 2, bas: b.bottom, largeur: innerWidth, hauteur: innerHeight, traverse: !el.contains(dessous) };
    });
    await page.waitForTimeout(4_000);
    const k5 = await page.evaluate(() => { const w = window as unknown as { __k5: { max: number; vies: number[] } }; return { max: w.__k5.max, vies: w.__k5.vies.map(Math.round) }; });
    expect(k5.max).toBeLessThanOrEqual(2);
    expect(Math.abs(geo.centre - geo.largeur / 2)).toBeLessThan(2);
    expect(geo.traverse).toBe(true);
    return `trois toasts demandés : ${k5.max} à l'écran au plus ; durées de vie ${k5.vies.join(", ")} ms ; centré (${geo.centre.toFixed(1)} sur ${geo.largeur}), bas à ${Math.round(geo.bas)} sur ${geo.hauteur} ; le doigt passe au travers`;
  });
  nonJoue("H6", "la construction pour l'API n'a pas de mode local : filet, source locale (donnees.spec.ts)");
  await ligne(page, "I5", async () => {
    await etat(page).click();
    await feuille(page, "Données").getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible({ timeout: 15_000 });
    return "retour à l'écran de connexion";
  });
  await ligne(page, "I4", async () => {
    await expect(page.getByRole("button", { name: "Créer un compte" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mot de passe oublié" })).toHaveCount(0);
    return "source api : ni « Créer un compte » ni « Mot de passe oublié » ; le texte renvoie au responsable du serveur";
  });

  /* K2 : le mode sombre, sur un appareil qui le demande. */
  const sombre = await browser.newContext({ colorScheme: "dark" });
  const nuit = await appareil(sombre, "Sombre");
  await ligne(nuit, "K2", async () => {
    await connecter(nuit);
    const clarte = await nuit.evaluate(() => {
      const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number);
      return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
    });
    expect(clarte, "le fond de la page est sombre").toBeLessThan(0.25);
    await nuit.screenshot({ path: `${SORTIE}/K2-chantiers.png` });
    await nuit.getByRole("button", { name: "État des données" }).click();
    await nuit.waitForTimeout(700);
    await nuit.screenshot({ path: `${SORTIE}/K2-feuille.png` });
    await nuit.keyboard.press("Escape");
    await onglet(nuit, "Semaine").click();
    await nuit.waitForTimeout(500);
    return `fond sombre (clarté ${clarte.toFixed(2)}) ; captures : chantiers, feuille, semaine`;
  });

  /* K3 : le mouvement réduit, sur la construction de production ; le
     même tour sans, pour témoin. */
  const calme = await browser.newContext({ reducedMotion: "reduce" });
  const reduit = await appareil(calme, "Mouvement réduit");
  await releverLesMouvements(reduit);
  await ligne(reduit, "K3", async () => {
    await connecter(reduit);
    await reduit.waitForTimeout(1_000);
    await mouvements(reduit);
    await tour(reduit);
    const vus = await mouvements(reduit);
    const temoinCtx = await browser.newContext();
    const temoin = await appareil(temoinCtx, "Témoin K3");
    await releverLesMouvements(temoin);
    await connecter(temoin);
    await temoin.waitForTimeout(1_000);
    await mouvements(temoin);
    await tour(temoin);
    const bouge = await mouvements(temoin);
    await temoinCtx.close();
    writeFileSync(`${SORTIE}/K3-temoin.json`, JSON.stringify(bouge, null, 2));
    expect(vus).toEqual([]);
    expect(bouge.length).toBeGreaterThan(5);
    return `sous le mouvement réduit, rien ne bouge ; le même tour sans : ${bouge.length} mouvements (${[...new Set(bouge.map(b => b.split(" ")[0] + " " + b.split(" ")[1]))].slice(0, 8).join(", ")}…)`;
  });

  /* K1 : le bureau, à la souris. */
  const bureau = await browser.newContext({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1, userAgent: undefined });
  const ecran = await appareil(bureau, "Bureau");
  await ligne(ecran, "K1", async () => {
    await connecter(ecran);
    await jours(ecran).nth(0).click();
    // Toute l'équipe est posée cette semaine : on rend une puce au vivier, puis on la repose.
    const { sid, puce } = await pucePosee(ecran, "Sydney");
    const code = (await carte(ecran, sid).locator("[data-code]").first().innerText()).trim();
    await glisser(ecran, puce, vivier(ecran));
    await vuToast(ecran, "Sydney retiré de " + code);
    await montrerZone(ecran, sid);
    await glisser(ecran, puceVivier(ecran, "Sydney"), zone(ecran, sid));
    await vuToast(ecran, "Sydney sur " + code);
    await expect(puceSur(ecran, sid, "Sydney")).toBeVisible();
    await ecran.screenshot({ path: `${SORTIE}/K1-bureau.png` });
    return `1280 × 800, à la souris : Sydney rendu au vivier, puis reposé sur ${code}`;
  });

  writeFileSync(`${SORTIE}/bilan.json`, JSON.stringify({ bilan, refus, erreurs }, null, 2));
  /* La recette ne passe que si chaque ligne jouée a fonctionné, sans un
     refus de la politique de sécurité ni une erreur dans la console. */
  expect.soft(bilan.filter(l => l.verdict === "ÉCHEC").map(l => l.ref + " : " + l.note)).toEqual([]);
  expect.soft(refus).toEqual([]);
  expect.soft(erreurs).toEqual([]);
});
