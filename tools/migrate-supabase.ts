/* ============================================================
   Migrer les données de Supabase vers MySQL

     SUPABASE_URL=https://<projet>.supabase.co \
     SUPABASE_KEY=sb_publishable_… \
     SUPABASE_EMAIL=<adresse du chef d'équipe> \
     DATABASE_URL=mysql://… \
     node tools/migrate-supabase.ts [--ecrire]

   Le mot de passe se tape sur l'entrée standard : il ne passe jamais
   par la ligne de commande, l'historique ou les journaux.

   À BLANC PAR DÉFAUT : l'outil lit Supabase, calcule et affiche le
   rapport, et n'écrit rien. --ecrire écrit, dans une transaction.
   Idempotent : le relancer ne crée aucun doublon (voir
   apps/api/src/migration/importer.ts).

   EN MIROIR : la base devient la copie de Supabase. Un compagnon, un
   chantier ou une demande que Supabase n'a plus est supprimé de MySQL ;
   le rapport les nomme (« supprimes »). Seule exception : une demande
   que l'API a déjà envoyée, ou à laquelle un compagnon a répondu par
   son lien, est gardée (« demandesGardees »).

   ⚠ Données réelles : à ne lancer contre la vraie base Supabase
   qu'avec l'accord du propriétaire (W7).
   ============================================================ */

import { ouvrirBase, migrer } from "../apps/api/src/db/client.ts";
import { importer, ImportRefuse } from "../apps/api/src/migration/importer.ts";
import { lireSupabase } from "../apps/api/src/migration/supabase.ts";
import { premiereLigne, saisieMasquee } from "../apps/api/src/cli/saisie.ts";

const ecrire = process.argv.includes("--ecrire");
const manque = ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_EMAIL", "DATABASE_URL"].filter(v => !process.env[v]);
if (manque.length) { console.error("Variables manquantes : " + manque.join(", ")); process.exit(1); }

/* Dans un terminal, la saisie est masquée ; une entrée redirigée donne
   sa première ligne. Jamais d'écho, jamais d'argument. */
const lireMotDePasse = (): Promise<string> => process.stdin.isTTY
  ? saisieMasquee("Mot de passe Supabase de " + process.env.SUPABASE_EMAIL + " : ")
  : premiereLigne();

const donnees = await lireSupabase({
  url: process.env.SUPABASE_URL!, cle: process.env.SUPABASE_KEY!,
  email: process.env.SUPABASE_EMAIL!, motDePasse: await lireMotDePasse()
});

const base = ouvrirBase(process.env.DATABASE_URL!);
try {
  await migrer(process.env.DATABASE_URL!);
  const rapport = await importer(base.db, donnees, { aBlanc: !ecrire, miroir: true });
  console.log(JSON.stringify(rapport, null, 2));
  if (!ecrire) console.error("\nÀ blanc : rien n'a été écrit. Relancer avec --ecrire pour migrer.");
  if (rapport.identifiantsInvalides.length)
    console.error("\nIdentifiants que l'API refuserait : " + rapport.identifiantsInvalides.join(", ")
      + ". L'écriture sera refusée tant qu'ils existent.");
} catch (e) {
  if (!(e instanceof ImportRefuse)) throw e;
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await base.fermer();
}
