/* ============================================================
   Des lignes MySQL aux objets du domaine, et retour

   Le client manipule des `Person`, des `Site` et des `Avail`, dans la
   forme exacte que fixe le domaine : l'API la lui rend telle quelle.
   Chaque lecture repasse par normPerson / normSite / normAvail — une
   ligne écrite par la migration depuis Supabase, ou à la main, sort
   donc bornée comme toutes les autres.

   Ce que la base ajoute à la forme du domaine :
   • `version`, pour le verrou optimiste des fiches (ADR-003) ;
   • `urgences`, sur un chantier : jour → compagnons posés en urgence,
     pour que l'interface signale la dérogation au lieu de la cacher.
   ============================================================ */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  normPerson, normSite, normAvail,
  type Person, type Site, type Avail
} from "@geoplan/domain";
import { people, sites, assignments, availRequests } from "../db/schema.ts";
import type { Tx } from "../db/transaction.ts";
import { ErreurHttp } from "../http/erreurs.ts";

export type FicheCompagnon = Person & { version: number };
export type FicheChantier = Site & { version: number; urgences: Record<string, string[]> };

export interface Donnees {
  people: FicheCompagnon[];
  sites: FicheChantier[];
  avail: Avail[];
}

type LigneCompagnon = typeof people.$inferSelect;
type LigneChantier = typeof sites.$inferSelect;
interface LigneAffectation { siteId: string; day: string; personId: string; urgence: boolean }

export const maintenant = sql`CURRENT_TIMESTAMP(3)`;

/* ---------- compagnons ---------- */

export function compagnonDeLigne(l: LigneCompagnon): FicheCompagnon {
  const p = normPerson(l.id, {
    name: l.name, phone: l.phone, email: l.email, days: l.days,
    permis: l.permis, sk: l.sk, note: l.note
  });
  return { ...p, version: l.version };
}

/** Les colonnes d'un compagnon déjà normalisé (l'identifiant à part). */
export const colonnesCompagnon = (p: Person) => ({
  name: p.name, phone: p.phone, email: p.email, days: p.days,
  permis: p.permis, sk: p.sk, note: p.note
});

/* ---------- chantiers ---------- */

/* Le plan se recompose depuis les affectations, lues dans l'ordre des
   puces (position), puis de pose : c'est l'ordre que l'utilisateur a vu
   en posant. Les affectations d'urgence font partie de l'équipe du jour,
   comme dans l'interface ; elles sont EN PLUS listées dans `urgences`. */
export function chantierDeLigne(l: LigneChantier, affectations: LigneAffectation[]): FicheChantier {
  const plan: Record<string, string[]> = {};
  const urgences: Record<string, string[]> = {};
  for (const a of affectations) {
    if (a.siteId !== l.id) continue;
    (plan[a.day] ||= []).push(a.personId);
    if (a.urgence) (urgences[a.day] ||= []).push(a.personId);
  }
  const s = normSite(l.id, {
    code: l.code, addr: l.addr, start: l.startDate, months: l.months, coef: l.coef,
    ph: l.ph, note: l.note, plan, tasks: l.tasks
  });
  return { ...s, version: l.version, urgences };
}

/** Les colonnes d'un chantier déjà normalisé. Le plan n'en fait pas
    partie : il vit dans `assignments`, et ne s'écrit que par opérations. */
export const colonnesChantier = (s: Site) => ({
  code: s.code, addr: s.addr, startDate: s.start, months: s.months, coef: s.coef,
  ph: s.ph, note: s.note, tasks: s.tasks
});

const colonnesAffectation = {
  siteId: assignments.siteId, day: assignments.day,
  personId: assignments.personId, urgence: assignments.urgence
};
const ordreAffectations = [
  asc(assignments.siteId), asc(assignments.day), asc(assignments.position),
  asc(assignments.createdAt), asc(assignments.personId)
];

/* ---------- demandes de disponibilité ---------- */

/* La base rend « 2026-09-16 10:00:00.000 », en UTC (connexion en « Z ») ;
   le client attend un horodatage ISO, comme Supabase le lui donnait. */
const isoDe = (d: string | null): string | null => d ? d.replace(" ", "T") + "Z" : null;

function availDeLigne(l: typeof availRequests.$inferSelect): Avail {
  return normAvail(l.id, {
    token: l.token, personId: l.personId, week: l.week, days: l.days,
    note: l.note, answeredAt: isoDe(l.answeredAt)
  });
}

/* ---------- lectures ---------- */

/** Tout ce que l'écran affiche, lu dans un seul instantané. */
export async function lireTout(tx: Tx): Promise<Donnees> {
  const lp = await tx.select().from(people).orderBy(asc(people.createdAt), asc(people.id));
  const ls = await tx.select().from(sites).orderBy(asc(sites.createdAt), asc(sites.id));
  const la = await tx.select(colonnesAffectation).from(assignments).orderBy(...ordreAffectations);
  const ld = await tx.select().from(availRequests).orderBy(asc(availRequests.week), asc(availRequests.id));

  const parChantier = new Map<string, LigneAffectation[]>();
  for (const a of la) {
    const liste = parChantier.get(a.siteId);
    if (liste) liste.push(a); else parChantier.set(a.siteId, [a]);
  }
  return {
    people: lp.map(compagnonDeLigne),
    sites: ls.map(l => chantierDeLigne(l, parChantier.get(l.id) || [])),
    avail: ld.map(availDeLigne)
  };
}

/* MySQL compare les identifiants sans tenir compte de la casse
   (collation par défaut) : « P_ERWAN » trouverait « p_erwan ». On exige
   l'identifiant exact, sans quoi la suite du code, qui compare des
   chaînes, croirait avoir affaire à deux personnes différentes. */
const exact = <T extends { id: string }>(l: T | undefined, id: string): T | undefined =>
  l && l.id === id ? l : undefined;

export async function lireCompagnon(tx: Tx, id: string, o: { verrou?: boolean } = {}): Promise<FicheCompagnon | null> {
  const q = tx.select().from(people).where(eq(people.id, id));
  const [l] = o.verrou ? await q.for("update") : await q;
  const ligne = exact(l, id);
  return ligne ? compagnonDeLigne(ligne) : null;
}

export async function lireChantier(tx: Tx, id: string, o: { verrou?: boolean } = {}): Promise<FicheChantier | null> {
  const q = tx.select().from(sites).where(eq(sites.id, id));
  const [l] = o.verrou ? await q.for("update") : await q;
  const ligne = exact(l, id);
  if (!ligne) return null;
  const la = await tx.select(colonnesAffectation).from(assignments)
    .where(eq(assignments.siteId, id)).orderBy(...ordreAffectations);
  return chantierDeLigne(ligne, la);
}

/* ---------- verrous ----------
   Toute écriture d'affectation verrouille d'abord les chantiers, puis
   les compagnons qu'elle touche, chaque groupe dans l'ordre des
   identifiants (un seul SELECT … FOR UPDATE, que MySQL parcourt dans
   l'ordre de la clé primaire). Deux conséquences :
   • deux gestes sur la même personne, le même jour, depuis deux
     appareils, s'exécutent l'un APRÈS l'autre : le second voit ce qu'a
     fait le premier, et « retire d'abord de ses autres chantiers »
     reste vrai ;
   • un ordre unique d'acquisition écarte l'interblocage entre deux
     opérations qui se croisent. */

const uniques = (ids: string[]): string[] => [...new Set(ids)];

function manquants(voulus: string[], trouves: { id: string }[]): string[] {
  const ok = new Set(trouves.map(l => l.id));
  return voulus.filter(id => !ok.has(id));
}

export async function verrouillerChantiers(tx: Tx, ids: string[]): Promise<void> {
  const voulus = uniques(ids);
  if (!voulus.length) return;
  const lignes = await tx.select({ id: sites.id }).from(sites)
    .where(inArray(sites.id, voulus)).orderBy(asc(sites.id)).for("update");
  const absents = manquants(voulus, lignes);
  if (absents.length)
    throw new ErreurHttp(404, "introuvable", "Chantier introuvable", { ids: absents });
}

export async function verrouillerCompagnons(tx: Tx, ids: string[]): Promise<void> {
  const voulus = uniques(ids);
  if (!voulus.length) return;
  const lignes = await tx.select({ id: people.id }).from(people)
    .where(inArray(people.id, voulus)).orderBy(asc(people.id)).for("update");
  const absents = manquants(voulus, lignes);
  if (absents.length)
    throw new ErreurHttp(404, "introuvable", "Compagnon introuvable", { ids: absents });
}

/* ---------- l'état des affectations, pour la réponse ---------- */

export interface EtatAffectations {
  /** chantier → { plan: jour → ids dans l'ordre, urgences: jour → ids posés en urgence }.
      Chaque jour touché y figure, vide compris : le client sait ainsi
      qu'une équipe a été vidée, et pas seulement qu'elle n'est pas citée. */
  chantiers: Record<string, { plan: Record<string, string[]>; urgences: Record<string, string[]> }>;
}

export async function etatDes(tx: Tx, chantiers: Iterable<string>, jours: Iterable<string>): Promise<EtatAffectations> {
  const sids = [...new Set(chantiers)].sort();
  const js = [...new Set(jours)].sort();
  const out: EtatAffectations["chantiers"] = {};
  for (const sid of sids) {
    out[sid] = { plan: {}, urgences: {} };
    for (const j of js) { out[sid].plan[j] = []; out[sid].urgences[j] = []; }
  }
  if (!sids.length || !js.length) return { chantiers: out };
  const la = await tx.select(colonnesAffectation).from(assignments)
    .where(and(inArray(assignments.siteId, sids), inArray(assignments.day, js)))
    .orderBy(...ordreAffectations);
  for (const a of la) {
    const c = out[a.siteId];
    if (!c || !c.plan[a.day]) continue;
    c.plan[a.day].push(a.personId);
    if (a.urgence) c.urgences[a.day].push(a.personId);
  }
  return { chantiers: out };
}
