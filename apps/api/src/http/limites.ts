/* ============================================================
   Limitation de débit (ADR-002)

   Compteur à fenêtre fixe dans Redis : INCR, puis EXPIRE au premier
   passage. Une dizaine de lignes, pas de bibliothèque. Au-delà de la
   limite : 429 avec Retry-After.
   ============================================================ */

import { createHash } from "node:crypto";
import { isIPv6 } from "node:net";
import type { Request, RequestHandler } from "express";
import type { Redis } from "../redis.ts";
import { ErreurHttp } from "./erreurs.ts";

export interface Decompte { depasse: boolean; restant: number; reessayerDans: number }

/** Compte un passage de plus pour `cle` ; dit si la limite est dépassée. */
export async function compter(redis: Redis, cle: string, max: number, fenetreS: number): Promise<Decompte> {
  const k = "limite:" + cle;
  const [[, n], [, ttl]] = (await redis.multi().incr(k).ttl(k).exec()) as [[null, number], [null, number]];
  if (ttl < 0) await redis.expire(k, fenetreS);
  return { depasse: n > max, restant: Math.max(0, max - n), reessayerDans: ttl > 0 ? ttl : fenetreS };
}

/* Rend un passage compté à tort (une connexion réussie ne doit pas
   compter comme un échec). Si la fenêtre a expiré entre-temps, la clé
   n'est pas recréée : elle resterait sans échéance. */
const RENDRE = `if redis.call("exists", KEYS[1]) == 1 then return redis.call("decr", KEYS[1]) end return 0`;
export async function rendre(redis: Redis, cle: string): Promise<void> {
  await redis.eval(RENDRE, 1, "limite:" + cle);
}

export function tropDeRequetes(reessayerDans: number): ErreurHttp {
  return new ErreurHttp(429, "trop-de-requetes", "Trop de tentatives, réessayez plus tard",
    { reessayerDans });
}

/** Un limiteur par clé calculée sur la requête (adresse IP, jeton…). */
export function limiter(redis: Redis, nom: string, max: number, fenetreS: number,
                        cleDe: (req: Request) => string): RequestHandler {
  return async (req, res, next) => {
    try {
      const d = await compter(redis, nom + ":" + cleDe(req), max, fenetreS);
      if (d.depasse) {
        res.setHeader("Retry-After", String(d.reessayerDans));
        return next(tropDeRequetes(d.reessayerDans));
      }
      next();
    } catch (e) { next(e); }
  };
}

/* L'adresse du client, telle que nginx la transmet (Express ne fait
   confiance qu'au nombre de mandataires déclaré dans TRUST_PROXY). */
export const adresseIp = (req: Request): string => req.ip || "inconnue";

/**
 * Le réseau d'une adresse, pour compter les essais. Une adresse IPv4
 * compte seule. Une adresse IPv6 compte pour son préfixe /64 : un
 * abonné en reçoit un entier, et changer d'adresse dedans ne coûte rien.
 */
export function reseauDe(ip: string): string {
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1]!;
  const brute = ip.split("%")[0]!;
  if (!isIPv6(brute)) return ip;
  const groupes = (s: string): string[] => (s ? s.split(":") : []);
  /* Une IPv4 en fin d'adresse (::1.2.3.4) tient la place de deux groupes. */
  const largeur = (g: string[]): number => g.length + (g.at(-1)?.includes(".") ? 1 : 0);
  const [tete, queue] = brute.split("::") as [string, string | undefined];
  const debut = groupes(tete);
  const tous = queue === undefined ? debut
    : [...debut, ...Array<string>(8 - largeur(debut) - largeur(groupes(queue))).fill("0"), ...groupes(queue)];
  return tous.slice(0, 4).map(h => parseInt(h, 16).toString(16)).join(":") + "::/64";
}

/** La clé de limitation par adresse : son réseau. */
export const cleIp = (req: Request): string => reseauDe(adresseIp(req));

/** Une clé de limitation tirée de ce que le client a tapé : son
    empreinte, jamais le texte. Dans le champ de l'adresse, on tape
    parfois son mot de passe ; une copie de Redis ne doit pas le livrer. */
export const empreinteSaisie = (texte: string): string =>
  createHash("sha256").update(texte).digest("hex");
