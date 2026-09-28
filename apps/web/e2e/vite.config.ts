/* Configuration Vite des tests de bout en bout.

   L'application lit ses clés Supabase dans src/config.ts, écrites en dur :
   lancée telle quelle, elle parlerait à la vraie base. Ici, tout import de
   src/config.ts est détourné vers fixtures/config.e2e.ts, qui ne donne des
   clés que si le test en a posé (window.__GEOPLAN_E2E__) :
     • sans rien : mode local, pas d'écran de connexion ;
     • avec une URL factice : dispo.html parle à un faux serveur que le
       test intercepte avec page.route — aucune requête ne sort.
   Le code de l'application n'est pas modifié. */

import { defineConfig, mergeConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { normalize } from "node:path";
import base from "../vite.config";

const real = normalize(fileURLToPath(new URL("../src/config.ts", import.meta.url)));
const fixture = normalize(fileURLToPath(new URL("./fixtures/config.e2e.ts", import.meta.url)));

const configE2E: Plugin = {
  name: "geoplan-e2e-config",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (!importer || !/(^|\/)config(\.[jt]s)?$/.test(source)) return null;
    const r = await this.resolve(source, importer, { ...options, skipSelf: true });
    return r && normalize(r.id) === real ? fixture : null;
  }
};

/* Un faux Supabase servi par le serveur de test lui-même, sous
   /__faux-supabase. Nécessaire pour les pages contrôlées par un service
   worker : leurs requêtes échappent à page.route (limite connue de
   Playwright), et partiraient sinon sur le réseau. Ici, elles restent
   sur la machine. Jetons connus : « a » (Nixon) et « b » (Giorgi). */
const FAUX_COMPAGNONS: Record<string, string> = { a: "Nixon", b: "Giorgi" };

const fauxSupabase: Plugin = {
  name: "geoplan-e2e-faux-supabase",
  configurePreviewServer(server) {
    server.middlewares.use("/__faux-supabase/rest/v1/rpc/avail_get", (req, res) => {
      let corps = "";
      req.on("data", (c: Buffer) => { corps += c; });
      req.on("end", () => {
        let jeton = "";
        try { jeton = String(JSON.parse(corps || "{}").p_token || ""); } catch { /* corps illisible : jeton vide */ }
        const nom = FAUX_COMPAGNONS[jeton];
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(nom
          ? { name: nom, week: "2026-09-21", days: null, note: "", answered: false }
          : null));
      });
    });
  }
};

const PORT = Number(process.env.GEOPLAN_E2E_PORT || 5199);   // voir playwright.config.ts

/* Source api : l'application et l'API sous la même origine, comme
   derrière nginx en production. Le cookie de session reste ainsi
   « premier parti », et les écritures portent la bonne origine. */
const API = `http://127.0.0.1:${PORT + 2}`;
const relais = process.env.GEOPLAN_E2E_SOURCE === "api"
  ? {
      "/api": { target: API },
      /* Une page fermée en fin de test coupe sa connexion temps réel : le
         relais le signale par un ECONNRESET sans conséquence. */
      "/socket.io": { target: API, ws: true, configure: (p: { on: (e: "error", f: () => void) => void }) => p.on("error", () => {}) }
    }
  : undefined;

export default mergeConfig(base, defineConfig({
  plugins: [configE2E, fauxSupabase],
  server: { port: PORT, strictPort: true, host: "127.0.0.1", proxy: relais },
  preview: { port: PORT - 1, strictPort: true, host: "127.0.0.1" },
  build: { outDir: "e2e/.dist", emptyOutDir: true }
}));
