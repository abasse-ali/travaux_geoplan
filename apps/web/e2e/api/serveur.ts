/* ============================================================
   L'API de W3, lancée pour les tests de bout en bout de la source api

   Un vrai MySQL 8.4 et un vrai Redis 7.4 dans des conteneurs jetables
   (testcontainers), migrés, puis la vraie application Express avec son
   temps réel : exactement ce que servira le VPS, moins nginx. Le serveur
   de développement de Vite relaie /api et /socket.io jusqu'ici (voir
   e2e/vite.config.ts) : pour le navigateur, tout vient de la même
   origine, comme en production.

   Les tests amorcent la base eux-mêmes (e2e/api/amorcer.ts), avec les
   adresses que ce script écrit dans e2e/.api-e2e.json.

   Lancé par Playwright (playwright.config.ts), avec Node 24 qui exécute
   ce TypeScript tel quel.
   ============================================================ */

import { rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { MySqlContainer } from "@testcontainers/mysql";
import { RedisContainer } from "@testcontainers/redis";
import { createApp, type Changement, type Deps } from "../../../api/src/app.ts";
import { lireConfig } from "../../../api/src/config.ts";
import { migrer, ouvrirBase } from "../../../api/src/db/client.ts";
import { ouvrirRedis } from "../../../api/src/redis.ts";
import { creerLog } from "../../../api/src/log.ts";
import { MODULES } from "../../../api/src/modules.ts";
import { brancherTempsReel } from "../../../api/src/temps-reel.ts";

const PORT = Number(process.env.GEOPLAN_E2E_API_PORT);
const ORIGINE = String(process.env.GEOPLAN_E2E_API_ORIGIN);
const FICHIER = new URL("../.api-e2e.json", import.meta.url);

const mysql = await new MySqlContainer("mysql:8.4")
  .withDatabase("geoplan").withUsername("geoplan")
  .withUserPassword("geoplan-essai").withRootPassword("racine-essai")
  .start();
const redisConteneur = await new RedisContainer("redis:7.4-alpine").start();
const DATABASE_URL = mysql.getConnectionUri();
const REDIS_URL = redisConteneur.getConnectionUrl();
await migrer(DATABASE_URL);

const config = lireConfig({
  NODE_ENV: "test", DATABASE_URL, REDIS_URL, APP_ORIGIN: ORIGINE,
  RAPPEL_ACTIF: "false", TRUST_PROXY: "1", LOG_LEVEL: "warn"
});
const base = ouvrirBase(DATABASE_URL);
const redis = ouvrirRedis(REDIS_URL);
let diffuser: (c: Changement) => void = () => {};
const deps: Deps = { config, db: base.db, redis, log: creerLog("warn"), diffuser: c => diffuser(c) };
const serveur = createServer(createApp(deps, MODULES));
const temps = await brancherTempsReel(serveur, deps);
diffuser = temps.diffuser;
await new Promise<void>(ok => serveur.listen(PORT, "127.0.0.1", () => ok()));
writeFileSync(FICHIER, JSON.stringify({ DATABASE_URL, REDIS_URL }));
console.log("API de test prête sur le port " + PORT);

/* Playwright arrête ce processus à la fin ; testcontainers retire les
   conteneurs de toute façon quand il disparaît (conteneur Ryuk). */
const arreter = async (): Promise<void> => {
  try { rmSync(FICHIER); } catch { /* déjà retiré */ }
  await temps.fermer().catch(() => {});
  await base.fermer().catch(() => {});
  redis.disconnect();
  await redisConteneur.stop().catch(() => {});
  await mysql.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", () => void arreter());
process.on("SIGINT", () => void arreter());
