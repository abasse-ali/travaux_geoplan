/* ============================================================
   Amorcer la base de l'API avant un test de bout en bout

   Ce que openLocal fait pour la source locale (remplir le cache du
   navigateur), ceci le fait pour la source api : la base est vidée,
   l'effectif du test y est écrit par l'importeur de W3 (la même
   normalisation que tout le reste), un compte et une session sont
   créés. Le test reçoit le cookie de session : il ouvre l'application
   déjà connecté, comme Geoffrey tous les matins.

   Les tests de la source api tournent l'un après l'autre : ils
   partagent une base.
   ============================================================ */

import { readFileSync } from "node:fs";
import type { Avail, Person, Site } from "@geoplan/domain";
import { ouvrirBase, type Base } from "../../../api/src/db/client.ts";
import { ouvrirRedis, type Redis } from "../../../api/src/redis.ts";
import { importer } from "../../../api/src/migration/importer.ts";
import { creerSession, COOKIE } from "../../../api/src/auth/sessions.ts";
import { hacher } from "../../../api/src/auth/motdepasse.ts";
import { users } from "../../../api/src/db/schema.ts";

export const EMAIL_E2E = "geoffrey@geoplan.test";

let liaison: { base: Base; redis: Redis } | null = null;

function lier(): { base: Base; redis: Redis } {
  if (liaison) return liaison;
  const { DATABASE_URL, REDIS_URL } = JSON.parse(
    readFileSync(new URL("../.api-e2e.json", import.meta.url), "utf8")) as { DATABASE_URL: string; REDIS_URL: string };
  liaison = { base: ouvrirBase(DATABASE_URL), redis: ouvrirRedis(REDIS_URL) };
  return liaison;
}

const TABLES = ["assignments", "avail_requests", "job_runs", "sites", "people", "users"];

export interface OptionsAmorce {
  /** Un vrai mot de passe pour le compte (sinon, il ne sert pas). */
  motDePasse?: string;
  /** Ne pas ouvrir de session : la page s'ouvre sur l'écran de connexion. */
  sansSession?: boolean;
}

/** Vide la base et Redis (sessions, limites, idempotence), puis écrit
    l'effectif. Rend le cookie de session, s'il y en a une. */
export async function amorcerApi(d: { people: Person[]; sites: Site[]; avail: Avail[] },
                                 o: OptionsAmorce = {}): Promise<{ nom: string; valeur: string } | null> {
  const { base, redis } = lier();
  const c = await base.pool.getConnection();
  try {
    await c.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of TABLES) await c.query("TRUNCATE TABLE `" + t + "`");
  } finally {
    await c.query("SET FOREIGN_KEY_CHECKS = 1");
    c.release();
  }
  await redis.flushdb();
  /* Les jetons de démonstration des tests sont courts ; l'API n'en
     accepte pas de moins de 16 caractères. Ils ne servent pas de lien
     ici : on les allonge. */
  const avail = d.avail.map(a => ({ ...a, token: a.token.length >= 16 ? a.token : a.token.padEnd(16, "0") }));
  await importer(base.db, { people: d.people, sites: d.sites, avail });
  await base.db.insert(users).values({
    id: "u_geoffrey", email: EMAIL_E2E, passwordHash: o.motDePasse ? await hacher(o.motDePasse) : "sans-objet"
  });
  if (o.sansSession) return null;
  return { nom: COOKIE, valeur: await creerSession(redis, { id: "u_geoffrey", email: EMAIL_E2E }) };
}

/** Écrire dans la base comme le ferait un autre appareil (ou une panne). */
export const ecrireBase = lireBase;

/** Ce que contient la base, pour les tests qui vérifient côté serveur. */
export async function lireBase(requete: string, valeurs: unknown[] = []): Promise<unknown[]> {
  const [lignes] = await lier().base.pool.query(requete, valeurs);
  return lignes as unknown[];
}
