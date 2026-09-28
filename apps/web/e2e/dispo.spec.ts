/* J. La page du compagnon (dispo.html), de bout en bout, face à un faux
   Supabase. Les réponses imitent les deux fonctions SQL de
   supabase/schema.sql :
     • avail_get(p_token)                 → { name, week, days, note, answered } ou null ;
     • avail_set(p_token, p_days, p_note) → true / false. */

import { expect, test, type Page, type Route } from "@playwright/test";
import { FAKE_SUPABASE, useFakeSupabase } from "./helpers";

test.describe.configure({ timeout: 60_000 });

interface Demande { name: string; week: string; days: boolean[] | null; note: string; answered: boolean }
interface Envoi { p_token: string; p_days: unknown; p_note: string }

const NIXON: Demande = { name: "Nixon", week: "2026-09-21", days: null, note: "", answered: false };
const JOURS_L = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/* Branche le faux serveur. `get` et `set` décident de chaque réponse ;
   tout autre appel vers la base est refusé, et noté. */
async function fauxServeur(page: Page, o: {
  get?: (route: Route) => Promise<void>;
  set?: (route: Route) => Promise<void>;
}): Promise<{ lectures: string[]; envois: Envoi[]; autres: string[] }> {
  await useFakeSupabase(page);
  const trace = { lectures: [] as string[], envois: [] as Envoi[], autres: [] as string[] };
  await page.route(/supabase\.co/, async route => {
    const url = route.request().url();
    if (url === FAKE_SUPABASE.url + "/rest/v1/rpc/avail_get") {
      trace.lectures.push((route.request().postDataJSON() as { p_token: string }).p_token);
      return o.get ? o.get(route) : route.fulfill({ json: NIXON });
    }
    if (url === FAKE_SUPABASE.url + "/rest/v1/rpc/avail_set") {
      trace.envois.push(route.request().postDataJSON() as Envoi);
      return o.set ? o.set(route) : route.fulfill({ json: true });
    }
    trace.autres.push(url);
    return route.abort();
  });
  return trace;
}

/* Les sept jours du formulaire : un bouton à bascule chacun, qui porte
   sa date (data-jour). Et l'encadré du message (data-etat : ok, erreur). */
const lesJours = (page: Page) => page.locator("button[data-jour]");
const jourDe = (page: Page, i: number) => lesJours(page).nth(i);
const etats = (page: Page) =>
  lesJours(page).evaluateAll(b => b.map(x => x.getAttribute("aria-pressed") === "true"));
const message = (page: Page) => page.locator("[data-etat]");

test("J1 — le lien ouvre « Chargement… », puis le formulaire de la semaine, rien de coché", async ({ page }) => {
  let repondre: () => void = () => {};
  const attente = new Promise<void>(r => { repondre = r; });
  const trace = await fauxServeur(page, { get: async route => { await attente; await route.fulfill({ json: NIXON }); } });
  await page.goto("/dispo.html?t=jeton-nixon");
  await expect(page.getByText("Chargement…")).toBeVisible();
  repondre();

  await expect(page.getByRole("heading", { name: "Bonjour Nixon" })).toBeVisible();
  await expect(page.locator("[data-semaine]")).toHaveText("Semaine du21 – 27 sept.");
  await expect(lesJours(page)).toHaveCount(7);
  for (let i = 0; i < 7; i++) {
    await expect(jourDe(page, i).locator("[data-jour-nom]")).toHaveText(JOURS_L[i]);
    await expect(jourDe(page, i).locator("[data-jour-date]")).toHaveText(`${21 + i} sept.`);
  }
  expect(await etats(page)).toEqual([false, false, false, false, false, false, false]);
  await expect(page.getByRole("button", { name: "Envoyer mes disponibilités" })).toBeEnabled();
  await expect(page.getByText("Tu peux revenir sur ce lien pour corriger.")).toBeVisible();
  // En développement, StrictMode joue l'effet deux fois : on ne compte
  // pas les lectures, on vérifie qu'elles portent toutes sur ce jeton.
  expect(trace.lectures.length).toBeGreaterThanOrEqual(1);
  expect(new Set(trace.lectures)).toEqual(new Set(["jeton-nixon"]));
  expect(trace.autres).toEqual([]);
});

test("J2-J4 — cocher des jours, ajouter un mot, envoyer : le serveur reçoit exactement la réponse", async ({ page }) => {
  let repondre: () => void = () => {};
  const attente = new Promise<void>(r => { repondre = r; });
  const trace = await fauxServeur(page, { set: async route => { await attente; await route.fulfill({ json: true }); } });
  await page.goto("/dispo.html?t=jeton-nixon");
  await expect(page.getByRole("heading", { name: "Bonjour Nixon" })).toBeVisible();

  // J2 : chaque jour se bascule.
  await jourDe(page, 0).click();
  await jourDe(page, 1).click();
  await jourDe(page, 4).click();
  await jourDe(page, 4).click();
  expect(await etats(page)).toEqual([true, true, false, false, false, false, false]);

  // J3 : le mot facultatif est tronqué à 300 caractères à l'envoi.
  const long = "Je finis à 16 h le mardi. ".repeat(15);   // 390 caractères
  await page.getByPlaceholder("Un mot à ajouter ? (facultatif)").fill(long);

  // J4 : envoi.
  await page.getByRole("button", { name: "Envoyer mes disponibilités" }).click();
  await expect(page.getByRole("button", { name: "Envoi…" })).toBeDisabled();
  repondre();

  await expect(page.getByRole("heading", { name: "C'est envoyé, merci Nixon" })).toBeVisible();
  await expect(message(page)).toContainText("Pour la semaine du 21 – 27 sept., tu es noté disponible : lundi, mardi.");
  await expect(message(page)).toContainText("Message transmis : « " + long.trim());

  expect(trace.envois).toHaveLength(1);
  const e = trace.envois[0];
  expect(e.p_token).toBe("jeton-nixon");
  expect(e.p_days).toEqual([true, true, false, false, false, false, false]);
  expect(e.p_note).toBe(long.slice(0, 300));
  expect(e.p_note).toHaveLength(300);
});

test("J3 — le « Message transmis » affiché est celui qui est parti", async ({ page }) => {
  // ⚠ NOUVEAU CONSTAT N2 — le champ n'a pas de limite : au-delà de 300
  // caractères, la base reçoit le mot tronqué, mais l'écran de
  // confirmation affiche le mot entier comme « transmis ».
  test.fail();
  const trace = await fauxServeur(page, {});
  await page.goto("/dispo.html?t=jeton-nixon");
  const long = "Je finis à 16 h le mardi. ".repeat(15);
  await page.getByPlaceholder("Un mot à ajouter ? (facultatif)").fill(long);
  await page.getByRole("button", { name: "Envoyer mes disponibilités" }).click();
  await expect(page.getByRole("heading", { name: "C'est envoyé, merci Nixon" })).toBeVisible();
  expect(trace.envois[0].p_note).toHaveLength(300);
  const affiche = await message(page).textContent();
  const transmis = /Message transmis : « (.*) »/s.exec(affiche || "")?.[1] ?? "";
  expect(transmis).toBe(trace.envois[0].p_note.trim());
});

test("J4 — aucun jour coché : « indisponible toute la semaine »", async ({ page }) => {
  const trace = await fauxServeur(page, {});
  await page.goto("/dispo.html?t=jeton-nixon");
  await page.getByRole("button", { name: "Envoyer mes disponibilités" }).click();
  await expect(page.getByRole("heading", { name: "C'est envoyé, merci Nixon" })).toBeVisible();
  await expect(message(page)).toContainText("tu es noté indisponible toute la semaine.");
  await expect(message(page)).not.toContainText("Message transmis");
  expect(trace.envois[0]).toEqual({ p_token: "jeton-nixon", p_days: [false, false, false, false, false, false, false], p_note: "" });
});

test.describe("J5 — l'envoi échoue", () => {
  const cas: [string, (route: Route) => Promise<void>][] = [
    ["refusé par la base (false)", route => route.fulfill({ json: false })],
    ["erreur 500", route => route.fulfill({ status: 500, json: { message: "boom", code: "XX000" } })],
    ["réseau coupé", route => route.abort("internetdisconnected")]
  ];
  for (const [nom, set] of cas) {
    test(`J5 — ${nom} : message d'échec, et on peut réessayer`, async ({ page }) => {
      let echec = true;
      const trace = await fauxServeur(page, { set: route => (echec ? set(route) : route.fulfill({ json: true })) });
      await page.goto("/dispo.html?t=jeton-nixon");
      await jourDe(page, 2).click();
      await page.getByRole("button", { name: "Envoyer mes disponibilités" }).click();
      await expect(page.getByText("L'envoi n'a pas abouti. Vérifiez votre réseau et réessayez.")).toBeVisible();
      // Le bouton est rendu, la réponse n'est pas perdue.
      await expect(page.getByRole("button", { name: "Envoyer mes disponibilités" })).toBeEnabled();
      expect(await etats(page)).toEqual([false, false, true, false, false, false, false]);

      echec = false;
      await page.getByRole("button", { name: "Envoyer mes disponibilités" }).click();
      await expect(page.getByRole("heading", { name: "C'est envoyé, merci Nixon" })).toBeVisible();
      await expect(message(page)).toContainText("tu es noté disponible : mercredi.");
      expect(trace.envois).toHaveLength(2);
    });
  }
});

test("J6 — un lien sans jeton : « Lien incomplet », sans appeler la base", async ({ page }) => {
  const trace = await fauxServeur(page, {});
  await page.goto("/dispo.html");
  await expect(page.getByRole("heading", { name: "Lien incomplet" })).toBeVisible();
  await expect(page.getByText("Ce lien ne contient pas de code.", { exact: false })).toBeVisible();
  expect(trace.lectures).toEqual([]);

  await page.goto("/dispo.html?t=");
  await expect(page.getByRole("heading", { name: "Lien incomplet" })).toBeVisible();
});

test("J7 — un jeton inconnu ou expiré : « Lien expiré »", async ({ page }) => {
  await fauxServeur(page, { get: route => route.fulfill({ status: 200, contentType: "application/json", body: "null" }) });
  await page.goto("/dispo.html?t=perime");
  await expect(page.getByRole("heading", { name: "Lien expiré" })).toBeVisible();
  await expect(page.getByText("Demandez-en une nouvelle.", { exact: false })).toBeVisible();
});

test.describe("J8 — la base est injoignable", () => {
  for (const [nom, get] of [
    ["erreur 500", (route: Route) => route.fulfill({ status: 500, json: { message: "boom" } })],
    ["réseau coupé", (route: Route) => route.abort("internetdisconnected")]
  ] as const) {
    test(`J8 — ${nom} : « Connexion impossible »`, async ({ page }) => {
      await fauxServeur(page, { get });
      await page.goto("/dispo.html?t=jeton-nixon");
      await expect(page.getByRole("heading", { name: "Connexion impossible" })).toBeVisible();
      await expect(page.getByText("Vérifiez votre réseau, puis rouvrez le lien.")).toBeVisible();
    });
  }
});

test("J9 — rouvrir le lien après avoir répondu : la réponse revient, prête à corriger", async ({ page }) => {
  const trace = await fauxServeur(page, {
    get: route => route.fulfill({ json: {
      name: "Nixon", week: "2026-09-21", days: [true, false, true, false, false, false, false],
      note: "Je finis tôt le mercredi", answered: true
    } })
  });
  await page.goto("/dispo.html?t=jeton-nixon");
  await expect(page.getByRole("heading", { name: "Bonjour Nixon" })).toBeVisible();
  expect(await etats(page)).toEqual([true, false, true, false, false, false, false]);
  await expect(page.getByPlaceholder("Un mot à ajouter ? (facultatif)")).toHaveValue("Je finis tôt le mercredi");
  await expect(page.getByText("Tu as déjà répondu : tu peux corriger tant que la semaine n'est pas passée.")).toBeVisible();

  await jourDe(page, 2).click();
  await jourDe(page, 3).click();
  await page.getByRole("button", { name: "Mettre à jour ma réponse" }).click();
  await expect(page.getByRole("heading", { name: "C'est envoyé, merci Nixon" })).toBeVisible();
  await expect(message(page)).toContainText("tu es noté disponible : lundi, jeudi.");
  expect(trace.envois[0]).toEqual({
    p_token: "jeton-nixon", p_days: [true, false, false, true, false, false, false], p_note: "Je finis tôt le mercredi"
  });
});

test("J8 — sans base configurée : « Application non configurée »", async ({ page }) => {
  // Pas de faux Supabase : config.e2e.js ne donne aucune clé.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto("/dispo.html?t=jeton-nixon");
  await expect(page.getByRole("heading", { name: "Application non configurée" })).toBeVisible();
});
