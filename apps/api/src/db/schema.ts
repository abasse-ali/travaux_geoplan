/* ============================================================
   Le schéma MySQL (ADR-001)

   Les objets-valeurs du domaine — niveaux, jours, avancement, coches —
   sont des colonnes JSON : ils se lisent et s'écrivent toujours en
   entier, et le domaine (normPerson, normSite) en fixe la forme.

   Les affectations, elles, ont leur table : c'est là que vit la règle
   « un homme, un chantier, par jour ». La base l'applique elle-même,
   par une contrainte d'unicité que seule une affectation d'urgence
   explicite peut lever.

   Dates : `date` et `datetime` en chaînes, lues telles que la base les
   stocke (la connexion est en UTC et renvoie des chaînes). Aucune
   conversion par un objet Date, qui décalerait un jour selon le fuseau.
   ============================================================ */

import { sql } from "drizzle-orm";
import {
  mysqlTable, varchar, json, boolean, int, tinyint, smallint, double, date, datetime,
  primaryKey, uniqueIndex, index, check
} from "drizzle-orm/mysql-core";
import type { Levels } from "@geoplan/domain";

const maintenant = sql`CURRENT_TIMESTAMP(3)`;
const horodatage = (nom: string) => datetime(nom, { mode: "string", fsp: 3 });

/* ---------- comptes ---------- */

export const users = mysqlTable("users", {
  id: varchar("id", { length: 40 }).primaryKey(),
  email: varchar("email", { length: 120 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  createdAt: horodatage("created_at").notNull().default(maintenant),
  updatedAt: horodatage("updated_at").notNull().default(maintenant)
});

/* ---------- compagnons ---------- */

export const people = mysqlTable("people", {
  id: varchar("id", { length: 40 }).primaryKey(),
  name: varchar("name", { length: 60 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull().default(""),
  email: varchar("email", { length: 120 }).notNull().default(""),
  days: json("days").$type<boolean[]>().notNull(),         // sept cases, lundi en tête
  permis: boolean("permis").notNull().default(false),
  sk: json("sk").$type<Levels>().notNull(),
  note: varchar("note", { length: 300 }).notNull().default(""),
  version: int("version").notNull().default(1),              // verrou optimiste (ADR-003)
  createdAt: horodatage("created_at").notNull().default(maintenant),
  updatedAt: horodatage("updated_at").notNull().default(maintenant)
});

/* ---------- chantiers ---------- */

export const sites = mysqlTable("sites", {
  id: varchar("id", { length: 40 }).primaryKey(),
  code: varchar("code", { length: 20 }).notNull(),
  addr: varchar("addr", { length: 120 }).notNull().default(""),
  startDate: date("start_date", { mode: "string" }).notNull(),
  months: tinyint("months").notNull(),
  coef: double("coef").notNull(),
  ph: json("ph").$type<number[]>().notNull(),               // douze pourcentages
  note: varchar("note", { length: 2000 }).notNull().default(""),
  tasks: json("tasks").$type<Record<string, boolean[]>>().notNull(),
  version: int("version").notNull().default(1),
  createdAt: horodatage("created_at").notNull().default(maintenant),
  updatedAt: horodatage("updated_at").notNull().default(maintenant)
}, t => [
  index("sites_par_debut").on(t.startDate)
]);

/* ---------- affectations ----------
   `occupe` vaut 1 quand la personne occupe sa journée, NULL pour une
   affectation d'urgence. MySQL n'applique pas l'unicité entre valeurs
   NULL : l'urgence échappe donc à la règle, et à elle seule. La
   contrainte CHECK garde `occupe` et `urgence` d'accord. (Une colonne
   générée aurait été plus courte, mais MySQL interdit alors la
   suppression en cascade sur person_id.) */

export const assignments = mysqlTable("assignments", {
  siteId: varchar("site_id", { length: 40 }).notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  day: date("day", { mode: "string" }).notNull(),
  personId: varchar("person_id", { length: 40 }).notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  urgence: boolean("urgence").notNull().default(false),
  occupe: tinyint("occupe"),
  position: smallint("position").notNull(),                  // ordre des puces dans la zone
  createdAt: horodatage("created_at").notNull().default(maintenant)
}, t => [
  primaryKey({ name: "assignments_pk", columns: [t.siteId, t.day, t.personId] }),
  uniqueIndex("un_homme_un_jour").on(t.day, t.personId, t.occupe),
  index("affectations_par_jour").on(t.day),
  index("affectations_par_personne").on(t.personId),
  /* coalesce : une contrainte CHECK dont l’expression vaut NULL est tenue
     pour satisfaite. Sans lui, une affectation « normale » avec occupe à
     NULL passait, et échappait en silence à la règle (le test l’a montré). */
  check("urgence_explicite", sql`(${t.urgence} = 1 and ${t.occupe} is null) or (${t.urgence} = 0 and coalesce(${t.occupe}, 0) = 1)`)
]);

/* ---------- demandes de disponibilité ----------
   Une ligne par compagnon et par semaine. Le jeton du lien est la seule
   clé du compagnon : 32 octets aléatoires, soit 256 bits. `sent_at`
   rend la relance du samedi idempotente : ce qui est parti ne repart
   pas. */

export const availRequests = mysqlTable("avail_requests", {
  id: varchar("id", { length: 60 }).primaryKey(),            // « <person_id>@<lundi> »
  token: varchar("token", { length: 64 }).notNull().unique(),
  personId: varchar("person_id", { length: 40 }).notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  week: date("week", { mode: "string" }).notNull(),
  days: json("days").$type<boolean[] | null>(),              // null : pas encore répondu
  note: varchar("note", { length: 300 }).notNull().default(""),
  createdAt: horodatage("created_at").notNull().default(maintenant),
  expiresAt: horodatage("expires_at").notNull(),
  answeredAt: horodatage("answered_at"),
  sentAt: horodatage("sent_at")
}, t => [
  uniqueIndex("une_demande_par_semaine").on(t.personId, t.week),
  index("demandes_par_semaine").on(t.week)
]);

/* ---------- tâches planifiées ----------
   Le bilan de chaque exécution de la relance du samedi, pour pouvoir
   répondre à « est-ce parti ? » sans fouiller les journaux. */

export const jobRuns = mysqlTable("job_runs", {
  id: int("id").autoincrement().primaryKey(),
  job: varchar("job", { length: 40 }).notNull(),
  cle: varchar("cle", { length: 60 }).notNull(),             // la semaine visée
  aBlanc: boolean("a_blanc").notNull(),
  startedAt: horodatage("started_at").notNull().default(maintenant),
  finishedAt: horodatage("finished_at"),
  bilan: json("bilan").$type<Record<string, unknown>>()
}, t => [
  index("taches_par_cle").on(t.job, t.cle)
]);
