/* D. Composer une équipe pour un chantier.

   Ce que le moteur propose (qui, dans quel ordre) est figé par le golden
   master ; ici, on vérifie le geste : la feuille, ses réglages, et ce
   que « Affecter » pose réellement. */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { S12, S9, TODAY, chantier, effectifAvec, feuille, grille, montrerZone, onglet, openLocal, poser, puceSur, puceVivier, relire, vuToast, zone } from "./helpers";

test.describe.configure({ timeout: 60_000 });

/* Les raisons possibles, texte exact de l'interface (sheets.jsx, WHY). */
const RAISON = /^(débloque .+ niv\. \d|.+ \d\/5|main-d'œuvre|permis|suite de la veille|chantier en retard|rien à sa portée ici|encadré|novice sans encadrement)$/;

async function composer(page: Page, sid: string, code: string): Promise<Locator> {
  await montrerZone(page, sid);
  await zone(page, sid).getByRole("button", { name: "Composer" }).click();
  const f = feuille(page, "Composition · " + code);
  await expect(f).toBeVisible();
  return f;
}

async function proposition(f: Locator): Promise<{ nom: string; posables: number }[]> {
  const lignes = f.locator("[data-compagnon]");
  const n = await lignes.count();
  const out: { nom: string; posables: number }[] = [];
  for (let i = 0; i < n; i++) {
    const l = lignes.nth(i);
    const posable = (await l.locator("[data-pourquoi]").last().textContent()) || "";
    const m = /^(\d+) j posables?$/.exec(posable.trim());
    expect(m, "« N j posable(s) » : " + posable).not.toBeNull();
    out.push({ nom: ((await l.locator("[data-nom]").textContent()) || "").trim(), posables: Number(m![1]) });
  }
  return out;
}

test("D1 — « Composer » ouvre la composition du chantier, avec le rappel de charge", async ({ page }) => {
  await openLocal(page);
  const f = await composer(page, S9, "9MD49");
  await expect(f.locator("header p")).toHaveText("Étape 1 — Démolition");
  const rappel = f.locator("[data-encart]").first();
  await expect(rappel).toContainText("Il reste 114 j·h.");
  await expect(rappel).toContainText("Pour tenir la date annoncée (1 nov.)");
  await expect(rappel).toContainText(/il faudrait environ \d+ compagnons/);
});

test("D2 — la portée et la taille recalculent la proposition ; chaque nom dit pourquoi", async ({ page }) => {
  await openLocal(page);
  const f = await composer(page, S9, "9MD49");
  const semaine = f.getByRole("button", { name: "Semaine 38", exact: true });
  const jour = f.getByRole("button", { name: "Mercredi 16", exact: true });
  await expect(semaine).toHaveAttribute("aria-pressed", "true");
  await expect(jour).toHaveAttribute("aria-pressed", "false");

  for (const k of [2, 3, 4, 5]) {
    await f.getByRole("button", { name: String(k), exact: true }).click();
    await expect(f.getByRole("button", { name: String(k), exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(f.locator("[data-compagnon]")).toHaveCount(k);
  }

  // Sur la semaine : au moins une journée posable chacun, cinq au plus.
  for (const p of await proposition(f)) {
    expect(p.posables).toBeGreaterThanOrEqual(1);
    expect(p.posables).toBeLessThanOrEqual(5);
  }
  // Jusqu'à trois raisons par nom, prises dans la liste connue.
  const lignes = f.locator("[data-compagnon]");
  for (let i = 0; i < await lignes.count(); i++) {
    const raisons = (await lignes.nth(i).locator("[data-pourquoi]").first().locator("[data-etiquette]").allTextContents()).map(t => t.trim());
    expect(raisons.length).toBeLessThanOrEqual(3);
    for (const r of raisons) expect(r).toMatch(RAISON);
  }
  await expect(f.locator("[data-couverture]")).toHaveCount(5);

  // Sur le seul mercredi : une journée posable chacun.
  await jour.click();
  await expect(jour).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await proposition(f)).map(p => p.posables)).toEqual([1, 1, 1, 1, 1]);
});

test("D3 — « Affecter » sur le jour pose l'équipe proposée", async ({ page }) => {
  await openLocal(page);
  const f = await composer(page, S9, "9MD49");
  await f.getByRole("button", { name: "Mercredi 16", exact: true }).click();
  await f.getByRole("button", { name: "2", exact: true }).click();
  await expect(f.locator("[data-compagnon]")).toHaveCount(2);
  const noms = (await proposition(f)).map(p => p.nom);

  await f.getByRole("button", { name: "Affecter" }).click();
  await expect(f).toBeHidden();
  await vuToast(page, "9MD49 : 2 journées posées");
  for (const n of noms) await expect(puceVivier(page, n)).toHaveCount(0);
  await relire(page);
  for (const n of noms) await expect(puceSur(page, S9, n)).toBeVisible();
  await expect(zone(page, S9).locator(".chip")).toHaveCount(2);
});

test("D3 — « Affecter » sur la semaine pose chaque jour posable", async ({ page }) => {
  await openLocal(page);
  const f = await composer(page, S9, "9MD49");
  await f.getByRole("button", { name: "3", exact: true }).click();
  await expect(f.locator("[data-compagnon]")).toHaveCount(3);
  const equipe = await proposition(f);
  const total = equipe.reduce((a, p) => a + p.posables, 0);

  await f.getByRole("button", { name: "Affecter" }).click();
  await vuToast(page, `9MD49 : ${total} journées posées`);

  await onglet(page, "Semaine").click();
  const g = await grille(page);
  for (const p of equipe) {
    const jours = Object.entries(g["9MD49"]).filter(([, noms]) => noms.includes(p.nom)).length;
    expect(jours, p.nom).toBe(p.posables);
  }
});

test("D3 — hors urgence, « Affecter » ne laisse personne sur deux chantiers le même jour", async ({ page }) => {
  // Tout le monde est pris ailleurs un jour ou l'autre.
  await openLocal(page, effectifAvec(e => {
    poser(e, S12, TODAY, ["p_aklan", "p_giorgi", "p_nixon", "p_geoffrey", "p_morgan"]);
    poser(e, S12, "2026-09-17", ["p_erwan", "p_sydney", "p_luidgi", "p_amir", "p_kia"]);
  }));
  const f = await composer(page, S9, "9MD49");
  await f.getByRole("button", { name: "5", exact: true }).click();
  await f.getByRole("button", { name: "Affecter" }).click();
  await vuToast(page, /^9MD49 : \d+ journées? posées?$/);

  await onglet(page, "Semaine").click();
  const g = await grille(page);
  for (const jour of ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]) {
    const tous = Object.values(g).flatMap(j => j[jour]);
    expect(new Set(tous).size, jour + " : " + tous.join(", ")).toBe(tous.length);
  }
});

test("D2 — sur un reste de travail minime, Composer propose deux compagnons", async ({ page }) => {
  /* Relecture adversariale : sur l'effectif de départ, la recommandation
     vaut 4 ; une taille par défaut passée de 2 à 3 ne se voyait pas.
     Ici, seule la moitié de la Finition reste : 3 j·h, un compagnon
     suffirait, et la feuille s'ouvre sur son minimum, 2. */
  await openLocal(page, effectifAvec(e => {
    chantier(e, S9).ph = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 50];
  }));
  await montrerZone(page, S9);
  await zone(page, S9).getByRole("button", { name: "Composer" }).click();
  const f = feuille(page, "Composition · 9MD49");
  await expect(f.getByRole("button", { name: "2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator("[data-compagnon]")).toHaveCount(2);
});
