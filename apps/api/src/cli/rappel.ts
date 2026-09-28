/* ============================================================
   La relance du samedi, à la main

     npm run rappel -w @geoplan/api -- [--semaine AAAA-MM-JJ] [--envoyer] [--forcer]

   À blanc par défaut : dit ce qui partirait, sans rien envoyer.
   --envoyer   envoie pour de bon ; exige MAIL_MODE=brevo, pour qu'un
               oubli de configuration ne fasse partir aucun e-mail.
   --forcer    refait une relance à blanc déjà faite pour cette semaine.
   --semaine   un lundi ; par défaut, celui qui suit aujourd'hui, à
               l'heure de Paris.

   Le bilan sort en JSON sur la sortie standard, les journaux sur la
   sortie d'erreur : un script peut lire l'un sans l'autre.
   Code de sortie : 0 fait sans erreur (ou rien à faire), 1 un envoi ou
   la relance a échoué, 2 commande ou configuration invalide.

   La commande n'est pas reliée au temps réel : un écran ouvert verra
   les demandes créées ici à son prochain chargement.
   ============================================================ */

process.env.TZ ||= "Europe/Paris";

import { parseArgs } from "node:util";
import { lireConfig, type Config } from "../config.ts";
import { creerLog } from "../log.ts";
import { ouvrirBase } from "../db/client.ts";
import { ouvrirRedis } from "../redis.ts";
import { lancerRappel } from "../taches/rappel.ts";
import { estLundi } from "../dispo/semaine.ts";
import { erreurSansDonnees } from "../dispo/demandes.ts";

async function principal(): Promise<number> {
  let args: { semaine?: string; envoyer: boolean; forcer: boolean };
  let config: Config;
  try {
    args = parseArgs({
      options: {
        semaine: { type: "string" },
        envoyer: { type: "boolean", default: false },
        forcer: { type: "boolean", default: false }
      },
      strict: true, allowPositionals: false
    }).values;
    config = lireConfig();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  if (args.semaine !== undefined && !estLundi(args.semaine)) {
    console.error("--semaine doit être un lundi, au format AAAA-MM-JJ");
    return 2;
  }
  if (args.envoyer && config.MAIL_MODE !== "brevo") {
    console.error("--envoyer exige MAIL_MODE=brevo (avec BREVO_API_KEY et MAIL_FROM)");
    return 2;
  }

  const log = creerLog(undefined, process.stderr);
  const base = ouvrirBase(config.DATABASE_URL);
  const redis = ouvrirRedis(config.REDIS_URL);
  try {
    const bilan = await lancerRappel(
      { config, db: base.db, redis, log, diffuser: () => {} },
      { semaine: args.semaine, aBlanc: !args.envoyer, forcer: args.forcer });
    process.stdout.write(JSON.stringify(bilan, null, 2) + "\n");
    return bilan.erreurs.length ? 1 : 0;
  } catch (e) {
    log.error({ err: erreurSansDonnees(e) }, "relance impossible");
    return 1;
  } finally {
    await base.fermer();
    redis.disconnect();
  }
}

principal().then(code => { process.exitCode = code; });
