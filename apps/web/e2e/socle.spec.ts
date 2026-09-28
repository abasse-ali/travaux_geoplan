/* Le socle tient-il ? Si ces deux tests échouent, tous les autres
   échoueront pour de mauvaises raisons. */

import { expect, test } from "@playwright/test";
import { FAKE_SUPABASE, openLocal, source, useFakeSupabase } from "./helpers";

test("l'application démarre en mode local, sans écran de connexion", async ({ page }) => {
  test.skip(source() !== "local", "propre au mode local");
  await openLocal(page);
  await expect(page.getByText("Mode local", { exact: false })).toBeVisible();
  await expect(page.locator("article[data-site]")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "État des données" })).toHaveText(/local/i);
});

test("l'application démarre sur son serveur, déjà connectée, et dit « À jour »", async ({ page }) => {
  test.skip(source() === "local", "propre aux sources distantes");
  await openLocal(page);
  await expect(page.locator("article[data-site]")).toHaveCount(3);
  await expect(page.getByText("Mode local", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "État des données" })).toHaveText(/^à jour$/i);
});

test("la page compagnon parle au faux Supabase, et à lui seul", async ({ page }) => {
  test.skip(source() !== "local", "la source api a sa propre page compagnon (dispo.api.spec.ts)");
  await useFakeSupabase(page);
  const vus: string[] = [];
  await page.route(/supabase\.co/, route => {
    vus.push(route.request().url());
    if (route.request().url().endsWith("/rpc/avail_get"))
      return route.fulfill({ json: { name: "Nixon", week: "2026-09-21", days: null, note: "", answered: false } });
    return route.abort();
  });
  await page.goto("/dispo.html?t=jeton-factice");
  // Au tout premier lancement, Vite prépare ses dépendances : on laisse le temps.
  await expect(page.getByText("Bonjour Nixon")).toBeVisible({ timeout: 20_000 });
  expect(vus.every(u => u.startsWith(FAKE_SUPABASE.url))).toBe(true);
});
