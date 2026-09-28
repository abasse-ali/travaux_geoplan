/* P7. La construction de production, sous la politique de sécurité de
   nginx (infra/nginx/securite.conf, que `vite preview` applique : voir
   e2e/vite.config.ts). Une feuille de style que la page crée elle-même
   est refusée si la politique ne l'admet pas : celle de vaul portait le
   geste qui ferme une feuille du bas (touch-action), celle de Radix le
   défilement bloqué derrière elle. Une montée de version qui change leur
   texte, une bibliothèque qui en ajoute une : ce test échoue. */

import { expect, test } from "@playwright/test";
import { openLocal } from "./helpers";

test("P7 — sous la politique de sécurité de production, rien n'est refusé, et la feuille du bas garde ses styles", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __refus: string[] };
    w.__refus = [];
    document.addEventListener("securitypolicyviolation",
      e => w.__refus.push(e.effectiveDirective + " : " + (e.blockedURI || "en ligne") + " " + e.sample));
  });
  const politique = (await page.request.get("/")).headers()["content-security-policy"] ?? "";
  expect(politique, "la construction est servie sous la politique de nginx").toContain("style-src 'self'");
  await openLocal(page);
  await page.getByRole("button", { name: "État des données" }).click();
  await expect(page.getByRole("dialog", { name: "Données" })).toBeVisible();
  expect(await page.locator("[data-vaul-drawer]").evaluate(el => getComputedStyle(el).touchAction)).toBe("none");
  expect(await page.evaluate(() => (window as unknown as { __refus: string[] }).__refus)).toEqual([]);
});

/* R2 (relecture de la recette, W8). Le service worker reçoit la politique
   de sécurité avec son propre script (/sw.js) : c'est elle qui décide de
   ce qu'il peut aller chercher. Il sert les polices de Google (sa règle
   « polices ») ; sans elles dans connect-src, il ne pouvait plus les
   chercher, et dès la deuxième ouverture l'application et la page du
   compagnon perdaient Archivo, Public Sans et IBM Plex Mono. */
test("R2 — sous sa politique de sécurité, le service worker peut aller chercher les polices", async ({ page, context, browserName }) => {
  const politique = (await page.request.get("/sw.js")).headers()["content-security-policy"] ?? "";
  const connect = /(?:^|;)\s*connect-src ([^;]+)/.exec(politique)?.[1] ?? "";
  expect(connect).toContain("https://fonts.googleapis.com");
  expect(connect).toContain("https://fonts.gstatic.com");

  test.skip(browserName !== "chromium", "seul Chromium laisse un test intercepter les requêtes d'un service worker");
  const vues: string[] = [];
  await context.route(/fonts\.googleapis\.com/, r => { vues.push(r.request().url()); return r.fulfill({ contentType: "text/css", body: "/* polices */" }); });
  await context.route(/fonts\.gstatic\.com/, r => r.fulfill({ status: 404 }));
  await openLocal(page);
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });
  // Relancée, la page est servie par le service worker : c'est lui qui va chercher les polices.
  await page.reload();
  await expect(page.getByRole("banner")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => vues.length, { message: "le service worker a demandé la feuille des polices" }).toBeGreaterThan(0);
});
