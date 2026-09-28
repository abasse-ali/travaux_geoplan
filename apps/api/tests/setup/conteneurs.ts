/* ============================================================
   Le banc d'essai de l'API : un vrai MySQL 8.4 et un vrai Redis 7.4

   Lancés une fois pour toute la suite, dans des conteneurs jetables
   (testcontainers), puis migrés. Les tests reçoivent les adresses par
   `inject`. Une contrainte d'unicité, un verrou ou une transaction ne
   se vérifient pas sur une base simulée : c'est tout l'intérêt.

   Pour réutiliser des services déjà lancés (docker compose, CI) :
     GEOPLAN_TEST_DATABASE_URL=mysql://… GEOPLAN_TEST_REDIS_URL=redis://…
   ============================================================ */

import type { TestProject } from "vitest/node";
import { MySqlContainer, type StartedMySqlContainer } from "@testcontainers/mysql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { migrer } from "../../src/db/client.ts";

declare module "vitest" {
  export interface ProvidedContext {
    DATABASE_URL: string;
    REDIS_URL: string;
  }
}

export default async function preparer(projet: TestProject): Promise<() => Promise<void>> {
  let mysql: StartedMySqlContainer | null = null;
  let redis: StartedRedisContainer | null = null;

  let DATABASE_URL = process.env.GEOPLAN_TEST_DATABASE_URL || "";
  let REDIS_URL = process.env.GEOPLAN_TEST_REDIS_URL || "";

  if (!DATABASE_URL) {
    mysql = await new MySqlContainer("mysql:8.4")
      .withDatabase("geoplan")
      .withUsername("geoplan")
      .withUserPassword("geoplan-essai")
      .withRootPassword("racine-essai")
      .start();
    DATABASE_URL = mysql.getConnectionUri();
  }
  if (!REDIS_URL) {
    redis = await new RedisContainer("redis:7.4-alpine").start();
    REDIS_URL = redis.getConnectionUrl();
  }

  await migrer(DATABASE_URL);

  projet.provide("DATABASE_URL", DATABASE_URL);
  projet.provide("REDIS_URL", REDIS_URL);

  return async () => {
    await redis?.stop();
    await mysql?.stop();
  };
}
