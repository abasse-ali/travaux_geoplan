/* ============================================================
   Affectations : des opérations, pas des états (ADR-001, ADR-003)

   POST /api/affectations/poser    { chantierId, jour, compagnonId, urgence }
   POST /api/affectations/retirer  { jour, compagnonId, chantierId? }
   PUT  /api/affectations/equipe   { chantierId, jour, compagnonIds, avant, urgence }
   POST /api/affectations/plan     { semaine, plan: { <chantierId>: { <jour>: [ids] } }, avant, urgence }

   Réponse, toujours : l'état à jour des chantiers touchés, pour les
   jours touchés — y compris les chantiers d'où quelqu'un a été retiré
   pour être posé ailleurs :

     { chantiers: { <sid>: { plan: { <jour>: [ids] }, urgences: { <jour>: [ids] } } } }

   Pas de version : rejouer « pose P sur S le jour J » sur une donnée
   plus fraîche a toujours un sens. Chaque opération verrouille ses
   chantiers puis ses compagnons, et s'exécute dans une transaction ;
   la contrainte `un_homme_un_jour` tranche en dernier ressort (409).

   « Remplacer l'équipe » et « Appliquer ce plan » disent un état, pas
   un geste : un appareil en retard (file hors ligne, écran pas encore
   rafraîchi) effacerait ce qu'un autre a posé entre-temps. Ils portent
   donc `avant`, l'équipe que l'appareil voyait, et le serveur n'écrit
   que l'écart entre `avant` et l'équipe voulue (fusion à trois voies,
   fusionnerEquipe dans le domaine). Rejouer reste sans effet.
   ============================================================ */

import { Router, type Response } from "express";
import { z } from "zod";
import { normSite, weekDates } from "@geoplan/domain";
import { fusionnerEquipe, fusionnerPlan } from "@geoplan/domain/operations";
import type { Deps, Module } from "../app.ts";
import { enTransaction, type Tx } from "../db/transaction.ts";
import { Identifiant, Jour, Lundi } from "../http/validation.ts";
import { etatDes, verrouillerChantiers, verrouillerCompagnons } from "../donnees/fiches.ts";
import {
  equipeActuelle, normaliserUrgences, nouveauSuivi, poser, remplacerEquipe, retirer, type Suivi
} from "../donnees/affectations.ts";
import { annoncer, ecriture } from "./commun.ts";

/* Une équipe de chantier compte quelques personnes ; une centaine est
   déjà absurde. La borne protège la transaction, pas le métier. */
const Equipe = z.array(Identifiant).max(100);

const Poser = z.object({
  chantierId: Identifiant, jour: Jour, compagnonId: Identifiant, urgence: z.boolean()
}).strict();

/* `chantierId` absent ou nul : retiré de tous ses chantiers ce jour-là
   (retour au vivier), comme l'opération `retirer` du domaine. */
const Retirer = z.object({
  jour: Jour, compagnonId: Identifiant, chantierId: Identifiant.nullish()
}).strict();

const RemplacerEquipe = z.object({
  chantierId: Identifiant, jour: Jour, compagnonIds: Equipe, avant: Equipe, urgence: z.boolean()
}).strict();

const Semaine = z.record(Identifiant, z.record(Jour, Equipe));

/* `avant` cite exactement les chantiers du plan : un chantier du plan
   sans équipe vue ferait passer tout ce qu'il porte pour l'œuvre d'un
   autre appareil, et rien n'y serait retiré. */
const Plan = z.object({
  semaine: Lundi, plan: Semaine, avant: Semaine, urgence: z.boolean()
}).strict().superRefine((o, ctx) => {
  const jours = new Set(weekDates(o.semaine));
  const chantiers = Object.keys(o.plan);
  if (chantiers.length > 200)
    ctx.addIssue({ code: "custom", path: ["plan"], message: "trop de chantiers" });
  const vus = Object.keys(o.avant);
  if (vus.length !== chantiers.length || vus.some(sid => !(sid in o.plan)))
    ctx.addIssue({ code: "custom", path: ["avant"], message: "doit citer exactement les chantiers du plan" });
  for (const [champ, semaine] of [["plan", o.plan], ["avant", o.avant]] as const)
    for (const sid of Object.keys(semaine))
      for (const j of Object.keys(semaine[sid]))
        if (!jours.has(j))
          ctx.addIssue({ code: "custom", path: [champ, sid, j], message: "ce jour n'est pas dans la semaine" });
});

export const routesAffectations: Module = deps => {
  const r = Router();
  const ecrire = ecriture(deps);

  r.post("/api/affectations/poser", ...ecrire, async (req, res) => {
    const o = Poser.parse(req.body);
    await operer(deps, res, async (tx, suivi) => {
      await verrouillerChantiers(tx, [o.chantierId]);
      await verrouillerCompagnons(tx, [o.compagnonId]);
      await poser(tx, suivi, o.chantierId, o.jour, o.compagnonId, o.urgence);
    });
  });

  r.post("/api/affectations/retirer", ...ecrire, async (req, res) => {
    const o = Retirer.parse(req.body);
    await operer(deps, res, async (tx, suivi) => {
      if (o.chantierId) await verrouillerChantiers(tx, [o.chantierId]);
      await verrouillerCompagnons(tx, [o.compagnonId]);
      await retirer(tx, suivi, o.jour, o.compagnonId, o.chantierId ?? undefined);
    });
  });

  r.put("/api/affectations/equipe", ...ecrire, async (req, res) => {
    const o = RemplacerEquipe.parse(req.body);
    await operer(deps, res, async (tx, suivi) => {
      await verrouillerChantiers(tx, [o.chantierId]);
      await verrouillerCompagnons(tx, o.compagnonIds);
      const actuelle = await equipeActuelle(tx, o.chantierId, o.jour);
      await remplacerEquipe(tx, suivi, o.chantierId, o.jour,
        fusionnerEquipe(o.avant, o.compagnonIds, actuelle), o.urgence);
    });
  });

  /* « Appliquer ce plan » de « Répartir toute l'équipe » (act.applyPlan) :
     pour chaque chantier cité et CHAQUE jour de la semaine, l'équipe
     devient celle du plan — un jour absent du plan est vidé, comme dans
     l'interface. Hors urgence, chacun est d'abord retiré de ses autres
     chantiers ce jour-là : personne n'est jamais doublé. La fusion se
     calcule sur l'état d'avant le geste, comme dans le domaine. */
  r.post("/api/affectations/plan", ...ecrire, async (req, res) => {
    const o = Plan.parse(req.body);
    const jours = weekDates(o.semaine);
    const chantiers = Object.keys(o.plan);
    const tous = chantiers.flatMap(sid => Object.values(o.plan[sid]).flat());
    await operer(deps, res, async (tx, suivi) => {
      await verrouillerChantiers(tx, chantiers);
      await verrouillerCompagnons(tx, tous);
      const vus = (await etatDes(tx, chantiers, jours)).chantiers;
      const fusion = fusionnerPlan(chantiers.map(sid => normSite(sid, { plan: vus[sid].plan })),
                                   o.semaine, o.plan, o.avant);
      for (const sid of chantiers)
        for (const j of jours)
          await remplacerEquipe(tx, suivi, sid, j, fusion[sid][j], o.urgence, o.plan[sid][j] || []);
    });
  });

  return r;
};

/* La transaction d'une opération, puis sa réponse et son annonce. Le
   suivi est recréé à chaque essai : une transaction rejouée après un
   interblocage repart de zéro. */
async function operer(deps: Deps, res: Response,
                      geste: (tx: Tx, suivi: Suivi) => Promise<void>): Promise<void> {
  const { suivi, etat } = await enTransaction(deps.db, async tx => {
    const suivi = nouveauSuivi();
    await geste(tx, suivi);
    await normaliserUrgences(tx, suivi);
    return { suivi, etat: await etatDes(tx, suivi.chantiers, suivi.jours) };
  });
  if (suivi.modifie) annoncer(deps, res, {
    quoi: "assignments",
    ids: [...suivi.chantiers].sort(),
    jours: [...suivi.jours].sort()
  });
  res.json(etat);
}
