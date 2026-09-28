/* ============================================================
   Propriétés d'optimizeWeek — le bouton « Répartir toute l'équipe »

   Le golden master fige UN scénario, à l'identique. Ces propriétés
   disent au contraire ce qui doit rester vrai sur TOUS les scénarios,
   quelle que soit la façon dont une reconstruction répartira les gens :
   la règle « un homme, un chantier, par jour », le respect des
   disponibilités, le plafond d'effectif, et la cohérence du plan avec
   le banc, le compte des journées et les trous de couverture.

   Graine : GRAINE (arbitraires.ts). 400 scénarios par propriété
   (250 pour le déterminisme, qui répartit deux fois). Une répartition
   coûte ~1,5 ms en moyenne sur ces scénarios (mesuré, p95 ~7 ms).
   ============================================================ */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  loadLeft, neededHeadcount, optimizeWeek, siteNeed, span, weekDates,
  type Site, type WeekPlan
} from "../../src/domain.ts";
import {
  arbSpecScenario, arbSpecScenarioSansCible, scenario, GRAINE,
  type Scenario, type SpecScenario
} from "./arbitraires.ts";

fc.configureGlobal({ seed: GRAINE, numRuns: 400 });

/* On tire la spécification brute et on construit dans le prédicat : un
   contre-exemple s'affiche alors en quelques nombres, et se rejoue tel
   quel par scenario(spec). */
function surScenarios(
  verifier: (sc: Scenario) => void,
  params?: fc.Parameters<[SpecScenario]>,
  arb: fc.Arbitrary<SpecScenario> = arbSpecScenario
): void {
  fc.assert(fc.property(arb, spec => verifier(scenario(spec))), params);
}

const repartir = (sc: Scenario): WeekPlan =>
  optimizeWeek(sc.sites, sc.people, sc.wk, sc.availableOn, sc.opts);

interface Affectation { sid: string; day: string; pid: string }

/* Le plan à plat : une ligne par (chantier, jour, personne). */
function affectations(r: WeekPlan): Affectation[] {
  const out: Affectation[] = [];
  for (const sid of Object.keys(r.plan))
    for (const day of Object.keys(r.plan[sid]))
      for (const pid of r.plan[sid][day]) out.push({ sid, day, pid });
  return out;
}

/* Le filtre des cibles, tel que la règle métier le dit : un chantier
   ouvert (la semaine visée est au moins celle du début) où il reste du
   travail. Écrit ici à part, pour que le test ne relise pas le code
   qu'il vérifie. */
const estCible = (wk: string) => (s: Site): boolean =>
  loadLeft(s) > 0.5 && wk >= span(s).first;

describe("optimizeWeek — propriétés", () => {

  it("ne pose jamais une personne sur deux chantiers le même jour", () => {
    surScenarios(sc => {
      const vus = new Set<string>();
      for (const a of affectations(repartir(sc))) {
        const cle = a.day + "#" + a.pid;
        expect(vus.has(cle), `${a.pid} posé deux fois le ${a.day}`).toBe(false);
        vus.add(cle);
      }
    });
  });

  it("ne pose jamais une personne un jour où elle est indisponible", () => {
    surScenarios(sc => {
      for (const a of affectations(repartir(sc)))
        expect(sc.availableOn(a.pid, a.day), `${a.pid} indisponible le ${a.day}`).toBe(true);
    });
  });

  it("ne dépasse jamais le plafond d'un chantier", () => {
    /* Le plafond : ce que la date annoncée réclame (plus un), borné par
       ce que le travail du moment peut absorber (les fronts, plus un). */
    surScenarios(sc => {
      const r = repartir(sc);
      for (const s of r.targets) {
        const plafond = Math.min(
          Math.max(1, neededHeadcount(s, sc.wk)) + 1,
          siteNeed(s).fronts + 1);
        for (const d of weekDates(sc.wk))
          expect(((r.plan[s.id] || {})[d] || []).length,
            `${s.id} le ${d}`).toBeLessThanOrEqual(plafond);
      }
    });
  });

  it("rend toujours un banc sous forme de tableau, y compris sans chantier à pourvoir", () => {
    surScenarios(sc => {
      expect(Array.isArray(repartir(sc).bench)).toBe(true);
    });
    /* Le retour anticipé : c'est là que `bench` manquait. */
    surScenarios(sc => {
      const r = repartir(sc);
      expect(r.targets).toEqual([]);          // l'arbitraire tient sa promesse
      expect(r).toEqual({ plan: {}, why: {}, gaps: [], bench: [], posed: 0, targets: [] });
    }, { numRuns: 200 }, arbSpecScenarioSansCible);
  });

  it("donne le même résultat sur deux copies des mêmes entrées", () => {
    surScenarios(sc => {
      const a = repartir(sc);
      const b = optimizeWeek(structuredClone(sc.sites), structuredClone(sc.people),
        sc.wk, sc.availableOn, structuredClone(sc.opts));
      expect(b).toEqual(a);
    }, { numRuns: 250 });
  });

  it("ne modifie pas ses entrées", () => {
    /* L'interface passe store.sites et store.people tels quels : une
       répartition qui écrirait dedans changerait le planning avant même
       que Geoffrey appuie sur « Appliquer ». */
    surScenarios(sc => {
      const avant = structuredClone({ sites: sc.sites, people: sc.people, opts: sc.opts });
      repartir(sc);
      expect({ sites: sc.sites, people: sc.people, opts: sc.opts }).toStrictEqual(avant);
    });
  });

  it("vise exactement les chantiers ouverts où il reste du travail, dans l'ordre d'entrée", () => {
    surScenarios(sc => {
      const r = repartir(sc);
      const attendu = sc.sites.filter(estCible(sc.wk));
      expect(r.targets.map(s => s.id)).toEqual(attendu.map(s => s.id));
      expect(r.targets).toEqual(attendu);
    });
  });

  it("n'écrit que des cibles, des jours de la semaine, des gens de l'effectif, et compte juste", () => {
    surScenarios(sc => {
      const r = repartir(sc);
      const jours = new Set(weekDates(sc.wk));
      const cibles = new Set(r.targets.map(s => s.id));
      const effectif = new Set(sc.people.map(p => p.id));
      for (const sid of Object.keys(r.plan)) {
        expect(cibles.has(sid), `${sid} n'est pas une cible`).toBe(true);
        for (const day of Object.keys(r.plan[sid])) {
          expect(jours.has(day), `${day} hors de la semaine ${sc.wk}`).toBe(true);
          /* Même convention que setTeamOn : une journée vide n'existe pas. */
          expect(r.plan[sid][day].length).toBeGreaterThan(0);
        }
      }
      const toutes = affectations(r);
      for (const a of toutes) expect(effectif.has(a.pid), `${a.pid} inconnu`).toBe(true);
      expect(r.posed).toBe(toutes.length);
    });
  });

  it("chaque jour, chaque disponible est soit posé, soit au banc, une seule fois", () => {
    surScenarios(sc => {
      const r = repartir(sc);
      if (!r.targets.length) return;   // sans cible, le banc est vide par contrat (voir plus haut)
      const jours = weekDates(sc.wk);
      for (const b of r.bench) expect(jours).toContain(b.day);
      for (const d of jours) {
        const dispo = sc.people.filter(p => sc.availableOn(p.id, d)).map(p => p.id);
        const poses = affectations(r).filter(a => a.day === d).map(a => a.pid);
        const banc = r.bench.filter(b => b.day === d).map(b => b.pid);
        /* Des listes triées, et non des ensembles : un doublon (posé ET
           au banc, ou deux fois au banc) doit se voir. Et l'égalité exclut
           qu'un indisponible soit au banc. */
        expect([...poses, ...banc].sort(), d).toEqual([...dispo].sort());
      }
    });
  });

  it("ne signale un trou que sur une équipe posée, et seulement s'il manque vraiment du niveau", () => {
    surScenarios(sc => {
      const r = repartir(sc);
      const parId = new Map(sc.people.map(p => [p.id, p] as const));
      const cibles = new Set(r.targets.map(s => s.id));
      for (const g of r.gaps) {
        expect(cibles.has(g.site.id)).toBe(true);
        const equipe = (r.plan[g.site.id] || {})[g.day] || [];
        expect(equipe.length, `trou sur ${g.site.id} le ${g.day} sans équipe`).toBeGreaterThan(0);
        expect(g.have).toBeLessThan(g.need);
        /* `have` est bien le meilleur niveau de l'équipe réellement posée
           (après les échanges), et `need` le seuil des étapes proches. */
        expect(g.have).toBe(Math.max(...equipe.map(pid => parId.get(pid)!.sk[g.sk])));
        expect(g.need).toBe(siteNeed(g.site).soon[g.sk]);
      }
    });
  });

  /* Constat D1, corrigé. Après la passe d'échanges, les raisons restaient
     attachées à l'ancienne place : l'interface affichait une personne sans
     raison, et une raison désignait une affectation qui n'existait plus.

     Contre-exemple réduit par fast-check (graine GRAINE, 3e tirage,
     270 réductions) — semaine du 6 janvier 2025, deux chantiers ouverts
     ce lundi-là, avec un plan du lundi déjà saisi (s_0 : p_0 ; s_1 :
     p_2 et p_0) ; le mardi 7, seuls p_0 (plâtre 2) et p_2 (plâtre 4)
     sont disponibles.
       plan : { s_0: { "2025-01-07": ["p_2"] }, s_1: { "2025-01-07": ["p_0"] } }
       why  : { "s_1#2025-01-07#p_2": [gate plâtre 3, suite, seul, retard],
                "s_0#2025-01-07#p_0": [sk élec, sk plâtre, suite, seul] }
     Le glouton avait posé p_2 sur s_1 et p_0 sur s_0, l'échange les avait
     inversés, les raisons n'avaient pas suivi. */
  it("chaque personne posée a sa raison, et chaque raison désigne une affectation (D1)", () => {
    surScenarios(sc => {
      const r = repartir(sc);
      const cles = new Set(affectations(r).map(a => a.sid + "#" + a.day + "#" + a.pid));
      for (const c of cles) expect(r.why[c], `aucune raison pour ${c}`).toBeDefined();
      for (const c of Object.keys(r.why)) expect(cles.has(c), `raison orpheline ${c}`).toBe(true);
    });
  });

  it("les scénarios tirés exercent toutes les branches qui comptent", () => {
    /* Garde-fou sur l'arbitraire lui-même : un filet qui ne verrait
       jamais de chantier en retard, de banc ou de plan déjà saisi
       passerait au vert sans rien prouver. */
    const cas = fc.sample(arbSpecScenario, { seed: GRAINE, numRuns: 300 }).map(scenario);
    const vu = { sansCible: 0, avecCible: 0, plusieursCibles: 0, pasOuvert: 0, fini: 0,
                 enRetard: 0, planSaisi: 0, banc: 0, trous: 0, novice: 0, plancher: 0 };
    for (const sc of cas) {
      const r = repartir(sc);
      if (r.targets.length) vu.avecCible++; else vu.sansCible++;
      if (r.targets.length >= 2) vu.plusieursCibles++;
      if (r.bench.length) vu.banc++;
      if (r.gaps.length) vu.trous++;
      if (sc.opts) vu.plancher++;
      for (const s of sc.sites) {
        if (sc.wk < span(s).first) vu.pasOuvert++;
        if (loadLeft(s) <= 0.5) vu.fini++;
        if (sc.wk > span(s).last && loadLeft(s) > 0.5) vu.enRetard++;
        if (Object.keys(s.plan).length) vu.planSaisi++;
      }
      if (sc.people.some(p => Object.values(p.sk).every(v => v <= 2))) vu.novice++;
    }
    for (const [nom, n] of Object.entries(vu)) expect(n, nom).toBeGreaterThanOrEqual(15);
  });
});
