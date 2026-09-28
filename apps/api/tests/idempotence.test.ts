/* ============================================================
   Idempotence : un geste renvoyé n'est jamais appliqué deux fois
   ============================================================ */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appel, sessionEssai, vider, type AppEssai } from "./aides.ts";
import { chantier, compagnon, monterDonnees, MARDI } from "./aides-donnees.ts";

let app: AppEssai;
let cookie: string;

beforeAll(async () => { app = await monterDonnees(); });
afterAll(async () => { await app.fermer(); });
beforeEach(async () => {
  await vider(app.base, app.redis);
  app.changements.length = 0;
  cookie = await sessionEssai(app);
  await chantier(app, "s_a");
  await compagnon(app, "p_erwan");
});

const cocher = (cle: string, mission = 0) => appel(app, "POST", "/api/chantiers/s_a/missions",
  { cookie, corps: { etape: 0, mission, faite: true }, entetes: { "idempotency-key": cle } });

const version = async (): Promise<number> =>
  (await appel(app, "GET", "/api/donnees", { cookie })).corps.sites[0].version;

describe("Idempotency-Key", () => {
  it("la même clé deux fois : un seul effet, la même réponse", async () => {
    /* Cocher fait avancer la version à chaque application : c'est ce
       qui rend un second passage visible. */
    const r1 = await cocher("m-1");
    const r2 = await cocher("m-1");
    expect(r1.statut).toBe(200);
    expect(r2.statut).toBe(200);
    expect(r2.corps).toEqual(r1.corps);
    expect(r2.entetes.get("idempotent-replayed")).toBe("true");
    expect(r1.entetes.get("idempotent-replayed")).toBeNull();
    expect(await version()).toBe(2);
    expect(app.changements).toEqual([{ quoi: "site", ids: ["s_a"], mutation: "m-1" }]);
  });

  it("une création renvoyée rend sa réponse d'origine (201), pas un 409", async () => {
    const creer = () => appel(app, "POST", "/api/compagnons",
      { cookie, corps: { id: "p_nouveau", name: "Nouveau" }, entetes: { "idempotency-key": "creation-1" } });
    const r1 = await creer();
    const r2 = await creer();
    expect([r1.statut, r2.statut]).toEqual([201, 201]);
    expect(r2.corps).toEqual(r1.corps);
  });

  it("une opération d'affectation renvoyée n'est annoncée qu'une fois", async () => {
    const corps = { chantierId: "s_a", jour: MARDI, compagnonId: "p_erwan", urgence: false };
    const r1 = await appel(app, "POST", "/api/affectations/poser", { cookie, corps, entetes: { "idempotency-key": "pose-1" } });
    const r2 = await appel(app, "POST", "/api/affectations/poser", { cookie, corps, entetes: { "idempotency-key": "pose-1" } });
    expect(r2.corps).toEqual(r1.corps);
    expect(app.changements).toHaveLength(1);
    expect(app.changements[0].mutation).toBe("pose-1");
  });

  it("deux envois simultanés de la même clé : le second reçoit 409 en-cours, puis la réponse gardée", async () => {
    /* Un autre appareil tient la ligne du chantier : le premier envoi
       attend son verrou, en plein milieu de son exécution. */
    const c = await app.base.pool.getConnection();
    let premier: ReturnType<typeof cocher>;
    try {
      await c.query("START TRANSACTION");
      await c.query("SELECT id FROM sites WHERE id = 's_a' FOR UPDATE");
      premier = cocher("m-2");
      for (let i = 0; i < 200 && !(await app.redis.exists("idem:u_geoffrey:m-2")); i++)
        await new Promise(ok => setTimeout(ok, 10));

      const second = await cocher("m-2");
      expect(second.statut).toBe(409);
      expect(second.corps).toMatchObject({ erreur: "en-cours" });
    } finally {
      await c.query("COMMIT");
      c.release();
    }
    const r1 = await premier!;
    expect(r1.statut).toBe(200);
    const r3 = await cocher("m-2");
    expect(r3.corps).toEqual(r1.corps);
    expect(await version()).toBe(2);
  });

  it("un 409 de version n'est pas gardé : le rejeu sur la fiche fraîche passe sous la même clé", async () => {
    await cocher("autre-appareil");                                // version 2
    const patch = (v: number) => appel(app, "PATCH", "/api/chantiers/s_a",
      { cookie, corps: { version: v, note: "vu" }, entetes: { "idempotency-key": "note-1" } });
    const refus = await patch(1);
    expect(refus.statut).toBe(409);
    const rejeu = await patch(refus.corps.actuel.version);
    expect(rejeu.statut).toBe(200);
    expect(rejeu.corps).toMatchObject({ note: "vu", version: 3 });
  });

  it("une clé déjà servie pour une autre requête : 422, rien d'appliqué", async () => {
    await cocher("m-3");
    const r = await appel(app, "POST", "/api/affectations/poser", {
      cookie, corps: { chantierId: "s_a", jour: MARDI, compagnonId: "p_erwan", urgence: false },
      entetes: { "idempotency-key": "m-3" }
    });
    expect(r.statut).toBe(422);
    expect(r.corps).toMatchObject({ erreur: "cle-reutilisee" });
  });

  it("chaque compte a ses propres clés", async () => {
    await cocher("m-4");
    const autre = await sessionEssai(app, "associe@geoplan.test");
    const r = await appel(app, "POST", "/api/chantiers/s_a/missions",
      { cookie: autre, corps: { etape: 0, mission: 1, faite: true }, entetes: { "idempotency-key": "m-4" } });
    expect(r.statut).toBe(200);
    expect(r.corps.version).toBe(3);
  });

  it("une clé vide ou trop longue : 400", async () => {
    expect((await cocher("")).statut).toBe(400);
    expect((await cocher("x".repeat(101))).statut).toBe(400);
    expect((await cocher("avec espace")).statut).toBe(400);
    expect((await cocher("x".repeat(100))).statut).toBe(200);
  });

  it("la réponse gardée dure sept jours", async () => {
    await cocher("m-5");
    const ttl = await app.redis.ttl("idem:u_geoffrey:m-5");
    expect(ttl).toBeGreaterThan(7 * 24 * 3600 - 60);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * 3600);
  });
});

/* Relecture adversariale de W3 : une pose refusée en 404 (compagnon pas
   encore créé) était gardée sept jours, et son rejeu répondait encore
   404 une fois le compagnon créé. */
describe("seuls les succès sont gardés", () => {
  it("une pose refusée en 404 passe, sous la même clé, une fois le compagnon créé", async () => {
    const poser = () => appel(app, "POST", "/api/affectations/poser", { cookie,
      corps: { chantierId: "s_a", jour: MARDI, compagnonId: "p_nouveau", urgence: false },
      entetes: { "idempotency-key": "pose-avant-creation" } });
    expect((await poser()).statut).toBe(404);
    await compagnon(app, "p_nouveau");
    const r = await poser();
    expect(r.statut).toBe(200);
    expect(r.entetes.get("idempotent-replayed")).toBeNull();
    expect(r.corps.chantiers.s_a.plan[MARDI]).toEqual(["p_nouveau"]);
  });

  it("une transaction n'attend jamais un verrou plus de 5 s", async () => {
    const [lignes] = await app.base.pool.query("SELECT @@SESSION.innodb_lock_wait_timeout AS attente");
    expect(lignes).toEqual([{ attente: 5 }]);
  });
});
