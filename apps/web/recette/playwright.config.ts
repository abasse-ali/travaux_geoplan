/* ============================================================
   La recette de W8 : chaque ligne de GESTES.md, jouée sur la pile
   Docker (infra/docker-compose.yml) — l'application construite pour
   l'API, servie par nginx sous sa politique de sécurité, la vraie API,
   MySQL et Redis — au format iPhone 15, avec la vraie horloge.

   Ce n'est pas le filet (e2e/) : elle ne se prépare pas elle-même, elle
   joue un seul parcours, de bout en bout, sur une base qu'on lui a
   préparée (recette/base.sh), et elle en change les données. Elle
   arrête et relance l'API (J8), coupe le réseau, remplace les données
   par une sauvegarde (H4) : **elle ne se joue que sur une pile locale**.

   RECETTE_MDP=… npm run recette -w @geoplan/web
   Le navigateur suit les variables du filet (GEOPLAN_E2E_NAVIGATEUR,
   GEOPLAN_E2E_CHROMIUM) : WebKit par défaut, le moteur de l'iPhone.
   Voir docs/reconstruction/RECETTE.md.
   ============================================================ */

import { defineConfig, devices } from "@playwright/test";

/* Les dates attendues se calculent à l'heure de Paris, comme l'application. */
process.env.TZ = "Europe/Paris";

const URL = process.env.RECETTE_URL || "http://localhost:8080";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(URL))
  throw new Error(`La recette arrête l'API et remplace les données : elle ne se joue que sur une pile locale, pas sur ${URL}.`);
if (!process.env.RECETTE_MDP) throw new Error("RECETTE_MDP : le mot de passe du compte de recette.");

const navigateur = process.env.GEOPLAN_E2E_NAVIGATEUR === "chromium"
  ? {
      browserName: "chromium" as const, defaultBrowserType: "chromium" as const,
      ...(process.env.GEOPLAN_E2E_CHROMIUM && { launchOptions: { executablePath: process.env.GEOPLAN_E2E_CHROMIUM } })
    }
  : { browserName: "webkit" as const };

export default defineConfig({
  testDir: ".",
  testMatch: /recette\.spec\.ts$/,
  outputDir: ".resultats/playwright",
  timeout: 30 * 60_000,
  expect: { timeout: 8_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["iPhone 15"],
    ...navigateur,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    baseURL: URL,
    trace: "off",
    actionTimeout: 10_000,
    navigationTimeout: 20_000
  }
});
