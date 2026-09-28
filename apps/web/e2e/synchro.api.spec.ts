/* ============================================================
   S. La synchronisation, contre la vraie API (source api)

   Ce que seule une source distante peut montrer : un geste qui attend
   le réseau, deux appareils qui se voient, un geste refusé par le
   serveur. Les règles fines de la file ont leurs tests unitaires
   (apps/web/tests/synchro.test.ts) ; ici, on vérifie qu'elles tiennent
   dans le navigateur, face au serveur.
   ============================================================ */

import { devices, expect, test, type Page } from "@playwright/test";
import {
  NOW, S9, TODAY, carte, glisser, montrerZone, openLocal, puceSur, puceVivier, vuToast, zone
} from "./helpers";

test.describe.configure({ timeout: 90_000 });

const etat = (page: Page) => page.getByRole("button", { name: "État des données" });
const affectationsDuJour = async () => {
  const { lireBase } = await import("./api/amorcer");
  return lireBase("SELECT site_id, person_id FROM assignments WHERE day = ? ORDER BY site_id, position", [TODAY]);
};

test("S1 — un geste fait hors ligne se voit, attend, puis part au retour du réseau", async ({ page }) => {
  await openLocal(page);
  await page.context().setOffline(true);
  await montrerZone(page, S9);
  await glisser(page, puceVivier(page, "Nixon"), zone(page, S9));
  await vuToast(page, "Nixon sur 9MD49");
  await expect(puceSur(page, S9, "Nixon")).toBeVisible();          // affiché sans attendre le réseau
  await expect(etat(page)).toHaveText(/^1 en attente$/i);
  expect(await affectationsDuJour()).toEqual([]);

  await page.context().setOffline(false);
  await expect(etat(page)).toHaveText(/^à jour$/i, { timeout: 20_000 });
  expect(await affectationsDuJour()).toEqual([{ site_id: S9, person_id: "p_nixon" }]);
  await expect(puceSur(page, S9, "Nixon")).toBeVisible();
});

test("S2 — deux appareils : ce que l'un pose apparaît chez l'autre, sans recharger", async ({ page, browser }) => {
  await openLocal(page);
  const cookies = await page.context().cookies();
  const autre = await browser.newContext({
    ...devices["iPhone 15"], locale: "fr-FR", timezoneId: "Europe/Paris",
    baseURL: test.info().project.use.baseURL, serviceWorkers: "block"
  });
  try {
    await autre.addCookies(cookies);
    const b = await autre.newPage();
    await b.clock.setFixedTime(NOW);
    await b.goto("/");
    await expect(b.locator("article[data-site]")).toHaveCount(3, { timeout: 20_000 });
    await expect(puceSur(b, S9, "Nixon")).toHaveCount(0);

    await montrerZone(page, S9);
    await glisser(page, puceVivier(page, "Nixon"), zone(page, S9));
    await vuToast(page, "Nixon sur 9MD49");
    await expect(puceSur(b, S9, "Nixon")).toBeVisible({ timeout: 15_000 });
    await expect(b.getByRole("button", { name: "État des données" })).toHaveText(/^à jour$/i);
  } finally { await autre.close(); }
});

test("S3 — un geste refusé pour de bon sort de la file, et on le dit (S8)", async ({ page }) => {
  await openLocal(page);
  await page.context().setOffline(true);
  await montrerZone(page, S9);
  await glisser(page, puceVivier(page, "Nixon"), zone(page, S9));
  await vuToast(page, "Nixon sur 9MD49");
  await expect(etat(page)).toHaveText(/^1 en attente$/i);

  /* Pendant ce temps, le chantier est supprimé sur un autre appareil. */
  const { ecrireBase } = await import("./api/amorcer");
  await ecrireBase("DELETE FROM sites WHERE id = ?", [S9]);

  await page.context().setOffline(false);
  await vuToast(page, "Modification annulée : Chantier introuvable", 20_000);
  await expect(etat(page)).toHaveText(/^à jour$/i);
  await expect(carte(page, S9)).toHaveCount(0);
  expect(await affectationsDuJour()).toEqual([]);
});

test("S4 — une fiche n'envoie que ce qu'on y a changé : la modification d'un autre appareil reste", async ({ page }) => {
  const { lireBase, ecrireBase } = await import("./api/amorcer");
  await openLocal(page, { ui: { tab: "equipe" } });
  await page.locator("[data-personne]").filter({ hasText: "Nixon" }).click();
  const fiche = page.getByRole("dialog", { name: "Nixon" });
  await expect(fiche).toBeVisible();
  /* Pendant que la fiche est ouverte ici, un autre appareil change le
     téléphone de Nixon. */
  await ecrireBase("UPDATE people SET phone = ?, version = version + 1 WHERE id = ?", ["+33699999999", "p_nixon"]);
  await fiche.getByPlaceholder("Spécialité, contrainte…").fill("casque neuf");
  await fiche.getByRole("button", { name: "Enregistrer" }).click();
  await expect(etat(page)).toHaveText(/^à jour$/i, { timeout: 20_000 });
  expect(await lireBase("SELECT phone, note FROM people WHERE id = ?", ["p_nixon"]))
    .toEqual([{ phone: "+33699999999", note: "casque neuf" }]);
});
