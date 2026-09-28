/* ============================================================
   Les opérations d'affectation (ADR-001, ADR-003)

   Le client n'envoie plus « voici tout le plan », mais un geste :
   pose, retire, remplace l'équipe d'un jour, applique un plan de
   semaine. Chaque geste s'exécute ici, dans la transaction de la
   route, sur des chantiers et des compagnons DÉJÀ verrouillés
   (voir verrouillerChantiers / verrouillerCompagnons).

   La règle « un homme, un chantier, par jour » :
   • hors urgence, poser quelqu'un le retire d'abord de ses autres
     chantiers ce jour-là — exactement ce que fait assignDay dans
     l'interface ;
   • en urgence, s'il est déjà posé ailleurs, il est ajouté quand même,
     marqué `urgence = 1, occupe = NULL` : c'est la trace écrite de la
     dérogation, et la seule chose qui lève la contrainte en base ;
   • la contrainte `un_homme_un_jour` reste le dernier mot : si deux
     appareils passaient malgré tout au même instant, la base refuse,
     et la route répond 409.

   `Suivi` note ce que le geste a touché : c'est ce que la route relit
   pour sa réponse, et ce qu'elle annonce aux autres appareils.
   ============================================================ */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { normSite, setTeamOn, teamOn } from "@geoplan/domain";
import { equipeAEcrire } from "@geoplan/domain/operations";
import { assignments } from "../db/schema.ts";
import type { Tx } from "../db/transaction.ts";

export interface Suivi {
  chantiers: Set<string>;   // chantiers dont l'équipe d'un jour a pu changer
  jours: Set<string>;
  modifie: boolean;         // faux : le geste n'a rien changé, rien à annoncer
  /** (jour, compagnon) dont une affectation a été supprimée : leur
      urgence restante est peut-être devenue sans objet. */
  retraits: Map<string, readonly [string, string]>;
}
export const nouveauSuivi = (): Suivi =>
  ({ chantiers: new Set(), jours: new Set(), modifie: false, retraits: new Map() });

/** Noter qu'une affectation de `pid` le jour `jour` a disparu. */
export const noterRetrait = (suivi: Suivi, jour: string, pid: string): void => {
  suivi.retraits.set(jour + "|" + pid, [jour, pid]);
};

/* ---------- lectures élémentaires ---------- */

/** Où est posée cette personne ce jour-là (tous chantiers). */
const lignesDuJour = (tx: Tx, jour: string, pid: string) =>
  tx.select({ siteId: assignments.siteId, urgence: assignments.urgence })
    .from(assignments)
    .where(and(eq(assignments.day, jour), eq(assignments.personId, pid)));

/** L'équipe d'un chantier un jour donné, dans l'ordre des puces. */
const equipeDuJour = (tx: Tx, sid: string, jour: string) =>
  tx.select({ personId: assignments.personId, position: assignments.position })
    .from(assignments)
    .where(and(eq(assignments.siteId, sid), eq(assignments.day, jour)))
    .orderBy(assignments.position, assignments.createdAt, assignments.personId);

async function positionSuivante(tx: Tx, sid: string, jour: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`coalesce(max(${assignments.position}), -1) + 1` })
    .from(assignments)
    .where(and(eq(assignments.siteId, sid), eq(assignments.day, jour)));
  return Number(r?.n ?? 0);
}

/* ---------- écritures élémentaires ---------- */

/** Retire la personne de tous ses chantiers ce jour-là, sauf `sauf`. */
async function retirerAilleurs(tx: Tx, suivi: Suivi, jour: string, pid: string, sauf: string): Promise<void> {
  const ailleurs = (await lignesDuJour(tx, jour, pid)).filter(l => l.siteId !== sauf);
  if (!ailleurs.length) return;
  await tx.delete(assignments).where(and(
    eq(assignments.day, jour), eq(assignments.personId, pid), ne(assignments.siteId, sauf)));
  for (const l of ailleurs) suivi.chantiers.add(l.siteId);
  suivi.jours.add(jour);
  suivi.modifie = true;
  noterRetrait(suivi, jour, pid);
}

/* Une affectation normale occupe la journée (occupe = 1) ; une
   affectation d'urgence ne l'occupe pas (NULL), et c'est ce NULL que
   l'index unique laisse passer. La contrainte CHECK garde les deux
   colonnes d'accord : on ne peut pas écrire l'une sans l'autre. */
async function inserer(tx: Tx, suivi: Suivi, sid: string, jour: string, pid: string,
                       enUrgence: boolean, position: number): Promise<void> {
  await tx.insert(assignments).values({
    siteId: sid, day: jour, personId: pid,
    urgence: enUrgence, occupe: enUrgence ? null : 1, position
  });
  suivi.chantiers.add(sid);
  suivi.jours.add(jour);
  suivi.modifie = true;
}

/* Ajoute une personne absente de ce chantier ce jour-là, selon la règle :
   hors urgence, on la retire d'abord d'ailleurs ; en urgence, on la
   marque comme telle si — et seulement si — elle est déjà posée ailleurs. */
async function ajouter(tx: Tx, suivi: Suivi, sid: string, jour: string, pid: string,
                       urgence: boolean, position: number): Promise<void> {
  let enUrgence = false;
  if (urgence) enUrgence = (await lignesDuJour(tx, jour, pid)).some(l => l.siteId !== sid);
  else await retirerAilleurs(tx, suivi, jour, pid, sid);
  await inserer(tx, suivi, sid, jour, pid, enUrgence, position);
}

/* ---------- les quatre gestes ---------- */

/** « Pose P sur S le jour J » : assignDay. Déjà là : rien. */
export async function poser(tx: Tx, suivi: Suivi, sid: string, jour: string, pid: string,
                            urgence: boolean): Promise<void> {
  suivi.chantiers.add(sid);
  suivi.jours.add(jour);
  const lignes = await lignesDuJour(tx, jour, pid);
  if (lignes.some(l => l.siteId === sid)) return;
  await ajouter(tx, suivi, sid, jour, pid, urgence, await positionSuivante(tx, sid, jour));
}

/** « Retire P du jour J » — de ce chantier, ou de tous. */
export async function retirer(tx: Tx, suivi: Suivi, jour: string, pid: string, sid?: string): Promise<void> {
  if (sid) suivi.chantiers.add(sid);
  suivi.jours.add(jour);
  const lignes = (await lignesDuJour(tx, jour, pid)).filter(l => !sid || l.siteId === sid);
  if (!lignes.length) return;
  await tx.delete(assignments).where(and(
    eq(assignments.day, jour), eq(assignments.personId, pid),
    sid ? eq(assignments.siteId, sid) : undefined));
  for (const l of lignes) suivi.chantiers.add(l.siteId);
  suivi.modifie = true;
  noterRetrait(suivi, jour, pid);
}

/** L'équipe actuelle de S le jour J, dans l'ordre des puces. */
export const equipeActuelle = async (tx: Tx, sid: string, jour: string): Promise<string[]> =>
  (await equipeDuJour(tx, sid, jour)).map(a => a.personId);

/**
 * « L'équipe de S le jour J est désormais `ids` », dans cet ordre —
 * `ids` étant déjà fusionnée avec ce qu'un autre appareil a pu faire
 * entre-temps (fusionnerEquipe, dans la route).
 *
 * L'équipe visée est celle qu'écrirait le domaine (setTeamOn : doublons
 * retirés, une liste vide efface la journée). Ceux qui sortent sont
 * retirés ; ceux qui entrent sont posés selon la règle de « poser » ;
 * ceux qui restent gardent leur affectation et prennent leur nouvelle
 * place dans l'ordre.
 *
 * `planifies` : ce que fait « Appliquer ce plan » (applyPlan). Ceux que
 * le plan cite quittent, hors urgence, leurs autres chantiers ce jour-là,
 * y compris s'ils étaient déjà présents ici et doublés ailleurs par une
 * urgence antérieure. Ceux qu'un autre appareil avait ajoutés ne restent
 * que s'ils sont encore là (equipeAEcrire). « Remplacer l'équipe » suit,
 * elle, la règle de « poser » : qui est déjà là n'est pas touché.
 */
export async function remplacerEquipe(tx: Tx, suivi: Suivi, sid: string, jour: string, ids: string[],
                                      urgence: boolean, planifies?: readonly string[]): Promise<void> {
  suivi.chantiers.add(sid);
  suivi.jours.add(jour);
  const actuelle = await equipeDuJour(tx, sid, jour);
  const brouillon = normSite(sid, {});
  setTeamOn(brouillon, jour, planifies ? equipeAEcrire(ids, planifies, actuelle.map(a => a.personId)) : ids);
  const cible = teamOn(brouillon, jour);

  const partants = actuelle.filter(a => !cible.includes(a.personId)).map(a => a.personId);
  if (partants.length) {
    await tx.delete(assignments).where(and(
      eq(assignments.siteId, sid), eq(assignments.day, jour), inArray(assignments.personId, partants)));
    suivi.modifie = true;
    for (const pid of partants) noterRetrait(suivi, jour, pid);
  }

  for (const [position, pid] of cible.entries()) {
    const present = actuelle.find(a => a.personId === pid);
    if (!present) { await ajouter(tx, suivi, sid, jour, pid, urgence, position); continue; }
    if (planifies?.includes(pid) && !urgence) await retirerAilleurs(tx, suivi, jour, pid, sid);
    if (present.position !== position) {
      await tx.update(assignments).set({ position }).where(and(
        eq(assignments.siteId, sid), eq(assignments.day, jour), eq(assignments.personId, pid)));
      suivi.modifie = true;
    }
  }
}

/* ---------- l'urgence qui ne double plus personne ---------- */

/**
 * Une affectation d'urgence est la trace d'une dérogation : quelqu'un
 * posé ici EN PLUS de son chantier du jour. Quand l'affectation normale
 * disparaît (retrait, déplacement, chantier supprimé), la dérogation
 * n'a plus d'objet. La plus ancienne des affectations restantes
 * redevient normale : l'écran cesse de signaler une urgence qui
 * n'existe plus, et `un_homme_un_jour` tient de nouveau la journée.
 *
 * À appeler en fin de geste, dans sa transaction, compagnons verrouillés.
 */
export async function normaliserUrgences(tx: Tx, suivi: Suivi): Promise<void> {
  for (const [jour, pid] of suivi.retraits.values()) {
    const restantes = await tx.select({ siteId: assignments.siteId, urgence: assignments.urgence })
      .from(assignments)
      .where(and(eq(assignments.day, jour), eq(assignments.personId, pid)))
      .orderBy(assignments.createdAt, assignments.siteId);
    if (!restantes.length || restantes.some(l => !l.urgence)) continue;
    const garde = restantes[0].siteId;
    await tx.update(assignments).set({ urgence: false, occupe: 1 }).where(and(
      eq(assignments.siteId, garde), eq(assignments.day, jour), eq(assignments.personId, pid)));
    suivi.chantiers.add(garde);
    suivi.jours.add(jour);
    suivi.modifie = true;
  }
  suivi.retraits.clear();
}
