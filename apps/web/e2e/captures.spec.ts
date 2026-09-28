/* ============================================================
   Captures de référence (W5)

   Chaque écran et chaque feuille, au format iPhone, en clair et en
   sombre, photographiés AVANT le passage à Tailwind et shadcn/ui. Après,
   la même suite compare : toute différence doit être expliquée (porte
   de W5), puis les références mises à jour en connaissance de cause
   (npm run test:captures -- --update-snapshots).

   Mêmes conditions à chaque passage : horloge figée, effectif fixe,
   polices de repli (Google Fonts est coupé dans les tests).
   ============================================================ */

import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  FAKE_SUPABASE, S12, S9, TODAY, WEEK, carte, chantier, compagnon, effectifAvec, feuille, onglet,
  openLocal, poser, puceSur, useFakeSupabase
} from "./helpers";

/* Un mercredi ordinaire : des équipes posées, un chantier avancé, des
   adresses e-mail, une réponse reçue. */
const seed = () => ({
  ...effectifAvec(e => {
    poser(e, S9, TODAY, ["p_nixon", "p_giorgi"]);
    poser(e, S12, TODAY, ["p_erwan"]);
    const ph = chantier(e, S9).ph as number[];
    ph[0] = 100; ph[1] = 60;
    compagnon(e, "p_nixon").email = "nixon@exemple.fr";
    compagnon(e, "p_giorgi").email = "giorgi@exemple.fr";
  }),
  avail: [{ id: "p_giorgi@" + WEEK, token: "jeton-giorgi-0123456", personId: "p_giorgi", week: WEEK,
    days: [true, true, true, false, true, false, false], note: "", answeredAt: "2026-09-13T10:00:00Z" }]
});

/* Sous charge (trois navigateurs), une prise de vue dépasse parfois les
   5 s par défaut : ce n'est pas une différence, c'est de l'attente.
   Au pixel près : la tolérance par défaut de Playwright (0,2 d'écart de
   couleur par pixel) laissait passer un vrai changement de teinte — le
   gris muted de W4 remis à sa place passait inaperçu, et l'étape
   d'accessibilité avait changé 40 images, pas les 18 relevées
   (relecture adversariale de W5). Le rendu est déterministe : deux
   passages de suite sont identiques au pixel. */
const photo = (page: Page, nom: string) =>
  expect(page).toHaveScreenshot(nom + ".png", { animations: "disabled", timeout: 20_000, threshold: 0, maxDiffPixels: 0 });

/* `animations: "disabled"` coupe les animations CSS, pas celles de
   Framer Motion (l'accordéon s'ouvre en JS). Défiler pendant qu'il
   grandit laisse la page à une position qui dépend de la charge : on
   attend que l'élément ne bouge plus d'une image à l'autre. */
async function immobile(el: Locator): Promise<void> {
  await expect.poll(async () => {
    const a = await el.boundingBox();
    await el.page().waitForTimeout(120);
    const b = await el.boundingBox();
    return JSON.stringify(a) === JSON.stringify(b);
  }, { timeout: 10_000 }).toBe(true);
}

for (const theme of ["clair", "sombre"] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme === "sombre" ? "dark" : "light" });
    const n = (nom: string) => nom + "-" + theme;

    test("chantiers", async ({ page }) => {
      await openLocal(page, seed());
      await photo(page, n("chantiers"));
    });

    test("chantiers, vivier en bulle", async ({ page }) => {
      await openLocal(page, { ...seed(), ui: { poolState: "bubble" } });
      await photo(page, n("chantiers-bulle"));
    });

    test("chantiers, mode urgence", async ({ page }) => {
      await openLocal(page, { ...seed(), ui: { urgence: true } });
      await photo(page, n("chantiers-urgence"));
    });

    test("un chantier déplié : étapes et note", async ({ page }) => {
      await openLocal(page, { ...seed(), ui: { poolState: "bubble" } });
      const c = carte(page, S9);
      await c.getByRole("button", { name: /^Les 12 étapes/ }).click();
      await c.getByRole("button", { name: /^Note de chantier/ }).click();
      await immobile(c);
      /* Plus haute que l'écran : scrollIntoViewIfNeeded la laisserait où
         le dernier clic l'a mise. Le bas de la carte en bas de la vue. */
      await c.evaluate(el => el.scrollIntoView({ block: "end" }));
      await photo(page, n("chantier-deplie"));
    });

    test("semaine", async ({ page }) => {
      await openLocal(page, { ...seed(), ui: { tab: "semaine" } });
      await photo(page, n("semaine"));
    });

    test("équipe", async ({ page }) => {
      await openLocal(page, { ...seed(), ui: { tab: "equipe" } });
      await photo(page, n("equipe"));
      await page.locator("main").evaluate(el => { el.scrollTop = el.scrollHeight; });
      await photo(page, n("equipe-bas"));
    });

    test("feuille d'une puce", async ({ page }) => {
      await openLocal(page, { ...seed(), ui: { poolState: "bubble" } });
      await puceSur(page, S9, "Nixon").click();
      await expect(feuille(page, "Nixon")).toBeVisible();
      await photo(page, n("feuille-puce"));
    });

    test("fiche compagnon, existante et nouvelle", async ({ page }) => {
      await openLocal(page, { ...seed(), ui: { tab: "equipe" } });
      await page.locator("[data-personne]").filter({ hasText: "Nixon" }).click();
      await expect(feuille(page, "Nixon")).toBeVisible();
      await photo(page, n("feuille-compagnon"));
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Ajouter" }).click();
      await expect(feuille(page, "Nouveau compagnon")).toBeVisible();
      await photo(page, n("feuille-nouveau-compagnon"));
    });

    test("fiche chantier, existante et nouvelle", async ({ page }) => {
      await openLocal(page, { ...seed(), ui: { poolState: "bubble" } });
      await carte(page, S9).getByRole("button", { name: "Modifier le chantier" }).click();
      await expect(feuille(page, "9MD49")).toBeVisible();
      await photo(page, n("feuille-chantier"));
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Ajouter" }).click();
      await expect(feuille(page, "Nouveau chantier")).toBeVisible();
      await photo(page, n("feuille-nouveau-chantier"));
    });

    test("composer", async ({ page }) => {
      await openLocal(page, { ...seed(), ui: { poolState: "bubble" } });
      await carte(page, S9).getByRole("button", { name: "Composer" }).click();
      await expect(feuille(page, /^Composition/)).toBeVisible();
      await photo(page, n("feuille-composer"));
    });

    test("répartir la semaine", async ({ page }) => {
      await openLocal(page, { ...seed(), ui: { tab: "semaine" } });
      await page.getByRole("button", { name: "Répartir toute l'équipe sur la semaine" }).click();
      await expect(feuille(page, "Répartir la semaine")).toBeVisible();
      await photo(page, n("feuille-repartir"));
    });

    test("demander les dispos, et données", async ({ page }) => {
      await openLocal(page, { ...seed(), ui: { tab: "equipe" } });
      await page.getByRole("button", { name: /^Demander les dispos/ }).click();
      await expect(feuille(page, "Demander les dispos")).toBeVisible();
      await photo(page, n("feuille-dispos"));
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "État des données" }).click();
      await expect(feuille(page, "Données")).toBeVisible();
      await photo(page, n("feuille-donnees"));
    });

    test("connexion", async ({ page }) => {
      await useFakeSupabase(page);
      await page.route(/supabase\.co/, r => r.abort());
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible({ timeout: 20_000 });
      await photo(page, n("connexion"));
    });

    test("page compagnon : formulaire, envoyé, expiré", async ({ page }) => {
      await useFakeSupabase(page);
      await page.route(/supabase\.co/, route => {
        const url = route.request().url();
        if (url === FAKE_SUPABASE.url + "/rest/v1/rpc/avail_get") {
          const jeton = (route.request().postDataJSON() as { p_token: string }).p_token;
          return route.fulfill({ json: jeton === "bon"
            ? { name: "Nixon", week: "2026-09-21", days: [true, false, true, false, false, false, false], note: "", answered: false }
            : null });
        }
        if (url === FAKE_SUPABASE.url + "/rest/v1/rpc/avail_set") return route.fulfill({ json: true });
        return route.abort();
      });
      await page.goto("/dispo.html?t=bon");
      await expect(page.getByRole("heading", { name: "Bonjour Nixon" })).toBeVisible({ timeout: 20_000 });
      await photo(page, n("dispo-formulaire"));
      await page.getByRole("button", { name: "Envoyer mes disponibilités" }).click();
      await expect(page.getByRole("heading", { name: "C'est envoyé, merci Nixon" })).toBeVisible();
      await photo(page, n("dispo-envoye"));
      await page.goto("/dispo.html?t=perime");
      await expect(page.getByRole("heading", { name: "Lien expiré" })).toBeVisible();
      await photo(page, n("dispo-expire"));
    });

    test("onglets et barre du haut, en mouvement arrêté", async ({ page }) => {
      await openLocal(page, seed());
      await onglet(page, "Semaine").click();
      await onglet(page, "Chantiers").click();
      await photo(page, n("chantiers-apres-onglets"));
    });

    /* Ajoutée après la relecture de W5 : « Auj. » paraît entre le libellé
       et la flèche, qui ne bouge plus. Aucune autre capture ne sort de la
       semaine courante. */
    test("barre du haut, hors de la semaine courante", async ({ page }) => {
      await openLocal(page, seed());
      await page.getByRole("button", { name: "Semaine suivante" }).click();
      const auj = page.getByRole("button", { name: "Auj." });
      await expect(auj).toBeVisible();
      await immobile(auj);
      await photo(page, n("semaine-suivante"));
    });
  });
}
