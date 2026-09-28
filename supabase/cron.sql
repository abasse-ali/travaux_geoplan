-- ============================================================
-- Geoplan — le rendez-vous du samedi
--
-- Programme l'appel de la fonction Edge « rappel-dispos ». À exécuter
-- UNE FOIS, dans le SQL Editor, APRÈS avoir déployé la fonction et
-- renseigné ses secrets.
--
-- Remplacez les trois valeurs entre chevrons avant d'exécuter.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Le secret partagé avec la fonction : sans lui, personne ne peut la
-- déclencher depuis l'extérieur. Doit valoir exactement le secret
-- CRON_SECRET défini côté Edge Function.
-- (Vault évite d'écrire le secret en clair dans la table des tâches.)
select vault.create_secret('<VOTRE_CRON_SECRET>', 'geoplan_cron_key')
where not exists (select 1 from vault.secrets where name = 'geoplan_cron_key');

-- On retire l'ancienne planification si le script est rejoué.
select cron.unschedule('geoplan-rappel-dispos')
where exists (select 1 from cron.job where jobname = 'geoplan-rappel-dispos');

-- Samedi 9 h, heure de Paris. pg_cron raisonne en UTC : 7 h UTC
-- correspond à 9 h en heure d'été, 8 h en heure d'hiver — l'écart
-- d'une heure est sans conséquence pour un rappel hebdomadaire.
select cron.schedule(
  'geoplan-rappel-dispos',
  '0 7 * * 6',
  $$
  select net.http_post(
    url     := '<VOTRE_PROJET>.supabase.co/functions/v1/rappel-dispos',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-key',   (select decrypted_secret from vault.decrypted_secrets
                                   where name = 'geoplan_cron_key')
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- ------------------------------------------------------------
-- Vérifications utiles
-- ------------------------------------------------------------
-- La tâche est-elle bien programmée ?
--   select jobname, schedule, active from cron.job;
--
-- S'est-elle exécutée, et qu'a-t-elle répondu ?
--   select status, return_message, start_time
--     from cron.job_run_details
--    where jobname = 'geoplan-rappel-dispos'
--    order by start_time desc limit 5;
--
-- Pour l'essayer tout de suite sans attendre samedi, appelez la
-- fonction à la main depuis un terminal :
--   curl -X POST https://<VOTRE_PROJET>.supabase.co/functions/v1/rappel-dispos \
--        -H "x-cron-key: <VOTRE_CRON_SECRET>"
-- Elle répond par un bilan : combien d'envois, combien avaient déjà
-- répondu, et le détail des erreurs éventuelles.
