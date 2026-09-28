/* A. Se repérer dans le temps : la bande des jours, les semaines,
   « Auj. », les onglets. */

import { expect, test } from "@playwright/test";
import { S9, carte, glisser, jours, montrerZone, onglet, openLocal, puceSur, puceVivier, relire, vuToast, zone } from "./helpers";

test.describe.configure({ timeout: 60_000 });

test("A1 — toucher un jour l'affiche, la pastille le suit, et la suite s'affecte à ce jour", async ({ page }) => {
  await openLocal(page);
  await expect(jours(page).nth(2)).toHaveAttribute("aria-selected", "true");
  await jours(page).nth(3).click();
  await expect(jours(page).nth(3)).toHaveAttribute("aria-selected", "true");
  await expect(jours(page).nth(2)).toHaveAttribute("aria-selected", "false");
  await expect(page.locator("[data-bandeau-jour]")).toHaveText("Jeudi");
  await expect(page.locator("[data-bandeau-resume]")).toHaveText("17 sept. · 0 chantier");
  await expect(zone(page, S9).locator("[data-zone-titre]")).toHaveText("Jeudi 17 sept. · 0");

  // La pastille glisse sous le jour choisi.
  await expect.poll(async () => {
    const p = await page.locator("[data-jour-actif]").boundingBox();
    const t = await jours(page).nth(3).boundingBox();
    return p && t ? Math.abs(p.x - t.x) : 999;
  }).toBeLessThan(2);

  // Kia ne vient que le jeudi : il est dans le vivier, et c'est jeudi qu'il est posé.
  await montrerZone(page, S9);
  await glisser(page, puceVivier(page, "Kia"), zone(page, S9));
  await vuToast(page, "Kia sur 9MD49 · jeudi 17 sept.");
  await relire(page);
  await expect(puceSur(page, S9, "Kia")).toBeVisible();
  await jours(page).nth(2).click();
  await expect(zone(page, S9).locator("[data-zone-titre]")).toHaveText("Mercredi 16 sept. · 0");
  await expect(puceSur(page, S9, "Kia")).toHaveCount(0);
});

test("A2 — changer de semaine garde le jour, et grise le libellé hors de la semaine courante", async ({ page }) => {
  await openLocal(page);
  const libelle = page.locator("[data-semaine]");
  await expect(libelle).toHaveText("Sem. 38 · 14 – 20 sept.");
  await expect(libelle).not.toHaveAttribute("data-hors-semaine");

  await page.getByRole("button", { name: "Semaine suivante" }).click();
  await expect(libelle).toHaveText("Sem. 39 · 21 – 27 sept.");
  await expect(libelle).toHaveAttribute("data-hors-semaine");
  await expect(jours(page).nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(jours(page).nth(2)).toHaveText("Mer23");
  await expect(zone(page, S9).locator("[data-zone-titre]")).toHaveText("Mercredi 23 sept. · 0");

  await page.getByRole("button", { name: "Semaine précédente" }).click();
  await page.getByRole("button", { name: "Semaine précédente" }).click();
  await expect(libelle).toHaveText("Sem. 37 · 7 – 13 sept.");
  await expect(libelle).toHaveAttribute("data-hors-semaine");
  await expect(jours(page).nth(2)).toHaveText("Mer9");

  // D'un mois à l'autre, la plage nomme les deux mois.
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Semaine suivante" }).click();
  await expect(libelle).toHaveText("Sem. 41 · 5 – 11 oct.");
  await page.getByRole("button", { name: "Semaine précédente" }).click();
  await expect(libelle).toHaveText("Sem. 40 · 28 sept. – 4 oct.");
});

test("A2 — deux appuis rapides sur « Semaine suivante » avancent de deux semaines", async ({ page }) => {
  /* Relecture adversariale de W5 (défaut déjà en W4) : au premier appui,
     « Auj. » apparaissait à la place exacte de la flèche, qui glissait à
     gauche ; le second appui, au même endroit, tombait sur « Auj. » et
     ramenait à aujourd'hui. Les flèches ne bougent plus. Un doigt ne
     vise pas deux fois : les deux appuis tombent au même point. */
  await openLocal(page);
  const suivante = page.getByRole("button", { name: "Semaine suivante" });
  const avant = (await suivante.boundingBox())!;
  const x = avant.x + avant.width / 2, y = avant.y + avant.height / 2;
  await page.mouse.click(x, y);
  await page.waitForTimeout(120);
  await page.mouse.click(x, y);
  await expect(page.locator("[data-semaine]")).toHaveAttribute("data-semaine", "2026-09-28");
  await expect(page.getByRole("button", { name: "Auj." })).toBeVisible();
  expect((await suivante.boundingBox())!.x).toBeCloseTo(avant.x, 0);
});

test("A3 — « Auj. » n'apparaît qu'hors du jour courant et y ramène", async ({ page }) => {
  await openLocal(page);
  const auj = page.getByRole("button", { name: "Auj." });
  await expect(auj).toHaveCount(0);

  await jours(page).nth(4).click();
  await expect(auj).toBeVisible();
  await auj.click();
  await expect(auj).toHaveCount(0);
  await expect(jours(page).nth(2)).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Semaine suivante" }).click();
  await page.getByRole("button", { name: "Semaine suivante" }).click();
  await jours(page).nth(0).click();
  await auj.click();
  await expect(page.locator("[data-semaine]")).toHaveText("Sem. 38 · 14 – 20 sept.");
  await expect(jours(page).nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(auj).toHaveCount(0);
});

test("A4 — les onglets changent d'écran et remontent en haut ; l'onglet se retient, pas le jour", async ({ page }) => {
  await openLocal(page);
  const liste = page.locator("main");
  await liste.evaluate(el => { el.scrollTop = 600; });

  await onglet(page, "Semaine").click();
  await expect(onglet(page, "Semaine")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Répartir toute l'équipe sur la semaine" })).toBeVisible();
  // Les fiches sortent en fondu : sous charge, l'animation de sortie dure.
  await expect(page.locator("article[data-site]")).toHaveCount(0, { timeout: 15_000 });
  expect(await liste.evaluate(el => el.scrollTop)).toBe(0);

  await onglet(page, "Équipe").click();
  await expect(page.getByText("Effectif · semaine 38")).toBeVisible();

  // On change de jour et de semaine, puis on relance l'application.
  await page.getByRole("button", { name: "Semaine suivante" }).click();
  await jours(page).nth(4).click();
  await page.reload();
  await expect(onglet(page, "Équipe")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Effectif · semaine 38")).toBeVisible();
  await expect(page.locator("[data-semaine]")).toHaveText("Sem. 38 · 14 – 20 sept.");
  await expect(jours(page).nth(2)).toHaveAttribute("aria-selected", "true");

  await onglet(page, "Chantiers").click();
  await expect(carte(page, S9)).toBeVisible();
});

test("A5 — une case ou un en-tête de la grille Semaine ramène aux Chantiers, à ce jour-là", async ({ page }) => {
  await openLocal(page);
  await onglet(page, "Semaine").click();
  await page.locator('[data-grille-semaine] [data-ligne="entete"] [data-case]').nth(4).click();
  await expect(onglet(page, "Chantiers")).toHaveAttribute("aria-selected", "true");
  await expect(jours(page).nth(4)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-bandeau-jour]")).toHaveText("Vendredi");

  await onglet(page, "Semaine").click();
  await page.getByRole("button", { name: "12AB49 Lundi : personne" }).click();
  await expect(onglet(page, "Chantiers")).toHaveAttribute("aria-selected", "true");
  await expect(jours(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-bandeau-jour]")).toHaveText("Lundi");

  // Relecture adversariale : sur la case du lundi, un décalage d'un jour
  // ne se voyait pas. Le jeudi le montre.
  await onglet(page, "Semaine").click();
  await page.getByRole("button", { name: "12AB49 Jeudi : personne" }).click();
  await expect(onglet(page, "Chantiers")).toHaveAttribute("aria-selected", "true");
  await expect(jours(page).nth(3)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-bandeau-jour]")).toHaveText("Jeudi");
});

test("A6 — au clavier, les flèches changent d'onglet et de jour ; la liste est le panneau de l'onglet", async ({ page }) => {
  // Depuis W5, onglets et jours sont les Tabs de Radix (primitives/onglets.tsx).
  await openLocal(page);
  await expect(page.getByRole("tabpanel", { name: "Chantiers" })).toBeVisible();

  await onglet(page, "Chantiers").focus();
  await page.keyboard.press("ArrowRight");
  await expect(onglet(page, "Semaine")).toHaveAttribute("aria-selected", "true");
  await expect(onglet(page, "Semaine")).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Semaine" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Répartir toute l'équipe sur la semaine" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(onglet(page, "Chantiers")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Chantiers" })).toBeVisible();

  await jours(page).nth(2).focus();
  await page.keyboard.press("ArrowRight");
  await expect(jours(page).nth(3)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-bandeau-jour]")).toHaveText("Jeudi");
  /* Radix déplace le focus un instant après la touche (setTimeout) : deux
     appuis à 13 ms d'écart partaient tous deux du jeudi. On attend que le
     focus ait bougé, comme le ferait un doigt. */
  await page.keyboard.press("ArrowLeft");
  await expect(jours(page).nth(2)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(jours(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-bandeau-jour]")).toHaveText("Mardi");
});
