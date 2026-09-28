/* ============================================================
   Fiches : compagnons et chantiers

   Création avec l'identifiant du client, correctif par champ sous
   verrou optimiste, suppression en cascade ; coches et avancement par
   opérations, qui doivent donner exactement ce que donne le domaine.
   ============================================================ */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normPerson, normSite, setPhasePct, setTask, type Person, type Site } from "@geoplan/domain";
import { availRequests } from "../src/db/schema.ts";
import { appel, sessionEssai, vider, type AppEssai } from "./aides.ts";
import { affectations, chantier, compagnon, monterDonnees, poserSql, LUNDI, MARDI } from "./aides-donnees.ts";

let app: AppEssai;
let cookie: string;

beforeAll(async () => { app = await monterDonnees(); });
afterAll(async () => { await app.fermer(); });
beforeEach(async () => {
  await vider(app.base, app.redis);
  app.changements.length = 0;
  cookie = await sessionEssai(app);
});

const lire = async () => (await appel(app, "GET", "/api/donnees", { cookie })).corps;

describe("compagnons", () => {
  it("crée un compagnon avec l'identifiant fourni, normalisé par le domaine", async () => {
    const saisie = { name: "Giorgi", phone: "06 11 22 33 44", days: [true, true, true, true, true, true, false],
                     sk: { plomb: 4 }, permis: true };
    const r = await appel(app, "POST", "/api/compagnons", { cookie, corps: { id: "p_x7k2m1", ...saisie } });
    expect(r.statut).toBe(201);
    /* Le client peut n'envoyer qu'une partie des niveaux : normPerson
       complète, comme il le fait côté client. */
    expect(r.corps).toEqual({ ...normPerson("p_x7k2m1", saisie as Partial<Person>), version: 1 });
    expect(r.corps.sk).toEqual({ elec: 1, plomb: 4, platre: 1, peint: 1, menuis: 1 });
    expect(app.changements).toEqual([{ quoi: "person", ids: ["p_x7k2m1"] }]);
    expect((await lire()).people).toEqual([r.corps]);
  });

  it("refuse un identifiant déjà pris : 409", async () => {
    await compagnon(app, "p_erwan");
    const r = await appel(app, "POST", "/api/compagnons", { cookie, corps: { id: "p_erwan", name: "Autre" } });
    expect(r.statut).toBe(409);
    expect(r.corps).toMatchObject({ erreur: "conflit" });
  });

  it("modifie les seuls champs envoyés, et la version avance", async () => {
    await compagnon(app, "p_erwan", { name: "Erwan", note: "clé du local", sk: { elec: 3, plomb: 2, platre: 1, peint: 1, menuis: 1 } });
    const r = await appel(app, "PATCH", "/api/compagnons/p_erwan",
      { cookie, corps: { version: 1, phone: "0612345678", sk: { menuis: 5 } } });
    expect(r.statut).toBe(200);
    expect(r.corps).toMatchObject({
      id: "p_erwan", name: "Erwan", note: "clé du local", phone: "+33612345678", version: 2,
      sk: { elec: 3, plomb: 2, platre: 1, peint: 1, menuis: 5 }
    });
    expect((await lire()).people).toEqual([r.corps]);
  });

  it("409 avec la fiche actuelle sur une version périmée, puis le rejeu sur `actuel` réussit", async () => {
    await compagnon(app, "p_erwan", { name: "Erwan" });
    /* Deux appareils ont lu la version 1. Le premier change la note. */
    const b = await appel(app, "PATCH", "/api/compagnons/p_erwan", { cookie, corps: { version: 1, note: "préfère le matin" } });
    expect(b.corps.version).toBe(2);

    /* Le second, qui voulait donner le permis, arrive en retard. */
    const a = await appel(app, "PATCH", "/api/compagnons/p_erwan", { cookie, corps: { version: 1, permis: true } });
    expect(a.statut).toBe(409);
    expect(a.corps.erreur).toBe("conflit");
    expect(a.corps.actuel).toEqual(b.corps);

    /* Il rejoue SA mutation sur la fiche fraîche : les deux gestes tiennent. */
    const rejeu = await appel(app, "PATCH", "/api/compagnons/p_erwan",
      { cookie, corps: { version: a.corps.actuel.version, permis: true } });
    expect(rejeu.statut).toBe(200);
    expect(rejeu.corps).toMatchObject({ note: "préfère le matin", permis: true, version: 3 });
  });

  it("supprime un compagnon ; ses affectations et ses demandes partent en cascade", async () => {
    await compagnon(app, "p_erwan");
    await compagnon(app, "p_nixon");
    await chantier(app, "s_a");
    await chantier(app, "s_b");
    await poserSql(app, "s_a", LUNDI, "p_erwan");
    await poserSql(app, "s_b", MARDI, "p_erwan");
    await poserSql(app, "s_a", LUNDI, "p_nixon", false, 1);
    await app.deps.db.insert(availRequests).values({
      id: "p_erwan@2026-09-21", token: "jeton", personId: "p_erwan", week: "2026-09-21",
      expiresAt: "2026-11-20 00:00:00.000"
    });

    const r = await appel(app, "DELETE", "/api/compagnons/p_erwan", { cookie });
    expect(r.statut).toBe(200);
    expect(r.corps).toEqual({ supprime: "p_erwan" });
    expect(await affectations(app)).toEqual([{ siteId: "s_a", day: LUNDI, personId: "p_nixon", urgence: false }]);
    const d = await lire();
    expect(d.people.map((p: { id: string }) => p.id)).toEqual(["p_nixon"]);
    expect(d.avail).toEqual([]);
    expect(app.changements).toEqual([
      { quoi: "person", ids: ["p_erwan"] },
      { quoi: "assignments", ids: ["s_a", "s_b"], jours: [LUNDI, MARDI] }
    ]);
  });

  it("supprimer ou modifier un compagnon inconnu : 404", async () => {
    expect((await appel(app, "DELETE", "/api/compagnons/p_personne", { cookie })).statut).toBe(404);
    expect((await appel(app, "PATCH", "/api/compagnons/p_personne", { cookie, corps: { version: 1, name: "X" } })).statut).toBe(404);
  });
});

describe("chantiers", () => {
  it("crée un chantier avec l'identifiant fourni, normalisé par le domaine", async () => {
    const saisie = { code: "151hd7-trop-long-pour-un-code", addr: "151 Henri Desbals", start: "2026-09-14", months: 40, coef: 1.5 };
    const r = await appel(app, "POST", "/api/chantiers", { cookie, corps: { id: "s_9md49", ...saisie } });
    expect(r.statut).toBe(201);
    expect(r.corps).toEqual({ ...normSite("s_9md49", saisie), version: 1, urgences: {} });
    expect(r.corps.months).toBe(12);                       // borné par normSite
    expect(app.changements).toEqual([{ quoi: "site", ids: ["s_9md49"] }]);
  });

  it("PATCH : correctif par champ, 409 sur version périmée, puis rejeu réussi", async () => {
    await chantier(app, "s_a", { code: "A", note: "" });
    const b = await appel(app, "PATCH", "/api/chantiers/s_a", { cookie, corps: { version: 1, note: "livraison vendredi" } });
    expect(b.statut).toBe(200);
    expect(b.corps).toMatchObject({ code: "A", note: "livraison vendredi", version: 2 });

    const a = await appel(app, "PATCH", "/api/chantiers/s_a", { cookie, corps: { version: 1, code: "151HD7" } });
    expect(a.statut).toBe(409);
    expect(a.corps).toMatchObject({ erreur: "conflit", actuel: b.corps });

    const rejeu = await appel(app, "PATCH", "/api/chantiers/s_a",
      { cookie, corps: { version: a.corps.actuel.version, code: "151HD7" } });
    expect(rejeu.statut).toBe(200);
    expect(rejeu.corps).toMatchObject({ code: "151HD7", note: "livraison vendredi", version: 3 });
  });

  it("PATCH ne touche ni au plan, ni aux coches, ni à l'avancement", async () => {
    await chantier(app, "s_a");
    for (const champ of [{ plan: {} }, { tasks: {} }, { ph: [] }]) {
      const r = await appel(app, "PATCH", "/api/chantiers/s_a", { cookie, corps: { version: 1, ...champ } });
      expect(r.statut).toBe(400);
    }
  });

  it("la fiche rendue garde son plan et ses urgences", async () => {
    await compagnon(app, "p_erwan");
    await chantier(app, "s_a");
    await chantier(app, "s_b");
    await poserSql(app, "s_b", MARDI, "p_erwan");
    await poserSql(app, "s_a", MARDI, "p_erwan", true);
    const r = await appel(app, "PATCH", "/api/chantiers/s_a", { cookie, corps: { version: 1, note: "x" } });
    expect(r.corps).toMatchObject({ plan: { [MARDI]: ["p_erwan"] }, urgences: { [MARDI]: ["p_erwan"] } });
  });

  it("supprime un chantier ; ses affectations partent en cascade", async () => {
    await compagnon(app, "p_erwan");
    await chantier(app, "s_a");
    await chantier(app, "s_b");
    await poserSql(app, "s_a", LUNDI, "p_erwan");
    await poserSql(app, "s_b", MARDI, "p_erwan");
    const r = await appel(app, "DELETE", "/api/chantiers/s_a", { cookie });
    expect(r.statut).toBe(200);
    expect(await affectations(app)).toEqual([{ siteId: "s_b", day: MARDI, personId: "p_erwan", urgence: false }]);
    expect((await lire()).sites.map((s: Site) => s.id)).toEqual(["s_b"]);
    expect((await appel(app, "DELETE", "/api/chantiers/s_a", { cookie })).statut).toBe(404);
  });
});

describe("missions et étapes : des opérations, sans version", () => {
  const depart = { ph: [100, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], tasks: { "1": [true, false] } };

  it("cocher une mission donne exactement ce que donne setTask", async () => {
    await chantier(app, "s_a", depart);
    const attendu = normSite("s_a", { start: LUNDI, code: "A", ...depart });
    attendu.ph[1] = setTask(attendu, 1, 1, true);
    attendu.ph[4] = setTask(attendu, 4, 0, true);

    await appel(app, "POST", "/api/chantiers/s_a/missions", { cookie, corps: { etape: 1, mission: 1, faite: true } });
    const r = await appel(app, "POST", "/api/chantiers/s_a/missions", { cookie, corps: { etape: 4, mission: 0, faite: true } });
    expect(r.statut).toBe(200);
    expect(r.corps).toEqual({ ...attendu, version: 3, urgences: {} });
    expect(r.corps.ph[1]).toBe(100);
    expect(r.corps.ph[4]).toBe(50);

    /* Décocher, ce n'est pas basculer : « faite: false » rejoué deux fois reste décoché. */
    attendu.ph[1] = setTask(attendu, 1, 0, false);
    await appel(app, "POST", "/api/chantiers/s_a/missions", { cookie, corps: { etape: 1, mission: 0, faite: false } });
    const r2 = await appel(app, "POST", "/api/chantiers/s_a/missions", { cookie, corps: { etape: 1, mission: 0, faite: false } });
    expect(r2.corps).toMatchObject({ ph: attendu.ph, tasks: attendu.tasks });
  });

  it("régler une étape donne exactement ce que donne setPhasePct", async () => {
    await chantier(app, "s_a", depart);
    const attendu = normSite("s_a", { start: LUNDI, code: "A", ...depart });
    attendu.ph[0] = setPhasePct(attendu, 0, 40);
    attendu.ph[1] = setPhasePct(attendu, 1, 0);

    await appel(app, "POST", "/api/chantiers/s_a/etapes", { cookie, corps: { etape: 0, pourcentage: 40 } });
    const r = await appel(app, "POST", "/api/chantiers/s_a/etapes", { cookie, corps: { etape: 1, pourcentage: 0 } });
    expect(r.statut).toBe(200);
    expect(r.corps).toEqual({ ...attendu, version: 3, urgences: {} });
    expect(r.corps.tasks["0"]).toEqual([true, true, false, false, false]);
  });

  it("des cochages concurrents de missions différentes, sur le même chantier, gardent toutes les coches", async () => {
    await chantier(app, "s_a");
    /* L'étape 0 compte cinq missions : cinq appareils en cochent chacun une, au même instant. */
    const rs = await Promise.all([0, 1, 2, 3, 4].map(j =>
      appel(app, "POST", "/api/chantiers/s_a/missions", { cookie, corps: { etape: 0, mission: j, faite: true } })));
    expect(rs.map(r => r.statut)).toEqual([200, 200, 200, 200, 200]);
    const [s] = (await lire()).sites;
    expect(s.tasks["0"]).toEqual([true, true, true, true, true]);
    expect(s.ph[0]).toBe(100);
    expect(s.version).toBe(6);
  });

  it("deux cochages concurrents, deux missions, deux coches", async () => {
    await chantier(app, "s_a");
    const [a, b] = await Promise.all([
      appel(app, "POST", "/api/chantiers/s_a/missions", { cookie, corps: { etape: 9, mission: 0, faite: true } }),
      appel(app, "POST", "/api/chantiers/s_a/missions", { cookie, corps: { etape: 9, mission: 2, faite: true } })
    ]);
    expect([a.statut, b.statut]).toEqual([200, 200]);
    const [s] = (await lire()).sites;
    expect(s.tasks["9"]).toEqual([true, false, true, false]);
    expect(s.ph[9]).toBe(50);
  });

  it("refuse une mission que l'étape n'a pas, et une étape qui n'existe pas : 400", async () => {
    await chantier(app, "s_a");
    const hors = await appel(app, "POST", "/api/chantiers/s_a/missions", { cookie, corps: { etape: 3, mission: 1, faite: true } });
    expect(hors.statut).toBe(400);
    expect(hors.corps.champs).toEqual(expect.arrayContaining([expect.objectContaining({ chemin: "mission" })]));
    const etape = await appel(app, "POST", "/api/chantiers/s_a/etapes", { cookie, corps: { etape: 12, pourcentage: 10 } });
    expect(etape.statut).toBe(400);
  });

  it("chantier inconnu : 404", async () => {
    const r = await appel(app, "POST", "/api/chantiers/s_rien/missions", { cookie, corps: { etape: 0, mission: 0, faite: true } });
    expect(r.statut).toBe(404);
  });
});
