/* ============================================================
   Écrire des données du domaine dans MySQL, de façon idempotente

   Un seul écrivain pour deux usages :
     • l'amorçage d'une base neuve depuis data/effectif.json
       (cli/amorcer.ts, qui refuse une base déjà remplie) ;
     • la migration des données réelles depuis Supabase (W7), en
       MIROIR : ce que la source n'a plus disparaît aussi de la base.
       Un compagnon parti ne reçoit plus la relance du samedi, et
       l'affectation d'un chantier supprimé ne fait plus passer la vraie
       en urgence.

   Relancer l'import sur les mêmes données ne change rien : une fiche
   n'est réécrite (version + 1, ADR-003) que si elle a changé, les
   affectations d'un chantier sont réécrites en entier, les jetons des
   liens compagnons conservés.

   Le plan d'un chantier est déplié en lignes d'affectation (ADR-001).
   Supabase ne mémorisait pas l'urgence : si une personne figure sur
   deux chantiers le même jour, la première occurrence (dans l'ordre des
   chantiers, puis des jours) est normale, les suivantes sont posées en
   URGENCE, et le rapport les nomme. Aucune donnée n'est perdue.

   Un identifiant que l'API refuserait (gabarit de http/validation.ts)
   bloque l'écriture : la fiche serait en base, mais aucune route ne
   pourrait plus la toucher. Le rapport à blanc les nomme.
   ============================================================ */

import { inArray, sql } from "drizzle-orm";
import { normAvail, normPerson, normSite, type Avail, type Person, type Site } from "@geoplan/domain";
import type { Db } from "../db/client.ts";
import { assignments, availRequests, people, sites } from "../db/schema.ts";
import { Identifiant } from "../http/validation.ts";
import { JETON_VALIDE } from "../dispo/demandes.ts";
import { chantierDeLigne, colonnesChantier, colonnesCompagnon, compagnonDeLigne } from "../donnees/fiches.ts";

/** Une demande telle que la source la connaît : ses dates d'origine
    viennent en plus quand la source les a (Supabase). */
export type AvailImport = Avail & { createdAt?: string | null; expiresAt?: string | null };

export interface Donnees {
  people: Person[];
  sites: Site[];
  avail: AvailImport[];
}

export interface Comptes { people: number; sites: number; assignments: number; avail_requests: number }

export interface OptionsImport {
  /** Calculer le rapport sans rien écrire. */
  aBlanc?: boolean;
  /** La base devient la copie de la source : ce qui lui manque est supprimé. */
  miroir?: boolean;
  /** L'heure de l'import (les tests la fixent). */
  maintenant?: Date;
  /** Restauration d'une sauvegarde : les demandes de dispos ne sont ni
      importées ni supprimées (sauf celles des compagnons supprimés, par
      cascade). */
  garderDemandes?: boolean;
}

export interface Rapport {
  aBlanc: boolean;
  miroir: boolean;
  source: { people: number; sites: number; affectations: number; avail: number };
  avant: Comptes;
  apres: Comptes;
  /** Fiches déjà en base, réécrites parce qu'elles ont changé (version + 1). */
  modifies: { people: string[]; sites: string[] };
  /** En miroir : ce que la source n'a plus, supprimé de la base. */
  supprimes: { people: string[]; sites: string[]; avail: string[] };
  /** En miroir : demandes absentes de la source, gardées parce que l'API
      les a déjà envoyées ou qu'un compagnon y a répondu. */
  demandesGardees: string[];
  /** Demandes dont le lien de la source ne marchera pas : l'API avait
      déjà diffusé le sien, qui est gardé. */
  jetonsNonImportes: string[];
  /** Identifiants que l'API refuserait : rien n'est écrit tant qu'il y en a. */
  identifiantsInvalides: string[];
  /** Même personne, même jour, deux chantiers : posée en urgence. */
  doublesEnUrgence: { chantier: string; jour: string; compagnon: string }[];
  /** Affectations dont le compagnon n'existe pas : ignorées. */
  orphelines: { chantier: string; jour: string; compagnon: string }[];
  /** Demandes de dispo dont le compagnon n'existe pas, ou au jeton inutilisable : ignorées. */
  demandesIgnorees: string[];
}

export class ImportRefuse extends Error {}

export async function compter(db: Db): Promise<Comptes> {
  const n = async (table: string): Promise<number> => {
    const [lignes] = await db.execute(sql.raw("SELECT COUNT(*) AS n FROM `" + table + "`")) as unknown as [{ n: number }[]];
    return Number(lignes[0].n);
  };
  return {
    people: await n("people"), sites: await n("sites"),
    assignments: await n("assignments"), avail_requests: await n("avail_requests")
  };
}

/* Une date « AAAA-MM-JJ HH:MM:SS.mmm » UTC pour MySQL, depuis un ISO. */
const versMysql = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString().replace("T", " ").replace("Z", "");
};

/* Une valeur rendue comparable : MySQL range les clés d'un objet JSON à
   sa façon, la source à la sienne. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable((v as Record<string, unknown>)[k])).join(",") + "}";
  return JSON.stringify(v);
}

/* La relance de Supabase partait le samedi à 07:00 UTC (supabase/cron.sql)
   pour la semaine du lundi suivant. Passé ce moment, une demande de
   cette semaine a reçu son e-mail : elle arrive « relancée », et la
   relance de l'API ne l'écrira pas une seconde fois. Avant, elle reste
   à relancer, comme Supabase l'aurait fait. */
function relanceeParSupabase(semaine: string, maintenant: Date): string | null {
  const samedi = new Date(semaine + "T07:00:00Z");
  samedi.setUTCDate(samedi.getUTCDate() - 2);
  return maintenant >= samedi ? versMysql(samedi.toISOString()) : null;
}

export async function importer(db: Db, entree: Donnees, o: OptionsImport = {}): Promise<Rapport> {
  const maintenant = o.maintenant ?? new Date();
  const miroir = !!o.miroir;
  /* On ne fait confiance à rien : tout repasse par la normalisation du
     domaine, qui borne chaque champ comme l'application le ferait. */
  const donnees = {
    people: entree.people.map(p => normPerson(p.id, p)),
    sites: entree.sites.map(s => normSite(s.id, s)),
    avail: entree.avail.map(a => normAvail(a.id, a))
  };
  /* normAvail ne garde que la forme du domaine : les dates d'origine
     sont mises de côté. */
  const origine = new Map(entree.avail.map(a => [a.id, { createdAt: a.createdAt ?? null, expiresAt: a.expiresAt ?? null }]));
  const connus = new Set(donnees.people.map(p => p.id));
  const importes = new Set(donnees.sites.map(s => s.id));

  const rapport: Rapport = {
    aBlanc: !!o.aBlanc, miroir,
    source: {
      people: donnees.people.length, sites: donnees.sites.length,
      affectations: donnees.sites.reduce((a, s) => a + Object.values(s.plan).reduce((b, ids) => b + ids.length, 0), 0),
      avail: donnees.avail.length
    },
    avant: await compter(db), apres: { people: 0, sites: 0, assignments: 0, avail_requests: 0 },
    modifies: { people: [], sites: [] },
    supprimes: { people: [], sites: [], avail: [] },
    demandesGardees: [], jetonsNonImportes: [], identifiantsInvalides: [],
    doublesEnUrgence: [], orphelines: [], demandesIgnorees: []
  };

  for (const id of [...connus, ...importes])
    if (!Identifiant.safeParse(id).success) rapport.identifiantsInvalides.push(id);

  /* ---------- ce que la base contient déjà ---------- */

  const compagnonsEnBase = await db.select().from(people);
  const chantiersEnBase = await db.select().from(sites);
  const demandesEnBase = await db.select({
    id: availRequests.id, token: availRequests.token, personId: availRequests.personId,
    sentAt: availRequests.sentAt, answeredAt: availRequests.answeredAt
  }).from(availRequests);

  const compagnonsSupprimes = miroir ? compagnonsEnBase.filter(l => !connus.has(l.id)).map(l => l.id) : [];
  const chantiersSupprimes = miroir ? chantiersEnBase.filter(l => !importes.has(l.id)).map(l => l.id) : [];
  rapport.supprimes.people = compagnonsSupprimes;
  rapport.supprimes.sites = chantiersSupprimes;

  /* Les fiches à créer, et celles qui ont changé. */
  const parIdCompagnon = new Map(compagnonsEnBase.map(l => [l.id, l]));
  const parIdChantier = new Map(chantiersEnBase.map(l => [l.id, l]));
  const compagnonsAEcrire = donnees.people.filter(p => {
    const l = parIdCompagnon.get(p.id);
    if (!l) return true;
    const change = stable(colonnesCompagnon(compagnonDeLigne(l))) !== stable(colonnesCompagnon(p));
    if (change) rapport.modifies.people.push(p.id);
    return change;
  });
  const chantiersAEcrire = donnees.sites.filter(s => {
    const l = parIdChantier.get(s.id);
    if (!l) return true;
    const change = stable(colonnesChantier(chantierDeLigne(l, []))) !== stable(colonnesChantier(s));
    if (change) rapport.modifies.sites.push(s.id);
    return change;
  });

  /* ---------- les affectations ---------- */

  /* Les affectations à écrire, et lesquelles passent en urgence. Une
     personne déjà posée ce jour-là sur un chantier que l'import ne
     réécrit pas (et ne supprime pas) est déjà occupée : sans cela, la
     contrainte de la base refuserait tout l'import. */
  const occupe = new Set<string>();                       // « jour#compagnon »
  if (!miroir) {
    const existantes = await db.select({ siteId: assignments.siteId, day: assignments.day, personId: assignments.personId })
      .from(assignments).where(sql`${assignments.occupe} = 1`);
    for (const e of existantes) if (!importes.has(e.siteId)) occupe.add(e.day + "#" + e.personId);
  }
  const lignesAffectation: (typeof assignments.$inferInsert)[] = [];
  for (const s of donnees.sites) {
    for (const jour of Object.keys(s.plan).sort()) {
      s.plan[jour].forEach((pid, position) => {
        if (!connus.has(pid)) { rapport.orphelines.push({ chantier: s.id, jour, compagnon: pid }); return; }
        const cle = jour + "#" + pid;
        const urgence = occupe.has(cle);
        if (urgence) rapport.doublesEnUrgence.push({ chantier: s.id, jour, compagnon: pid });
        occupe.add(cle);
        lignesAffectation.push({ siteId: s.id, day: jour, personId: pid, urgence, occupe: urgence ? null : 1, position });
      });
    }
  }

  /* ---------- les demandes de disponibilité ---------- */

  const demandes = donnees.avail.filter(a => {
    const ok = a.token && JETON_VALIDE.test(a.token) && a.week && connus.has(a.personId);
    if (!ok) rapport.demandesIgnorees.push(a.id);
    return ok;
  });
  const dansLaSource = new Set(demandes.map(a => a.id));
  const parIdDemande = new Map(demandesEnBase.map(l => [l.id, l]));

  /* Un lien que l'API a déjà diffusé (envoyé par la relance, ou déjà
     répondu) reste le bon : celui de la source ne marchera pas. */
  const diffusee = (l: { sentAt: string | null; answeredAt: string | null }): boolean => !!(l.sentAt || l.answeredAt);
  for (const a of demandes) {
    const l = parIdDemande.get(a.id);
    if (l && l.token !== a.token && diffusee(l)) rapport.jetonsNonImportes.push(a.id);
  }
  if (miroir && !o.garderDemandes) {
    const partis = new Set(compagnonsSupprimes);
    for (const l of demandesEnBase) {
      if (dansLaSource.has(l.id)) continue;
      if (!partis.has(l.personId) && diffusee(l)) rapport.demandesGardees.push(l.id);
      else rapport.supprimes.avail.push(l.id);
    }
  }

  if (o.aBlanc) { rapport.apres = rapport.avant; return rapport; }
  if (rapport.identifiantsInvalides.length)
    throw new ImportRefuse("Identifiants que l'API refuserait : " + rapport.identifiantsInvalides.join(", ")
      + ". Rien n'a été écrit. Corrigez-les dans la source, puis relancez.");

  /* ---------- l'écriture, en une transaction ---------- */

  await db.transaction(async tx => {
    /* En miroir, d'abord ce qui n'existe plus : les affectations et les
       demandes des fiches supprimées partent en cascade. */
    if (compagnonsSupprimes.length) await tx.delete(people).where(inArray(people.id, compagnonsSupprimes));
    if (chantiersSupprimes.length) await tx.delete(sites).where(inArray(sites.id, chantiersSupprimes));
    const demandesSupprimees = rapport.supprimes.avail.filter(id => !compagnonsSupprimes.includes(parIdDemande.get(id)!.personId));
    if (demandesSupprimees.length) await tx.delete(availRequests).where(inArray(availRequests.id, demandesSupprimees));

    /* Une fiche créée ici prend une milliseconde de plus que la
       précédente : GET /api/donnees rend les fiches dans l'ordre de leur
       création, et une sauvegarde restaurée doit garder le sien (l'ordre
       du vivier et des fiches de chantier en dépend). */
    const creeeA = (rang: number) => sql`TIMESTAMPADD(MICROSECOND, ${rang * 1000}, CURRENT_TIMESTAMP(3))`;
    for (const p of compagnonsAEcrire) {
      const valeurs = colonnesCompagnon(p);
      if (parIdCompagnon.has(p.id))
        await tx.update(people).set({ ...valeurs, version: sql`${people.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
          .where(sql`${people.id} = ${p.id}`);
      else await tx.insert(people).values({ id: p.id, ...valeurs, createdAt: creeeA(donnees.people.indexOf(p)) });
    }
    for (const s of chantiersAEcrire) {
      const valeurs = colonnesChantier(s);
      if (parIdChantier.has(s.id))
        await tx.update(sites).set({ ...valeurs, version: sql`${sites.version} + 1`, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
          .where(sql`${sites.id} = ${s.id}`);
      else await tx.insert(sites).values({ id: s.id, ...valeurs, createdAt: creeeA(donnees.sites.indexOf(s)) });
    }

    /* Le plan d'un chantier est réécrit en entier : c'est ce qui rend
       l'import rejouable sans doublon. */
    for (const s of donnees.sites) await tx.delete(assignments).where(sql`${assignments.siteId} = ${s.id}`);
    for (let i = 0; i < lignesAffectation.length; i += 500)
      await tx.insert(assignments).values(lignesAffectation.slice(i, i + 500));

    for (const a of demandes) {
      const d = origine.get(a.id);
      const creee = versMysql(d?.createdAt) ?? versMysql(maintenant.toISOString())!;
      /* L'échéance d'origine est gardée : un lien expiré dans Supabase
         reste expiré. Sans elle (fichier sans dates), 60 jours à partir de
         l'import, la règle de Supabase. */
      const expire = versMysql(d?.expiresAt)
        ?? versMysql(new Date(maintenant.getTime() + 60 * 24 * 3600 * 1000).toISOString())!;
      /* Rejouer l'import ne doit pas effacer une réponse plus récente,
         donnée entre-temps par le lien de l'API : la réponse en base est
         gardée si elle existe et n'est pas plus ancienne que celle de la
         source. */
      const garder = sql`(${availRequests.answeredAt} IS NOT NULL AND (VALUES(answered_at) IS NULL OR ${availRequests.answeredAt} >= VALUES(answered_at)))`;
      /* Le jeton de la source l'emporte, sauf si l'API a déjà diffusé le
         sien. Drizzle écrit les affectations dans l'ordre des colonnes de
         la table, et MySQL les évalue dans cet ordre : `token`, `days` et
         `note` passent avant `answered_at` et `sent_at`, et lisent donc
         leurs valeurs d'avant l'import. */
      const jetonDiffuse = sql`(${availRequests.sentAt} IS NOT NULL OR ${availRequests.answeredAt} IS NOT NULL)`;
      await tx.insert(availRequests).values({
        id: a.id, token: a.token, personId: a.personId, week: a.week,
        days: a.days, note: a.note, answeredAt: versMysql(a.answeredAt),
        createdAt: creee, expiresAt: expire, sentAt: relanceeParSupabase(a.week, maintenant)
      }).onDuplicateKeyUpdate({ set: {
        token: sql`IF(${jetonDiffuse}, ${availRequests.token}, VALUES(token))`,
        days: sql`IF(${garder}, ${availRequests.days}, VALUES(days))`,
        note: sql`IF(${garder}, ${availRequests.note}, VALUES(note))`,
        answeredAt: sql`IF(${garder}, ${availRequests.answeredAt}, VALUES(answered_at))`,
        expiresAt: sql`VALUES(expires_at)`,
        sentAt: sql`COALESCE(${availRequests.sentAt}, VALUES(sent_at))`
      } });
    }
  });

  rapport.apres = await compter(db);
  return rapport;
}
