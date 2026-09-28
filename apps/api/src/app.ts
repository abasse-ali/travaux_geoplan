/* ============================================================
   L'application Express

   createApp reçoit tout ce dont elle dépend (base, Redis, journal,
   configuration, diffusion temps réel) : les tests montent la même
   application que la production, sur de vrais MySQL et Redis.

   Les routes sont montées par domaine : santé, session, données,
   affectations, disponibilités. Chaque domaine vit dans src/routes/.
   ============================================================ */

import express, { type Express, type Router } from "express";
import { sql } from "drizzle-orm";
import type { Config } from "./config.ts";
import type { Db } from "./db/client.ts";
import type { Redis } from "./redis.ts";
import type { Log } from "./log.ts";
import { gestionnaireErreurs, journalAcces } from "./http/erreurs.ts";

/** Ce qu'une route peut annoncer aux autres appareils après une écriture
    réussie (ADR-003). Branché sur Socket.IO en production ; un tableau
    en test. */
export interface Changement {
  /** « tout » : une restauration a tout remplacé. */
  quoi: "site" | "person" | "assignments" | "avail" | "tout";
  ids?: string[];
  jours?: string[];
  mutation?: string;           // identifiant de la mutation qui l'a causé
}
export type Diffuser = (c: Changement) => void;

export interface Deps {
  config: Config;
  db: Db;
  redis: Redis;
  log: Log;
  diffuser: Diffuser;
}

/** Un domaine de routes : il reçoit les dépendances et rend son routeur. */
export type Module = (deps: Deps) => Router;

export function createApp(deps: Deps, modules: Module[] = []): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", deps.config.TRUST_PROXY);
  app.use(journalAcces(deps.log));
  /* 256 ko suffisent à tout geste. Seule la restauration d'une sauvegarde
     (PUT /api/donnees) porte toutes les données : 1 Mo, la limite de
     nginx (client_max_body_size). */
  const json = express.json({ limit: "256kb" });
  const jsonRestauration = express.json({ limit: "1mb" });
  app.use((req, res, next) =>
    (req.method === "PUT" && req.path === "/api/donnees" ? jsonRestauration : json)(req, res, next));

  /* État des dépendances, pour nginx, docker compose et la surveillance.
     Ne révèle rien d'autre que « ça répond » ou « ça ne répond pas ». */
  app.get("/api/health", async (_req, res) => {
    const etat = { mysql: false, redis: false };
    try { await deps.db.execute(sql`select 1`); etat.mysql = true; } catch { /* rapporté ci-dessous */ }
    try { etat.redis = (await deps.redis.ping()) === "PONG"; } catch { /* rapporté ci-dessous */ }
    const ok = etat.mysql && etat.redis;
    res.status(ok ? 200 : 503).json({ ok, ...etat });
  });

  for (const m of modules) app.use(m(deps));

  app.use("/api", (_req, res) => { res.status(404).json({ erreur: "introuvable", message: "Route inconnue" }); });
  app.use(gestionnaireErreurs(deps.log));
  return app;
}
