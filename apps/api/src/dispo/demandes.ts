/* ============================================================
   Les demandes de disponibilité

   Une demande : un compagnon, une semaine, un jeton. Le jeton est la
   seule clé du compagnon (il n'a pas de compte) : 32 octets aléatoires,
   256 bits, en base64url. Il ne change JAMAIS une fois créé : un lien
   déjà envoyé par e-mail ou par SMS doit continuer d'ouvrir la même
   demande, et une réponse déjà donnée ne doit pas être perdue.

   Les horodatages sont écrits par MySQL lui-même, en UTC
   (UTC_TIMESTAMP) : l'échéance se compare dans la même horloge que
   celle qui l'a posée, quel que soit le fuseau de la machine ou de la
   session.
   ============================================================ */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Avail } from "@geoplan/domain";
import type { Db } from "../db/client.ts";
import { availRequests, people } from "../db/schema.ts";

/** Durée de validité d'un lien, comme dans Supabase. */
export const DUREE_JOURS = 60;

/* Les jetons d'aujourd'hui font 43 caractères ; ceux de Supabase, 18
   caractères base32, doivent rester valides après la migration. Ce qui
   sort de ce gabarit est refusé sans interroger la base. */
export const JETON_VALIDE = /^[A-Za-z0-9_-]{16,64}$/;

export const nouveauJeton = (): string => randomBytes(32).toString("base64url");

/* Clé de limitation de débit : l'empreinte du jeton, pas le jeton. Une
   copie de Redis ne doit livrer aucun lien valide (même règle que pour
   les sessions, ADR-002). */
export const empreinteJeton = (jeton: string): string =>
  createHash("sha256").update(jeton).digest("base64url").slice(0, 32);

export const MAINTENANT_UTC = sql`UTC_TIMESTAMP(3)`;
export const NON_EXPIREE = sql`${availRequests.expiresAt} > UTC_TIMESTAMP(3)`;

export type LigneDemande = typeof availRequests.$inferSelect;

export const idDemande = (personId: string, semaine: string): string => personId + "@" + semaine;

export const lienDispo = (origine: string, jeton: string): string =>
  origine + "/dispo.html?t=" + jeton;

/* La page compagnon et l'e-mail ne disent que le prénom : un lien
   transféré, ou un écran vu par-dessus l'épaule, en livre le moins
   possible. */
export const prenom = (nom: string): string => nom.trim().split(/\s+/)[0] ?? "";

/** « 2026-09-26 10:00:00.123 », tel que MySQL le rend (UTC), en ISO 8601. */
export const versIso = (s: string | null): string | null =>
  s ? s.replace(" ", "T") + "Z" : null;

/** La forme que connaît le client (Avail, dans le domaine). */
export function enAvail(d: LigneDemande): Avail {
  return {
    id: d.id, token: d.token, personId: d.personId, week: d.week,
    days: d.days ?? null, note: d.note, answeredAt: versIso(d.answeredAt)
  };
}

/** Les demandes de `semaine` de ces compagnons, par compagnon. */
export async function lireDemandesDe(db: Db, personIds: string[], semaine: string):
    Promise<Map<string, LigneDemande>> {
  if (!personIds.length) return new Map();
  const lignes = await db.select().from(availRequests)
    .where(and(eq(availRequests.week, semaine), inArray(availRequests.personId, personIds)));
  return new Map(lignes.map(l => [l.personId, l]));
}

/** Crée les demandes manquantes de `semaine` pour ces compagnons, sans
    toucher à celles qui existent : ni leur jeton, ni leur réponse, ni
    leur date d'envoi. Une demande existante mais expirée reprend
    60 jours, avec le même jeton : on s'apprête à (re)donner son lien, il
    doit s'ouvrir. Un identifiant inconnu (compagnon supprimé sur un
    autre appareil entre-temps) est ignoré, comme le faisait le client.
    Rend les demandes dans l'ordre des identifiants, et les identifiants
    des demandes créées. */
export async function assurerDemandes(db: Db, personIds: string[], semaine: string):
    Promise<{ demandes: LigneDemande[]; creees: string[] }> {
  const ids = [...new Set(personIds)];
  if (!ids.length) return { demandes: [], creees: [] };
  const existants = new Set((await db.select({ id: people.id }).from(people).where(inArray(people.id, ids)))
    .map(p => p.id));
  const connus = ids.filter(id => existants.has(id));       // dans l'ordre demandé
  const avant = await lireDemandesDe(db, connus, semaine);
  const manquants = connus.filter(id => !avant.has(id));
  if (manquants.length) {
    await db.insert(availRequests).values(manquants.map(pid => ({
      id: idDemande(pid, semaine), token: nouveauJeton(), personId: pid, week: semaine,
      createdAt: MAINTENANT_UTC,
      expiresAt: sql`UTC_TIMESTAMP(3) + INTERVAL ${DUREE_JOURS} DAY`
    })))
      /* Une demande créée entre la lecture et l'écriture (un autre
         appareil, la relance du samedi) gagne : on garde la sienne,
         jeton compris. Rien n'est mis à jour. */
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  }
  const dejaLa = connus.filter(id => avant.has(id));
  if (dejaLa.length)
    await db.update(availRequests)
      .set({ expiresAt: sql`UTC_TIMESTAMP(3) + INTERVAL ${DUREE_JOURS} DAY` })
      .where(and(eq(availRequests.week, semaine), inArray(availRequests.personId, dejaLa),
                 sql`${availRequests.expiresAt} <= UTC_TIMESTAMP(3)`));
  const apres = await lireDemandesDe(db, connus, semaine);
  return {
    demandes: ids.flatMap(id => apres.get(id) ?? []),
    creees: manquants.map(pid => idDemande(pid, semaine))
  };
}

/* Le nettoyage des erreurs SQL vit avec les autres erreurs HTTP : le
   gestionnaire central s'en sert pour toutes les routes. */
export { erreurSansDonnees } from "../http/erreurs.ts";
