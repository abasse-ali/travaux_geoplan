/* ============================================================
   Geoplan — configuration
   ------------------------------------------------------------
   Tant que ces deux valeurs sont vides, l'application tourne en
   MODE LOCAL : elle marche entièrement, mais les données restent
   dans le navigateur de l'appareil.

   Pour synchroniser vos appareils, créez un projet Supabase
   (gratuit), exécutez supabase/schema.sql, puis recopiez ici les
   deux valeurs de  Project Settings › API .

   La clé publiable est PUBLIQUE par nature : elle est faite pour
   vivre dans une page web, et se lit dans le code source du site.
   Ce qui protège les données, ce sont les règles RLS du schéma,
   pas le secret de cette clé.

   Supabase en émet deux, ne confondez pas :
     sb_publishable_…  celle-ci, à mettre ici          ✅
     sb_secret_…       contourne toutes les règles     ❌ jamais ici
   (Les anciens projets ont une clé « anon » en eyJ… : elle marche
   aussi, c'est l'équivalent historique de la publiable.)
   ============================================================ */

export const SUPABASE_URL: string = "https://rllprlaffmujwunwsqox.supabase.co";

/* Project Settings › API › Publishable key */
export const SUPABASE_ANON_KEY: string = "sb_publishable_3UhhgbmM1c-z2yP_dYCblg_MATwt32v";
