/* ============================================================
   Sessions (ADR-002)

   L'identifiant de session est 32 octets aléatoires, en base64url, posé
   dans un cookie httpOnly. Redis ne connaît que son EMPREINTE SHA-256 :
   une copie de Redis ne donne aucune session utilisable.

   Durée glissante de 180 jours : chaque requête authentifiée repousse
   l'échéance, au plus une fois par heure. Geoffrey se connecte une fois
   dans la PWA de son iPhone, et n'a plus à y penser.

     sess:<empreinte>          → JSON { userId, email, creeLe, vuLe }  (TTL 180 j)
     sessions-de:<userId>      → ensemble des empreintes, pour tout révoquer
                                 (TTL repoussé avec celui de ses sessions)

   Toute session supprimée ou révoquée est annoncée sur le canal Redis
   « sessions-revoquees » : le temps réel coupe aussitôt les connexions
   ouvertes avec elle, dans chaque processus API.

   Une session ne vaut que si son compte existe encore : un compte
   supprimé (compte supprimer, ou à la main en SQL) emporte ses sessions.
   ============================================================ */

import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { RequestHandler, Response } from "express";
import type { Redis } from "../redis.ts";
import type { Deps } from "../app.ts";
import type { Db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { lireCookies } from "../http/cookies.ts";
import { nonConnecte } from "../http/erreurs.ts";

export const COOKIE = "geoplan_sid";
export const DUREE_S = 180 * 24 * 3600;
const PROLONGER_APRES_S = 3600;

export interface Session { userId: string; email: string; creeLe: number; vuLe: number }

/** Le canal où s'annoncent les empreintes des sessions supprimées. */
export const CANAL_REVOCATIONS = "sessions-revoquees";

/** Ce que les routes trouvent dans res.locals une fois la session vérifiée. */
export interface Utilisateur { id: string; email: string }

export const empreinte = (id: string): string => createHash("sha256").update(id).digest("hex");
const cle = (id: string): string => "sess:" + empreinte(id);

export async function creerSession(redis: Redis, u: Utilisateur): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  const maintenant = Date.now();
  const s: Session = { userId: u.id, email: u.email, creeLe: maintenant, vuLe: maintenant };
  await redis.multi()
    .set(cle(id), JSON.stringify(s), "EX", DUREE_S)
    .sadd("sessions-de:" + u.id, empreinte(id))
    .expire("sessions-de:" + u.id, DUREE_S)
    .exec();
  return id;
}

/** Relit une session et, si elle n'a pas été vue depuis une heure,
    repousse son échéance. Rend null si elle n'existe pas ou plus.
    `prolongee` dit à l'appelant de reposer le cookie : c'est ce qui rend
    les 180 jours vraiment glissants côté navigateur aussi. */
export async function lireSession(redis: Redis, id: string): Promise<(Session & { prolongee: boolean }) | null> {
  if (!id || id.length > 100) return null;
  const brut = await redis.get(cle(id));
  if (!brut) return null;
  const s = JSON.parse(brut) as Session;
  const maintenant = Date.now();
  if (maintenant - s.vuLe > PROLONGER_APRES_S * 1000) {
    s.vuLe = maintenant;
    /* XX : seulement si la clé existe encore. Une révocation passée
       entre la lecture et cette écriture ne doit pas être défaite. */
    const ok = await redis.set(cle(id), JSON.stringify(s), "EX", DUREE_S, "XX");
    if (ok === null) return null;
    /* L'ensemble des sessions du compte vit au moins aussi longtemps que
       chacune d'elles : sinon une révocation en oublierait. */
    await redis.expire("sessions-de:" + s.userId, DUREE_S);
    return { ...s, prolongee: true };
  }
  return { ...s, prolongee: false };
}

export async function supprimerSession(redis: Redis, id: string): Promise<void> {
  const brut = await redis.get(cle(id));
  await redis.del(cle(id));
  if (brut) await redis.srem("sessions-de:" + (JSON.parse(brut) as Session).userId, empreinte(id));
  await redis.publish(CANAL_REVOCATIONS, empreinte(id));
}

/** Toutes les sessions d'un compte : après un changement de mot de passe.
    Seules les empreintes lues sont retirées de l'ensemble : une session
    ouverte pendant la révocation y reste inscrite, révocable. */
export async function revoquerSessions(redis: Redis, userId: string): Promise<number> {
  const empreintes = await redis.smembers("sessions-de:" + userId);
  if (!empreintes.length) return 0;
  await redis.del(...empreintes.map(e => "sess:" + e));
  await redis.srem("sessions-de:" + userId, ...empreintes);
  for (const e of empreintes) await redis.publish(CANAL_REVOCATIONS, e);
  return empreintes.length;
}

/** La session d'empreinte `e` vit-elle encore, et son compte existe-t-il ?
    Pour le temps réel, qui ne garde que l'empreinte de sa session. */
export async function empreinteValide(deps: { redis: Redis; db: Db }, e: string): Promise<boolean> {
  const brut = await deps.redis.get("sess:" + e);
  if (!brut) return false;
  const { userId } = JSON.parse(brut) as Session;
  const [compte] = await deps.db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return !!compte;
}

/** Une session vivante, dont le compte existe encore. Celle d'un compte
    supprimé est effacée au passage : elle ne servira plus. */
export async function sessionValide(deps: { redis: Redis; db: Db }, id: string):
    Promise<(Session & { prolongee: boolean }) | null> {
  const s = await lireSession(deps.redis, id);
  if (!s) return null;
  const [compte] = await deps.db.select({ id: users.id }).from(users).where(eq(users.id, s.userId)).limit(1);
  if (compte) return s;
  await supprimerSession(deps.redis, id);
  return null;
}

/* Le cookie. Secure partout sauf en test (http sur 127.0.0.1) ; même
   origine que l'application, d'où SameSite=Lax et Path=/. Posé par le
   serveur : WebKit ne le plafonne pas à 7 jours, contrairement à un
   cookie écrit en JavaScript. */
export function poserCookie(res: Response, id: string, secure: boolean): void {
  res.cookie(COOKIE, id, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: DUREE_S * 1000 });
}
export function effacerCookie(res: Response, secure: boolean): void {
  res.clearCookie(COOKIE, { httpOnly: true, secure, sameSite: "lax", path: "/" });
}

/** Les routes qui exigent une session. Pose res.locals.utilisateur. */
export function exigerSession(deps: Deps): RequestHandler {
  return async (req, res, next) => {
    try {
      const id = lireCookies(req.headers.cookie)[COOKIE] || "";
      const s = await sessionValide(deps, id);
      if (!s) return next(nonConnecte());
      if (s.prolongee) poserCookie(res, id, deps.config.NODE_ENV === "production");
      res.locals.utilisateur = { id: s.userId, email: s.email } satisfies Utilisateur;
      res.locals.sessionId = id;
      next();
    } catch (e) { next(e); }
  };
}
