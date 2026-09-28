/* ============================================================
   Le lien compagnon : GET et POST /api/dispo/:jeton

   Sans compte ni session : le jeton est la clé, et il n'ouvre qu'une
   ligne. La page ne reçoit que ce qu'elle affiche — le prénom, la
   semaine, la réponse déjà donnée — sous la forme qu'attendait
   avail_get (apps/web/src/dispo.tsx).

   Un jeton inconnu, expiré ou mal formé reçoit la MÊME réponse 404 :
   rien ne distingue un lien qui a existé d'un lien inventé.

   Limitation de débit (ADR-002), lecture et réponse confondues : 60
   requêtes par IP et par minute, 20 par jeton et par minute.
   ============================================================ */

import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NDAYS } from "@geoplan/domain";
import type { Deps } from "../app.ts";
import { availRequests, people } from "../db/schema.ts";
import { introuvable } from "../http/erreurs.ts";
import { cleIp, limiter } from "../http/limites.ts";
import { verifierOrigine } from "../http/origine.ts";
import {
  JETON_VALIDE, MAINTENANT_UTC, NON_EXPIREE, empreinteJeton, erreurSansDonnees, prenom
} from "../dispo/demandes.ts";

const NOTE_MAX = 300;

const Reponse = z.object({
  days: z.array(z.boolean()).length(NDAYS),
  note: z.string().optional()
});

/* La note est bornée en caractères, comme la colonne varchar(300) :
   Array.from compte un emoji pour un, et ne le coupe pas en deux. La
   page tronquait déjà à 300 ; une note plus longue venue d'ailleurs est
   tronquée plutôt que refusée, comme le faisait avail_set. */
const tronquer = (s: string, n: number): string => Array.from(s).slice(0, n).join("");

export function dispo(deps: Deps): Router {
  const r = Router();
  const chemin = "/api/dispo/:jeton";
  const parIp = limiter(deps.redis, "dispo-ip", 60, 60, cleIp);
  const parJeton = limiter(deps.redis, "dispo-jeton", 20, 60,
    req => empreinteJeton(String(req.params.jeton)));

  /** La demande ouverte par ce jeton, si elle existe et n'a pas expiré. */
  async function demande(jeton: string) {
    if (!JETON_VALIDE.test(jeton)) return null;
    const [d] = await deps.db
      .select({
        id: availRequests.id, token: availRequests.token, week: availRequests.week,
        days: availRequests.days, note: availRequests.note, answeredAt: availRequests.answeredAt,
        nom: people.name
      })
      .from(availRequests)
      .innerJoin(people, eq(people.id, availRequests.personId))
      .where(and(eq(availRequests.token, jeton), NON_EXPIREE))
      .limit(1);
    /* La colonne compare sans tenir compte de la casse (collation par
       défaut) : un jeton base64url n'est égal qu'à lui-même. */
    return d && d.token === jeton ? d : null;
  }

  r.get(chemin, parIp, parJeton, async (req, res, next) => {
    try {
      const d = await demande(String(req.params.jeton));
      if (!d) return next(introuvable("Demande"));
      res.set("Cache-Control", "no-store");
      res.json({
        name: prenom(d.nom), week: d.week, days: d.days ?? null,
        note: d.note, answered: d.answeredAt !== null
      });
    } catch (e) { next(erreurSansDonnees(e)); }
  });

  r.post(chemin, parIp, parJeton, verifierOrigine(deps.config.APP_ORIGIN), async (req, res, next) => {
    try {
      const d = await demande(String(req.params.jeton));
      if (!d) return next(introuvable("Demande"));
      const { days, note } = Reponse.parse(req.body);
      await deps.db.update(availRequests)
        .set({ days, note: tronquer(note ?? "", NOTE_MAX), answeredAt: MAINTENANT_UTC })
        .where(eq(availRequests.id, d.id));
      deps.log.info({ demande: d.id }, "réponse d'un compagnon");
      /* L'écran de Geoffrey voit la réponse arriver sans recharger. */
      deps.diffuser({ quoi: "avail", ids: [d.id] });
      res.set("Cache-Control", "no-store");
      res.json({ ok: true });
    } catch (e) { next(erreurSansDonnees(e)); }
  });

  return r;
}
