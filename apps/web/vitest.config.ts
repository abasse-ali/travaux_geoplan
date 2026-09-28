import { defineProject } from "vitest/config";

/* Les règles du client qui ne demandent pas de navigateur : la file des
   gestes et sa synchronisation (src/donnees/synchro.ts). Le stockage et
   les événements du navigateur sont simulés par tests/setup.ts. */
process.env.TZ = "Europe/Paris";

export default defineProject({
  test: {
    name: "web",
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"]
  }
});
