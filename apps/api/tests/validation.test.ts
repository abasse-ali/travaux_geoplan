/* ============================================================
   Ce que les routes refusent, et avec quel statut

   400 : la requête est mal formée (corps, date, identifiant) ;
   401 : pas de session ; 403 : pas la bonne origine.
   ============================================================ */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appel, sessionEssai, vider, ORIGINE, type AppEssai } from "./aides.ts";
import { affectations, chantier, compagnon, monterDonnees, LUNDI, MARDI } from "./aides-donnees.ts";

let app: AppEssai;
let cookie: string;

beforeAll(async () => { app = await monterDonnees(); });
afterAll(async () => { await app.fermer(); });
beforeEach(async () => {
  await vider(app.base, app.redis);
  cookie = await sessionEssai(app);
  await chantier(app, "s_a");
  await compagnon(app, "p_erwan");
});

/* Une écriture valide par route : chacune doit être refusée sans
   session, et sans la bonne origine. */
const ECRITURES: [string, string, unknown][] = [
  ["POST", "/api/compagnons", { id: "p_neuf", name: "Neuf" }],
  ["PATCH", "/api/compagnons/p_erwan", { version: 1, name: "Erwan" }],
  ["DELETE", "/api/compagnons/p_erwan", undefined],
  ["POST", "/api/chantiers", { id: "s_neuf", code: "N" }],
  ["PATCH", "/api/chantiers/s_a", { version: 1, note: "x" }],
  ["DELETE", "/api/chantiers/s_a", undefined],
  ["POST", "/api/chantiers/s_a/missions", { etape: 0, mission: 0, faite: true }],
  ["POST", "/api/chantiers/s_a/etapes", { etape: 0, pourcentage: 20 }],
  ["POST", "/api/affectations/poser", { chantierId: "s_a", jour: MARDI, compagnonId: "p_erwan", urgence: false }],
  ["POST", "/api/affectations/retirer", { jour: MARDI, compagnonId: "p_erwan" }],
  ["PUT", "/api/affectations/equipe", { chantierId: "s_a", jour: MARDI, compagnonIds: ["p_erwan"], avant: [], urgence: false }],
  ["POST", "/api/affectations/plan", { semaine: LUNDI, plan: { s_a: { [MARDI]: ["p_erwan"] } }, avant: { s_a: {} }, urgence: false }],
  ["PUT", "/api/donnees", { people: [], sites: [] }]
];

describe("garde", () => {
  it("sans session : 401 sur chaque route", async () => {
    for (const [m, chemin, corps] of ECRITURES) {
      const r = await appel(app, m, chemin, { corps });
      expect(r.statut, m + " " + chemin).toBe(401);
    }
    expect((await appel(app, "GET", "/api/donnees")).statut).toBe(401);
  });

  it("avec une session révolue : 401", async () => {
    await app.redis.flushdb();
    expect((await appel(app, "GET", "/api/donnees", { cookie })).statut).toBe(401);
  });

  it("sans Origin, ou d'une autre origine : 403 sur chaque écriture, et rien n'est écrit", async () => {
    for (const [m, chemin, corps] of ECRITURES) {
      expect((await appel(app, m, chemin, { corps, cookie, origine: null })).statut, m + " " + chemin).toBe(403);
      expect((await appel(app, m, chemin, { corps, cookie, origine: "https://ailleurs.example" })).statut).toBe(403);
    }
    expect(await affectations(app)).toEqual([]);
    const d = (await appel(app, "GET", "/api/donnees", { cookie, origine: null })).corps;
    expect(d.people.map((p: { id: string }) => p.id)).toEqual(["p_erwan"]);
    expect(d.sites.map((s: { id: string; note: string }) => [s.id, s.note])).toEqual([["s_a", ""]]);
  });

  it("chaque écriture valide passe avec session et origine", async () => {
    for (const [m, chemin, corps] of ECRITURES) {
      if (m === "DELETE") continue;
      const r = await appel(app, m, chemin, { corps, cookie, origine: ORIGINE });
      expect([200, 201], m + " " + chemin + " → " + JSON.stringify(r.corps)).toContain(r.statut);
    }
  });
});

describe("corps et paramètres", () => {
  const poser = (corps: unknown) => appel(app, "POST", "/api/affectations/poser", { cookie, corps });

  it("corps invalide : 400 avec les champs fautifs", async () => {
    const r = await poser({ chantierId: "s_a", jour: MARDI, compagnonId: "p_erwan", urgence: "oui" });
    expect(r.statut).toBe(400);
    expect(r.corps).toMatchObject({ erreur: "requete-invalide" });
    expect(r.corps.champs).toEqual([expect.objectContaining({ chemin: "urgence" })]);
    expect((await poser({ chantierId: "s_a", jour: MARDI, compagnonId: "p_erwan" })).statut).toBe(400);
    expect((await poser(null)).statut).toBe(400);
    expect((await poser({ chantierId: "s_a", jour: MARDI, compagnonId: "p_erwan", urgence: false, en_trop: 1 })).statut).toBe(400);
  });

  it("date impossible : 400", async () => {
    for (const jour of ["2026-02-30", "2026-13-01", "2026-9-15", "15/09/2026", "0000-01-01"]) {
      const r = await poser({ chantierId: "s_a", jour, compagnonId: "p_erwan", urgence: false });
      expect(r.statut, jour).toBe(400);
    }
    const r = await appel(app, "PATCH", "/api/chantiers/s_a", { cookie, corps: { version: 1, start: "2026-02-30" } });
    expect(r.statut).toBe(400);
    expect(r.corps.champs).toEqual([expect.objectContaining({ chemin: "start", message: "cette date n'existe pas" })]);
    expect((await poser({ chantierId: "s_a", jour: "2028-02-29", compagnonId: "p_erwan", urgence: false })).statut).toBe(200);
  });

  it("identifiant invalide, dans le corps ou dans le chemin : 400", async () => {
    expect((await poser({ chantierId: "s a", jour: MARDI, compagnonId: "p_erwan", urgence: false })).statut).toBe(400);
    expect((await poser({ chantierId: "s_" + "x".repeat(40), jour: MARDI, compagnonId: "p_erwan", urgence: false })).statut).toBe(400);
    expect((await appel(app, "POST", "/api/compagnons", { cookie, corps: { id: "p;drop", name: "X" } })).statut).toBe(400);
    expect((await appel(app, "PATCH", "/api/chantiers/s%20a", { cookie, corps: { version: 1, note: "x" } })).statut).toBe(400);
  });

  it("types faux dans une fiche : 400", async () => {
    const r = await appel(app, "PATCH", "/api/compagnons/p_erwan",
      { cookie, corps: { version: 1, sk: { elec: "cinq" }, days: "lundi" } });
    expect(r.statut).toBe(400);
    expect(r.corps.champs.map((c: { chemin: string }) => c.chemin).sort()).toEqual(["days", "sk.elec"]);
    expect((await appel(app, "PATCH", "/api/compagnons/p_erwan", { cookie, corps: { version: 1, sk: { maconnerie: 3 } } })).statut).toBe(400);
    expect((await appel(app, "PATCH", "/api/compagnons/p_erwan", { cookie, corps: { version: 0, name: "X" } })).statut).toBe(400);
    expect((await appel(app, "PATCH", "/api/compagnons/p_erwan", { cookie, corps: { version: 1 } })).statut).toBe(400);
  });
});
