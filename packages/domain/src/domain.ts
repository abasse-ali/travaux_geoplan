/* ============================================================
   Geoplan — domaine métier
   Aucune dépendance, aucun accès au DOM.

   L'unité d'affectation est LE JOUR. Un chantier porte un plan
   indexé par date réelle :
     plan = { "2026-09-01": ["p_erwan","p_nixon"], ... }

   L'unité de TRAVAIL est la mission. Chaque mission d'une étape porte
   son corps de métier, le niveau minimum qu'elle exige et sa charge en
   jours-homme. Tout le reste — charge du chantier, besoin par métier,
   composition d'équipe — s'en déduit.
   ============================================================ */

/* ============================================================
   Le vocabulaire du domaine

   Ces déclarations disent ce qu'est un chantier, un compagnon, une
   mission. Le reste du fichier s'y réfère — et l'API s'y référera
   aussi : c'est le contrat, écrit une seule fois.
   ============================================================ */

export type SkillId = "elec" | "plomb" | "platre" | "peint" | "menuis";

export interface Skill { id: SkillId; label: string; ab: string; c: string }

/** Une mission : l'unité de travail dont tout le reste se déduit. */
export interface Task {
  t: string;
  sk: SkillId | null;          // null : de la main-d'oeuvre, sans métier
  lv: number;                  // niveau minimum pour la confier, 1 à 5
  jh: number;                  // charge en jours-homme pour un T2/T3
  permis?: boolean;            // la mission suppose de conduire
}

export interface Phase {
  n: string; wk: number; tasks: Task[];
  jh: number;                          // somme des missions
  w: Partial<Record<SkillId, number>>; // part de chaque métier dans l'étape
  permis: boolean;
}

/** Le niveau d'un compagnon dans chacun des cinq corps de métier. */
export type Levels = Record<SkillId, number>;

export interface Person {
  id: string; name: string; phone: string; email: string;
  days: boolean[];             // sept cases, lundi en tête
  permis: boolean; sk: Levels; note: string;
}

/** Un chantier. `plan` est indexé par date ISO, `tasks` par étape. */
export interface Site {
  id: string; code: string; addr: string;
  start: string; months: number; coef: number;
  ph: number[];                // avancement des douze étapes, en pourcentage
  note: string;
  plan: Record<string, string[]>;
  tasks: Record<string, boolean[]>;
  _rev?: number;               // révision, pour la mémorisation côté React
}

/** Une demande de disponibilité envoyée à un compagnon. */
export interface Avail {
  id: string; token: string; personId: string; week: string;
  days: boolean[] | null; note: string; answeredAt: string | null;
}

/** Ce dont un chantier a besoin, vu depuis l'étape en cours. */
export interface Need {
  need: Levels;                // charge par métier, décroissance franche
  req: Levels;                 // niveau exigé sur tout le chantier
  soon: Levels;                // niveau exigé dans les étapes proches
  large: Levels;               // même charge, horizon élargi
  polyLarge: number; totalLarge: number;
  proches: { sk: SkillId | null; lv: number; w: number }[];
  nearW: number;
  fronts: number;              // missions ouvrables de front aujourd'hui
  poly: number; permis: boolean; permisSoon: boolean; total: number;
}

/** Pourquoi telle personne a été retenue — affiché tel quel. */
export interface Why { type: string; k?: SkillId; lv?: number }

export interface PickResult { gain: number; why: Why[] }

export interface Forecast {
  done?: boolean; stalled?: boolean;
  rest?: number; cap?: number; weeks?: number;
  end?: string; planned: string; late?: boolean;
}

export interface TeamPick { p: Person; gain: number; why: Why[]; days: number }

export interface Gap { site: Site; day: string; sk: SkillId; need: number; have: number }

export interface UncoveredTask {
  task: Task; phase: number; index: number; need: number; have: number;
}

/** Le résultat d'une répartition sur toute la semaine. */
export interface WeekPlan {
  plan: Record<string, Record<string, string[]>>;   // chantier -> jour -> ids
  why: Record<string, Why[]>;                       // "chantier#jour#id"
  gaps: Gap[];
  bench: { day: string; pid: string }[];            // disponibles sans emploi
  posed: number;
  targets: Site[];
}

/* ---------- corps de métier ---------- */

export const SKILLS: Skill[] = [
  {id:"elec",   label:"Électricité",         ab:"ÉLE", c:"var(--t-elec)"},
  {id:"plomb",  label:"Plomberie",           ab:"PLO", c:"var(--t-plomb)"},
  {id:"platre", label:"Plâtrerie",           ab:"PLÂ", c:"var(--t-platre)"},
  {id:"peint",  label:"Peinture & finition", ab:"PEI", c:"var(--t-peint)"},
  {id:"menuis", label:"Menuiserie",          ab:"MEN", c:"var(--t-menuis)"}
];
export const SK: SkillId[] = SKILLS.map(s => s.id);
export const skLabel = (id: SkillId): string =>
  SKILLS.find(s => s.id === id)?.label || id;
export const skColor = (id: SkillId | null): string =>
  SKILLS.find(s => s.id === id)?.c || "var(--t-poly)";

/* ---------- les 12 étapes et leurs missions ----------
   t      : le libellé, tel qu'il se dit sur le chantier
   sk     : corps de métier dominant, ou null pour de la main-d'œuvre
   lv     : niveau minimum pour la confier sans surveillance (1 à 5)
   jh     : charge en jours-homme pour un T2/T3
   permis : la mission suppose de conduire

   La charge d'une étape est la somme de ses missions, et le poids de
   chaque métier s'en déduit : rien n'est saisi deux fois. */

const RAW: { n: string; wk: number; tasks: Task[] }[] = [
  {n:"Démolition", wk:1, tasks:[
    {t:"Repérage",                                 sk:null,     lv:2, jh:1},
    {t:"Dégagement",                               sk:null,     lv:1, jh:2},
    {t:"Amenée matérielle",                        sk:null,     lv:1, jh:1, permis:true},
    {t:"Démolition",                               sk:null,     lv:1, jh:4},
    {t:"Évacuation",                               sk:null,     lv:1, jh:2}
  ]},
  {n:"Saignées & passages réseaux", wk:1, tasks:[
    {t:"Repérage à la bombe des passages élec, plomberie, clim et télécom",
                                                   sk:"elec",   lv:3, jh:3},
    {t:"Réalisation des saignées et des perçages", sk:"platre", lv:2, jh:5}
  ]},
  {n:"Plomberie / Élec", wk:1, tasks:[
    {t:"Passage des gaines de plomberie et clim",  sk:"plomb",  lv:3, jh:3},
    {t:"Robinet de chantier",                      sk:"plomb",  lv:2, jh:1},
    {t:"Tableau électrique",                       sk:"elec",   lv:4, jh:3}
  ]},
  {n:"Plâtre", wk:2, tasks:[
    {t:"Structure de cloisonnement et faux plafond", sk:"platre", lv:3, jh:12}
  ]},
  {n:"Élec", wk:2, tasks:[
    {t:"Installation des gaines électriques",      sk:"elec",   lv:3, jh:5},
    {t:"Réparations MAP et scellements des gaines", sk:"platre", lv:2, jh:3}
  ]},
  {n:"Placo", wk:2, tasks:[
    {t:"Fermeture du plafond",                     sk:"platre", lv:3, jh:6},
    {t:"Fermeture des cloisons",                   sk:"platre", lv:2, jh:6}
  ]},
  {n:"Plomberie", wk:3, tasks:[
    {t:"Installation chauffe-eau et receveur",     sk:"plomb",  lv:4, jh:4},
    {t:"Réparations finales au MAP",               sk:"platre", lv:2, jh:1}
  ]},
  {n:"Jointeur", wk:4, tasks:[
    {t:"Ratissage des murs",                       sk:"platre", lv:3, jh:5},
    {t:"Joints de placo",                          sk:"platre", lv:4, jh:5}
  ]},
  {n:"Ponçage & peinture", wk:5, tasks:[
    {t:"Ponçage des murs",                         sk:"peint",  lv:2, jh:7},
    {t:"Aspiration des murs",                      sk:null,     lv:1, jh:3},
    {t:"Nettoyage au chiffon mouillé des murs",    sk:null,     lv:1, jh:4}
  ]},
  {n:"Sols & plinthes", wk:6, tasks:[
    {t:"Ragréage",                                 sk:"menuis", lv:2, jh:3},
    {t:"Pose des barres de seuil",                 sk:"menuis", lv:2, jh:1},
    {t:"Pose du parquet",                          sk:"menuis", lv:4, jh:6},
    {t:"Pose des plinthes",                        sk:"menuis", lv:3, jh:2}
  ]},
  {n:"Cuisine & ameublement", wk:7, tasks:[
    {t:"Pose cuisine",                             sk:"menuis", lv:5, jh:7},
    {t:"Pose des électroménagers encastrés",       sk:"menuis", lv:3, jh:3}
  ]},
  {n:"Finition", wk:8, tasks:[
    {t:"Retouches peinture",                       sk:"peint",  lv:3, jh:3},
    {t:"Nettoyage de livraison",                   sk:null,     lv:1, jh:2},
    {t:"Levée des réserves",                       sk:null,     lv:3, jh:1}
  ]}
];

export const PHASES: Phase[] = RAW.map(P => {
  const jh = P.tasks.reduce((a, T) => a + T.jh, 0);
  const w: Partial<Record<SkillId, number>> = {};
  P.tasks.forEach(T => { if (T.sk) w[T.sk] = (w[T.sk] || 0) + T.jh / jh; });
  return { ...P, jh, w, permis: P.tasks.some(T => !!T.permis) };
});

export const TOTAL_JH = PHASES.reduce((a, P) => a + P.jh, 0);

export function phaseColor(i: number): string {
  const w = PHASES[i].w;
  const ks = Object.keys(w) as SkillId[];
  if (!ks.length) return "var(--t-poly)";
  ks.sort((a, b) => (w[b] || 0) - (w[a] || 0));
  return skColor(ks[0]);
}
export function phaseTrades(i: number): SkillId[] | null {
  const ks = Object.keys(PHASES[i].w) as SkillId[];
  return ks.length ? ks : null;
}

/* ---------- calendrier ----------
   Une semaine est désignée par la date ISO de son lundi ; un jour, par
   sa propre date ISO. Comparer deux dates revient à comparer deux
   chaînes. La semaine compte SEPT jours : sur un chantier, le samedi
   se travaille, et parfois le dimanche. */

export const NDAYS = 7;
export const DAYS   = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
export const DAYS_L = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
export const WEEKEND = [false,false,false,false,false,true,true];
export const MONTHS = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];

export const pad = (n: number): string => String(n).padStart(2, "0");
export const iso = (d: Date): string =>
  d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export const parse = (s: string): Date => new Date(s + "T00:00:00");
export const todayISO = (): string => iso(new Date());

export function addDays(isoStr: string, n: number): string { const d = parse(isoStr); d.setDate(d.getDate() + n); return iso(d); }
export function addMonths(isoStr: string, n: number): string { const d = parse(isoStr); d.setMonth(d.getMonth() + n); return iso(d); }
export function mondayOf(isoStr: string): string {
  const d = parse(isoStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}
/* Index 0-6 d'une date dans sa semaine, lundi = 0. */
export const dayIndex = (isoStr: string): number => (parse(isoStr).getDay() + 6) % 7;
/* Les sept dates d'une semaine. */
export const weekDates = (wk: string): string[] =>
  Array.from({ length: NDAYS }, (_, i) => addDays(wk, i));

export function weekNum(isoMonday: string): number {
  const d = parse(isoMonday); d.setDate(d.getDate() + 3);   // le jeudi décide de l'année
  const jan4 = new Date(d.getFullYear(), 0, 4);             // le 4 janvier est toujours en semaine 1
  const mon1 = new Date(jan4);
  mon1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  return Math.round((d.getTime() - mon1.getTime()) / 604800000) + 1;
}
export function fmtDay(isoStr: string): string { const d = parse(isoStr); return d.getDate() + " " + MONTHS[d.getMonth()]; }
export function fmtRange(isoMonday: string): string {
  const a = parse(isoMonday), b = parse(addDays(isoMonday, NDAYS - 1));
  return a.getMonth() === b.getMonth()
    ? a.getDate() + " – " + b.getDate() + " " + MONTHS[b.getMonth()]
    : a.getDate() + " " + MONTHS[a.getMonth()] + " – " + b.getDate() + " " + MONTHS[b.getMonth()];
}

/* ---------- normalisation ----------
   Les enregistrements viennent d'une base partagée ou d'un fichier
   importé : on ne fait confiance à rien et on borne tout. */

const num = (v: unknown, d: number): number =>
  (typeof v === "number" && isFinite(v)) ? v : d;
export const uid = (p: string): string => p + Math.random().toString(36).slice(2, 8);
const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* Téléphone au format international, seul format que comprennent les
   liens sms: et wa.me. « 06 12 34 56 78 » devient « +33612345678 ». */
export function normPhone(raw: unknown): string {
  let s = String(raw || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) {
    if (s.length === 10 && s[0] === "0") s = "+33" + s.slice(1);        // 0612345678
    else if (s.length === 9) s = "+33" + s;                             // 612345678
    else s = "+" + s;
  }
  const digits = s.slice(1).replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? "+" + digits : "";
}

export function fmtPhone(p: string): string {
  if (!p) return "";
  if (p.startsWith("+33") && p.length === 12)
    return ("0" + p.slice(3)).replace(/(\d\d)(?=\d)/g, "$1 ").trim();
  return p.replace(/(\d{2,3})(?=\d)/g, "$1 ").trim();
}

export const countDays = (days: boolean[]): number => days.filter(Boolean).length;

/* Toujours sept cases. Une saisie à cinq jours vient d'une version
   antérieure : le week-end y était implicitement non travaillé. */
export function normDays(v: unknown, fallback: boolean[] | null): boolean[] | null {
  if (!Array.isArray(v)) return fallback || null;
  const days = v.slice(0, NDAYS).map(Boolean);
  while (days.length < NDAYS) days.push(false);
  return days;
}

/* Adresse e-mail, tolerante a la saisie mais verifiee : c'est par la
   que partent les demandes de disponibilite automatiques. */
export function normEmail(raw: unknown): string {
  const s = String(raw || "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(s) ? s.slice(0, 120) : "";
}

export function normPerson(id: string, o: Partial<Person> | null | undefined): Person {
  const src = (o || {}) as Record<string, any>;
  const sk = {} as Levels;
  SK.forEach(k => sk[k] = Math.max(1, Math.min(5, Math.round(num((src.sk || {})[k], 1)))));
  let days = normDays(src.days, null) || [];
  while (days.length < NDAYS) days.push(false);
  if (!days.some(Boolean)) days = [true, true, true, true, true, false, false];
  return {
    id,
    name: String(src.name || "Sans nom").slice(0, 60),
    phone: normPhone(src.phone),
    email: normEmail(src.email),
    days, permis: !!src.permis, sk,
    note: String(src.note || "").slice(0, 300)
  };
}

export function normSite(id: string, o: Partial<Site> | null | undefined): Site {
  const src = (o || {}) as Record<string, any>;
  const ph: number[] = [];
  for (let i = 0; i < 12; i++)
    ph.push(Math.max(0, Math.min(100, Math.round(num((src.ph || [])[i], 0)))));

  /* Plan journalier. Une sauvegarde ancienne portait `weeks`, indexé par
     lundi et valant pour la semaine entière : on l'étale sur lundi-vendredi. */
  const plan: Record<string, string[]> = {};
  const addTo = (d: string, ids: unknown) => {
    if (!isDate(d) || !Array.isArray(ids)) return;
    const clean = ids.filter((x): x is string => typeof x === "string");
    if (!clean.length) return;
    plan[d] = [...new Set((plan[d] || []).concat(clean))];
  };
  Object.keys(src.plan || {}).forEach(d => addTo(d, src.plan[d]));
  Object.keys(src.weeks || {}).forEach(wk => {
    for (let i = 0; i < 5; i++) addTo(addDays(wk, i), src.weeks[wk]);
  });

  /* Missions cochées, par étape : { "3": [true, false, ...] } */
  const tasks: Record<string, boolean[]> = {};
  Object.keys(src.tasks || {}).forEach(k => {
    const i = parseInt(k, 10);
    if (!(i >= 0 && i < 12) || !Array.isArray(src.tasks[k])) return;
    const arr: boolean[] = [];
    for (let j = 0; j < PHASES[i].tasks.length; j++) arr.push(!!src.tasks[k][j]);
    if (arr.some(Boolean)) tasks[String(i)] = arr;
  });

  return {
    id,
    code: String(src.code || "?").slice(0, 20),
    addr: String(src.addr || "").slice(0, 120),
    start: isDate(src.start) ? src.start : mondayOf(todayISO()),
    months: Math.max(1, Math.min(12, Math.round(num(src.months, 2)))),
    coef: Math.max(0.3, Math.min(3, num(src.coef, 1))),
    ph, note: String(src.note || "").slice(0, 2000), plan, tasks
  };
}

/* Réponse à une demande de disponibilité, pour une semaine donnée. */
export function normAvail(id: string, o: Partial<Avail> | null | undefined): Avail {
  const src = (o || {}) as Record<string, any>;
  return {
    id,
    token: String(src.token || ""),
    personId: String(src.personId || ""),
    week: isDate(src.week) ? src.week : "",
    days: src.days ? normDays(src.days, null) : null,
    note: String(src.note || "").slice(0, 300),
    answeredAt: src.answeredAt || null
  };
}

/* ---------- code chantier depuis l'adresse ----------
   Convention maison : numéro de voie + initiales de la rue + numéro
   d'appartement.  « 151 Henri Desbals apt 7 » → « 151HD7 ».
   Une rue d'un seul mot donne ses deux premières lettres.
   Ce n'est qu'une proposition : le champ reste modifiable. */

const VOIE = ["rue","avenue","av","boulevard","bd","bld","impasse","allee","place",
              "chemin","route","quai","cours","square","villa","passage","residence",
              "de","du","des","le","la","les","d","l","aux","au"];

export function codeFromAddr(addr: unknown): string {
  const clean = String(addr || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const apt = clean.match(/\b(?:apt|appt|app|appartement|ap|lot|n[o°]?)\s*\.?\s*(\d+)/i);
  const num2 = clean.match(/\b(\d+)\b/);

  let street = clean;
  if (apt) street = street.slice(0, apt.index);
  if (num2 && (num2.index ?? 0) < street.length)
    street = street.slice((num2.index ?? 0) + num2[1].length);

  const words = street.split(/[^A-Za-z]+/)
    .filter(w => w && VOIE.indexOf(w.toLowerCase()) < 0);

  let ini = "";
  if (words.length >= 2) ini = words.slice(0, 3).map(w => w[0]).join("");
  else if (words.length === 1) ini = words[0].slice(0, 2);

  return ((num2 ? num2[1] : "") + ini + (apt ? apt[1] : "")).toUpperCase().slice(0, 20);
}

/* ---------- missions cochées ----------
   Les missions cochées pilotent la barre : trois sur quatre font 75 %.
   La barre reste réglable au doigt pour les avancements qui ne se
   découpent pas proprement en missions. */

export const taskDone = (s: Site, i: number): boolean[] =>
  (s.tasks && s.tasks[String(i)]) || [];
export const taskCount = (i: number): number => PHASES[i].tasks.length;
export const tasksTicked = (s: Site, i: number): number =>
  taskDone(s, i).filter(Boolean).length;

export function setTask(s: Site, i: number, j: number, on: boolean): number {
  if (!s.tasks) s.tasks = {};
  const k = String(i);
  const arr = (s.tasks[k] || []).slice();
  while (arr.length < taskCount(i)) arr.push(false);
  arr[j] = !!on;
  if (arr.some(Boolean)) s.tasks[k] = arr; else delete s.tasks[k];
  return Math.round(arr.filter(Boolean).length / taskCount(i) * 100);
}

/* Régler la barre au doigt reste possible, mais la barre et les cases
   ne doivent jamais se contredire : le pourcentage d'une étape, c'est
   le nombre de ses missions faites. Glisser coche donc les N premières
   — à zéro, tout est décoché ; au bout, tout est coché.
   Conséquence assumée : une étape à mission unique est tout ou rien. */
export function setPhasePct(s: Site, i: number, v: number): number {
  const tot = taskCount(i);
  const n = Math.max(0, Math.min(tot, Math.round(v / 100 * tot)));
  const arr: boolean[] = [];
  for (let j = 0; j < tot; j++) arr.push(j < n);
  if (!s.tasks) s.tasks = {};
  const k = String(i);
  if (n) s.tasks[k] = arr; else delete s.tasks[k];
  s.ph[i] = Math.round(n / tot * 100);
  return s.ph[i];
}

/* Les crans que la barre peut atteindre : un par mission. */
export const phaseSteps = (i: number): number => taskCount(i);

/* Part restante d'une mission : nulle si cochée. Sans aucune coche —
   une reprise de données antérieure — l'avancement de l'étape
   s'applique uniformément. */
function taskRest(s: Site, i: number, j: number): number {
  if (s.ph[i] >= 100) return 0;
  const ticks = taskDone(s, i);
  if (ticks.some(Boolean)) return ticks[j] ? 0 : 1;
  return (100 - s.ph[i]) / 100;
}

/* Parcourt les missions qu'il reste à faire sur un chantier. */
export type RemainingFn = (T: Task, rest: number, i: number, j: number) => void;

export function eachRemaining(s: Site, fn: RemainingFn): void {
  PHASES.forEach((P, i) => {
    if (s.ph[i] >= 100) return;
    P.tasks.forEach((T, j) => {
      const rest = taskRest(s, i, j);
      if (rest > 0) fn(T, rest, i, j);
    });
  });
}

/* ---------- lecture du plan ---------- */

/* L'équipe d'un chantier UN JOUR donné. */
export const teamOn = (s: Site, day: string): string[] =>
  (s.plan && s.plan[day]) || [];

/* Écrit l'équipe d'un jour ; une journée vide disparaît du plan. */
export function setTeamOn(s: Site, day: string, ids: string[]): void {
  if (!s.plan) s.plan = {};
  const clean = [...new Set(ids)];
  if (clean.length) s.plan[day] = clean; else delete s.plan[day];
}

/* Tous les compagnons qui passent sur ce chantier dans la semaine. */
export function weekRoster(s: Site, wk: string): string[] {
  const seen: string[] = [];
  weekDates(wk).forEach(d => teamOn(s, d).forEach(pid => {
    if (seen.indexOf(pid) < 0) seen.push(pid);
  }));
  return seen;
}

/* Les sept cases « posé sur ce chantier » d'un compagnon, sur la semaine. */
export const daysOnSite = (s: Site, pid: string, wk: string): boolean[] =>
  weekDates(wk).map(d => teamOn(s, d).indexOf(pid) > -1);

export const dispoOf = (p: Person): number => countDays(p.days);
export const avgLv = (p: Person): number =>
  SK.reduce((a, k) => a + p.sk[k], 0) / SK.length;
export const siteProgress = (s: Site): number =>
  Math.round(s.ph.reduce((a, b) => a + b, 0) / 12);

export function currentPhase(s: Site): number {
  for (let i = 0; i < 12; i++) if (s.ph[i] < 100) return i;
  return 11;
}
export function span(s: Site): { first: string; last: string } {
  return { first: mondayOf(s.start), last: mondayOf(addMonths(s.start, s.months)) };
}
export function isActive(s: Site, wk: string): boolean {
  const p = span(s);
  return wk >= p.first && wk <= p.last;
}

/* ---------- charge et prévisionnel ---------- */

/* Somme des missions qui restent — et non plus un pourcentage d'étape. */
export function loadLeft(s: Site): number {
  let jh = 0;
  eachRemaining(s, (T, rest) => { jh += T.jh * rest; });
  return jh * (s.coef || 1);
}

/* Capacité d'une semaine : le nombre réel de journées posées sur le
   chantier, en ne comptant que celles où le compagnon est disponible. */
export type AvailableOn = (pid: string, day: string) => boolean;

export function capacity(s: Site, wk: string, availableOn?: AvailableOn): number {
  let n = 0;
  weekDates(wk).forEach(d => teamOn(s, d).forEach(pid => {
    if (!availableOn || availableOn(pid, d)) n++;
  }));
  return n;
}

/* Journées posées alors que l'intéressé s'est déclaré absent. */
export function conflicts(s: Site, wk: string, availableOn?: AvailableOn):
    { pid: string; day: string }[] {
  const out: { pid: string; day: string }[] = [];
  if (!availableOn) return out;
  weekDates(wk).forEach(d => teamOn(s, d).forEach(pid => {
    if (!availableOn(pid, d)) out.push({pid, day: d});
  }));
  return out;
}

export function forecast(s: Site, wk: string, availableOn?: AvailableOn): Forecast {
  const rest = loadLeft(s), cap = capacity(s, wk, availableOn), planned = addDays(span(s).last, 6);
  if (rest < 0.5) return {done:true, planned};
  if (!cap) return {stalled:true, rest, planned};
  const weeks = Math.ceil(rest / cap);
  const end = addDays(wk, weeks * 7 - 1);
  return {rest, cap, weeks, end, planned, late: end > planned};
}

/* Journées réellement travaillées dans une semaine — congés, intempéries
   et trajets déduits. Sert de référence partout. */
export const JH_SEMAINE = 4.6;

/* Effectif qu'il faudrait pour tenir la date annoncée. */
export function neededHeadcount(s: Site, wk: string): number {
  const rest = loadLeft(s);
  if (rest < 0.5) return 0;
  const weeksLeft = Math.max(1,
    Math.round((parse(span(s).last).getTime() - parse(wk).getTime()) / 604800000) + 1);
  return Math.max(1, Math.min(6, Math.ceil(rest / (weeksLeft * JH_SEMAINE))));
}

/* ============================================================
   Pression d'un chantier

   La charge qui reste, rapportée au temps qui reste avant la date
   annoncée. Un vaut « un binôme à plein temps d'ici la fin tient le
   calendrier » ; au-dessus, le chantier décroche.

   C'est le signal qui manquait le plus : sans lui, deux chantiers qui
   se disputaient le même plombier se départageaient sur le seul écart
   de compétence, et le chantier en retard pouvait perdre contre celui
   qui avait trois semaines d'avance.
   ============================================================ */
export function pressure(s: Site, wk: string): number {
  const rest = loadLeft(s);
  if (rest < 0.5) return 0;
  const semaines = Math.max(0.5,
    (parse(span(s).last).getTime() - parse(wk).getTime()) / 604800000 + 1);
  return rest / (semaines * JH_SEMAINE * 2);
}

/* ============================================================
   Besoin d'un chantier

   Trois choses, toutes tirées des missions qui restent :
     need   — la charge par corps de métier, pondérée par la proximité
              de l'étape : ce qui se joue cette semaine pèse plus que
              la cuisine du mois prochain ;
     req    — le niveau minimum qu'il faut avoir sous la main, SANS
              pondération : une mission de niveau 4 exige un niveau 4,
              qu'elle soit proche ou lointaine ;
     permis — une mission restante suppose de conduire.
   ============================================================ */

/* Ce qui compte, c'est ce qui se joue maintenant. L'étape en cours pèse
   1, la suivante 0,40, la troisième 0,16 : une décroissance franche, pour
   qu'un menuisier ne soit pas appelé sur un chantier qui pose ses gaines
   sous prétexte que la cuisine arrivera dans deux mois. */
const proximity = (d: number): number => Math.pow(0.4, Math.max(0, d));

/* Un seuil ne vaut d'être signalé que s'il tombe bientôt : réclamer un
   menuisier niveau 5 sur un chantier qui pose ses gaines, parce que la
   cuisine arrive dans deux mois, ne dit rien d'utile. */
export const SOON = 1;              // l'étape en cours et la suivante

export function siteNeed(s: Site): Need {
  const cur = currentPhase(s);
  const need = {} as Levels; SK.forEach(k => need[k] = 0);
  const req = {} as Levels; SK.forEach(k => req[k] = 0);   // sur tout le chantier
  const soon = {} as Levels; SK.forEach(k => soon[k] = 0); // dans les étapes proches
  let poly = 0, permis = false, permisSoon = false;
  let fronts = 0;                                    // missions ouvrables de front
  const proches: Need["proches"] = [];               // missions proches, en détail
  let nearW = 0;
  const large = {} as Levels; SK.forEach(k => large[k] = 0);   // horizon élargi
  let polyLarge = 0;

  eachRemaining(s, (T, rest, i) => {
    const near = i - cur <= SOON;
    const w = T.jh * rest * proximity(i - cur) * (s.coef || 1);
    /* Le même besoin, vu de plus loin : décroissance douce au lieu de
       franche. Il ne sert qu'aux compagnons surnuméraires — ceux que
       l'étape en cours ne peut plus occuper. */
    const wl = T.jh * rest * Math.pow(0.75, Math.max(0, i - cur)) * (s.coef || 1);
    if (T.sk) large[T.sk] += wl; else polyLarge += wl;
    /* Combien de tâches peuvent tourner en parallèle aujourd'hui.
       L'étape en cours compte plein ; la suivante à demi, car on ne
       l'entame qu'en partie. Une saignée à moitié faite ne vaut qu'un
       demi-front : c'est ce qui borne l'effectif utile. */
    if (i === cur) fronts += rest;
    else if (near) fronts += rest * 0.5;
    if (near) { proches.push({sk: T.sk, lv: T.lv, w}); nearW += w; }
    if (T.sk) {
      need[T.sk] += w;
      if (T.lv > req[T.sk]) req[T.sk] = T.lv;
      if (near && T.lv > soon[T.sk]) soon[T.sk] = T.lv;
    } else poly += w;
    if (T.permis) { permis = true; if (near) permisSoon = true; }
  });

  return {need, req, soon, poly, permis, permisSoon, proches, nearW,
          large, polyLarge,
          totalLarge: SK.reduce((a, k) => a + large[k], 0) + polyLarge,
          fronts: Math.max(1, Math.round(fronts)),
          total: SK.reduce((a, k) => a + need[k], 0) + poly};
}

/* Missions restantes que cette équipe ne sait pas faire : personne
   n'atteint le niveau exigé. C'est ce qui bloque vraiment un chantier. */
export type PersonLookup = (id: string) => Person | undefined | null;

export function uncovered(s: Site, ids: string[], person: PersonLookup): UncoveredTask[] {
  const team = ids.map(person).filter((x): x is Person => !!x);
  const out: UncoveredTask[] = [];
  eachRemaining(s, (T, rest, i, j) => {
    const sk = T.sk;
    if (!sk) return;
    const best = team.length ? Math.max.apply(null, team.map(p => p.sk[sk])) : 0;
    if (best < T.lv) out.push({task:T, phase:i, index:j, need:T.lv, have:best});
  });
  return out;
}

export function coverage(ids: string[], person: PersonLookup): Levels {
  const best = {} as Levels; SK.forEach(k => best[k] = 0);
  ids.map(person).filter((x): x is Person => !!x)
    .forEach(p => SK.forEach(k => best[k] = Math.max(best[k], p.sk[k])));
  return best;
}

/* ============================================================
   Valeur d'un compagnon pour un chantier

   Ce que le score récompense, par ordre d'importance :
     • franchir un seuil — amener l'équipe au niveau qu'une mission
       exige débloque le travail, bien plus que d'ajouter un demi-niveau
       à un métier déjà couvert ;
     • couvrir la charge restante du métier ;
     • la main-d'œuvre polyvalente, pour la démolition et l'évacuation ;
     • le permis, tant que personne dans l'équipe ne l'a ;
     • la continuité — reprendre l'équipe de la veille évite de
       réexpliquer le chantier chaque matin.
   Ce qu'il pénalise :
     • un novice laissé sans encadrement ;
     • les rendements décroissants — le cinquième homme sur un T2 gêne
       plus qu'il n'aide.
   ============================================================ */

/** Le contexte d'un choix : ce que l'appelant sait déjà du chantier. */
export interface PickContext {
  need?: Need;
  pressure?: number;
  wasYesterday?: boolean;
}

export function scorePick(
  s: Site, teamPeople: Person[], p: Person, ctx?: PickContext
): PickResult {
  const c: PickContext = ctx || {};
  const nd0 = c.need || siteNeed(s);
  /* Les premiers arrivés servent l'étape en cours — c'est ce qui doit
     décider de l'affectation. Une fois les fronts du jour pourvus, les
     suivants n'ont plus rien à y prendre : plutôt que de les laisser au
     dépôt, on leur fait regarder l'horizon élargi, pour préparer la
     suite du chantier au lieu de piétiner. */
  const deTrop = teamPeople.length >= (nd0.fronts || 1);
  const nd = (deTrop && nd0.large)
    ? { ...nd0, need: nd0.large, poly: nd0.polyLarge, total: nd0.totalLarge }
    : nd0;
  const best = {} as Levels;
  SK.forEach(k => best[k] = teamPeople.length
    ? Math.max.apply(null, teamPeople.map(t => t.sk[k])) : 0);

  let gain = 0;
  const why: Why[] = [];

  SK.forEach(k => {
    const g = nd.need[k] * Math.max(0, p.sk[k] - best[k]) / 5;
    gain += g;
    if (nd.req[k] && best[k] < nd.req[k] && p.sk[k] >= nd.req[k]) {
      gain += nd.need[k] * 0.6 + 0.8;                  // débloque une mission
      why.push({type:"gate", k, lv:nd.req[k]});
    } else if (g > nd.total * 0.05) {
      why.push({type:"sk", k, lv:p.sk[k]});
    }
  });

  const pg = nd.poly * (avgLv(p) / 5) * 0.35;
  gain += pg;
  if (pg > gain * 0.45) why.push({type:"poly"});

  if (nd.permis && p.permis && !teamPeople.some(t => t.permis)) {
    gain += nd.total * 0.07 + 0.4;
    why.push({type:"permis"});
  }

  if (c.wasYesterday) { gain *= 1.25; why.push({type:"suite"}); }

  if (avgLv(p) < 1.8) {                                // novice
    const mentor = teamPeople.some(t => avgLv(t) >= 3);
    gain *= mentor ? 1 : 0.45;
    why.push({type: mentor ? "encadre" : "seul"});
  }

  /* Ce que cette personne peut réellement prendre aujourd'hui : la part
     des missions proches dont elle a le niveau. Sans ce garde-fou, on
     posait un peintre sur un chantier au stade des saignées — il y
     passait la journée sans rien pouvoir avancer. */
  if (nd.nearW > 0 && nd.proches) {
    let prise = 0;
    for (const m of nd.proches)
      if (m.sk ? p.sk[m.sk] >= m.lv : avgLv(p) >= m.lv) prise += m.w;
    const part = prise / nd.nearW;
    /* Coupure franche, et rien de plus : amortir aussi les cas partiels
       faisait passer trop de gains sous le plancher du glouton, et
       l'équipe se retrouvait au repos pour de mauvaises raisons. */
    if (part < 0.001) { gain *= 0.05; why.push({type:"rien"}); }
  }

  /* Urgence. À compétence égale, le chantier qui a pris du retard
     l'emporte sur celui qui a de la marge. */
  if (c.pressure != null) {
    gain *= 0.75 + 0.5 * Math.min(2, c.pressure);
    if (c.pressure > 1.2) why.push({type:"retard"});
  }

  /* Rendements décroissants. La pénalité de fond vaut pour tout le
     monde ; passé le nombre de missions ouvertes de front, elle devient
     franche — on ne met pas trois personnes sur une seule saignée, on
     les envoie là où il reste du travail à prendre. */
  const trop = Math.max(0, teamPeople.length - (nd.fronts || 1) + 1);
  gain /= 1 + 0.3 * teamPeople.length + 0.9 * trop;
  return {gain, why};
}

/* Composition d'un seul chantier — le bouton « Composer ».
   `usableDays(p)` rend le nombre de jours où la personne pourrait
   effectivement venir ; à zéro, elle est hors pool. */
export function suggestTeam(
  s: Site,
  size: number,
  wk: string,
  people: Person[],
  usableDays?: ((p: Person) => number) | null,
  wasYesterday?: ((p: Person) => boolean) | null
): { team: TeamPick[]; need: Need } {
  const nd = siteNeed(s);
  const pr = pressure(s, wk);
  const free = (p: Person) => usableDays ? usableDays(p) : countDays(p.days);
  const pool = people.filter(p => free(p) > 0);
  const team: TeamPick[] = [];

  while (team.length < size && pool.length) {
    let pick: Person | null = null, bestGain = -1, bestWhy: Why[] = [];
    for (const p of pool) {
      const r = scorePick(s, team.map(t => t.p), p,
        {need: nd, pressure: pr, wasYesterday: wasYesterday ? wasYesterday(p) : false});
      const g = r.gain * (0.72 + 0.28 * (free(p) / NDAYS));
      if (g > bestGain) { bestGain = g; pick = p; bestWhy = r.why; }
    }
    if (!pick || bestGain <= 0.0001) break;
    team.push({p:pick, gain:bestGain, why:bestWhy, days:free(pick)});
    pool.splice(pool.indexOf(pick), 1);
  }
  return {team, need:nd};
}

/* ============================================================
   Répartition de toute l'équipe sur toute la semaine

   Le « Composer » d'un chantier raisonne dans son coin : le premier
   ouvert rafle le meilleur plombier, même si l'autre en a davantage
   besoin. Ici on affecte jour par jour, tous les chantiers en
   concurrence sur la même personne.

   Glouton sur le gain marginal, puis une passe d'échanges deux à deux
   qui rattrape les mauvais choix d'ordre. Ce n'est pas l'optimum
   mathématique — le problème est NP-difficile — mais c'est stable,
   explicable, et sans commune mesure avec le chantier par chantier.
   ============================================================ */

export interface OptimizeOptions { floor?: number }

export function optimizeWeek(
  sites: Site[],
  people: Person[],
  wk: string,
  availableOn: AvailableOn,
  opts?: OptimizeOptions
): WeekPlan {
  const o: OptimizeOptions = opts || {};
  const floor = o.floor == null ? 0.3 : o.floor;
  const dates = weekDates(wk);
  /* Un chantier qui a débuté et sur lequel il reste du travail est à
     pourvoir, que la date annoncée soit tenue ou non. Le filtre portait
     aussi sur la fin de la période : passé l'échéance, le chantier
     sortait de la liste et plus personne n'y était jamais posé — il ne
     pouvait donc plus se terminer, et l'équipe restait au repos pendant
     qu'il restait du travail. */
  const targets = sites.filter(s => loadLeft(s) > 0.5 && wk >= span(s).first);
  /* `bench` manquait dans ce retour anticipé : le type l'a révélé.
     Un appelant qui lisait `r.bench.length` sur une semaine sans
     chantier ouvert aurait planté. */
  if (!targets.length)
    return { plan: {}, why: {}, gaps: [], bench: [], posed: 0, targets: [] };

  const needs = new Map<string, Need>(targets.map(s => [s.id, siteNeed(s)]));
  const press = new Map<string, number>(targets.map(s => [s.id, pressure(s, wk)]));
  /* Le plafond tenait au seul volume restant : un chantier de six mois
     réclamait six personnes même quand l'étape du jour n'offrait que
     deux missions à prendre. On le borne aussi par ce que le travail
     du moment peut absorber. */
  const cap = new Map<string, number>(targets.map(s => [s.id,
    Math.min(Math.max(1, neededHeadcount(s, wk)) + 1, needs.get(s.id)!.fronts + 1)]));
  const plan: WeekPlan["plan"] = {};     // sid -> jour -> [pid]
  const why: WeekPlan["why"] = {};      // "sid#jour#pid" -> raisons
  const gaps: Gap[] = [];
  const bench: WeekPlan["bench"] = [];  // disponibles, mais sans emploi utile
  let posed = 0;
  targets.forEach(s => plan[s.id] = {});

  dates.forEach((day, di) => {
    const avail = people.filter(p => availableOn(p.id, day));
    if (!avail.length) return;
    const yest = di > 0 ? dates[di-1] : null;
    const teams = new Map<string, Person[]>(targets.map(s => [s.id, [] as Person[]]));
    const taken = new Set<string>();

    const wasYest = (s: Site, p: Person) => !!yest &&
      (((plan[s.id] || {})[yest] || []).indexOf(p.id) > -1 || teamOn(s, yest).indexOf(p.id) > -1);

    /* --- glouton : à chaque tour, le meilleur couple chantier/personne --- */
    for (;;) {
      let best: { s: Site; p: Person; gain: number; why: Why[] } | null = null;
      for (const s of targets) {
        if (teams.get(s.id)!.length >= cap.get(s.id)!) continue;
        for (const p of avail) {
          if (taken.has(p.id)) continue;
          const r = scorePick(s, teams.get(s.id)!, p,
            {need: needs.get(s.id), pressure: press.get(s.id), wasYesterday: wasYest(s, p)});
          if (!best || r.gain > best.gain) best = {s, p, gain:r.gain, why:r.why};
        }
      }
      if (!best || best.gain <= floor) break;
      teams.get(best.s.id)!.push(best.p);
      taken.add(best.p.id);
      why[best.s.id + "#" + day + "#" + best.p.id] = best.why;
    }

    /* --- échanges deux à deux ---
       Permuter deux personnes posées sur des chantiers différents le
       même jour améliore-t-il le total ? Trois passes suffisent à
       stabiliser des équipes de cette taille. */
    const total = () => targets.reduce((a, s) => {
      const t = teams.get(s.id)!;
      return a + t.reduce((b: number, p: Person, i: number) =>
        b + scorePick(s, t.slice(0, i), p,
          {need: needs.get(s.id), pressure: press.get(s.id)}).gain, 0);
    }, 0);

    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let a = 0; a < targets.length; a++) {
        for (let b = a + 1; b < targets.length; b++) {
          const ta = teams.get(targets[a].id)!, tb = teams.get(targets[b].id)!;
          for (let i = 0; i < ta.length; i++) {
            for (let j = 0; j < tb.length; j++) {
              const before = total();
              const pa = ta[i], pb = tb[j];
              ta[i] = pb; tb[j] = pa;
              if (total() > before + 0.01) moved = true;
              else { ta[i] = pa; tb[j] = pb; }
            }
          }
        }
      }
      if (!moved) break;
    }

    /* Les raisons suivent les personnes. Celles du glouton désignaient
       qui avait été choisi AVANT les échanges : après une permutation,
       l'une parlait de quelqu'un parti ailleurs, et celui qui l'avait
       remplacé n'en avait aucune (constat D1). On les recalcule sur les
       équipes finales, dans le contexte même du glouton — l'équipe déjà
       posée avant chacun, et la veille. Sans échange, elles sont
       identiques à celles du glouton. */
    targets.forEach(s => {
      const t = teams.get(s.id)!;
      avail.forEach(p => { delete why[s.id + "#" + day + "#" + p.id]; });
      t.forEach((p, i) => {
        why[s.id + "#" + day + "#" + p.id] = scorePick(s, t.slice(0, i), p,
          {need: needs.get(s.id), pressure: press.get(s.id), wasYesterday: wasYest(s, p)}).why;
      });
    });

    teams.forEach((team, sid) => {
      if (!team.length) return;
      (plan[sid] ||= {})[day] = team.map(p => p.id);
      posed += team.length;
    });

    /* Qui reste sur le banc. Le glouton s'arrête quand plus personne
       n'apporte quoi que ce soit là où il pourrait aller : mieux vaut
       le dire à Geoffrey que disperser des compagnons sur des chantiers
       où ils passeraient la journée sans rien pouvoir avancer. */
    avail.forEach(p => { if (!taken.has(p.id)) bench.push({day, pid: p.id}); });

    /* --- ce qui reste découvert ce jour-là --- */
    targets.forEach(s => {
      const nd = needs.get(s.id)!, team = teams.get(s.id)!;
      if (!team.length) return;
      SK.forEach(k => {
        if (!nd.soon[k] || nd.need[k] < nd.total * 0.08) return;
        const have = Math.max.apply(null, team.map(p => p.sk[k]));
        if (have < nd.soon[k]) gaps.push({site:s, day, sk:k, need:nd.soon[k], have});
      });
    });
  });

  return {plan, why, gaps, bench, posed, targets};
}
