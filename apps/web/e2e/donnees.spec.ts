/* H. Données, sauvegarde, lancement — en mode local. Le mode connecté
   (« À jour », « N en attente », temps réel) reste un geste manuel. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { S9, TODAY, affectationsServeur, effectif, effectifAvec, feuille, glisser, montrerZone, onglet, openLocal, poser, puceSur, puceVivier, source, vuToast, vivier, zone } from "./helpers";

test.describe.configure({ timeout: 60_000 });

const etat = (page: Page) => page.getByRole("button", { name: "État des données" });

async function ouvrirDonnees(page: Page) {
  await etat(page).click();
  const f = feuille(page, "Données");
  await expect(f).toBeVisible();
  return f;
}

test("H1 — le bouton d'état dit « Local » en mode local, même après une écriture", async ({ page }) => {
  test.skip(source() !== "local", "propre au mode local");
  await openLocal(page);
  // Le CSS le met en capitales : on compare le texte, sans la casse.
  await expect(etat(page)).toHaveText(/^local$/i);
  await expect(etat(page)).toHaveAttribute("data-etat", "local");
  await montrerZone(page, S9);
  await glisser(page, puceVivier(page, "Nixon"), zone(page, S9));
  await vuToast(page, "Nixon sur 9MD49");
  await expect(etat(page)).toHaveText(/^local$/i);
});

test("H1 — avec un serveur, le bouton dit « À jour », et y revient une fois l'écriture confirmée", async ({ page }) => {
  test.skip(source() === "local", "propre aux sources distantes");
  await openLocal(page);
  await expect(etat(page)).toHaveText(/^à jour$/i);
  await montrerZone(page, S9);
  await glisser(page, puceVivier(page, "Nixon"), zone(page, S9));
  await vuToast(page, "Nixon sur 9MD49");
  await expect(etat(page)).toHaveText(/^à jour$/i);
  await expect(etat(page)).toHaveAttribute("data-etat", "ok");
  await expect.poll(() => affectationsServeur(page, TODAY)).toEqual([{ site_id: S9, person_id: "p_nixon" }]);
});

/* Constat U29 (recette W8) : lancée sans joindre le serveur, rien à
   envoyer, l'application disait « 0 en attente », en orange. Comme
   l'ancienne version, mais ce n'était pas vrai pour autant : ce qui
   attend, c'est le serveur. */
test("H1 — lancée sans joindre le serveur, rien à envoyer : le bouton dit « Hors ligne », pas « 0 en attente »", async ({ page }) => {
  test.skip(source() === "local", "propre aux sources distantes");
  await openLocal(page);
  await expect(etat(page)).toHaveText(/^à jour$/i);
  // L'instantané s'écrit 250 ms après la lecture : on l'attend, comme l'appareil.
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith("geoplan.instantane.v4:")))).toBe(true);
  const serveur = source() === "api" ? /\/(api|socket\.io)\// : /supabase\.co/;
  await page.route(serveur, r => r.abort("internetdisconnected"));
  await page.routeWebSocket(serveur, ws => { ws.close(); });
  await page.reload();
  await expect(page.locator("article[data-site]")).toHaveCount(3);
  // supabase-js insiste une dizaine de secondes avant que la première lecture échoue.
  await expect(etat(page)).toHaveAttribute("data-etat", "off", { timeout: 20_000 });
  await expect(etat(page)).toHaveText(/^hors ligne$/i);
});

test("H2 — la feuille « Données » dit où sont les données et ce qu'elles contiennent", async ({ page }) => {
  test.skip(source() !== "local", "propre au mode local");
  await openLocal(page);
  const f = await ouvrirDonnees(page);
  await expect(f.locator("header p")).toHaveText("Stockage local");
  await expect(f.getByText("Aucun serveur configuré : les données restent dans ce navigateur.")).toBeVisible();
  await expect(f.getByText("13 compagnons · 3 chantiers")).toBeVisible();
  await expect(f.getByText(/en attente d'envoi/)).toHaveCount(0);
  await expect(f.getByRole("button", { name: "Se déconnecter" })).toHaveCount(0);
  await expect(f.getByRole("button", { name: "Exporter un fichier de sauvegarde" })).toBeVisible();
});

test("H2 — avec un serveur, la feuille « Données » dit le compte, le serveur, et permet de se déconnecter", async ({ page }) => {
  test.skip(source() === "local", "propre aux sources distantes");
  await openLocal(page);
  const f = await ouvrirDonnees(page);
  await expect(f.locator("header p")).toHaveText("Synchronisé");
  const ou = source() === "api" ? "sur le serveur de Geoplan" : "sur votre base Supabase";
  await expect(f.getByText("Connecté en tant que geoffrey@geoplan.test. Les données sont " + ou +
    " et se mettent à jour en direct sur tous vos appareils.")).toBeVisible();
  await expect(f.getByText("13 compagnons · 3 chantiers")).toBeVisible();
  await expect(f.getByText(/en attente d'envoi/)).toHaveCount(0);
  await f.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  if (source() === "api") {
    /* L'écran de connexion de l'API ne propose ni compte à créer, ni lien
       de réinitialisation (constat U9) : cela se fait sur le serveur. */
    await expect(page.getByText("le responsable du serveur le crée ou le change", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Créer un compte" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mot de passe oublié" })).toHaveCount(0);
  } else {
    /* Avec Supabase, l'écran reste celui de la production. */
    await expect(page.getByRole("button", { name: "Créer un compte" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mot de passe oublié" })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();   // la session est bien fermée
});

test("H2 — en mode local, aucune modification n'est annoncée « en attente d'envoi »", async ({ page }) => {
  // Constat S9, corrigé en W4 : en mode local, la file ne se vidait
  // jamais, et la feuille annonçait « 1 modification en attente
  // d'envoi » alors qu'il n'y avait nulle part où envoyer.
  await openLocal(page);
  await puceVivier(page, "Nixon").click();
  await feuille(page, "Nixon").getByRole("button", { name: /^9MD49/ }).click();
  await vuToast(page, "Nixon sur 9MD49");
  const f = await ouvrirDonnees(page);
  await expect(f.getByText("13 compagnons · 3 chantiers")).toBeVisible();
  await expect(f.getByText(/en attente d'envoi/)).toHaveCount(0, { timeout: 2_000 });
  await expect(f.getByRole("button", { name: "Réessayer l'envoi" })).toHaveCount(0, { timeout: 1_000 });
});

test.describe("H3 — exporter", () => {
  for (const depuis of ["Équipe", "Données"] as const) {
    test(`H3 — « Exporter un fichier de sauvegarde » (${depuis}) télécharge tout l'effectif`, async ({ page }) => {
      await openLocal(page);
      if (depuis === "Équipe") await onglet(page, "Équipe").click();
      else await ouvrirDonnees(page);
      const [dl] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Exporter un fichier de sauvegarde" }).click()
      ]);
      expect(dl.suggestedFilename()).toBe("geoplan-2026-09-16.json");
      const data = JSON.parse(readFileSync(await dl.path(), "utf8"));
      expect(data.app).toBe("geoplan");
      expect(data.v).toBe(3);
      expect(data.exportedAt).toBe("2026-09-16T06:00:00.000Z");
      expect(data.people).toHaveLength(13);
      expect(data.sites).toHaveLength(3);
      expect(data.people.map((p: { name: string }) => p.name)).toContain("Nixon");
      expect(data.sites.map((s: { code: string }) => s.code)).toEqual(["9MD49", "12AB49", "30JA90"]);
      await vuToast(page, "Sauvegarde téléchargée");
    });
  }
});

test("H3 — le fichier exporté garde les affectations", async ({ page }) => {
  /* Relecture adversariale : un export qui vidait les plans survivait,
     l'effectif de départ n'ayant aucune affectation. */
  await openLocal(page, effectifAvec(e => poser(e, S9, TODAY, ["p_nixon", "p_giorgi"])));
  await ouvrirDonnees(page);
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exporter un fichier de sauvegarde" }).click()
  ]);
  const data = JSON.parse(readFileSync(await dl.path(), "utf8"));
  const s9 = data.sites.find((s: { id: string }) => s.id === S9);
  expect(s9.plan[TODAY]).toEqual(["p_nixon", "p_giorgi"]);
});

test.describe("H4 — restaurer", () => {
  const petite = () => {
    const e = effectif();
    return JSON.stringify({ app: "geoplan", v: 3, people: e.people.slice(0, 2), sites: e.sites.slice(0, 1) });
  };

  /* Remplacer toutes les données se confirme (constat U7, corrigé en
     W4) : le premier toucher annonce ce qui va être remplacé, le second
     remplace. */
  async function confirmer(f: ReturnType<typeof feuille>, page: Page): Promise<void> {
    await f.getByRole("button", { name: "Remplacer les données" }).click();
    await expect(f.getByText(/vont remplacer les 13 compagnons et 3 chantiers actuels/)).toBeVisible();
    await expect(page.locator("article[data-site]")).toHaveCount(3);          // rien n'est encore remplacé
    await f.getByRole("button", { name: "Confirmer : tout sera remplacé" }).click();
  }

  test("H4 — choisir un fichier, puis confirmer, remplace tout", async ({ page }) => {
    await openLocal(page);
    const f = await ouvrirDonnees(page);
    await f.locator('input[type="file"]').setInputFiles({
      name: "sauvegarde.json", mimeType: "application/json", buffer: Buffer.from(petite())
    });
    await expect(f.getByText("Les 2 compagnons et 1 chantier de la sauvegarde", { exact: false })).toHaveCount(0);
    await confirmer(f, page);
    await vuToast(page, "2 compagnons et 1 chantiers restaurés");
    await expect(f).toBeHidden();
    await expect(page.locator("article[data-site]")).toHaveCount(1);
    await expect(vivier(page).locator(".chip")).toHaveCount(2);
    await ouvrirDonnees(page);
    await expect(feuille(page, "Données").getByText("2 compagnons · 1 chantiers")).toBeVisible();
  });

  test("H4 — coller le JSON puis « Remplacer les données » ; un texte illisible est refusé", async ({ page }) => {
    await openLocal(page);
    let f = await ouvrirDonnees(page);
    await f.getByPlaceholder('{ "app": "geoplan", … }').fill("pas une sauvegarde");
    await f.getByRole("button", { name: "Remplacer les données" }).click();
    await vuToast(page, "Sauvegarde illisible — vérifiez le fichier");
    await expect(page.locator("article[data-site]")).toHaveCount(3);

    f = await ouvrirDonnees(page);
    await f.getByPlaceholder('{ "app": "geoplan", … }').fill(petite());
    await confirmer(f, page);
    await vuToast(page, "2 compagnons et 1 chantiers restaurés");
    await expect(page.locator("article[data-site]")).toHaveCount(1);
  });

  test("H4 — sans confirmation, rien n'est remplacé", async ({ page }) => {
    await openLocal(page);
    const f = await ouvrirDonnees(page);
    await f.getByPlaceholder('{ "app": "geoplan", … }').fill(petite());
    await f.getByRole("button", { name: "Remplacer les données" }).click();
    await expect(f.getByRole("button", { name: "Confirmer : tout sera remplacé" })).toBeVisible();
    await f.getByRole("button", { name: "Fermer" }).click();
    await expect(f).toBeHidden();
    await expect(page.locator("article[data-site]")).toHaveCount(3);
    await page.reload();
    await expect(page.locator("article[data-site]")).toHaveCount(3);
  });

  test("H4 — data/effectif.json s'importe", async ({ page }) => {
    const fichier = new URL("../../../data/effectif.json", import.meta.url);
    const attendu = JSON.parse(readFileSync(fichier, "utf8")) as { people: unknown[]; sites: unknown[] };
    await openLocal(page, { people: [], sites: [] });
    const f = await ouvrirDonnees(page);
    await expect(f.getByText("0 compagnons · 0 chantiers")).toBeVisible();
    await f.locator('input[type="file"]').setInputFiles(fileURLToPath(fichier));
    await f.getByRole("button", { name: "Remplacer les données" }).click();
    await f.getByRole("button", { name: "Confirmer : tout sera remplacé" }).click();
    await vuToast(page, `${attendu.people.length} compagnons et ${attendu.sites.length} chantiers restaurés`);
    await expect(page.locator("article[data-site]")).toHaveCount(attendu.sites.length);
  });
});

test("H5 — au lancement, l'écran vient du cache local, écritures comprises", async ({ page }) => {
  await openLocal(page);
  await montrerZone(page, S9);
  await glisser(page, puceVivier(page, "Nixon"), zone(page, S9));
  await vuToast(page, "Nixon sur 9MD49");
  // Le réseau est coupé (openLocal) : ce qui s'affiche vient de l'appareil.
  await page.reload();
  await expect(puceSur(page, S9, "Nixon")).toBeVisible();
  await expect(puceVivier(page, "Nixon")).toHaveCount(0);
  await expect(page.getByRole("banner").locator("p")).toHaveText("1 chantier ouvert · 10 libres");
});

test("H6 — sans base configurée : bandeau « Mode local », pas d'écran de connexion", async ({ page }) => {
  test.skip(source() !== "local", "propre au mode local");
  await openLocal(page);
  await expect(page.locator("[data-bandeau=local]")).toHaveText(
    "Mode local — les données restent sur cet appareil. Renseignez config.ts pour les synchroniser.");
  await expect(page.getByRole("button", { name: "Se connecter" })).toHaveCount(0);
  await expect(page.getByPlaceholder("vous@exemple.fr")).toHaveCount(0);
  await expect(page.locator("article[data-site]")).toHaveCount(3);
});
