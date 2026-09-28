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
