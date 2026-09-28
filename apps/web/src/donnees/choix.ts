/* ============================================================
   Quelle source ? (ADR-004)

   VITE_GEOPLAN_SOURCE, fixée à la construction : « local », « supabase »
   ou « api ». Sans elle : Supabase si des clés sont configurées (la
   production jusqu'à la bascule, W7), le mode local sinon. La bascule
   et le retour arrière tiennent en cette variable.

   Chaque source vit dans son propre morceau, chargé à la demande :
   Vite remplace la variable par sa valeur, et les branches des autres
   sources disparaissent de la construction.
   ============================================================ */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";
import { depotLocal } from "./local";
import type { Depot, Source } from "./types";

const CHOISIE = import.meta.env.VITE_GEOPLAN_SOURCE as string | undefined;

/* Une clé secrète dans une page web serait lisible par tout visiteur et
   contournerait toutes les règles d'accès : on refuse de s'en servir
   plutôt que de la diffuser. */
export const secretKeyPasted = (): boolean =>
  typeof SUPABASE_ANON_KEY === "string" && /^sb_secret_/.test(SUPABASE_ANON_KEY.trim());

export function supabaseConfigure(): boolean {
  if (secretKeyPasted()) {
    console.error(
      "config.ts contient une clé sb_secret_. Elle serait publiquement lisible : " +
      "révoquez-la dans Supabase et utilisez la clé sb_publishable_.");
    return false;
  }
  return typeof SUPABASE_URL === "string" &&
    /^https:\/\/.+\.supabase\.co\/?$/.test(SUPABASE_URL.trim()) &&
    typeof SUPABASE_ANON_KEY === "string" && SUPABASE_ANON_KEY.trim().length > 20;
}

export function choisirSource(): Source {
  if (CHOISIE === "api") return "api";
  if (CHOISIE === "local") return "local";
  return supabaseConfigure() ? "supabase" : "local";
}

/* Si le morceau d'une source ne se charge pas (réseau coupé avant que le
   service worker l'ait gardé), l'erreur remonte : la racine propose de
   réessayer. Se rabattre sur le mode local ferait écrire des gestes
   qu'aucun serveur ne recevrait jamais.

   Les conditions portent sur la constante de construction : Rollup
   retire ainsi les morceaux des autres sources. Tant qu'elles portaient
   sur `source`, connue à l'exécution seulement, les trois étaient
   construits et précachés par le service worker — la construction api
   téléchargeait supabase-js (225 ko), l'URL et la clé comprises. */
export async function creerDepot(source: Source): Promise<Depot> {
  if (CHOISIE === "api") return (await import("./api")).depotApi();
  if (CHOISIE !== "local" && source === "supabase") return (await import("./supabase")).depotSupabase();
  return depotLocal();
}
