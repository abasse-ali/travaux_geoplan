/* ============================================================
   GET /api/donnees — la forme du domaine, recomposée depuis MySQL
   ============================================================ */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normAvail, normPerson, normSite } from "@geoplan/domain";
import { availRequests } from "../src/db/schema.ts";
import { appel, sessionEssai, vider, type AppEssai } from "./aides.ts";
import { chantier, compagnon, monterDonnees, poserSql, MARDI, MERCREDI } from "./aides-donnees.ts";

let app: AppEssai;
let cookie: string;

beforeAll(async () => { app = await monterDonnees(); });
afterAll(async () => { await app.fermer(); });
beforeEach(async () => {
  await vider(app.base, app.redis);
  cookie = await sessionEssai(app);
});

const parId = <T extends { id: string }>(l: T[]): T[] => [...l].sort((a, b) => a.id.localeCompare(b.id));

describe("GET /api/donnees", () => {
  it("rend compagnons, chantiers et demandes au format du domaine, chaque fiche avec sa version", async () => {
    const erwan = { name: "Erwan", phone: "06 12 34 56 78", email: "Erwan@Exemple.fr",
                    days: [true, true, false, true, true, false, false], permis: true,
                    sk: { elec: 4, plomb: 2, platre: 3, peint: 1, menuis: 5 }, note: "clé du local" };
    await compagnon(app, "p_erwan", erwan);
    await compagnon(app, "p_nixon");
    const a = { code: "151HD7", addr: "151 Henri Desbals apt 7", start: "2026-09-01", months: 3, coef: 1.2,
                ph: [100, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], note: "digicode 1234",
                tasks: { "1": [true, false] } };
    await chantier(app, "s_a", a);
    await app.deps.db.insert(availRequests).values({
      id: "p_erwan@2026-09-21", token: "jeton-erwan", personId: "p_erwan", week: "2026-09-21",
      days: [true, true, true, false, false, false, false], note: "absent jeudi",
      expiresAt: "2026-11-20 00:00:00.000", answeredAt: "2026-09-19 10:15:00.000"
    });

    const r = await appel(app, "GET", "/api/donnees", { cookie });
    expect(r.statut).toBe(200);
    expect(r.entetes.get("cache-control")).toBe("no-store");
    expect(parId(r.corps.people)).toEqual([
      { ...normPerson("p_erwan", erwan), version: 1 },
      { ...normPerson("p_nixon", { name: "nixon" }), version: 1 }
    ]);
    expect(r.corps.people.find((p: { id: string }) => p.id === "p_erwan").phone).toBe("+33612345678");
    expect(r.corps.sites).toEqual([{ ...normSite("s_a", a), version: 1, urgences: {} }]);
    expect(r.corps.avail).toEqual([normAvail("p_erwan@2026-09-21", {
      token: "jeton-erwan", personId: "p_erwan", week: "2026-09-21",
      days: [true, true, true, false, false, false, false], note: "absent jeudi",
      answeredAt: "2026-09-19T10:15:00.000Z"
    })]);
  });

  it("recompose le plan dans l'ordre des puces, urgences comprises, et les signale à part", async () => {
    for (const id of ["p_erwan", "p_nixon", "p_giorgi"]) await compagnon(app, id);
    await chantier(app, "s_a");
    await chantier(app, "s_b");
    /* L'ordre d'insertion n'est pas l'ordre des puces : c'est `position` qui compte. */
    await poserSql(app, "s_a", MARDI, "p_nixon", false, 2);
    await poserSql(app, "s_a", MARDI, "p_erwan", false, 0);
    await poserSql(app, "s_a", MARDI, "p_giorgi", false, 1);
    await poserSql(app, "s_a", MERCREDI, "p_erwan", false, 0);
    /* Erwan, déjà sur s_a mardi, est doublé en urgence sur s_b. */
    await poserSql(app, "s_b", MARDI, "p_erwan", true, 0);

    const r = await appel(app, "GET", "/api/donnees", { cookie });
    const [a, b] = parId(r.corps.sites as { id: string; plan: unknown; urgences: unknown }[]);
    expect(a.plan).toEqual({ [MARDI]: ["p_erwan", "p_giorgi", "p_nixon"], [MERCREDI]: ["p_erwan"] });
    expect(a.urgences).toEqual({});
    expect(b.plan).toEqual({ [MARDI]: ["p_erwan"] });
    expect(b.urgences).toEqual({ [MARDI]: ["p_erwan"] });
  });

  it("sans session : 401", async () => {
    const r = await appel(app, "GET", "/api/donnees");
    expect(r.statut).toBe(401);
    expect(r.corps).toMatchObject({ erreur: "non-connecte" });
  });
});

/* « Remplacer les données » (Données › Restaurer), pour la source api
   du client (W4). */
describe("PUT /api/donnees — restaurer une sauvegarde", () => {
  const restaurer = (corps: unknown, entetes?: Record<string, string>) =>
    appel(app, "PUT", "/api/donnees", { cookie, corps, entetes });

  it("remplace tout : ce qui manque part, le reste est réécrit, les demandes des gardés restent", async () => {
    await compagnon(app, "p_erwan", { note: "avant" });
    await compagnon(app, "p_parti");
    await chantier(app, "s_a");
    await chantier(app, "s_vieux");
    await poserSql(app, "s_vieux", MARDI, "p_erwan");
    for (const pid of ["p_erwan", "p_parti"])
      await app.deps.db.insert(availRequests).values({
        id: pid + "@2026-09-21", token: "jeton-" + pid + "-0123456", personId: pid, week: "2026-09-21",
        expiresAt: "2026-11-20 00:00:00.000"
      });
    app.changements.length = 0;

    const r = await restaurer({
      people: [normPerson("p_erwan", { name: "Erwan", note: "après" }), normPerson("p_neuf", { name: "Neuf" })],
      sites: [normSite("s_a", { code: "A", start: "2026-09-01", plan: { [MARDI]: ["p_neuf", "p_erwan"] } })]
    }, { "idempotency-key": "restauration-1" });
    expect(r.statut).toBe(200);
    expect(parId(r.corps.people as { id: string; note: string; version: number }[]).map(p => [p.id, p.note, p.version])).toEqual([["p_erwan", "après", 2], ["p_neuf", "", 1]]);
    expect(r.corps.sites.map((s: { id: string; plan: unknown }) => [s.id, s.plan])).toEqual([["s_a", { [MARDI]: ["p_neuf", "p_erwan"] }]]);
    /* La demande d'Erwan reste, celle du compagnon parti suit sa fiche. */
    expect(r.corps.avail.map((a: { id: string; token: string }) => [a.id, a.token]))
      .toEqual([["p_erwan@2026-09-21", "jeton-p_erwan-0123456"]]);
    expect(app.changements).toEqual([{ quoi: "tout", mutation: "restauration-1" }]);
    /* GET rend la même chose. */
    expect((await appel(app, "GET", "/api/donnees", { cookie })).corps).toEqual(r.corps);
  });

  it("un identifiant que l'API refuserait : 400, rien n'est écrit", async () => {
    await compagnon(app, "p_erwan");
    const r = await restaurer({ people: [{ id: "p_élodie", name: "Élodie" }], sites: [] });
    expect(r.statut).toBe(400);
    expect(r.corps.message).toContain("p_élodie");
    const d = (await appel(app, "GET", "/api/donnees", { cookie })).corps;
    expect(d.people.map((p: { id: string }) => p.id)).toEqual(["p_erwan"]);
  });

  it("une sauvegarde restaurée garde son ordre : fiches et vivier s'affichent comme avant", async () => {
    const r = await restaurer({
      people: ["p_zoe", "p_anna", "p_marc"].map(id => normPerson(id, { name: id })),
      sites: ["s_9md49", "s_12ab49", "s_30ja90"].map(id => normSite(id, { code: id, start: "2026-08-31" }))
    });
    expect(r.corps.people.map((p: { id: string }) => p.id)).toEqual(["p_zoe", "p_anna", "p_marc"]);
    expect(r.corps.sites.map((s: { id: string }) => s.id)).toEqual(["s_9md49", "s_12ab49", "s_30ja90"]);
  });

  it("une forme inattendue : 400", async () => {
    for (const corps of [{ people: [] }, { people: [{ name: "sans id" }], sites: [] }, { people: [], sites: [], avail: [] }]) {
      const r = await restaurer(corps);
      expect(r.statut, JSON.stringify(corps)).toBe(400);
    }
  });

  it("une sauvegarde de plus de 256 ko passe, jusqu'à 1 Mo", async () => {
    const people = Array.from({ length: 900 }, (_, i) =>
      normPerson("p_" + String(i).padStart(4, "0"), { name: "Compagnon " + i, note: "x".repeat(300) }));
    const corps = { people, sites: [] };
    expect(JSON.stringify(corps).length).toBeGreaterThan(256 * 1024);
    const r = await restaurer(corps);
    expect(r.statut).toBe(200);
    expect(r.corps.people).toHaveLength(900);
  });
});
