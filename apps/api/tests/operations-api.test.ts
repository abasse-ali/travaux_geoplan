/* ============================================================
   L'API et le domaine disent-ils la même chose ?

   Le client (W4) affiche un geste avant la réponse du réseau en
   appliquant l'opération du domaine (packages/domain/src/operations.ts)
   à ses données ; le serveur, lui, l'exécute en SQL. Si les deux
   divergeaient, l'écran montrerait un instant ce que la base ne fera
   pas. On tire des suites de gestes au hasard, on les joue des deux
   côtés, et on compare les plans et l'avancement.

   « Remplacer l'équipe » et « Appliquer ce plan » portent l'équipe que
   l'appareil voyait (`avant`). On la tire tantôt à jour, tantôt périmée
   — comme si un autre appareil avait agi entre-temps : la fusion à
   trois voies doit donner la même chose des deux côtés.
   ============================================================ */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { normPerson, normSite, teamOn, weekDates } from "@geoplan/domain";
import { appliquer, type Donnees, type Operation } from "@geoplan/domain/operations";
import { MODULES } from "../src/modules.ts";
import { appel, monterApp, sessionEssai, vider, type AppEssai } from "./aides.ts";

const SEMAINE = "2026-09-14";
const JOURS = weekDates(SEMAINE).slice(0, 3);          // trois jours suffisent à croiser les chantiers
const PIDS = ["p_a", "p_b", "p_c", "p_d"];
const SIDS = ["s_1", "s_2", "s_3"];

let app: AppEssai;
let cookie = "";
beforeAll(async () => { app = await monterApp(MODULES); });
afterAll(async () => { await app.fermer(); });

const depart = (): Donnees => ({
  people: PIDS.map(id => normPerson(id, { name: id })),
  sites: SIDS.map(id => normSite(id, { code: id.toUpperCase(), start: "2026-08-31" })),
  avail: []
});

async function repartirDeZero(): Promise<void> {
  await vider(app.base, app.redis);
  cookie = await sessionEssai(app);
  for (const p of depart().people) expect((await appel(app, "POST", "/api/compagnons", { cookie, corps: { id: p.id, name: p.name } })).statut).toBe(201);
  for (const s of depart().sites) expect((await appel(app, "POST", "/api/chantiers", { cookie, corps: { id: s.id, code: s.code, start: s.start } })).statut).toBe(201);
}

/* Un geste tiré, et ce que voyait l'appareil qui l'a fait : l'état à
   jour (`aJour`), ou l'équipe périmée que porte déjà l'opération. */
interface Geste { op: Operation; aJour: boolean }

/** L'`avant` d'un appareil qui voit `d`. */
function vu(d: Donnees, op: Operation): Operation {
  if (op.type === "equipe") {
    const s = d.sites.find(x => x.id === op.site);
    return { ...op, avant: s ? teamOn(s, op.jour) : [] };
  }
  if (op.type === "plan") return { ...op, avant: Object.fromEntries(Object.keys(op.plan).map(sid => {
    const s = d.sites.find(x => x.id === sid);
    return [sid, s ? Object.fromEntries(weekDates(op.semaine).map(j => [j, teamOn(s, j)])) : {}];
  })) };
  return op;
}

let n = 0;
async function jouer(op: Operation): Promise<void> {
  const cle = { "idempotency-key": "croise-" + (++n) };
  const r = await (async () => {
    switch (op.type) {
      case "poser": return appel(app, "POST", "/api/affectations/poser", { cookie, entetes: cle,
        corps: { chantierId: op.site, jour: op.jour, compagnonId: op.compagnon, urgence: op.urgence } });
      case "retirer": return appel(app, "POST", "/api/affectations/retirer", { cookie, entetes: cle,
        corps: { jour: op.jour, compagnonId: op.compagnon, chantierId: op.site } });
      case "equipe": return appel(app, "PUT", "/api/affectations/equipe", { cookie, entetes: cle,
        corps: { chantierId: op.site, jour: op.jour, compagnonIds: op.compagnons, avant: op.avant, urgence: op.urgence } });
      case "plan": return appel(app, "POST", "/api/affectations/plan", { cookie, entetes: cle,
        corps: { semaine: op.semaine, plan: op.plan, avant: op.avant, urgence: op.urgence } });
      case "cocher": return appel(app, "POST", "/api/chantiers/" + op.site + "/missions", { cookie, entetes: cle,
        corps: { etape: op.etape, mission: op.mission, faite: op.faite } });
      case "regler": return appel(app, "POST", "/api/chantiers/" + op.site + "/etapes", { cookie, entetes: cle,
        corps: { etape: op.etape, pourcentage: op.pourcentage } });
      default: throw new Error("hors champ : " + op.type);
    }
  })();
  expect(r.statut, JSON.stringify({ op, reponse: r.corps })).toBe(200);
}

const arbJour = fc.constantFrom(...JOURS);
const arbPid = fc.constantFrom(...PIDS);
const arbSid = fc.constantFrom(...SIDS);
const arbVue = fc.uniqueArray(arbPid, { maxLength: 3 });
const aJour = (op: Operation): Geste => ({ op, aJour: true });

const arbGeste: fc.Arbitrary<Geste> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ type: fc.constant("poser" as const), site: arbSid, jour: arbJour, compagnon: arbPid, urgence: fc.boolean() }).map(aJour) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant("retirer" as const), jour: arbJour, compagnon: arbPid, site: fc.option(arbSid, { nil: null }) }).map(aJour) },
  { weight: 3, arbitrary: fc.record({
      op: fc.record({ type: fc.constant("equipe" as const), site: arbSid, jour: arbJour, compagnons: fc.uniqueArray(arbPid, { maxLength: 3 }),
                      avant: arbVue, urgence: fc.boolean() }),
      aJour: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant("plan" as const), semaine: fc.constant(SEMAINE), urgence: fc.boolean(),
      plan: fc.dictionary(arbSid, fc.dictionary(arbJour, fc.uniqueArray(arbPid, { maxLength: 2 }), { maxKeys: 2 }), { minKeys: 1, maxKeys: 2 }) })
      .chain(o => fc.record({
        avant: fc.record(Object.fromEntries(Object.keys(o.plan).map(sid => [sid, fc.dictionary(arbJour, arbVue, { maxKeys: 2 })]))),
        aJour: fc.boolean()
      }).map(({ avant, aJour: vuAJour }): Geste => ({ op: { ...o, avant }, aJour: vuAJour }))) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("cocher" as const), site: arbSid, etape: fc.integer({ min: 0, max: 11 }), mission: fc.constant(0), faite: fc.boolean() }).map(aJour) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("regler" as const), site: arbSid, etape: fc.integer({ min: 0, max: 11 }), pourcentage: fc.integer({ min: 0, max: 100 }) }).map(aJour) }
);

/* Ce qu'on compare : les équipes de chaque chantier (dans l'ordre des
   puces, urgences comprises), l'avancement et les coches. */
type SiteLu = { id: string; plan: Record<string, string[]>; ph: number[]; tasks: Record<string, boolean[]> };
const vue = (sites: SiteLu[]) =>
  Object.fromEntries(sites.map(s => [s.id, {
    plan: Object.fromEntries(Object.entries(s.plan).filter(([, ids]) => ids.length).sort()),
    ph: s.ph, tasks: s.tasks
  }]));

/** Joue les gestes des deux côtés ; rend ce que dit la base. */
async function jouerLesDeux(gestes: Geste[]): Promise<Donnees> {
  await repartirDeZero();
  let attendu = depart();
  for (const g of gestes) {
    const op = g.aJour ? vu(attendu, g.op) : g.op;
    await jouer(op);
    attendu = appliquer(attendu, op);
  }
  const lu = await appel(app, "GET", "/api/donnees", { cookie });
  expect(vue(lu.corps.sites)).toEqual(vue(attendu.sites));
  return lu.corps;
}

describe("l'API et les opérations du domaine", () => {
  it("donnent les mêmes plans et le même avancement, geste après geste", async () => {
    await fc.assert(fc.asyncProperty(fc.array(arbGeste, { minLength: 1, maxLength: 6 }), async gestes => {
      await jouerLesDeux(gestes);
    }), { numRuns: 60, seed: 20260926, endOnFailure: true });
  }, 600_000);
});

/* Les cas limites, joués à coup sûr : les tirages au hasard les
   rencontrent trop rarement pour qu'on s'y fie. Le troisième élément,
   s'il est là, dit en clair ce que la base doit contenir à la fin. */
const perime = (op: Operation): Geste => ({ op, aJour: false });
const CAS: [string, Geste[], ((d: Donnees) => void)?][] = [
  ["équipe hors urgence : qui était déjà là n'est pas retiré de son urgence ailleurs", [
    aJour({ type: "poser", site: "s_1", jour: JOURS[0], compagnon: "p_a", urgence: false }),
    aJour({ type: "poser", site: "s_2", jour: JOURS[0], compagnon: "p_a", urgence: true }),
    aJour({ type: "equipe", site: "s_1", jour: JOURS[0], compagnons: ["p_a", "p_b"], avant: [], urgence: false })
  ]],
  ["équipe hors urgence : qui n'était pas là quitte ses autres chantiers", [
    aJour({ type: "poser", site: "s_2", jour: JOURS[0], compagnon: "p_c", urgence: false }),
    aJour({ type: "equipe", site: "s_1", jour: JOURS[0], compagnons: ["p_c"], avant: [], urgence: false })
  ]],
  ["plan : un jour absent du plan est vidé sur les chantiers cités", [
    aJour({ type: "poser", site: "s_1", jour: JOURS[1], compagnon: "p_a", urgence: false }),
    aJour({ type: "poser", site: "s_3", jour: JOURS[1], compagnon: "p_b", urgence: false }),
    aJour({ type: "plan", semaine: SEMAINE, urgence: false, plan: { s_1: { [JOURS[0]]: ["p_a"] } }, avant: {} })
  ]],
  ["plan hors urgence : chacun quitte ses autres chantiers, même s'il était déjà posé ici", [
    aJour({ type: "poser", site: "s_1", jour: JOURS[0], compagnon: "p_a", urgence: false }),
    aJour({ type: "poser", site: "s_2", jour: JOURS[0], compagnon: "p_a", urgence: true }),
    aJour({ type: "plan", semaine: SEMAINE, urgence: false, plan: { s_1: { [JOURS[0]]: ["p_a"] } }, avant: {} })
  ]],
  ["poser hors urgence retire aussi une affectation d'urgence ailleurs", [
    aJour({ type: "poser", site: "s_1", jour: JOURS[2], compagnon: "p_d", urgence: false }),
    aJour({ type: "poser", site: "s_2", jour: JOURS[2], compagnon: "p_d", urgence: true }),
    aJour({ type: "poser", site: "s_3", jour: JOURS[2], compagnon: "p_d", urgence: false })
  ]],
  ["équipe vue en retard : ce que l'associé a posé entre-temps reste", [
    aJour({ type: "poser", site: "s_1", jour: JOURS[0], compagnon: "p_a", urgence: false }),
    aJour({ type: "poser", site: "s_1", jour: JOURS[0], compagnon: "p_c", urgence: false }),
    perime({ type: "equipe", site: "s_1", jour: JOURS[0], compagnons: ["p_a", "p_b"], avant: ["p_a"], urgence: false })
  ], d => expect(teamOn(d.sites.find(s => s.id === "s_1")!, JOURS[0])).toEqual(["p_a", "p_b", "p_c"])],
  ["plan vu en retard : la journée remplie entre-temps n'est pas vidée", [
    aJour({ type: "poser", site: "s_2", jour: JOURS[1], compagnon: "p_b", urgence: false }),
    perime({ type: "plan", semaine: SEMAINE, urgence: false, plan: { s_2: { [JOURS[0]]: ["p_a"] } }, avant: { s_2: {} } })
  ], d => expect(d.sites.find(s => s.id === "s_2")!.plan).toEqual({ [JOURS[0]]: ["p_a"], [JOURS[1]]: ["p_b"] })],
  ["plan vu en retard : ce qu'un chantier du plan prend, un autre ne le reprend pas", [
    aJour({ type: "poser", site: "s_2", jour: JOURS[0], compagnon: "p_c", urgence: false }),
    perime({ type: "plan", semaine: SEMAINE, urgence: false,
             plan: { s_1: { [JOURS[0]]: ["p_c"] }, s_2: { [JOURS[0]]: ["p_a"] } }, avant: { s_1: {}, s_2: {} } })
  ], d => {
    expect(teamOn(d.sites.find(s => s.id === "s_1")!, JOURS[0])).toEqual(["p_c"]);
    expect(teamOn(d.sites.find(s => s.id === "s_2")!, JOURS[0])).toEqual(["p_a"]);
  }]
];

describe("l'API et les opérations du domaine — cas limites", () => {
  for (const [nom, gestes, verifier] of CAS) {
    it(nom, async () => {
      const lu = await jouerLesDeux(gestes);
      verifier?.(lu);
    });
  }
});
