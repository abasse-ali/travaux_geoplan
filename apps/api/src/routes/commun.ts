/* Ce que partagent les routes de données : la garde (session, puis
   origine), l'idempotence sur les écritures, et l'annonce aux autres
   appareils une fois la transaction validée. */

import type { RequestHandler, Response } from "express";
import type { Changement, Deps } from "../app.ts";
import { exigerSession } from "../auth/sessions.ts";
import { verifierOrigine } from "../http/origine.ts";
import { idempotence } from "../http/idempotence.ts";

/* Les modules sont montés à la racine de l'application : un
   `router.use(exigerSession)` s'appliquerait aussi aux routes des AUTRES
   modules (connexion, lien compagnon). La garde se pose donc route par
   route. */
export function garde(deps: Deps): RequestHandler[] {
  return [exigerSession(deps), verifierOrigine(deps.config.APP_ORIGIN)];
}

export function ecriture(deps: Deps): RequestHandler[] {
  return [...garde(deps), idempotence(deps)];
}

/** Annonce un changement validé. Une diffusion qui échoue ne doit jamais
    faire échouer une écriture déjà enregistrée : on la journalise, et
    les autres appareils se rattraperont à leur prochaine relecture. */
export function annoncer(deps: Deps, res: Response, c: Omit<Changement, "mutation">): void {
  const mutation = res.locals.mutation as string | undefined;
  try { deps.diffuser(mutation ? { ...c, mutation } : c); }
  catch (e) { deps.log.warn({ err: e, quoi: c.quoi }, "diffusion impossible"); }
}
