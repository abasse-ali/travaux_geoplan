/* J10 — le lien du samedi suivant, sur un téléphone où la page a déjà
   été ouverte. Projet « pwa » : build de production, service worker
   actif. WebKit sous Windows gère bien les service workers ici :
   l'installation et le contrôle de la page ont été vérifiés. */

import { expect, test, type Page } from "@playwright/test";
import { NOW } from "./helpers";

test.describe.configure({ timeout: 90_000 });

/* Le faux Supabase est servi par le serveur de test lui-même (voir
   e2e/vite.config.ts, /__faux-supabase) : une fois la page contrôlée par
   le service worker, ses requêtes échappent à page.route, et elles ne
   doivent pas partir sur le réseau. « a » est Nixon, « b » est Giorgi.
   Toute requête vers un domaine *.supabase.co fait échouer le test. */
async function fauxServeur(page: Page, baseURL: string): Promise<string[]> {
  const sorties: string[] = [];
  page.context().on("request", r => { if (/supabase\.co/.test(r.url())) sorties.push(r.url()); });
  await page.clock.setFixedTime(NOW);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.addInitScript(cfg => { (globalThis as Record<string, unknown>).__GEOPLAN_E2E__ = cfg; },
    { url: baseURL + "/__faux-supabase", key: "sb_publishable_e2e_factice_0123456789" });
  return sorties;
}

test("J10 — le premier lien ouvre le formulaire et installe le service worker", async ({ page, baseURL }) => {
  const sorties = await fauxServeur(page, baseURL!);
  await page.goto("/dispo.html?t=a");
  await expect(page).toHaveTitle("Mes disponibilités — Geoplan");
  await expect(page.getByRole("heading", { name: "Bonjour Nixon" })).toBeVisible();
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });
  expect(sorties).toEqual([]);
});

test("J10 — un nouveau lien, une fois le service worker installé, ouvre encore le formulaire", async ({ page, baseURL }) => {
  // Constat P1, corrigé : le service worker répondait à toute navigation
  // par index.html, et /dispo.html?t=b ne correspondait pas à l’entrée
  // précachée « dispo.html » à cause du paramètre t. On voyait le titre
  // « Geoplan — chantiers » et l’écran de connexion de l’application.
  const sorties = await fauxServeur(page, baseURL!);
  await page.goto("/dispo.html?t=a");
  await expect(page.getByRole("heading", { name: "Bonjour Nixon" })).toBeVisible();
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });

  await page.goto("/dispo.html?t=b");
  await expect(page).toHaveTitle("Mes disponibilités — Geoplan", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Bonjour Giorgi" })).toBeVisible();
  expect(sorties).toEqual([]);
});
