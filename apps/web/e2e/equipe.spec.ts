/* G. Gérer l'équipe : ajouter, modifier, supprimer un compagnon,
   demander les dispos. */

import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { S9, TODAY, WEEK, compagnon, demandesServeur, effectifAvec, feuille, grille, onglet, openLocal, poser, puceSur, relire, source, vuToast, zone } from "./helpers";

test.describe.configure({ timeout: 60_000 });

const ligne = (page: Page, nom: string) =>
  page.locator("button[data-personne]").filter({ has: page.locator("[data-nom]", { hasText: new RegExp("^" + nom + "$") }) });

test("G1 — « + » sur l'onglet Équipe ouvre « Nouveau compagnon », avec tous ses champs", async ({ page }) => {
  await openLocal(page, { ui: { tab: "equipe" } });
  await page.getByRole("button", { name: "Ajouter" }).click();
  const f = feuille(page, "Nouveau compagnon");
  await expect(f.locator("header p")).toHaveText("Ajouter au vivier");
  await expect(f.getByPlaceholder("Prénom")).toHaveValue("");
  await expect(f.getByPlaceholder("erwan@exemple.fr")).toBeVisible();
  await expect(f.getByPlaceholder("06 12 34 56 78")).toBeVisible();
  await expect(f.getByPlaceholder("Spécialité, contrainte…")).toBeVisible();
  // Jours habituels : du lundi au vendredi par défaut.
  expect(await f.getByRole("group", { name: "Disponibilité habituelle" }).getByRole("button").evaluateAll(b => b.map(x => x.getAttribute("aria-pressed"))))
    .toEqual(["true", "true", "true", "true", "true", "false", "false"]);
  await expect(f.getByText("5 jours par semaine, soit 5 j·h fournis.")).toBeVisible();
  // Permis : non par défaut.
  await expect(f.getByRole("button", { name: "Non", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Cinq métiers notés de 1 à 5, au niveau 1 par défaut.
  await expect(f.locator("[data-niveau]")).toHaveCount(5);
  await expect(f.locator("[data-niveau] button")).toHaveCount(25);
  await expect(f.locator('[data-niveau] button[aria-pressed="true"]')).toHaveText(["1", "1", "1", "1", "1"]);
});

test("G1 — sans personne, « Ajouter un compagnon » ouvre la même fiche", async ({ page }) => {
  await openLocal(page, { people: [], sites: effectifAvec(() => {}).sites, ui: { tab: "equipe" } });
  await expect(page.getByText("Aucun compagnon", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ajouter un compagnon" }).click();
  await expect(feuille(page, "Nouveau compagnon")).toBeVisible();
});

test("G2 — les contrôles de la fiche, dans l'ordre, puis l'ajout au vivier", async ({ page }) => {
  // Une vingtaine de gestes et cinq toasts : jusqu'à 50 s sous charge.
  test.slow();
  await openLocal(page, { ui: { tab: "equipe" } });
  await page.getByRole("button", { name: "Ajouter" }).click();
  const f = feuille(page, "Nouveau compagnon");
  const valider = f.getByRole("button", { name: "Ajouter au vivier" });

  await valider.click();
  await vuToast(page, "Il manque le nom");

  await f.getByPlaceholder("Prénom").fill("Zoé");
  for (let i = 0; i < 5; i++) await f.getByRole("group", { name: "Disponibilité habituelle" }).getByRole("button").nth(i).click();
  await expect(f.getByText("0 jour par semaine", { exact: false })).toBeVisible();
  await valider.click();
  await vuToast(page, "Il faut au moins un jour de présence");

  await f.getByRole("group", { name: "Disponibilité habituelle" }).getByRole("button").nth(0).click();
  await f.getByRole("group", { name: "Disponibilité habituelle" }).getByRole("button").nth(5).click();
  await expect(f.getByText("2 jours par semaine, soit 2 j·h fournis. Week-end compris.")).toBeVisible();
  await f.getByPlaceholder("06 12 34 56 78").fill("12");
  await valider.click();
  await vuToast(page, "Ce numéro n'a pas l'air valide");

  await f.getByPlaceholder("06 12 34 56 78").fill("06 12 34 56 78");
  await f.getByPlaceholder("erwan@exemple.fr").fill("zoe@");
  await valider.click();
  await vuToast(page, "Cette adresse e-mail n'est pas valide");

  await f.getByPlaceholder("erwan@exemple.fr").fill("Zoe@Exemple.fr");
  await f.getByRole("button", { name: "Oui", exact: true }).click();
  await f.locator("[data-niveau]").filter({ hasText: "Électricité" }).getByRole("button", { name: "4", exact: true }).click();
  await valider.click();
  await expect(f).toBeHidden();
  await vuToast(page, "Zoé ajouté au vivier");

  // Le téléphone est passé au format international, l'adresse en minuscules.
  const z = ligne(page, "Zoé");
  await expect(z).toBeVisible();
  await expect(z).toContainText("permis");
  await z.click();
  const fiche = feuille(page, "Zoé");
  await expect(fiche.getByPlaceholder("06 12 34 56 78")).toHaveValue("+33612345678");
  await expect(fiche.getByPlaceholder("erwan@exemple.fr")).toHaveValue("zoe@exemple.fr");
  await expect(fiche.locator("[data-niveau]").filter({ hasText: "Électricité" }).getByRole("button", { name: "4", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await fiche.getByRole("button", { name: "Enregistrer" }).click();
  await vuToast(page, "Zoé enregistré");
});

test("G3 — une ligne de l'équipe résume la semaine ; la toucher ouvre la fiche d'édition", async ({ page }) => {
  await openLocal(page, {
    ...effectifAvec(e => {
      poser(e, S9, TODAY, ["p_nixon"]);
      compagnon(e, "p_geoffrey").email = "geoffrey@exemple.fr";
    }),
    avail: [
      // Nixon a répondu : lundi et mercredi seulement.
      { id: "p_nixon@" + WEEK, token: "t-nixon", personId: "p_nixon", week: WEEK,
        days: [true, false, true, false, false, false, false], note: "", answeredAt: "2026-09-12T10:00:00Z" },
      // Giorgi a reçu la demande, sans répondre.
      { id: "p_giorgi@" + WEEK, token: "t-giorgi", personId: "p_giorgi", week: WEEK, days: null, note: "", answeredAt: null }
    ],
    ui: { tab: "equipe" }
  });
  await expect(page.locator("[data-carte]", { hasText: "Disponibilités · sem. 38" }).locator("[data-reponses]")).toHaveText("1/13");

  const nixon = ligne(page, "Nixon");
  await expect(nixon.locator("[data-badge]")).toHaveText("9MD49");
  await expect(nixon.locator("[data-demande]")).toHaveText("a répondu");
  await expect(nixon.locator("[data-jours-dispo]")).toHaveAttribute("data-repondu");
  expect(await nixon.locator("[data-jours-dispo] s").evaluateAll(s => s.map(x => x.hasAttribute("data-dispo"))))
    .toEqual([true, false, true, false, false, false, false]);

  const giorgi = ligne(page, "Giorgi");
  await expect(giorgi.locator("[data-badge]")).toHaveText("Libre");
  await expect(giorgi.locator("[data-demande]")).toHaveText("relancé");

  const geoffrey = ligne(page, "Geoffrey");
  await expect(geoffrey.locator("[data-demande]")).toHaveCount(0);
  await expect(geoffrey).toContainText("permis");
  await expect(geoffrey.locator("[data-competence]")).toHaveCount(5);

  await expect(ligne(page, "Aklan").locator("[data-demande]")).toHaveText("pas d'e-mail");
  await expect(ligne(page, "Nixon")).not.toContainText("permis");

  await nixon.click();
  const f = feuille(page, "Nixon");
  await expect(f.locator("header p")).toHaveText("Fiche compagnon");
  await expect(f.getByRole("button", { name: "Enregistrer" })).toBeVisible();
  await expect(f.getByPlaceholder("Prénom")).toHaveValue("Nixon");
});

test("G4 — supprimer un compagnon le retire de l'effectif et de tous les plans", async ({ page }) => {
  await openLocal(page, { ...effectifAvec(e => poser(e, S9, TODAY, ["p_nixon", "p_giorgi"])), ui: { tab: "equipe" } });
  await ligne(page, "Nixon").click();
  const f = feuille(page, "Nixon");
  await f.getByRole("button", { name: "Supprimer Nixon" }).click();
  await expect(f).toBeVisible();
  await expect(ligne(page, "Nixon")).toHaveCount(1);
  await f.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(f).toBeHidden();
  await vuToast(page, "Nixon supprimé");
  await expect(ligne(page, "Nixon")).toHaveCount(0);
  await expect(page.getByText("Effectif · semaine 38")).toBeVisible();
  await expect(page.locator("button[data-personne]")).toHaveCount(12);

  await onglet(page, "Semaine").click();
  expect((await grille(page))["9MD49"]["Mercredi"]).toEqual(["Giorgi"]);
  await onglet(page, "Chantiers").click();
  await relire(page);
  await expect(puceSur(page, S9, "Nixon")).toHaveCount(0);
  await expect(zone(page, S9).locator(".chip")).toHaveCount(1);

  // Relecture adversariale : un identifiant laissé dans les plans ne se
  // voit pas à l'écran (les puces filtrent les inconnus) ; il se voit
  // dans le fichier exporté.
  await onglet(page, "Équipe").click();
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exporter un fichier de sauvegarde" }).click()
  ]);
  const data = JSON.parse(readFileSync(await dl.path(), "utf8"));
  const ids = data.sites.flatMap((x: { plan: Record<string, string[]> }) => Object.values(x.plan).flat());
  expect(ids).not.toContain("p_nixon");
  expect(ids).toContain("p_giorgi");
});

test.describe("G5 — demander les dispos", () => {
  test("G5 — hors connexion, la feuille demande de se connecter", async ({ page }) => {
    test.skip(source() !== "local", "propre au mode local");
    await openLocal(page, { ui: { tab: "equipe" } });
    await page.getByRole("button", { name: "Demander les dispos · semaine 38" }).click();
    const f = feuille(page, "Demander les dispos");
    await expect(f.locator("header p")).toHaveText("Semaine 38 · 14 – 20 sept.");
    await expect(f.getByText("Cette fonction a besoin de la base", { exact: false })).toBeVisible();
    await expect(f.getByText("Connectez-vous, puis revenez ici.", { exact: false })).toBeVisible();
  });

  /* Ouvrir la feuille créait les demandes de tout le monde, et marquait
     chacun « relancé » sans rien envoyer (constat U11, corrigé en W4) :
     un lien n'est créé que quand on le demande. */
  test("G5 — avec un serveur, un lien n'est créé qu'à la demande", async ({ page }) => {
    test.skip(source() === "local", "propre aux sources distantes");
    await openLocal(page, { ...effectifAvec(e => {
      compagnon(e, "p_nixon").email = "nixon@exemple.fr";
      compagnon(e, "p_giorgi").email = "giorgi@exemple.fr";
    }), ui: { tab: "equipe" } });
    await page.getByRole("button", { name: "Demander les dispos · semaine 38" }).click();
    const f = feuille(page, "Demander les dispos");
    await expect(f.locator("[data-compagnon]")).toHaveCount(2);
    expect(await demandesServeur(page)).toEqual([]);
    const nixon = f.locator("[data-compagnon]").filter({ hasText: "Nixon" });
    await nixon.getByRole("button", { name: "Lien" }).click();
    await expect(nixon.getByText("en attente")).toBeVisible();
    await expect(f.locator("[data-compagnon]").filter({ hasText: "Giorgi" }).getByText("en attente")).toHaveCount(0);
    expect(await demandesServeur(page)).toEqual(["p_nixon@" + WEEK]);
  });

  test("G5 — à partir du vendredi, la demande vise la semaine suivante", async ({ page }) => {
    await openLocal(page, { ui: { tab: "equipe" }, now: new Date("2026-09-18T08:00:00+02:00") });
    const bouton = page.getByRole("button", { name: "Demander les dispos · semaine 39 (la prochaine)" });
    await expect(bouton).toBeVisible();
    await bouton.click();
    await expect(feuille(page, "Demander les dispos").locator("header p")).toHaveText("Semaine 39 · 21 – 27 sept.");
  });

  test("G5 — l'écran posé sur une autre semaine vise cette semaine-là", async ({ page }) => {
    await openLocal(page, { ui: { tab: "equipe" }, now: new Date("2026-09-18T08:00:00+02:00") });
    await page.getByRole("button", { name: "Semaine suivante" }).click();
    await page.getByRole("button", { name: "Semaine suivante" }).click();
    await expect(page.getByRole("button", { name: "Demander les dispos · semaine 40" })).toBeVisible();
  });
});
