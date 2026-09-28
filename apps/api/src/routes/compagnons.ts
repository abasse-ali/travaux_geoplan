/* ============================================================
   Compagnons

   POST   /api/compagnons       { id, name?, phone?, email?, days?, permis?, sk?, note? }
                                → 201 fiche ; identifiant déjà pris → 409
   PATCH  /api/compagnons/:id   { version, …champs }
                                → 200 fiche (version + 1)
                                → 409 { erreur: "conflit", actuel } si la version a bougé
   DELETE /api/compagnons/:id   → 200 { supprime: id } ; ses affectations et
                                  demandes partent en cascade (clés étrangères)

   L'identifiant vient du client : un compagnon créé hors ligne l'a déjà
   avant d'atteindre le serveur (ADR-001). La normalisation — nom borné,
   téléphone au format international, niveaux ramenés entre 1 et 5 —
   est celle du domaine, normPerson.
   ============================================================ */

import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { normPerson, SK, type Person } from "@geoplan/domain";
import type { Module } from "../app.ts";
import { people, assignments } from "../db/schema.ts";
import { enTransaction } from "../db/transaction.ts";
import { conflit, introuvable } from "../http/erreurs.ts";
import { Identifiant, Version, idDe } from "../http/validation.ts";
import { colonnesCompagnon, lireCompagnon, maintenant } from "../donnees/fiches.ts";
import { annoncer, ecriture } from "./commun.ts";

/* Un correctif de niveaux ne cite que les métiers qu'il change : les
   autres gardent leur valeur (voir la fusion dans PATCH). */
const Niveaux = z.partialRecord(z.enum(SK), z.number());

const Champs = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  days: z.array(z.boolean()).max(7),
  permis: z.boolean(),
  sk: Niveaux,
  note: z.string()
}).partial();

const Creation = Champs.extend({ id: Identifiant }).strict();
const Modification = Champs.extend({ version: Version }).strict()
  .refine(o => Object.keys(o).length > 1, "rien à modifier");

export const routesCompagnons: Module = deps => {
  const r = Router();
  const ecrire = ecriture(deps);

  r.post("/api/compagnons", ...ecrire, async (req, res) => {
    const { id, ...champs } = Creation.parse(req.body);
    const fiche = await enTransaction(deps.db, async tx => {
      const p = normPerson(id, champs as Partial<Person>);
      /* Identifiant déjà pris : l'index primaire refuse, et
         traduireErreurMysql en fait un 409. */
      await tx.insert(people).values({ id, ...colonnesCompagnon(p) });
      return (await lireCompagnon(tx, id))!;
    });
    annoncer(deps, res, { quoi: "person", ids: [id] });
    res.status(201).json(fiche);
  });

  r.patch("/api/compagnons/:id", ...ecrire, async (req, res) => {
    const id = idDe(req.params.id);
    const { version, ...champs } = Modification.parse(req.body);
    const fiche = await enTransaction(deps.db, async tx => {
      const actuel = await lireCompagnon(tx, id, { verrou: true });
      if (!actuel) throw introuvable("Compagnon");
      if (actuel.version !== version)
        throw conflit("Ce compagnon a été modifié entre-temps", { actuel });
      /* Correctif par champ : seuls les champs envoyés changent, sur la
         fiche relue sous verrou. Les niveaux se fusionnent métier par
         métier, pour qu'un correctif « électricité 4 » ne remette pas
         les quatre autres à 1. */
      const p = normPerson(id, { ...actuel, ...champs, sk: { ...actuel.sk, ...champs.sk } });
      const suivante = actuel.version + 1;
      await tx.update(people)
        .set({ ...colonnesCompagnon(p), version: suivante, updatedAt: maintenant })
        .where(eq(people.id, id));
      return { ...p, version: suivante };
    });
    annoncer(deps, res, { quoi: "person", ids: [id] });
    res.json(fiche);
  });

  r.delete("/api/compagnons/:id", ...ecrire, async (req, res) => {
    const id = idDe(req.params.id);
    const touchees = await enTransaction(deps.db, async tx => {
      if (!await lireCompagnon(tx, id, { verrou: true })) throw introuvable("Compagnon");
      /* Ce que la cascade va effacer, pour prévenir les écrans qui
         affichent ces journées. */
      const aff = await tx.select({ siteId: assignments.siteId, day: assignments.day })
        .from(assignments).where(eq(assignments.personId, id));
      await tx.delete(people).where(eq(people.id, id));
      return aff;
    });
    annoncer(deps, res, { quoi: "person", ids: [id] });
    if (touchees.length) annoncer(deps, res, {
      quoi: "assignments",
      ids: [...new Set(touchees.map(a => a.siteId))].sort(),
      jours: [...new Set(touchees.map(a => a.day))].sort()
    });
    res.json({ supprime: id });
  });

  return r;
};
