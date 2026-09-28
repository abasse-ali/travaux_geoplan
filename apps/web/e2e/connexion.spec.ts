/* I. Connexion — l'écran d'entrée quand une base est configurée. On pose
   les clés factices : l'application passe en mode connecté, sans session
   enregistrée, et parle au faux Supabase que le test intercepte. */

import { expect, test } from "@playwright/test";
import { FAKE_SUPABASE, useFakeSupabase } from "./helpers";

test.describe.configure({ timeout: 60_000 });

test("I1 — premier lancement connecté : l'écran « Geoplan », prêt pour le trousseau iOS", async ({ page }) => {
  await useFakeSupabase(page);
  await page.route(/supabase\.co/, r => r.abort());
  await page.goto("/");
  // En mode connecté, supabase-js est chargé à la demande avant de
  // trancher : sur une machine chargée, cela prend plusieurs secondes.
  await expect(page.getByRole("heading", { name: "Geoplan" })).toBeVisible({ timeout: 20_000 });
  const email =page.getByPlaceholder("vous@exemple.fr");
  const mdp = page.getByPlaceholder("Mot de passe");
  const entrer = page.getByRole("button", { name: "Se connecter" });

  // Les noms que le trousseau cherche.
  await expect(email).toHaveAttribute("name", "email");
  await expect(email).toHaveAttribute("autocomplete", "username");
  await expect(mdp).toHaveAttribute("name", "password");
  await expect(mdp).toHaveAttribute("autocomplete", "current-password");

  // Inactif tant que l'e-mail fait 3 caractères ou moins, ou le mot de passe moins de 6.
  await expect(entrer).toBeDisabled();
  await email.fill("a@b");
  await mdp.fill("secret");
  await expect(entrer).toBeDisabled();
  await email.fill("a@bc");
  await mdp.fill("court");
  await expect(entrer).toBeDisabled();
  await mdp.fill("secret");
  await expect(entrer).toBeEnabled();

  // Pas de bandeau « Mode local », pas de fiches.
  await expect(page.getByText("Mode local", { exact: false })).toHaveCount(0);
  await expect(page.locator("article[data-site]")).toHaveCount(0);
});

test("I2 — une erreur de connexion est dite en clair", async ({ page }) => {
  await useFakeSupabase(page);
  const essais: string[] = [];
  await page.route(/supabase\.co/, route => {
    const url = route.request().url();
    if (url.startsWith(FAKE_SUPABASE.url + "/auth/v1/token")) {
      essais.push(url);
      return route.fulfill({ status: 400, json: {
        code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials",
        error: "invalid_grant", error_description: "Invalid login credentials"
      } });
    }
    return route.abort();
  });
  await page.goto("/");
  await expect(page.getByPlaceholder("vous@exemple.fr")).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder("vous@exemple.fr").fill("geoffrey@exemple.fr");
  await page.getByPlaceholder("Mot de passe").fill("mauvais-mot");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Adresse ou mot de passe incorrect. Si vous n'avez pas encore de compte, créez-le.")).toBeVisible();
  expect(essais).toHaveLength(1);
  expect(essais[0]).toContain("grant_type=password");
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeEnabled();
});
