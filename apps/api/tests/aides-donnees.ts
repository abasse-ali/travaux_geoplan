/* ============================================================
   Aides des tests de données, d'affectation et de temps réel

   Les données de départ s'écrivent directement en SQL, normalisées par
   le domaine : un test de route ne doit pas dépendre d'une AUTRE route
   pour préparer son terrain.
   ============================================================ */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { asc } from "drizzle-orm";
import { io as connecter, type Socket } from "socket.io-client";
import { normPerson, normSite, type Person, type Site } from "@geoplan/domain";
import { createApp, type Changement, type Deps } from "../src/app.ts";
import { ouvrirBase } from "../src/db/client.ts";
import { ouvrirRedis } from "../src/redis.ts";
import { creerLog } from "../src/log.ts";
import { MODULES } from "../src/modules.ts";
import { brancherTempsReel, CHEMIN, EVENEMENT } from "../src/temps-reel.ts";
import { people, sites, assignments } from "../src/db/schema.ts";
import { colonnesChantier, colonnesCompagnon } from "../src/donnees/fiches.ts";
import { configEssai, monterApp, ORIGINE, type AppEssai } from "./aides.ts";

/* La semaine des tests : du lundi 14 au dimanche 20 septembre 2026. */
export const LUNDI = "2026-09-14";
export const MARDI = "2026-09-15";
export const MERCREDI = "2026-09-16";

/** L'application avec toutes les routes de données. */
export const monterDonnees = (): Promise<AppEssai> => monterApp(MODULES);

/** La même, sur un vrai serveur HTTP partagé avec Socket.IO, comme en
    production (server.ts) : les annonces partent vers les sockets ET
    sont recueillies dans `changements`. */
export async function monterAvecTempsReel(o: { verifierToutesLesMs?: number } = {}): Promise<AppEssai> {
  const config = configEssai();
  const base = ouvrirBase(config.DATABASE_URL);
  const redis = ouvrirRedis(config.REDIS_URL);
  const changements: Changement[] = [];
  let vers: (c: Changement) => void = () => {};
  const deps: Deps = {
    config, db: base.db, redis, log: creerLog("silent"),
    diffuser: c => { changements.push(c); vers(c); }
  };
  const serveur = createServer(createApp(deps, MODULES));
  const temps = await brancherTempsReel(serveur, deps, o);
  vers = temps.diffuser;
  await new Promise<void>(ok => serveur.listen(0, "127.0.0.1", () => ok()));
  const { port } = serveur.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    deps, base, redis, changements,
    fermer: async () => {
      await temps.fermer();                 // ferme aussi le serveur HTTP
      await base.fermer();
      redis.disconnect();
    }
  };
}

/* ---------- données de départ ---------- */

export async function compagnon(app: AppEssai, id: string, champs: Partial<Person> = {}): Promise<Person> {
  const p = normPerson(id, { name: id.replace(/^p_/, ""), ...champs });
  await app.deps.db.insert(people).values({ id, ...colonnesCompagnon(p) });
  return p;
}

export async function chantier(app: AppEssai, id: string, champs: Partial<Site> = {}): Promise<Site> {
  const s = normSite(id, { code: id.replace(/^s_/, "").toUpperCase(), start: LUNDI, ...champs });
  await app.deps.db.insert(sites).values({ id, ...colonnesChantier(s) });
  return s;
}

/** Une affectation écrite directement, comme l'aurait laissée un autre appareil. */
export async function poserSql(app: AppEssai, sid: string, jour: string, pid: string,
                               urgence = false, position = 0): Promise<void> {
  await app.deps.db.insert(assignments).values({
    siteId: sid, day: jour, personId: pid, urgence, occupe: urgence ? null : 1, position
  });
}

export interface Affectation { siteId: string; day: string; personId: string; urgence: boolean }

/** Toutes les affectations en base, dans un ordre stable. */
export function affectations(app: AppEssai): Promise<Affectation[]> {
  return app.deps.db.select({
    siteId: assignments.siteId, day: assignments.day,
    personId: assignments.personId, urgence: assignments.urgence
  }).from(assignments).orderBy(asc(assignments.day), asc(assignments.siteId),
    asc(assignments.position), asc(assignments.personId));
}

/* ---------- temps réel ---------- */

/** Un appareil connecté au temps réel. Rejette avec le message du
    serveur si la connexion est refusée. */
export function socket(app: AppEssai, o: { cookie?: string; origine?: string } = {}): Promise<Socket> {
  const entetes: Record<string, string> = { origin: o.origine ?? ORIGINE };
  if (o.cookie) entetes.cookie = o.cookie;
  const s = connecter(app.url, {
    path: CHEMIN, transports: ["websocket"], extraHeaders: entetes,
    reconnection: false, forceNew: true, timeout: 5000
  });
  return new Promise((ok, ko) => {
    s.once("connect", () => ok(s));
    s.once("connect_error", e => { s.close(); ko(e); });
  });
}

/** Le prochain « changement » reçu, et l'instant de sa réception. */
export function prochainChangement(s: Socket, delaiMs = 3000): Promise<{ c: Changement; recuA: number }> {
  return new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error("aucun changement reçu en " + delaiMs + " ms")), delaiMs);
    s.once(EVENEMENT, (c: Changement) => { clearTimeout(t); ok({ c, recuA: performance.now() }); });
  });
}
