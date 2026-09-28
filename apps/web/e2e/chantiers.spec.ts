/* F. Gérer les chantiers : ouvrir, modifier, supprimer, partager le brief. */

import { expect, test, type Page } from "@playwright/test";
import { JOURS, S9, TODAY, carte, chantier, effectif, effectifAvec, feuille, jours, onglet, openLocal, poser, puceVivier, vuToast } from "./helpers";

test.describe.configure({ timeout: 60_000 });

const ajouter = (page: Page) => page.getByRole("button", { name: "Ajouter" });

test("F1 — « + » ouvre « Nouveau chantier » ; l'adresse propose le code tant qu'on ne l'a pas écrit", async ({ page }) => {
  await openLocal(page);
  await ajouter(page).click();
  const f = feuille(page, "Nouveau chantier");
  await expect(f.locator("header p")).toHaveText("Adresse, puis le code se remplit tout seul");
  const adresse = f.getByPlaceholder("151 Henri Desbals apt 7");
  const code = f.getByPlaceholder("151HD7");

  await adresse.fill("151 Henri Desbals apt 7");
  await expect(code).toHaveValue("151HD7");
  await expect(f.getByText("Proposé depuis l'adresse", { exact: false })).toBeVisible();

  // Début, durée, volume : les valeurs par défaut, puis un autre choix.
  await expect(f.locator('input[type="date"]')).toHaveValue(TODAY);
  await expect(f.getByRole("button", { name: "2 mois" })).toHaveAttribute("aria-pressed", "true");
  await expect(f.getByRole("button", { name: "T2 · T3" })).toHaveAttribute("aria-pressed", "true");
  await expect(f.getByText("114 jours-homme")).toBeVisible();
  await f.getByRole("button", { name: "4 mois" }).click();
  await expect(f.getByRole("button", { name: "4 mois" })).toHaveAttribute("aria-pressed", "true");
  await expect(f.getByRole("button", { name: "2 mois" })).toHaveAttribute("aria-pressed", "false");
  await f.getByRole("button", { name: "Studio" }).click();
  await expect(f.getByRole("button", { name: "Studio" })).toHaveAttribute("aria-pressed", "true");
  await expect(f.getByText("80 jours-homme")).toBeVisible();
  await expect(f.getByRole("button", { name: "T4 et +" })).toBeVisible();

  // Écrit à la main, le code ne suit plus l'adresse.
  await code.fill("HD151");
  await expect(f.getByText("Code saisi à la main : il ne suivra plus l'adresse.")).toBeVisible();
  await adresse.fill("12 rue Lafayette apt 3");
  await expect(code).toHaveValue("HD151");
});

test("F1 — « + » depuis l'onglet Semaine, et « Ouvrir un chantier » quand la liste est vide", async ({ page }) => {
  await openLocal(page, { people: effectif().people, sites: [] });
  await expect(page.getByText("Aucun chantier", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir un chantier" }).click();
  await expect(feuille(page, "Nouveau chantier")).toBeVisible();
  await page.getByRole("button", { name: "Fermer" }).click();
  await expect(feuille(page, "Nouveau chantier")).toBeHidden();

  await onglet(page, "Semaine").click();
  await ajouter(page).click();
  await expect(feuille(page, "Nouveau chantier")).toBeVisible();
});

test("F2 — « Ouvrir le chantier » l'ajoute, « Enregistrer » le modifie ; sans code, il le réclame", async ({ page }) => {
  await openLocal(page);
  await ajouter(page).click();
  const f = feuille(page, "Nouveau chantier");
  await f.getByRole("button", { name: "Ouvrir le chantier" }).click();
  await vuToast(page, "Il manque le code chantier");
  await expect(f).toBeVisible();

  await f.getByPlaceholder("151 Henri Desbals apt 7").fill("151 Henri Desbals apt 7");
  await f.getByRole("button", { name: "3 mois" }).click();
  await f.getByRole("button", { name: "Ouvrir le chantier" }).click();
  await expect(f).toBeHidden();
  await vuToast(page, "151HD7 ouvert");
  const nouveau = page.locator("article[data-site]", { has: page.locator("[data-code]", { hasText: /^151HD7$/ }) });
  await expect(nouveau).toBeVisible();
  await expect(page.locator("article[data-site]")).toHaveCount(4);
  await expect(nouveau.locator("[data-adresse]")).toHaveText("151 Henri Desbals apt 7");
  await expect(nouveau.locator("[data-duree]")).toHaveText("3 mois");

  // Modifier : la feuille porte le code en titre et l'adresse en sous-titre.
  await nouveau.getByRole("button", { name: "Modifier le chantier" }).click();
  const m = feuille(page, "151HD7");
  await expect(m.locator("header p")).toHaveText("151 Henri Desbals apt 7");
  await m.getByRole("button", { name: "4 mois" }).click();
  await m.getByRole("button", { name: "Enregistrer" }).click();
  await expect(m).toBeHidden();
  await vuToast(page, "151HD7 enregistré");
  await expect(nouveau.locator("[data-duree]")).toHaveText("4 mois");
});

test("F3 — supprimer un chantier se fait en deux temps et libère l'équipe", async ({ page }) => {
  await openLocal(page, effectifAvec(e => poser(e, S9, TODAY, ["p_nixon"])));
  await expect(puceVivier(page, "Nixon")).toHaveCount(0);
  await carte(page, S9).getByRole("button", { name: "Modifier le chantier" }).click();
  const f = feuille(page, "9MD49");
  await f.getByRole("button", { name: "Supprimer le chantier" }).click();
  // Premier appui : rien n'est supprimé, on demande confirmation.
  await expect(f).toBeVisible();
  await expect(carte(page, S9)).toHaveCount(1);
  await f.getByRole("button", { name: "Confirmer — l'équipe sera libérée" }).click();
  await expect(f).toBeHidden();
  await vuToast(page, "9MD49 supprimé");
  await expect(carte(page, S9)).toHaveCount(0);
  await expect(page.locator("article[data-site]")).toHaveCount(2);
  await expect(puceVivier(page, "Nixon")).toBeVisible();
});

test.describe("F4 — partager le brief", () => {
  /* La feuille de partage du téléphone, remplacée par une espionne. */
  async function espionnerPartage(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const w = window as unknown as { __partages: { title?: string; text?: string }[] };
      w.__partages = [];
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (d: { title?: string; text?: string }) => { w.__partages.push({ title: d.title, text: d.text }); }
      });
    });
  }
  const partages = (page: Page) =>
    page.evaluate(() => (window as unknown as { __partages: { title?: string; text?: string }[] }).__partages);

  test("F4 — « Partager le brief » envoie le texte du jour à la feuille de partage", async ({ page }) => {
    await espionnerPartage(page);
    await openLocal(page, effectifAvec(e => {
      poser(e, S9, TODAY, ["p_nixon", "p_giorgi"]);
      chantier(e, S9).note = "Clés chez le gardien\nParking derrière";
    }));
    await page.getByRole("button", { name: "Partager le brief" }).click();
    await expect.poll(async () => (await partages(page)).length).toBe(1);
    const [p] = await partages(page);
    expect(p.title).toBe("Brief Mercredi");
    expect(p.text).toBe([
      "GEOPLAN — Mercredi 16 sept.",
      "",
      "9MD49 · 9 Mont Doré — apt 49",
      "Étape 1/12 — Démolition (S1)",
      "Équipe : Nixon, Giorgi",
      "· Repérage",
      "· Dégagement",
      "· Amenée matérielle",
      "· Démolition",
      "· Évacuation",
      "Note : Clés chez le gardien / Parking derrière",
      "",
      "Disponibles non affectés : Geoffrey, Morgan, Erwan, Quentin, Aklan, Sydney, Luidgi, Amir, Mojtaba"
    ].join("\n"));
  });

  test("F4 — sans feuille de partage, le brief est copié", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copie: string | null };
      w.__copie = null;
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true, value: { writeText: async (t: string) => { w.__copie = t; } }
      });
    });
    await openLocal(page);
    await page.getByRole("button", { name: "Partager le brief" }).click();
    await vuToast(page, "Copié — collez-le dans votre message");
    const copie = await page.evaluate(() => (window as unknown as { __copie: string | null }).__copie);
    expect(copie).toMatch(/^GEOPLAN — Mercredi 16 sept\.\n\nPersonne n'est affecté ce jour-là\./);
  });

  test("F4 — le brief porte sur le jour affiché", async ({ page }) => {
    // Constat U1, corrigé : `act` est mémorisé au premier rendu et `brief`
    // y gardait la fonction briefText de ce rendu-là : le texte portait
    // toujours sur le jour du lancement, seul le titre suivait.
    await espionnerPartage(page);
    await openLocal(page, effectifAvec(e => poser(e, S9, JOURS[3], ["p_kia"])));
    await jours(page).nth(3).click();
    await expect(page.locator("[data-bandeau-jour]")).toHaveText("Jeudi");
    await page.getByRole("button", { name: "Partager le brief" }).click();
    await expect.poll(async () => (await partages(page)).length).toBe(1);
    const [p] = await partages(page);
    expect(p.title).toBe("Brief Jeudi");
    expect(p.text).toMatch(/^GEOPLAN — Jeudi 17 sept\./);
    expect(p.text).toContain("Équipe : Kia");
  });
});
