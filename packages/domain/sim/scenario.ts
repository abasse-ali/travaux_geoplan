/* ============================================================
   Scénario de référence — le « golden master » du métier

   Seize semaines d'usage simulé : chaque lundi, Geoffrey lance
   « Répartir toute l'équipe », applique le plan, puis l'équipe
   travaille. Tout ce que le moteur décide est consigné, et la sortie
   complète est figée par tests/golden. Toute modification du domaine
   qui change une seule affectation, une seule raison ou un seul
   pourcentage fait échouer ce test : c'est voulu.

   Ce qui relève du scénario, et pas du domaine :
     • les réponses des compagnons, tirées d'un aléa À GRAINE FIXE ;
     • le modèle de travail : une personne posée abat une journée-homme
       sur la première mission ouverte qu'elle a le niveau de prendre,
       dans l'étape en cours ou la suivante — la règle même que
       scorePick applique pour décider si quelqu'un « peut prendre »
       une mission.

   Le fuseau compte : `pressure` divise un écart en millisecondes sans
   l'arrondir, et le passage à l'heure d'hiver le décale. Le scénario
   se calcule donc en Europe/Paris, le fuseau de Geoffrey — l'appelant
   le fixe avant tout calcul de date.
   ============================================================ */

import {
  PHASES, SOON,
  addDays, weekDates, weekNum, mondayOf, dayIndex,
  normPerson, normSite, codeFromAddr,
  optimizeWeek, suggestTeam, neededHeadcount, weekRoster,
  teamOn, setTeamOn, setTask, currentPhase, loadLeft, avgLv, forecast, span,
  eachRemaining,
  type Person, type Site, type SkillId, type Why, type AvailableOn
} from "../src/domain.ts";

/* ---------- aléa déterministe ----------
   mulberry32 : 32 bits d'état, reproductible à l'identique sur toute
   plateforme — Math.random ne l'est pas, et n'accepte pas de graine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const REF = {
  start: "2026-09-14",   // traverse le passage à l'heure d'hiver et la semaine 53
  weeks: 16,
  seed: 20260914,
  tz: "Europe/Paris"
} as const;

/* ---------- les chantiers ----------
   Cinq chantiers à des stades différents, pour que chaque branche du
   moteur serve au moins une fois : démarrage à froid, pourcentage hérité
   sans coche, missions cochées, chantier pas encore ouvert, chantier en
   retard sur sa date annoncée. */
export function referenceSites(): Site[] {
  const done = (n: number, extra: Record<number, number> = {}): number[] =>
    Array.from({ length: 12 }, (_, i) => (i < n ? 100 : (extra[i] ?? 0)));
  return [
    normSite("s_9md49", {
      code: "9MD49", addr: "9 Mont Doré — apt 49",
      start: "2026-09-14", months: 3, coef: 1, ph: done(0)
    }),
    normSite("s_12ab49", {
      code: "12AB49", addr: "12 Audibert — apt 49",
      start: "2026-08-17", months: 3, coef: 1.2, ph: done(3, { 3: 50 })   // hérité, sans coche
    }),
    normSite("s_30ja90", {
      code: "30JA90", addr: "30 Jules Amilhau — apt 90",
      start: "2026-07-06", months: 3, coef: 0.8, ph: done(8, { 8: 33 }),
      tasks: { "8": [true, false, false] }
    }),
    normSite("s_151hd7", {
      code: codeFromAddr("151 Henri Desbals apt 7"), addr: "151 Henri Desbals apt 7",
      start: "2026-10-19", months: 2, coef: 1, ph: done(0)          // ouvre en semaine 6
    }),
    normSite("s_8la12", {
      code: codeFromAddr("8 rue Lafayette apt 12"), addr: "8 rue Lafayette apt 12",
      start: "2026-06-01", months: 2, coef: 1.5, ph: done(9, { 9: 25 }), // date dépassée
      tasks: { "9": [true, false, false, false] }
    })
  ];
}

export function referencePeople(raw: { people: unknown[] }): Person[] {
  return raw.people.map(o => {
    const r = o as Partial<Person> & { id: string };
    return normPerson(r.id, r);
  });
}

/* ---------- les réponses du samedi ----------
   Trois compagnons sur quatre répondent ; qui répond garde ses jours
   habituels à 90 %, et propose parfois un jour de plus. Qui ne répond
   pas est compté sur ses jours habituels — exactement comme
   store.daysOf. */
function answersFor(people: Person[], rnd: () => number): Map<string, boolean[]> {
  const out = new Map<string, boolean[]>();
  for (const p of people) {
    if (rnd() >= 0.75) continue;
    out.set(p.id, p.days.map((on, i) => (on ? rnd() < 0.9 : rnd() < (i === 6 ? 0.02 : 0.06))));
  }
  return out;
}

const canTake = (p: Person, sk: SkillId | null, lv: number): boolean =>
  sk ? p.sk[sk] >= lv : avgLv(p) >= lv;

/* Six décimales : assez pour voir bouger un score, pas assez pour
   qu'un bruit de dernier bit sur une autre machine fasse échouer. */
const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const whyStr = (w: Why[] | undefined): string =>
  (w || []).map(x => [x.type, x.k, x.lv].filter(v => v != null).join(":")).join("|");
const bits = (d: boolean[]): string => d.map(b => (b ? "1" : "0")).join("");

export interface Indicators {
  jhRestants: number;          // charge restante de tous les chantiers, en fin de scénario
  journeesPosees: number;      // personne × jour posés par le répartiteur
  journeesUtiles: number;      // posées ET qui ont fait avancer une mission
  journeesSteriles: number;    // posées sans rien pouvoir prendre
  journeesDepot: number;       // disponibles, laissées au dépôt (bench)
  doublesRepartiteur: number;  // personne × jour réclamés par deux chantiers — doit valoir 0
  doublesIsole: number;        // la même chose si chaque chantier compose dans son coin
  reconduction: number;        // part des équipes reconduites d'un jour sur l'autre
  raisonsOrphelines: number;   // raisons affichées pour quelqu'un qui n'est plus posé là
  poseesSansRaison: number;    // posés sans raison à afficher
  chantiersTermines: string[]; // « code@date »
}

export interface ScenarioResult {
  params: { start: string; weeks: number; seed: number; tz: string };
  weeks: unknown[];
  indicators: Indicators;
  finalSites: unknown[];
}

export function runScenario(
  people: Person[], sites: Site[],
  start: string = REF.start, weeks: number = REF.weeks, seed: number = REF.seed
): ScenarioResult {
  const rnd = mulberry32(seed);
  const answers = new Map<string, Map<string, boolean[]>>();   // semaine -> pid -> jours
  const byId = new Map(people.map(p => [p.id, p]));
  const availableOn: AvailableOn = (pid, day) => {
    const p = byId.get(pid);
    if (!p) return false;
    const a = answers.get(mondayOf(day))?.get(pid);
    return !!(a || p.days)[dayIndex(day)];
  };
  const opened = (s: Site, wk: string): boolean => loadLeft(s) > 0.5 && wk >= span(s).first;

  /* Le reste à faire de chaque mission, en journées-homme. Le domaine ne
     connaît que des missions cochées ou non ; l'avancement partiel d'une
     mission n'existe que dans la simulation, comme sur un vrai chantier. */
  const left = new Map<string, number>();
  for (const s of sites)
    eachRemaining(s, (T, rest, i, j) => left.set(s.id + "#" + i + "#" + j, T.jh * rest * (s.coef || 1)));

  const ind: Indicators = {
    jhRestants: 0, journeesPosees: 0, journeesUtiles: 0, journeesSteriles: 0,
    journeesDepot: 0, doublesRepartiteur: 0, doublesIsole: 0, reconduction: 0,
    raisonsOrphelines: 0, poseesSansRaison: 0, chantiersTermines: []
  };
  let reconduits = 0, reconductibles = 0;
  const finished = new Set<string>();
  const out: unknown[] = [];

  for (let w = 0; w < weeks; w++) {
    const wk = addDays(start, 7 * w);
    const dates = weekDates(wk);
    const ans = answersFor(people, rnd);
    answers.set(wk, ans);

    /* --- « Composer », chantier par chantier, tel que la feuille
       s'ouvre : taille recommandée, portée semaine (sheets.jsx). --- */
    const composer: Record<string, unknown> = {};
    for (const s of sites) {
      if (!opened(s, wk)) continue;
      const reco = neededHeadcount(s, wk);
      const size = Math.max(2, Math.min(5, reco || weekRoster(s, wk).length || 3));
      const usable = (p: Person): number => dates.filter(d =>
        availableOn(p.id, d) &&
        (!sites.some(x => teamOn(x, d).includes(p.id)) || teamOn(s, d).includes(p.id))).length;
      const yest = addDays(wk, -1);
      const r = suggestTeam(s, size, wk, people, usable, p => teamOn(s, yest).includes(p.id));
      composer[s.code] = {
        size, fronts: r.need.fronts, total: r6(r.need.total),
        team: r.team.map(t => [t.p.id, r6(t.gain), t.days, whyStr(t.why)].join(" "))
      };
    }

    /* --- le mode isolé, pour mesurer ce que le répartiteur évite :
       chaque chantier compose sa journée sans voir les autres. --- */
    const isoPrev = new Map<string, string[]>();
    let isoDoubles = 0;
    for (const d of dates) {
      const claims = new Map<string, number>();
      for (const s of sites) {
        if (!opened(s, wk)) continue;
        const size = Math.max(2, Math.min(5, neededHeadcount(s, wk) || 3));
        const prev = isoPrev.get(s.id) || [];
        const r = suggestTeam(s, size, wk, people,
          p => (availableOn(p.id, d) ? 1 : 0), p => prev.includes(p.id));
        const ids = r.team.map(t => t.p.id);
        isoPrev.set(s.id, ids);
        ids.forEach(pid => claims.set(pid, (claims.get(pid) || 0) + 1));
      }
      claims.forEach(n => { if (n > 1) isoDoubles += n - 1; });
    }
    ind.doublesIsole += isoDoubles;

    /* --- « Répartir toute l'équipe », puis « Appliquer ce plan » :
       la même écriture que act.applyPlan, hors urgence. --- */
    const r = optimizeWeek(sites, people, wk, availableOn);
    r.targets.forEach(site => {
      dates.forEach(d => {
        const ids = (r.plan[site.id] || {})[d] || [];
        ids.forEach(pid => sites.forEach(o => {
          if (o.id === site.id || !teamOn(o, d).includes(pid)) return;
          setTeamOn(o, d, teamOn(o, d).filter(x => x !== pid));
        }));
        setTeamOn(site, d, ids);
      });
    });
    ind.journeesPosees += r.posed;
    ind.journeesDepot += r.bench.length;
    Object.keys(r.why).forEach(k => {
      const [sid, d, pid] = k.split("#");
      if (!((r.plan[sid] || {})[d] || []).includes(pid)) ind.raisonsOrphelines++;
    });
    Object.keys(r.plan).forEach(sid => Object.keys(r.plan[sid]).forEach(d =>
      r.plan[sid][d].forEach(pid => { if (!r.why[sid + "#" + d + "#" + pid]) ind.poseesSansRaison++; })));

    /* --- le travail de la semaine --- */
    let utiles = 0, steriles = 0;
    for (const d of dates) {
      const seen = new Map<string, number>();
      for (const s of sites) {
        const team = teamOn(s, d);
        team.forEach(pid => seen.set(pid, (seen.get(pid) || 0) + 1));

        const y = teamOn(s, addDays(d, -1));
        if (team.length && y.length) {
          reconductibles += team.length;
          reconduits += team.filter(pid => y.includes(pid)).length;
        }

        for (const pid of team) {
          const p = byId.get(pid);
          if (!p || !availableOn(pid, d)) continue;
          const cur = currentPhase(s);
          let cap = 1, worked = false;
          for (let i = cur; i <= Math.min(11, cur + SOON) && cap > 1e-9; i++) {
            if (s.ph[i] >= 100) continue;
            PHASES[i].tasks.forEach((T, j) => {
              const key = s.id + "#" + i + "#" + j;
              const rest = left.get(key) || 0;
              if (cap <= 1e-9 || rest <= 1e-9 || !canTake(p, T.sk, T.lv)) return;
              const take = Math.min(cap, rest);
              cap -= take; worked = true;
              left.set(key, rest - take);
              /* Comme la case cochée dans l'interface : act.task. */
              if (rest - take <= 1e-9) s.ph[i] = setTask(s, i, j, true);
            });
          }
          if (worked) utiles++; else steriles++;
        }
        if (!finished.has(s.id) && loadLeft(s) < 0.5 && wk >= span(s).first) {
          finished.add(s.id);
          ind.chantiersTermines.push(s.code + "@" + d);
        }
      }
      seen.forEach(n => { if (n > 1) ind.doublesRepartiteur += n - 1; });
    }
    ind.journeesUtiles += utiles;
    ind.journeesSteriles += steriles;

    const code = (sid: string): string => sites.find(s => s.id === sid)?.code || sid;
    const plan: Record<string, Record<string, string>> = {};
    Object.keys(r.plan).forEach(sid => {
      plan[code(sid)] = Object.fromEntries(Object.keys(r.plan[sid]).map(d => [d, r.plan[sid][d].join(" ")]));
    });
    const why: Record<string, string> = {};
    Object.keys(r.why).forEach(k => {
      const [sid, d, pid] = k.split("#");
      why[code(sid) + " " + d + " " + pid] = whyStr(r.why[k]);
    });
    const bench: Record<string, string> = {};
    r.bench.forEach(b => { bench[b.day] = (bench[b.day] ? bench[b.day] + " " : "") + b.pid; });

    out.push({
      week: wk, weekNum: weekNum(wk),
      answers: Object.fromEntries([...ans].map(([pid, d]) => [pid, bits(d)])),
      composer, isoDoubles,
      targets: r.targets.map(s => s.code).join(" "),
      posed: r.posed,
      plan, why, bench,
      gaps: r.gaps.map(g => [g.site.code, g.day, g.sk, g.need, g.have].join(" ")),
      work: { utiles, steriles },
      end: Object.fromEntries(sites.map(s => [s.code, {
        ph: s.ph.join(","),
        ticks: Object.keys(s.tasks).sort((a, b) => +a - +b).map(k => k + ":" + bits(s.tasks[k])).join(" "),
        loadLeft: r6(loadLeft(s)),
        forecast: forecast(s, wk, availableOn)
      }]))
    });
  }

  ind.jhRestants = Math.round(sites.reduce((a, s) => a + loadLeft(s), 0) * 10) / 10;
  ind.reconduction = reconductibles ? Math.round(reconduits / reconductibles * 1000) / 1000 : 0;

  return {
    params: { start, weeks, seed, tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    weeks: out,
    indicators: ind,
    finalSites: sites.map(s => ({
      code: s.code, etape: currentPhase(s) + 1, ph: s.ph.join(","),
      joursPlanifies: Object.keys(s.plan).length,
      journees: Object.values(s.plan).reduce((a, ids) => a + ids.length, 0)
    }))
  };
}
