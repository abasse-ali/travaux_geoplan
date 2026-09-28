/* ============================================================
   Qui a le droit d'écrire (ADR-002)

   Le cookie de session est SameSite=Lax : un site tiers ne peut pas le
   joindre à un POST. Seconde barrière, sans jeton CSRF à gérer côté
   client : toute requête qui modifie doit porter un en-tête Origin égal
   à l'origine de l'application. Les navigateurs l'envoient d'eux-mêmes
   sur tout POST, PUT, PATCH et DELETE.
   ============================================================ */

import type { RequestHandler } from "express";
import { ErreurHttp } from "./erreurs.ts";

const LECTURES = new Set(["GET", "HEAD", "OPTIONS"]);

export function verifierOrigine(origineAttendue: string): RequestHandler {
  return (req, _res, next) => {
    if (LECTURES.has(req.method)) return next();
    const origine = req.headers.origin;
    if (origine !== origineAttendue)
      return next(new ErreurHttp(403, "origine", "Origine refusée"));
    next();
  };
}
