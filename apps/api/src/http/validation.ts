/* ============================================================
   Ce que l'API accepte en entrée

   Zod ne vérifie ici que la FORME : un identifiant est un identifiant,
   une date est une vraie date, un niveau est un nombre. Les bornes du
   métier (nom tronqué à 60 caractères, niveau ramené entre 1 et 5,
   coefficient entre 0,3 et 3…) restent celles du domaine, appliquées
   par normPerson et normSite : les écrire une seconde fois ici, c'est
   se préparer deux vérités qui divergeront.

   Une entrée refusée lève une ZodError, que le gestionnaire d'erreurs
   traduit en 400 avec la liste des champs fautifs.
   ============================================================ */

import { z } from "zod";
import { mondayOf } from "@geoplan/domain";

/* Les identifiants sont fournis par le client (création hors ligne,
   ADR-001) : on n'accepte que ce qu'un identifiant existant peut
   contenir, et rien qui puisse se glisser dans une clé Redis ou un
   journal de façon ambiguë. */
export const Identifiant = z.string().regex(/^[A-Za-z0-9_@.-]{1,40}$/, "identifiant invalide");

/* « 2026-02-30 » a la bonne forme mais n'existe pas. MySQL la refuserait
   en mode strict, ou la ramènerait à 0000-00-00 sinon : on la refuse
   avant, par un aller-retour dans le calendrier. La plage est celle du
   type DATE de MySQL. */
export function dateReelle(s: string): boolean {
  const [a, m, j] = s.split("-").map(Number);
  if (a < 1000 || a > 9999) return false;
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

export const Jour = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date attendue au format AAAA-MM-JJ")
  .refine(dateReelle, "cette date n'existe pas");

/* Une semaine se désigne par son lundi, comme dans le domaine. C'est le
   domaine qui dit ce qu'est un lundi (mondayOf). */
export const Lundi = Jour.refine(s => mondayOf(s) === s, "une semaine se désigne par son lundi");

/* Le numéro de version lu par le client, pour le verrou optimiste. */
export const Version = z.number().int().min(1);

/** Lit un paramètre de chemin qui doit être un identifiant. */
export const idDe = (v: unknown): string => Identifiant.parse(v);
