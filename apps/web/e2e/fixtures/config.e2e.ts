/* Remplace src/config.ts pendant les tests de bout en bout (voir
   e2e/vite.config.ts). Vide par défaut : l'application part en mode local.
   Un test qui veut simuler Supabase pose window.__GEOPLAN_E2E__ avant le
   chargement de la page, et fournit lui-même le faux serveur. */
const o = (globalThis as { __GEOPLAN_E2E__?: { url?: string; key?: string } }).__GEOPLAN_E2E__ || {};
export const SUPABASE_URL: string = o.url || "";
export const SUPABASE_ANON_KEY: string = o.key || "";
