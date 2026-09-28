import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

/* Les gestes de Geoffrey, joués dans WebKit au format iPhone, contre
   l'une des trois sources de données (ADR-004), choisie par
   GEOPLAN_E2E_SOURCE :

   • local (par défaut) — deux serveurs, tous deux construits avec
     e2e/vite.config.ts (clés Supabase neutralisées, voir ce fichier) :
       PORT (5199 par défaut) — serveur de développement, service worker
       absent : la quasi-totalité des tests (projet « iphone ») ;
       PORT − 1 — build de production servi par `vite preview`, service
       worker actif : les tests *.pwa.spec.ts (projet « pwa »).
   • api — la vraie API de W3 sur PORT + 2 (e2e/api/serveur.ts, MySQL et
     Redis en conteneurs), et l'application construite pour elle sur
     PORT, qui lui relaie /api et /socket.io (projet « iphone-api »).
     Les tests partagent une base : un à la fois.

   • supabase — un faux Supabase en mémoire, propre à chaque test
     (e2e/supabase/faux.ts), et l’application servie sur PORT (projet
     « iphone-supabase »).

   npm run test:e2e            la source locale
   npm run test:e2e:api        la source api (Docker doit tourner)
   npm run test:e2e:supabase   la source supabase */

/* GEOPLAN_E2E_PORT déplace les serveurs : deux copies de travail
   peuvent alors lancer leurs tests en même temps sans se disputer un port. */
const PORT = Number(process.env.GEOPLAN_E2E_PORT || 5199);
const DEV = `http://127.0.0.1:${PORT}`;
const PROD = `http://127.0.0.1:${PORT - 1}`;
const PORT_API = PORT + 2;
const SOURCE = process.env.GEOPLAN_E2E_SOURCE === "api" ? "api"
  : process.env.GEOPLAN_E2E_SOURCE === "supabase" ? "supabase" : "local";

const iphone = devices["iPhone 15"];
const commun = {
  locale: "fr-FR",
  timezoneId: "Europe/Paris",
  trace: "retain-on-failure" as const
};

const parSource: Record<typeof SOURCE, Pick<PlaywrightTestConfig, "projects" | "webServer" | "workers">> = {
  local: {
    /* Six navigateurs WebKit à la fois épuisaient la mémoire de la
       machine de développement (16 Go) : processus arrêtés net, serveur
       de test à court de mémoire. Trois tiennent. */
    workers: Number(process.env.GEOPLAN_E2E_WORKERS || 3),
    projects: [
      {
        name: "iphone",
        testIgnore: /\.(pwa|api|supabase)\.spec\.ts$|captures\.spec\.ts$/,
        use: { ...iphone, ...commun, browserName: "webkit", baseURL: DEV, serviceWorkers: "block" }
      },
      {
        name: "pwa",
        testMatch: /\.pwa\.spec\.ts$/,
        use: { ...iphone, ...commun, browserName: "webkit", baseURL: PROD, serviceWorkers: "allow" }
      },
      {
        /* Les captures de référence de W5 : à part, parce qu'elles
           échouent par construction pendant la refonte visuelle, jusqu'à
           ce que chaque différence soit expliquée. npm run test:captures */
        name: "captures",
        testMatch: /captures\.spec\.ts$/,
        use: { ...iphone, ...commun, browserName: "webkit", baseURL: DEV, serviceWorkers: "block" }
      }
    ],
    webServer: [
      {
        command: "npx vite --config e2e/vite.config.ts",
        url: DEV,
        reuseExistingServer: false,
        timeout: 60_000
      },
      {
        command: "npx vite build --config e2e/vite.config.ts --logLevel warn && npx vite preview --config e2e/vite.config.ts",
        url: PROD,
        reuseExistingServer: false,
        timeout: 120_000
      }
    ]
  },
  supabase: {
    /* Chaque test a son faux Supabase, en mémoire (e2e/supabase/faux.ts) :
       ils tournent en parallèle comme ceux de la source locale. */
    workers: Number(process.env.GEOPLAN_E2E_WORKERS || 3),
    projects: [
      {
        name: "iphone-supabase",
        /* L'écran de connexion et la page compagnon de Supabase ont déjà
           leurs tests, joués par la source locale avec leur propre faux. */
        testIgnore: /\.(pwa|api)\.spec\.ts$|connexion\.spec\.ts$|dispo\.spec\.ts$|captures\.spec\.ts$/,
        use: { ...iphone, ...commun, browserName: "webkit", baseURL: DEV, serviceWorkers: "block" }
      }
    ],
    webServer: [
      {
        command: "npx vite --config e2e/vite.config.ts",
        url: DEV,
        reuseExistingServer: false,
        timeout: 60_000
      }
    ]
  },
  api: {
    workers: 1,
    projects: [
      {
        name: "iphone-api",
        /* La page compagnon et l'écran de connexion Supabase ont leurs
           propres tests pour l'API (*.api.spec.ts). */
        testIgnore: /\.(pwa|supabase)\.spec\.ts$|connexion\.spec\.ts$|dispo\.spec\.ts$|captures\.spec\.ts$/,
        use: { ...iphone, ...commun, browserName: "webkit", baseURL: DEV, serviceWorkers: "block" }
      }
    ],
    webServer: [
      {
        command: "node --disable-warning=ExperimentalWarning e2e/api/serveur.ts",
        url: `http://127.0.0.1:${PORT_API}/api/health`,
        env: { GEOPLAN_E2E_API_PORT: String(PORT_API), GEOPLAN_E2E_API_ORIGIN: DEV },
        reuseExistingServer: false,
        timeout: 240_000
      },
      {
        command: "npx vite --config e2e/vite.config.ts",
        url: DEV,
        env: { VITE_GEOPLAN_SOURCE: "api", GEOPLAN_E2E_SOURCE: "api" },
        reuseExistingServer: false,
        timeout: 60_000
      }
    ]
  }
};

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.results",
  /* WebKit sous Windows, plusieurs navigateurs en parallèle : certains
     gestes complets (poser, relire, vérifier) dépassent 30 s sous charge. */
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "e2e/.report", open: "never" }]],
  ...parSource[SOURCE]
});
