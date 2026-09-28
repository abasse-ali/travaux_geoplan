/* ============================================================
   Outils partagés des tests de l'API

   monterApp() démarre la vraie application Express sur un port libre,
   branchée sur le MySQL et le Redis du banc d'essai. Les changements
   annoncés aux autres appareils sont recueillis dans `changements`.
   ============================================================ */

import { inject } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp, type Changement, type Deps, type Module } from "../src/app.ts";
import { lireConfig, type Config } from "../src/config.ts";
import { ouvrirBase, type Base } from "../src/db/client.ts";
import { ouvrirRedis, type Redis } from "../src/redis.ts";
import { creerLog } from "../src/log.ts";
import { creerSession, COOKIE } from "../src/auth/sessions.ts";
import { users } from "../src/db/schema.ts";

export const ORIGINE = "http://geoplan.test";

export function configEssai(plus: Record<string, string> = {}): Config {
  return lireConfig({
    NODE_ENV: "test",
    DATABASE_URL: inject("DATABASE_URL"),
    REDIS_URL: inject("REDIS_URL"),
    APP_ORIGIN: ORIGINE,
    ...plus
  });
}

/* Les tables, enfants d'abord. */
const TABLES = ["assignments", "avail_requests", "job_runs", "sites", "people", "users"];

export async function vider(base: Base, redis: Redis): Promise<void> {
  const c = await base.pool.getConnection();
  try {
    await c.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of TABLES) await c.query("TRUNCATE TABLE `" + t + "`");
  } finally {
    /* Toujours rétablies avant de rendre la connexion au pool. */
    await c.query("SET FOREIGN_KEY_CHECKS = 1");
    c.release();
  }
  await redis.flushdb();
}

export interface AppEssai {
  url: string;
  deps: Deps;
  base: Base;
  redis: Redis;
  changements: Changement[];
  fermer: () => Promise<void>;
}

export async function monterApp(modules: Module[] = [], plus: Record<string, string> = {}): Promise<AppEssai> {
  const config = configEssai(plus);
  const base = ouvrirBase(config.DATABASE_URL);
  const redis = ouvrirRedis(config.REDIS_URL);
  const changements: Changement[] = [];
  const deps: Deps = {
    config, db: base.db, redis,
    log: creerLog("silent"),
    diffuser: c => { changements.push(c); }
  };
  const app = createApp(deps, modules);
  const serveur: Server = await new Promise(ok => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  const { port } = serveur.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    deps, base, redis, changements,
    fermer: async () => {
      await new Promise<void>(ok => serveur.close(() => ok()));
      await base.fermer();
      redis.disconnect();
    }
  };
}

/* ---------- appels authentifiés ---------- */


/** Un compte et une session ouverte, sans passer par /api/session :
    les routes métier se testent sans dépendre de la connexion. */
export async function sessionEssai(app: AppEssai, email = "geoffrey@geoplan.test"): Promise<string> {
  const id = "u_" + email.split("@")[0];
  await app.deps.db.insert(users).values({ id, email, passwordHash: "sans-objet" })
    .onDuplicateKeyUpdate({ set: { email } });
  const sid = await creerSession(app.redis, { id, email });
  return COOKIE + "=" + sid;
}

export interface Reponse { statut: number; corps: any; entetes: Headers }

/** Un appel à l'API comme le ferait le navigateur de l'application :
    même origine, cookie de session s'il y en a un, JSON. */
export async function appel(app: AppEssai, methode: string, chemin: string,
                            o: { corps?: unknown; cookie?: string; origine?: string | null; entetes?: Record<string, string> } = {}): Promise<Reponse> {
  const entetes: Record<string, string> = { ...o.entetes };
  if (o.corps !== undefined) entetes["content-type"] = "application/json";
  if (o.cookie) entetes.cookie = o.cookie;
  if (o.origine !== null) entetes.origin = o.origine ?? ORIGINE;
  const r = await fetch(app.url + chemin, {
    method: methode, headers: entetes,
    body: o.corps === undefined ? undefined : JSON.stringify(o.corps)
  });
  const texte = await r.text();
  let corps: unknown = texte;
  try { corps = texte ? JSON.parse(texte) : null; } catch { /* corps non JSON : gardé tel quel */ }
  return { statut: r.status, corps, entetes: r.headers };
}
