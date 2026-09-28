/* J. La page compagnon, contre la vraie API (source api).

   Le même parcours que dispo.spec.ts, mais de bout en bout : la page
   lit et répond par GET et POST /api/dispo/<jeton>, la réponse est en
   base, et l'application de Geoffrey, ouverte ailleurs, la voit arriver. */

import { expect, test } from "@playwright/test";
import { WEEK, compagnon, effectifAvec, openLocal, vuToast } from "./helpers";

const JETON = "jeton-nixon-0123456789";

/* L'effectif, avec une demande en attente pour Nixon cette semaine. */
const seed = () => ({
  ...effectifAvec(e => { compagnon(e, "p_nixon").email = "nixon@exemple.fr"; }),
  avail: [{ id: "p_nixon@" + WEEK, token: JETON, personId: "p_nixon", week: WEEK, days: null, note: "", answeredAt: null }]
});

test("J1 — le compagnon répond ; la réponse est en base, et l'application ouverte la voit arriver", async ({ page, context }) => {
  await openLocal(page, { ...seed(), ui: { tab: "equipe" } });
  const ligne = page.locator("[data-personne]").filter({ hasText: "Nixon" });
  await expect(ligne.getByText("relancé")).toBeVisible();

  const compagnonPage = await context.newPage();
  await compagnonPage.goto("/dispo.html?t=" + JETON);
  await expect(compagnonPage.getByRole("heading", { name: "Bonjour Nixon" })).toBeVisible({ timeout: 20_000 });
  for (const jour of ["Lundi", "Mercredi"])
    await compagnonPage.getByRole("button", { name: new RegExp("^" + jour) }).click();
  await compagnonPage.getByPlaceholder("Un mot à ajouter ? (facultatif)").fill("Je finis tôt le mercredi");
  await compagnonPage.getByRole("button", { name: "Envoyer mes disponibilités" }).click();
  await expect(compagnonPage.getByRole("heading", { name: "C'est envoyé, merci Nixon" })).toBeVisible();

  const { lireBase } = await import("./api/amorcer");
  expect(await lireBase("SELECT days, note, answered_at IS NOT NULL AS repondu FROM avail_requests"))
    .toEqual([{ days: [true, false, true, false, false, false, false], note: "Je finis tôt le mercredi", repondu: 1 }]);

  /* L'application de Geoffrey, restée ouverte : le toast, et la ligne. */
  await vuToast(page, "Nixon a répondu pour la semaine 38", 15_000);
  await expect(ligne.getByText("a répondu")).toBeVisible();
});

test("J2 — un lien inconnu dit « Lien expiré », sans rien révéler", async ({ page }) => {
  await openLocal(page, seed());
  await page.goto("/dispo.html?t=jeton-qui-n-existe-pas-0123");
  await expect(page.getByRole("heading", { name: "Lien expiré" })).toBeVisible({ timeout: 20_000 });
  await page.goto("/dispo.html");
  await expect(page.getByRole("heading", { name: "Lien incomplet" })).toBeVisible();
});

test("J3 — la page compagnon ne charge rien de Supabase", async ({ page }) => {
  await openLocal(page, seed());
  const demandes: string[] = [];
  page.on("request", r => demandes.push(r.url()));
  await page.goto("/dispo.html?t=" + JETON);
  await expect(page.getByRole("heading", { name: "Bonjour Nixon" })).toBeVisible({ timeout: 20_000 });
  expect(demandes.filter(u => /supabase/i.test(u))).toEqual([]);
});
