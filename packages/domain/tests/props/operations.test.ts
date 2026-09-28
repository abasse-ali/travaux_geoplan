/* ============================================================
   Les opérations font-elles exactement ce que faisait App ?

   La référence est une copie fidèle des actions d'App (App.tsx, avant
   W4) : elles modifiaient les chantiers sur place. On tire des suites de
   gestes au hasard, on les joue des deux côtés, et on compare les plans.
   On vérifie aussi que `appliquer` ne modifie jamais ses entrées, et que
   seuls les chantiers touchés changent d'identité.
   ============================================================ */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { normPerson, normSite, setPhasePct, setTask, setTeamOn, teamOn, weekDates, type Site } from "../../src/domain.ts";
import { appliquer, fusionnerEquipe, type Donnees, type Operation } from "../../src/operations.ts";
import { GRAINE } from "./arbitraires.ts";

fc.configureGlobal({ seed: GRAINE });

const SEMAINE = "2026-09-14";
const JOURS = weekDates(SEMAINE);
const PIDS = ["p_a", "p_b", "p_c", "p_d", "p_e"];
const SIDS = ["s_1", "s_2", "s_3"];

/* ---------- la référence : les actions d'App, qui modifient sur place ---------- */

function assignDay(sites: Site[], pid: string, sid: string | null, d: string, urgence: boolean): void {
  const before = sites.filter(x => teamOn(x, d).includes(pid));
  if (!sid) { before.forEach(x => setTeamOn(x, d, teamOn(x, d).filter(y => y !== pid))); return; }
  const target = sites.find(s => s.id === sid);
  if (!target || teamOn(target, d).includes(pid)) return;
  if (!urgence) before.forEach(x => setTeamOn(x, d, teamOn(x, d).filter(y => y !== pid)));
  setTeamOn(target, d, [...teamOn(target, d), pid]);
}

function reference(sites: Site[], op: Operation): void {
  switch (op.type) {
    case "poser": assignDay(sites, op.compagnon, op.site, op.jour, op.urgence); break;
    case "retirer":
      if (op.site) {                                   // toggleDay, côté retrait
        const s = sites.find(x => x.id === op.site);
        if (s && teamOn(s, op.jour).includes(op.compagnon))
          setTeamOn(s, op.jour, teamOn(s, op.jour).filter(x => x !== op.compagnon));
      } else assignDay(sites, op.compagnon, null, op.jour, false);
      break;
    case "plan":                                        // applyPlan : les sept jours
      for (const sid of Object.keys(op.plan)) for (const d of weekDates(op.semaine)) {
        const ids = op.plan[sid][d] ?? [];
        if (!op.urgence) ids.forEach(pid => sites.forEach(o => {
          if (o.id === sid || !teamOn(o, d).includes(pid)) return;
          setTeamOn(o, d, teamOn(o, d).filter(x => x !== pid));
        }));
        const cible = sites.find(s => s.id === sid);
        if (cible) setTeamOn(cible, d, ids);
      }
      break;
    case "equipe": {                                    // la sémantique du serveur (W3)
      const s = sites.find(x => x.id === op.site);
      if (!s) break;
      const deja = teamOn(s, op.jour);
      if (!op.urgence) for (const pid of op.compagnons) if (!deja.includes(pid))
        sites.forEach(o => { if (o.id !== op.site && teamOn(o, op.jour).includes(pid)) setTeamOn(o, op.jour, teamOn(o, op.jour).filter(x => x !== pid)); });
      setTeamOn(s, op.jour, op.compagnons);
      break;
    }
    case "cocher": { const s = sites.find(x => x.id === op.site); if (s) s.ph[op.etape] = setTask(s, op.etape, op.mission, op.faite); break; }
    case "regler": { const s = sites.find(x => x.id === op.site); if (s) s.ph[op.etape] = setPhasePct(s, op.etape, op.pourcentage); break; }
    default: throw new Error("hors du champ de ce test : " + op.type);
  }
}

/* ---------- tirages ---------- */

const arbJour = fc.constantFrom(...JOURS);
const arbPid = fc.constantFrom(...PIDS);
const arbSid = fc.constantFrom(...SIDS);

const arbOp: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({ type: fc.constant("poser" as const), site: arbSid, jour: arbJour, compagnon: arbPid, urgence: fc.boolean() }),
  fc.record({ type: fc.constant("retirer" as const), jour: arbJour, compagnon: arbPid, site: fc.option(arbSid, { nil: null }) }),
  fc.record({ type: fc.constant("equipe" as const), site: arbSid, jour: arbJour, compagnons: fc.uniqueArray(arbPid, { maxLength: 3 }),
    avant: fc.constant([] as string[]), urgence: fc.boolean() }),
  fc.record({
    type: fc.constant("plan" as const), semaine: fc.constant(SEMAINE), urgence: fc.boolean(),
    plan: fc.dictionary(arbSid, fc.dictionary(arbJour, fc.uniqueArray(arbPid, { maxLength: 3 }), { maxKeys: 3 }), { maxKeys: 2 }),
    avant: fc.constant({} as Record<string, Record<string, string[]>>)
  }),
  fc.record({ type: fc.constant("cocher" as const), site: arbSid, etape: fc.integer({ min: 0, max: 11 }), mission: fc.integer({ min: 0, max: 1 }), faite: fc.boolean() }),
  fc.record({ type: fc.constant("regler" as const), site: arbSid, etape: fc.integer({ min: 0, max: 11 }), pourcentage: fc.integer({ min: 0, max: 100 }) })
);

/* Un départ possiblement déjà « en urgence » : quelqu'un sur deux chantiers le même jour. */
const arbDepart: fc.Arbitrary<Donnees> = fc.array(
  fc.record({ site: arbSid, jour: arbJour, pid: arbPid }), { maxLength: 12 }
).map(poses => {
  const sites = SIDS.map(id => normSite(id, { code: id.toUpperCase(), start: "2026-08-31" }));
  for (const p of poses) { const s = sites.find(x => x.id === p.site)!; setTeamOn(s, p.jour, [...teamOn(s, p.jour), p.pid]); }
  return { people: PIDS.map(id => normPerson(id, { name: id })), sites, avail: [] };
});

const instantane = (d: Donnees) => d.sites.map(s => ({ id: s.id, plan: s.plan, ph: s.ph, tasks: s.tasks }));

/* L'appareil qui fait le geste voit `d` : c'est ce qu'il envoie comme
   `avant` pour « remplacer l'équipe » et « appliquer ce plan ». */
function vu(d: Donnees, op: Operation): Operation {
  const equipes = (sid: string) => {
    const s = d.sites.find(x => x.id === sid);
    return s ? Object.fromEntries(weekDates(SEMAINE).map(j => [j, teamOn(s, j)])) : {};
  };
  if (op.type === "equipe") {
    const s = d.sites.find(x => x.id === op.site);
    return { ...op, avant: s ? teamOn(s, op.jour) : [] };
  }
  if (op.type === "plan") return { ...op, avant: Object.fromEntries(Object.keys(op.plan).map(sid => [sid, equipes(sid)])) };
  return op;
}

describe("appliquer", () => {
  it("donne exactement ce que donnaient les actions d'App, geste après geste", () => {
    fc.assert(fc.property(arbDepart, fc.array(arbOp, { maxLength: 12 }), (depart, ops) => {
      const ref = structuredClone(depart.sites);
      let d = depart;
      for (const op of ops) { const o = vu(d, op); reference(ref, o); d = appliquer(d, o); }
      expect(instantane(d)).toEqual(instantane({ ...depart, sites: ref }));
    }), { numRuns: 400 });
  });

  it("ne modifie jamais ses entrées", () => {
    fc.assert(fc.property(arbDepart, fc.array(arbOp, { maxLength: 8 }), (depart, ops) => {
      const avant = structuredClone(depart);
      let d = depart;
      for (const op of ops) d = appliquer(d, op);
      expect(depart).toEqual(avant);
    }), { numRuns: 200 });
  });

  it("ne change l'identité que des chantiers touchés", () => {
    fc.assert(fc.property(arbDepart, arbOp, (depart, op) => {
      const apres = appliquer(depart, op);
      for (const s of apres.sites) {
        const avant = depart.sites.find(x => x.id === s.id)!;
        /* Un chantier dont le contenu a changé est un nouvel objet : c'est
           ce que la mémorisation des fiches regarde. */
        if (JSON.stringify(s) !== JSON.stringify(avant)) expect(s).not.toBe(avant);
      }
      if (apres === depart) expect(instantane(apres)).toEqual(instantane(depart));
    }), { numRuns: 400 });
  });

  it("hors urgence, un compagnon posé n'est jamais sur deux chantiers le même jour", () => {
    fc.assert(fc.property(fc.array(arbOp.filter(o => !("urgence" in o) || !o.urgence), { maxLength: 15 }), ops => {
      let d = appliquer({ people: [], sites: SIDS.map(id => normSite(id, { code: id, start: "2026-08-31" })), avail: [] }, { type: "cocher", site: "s_1", etape: 0, mission: 0, faite: false });
      for (const op of ops) d = appliquer(d, vu(d, op));
      for (const jour of JOURS) {
        const vus = d.sites.flatMap(s => teamOn(s, jour));
        expect(new Set(vus).size).toBe(vus.length);
      }
    }), { numRuns: 400 });
  });
});

/* ---------- deux appareils : la fusion à trois voies ---------- */

describe("un geste fait sur une équipe vue un peu plus tôt", () => {
  const arbGeste = arbOp.filter(o => o.type === "poser" || o.type === "retirer" || o.type === "equipe");

  it("n'efface jamais ce qu'un autre appareil a fait entre-temps sur ce chantier", () => {
    fc.assert(fc.property(arbDepart, arbGeste, arbSid, arbJour, fc.uniqueArray(arbPid, { maxLength: 4 }), fc.boolean(),
      (depart, autre, sid, jour, voulue, urgence) => {
        const op = vu(depart, { type: "equipe", site: sid, jour, compagnons: voulue, avant: [], urgence }) as Extract<Operation, { type: "equipe" }>;
        const entreTemps = appliquer(depart, vu(depart, autre));      // l'associé, pendant ce temps
        const avantGeste = teamOn(entreTemps.sites.find(s => s.id === sid)!, jour);
        const apres = teamOn(appliquer(entreTemps, op).sites.find(s => s.id === sid)!, jour);
        for (const pid of PIDS) {
          const ajoute = voulue.includes(pid) && !op.avant.includes(pid);
          const retire = op.avant.includes(pid) && !voulue.includes(pid);
          expect(apres.includes(pid), pid).toBe(ajoute || (!retire && avantGeste.includes(pid)));
        }
      }), { numRuns: 600 });
  });

  it("vu à jour, donne l'équipe voulue ; rejoué, ne change plus rien", () => {
    fc.assert(fc.property(arbDepart, fc.array(arbOp, { minLength: 1, maxLength: 6 }), (depart, ops) => {
      let d = depart;
      for (const op of ops) {
        const o = vu(d, op);
        const une = appliquer(d, o);
        expect(instantane(appliquer(une, o))).toEqual(instantane(une));
        if (o.type === "equipe")
          expect(teamOn(une.sites.find(s => s.id === o.site)!, o.jour)).toEqual([...new Set(o.compagnons)]);
        d = une;
      }
    }), { numRuns: 400 });
  });

  it("fusionnerEquipe : cas écrits à la main", () => {
    /* Geoffrey voyait [Erwan], veut [Erwan, Giorgi] ; l'associé a posé Nixon entre-temps. */
    expect(fusionnerEquipe(["erwan"], ["erwan", "giorgi"], ["erwan", "nixon"])).toEqual(["erwan", "giorgi", "nixon"]);
    /* L'associé a retiré Erwan ; Geoffrey, qui ne l'a pas vu, ajoute Giorgi : Erwan reste retiré. */
    expect(fusionnerEquipe(["erwan"], ["erwan", "giorgi"], [])).toEqual(["giorgi"]);
    /* Geoffrey retire Erwan, l'associé l'avait déjà retiré : rien à redire. */
    expect(fusionnerEquipe(["erwan"], [], [])).toEqual([]);
    /* Réordonner : l'ordre voulu tient, les ajouts d'autrui suivent. */
    expect(fusionnerEquipe(["a", "b"], ["b", "a"], ["a", "c", "b"])).toEqual(["b", "a", "c"]);
  });
});

describe("supprimerCompagnon et remplacerTout", () => {
  it("retire le compagnon de tous les plans et de ses demandes, comme deletePerson", () => {
    const sites = SIDS.map(id => normSite(id, { code: id, start: "2026-08-31" }));
    setTeamOn(sites[0], JOURS[0], ["p_a", "p_b"]);
    setTeamOn(sites[1], JOURS[1], ["p_a"]);
    const d: Donnees = {
      people: PIDS.map(id => normPerson(id, { name: id })), sites,
      avail: [{ id: "p_a@x", token: "t", personId: "p_a", week: SEMAINE, days: null, note: "", answeredAt: null }]
    };
    const r = appliquer(d, { type: "supprimerCompagnon", compagnon: "p_a" });
    expect(r.people.map(p => p.id)).not.toContain("p_a");
    expect(teamOn(r.sites[0], JOURS[0])).toEqual(["p_b"]);
    expect(r.sites[1].plan[JOURS[1]]).toBeUndefined();
    expect(r.avail).toEqual([]);
    expect(r.sites[2]).toBe(d.sites[2]);           // chantier non touché : même objet
  });
});
