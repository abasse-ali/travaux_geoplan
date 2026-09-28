/* ============================================================
   Le lien compagnon (GET/POST /api/dispo/:jeton) et la demande des
   dispos (POST /api/dispos/demandes), contre de vrais MySQL et Redis.
   ============================================================ */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ORIGINE, appel, sessionEssai, vider } from "./aides.ts";
import {
  ajouterCompagnon, ajouterDemande, lireDemande, lireDemandes, monterAppDispo, type AppDispo
} from "./aides-dispo.ts";
import { nouveauJeton } from "../src/dispo/demandes.ts";

const SEMAINE = "2026-09-28";
const JOURS = [true, false, true, false, true, true, false];

let app: AppDispo;
beforeAll(async () => { app = await monterAppDispo(); });
afterAll(async () => { await app.fermer(); });

beforeEach(async () => {
  await vider(app.base, app.redis);
  app.changements.length = 0;
  await ajouterCompagnon(app.base, "p_nixon", "Nixon", "nixon@exemple.fr");
  await ajouterCompagnon(app.base, "p_giorgi", "Giorgi Beridze");
});

const lire = (jeton: string, entetes?: Record<string, string>) =>
  appel(app, "GET", "/api/dispo/" + jeton, { entetes });
const repondre = (jeton: string, corps: unknown, o: { origine?: string | null; entetes?: Record<string, string> } = {}) =>
  appel(app, "POST", "/api/dispo/" + jeton, { corps, ...o });

describe("le lien compagnon — GET et POST /api/dispo/:jeton", () => {
  it("lit la demande, enregistre la réponse, puis la relit pré-cochée", async () => {
    const jeton = await ajouterDemande(app.base, { personId: "p_nixon", semaine: SEMAINE });

    const avant = await lire(jeton);
    expect(avant.statut).toBe(200);
    expect(avant.corps).toEqual({ name: "Nixon", week: SEMAINE, days: null, note: "", answered: false });
    expect(avant.entetes.get("cache-control")).toBe("no-store");

    const r = await repondre(jeton, { days: JOURS, note: "Pas le mardi" });
    expect(r.statut).toBe(200);
    expect(r.corps).toEqual({ ok: true });

    const apres = await lire(jeton);
    expect(apres.corps).toEqual({ name: "Nixon", week: SEMAINE, days: JOURS, note: "Pas le mardi", answered: true });
    const ligne = await lireDemande(app.base, "p_nixon@" + SEMAINE);
    expect(ligne?.answered_at).not.toBeNull();
    expect(ligne?.token).toBe(jeton);
  });

  it("une seconde réponse remplace la première", async () => {
    const jeton = await ajouterDemande(app.base, { personId: "p_nixon", semaine: SEMAINE });
    await repondre(jeton, { days: JOURS, note: "Pas le mardi" });
    await repondre(jeton, { days: Array(7).fill(false) });
    expect((await lire(jeton)).corps).toEqual({
      name: "Nixon", week: SEMAINE, days: Array(7).fill(false), note: "", answered: true
    });
  });

  it("ne donne que le prénom du compagnon", async () => {
    const jeton = await ajouterDemande(app.base, { personId: "p_giorgi", semaine: SEMAINE });
    expect((await lire(jeton)).corps.name).toBe("Giorgi");
  });

  it("un jeton inconnu et un jeton expiré reçoivent le même 404", async () => {
    const expire = await ajouterDemande(app.base, { personId: "p_nixon", semaine: SEMAINE, expiree: true });
    const inconnu = nouveauJeton();

    const [a, b] = [await lire(inconnu), await lire(expire)];
    expect(a.statut).toBe(404);
    expect(b.statut).toBe(404);
    expect(b.corps).toEqual(a.corps);

    const [c, d] = [await repondre(inconnu, { days: JOURS }), await repondre(expire, { days: JOURS })];
    expect(c.statut).toBe(404);
    expect(d.statut).toBe(404);
    expect(d.corps).toEqual(c.corps);
    expect(c.corps).toEqual(a.corps);
    expect((await lireDemande(app.base, "p_nixon@" + SEMAINE))?.answered_at).toBeNull();
  });

  it("un jeton mal formé répond le même 404", async () => {
    const reference = (await lire(nouveauJeton())).corps;
    for (const jeton of ["court", "a".repeat(65), "jeton+avec.des=signes", "jeton%20avec%20espaces", "%00%00%00%00%00%00%00%00%00"]) {
      const r = await lire(jeton);
      expect(r.statut, jeton).toBe(404);
      expect(r.corps, jeton).toEqual(reference);
    }
  });

  it("un jeton n'ouvre que la demande dont il est la copie exacte, casse comprise", async () => {
    const jeton = await ajouterDemande(app.base, {
      personId: "p_nixon", semaine: SEMAINE, jeton: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"
    });
    expect((await lire(jeton)).statut).toBe(200);
    expect((await lire(jeton.toLowerCase())).statut).toBe(404);
    expect((await repondre(jeton.toUpperCase(), { days: JOURS })).statut).toBe(404);
  });

  it("un ancien jeton Supabase (18 caractères base32) reste valide", async () => {
    const jeton = await ajouterDemande(app.base, { personId: "p_nixon", semaine: SEMAINE, jeton: "k7mq2xa9bn4rtw3hjp" });
    expect(jeton).toHaveLength(18);
    expect((await lire(jeton)).statut).toBe(200);
    expect((await repondre(jeton, { days: JOURS })).statut).toBe(200);
  });

  it("des jours qui ne font pas sept cases sont refusés (400), et rien n'est écrit", async () => {
    const jeton = await ajouterDemande(app.base, { personId: "p_nixon", semaine: SEMAINE });
    for (const corps of [{ days: JOURS.slice(0, 6) }, { days: [...JOURS, true] }, { days: ["oui", 1, 0, 0, 0, 0, 0] }, {}, null]) {
      const r = await repondre(jeton, corps);
      expect(r.statut, JSON.stringify(corps)).toBe(400);
      expect(r.corps.erreur).toBe("requete-invalide");
    }
    expect((await lireDemande(app.base, "p_nixon@" + SEMAINE))?.answered_at).toBeNull();
    expect(app.changements).toEqual([]);
  });

  it("une note de 400 caractères est enregistrée tronquée à 300", async () => {
    const jeton = await ajouterDemande(app.base, { personId: "p_nixon", semaine: SEMAINE });
    expect((await repondre(jeton, { days: JOURS, note: "a".repeat(400) })).statut).toBe(200);
    expect((await lireDemande(app.base, "p_nixon@" + SEMAINE))?.note).toBe("a".repeat(300));

    /* Compté en caractères, comme la colonne : un emoji compte pour un
       et n'est jamais coupé en deux. */
    expect((await repondre(jeton, { days: JOURS, note: "👷".repeat(400) })).statut).toBe(200);
    expect((await lireDemande(app.base, "p_nixon@" + SEMAINE))?.note).toBe("👷".repeat(300));
  });

  it("une réponse venue d'une autre origine, ou sans origine, est refusée (403)", async () => {
    const jeton = await ajouterDemande(app.base, { personId: "p_nixon", semaine: SEMAINE });
    expect((await repondre(jeton, { days: JOURS }, { origine: "https://ailleurs.test" })).statut).toBe(403);
    expect((await repondre(jeton, { days: JOURS }, { origine: null })).statut).toBe(403);
    expect((await lireDemande(app.base, "p_nixon@" + SEMAINE))?.answered_at).toBeNull();
  });

  it("au-delà de 20 requêtes par minute sur un même jeton : 429 avec Retry-After, quelle que soit l'adresse", async () => {
    const jeton = await ajouterDemande(app.base, { personId: "p_nixon", semaine: SEMAINE });
    const autre = await ajouterDemande(app.base, { personId: "p_giorgi", semaine: SEMAINE });
    for (let i = 1; i <= 20; i++)
      expect((await lire(jeton, { "x-forwarded-for": "10.0.0." + i })).statut).toBe(200);

    const r = await repondre(jeton, { days: JOURS }, { entetes: { "x-forwarded-for": "10.0.1.1" } });
    expect(r.statut).toBe(429);
    const attente = Number(r.entetes.get("retry-after"));
    expect(attente).toBeGreaterThan(0);
    expect(attente).toBeLessThanOrEqual(60);
    expect((await lireDemande(app.base, "p_nixon@" + SEMAINE))?.answered_at).toBeNull();

    /* Un autre lien n'en pâtit pas. */
    expect((await lire(autre, { "x-forwarded-for": "10.0.1.2" })).statut).toBe(200);

    /* Redis compte par empreinte : une copie de Redis ne livre aucun lien. */
    const cles = await app.redis.keys("*");
    expect(cles.length).toBeGreaterThan(0);
    for (const k of cles) expect(k).not.toContain(jeton);
  });

  it("au-delà de 60 requêtes par minute depuis une même adresse : 429, même en changeant de jeton", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await lire(nouveauJeton())).statut).toBe(404);
      expect((await repondre(nouveauJeton(), { days: JOURS })).statut).toBe(404);
    }
    const jeton = await ajouterDemande(app.base, { personId: "p_nixon", semaine: SEMAINE });
    const r = await lire(jeton);
    expect(r.statut).toBe(429);
    expect(Number(r.entetes.get("retry-after"))).toBeGreaterThan(0);

    /* Une autre adresse passe encore. */
    expect((await lire(jeton, { "x-forwarded-for": "10.9.9.9" })).statut).toBe(200);
  });

  it("une réponse est annoncée aux autres appareils ; une lecture, non", async () => {
    const jeton = await ajouterDemande(app.base, { personId: "p_nixon", semaine: SEMAINE });
    await lire(jeton);
    expect(app.changements).toEqual([]);
    await repondre(jeton, { days: JOURS });
    expect(app.changements).toEqual([{ quoi: "avail", ids: ["p_nixon@" + SEMAINE] }]);
  });
});

describe("demander les dispos — POST /api/dispos/demandes", () => {
  const demander = async (compagnonIds: unknown, semaine: unknown = SEMAINE, cookie?: string) =>
    appel(app, "POST", "/api/dispos/demandes", {
      corps: { compagnonIds, semaine }, cookie: cookie ?? await sessionEssai(app)
    });

  it("crée les demandes et rend un lien par compagnon, qui s'ouvre", async () => {
    const r = await demander(["p_nixon", "p_giorgi"]);
    expect(r.statut).toBe(200);
    expect(r.corps).toHaveLength(2);

    const [nixon, giorgi] = r.corps;
    expect(nixon.avail).toEqual({
      id: "p_nixon@" + SEMAINE, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      personId: "p_nixon", week: SEMAINE, days: null, note: "", answeredAt: null
    });
    expect(giorgi.avail.personId).toBe("p_giorgi");
    expect(nixon.avail.token).not.toBe(giorgi.avail.token);
    expect(nixon.url).toBe(ORIGINE + "/dispo.html?t=" + nixon.avail.token);

    expect(app.changements).toEqual([{ quoi: "avail", ids: ["p_nixon@" + SEMAINE, "p_giorgi@" + SEMAINE] }]);

    /* Valable soixante jours, comme dans Supabase. */
    const [duree] = await app.base.pool.query(
      "SELECT TIMESTAMPDIFF(DAY, created_at, expires_at) AS jours FROM avail_requests WHERE id = ?",
      ["p_nixon@" + SEMAINE]);
    expect((duree as { jours: number }[])[0].jours).toBe(60);

    const lien = await lire(nixon.avail.token);
    expect(lien.statut).toBe(200);
    expect(lien.corps.name).toBe("Nixon");
  });

  it("redemander garde les mêmes jetons et la réponse déjà donnée", async () => {
    const premiere = await demander(["p_nixon", "p_giorgi"]);
    const jetons = premiere.corps.map((x: { avail: { token: string } }) => x.avail.token);
    await repondre(jetons[0], { days: JOURS, note: "Ok" });
    await ajouterCompagnon(app.base, "p_kia", "Kia");
    app.changements.length = 0;

    const seconde = await demander(["p_nixon", "p_giorgi", "p_kia"]);
    expect(seconde.statut).toBe(200);
    expect(seconde.corps.slice(0, 2).map((x: { avail: { token: string } }) => x.avail.token)).toEqual(jetons);
    expect(seconde.corps[0].avail).toMatchObject({
      days: JOURS, note: "Ok", answeredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    });
    /* Seule la demande nouvelle est annoncée. */
    expect(app.changements).toEqual([{ quoi: "avail", ids: ["p_kia@" + SEMAINE] }]);

    const lignes = await lireDemandes(app.base);
    expect(lignes).toHaveLength(3);
    expect((await lire(jetons[0])).corps).toMatchObject({ answered: true, days: JOURS });
  });

  it("une semaine qui n'est pas un lundi est refusée (400)", async () => {
    for (const semaine of ["2026-09-29", "2026-09-27", "2026-02-30", "28/09/2026", "", 20260928]) {
      const r = await demander(["p_nixon"], semaine);
      expect(r.statut, String(semaine)).toBe(400);
    }
    expect(await lireDemandes(app.base)).toEqual([]);
  });

  it("sans session : 401", async () => {
    const r = await appel(app, "POST", "/api/dispos/demandes", { corps: { compagnonIds: ["p_nixon"], semaine: SEMAINE } });
    expect(r.statut).toBe(401);
    expect(await lireDemandes(app.base)).toEqual([]);
  });

  it("connecté, mais sans l'origine de l'application : 403", async () => {
    const r = await appel(app, "POST", "/api/dispos/demandes", {
      corps: { compagnonIds: ["p_nixon"], semaine: SEMAINE }, cookie: await sessionEssai(app), origine: null
    });
    expect(r.statut).toBe(403);
    expect(await lireDemandes(app.base)).toEqual([]);
  });

  it("un compagnon inconnu (supprimé ailleurs entre-temps) est ignoré", async () => {
    const r = await demander(["p_fantome", "p_nixon"]);
    expect(r.statut).toBe(200);
    expect(r.corps.map((x: { avail: { personId: string } }) => x.avail.personId)).toEqual(["p_nixon"]);
  });

  it("une liste vide ou mal formée est refusée (400)", async () => {
    for (const ids of [[], "p_nixon", [42], ["x".repeat(41)]])
      expect((await demander(ids)).statut, JSON.stringify(ids)).toBe(400);
  });
});
