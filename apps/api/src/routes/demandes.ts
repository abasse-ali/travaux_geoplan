/* ============================================================
   Demander les dispos : POST /api/dispos/demandes

   Geoffrey choisit des compagnons et une semaine ; l'API crée les
   demandes qui manquent et rend un lien par compagnon, qu'il envoie par
   SMS ou WhatsApp. Redemander est sans danger : une demande existante
   garde son jeton (le lien déjà envoyé reste bon) et sa réponse.

   Corps : { compagnonIds: string[], semaine: "AAAA-MM-JJ" (un lundi) }
   Réponse : [{ avail, url }], dans l'ordre des compagnonIds.
   ============================================================ */

import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../app.ts";
import { exigerSession } from "../auth/sessions.ts";
import { verifierOrigine } from "../http/origine.ts";
import { assurerDemandes, enAvail, erreurSansDonnees, lienDispo } from "../dispo/demandes.ts";
import { estLundi } from "../dispo/semaine.ts";

const Corps = z.object({
  compagnonIds: z.array(z.string().min(1).max(40)).min(1).max(500),
  semaine: z.string().refine(estLundi, "doit être un lundi, au format AAAA-MM-JJ")
});

export function demandes(deps: Deps): Router {
  const r = Router();

  r.post("/api/dispos/demandes", exigerSession(deps), verifierOrigine(deps.config.APP_ORIGIN),
    async (req, res, next) => {
      try {
        const { compagnonIds, semaine } = Corps.parse(req.body);
        const { demandes: lignes, creees } = await assurerDemandes(deps.db, compagnonIds, semaine);
        /* Seules les demandes nouvelles changent quelque chose pour les
           autres appareils ; redemander sans rien créer ne diffuse rien. */
        if (creees.length) deps.diffuser({ quoi: "avail", ids: creees });
        res.json(lignes.map(d => ({ avail: enAvail(d), url: lienDispo(deps.config.APP_ORIGIN, d.token) })));
      } catch (e) { next(erreurSansDonnees(e)); }
    });

  return r;
}
