/* ============================================================
   Connexion MySQL

   Un pool mysql2, en UTC, qui renvoie les DATE et DATETIME en chaînes :
   « 2026-09-16 » reste « 2026-09-16 », quel que soit le fuseau de la
   machine. C'est la même règle que le domaine, qui ne manipule que des
   dates ISO.
   ============================================================ */

import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import * as schema from "./schema.ts";

export type Db = MySql2Database<typeof schema>;

export interface Base {
  db: Db;
  pool: mysql.Pool;
  fermer: () => Promise<void>;
}

export function ouvrirBase(url: string): Base {
  const pool = mysql.createPool({
    uri: url,
    timezone: "Z",
    dateStrings: true,
    charset: "utf8mb4",
    connectionLimit: 10,
    waitForConnections: true
  });
  /* Une écriture ne touche que quelques lignes : attendre un verrou
     50 s (la valeur de MySQL) ne sert à rien, et, rejouée cinq fois,
     dépasserait la marque « en-cours » de l'idempotence (2 min) et le
     délai de nginx (30 s). 5 s, sur chaque connexion du pool, avant sa
     première requête (mysql2 exécute les commandes d'une connexion dans
     l'ordre). */
  pool.pool.on("connection", c => {
    c.query("SET SESSION innodb_lock_wait_timeout = " + ATTENTE_VERROU_S, () => { /* à défaut : 50 s */ });
  });
  const db = drizzle(pool, { schema, mode: "default" });
  return { db, pool, fermer: () => pool.end() };
}

/** L'attente maximale d'un verrou, en secondes, pour chaque connexion. */
export const ATTENTE_VERROU_S = 5;

/* Les migrations versionnées dans apps/api/drizzle. Drizzle tient le
   registre de ce qui est déjà passé : relancer ne fait rien.
   Elles tournent sur une connexion à elles, fermée ensuite : une
   migration suspend parfois les vérifications de clés étrangères (0001),
   et une connexion restée dans cet état ne doit jamais retourner servir
   les routes depuis le pool, même si la migration échoue en route. */
export async function migrer(url: string): Promise<void> {
  const connexion = await mysql.createConnection({ uri: url, timezone: "Z", dateStrings: true, charset: "utf8mb4" });
  try {
    await migrate(drizzle(connexion, { schema, mode: "default" }),
      { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  } finally {
    await connexion.end();
  }
}
