/* ============================================================
   Chantiers

   POST   /api/chantiers              { id, code?, addr?, start?, months?, coef?, note?, ph?, tasks? }
                                      → 201 fiche ; identifiant déjà pris → 409
   PATCH  /api/chantiers/:id          { version, code?, addr?, start?, months?, coef?, note? }
                                      → 200 fiche (version + 1)
                                      → 409 { erreur: "conflit", actuel } si la version a bougé
   DELETE /api/chantiers/:id          → 200 { supprime: id } (affectations en cascade)
   POST   /api/chantiers/:id/missions { etape, mission, faite }  → 200 fiche
   POST   /api/chantiers/:id/etapes   { etape, pourcentage }     → 200 fiche

   Une « fiche » a la forme de GET /api/donnees : Site du domaine,
   plus `version` et `urgences`.

   Cocher une mission, régler une étape : ce sont des OPÉRATIONS, sans
   version (ADR-003). « Cocher la mission 2 de l'étape 5 » garde son sens
   sur une fiche plus fraîche que celle que le client avait sous les
   yeux ; le rejeter pour une version périmée ne ferait que forcer le
   client à le renvoyer tel quel. On relit la ligne sous verrou, on
   applique la règle du domaine (setTask, setPhasePct), on écrit.
   Deux cochages simultanés sur le même chantier passent donc l'un après
   l'autre, et gardent les deux coches.
   ============================================================ */

import { Router, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { normSite, setTask, setPhasePct, PHASES, type Site } from "@geoplan/domain";
import type { Deps, Module } from "../app.ts";
import { assignments, sites } from "../db/schema.ts";
import { enTransaction, type Tx } from "../db/transaction.ts";
import { conflit, introuvable } from "../http/erreurs.ts";
import { Identifiant, Jour, Version, idDe } from "../http/validation.ts";
import { colonnesChantier, lireChantier, maintenant, verrouillerCompagnons, type FicheChantier } from "../donnees/fiches.ts";
import { normaliserUrgences, noterRetrait, nouveauSuivi } from "../donnees/affectations.ts";
import { annoncer, ecriture } from "./commun.ts";

const Champs = z.object({
  code: z.string(),
  addr: z.string(),
  start: Jour,
  months: z.number(),
  coef: z.number(),
  note: z.string()
}).partial();

/* À la création seulement, l'avancement et les coches peuvent venir
   avec la fiche (reprise d'une sauvegarde). Ensuite, ils ne changent
   que par /missions et /etapes : ce sont des opérations. Le plan, lui,
   ne passe jamais par ici — il vit dans les affectations. */
const Creation = Champs.extend({
  id: Identifiant,
  ph: z.array(z.number()).max(PHASES.length),
  tasks: z.record(z.string().regex(/^\d{1,2}$/), z.array(z.boolean()).max(20))
}).partial({ ph: true, tasks: true }).strict();

const Modification = Champs.extend({ version: Version }).strict()
  .refine(o => Object.keys(o).length > 1, "rien à modifier");

const Etape = z.number().int().min(0).max(PHASES.length - 1);

const Mission = z.object({ etape: Etape, mission: z.number().int().min(0), faite: z.boolean() }).strict()
  .refine(m => m.mission < (PHASES[m.etape]?.tasks.length ?? 0),
    { message: "cette étape n'a pas autant de missions", path: ["mission"] });

const Avancement = z.object({ etape: Etape, pourcentage: z.number().min(0).max(100) }).strict();

export const routesChantiers: Module = deps => {
  const r = Router();
  const ecrire = ecriture(deps);

  r.post("/api/chantiers", ...ecrire, async (req, res) => {
    const { id, ...champs } = Creation.parse(req.body);
    const fiche = await enTransaction(deps.db, async tx => {
      const s = normSite(id, champs as Partial<Site>);
      await tx.insert(sites).values({ id, ...colonnesChantier(s) });
      return (await lireChantier(tx, id))!;
    });
    annoncer(deps, res, { quoi: "site", ids: [id] });
    res.status(201).json(fiche);
  });

  r.patch("/api/chantiers/:id", ...ecrire, async (req, res) => {
    const id = idDe(req.params.id);
    const { version, ...champs } = Modification.parse(req.body);
    await modifier(deps, res, id, actuel => {
      if (actuel.version !== version)
        throw conflit("Ce chantier a été modifié entre-temps", { actuel });
      /* Correctif par champ, sur la fiche relue sous verrou ; normSite
         borne ce qui arrive (code à 20 caractères, durée 1 à 12 mois…). */
      return { ...normSite(id, { ...actuel, ...champs }), urgences: actuel.urgences, version: actuel.version };
    });
  });

  r.post("/api/chantiers/:id/missions", ...ecrire, async (req, res) => {
    const id = idDe(req.params.id);
    const { etape, mission, faite } = Mission.parse(req.body);
    await modifier(deps, res, id, s => {
      /* Exactement act.task de l'interface : la coche, puis l'avancement
         de l'étape qui s'en déduit. */
      s.ph[etape] = setTask(s, etape, mission, faite);
      return s;
    });
  });

  r.post("/api/chantiers/:id/etapes", ...ecrire, async (req, res) => {
    const id = idDe(req.params.id);
    const { etape, pourcentage } = Avancement.parse(req.body);
    await modifier(deps, res, id, s => {
      /* act.bar : régler la barre coche les N premières missions. */
      s.ph[etape] = setPhasePct(s, etape, pourcentage);
      return s;
    });
  });

  r.delete("/api/chantiers/:id", ...ecrire, async (req, res) => {
    const id = idDe(req.params.id);
    /* Les affectations partent en cascade. Qui était doublé ici en
       urgence ailleurs ne l'est plus : son urgence redevient normale. */
    const suivi = await enTransaction(deps.db, async tx => {
      if (!await lireChantier(tx, id, { verrou: true })) throw introuvable("Chantier");
      const lignes = await tx.select({ day: assignments.day, personId: assignments.personId })
        .from(assignments).where(eq(assignments.siteId, id));
      await verrouillerCompagnons(tx, lignes.map(l => l.personId));
      await tx.delete(sites).where(eq(sites.id, id));
      const suivi = nouveauSuivi();
      for (const l of lignes) noterRetrait(suivi, l.day, l.personId);
      await normaliserUrgences(tx, suivi);
      return suivi;
    });
    annoncer(deps, res, { quoi: "site", ids: [id] });
    if (suivi.modifie)
      annoncer(deps, res, { quoi: "assignments", ids: [...suivi.chantiers].sort(), jours: [...suivi.jours].sort() });
    res.json({ supprime: id });
  });

  return r;
};

/* Lire sous verrou, transformer, écrire avec version + 1, annoncer,
   répondre la fiche à jour. `transformer` peut lever (conflit de
   version) : la transaction est alors annulée, rien n'est écrit. */
async function modifier(deps: Deps, res: Response, id: string,
                        transformer: (actuel: FicheChantier) => FicheChantier): Promise<void> {
  const fiche = await enTransaction(deps.db, async (tx: Tx) => {
    const actuel = await lireChantier(tx, id, { verrou: true });
    if (!actuel) throw introuvable("Chantier");
    const s = transformer(actuel);
    const suivante = actuel.version + 1;
    await tx.update(sites)
      .set({ ...colonnesChantier(s), version: suivante, updatedAt: maintenant })
      .where(eq(sites.id, id));
    return { ...s, version: suivante };
  });
  annoncer(deps, res, { quoi: "site", ids: [id] });
  res.json(fiche);
}
