/* ============================================================
   Affectations — « un homme, un chantier, par jour, sauf urgence »

   Ce que fait l'interface aujourd'hui (assignDay, applyPlan), rejoué
   par le serveur, et tenu même quand plusieurs appareils agissent au
   même instant.
   ============================================================ */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { weekDates } from "@geoplan/domain";
import { appel, sessionEssai, vider, type AppEssai } from "./aides.ts";
import {
  affectations, chantier, compagnon, monterDonnees, poserSql, type Affectation,
  LUNDI, MARDI, MERCREDI
} from "./aides-donnees.ts";

let app: AppEssai;
let cookie: string;

beforeAll(async () => { app = await monterDonnees(); });
afterAll(async () => { await app.fermer(); });
beforeEach(async () => {
  await vider(app.base, app.redis);
  app.changements.length = 0;
  cookie = await sessionEssai(app);
  for (const id of ["p_erwan", "p_nixon", "p_giorgi"]) await compagnon(app, id);
  for (const id of ["s_a", "s_b", "s_c"]) await chantier(app, id);
});

const poser = (chantierId: string, jour: string, compagnonId: string, urgence = false) =>
  appel(app, "POST", "/api/affectations/poser", { cookie, corps: { chantierId, jour, compagnonId, urgence } });

const ligne = (siteId: string, day: string, personId: string, urgence = false): Affectation =>
  ({ siteId, day, personId, urgence });

/* Ce que voit un appareil à jour : les plans de chaque chantier, tels
   que la base les rend à l'instant. C'est l'`avant` qu'il enverrait. */
async function vues(): Promise<Record<string, Record<string, string[]>>> {
  const r = await appel(app, "GET", "/api/donnees", { cookie });
  return Object.fromEntries(r.corps.sites.map((s: { id: string; plan: Record<string, string[]> }) => [s.id, s.plan]));
}

/* Aucune personne posée deux fois le même jour hors urgence : ce que
   la base garantit, vérifié depuis l'extérieur. */
function aucunDoublon(lignes: Affectation[]): void {
  const vus = new Set<string>();
  for (const l of lignes.filter(l => !l.urgence)) {
    const k = l.day + "/" + l.personId;
    expect(vus.has(k), "doublé : " + k).toBe(false);
    vus.add(k);
  }
}

describe("poser", () => {
  it("hors urgence, déplace : retire d'abord des autres chantiers ce jour-là", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan");
    await poserSql(app, "s_a", MERCREDI, "p_erwan");
    const r = await poser("s_b", MARDI, "p_erwan");
    expect(r.statut).toBe(200);
    expect(r.corps).toEqual({ chantiers: {
      s_a: { plan: { [MARDI]: [] }, urgences: { [MARDI]: [] } },
      s_b: { plan: { [MARDI]: ["p_erwan"] }, urgences: { [MARDI]: [] } }
    } });
    /* Le mercredi n'était pas concerné. */
    expect(await affectations(app)).toEqual([ligne("s_b", MARDI, "p_erwan"), ligne("s_a", MERCREDI, "p_erwan")]);
    expect(app.changements).toEqual([{ quoi: "assignments", ids: ["s_a", "s_b"], jours: [MARDI] }]);
  });

  it("ajoute en fin d'équipe", async () => {
    await poser("s_a", MARDI, "p_nixon");
    await poser("s_a", MARDI, "p_erwan");
    const r = await poser("s_a", MARDI, "p_giorgi");
    expect(r.corps.chantiers.s_a.plan[MARDI]).toEqual(["p_nixon", "p_erwan", "p_giorgi"]);
  });

  it("en urgence, double la personne déjà posée ailleurs, et le signale", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan");
    const r = await poser("s_b", MARDI, "p_erwan", true);
    expect(r.statut).toBe(200);
    expect(r.corps.chantiers.s_b).toEqual({ plan: { [MARDI]: ["p_erwan"] }, urgences: { [MARDI]: ["p_erwan"] } });
    expect(await affectations(app)).toEqual([ligne("s_a", MARDI, "p_erwan"), ligne("s_b", MARDI, "p_erwan", true)]);

    const d = (await appel(app, "GET", "/api/donnees", { cookie })).corps;
    const par = Object.fromEntries(d.sites.map((s: { id: string }) => [s.id, s]));
    expect(par.s_a).toMatchObject({ plan: { [MARDI]: ["p_erwan"] }, urgences: {} });
    expect(par.s_b).toMatchObject({ plan: { [MARDI]: ["p_erwan"] }, urgences: { [MARDI]: ["p_erwan"] } });
  });

  it("en urgence, pose normalement quelqu'un qui n'est posé nulle part", async () => {
    const r = await poser("s_b", MARDI, "p_erwan", true);
    expect(r.corps.chantiers.s_b.urgences[MARDI]).toEqual([]);
    expect(await affectations(app)).toEqual([ligne("s_b", MARDI, "p_erwan")]);
  });

  it("déjà sur ce chantier ce jour-là : rien ne change, 200, rien d'annoncé", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan");
    const r = await poser("s_a", MARDI, "p_erwan");
    expect(r.statut).toBe(200);
    expect(r.corps.chantiers.s_a.plan[MARDI]).toEqual(["p_erwan"]);
    expect(app.changements).toEqual([]);
  });

  it("chantier ou compagnon inconnu : 404", async () => {
    expect((await poser("s_rien", MARDI, "p_erwan")).statut).toBe(404);
    const r = await poser("s_a", MARDI, "p_personne");
    expect(r.statut).toBe(404);
    expect(r.corps).toMatchObject({ erreur: "introuvable", ids: ["p_personne"] });
  });

  it("50 poses concurrentes de la même personne, le même jour, sur 50 chantiers : un seul chantier à la fin", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => "s_" + String(i).padStart(2, "0"));
    for (const id of ids) await chantier(app, id);
    const rs = await Promise.all(ids.map(sid => poser(sid, MARDI, "p_erwan")));
    /* Chaque pose déplace la précédente ; un éventuel conflit résiduel
       serait un 409 propre, jamais un 500 ni un doublon. */
    for (const r of rs) expect([200, 409]).toContain(r.statut);
    const finales = (await affectations(app)).filter(l => l.personId === "p_erwan" && l.day === MARDI);
    expect(finales).toHaveLength(1);
    expect(finales[0].urgence).toBe(false);
    console.log(`50 poses concurrentes : ${rs.filter(r => r.statut === 200).length} × 200, ` +
      `${rs.filter(r => r.statut === 409).length} × 409 ; Erwan finit sur ${finales[0].siteId}`);
  });

  it("un conflit résiduel sur un_homme_un_jour remonte en 409", async () => {
    /* Un autre écrivain, qui ne passe pas par les verrous de l'API (ni
       même par les clés étrangères), a posé Erwan sur s_b sans avoir
       encore validé. La pose par l'API bute alors sur l'index unique. */
    const c = await app.base.pool.getConnection();
    try {
      await c.query("SET FOREIGN_KEY_CHECKS = 0");
      await c.query("START TRANSACTION");
      await c.query("INSERT INTO assignments (site_id, day, person_id, urgence, occupe, position) VALUES ('s_b', ?, 'p_erwan', 0, 1, 0)", [MARDI]);
      const enVol = poser("s_a", MARDI, "p_erwan");
      /* On attend que l'insertion de l'API soit bloquée par la nôtre. */
      for (let i = 0; i < 200; i++) {
        const [l] = await app.base.pool.query(
          "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE INFO LIKE 'insert into `assignments`%'");
        if ((l as { n: number }[])[0].n > 0) break;
        await new Promise(ok => setTimeout(ok, 10));
      }
      await c.query("COMMIT");
      const r = await enVol;
      expect(r.statut).toBe(409);
      expect(r.corps).toMatchObject({ erreur: "conflit", regle: "un-homme-un-jour" });
    } finally {
      await c.query("SET FOREIGN_KEY_CHECKS = 1");
      c.release();
    }
    expect(await affectations(app)).toEqual([ligne("s_b", MARDI, "p_erwan")]);
  });
});

describe("retirer", () => {
  it("d'un chantier précis", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan");
    await poserSql(app, "s_b", MARDI, "p_erwan", true);
    const r = await appel(app, "POST", "/api/affectations/retirer",
      { cookie, corps: { jour: MARDI, compagnonId: "p_erwan", chantierId: "s_a" } });
    expect(r.statut).toBe(200);
    /* s_b n'est plus un doublon : son affectation redevient normale, et
       la réponse le dit. */
    expect(Object.keys(r.corps.chantiers)).toEqual(["s_a", "s_b"]);
    expect(await affectations(app)).toEqual([ligne("s_b", MARDI, "p_erwan")]);
  });

  it("de tous ses chantiers ce jour-là", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan");
    await poserSql(app, "s_b", MARDI, "p_erwan", true);
    await poserSql(app, "s_a", MERCREDI, "p_erwan");
    const r = await appel(app, "POST", "/api/affectations/retirer", { cookie, corps: { jour: MARDI, compagnonId: "p_erwan" } });
    expect(r.corps).toEqual({ chantiers: {
      s_a: { plan: { [MARDI]: [] }, urgences: { [MARDI]: [] } },
      s_b: { plan: { [MARDI]: [] }, urgences: { [MARDI]: [] } }
    } });
    expect(await affectations(app)).toEqual([ligne("s_a", MERCREDI, "p_erwan")]);
  });
});

describe("remplacer l'équipe d'un jour", () => {
  const equipe = async (chantierId: string, jour: string, compagnonIds: string[], urgence = false) =>
    appel(app, "PUT", "/api/affectations/equipe", { cookie,
      corps: { chantierId, jour, compagnonIds, urgence, avant: (await vues())[chantierId]?.[jour] ?? [] } });

  it("retire ceux qui sortent, pose ceux qui entrent (déplacés d'ailleurs), dans l'ordre donné", async () => {
    await poserSql(app, "s_a", MARDI, "p_nixon", false, 0);
    await poserSql(app, "s_a", MARDI, "p_erwan", false, 1);
    await poserSql(app, "s_b", MARDI, "p_giorgi");
    const r = await equipe("s_a", MARDI, ["p_giorgi", "p_nixon", "p_giorgi"]);
    expect(r.statut).toBe(200);
    expect(r.corps).toEqual({ chantiers: {
      s_a: { plan: { [MARDI]: ["p_giorgi", "p_nixon"] }, urgences: { [MARDI]: [] } },
      s_b: { plan: { [MARDI]: [] }, urgences: { [MARDI]: [] } }
    } });
    aucunDoublon(await affectations(app));
  });

  it("une liste vide : plus personne", async () => {
    await poserSql(app, "s_a", MARDI, "p_nixon");
    const r = await equipe("s_a", MARDI, []);
    expect(r.corps.chantiers.s_a.plan[MARDI]).toEqual([]);
    expect(await affectations(app)).toEqual([]);
  });

  it("en urgence, double ceux qui sont déjà posés ailleurs sans les en retirer", async () => {
    await poserSql(app, "s_b", MARDI, "p_giorgi");
    const r = await equipe("s_a", MARDI, ["p_nixon", "p_giorgi"], true);
    expect(r.corps.chantiers.s_a).toEqual({ plan: { [MARDI]: ["p_nixon", "p_giorgi"] }, urgences: { [MARDI]: ["p_giorgi"] } });
    expect(await affectations(app)).toEqual([
      ligne("s_a", MARDI, "p_nixon"), ligne("s_a", MARDI, "p_giorgi", true), ligne("s_b", MARDI, "p_giorgi")
    ]);
  });
});

describe("appliquer un plan de semaine", () => {
  const plan = async (semaine: string, p: Record<string, Record<string, string[]>>, urgence = false) => {
    const v = await vues();
    const jours = weekDates(semaine);
    const avant = Object.fromEntries(Object.keys(p).map(sid =>
      [sid, Object.fromEntries(Object.entries(v[sid] ?? {}).filter(([j]) => jours.includes(j)))]));
    return appel(app, "POST", "/api/affectations/plan", { cookie, corps: { semaine, plan: p, urgence, avant } });
  };

  it("remplace la semaine des chantiers cités, sans jamais doubler personne", async () => {
    const semaine = weekDates(LUNDI);
    /* Erwan était sur s_a toute la semaine ; Nixon sur s_c (non cité) mardi. */
    for (const j of semaine.slice(0, 5)) await poserSql(app, "s_a", j, "p_erwan");
    await poserSql(app, "s_c", MARDI, "p_nixon");

    const r = await plan(LUNDI, {
      s_a: { [LUNDI]: ["p_nixon"], [MARDI]: ["p_nixon", "p_giorgi"] },
      s_b: { [LUNDI]: ["p_erwan"], [MARDI]: ["p_erwan"] }
    });
    expect(r.statut).toBe(200);
    /* Comme applyPlan : un jour absent du plan est vidé sur les chantiers cités. */
    const lignes = await affectations(app);
    expect(lignes).toEqual([
      ligne("s_a", LUNDI, "p_nixon"), ligne("s_b", LUNDI, "p_erwan"),
      ligne("s_a", MARDI, "p_nixon"), ligne("s_a", MARDI, "p_giorgi"), ligne("s_b", MARDI, "p_erwan")
    ]);
    aucunDoublon(lignes);
    /* La réponse couvre les sept jours des chantiers touchés, s_c compris. */
    expect(Object.keys(r.corps.chantiers)).toEqual(["s_a", "s_b", "s_c"]);
    expect(Object.keys(r.corps.chantiers.s_a.plan)).toEqual(semaine);
    expect(r.corps.chantiers.s_c.plan[MARDI]).toEqual([]);
    expect(app.changements).toEqual([{ quoi: "assignments", ids: ["s_a", "s_b", "s_c"], jours: semaine }]);
  });

  it("un plan qui cite deux fois la même personne le même jour ne la double pas", async () => {
    await plan(LUNDI, { s_a: { [MARDI]: ["p_erwan"] }, s_b: { [MARDI]: ["p_erwan"] } });
    const lignes = await affectations(app);
    expect(lignes).toHaveLength(1);
    aucunDoublon(lignes);
  });

  it("en urgence, double et le signale", async () => {
    await poserSql(app, "s_c", MARDI, "p_erwan");
    const r = await plan(LUNDI, { s_a: { [MARDI]: ["p_erwan"] } }, true);
    expect(r.corps.chantiers.s_a.urgences[MARDI]).toEqual(["p_erwan"]);
    expect(await affectations(app)).toEqual([ligne("s_a", MARDI, "p_erwan", true), ligne("s_c", MARDI, "p_erwan")]);
  });

  it("refuse une semaine qui ne commence pas un lundi, et un jour hors de la semaine : 400", async () => {
    expect((await plan(MARDI, { s_a: {} })).statut).toBe(400);
    const r = await plan(LUNDI, { s_a: { "2026-09-21": ["p_erwan"] } });
    expect(r.statut).toBe(400);
    expect(r.corps.champs).toEqual([expect.objectContaining({ chemin: "plan.s_a.2026-09-21" })]);
    expect(await affectations(app)).toEqual([]);
  });

  it("un chantier inconnu annule tout le plan : 404, rien d'écrit", async () => {
    const r = await plan(LUNDI, { s_a: { [LUNDI]: ["p_erwan"] }, s_rien: { [LUNDI]: ["p_nixon"] } });
    expect(r.statut).toBe(404);
    expect(await affectations(app)).toEqual([]);
  });
});

/* La relecture adversariale de W3 : « Remplacer l'équipe » et « Appliquer
   ce plan » écrivaient l'état voulu sans regarder ce que l'appareil avait
   vu. Un appareil en retard effaçait, avec un 200, ce qu'un autre avait
   posé entre-temps. Ils portent maintenant `avant`, et seul l'écart est
   appliqué. */
describe("deux appareils : un geste fait sur une équipe vue en retard", () => {
  const equipeVue = (chantierId: string, jour: string, compagnonIds: string[], avant: string[], cle?: string) =>
    appel(app, "PUT", "/api/affectations/equipe", { cookie, entetes: cle ? { "idempotency-key": cle } : undefined,
      corps: { chantierId, jour, compagnonIds, avant, urgence: false } });

  it("remplacer l'équipe n'efface pas ce que l'associé a posé entre-temps", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan", false, 0);
    /* Geoffrey voit [Erwan]. L'associé pose Nixon. Geoffrey, en retard, ajoute Giorgi. */
    expect((await poser("s_a", MARDI, "p_nixon")).statut).toBe(200);
    const r = await equipeVue("s_a", MARDI, ["p_erwan", "p_giorgi"], ["p_erwan"]);
    expect(r.statut).toBe(200);
    expect(r.corps.chantiers.s_a.plan[MARDI]).toEqual(["p_erwan", "p_giorgi", "p_nixon"]);
  });

  it("ni ne ressuscite celui que l'associé a retiré entre-temps", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan", false, 0);
    await poserSql(app, "s_a", MARDI, "p_nixon", false, 1);
    /* Geoffrey voit [Erwan, Nixon]. L'associé retire Erwan. Geoffrey retire Nixon. */
    await appel(app, "POST", "/api/affectations/retirer", { cookie, corps: { jour: MARDI, compagnonId: "p_erwan", chantierId: "s_a" } });
    const r = await equipeVue("s_a", MARDI, ["p_erwan"], ["p_erwan", "p_nixon"]);
    expect(r.corps.chantiers.s_a.plan[MARDI]).toEqual([]);
    expect(await affectations(app)).toEqual([]);
  });

  it("appliquer un plan n'efface pas la journée qu'un autre a remplie entre-temps", async () => {
    /* Geoffrey calcule son plan quand s_b est vide ; l'associé y pose Giorgi mardi. */
    await poser("s_b", MARDI, "p_giorgi");
    const r = await appel(app, "POST", "/api/affectations/plan", { cookie,
      corps: { semaine: LUNDI, plan: { s_b: { [LUNDI]: ["p_erwan"] } }, avant: { s_b: {} }, urgence: false } });
    expect(r.statut).toBe(200);
    expect(await affectations(app)).toEqual([ligne("s_b", LUNDI, "p_erwan"), ligne("s_b", MARDI, "p_giorgi")]);
  });

  it("rejoué sous une autre clé, le même geste ne change plus rien", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan", false, 0);
    const une = await equipeVue("s_a", MARDI, ["p_nixon"], ["p_erwan"], "geste-1");
    app.changements.length = 0;
    const deux = await equipeVue("s_a", MARDI, ["p_nixon"], ["p_erwan"], "geste-2");
    expect(deux.corps).toEqual(une.corps);
    expect(app.changements).toEqual([]);
  });

  it("sans `avant`, ou un `avant` qui ne cite pas les chantiers du plan : 400, rien d'écrit", async () => {
    const sansAvant = await appel(app, "PUT", "/api/affectations/equipe", { cookie,
      corps: { chantierId: "s_a", jour: MARDI, compagnonIds: ["p_erwan"], urgence: false } });
    expect(sansAvant.statut).toBe(400);
    for (const avant of [{}, { s_b: {} }, { s_a: {}, s_b: {} }]) {
      const r = await appel(app, "POST", "/api/affectations/plan", { cookie,
        corps: { semaine: LUNDI, plan: { s_a: { [MARDI]: ["p_erwan"] } }, avant, urgence: false } });
      expect(r.statut, JSON.stringify(avant)).toBe(400);
    }
    expect(await affectations(app)).toEqual([]);
  });
});

describe("retirer, chantier nul", () => {
  it("chantierId: null vaut « de tous ses chantiers », comme l'opération du domaine", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan");
    const r = await appel(app, "POST", "/api/affectations/retirer", { cookie,
      corps: { jour: MARDI, compagnonId: "p_erwan", chantierId: null } });
    expect(r.statut).toBe(200);
    expect(await affectations(app)).toEqual([]);
  });
});

/* Relecture adversariale de W3 : une fois le doublon défait, l'affectation
   d'urgence restante gardait urgence = 1. L'écran signalait une
   dérogation qui n'existait plus, et la journée échappait à la contrainte
   un_homme_un_jour. */
describe("l'urgence qui ne double plus personne redevient normale", () => {
  it("retirer l'affectation normale : l'urgence restante devient normale", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan");
    await poserSql(app, "s_b", MARDI, "p_erwan", true);
    const r = await appel(app, "POST", "/api/affectations/retirer", { cookie,
      corps: { jour: MARDI, compagnonId: "p_erwan", chantierId: "s_a" } });
    expect(r.statut).toBe(200);
    expect(r.corps.chantiers.s_b).toEqual({ plan: { [MARDI]: ["p_erwan"] }, urgences: { [MARDI]: [] } });
    expect(await affectations(app)).toEqual([ligne("s_b", MARDI, "p_erwan")]);
    /* La journée est de nouveau tenue : un doublon normal serait refusé. */
    await expect(poserSql(app, "s_c", MARDI, "p_erwan")).rejects.toThrow();
  });

  it("un plan hors urgence qui le pose là où il était doublé : plus d'urgence", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan");
    await poserSql(app, "s_b", MARDI, "p_erwan", true);
    const r = await appel(app, "POST", "/api/affectations/plan", { cookie,
      corps: { semaine: LUNDI, plan: { s_b: { [MARDI]: ["p_erwan"] } }, avant: { s_b: { [MARDI]: ["p_erwan"] } }, urgence: false } });
    expect(r.statut).toBe(200);
    expect(await affectations(app)).toEqual([ligne("s_b", MARDI, "p_erwan")]);
  });

  it("supprimer le chantier de l'affectation normale : l'urgence ailleurs devient normale, et c'est annoncé", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan");
    await poserSql(app, "s_b", MARDI, "p_erwan", true);
    expect((await appel(app, "DELETE", "/api/chantiers/s_a", { cookie })).statut).toBe(200);
    expect(await affectations(app)).toEqual([ligne("s_b", MARDI, "p_erwan")]);
    expect(app.changements).toEqual([
      { quoi: "site", ids: ["s_a"] },
      { quoi: "assignments", ids: ["s_b"], jours: [MARDI] }
    ]);
  });

  it("deux urgences restantes : une seule redevient normale", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan");
    await poserSql(app, "s_b", MARDI, "p_erwan", true);
    await poserSql(app, "s_c", MARDI, "p_erwan", true);
    await appel(app, "POST", "/api/affectations/retirer", { cookie, corps: { jour: MARDI, compagnonId: "p_erwan", chantierId: "s_a" } });
    const lignes = await affectations(app);
    expect(lignes.map(l => l.siteId)).toEqual(["s_b", "s_c"]);
    expect(lignes.filter(l => !l.urgence)).toHaveLength(1);
  });

  it("une urgence qui double encore quelqu'un reste une urgence", async () => {
    await poserSql(app, "s_a", MARDI, "p_erwan");
    await poserSql(app, "s_b", MARDI, "p_erwan", true);
    await poserSql(app, "s_c", MARDI, "p_erwan", true);
    await appel(app, "POST", "/api/affectations/retirer", { cookie, corps: { jour: MARDI, compagnonId: "p_erwan", chantierId: "s_b" } });
    expect(await affectations(app)).toEqual([ligne("s_a", MARDI, "p_erwan"), ligne("s_c", MARDI, "p_erwan", true)]);
  });
});
