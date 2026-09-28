/* ============================================================
   Tout ce que l'écran affiche, en une fois

   GET /api/donnees
     { people: (Person & { version })[],
       sites:  (Site & { version, urgences: { <jour>: [pid] } })[],
       avail:  Avail[] }

   La forme du domaine, inchangée : le plan d'un chantier est recomposé
   depuis les affectations (ADR-001), dans l'ordre des puces, urgences
   comprises. Lu dans un seul instantané, pour qu'aucune affectation ne
   désigne un chantier ou un compagnon absent de la réponse.

   PUT /api/donnees   { people, sites }  → 200, la même forme que GET
     « Remplacer les données » (Données › Restaurer) : la base devient la
     sauvegarde. Ce qu'elle n'a pas disparaît, ce qu'elle a est réécrit
     (version + 1 pour une fiche qui change), dans une transaction, par
     l'importeur en miroir. Les demandes de dispos des compagnons gardés
     ne sont pas touchées : un lien déjà envoyé reste bon. Un identifiant
     que l'API refuserait fait tout refuser (400), rien n'est écrit.
   ============================================================ */

import { Router } from "express";
import { z } from "zod";
import type { Person, Site } from "@geoplan/domain";
import type { Module } from "../app.ts";
import { enLecture } from "../db/transaction.ts";
import { lireTout } from "../donnees/fiches.ts";
import { ErreurHttp } from "../http/erreurs.ts";
import { ImportRefuse, importer } from "../migration/importer.ts";
import { annoncer, ecriture, garde } from "./commun.ts";

/* Une fiche : un objet avec un identifiant. Tout le reste est borné par
   la normalisation du domaine, dans l'importeur. */
const Fiche = z.object({ id: z.string().min(1).max(40) }).passthrough();
const Restauration = z.object({
  people: z.array(Fiche).max(2000),
  sites: z.array(Fiche).max(2000)
}).strict();

export const routesDonnees: Module = deps => {
  const r = Router();
  r.get("/api/donnees", ...garde(deps), async (_req, res) => {
    const donnees = await enLecture(deps.db, lireTout);
    /* Des données privées : aucun intermédiaire ne doit les garder. */
    res.setHeader("Cache-Control", "no-store");
    res.json(donnees);
  });

  r.put("/api/donnees", ...ecriture(deps), async (req, res) => {
    const { people, sites } = Restauration.parse(req.body);
    try {
      await importer(deps.db, { people: people as unknown as Person[], sites: sites as unknown as Site[], avail: [] },
        { miroir: true, garderDemandes: true });
    } catch (e) {
      if (e instanceof ImportRefuse) throw new ErreurHttp(400, "requete-invalide", e.message);
      throw e;
    }
    annoncer(deps, res, { quoi: "tout" });
    res.setHeader("Cache-Control", "no-store");
    res.json(await enLecture(deps.db, lireTout));
  });
  return r;
};
