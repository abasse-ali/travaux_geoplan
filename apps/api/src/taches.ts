/* ============================================================
   Les tâches planifiées de l'API : la relance du samedi

   croner, dans le fuseau RAPPEL_TZ : « samedi 9 h » reste 9 h à Paris
   l'hiver comme l'été. Le pg_cron d'avant comptait en UTC et partait à
   8 h l'hiver (constat P3).

   `protect` empêche un lancement de chevaucher le précédent dans ce
   processus ; le verrou Redis de lancerRappel fait de même entre
   plusieurs processus.

   À blanc tant que MAIL_MODE n'est pas « brevo » : la tâche tourne,
   calcule et journalise, mais n'envoie rien.
   ============================================================ */

import { Cron } from "croner";
import type { Deps } from "./app.ts";
import { lancerRappel } from "./taches/rappel.ts";
import { erreurSansDonnees } from "./dispo/demandes.ts";

export interface Taches {
  /** Arrête le planificateur et attend la fin d'une relance en cours :
      l'interrompre entre un envoi et l'écriture de sent_at renverrait
      l'e-mail au prochain passage. */
  arreter: () => Promise<void>;
  /** Le planificateur de la relance, s'il est actif (RAPPEL_ACTIF). */
  rappel: Cron | null;
}

export function planifierTaches(deps: Deps): Taches {
  const { config, log } = deps;
  if (!config.RAPPEL_ACTIF) {
    log.info("relance du samedi désactivée (RAPPEL_ACTIF)");
    return { arreter: async () => {}, rappel: null };
  }

  const aBlanc = config.MAIL_MODE !== "brevo";
  let enCours: Promise<void> | null = null;
  const rappel = new Cron(config.RAPPEL_CRON, { timezone: config.RAPPEL_TZ, protect: true }, async () => {
    enCours = (async () => {
      try { await lancerRappel(deps, { aBlanc }); }
      catch (e) { log.error({ err: erreurSansDonnees(e) }, "relance du samedi en échec"); }
    })();
    try { await enCours; } finally { enCours = null; }
  });

  log.info({ prochaine: rappel.nextRun()?.toISOString(), fuseau: config.RAPPEL_TZ, aBlanc },
    "relance du samedi planifiée");
  return {
    arreter: async () => { rappel.stop(); if (enCours) await enCours; },
    rappel
  };
}
