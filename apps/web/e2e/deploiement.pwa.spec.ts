/* R1 (relecture de la recette, W8). Après un déploiement, le nouveau
   service worker s'installe pendant que l'ancienne construction tourne
   encore : à son activation, il retire du cache les morceaux de
   l'ancienne, et le serveur ne les a plus. Un morceau que la page
   n'avait pas encore chargé devient introuvable : les fiches (et le
   temps réel) ne se chargeaient plus jusqu'au relancement suivant.
   Elles se chargeaient 1,2 s après l'ouverture de l'application, qui
   attend la session : trop tard quand l'API redémarre avec le
   déploiement. Servies par le cache du service worker, elles ne coûtent
   rien au lancement : elles se chargent avant même le premier dessin. */

import { expect, test, type Page } from "@playwright/test";
import { effectif } from "./helpers";

test.describe.configure({ timeout: 90_000 });

/* Comme openLocal, mais sans figer l'heure : l'horloge de Playwright
   remplace aussi `performance`, dont ce test lit les chargements. */
async function ouvrir(page: Page): Promise<void> {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const e = effectif();
  await page.addInitScript(data => {
    if (sessionStorage.getItem("__e2e_seeded")) return;
    sessionStorage.setItem("__e2e_seeded", "1");
    localStorage.setItem("geoplan.cache.v1", JSON.stringify({ people: data.people, sites: data.sites, avail: [], dirty: [], gone: [] }));
  }, e);
  await page.goto("/");
  await expect(page.getByRole("banner")).toBeVisible({ timeout: 20_000 });
}

test("R1 — sous un service worker, les fiches se chargent avant le premier dessin, et un déploiement ne les perd plus", async ({ page, context, browserName }) => {
  await ouvrir(page);
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });

  /* Relancée sous le service worker. L'heure du premier dessin de la
     coque : l'insertion de sa bannière. */
  await page.addInitScript(() => {
    const w = window as unknown as { __banniere?: number };
    new MutationObserver((_, o) => {
      if (document.querySelector("header")) { w.__banniere = performance.now(); o.disconnect(); }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(page.getByRole("banner")).toBeVisible({ timeout: 20_000 });
  const { feuilles, banniere } = await page.evaluate(async () => {
    const trouve = () => performance.getEntriesByType("resource").find(e => /\/assets\/Feuilles-[^/]+\.js$/.test(e.name));
    for (let i = 0; i < 50 && !trouve(); i++) await new Promise(r => setTimeout(r, 100));
    return { feuilles: trouve()?.startTime ?? null, banniere: (window as unknown as { __banniere?: number }).__banniere ?? null };
  });
  expect(feuilles, "le morceau des fiches est demandé").not.toBeNull();
  expect(banniere, "la bannière est dessinée").not.toBeNull();
  expect(feuilles!, "demandé avant le premier dessin").toBeLessThan(banniere!);

  /* Le déploiement : le morceau quitte le cache et le serveur. */
  test.skip(browserName !== "chromium", "seul Chromium laisse un test intercepter les requêtes d'un service worker");
  await context.route(/\/assets\/Feuilles-[^/]+\.js$/, r => r.fulfill({ status: 404, body: "" }));
  await page.evaluate(async () => {
    for (const n of await caches.keys()) {
      const c = await caches.open(n);
      for (const q of await c.keys()) if (/\/assets\/Feuilles-/.test(q.url)) await c.delete(q);
    }
  });
  await page.getByRole("button", { name: "État des données" }).click();
  await expect(page.getByRole("dialog", { name: "Données" })).toBeVisible();
});
