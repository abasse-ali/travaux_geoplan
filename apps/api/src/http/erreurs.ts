/* ============================================================
   Erreurs HTTP

   Une route lève une ErreurHttp ; le gestionnaire final la traduit en
   réponse JSON { erreur, message, … }. Toute autre exception devient
   un 500 dont le détail ne part que dans le journal, jamais au client.
   ============================================================ */

import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import type { Log } from "../log.ts";
import { erreurSansDonnees, masquerChemin } from "../log.ts";

/* Déplacée dans log.ts, où le sérialiseur des erreurs l'applique à tout
   ce qui part au journal ; gardée ici pour ses appelants. */
export { erreurSansDonnees };

export class ErreurHttp extends Error {
  readonly statut: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(statut: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.statut = statut;
    this.code = code;
    this.details = details;
  }
}

export const introuvable = (quoi: string): ErreurHttp =>
  new ErreurHttp(404, "introuvable", quoi + " introuvable");
export const nonConnecte = (): ErreurHttp =>
  new ErreurHttp(401, "non-connecte", "Connexion requise");
export const conflit = (message: string, details?: Record<string, unknown>): ErreurHttp =>
  new ErreurHttp(409, "conflit", message, details);

/* Les codes d'erreur MySQL qui ont un sens pour le client. */
const ER_DUP_ENTRY = 1062;
const ER_NO_REFERENCED_ROW = 1452;
const ER_CHECK_CONSTRAINT = 3819;

export function traduireErreurMysql(e: unknown): ErreurHttp | null {
  const errno = (e as { errno?: number; cause?: { errno?: number } })?.errno
    ?? (e as { cause?: { errno?: number } })?.cause?.errno;
  const texte = String((e as { message?: string; cause?: { message?: string } })?.cause?.message
    ?? (e as { message?: string })?.message ?? "");
  if (errno === ER_DUP_ENTRY && texte.includes("un_homme_un_jour"))
    return conflit("Ce compagnon est déjà posé ailleurs ce jour-là", { regle: "un-homme-un-jour" });
  if (errno === ER_DUP_ENTRY) return conflit("Cet enregistrement existe déjà");
  if (errno === ER_NO_REFERENCED_ROW) return new ErreurHttp(422, "reference", "Chantier ou compagnon inconnu");
  if (errno === ER_CHECK_CONSTRAINT) return new ErreurHttp(422, "invalide", "Affectation incohérente");
  return null;
}

/* Journal d'accès : une ligne par requête, jeton compagnon masqué. */
export function journalAcces(log: Log): RequestHandler {
  return (req, res, next) => {
    const t0 = performance.now();
    res.on("finish", () => {
      log.info({
        methode: req.method, chemin: masquerChemin(req.originalUrl), statut: res.statusCode,
        ms: Math.round(performance.now() - t0)
      }, "requête");
    });
    next();
  };
}

export function gestionnaireErreurs(log: Log): ErrorRequestHandler {
  return (e, req, res, _next) => {
    const http = e instanceof ErreurHttp ? e : traduireErreurMysql(e);
    if (http) {
      res.status(http.statut).json({ erreur: http.code, message: http.message, ...http.details });
      return;
    }
    if (e instanceof ZodError) {
      res.status(400).json({
        erreur: "requete-invalide", message: "Requête invalide",
        champs: e.issues.map(i => ({ chemin: i.path.join("."), message: i.message }))
      });
      return;
    }
    /* express.json() rejette un corps illisible avec un statut 400. */
    const statut = (e as { status?: number })?.status;
    if (statut && statut >= 400 && statut < 500) {
      res.status(statut).json({ erreur: "requete-invalide", message: "Requête invalide" });
      return;
    }
    /* Sans les valeurs de la requête : une panne de la base pendant une
       connexion ne doit pas écrire l'adresse tapée (ni le mot de passe
       tapé par erreur dans le champ adresse) au journal. */
    log.error({ err: erreurSansDonnees(e), chemin: masquerChemin(req.originalUrl) }, "erreur interne");
    res.status(500).json({ erreur: "interne", message: "Erreur interne" });
  };
}
