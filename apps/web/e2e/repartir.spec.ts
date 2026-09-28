/* E. Répartir toute l'équipe sur la semaine, et la grille Semaine.

   Le détail du plan est figé par le golden master ; ici, le geste : la
   feuille, « Appliquer ce plan », et ce que la grille montre ensuite. */

import { expect, test, type Page } from "@playwright/test";
import { JOURS, S12, S30, S9, TODAY, chantier, effectifAvec, feuille, grille, onglet, openLocal, poser, vuToast } from "./helpers";

test.describe.configure({ timeout: 60_000 });

const JOURS_L = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const RAISON = /^(débloque .+ niv\. \d|.+ \d\/5|main-d'œuvre|permis|suite de la veille|chantier en retard|rien à sa portée ici|encadré|novice sans encadrement)$/;

async function ouvrirRepartir(page: Page) {
  await onglet(page, "Semaine").click();
  await page.getByRole("button", { name: "Répartir toute l'équipe sur la semaine" }).click();
  const f = feuille(page, "Répartir la semaine");
  await expect(f).toBeVisible();
  return f;
}

test("E1 — « Répartir toute l'équipe » propose un plan jour par jour", async ({ page }) => {
  await openLocal(page);
  const f = await ouvrirRepartir(page);
  await expect(f.locator("header p")).toHaveText("Semaine 38 · 14 – 20 sept.");
  await expect(f.locator("[data-encart]").first()).toContainText(/^\d+ journées? réparties? sur 3 chantiers\./);

  // « Ce que personne ne couvre » : six lignes au plus.
  const trous = f.locator("[data-champ]", { hasText: "Ce que personne ne couvre" }).locator("[data-couverture]");
  expect(await trous.count()).toBeLessThanOrEqual(6);

  // Sept jours dépliables ; le jour affiché (mercredi) est ouvert.
  const jours = f.locator("button[aria-expanded]");
  await expect(jours).toHaveCount(7);
  await expect(jours.nth(0)).toContainText("Lundi 14 sept.");
  await expect(jours.nth(2)).toHaveAttribute("aria-expanded", "true");
  await expect(jours.nth(0)).toHaveAttribute("aria-expanded", "false");
  const lignes = f.locator("[data-chantier]");
  await expect(lignes.first()).toBeVisible();
  for (const code of await lignes.locator("[data-code]").allTextContents()) expect(["9MD49", "12AB49", "30JA90"]).toContain(code);
  // Chaque nom porte ses raisons, prises dans la liste connue.
  for (const r of await lignes.locator("[data-affecte] [data-etiquette]").allTextContents()) expect(r.trim()).toMatch(RAISON);

  // Un autre jour se déplie, le mercredi se replie.
  await jours.nth(0).click();
  await expect(jours.nth(0)).toHaveAttribute("aria-expanded", "true");
  await expect(jours.nth(2)).toHaveAttribute("aria-expanded", "false");
  // Samedi : personne n'est disponible.
  await jours.nth(5).click();
  await expect(f.getByText("Personne de disponible.")).toBeVisible();
});

test("E1 — chaque nom du plan porte au moins une raison", async ({ page }) => {
  // Constat D1, corrigé : après la passe d’échanges, les raisons ne
  // suivaient pas les personnes échangées ; sur l’effectif de référence,
  // Amir et Chaggy s’affichaient sans raison le mardi.
  await openLocal(page);
  const f = await ouvrirRepartir(page);
  const sansRaison: string[] = [];
  for (let i = 0; i < 7; i++) {
    const jour = f.locator("button[aria-expanded]").nth(i);
    if ((await jour.getAttribute("aria-expanded")) !== "true") await jour.click();
    await expect(jour).toHaveAttribute("aria-expanded", "true");
    // Le jour précédent finit de se replier : un seul corps ouvert.
    await expect(f.getByRole("region")).toHaveCount(1, { timeout: 15_000 });
    // Une seule lecture par jour : les noms du jour qui n'ont aucune raison.
    const noms = await f.getByRole("region").locator("[data-affecte]").evaluateAll(ops =>
      ops.filter(o => !o.querySelector("[data-etiquette]")).map(o => o.querySelector("b")?.textContent || "?"));
    sansRaison.push(...noms.map(n => JOURS_L[i] + " " + n));
  }
  expect(sansRaison).toEqual([]);
});

test("E2 — « Appliquer ce plan » remplace la semaine, sans jamais doubler personne", async ({ page }) => {
  await openLocal(page, effectifAvec(e => {
    // Un samedi posé à tort : Nixon ne travaille pas le week-end. Le plan le videra.
    poser(e, S9, JOURS[5], ["p_nixon"]);
    // Un chantier qui ne démarre que dans trois semaines, où Nixon est posé lundi :
    // hors des chantiers à pourvoir, mais la règle « un seul chantier par jour » vaut aussi pour lui.
    chantier(e, S30).start = "2026-10-05";
    poser(e, S30, JOURS[0], ["p_nixon"]);
  }));
  const f = await ouvrirRepartir(page);
  const annonce = (await f.locator("[data-encart]").first().locator("b").first().textContent())!.trim();
  await expect(f.locator("[data-encart]").first()).toContainText(/sur 2 chantiers\./);

  await f.getByRole("button", { name: "Appliquer ce plan" }).click();
  await expect(f).toBeHidden();
  await vuToast(page, `${annonce} journées posées sur la semaine 38`);

  const g = await grille(page);
  // Personne sur deux chantiers le même jour.
  for (const jour of JOURS_L) {
    const tous = Object.values(g).flatMap(j => j[jour]);
    expect(new Set(tous).size, jour + " : " + tous.join(", ")).toBe(tous.length);
  }
  // Le samedi posé à tort a été vidé.
  expect(g["9MD49"]["Samedi"]).toEqual([]);
  // Les journées de la grille sont celles du plan (plus celles du chantier non visé).
  const posees = Object.entries(g).filter(([c]) => c !== "30JA90")
    .reduce((a, [, j]) => a + Object.values(j).reduce((b, n) => b + n.length, 0), 0);
  expect(posees).toBe(Number(annonce));
});

/* Les noms arrivés dans la grille par « Appliquer ce plan » qui entrent en
   vague (pose-in), avec leur rangée, leur jour et leur délai. */
const vagueDeLaGrille = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-ligne="chantier"]')].flatMap((ligne, r) =>
    [...ligne.querySelectorAll("[data-case]")].flatMap((c, j) => [...c.querySelectorAll("i")]
      .filter(i => getComputedStyle(i).animationName === "pose-in")
      .map(i => ({ r, j, delai: parseFloat(getComputedStyle(i).animationDelay) * 1000 })))));

test("E2 — le plan se pose en vague, jour après jour", async ({ page }) => {
  /* W6 (la séquence de « Répartir » de la mission) : juste après
     « Appliquer ce plan », les noms qui arrivent dans la grille s'y posent
     un à un. Sur une même rangée, plus tard dans la semaine, plus tard
     dans la vague. Témoin de K3 (mouvement réduit : pas de vague). */
  await openLocal(page);
  const f = await ouvrirRepartir(page);
  await f.getByRole("button", { name: "Appliquer ce plan" }).click();
  await expect(f).toBeHidden();
  const vague = await vagueDeLaGrille(page);
  expect(vague.length).toBeGreaterThan(3);
  for (const a of vague) for (const b of vague)
    if (a.r === b.r && a.j < b.j) expect(a.delai).toBeLessThan(b.delai);
});

test.describe("K3 — prefers-reduced-motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("K3 — le plan se pose d'un coup", async ({ page }) => {
    await openLocal(page);
    const f = await ouvrirRepartir(page);
    await f.getByRole("button", { name: "Appliquer ce plan" }).click();
    await expect(f).toBeHidden();
    await vuToast(page, "journées posées sur la semaine 38");
    expect(await vagueDeLaGrille(page)).toEqual([]);
  });
});

test("E3 — sans chantier à pourvoir, le répartiteur le dit", async ({ page }) => {
  await openLocal(page, effectifAvec(e => { for (const s of e.sites) s.ph = Array(12).fill(100); }));
  const f = await ouvrirRepartir(page);
  await expect(f.getByText("Aucun chantier actif à pourvoir cette semaine.")).toBeVisible();
  await expect(f.getByRole("button", { name: "Appliquer ce plan" })).toHaveCount(0);
});

test("E4 — la grille : initiales, « +N », conflits en fuchsia, libres du jour", async ({ page }) => {
  await openLocal(page, effectifAvec(e => {
    poser(e, S9, JOURS[0], ["p_geoffrey", "p_morgan", "p_erwan", "p_quentin", "p_aklan"]);
    poser(e, S12, TODAY, ["p_kia"]);             // Kia ne vient que le jeudi : conflit
  }));
  await onglet(page, "Semaine").click();
  const carte = page.locator("[data-carte]", { hasText: "Répartir toute l'équipe sur la semaine" });
  await expect(carte).toContainText("6 journées posées sur 3 chantiers.");

  // Chantiers × 7 jours, plus l'en-tête et la ligne « Libres ».
  await expect(page.locator("[data-grille-semaine] [data-ligne]")).toHaveCount(5);
  await expect(page.locator('[data-grille-semaine] [data-ligne="entete"] [data-case]')).toHaveCount(7);

  const lundi = page.getByRole("button", { name: "9MD49 Lundi : Geoffrey, Morgan, Erwan, Quentin, Aklan" });
  expect(await lundi.locator("i").allTextContents()).toEqual(["Ge", "Mo", "Er", "+2"]);
  await expect(lundi).toHaveAttribute("data-pleine");
  await expect(lundi).not.toHaveAttribute("data-conflit");

  const conflit = page.getByRole("button", { name: "12AB49 Mercredi : Kia" });
  await expect(conflit).toHaveAttribute("data-conflit");
  await expect(page.getByRole("button", { name: "30JA90 Mardi : personne" })).toHaveText("·");

  // Libres : disponibles et non affectés, jour par jour.
  expect(await page.locator('[data-grille-semaine] [data-ligne="libres"] [data-case] i').allTextContents()).toEqual(["5", "11", "11", "10", "3", "0", "0"]);

  // Sept semaines plus loin, plus aucun chantier.
  for (let i = 0; i < 7; i++) await page.getByRole("button", { name: "Semaine suivante" }).click();
  await expect(page.locator("[data-semaine]")).toHaveText("Sem. 45 · 2 – 8 nov.");
  await expect(page.getByText("Aucun chantier sur cette semaine.")).toBeVisible();
});
