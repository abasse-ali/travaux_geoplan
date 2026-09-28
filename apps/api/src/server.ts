/* ============================================================
   Point d'entrée de l'API

   node src/server.ts — Node retire les types lui-même, pas d'étape de
   compilation. Dans l'ordre : configuration, base (migrée), Redis,
   temps réel, routes, tâche du samedi. Un SIGTERM (docker stop) laisse
   finir les requêtes en cours avant de fermer.

   Le fuseau : le domaine calcule les semaines en heure locale, comme le
   téléphone de Geoffrey. Le serveur doit donc tourner à l'heure de
   Paris, quelle que soit celle de la machine.
   ============================================================ */

process.env.TZ ||= "Europe/Paris";

import { createServer } from "node:http";
import { lireConfig } from "./config.ts";
import { creerLog } from "./log.ts";
import { ouvrirBase, migrer } from "./db/client.ts";
import { ouvrirRedis } from "./redis.ts";
import { createApp, type Changement, type Deps } from "./app.ts";
import { MODULES } from "./modules.ts";
import { brancherTempsReel } from "./temps-reel.ts";
import { planifierTaches } from "./taches.ts";

const log = creerLog();

/* Un rejet de promesse oublié quelque part (une publication Redis de
   l'adaptateur temps réel, par exemple) ne doit pas abattre l'API au
   milieu de la journée de Geoffrey : on le note, on continue. */
process.on("unhandledRejection", e => {
  log.error({ err: { message: (e as Error)?.message, nom: (e as Error)?.name } }, "rejet non traité");
});

async function attendreBase(essai: () => Promise<void>): Promise<void> {
  /* docker compose lance MySQL et l'API ensemble : on laisse à MySQL
     le temps d'accepter les connexions, puis on migre. */
  for (let n = 1; ; n++) {
    try { await essai(); return; }
    catch (e) {
      if (n >= 30) throw e;
      log.warn({ essai: n }, "base pas encore prête");
      await new Promise(ok => setTimeout(ok, 2000));
    }
  }
}

async function demarrer(): Promise<void> {
  const config = lireConfig();
  const base = ouvrirBase(config.DATABASE_URL);
  await attendreBase(() => migrer(config.DATABASE_URL));
  const redis = ouvrirRedis(config.REDIS_URL);
  redis.on("error", e => log.warn({ err: { message: (e as Error).message } }, "Redis indisponible"));

  /* La diffusion est branchée après la création du serveur HTTP, que
     Socket.IO partage : les routes l'appellent par cette indirection. */
  let diffuserVers: (c: Changement) => void = () => {};
  const deps: Deps = { config, db: base.db, redis, log, diffuser: c => diffuserVers(c) };

  const app = createApp(deps, MODULES);
  const serveur = createServer(app);
  const temps = await brancherTempsReel(serveur, deps);
  diffuserVers = temps.diffuser;
  const taches = planifierTaches(deps);

  serveur.listen(config.PORT, () => log.info({ port: config.PORT, mail: config.MAIL_MODE }, "API prête"));

  /* Arrêt propre : plus de nouvelle requête, celles en cours finissent
     (au plus 10 s), une relance en cours va au bout, puis on ferme la
     base et Redis. Un second signal pendant l'arrêt est ignoré. */
  let arretEnCours = false;
  const arreter = async (signal: string) => {
    if (arretEnCours) return;
    arretEnCours = true;
    log.info({ signal }, "arrêt demandé");
    const fermeture = new Promise<void>(ok => serveur.close(() => ok()));
    const delai = new Promise<void>(ok => setTimeout(ok, 10_000).unref());
    await taches.arreter();
    await temps.fermer();
    await Promise.race([fermeture, delai]);
    await base.fermer();
    redis.disconnect();
    log.info("arrêté");
    process.exit(0);
  };
  process.on("SIGTERM", () => void arreter("SIGTERM"));
  process.on("SIGINT", () => void arreter("SIGINT"));
}

demarrer().catch(e => {
  log.fatal({ err: e }, "démarrage impossible");
  process.exit(1);
});
