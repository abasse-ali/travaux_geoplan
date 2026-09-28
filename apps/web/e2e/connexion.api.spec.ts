/* I. La connexion, contre la vraie API (source api) — ADR-002.

   Un mot de passe, une session de 180 jours, et aucun lien ni code
   reçu : un compte se crée, et un mot de passe se change, sur le
   serveur. L'écran le dit au lieu de proposer ce qui n'aboutirait pas
   (constat U9). */

import { expect, test } from "@playwright/test";
import { openLocal } from "./helpers";

const MOT_DE_PASSE = "cheval-agrafe-pile-42";

test("I1 — sans session : l'écran de connexion, sans « Créer un compte » ni lien reçu", async ({ page }) => {
  await openLocal(page, { sansSession: true });
  await expect(page.getByRole("heading", { name: "Geoplan" })).toBeVisible();
  const email = page.getByPlaceholder("vous@exemple.fr");
  await expect(email).toHaveAttribute("autocomplete", "username");
  await expect(page.getByPlaceholder("Mot de passe")).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByRole("button", { name: "Créer un compte" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mot de passe oublié" })).toHaveCount(0);
  await expect(page.getByText("le responsable du serveur le crée ou le change", { exact: false })).toBeVisible();
  await expect(page.locator("article[data-site]")).toHaveCount(0);
});

test("I2 — un mauvais mot de passe est dit en clair ; le bon ouvre l'application, et la session tient", async ({ page }) => {
  await openLocal(page, { sansSession: true, motDePasse: MOT_DE_PASSE });
  await page.getByPlaceholder("vous@exemple.fr").fill("Geoffrey@Geoplan.test");
  await page.getByPlaceholder("Mot de passe").fill("mauvais-mot");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Adresse ou mot de passe incorrect.")).toBeVisible();

  await page.getByPlaceholder("Mot de passe").fill(MOT_DE_PASSE);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.locator("article[data-site]")).toHaveCount(3, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "État des données" })).toHaveText(/^à jour$/i);

  await page.reload();
  await expect(page.locator("article[data-site]")).toHaveCount(3, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Se connecter" })).toHaveCount(0);
});
