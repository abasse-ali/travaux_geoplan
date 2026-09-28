import { defineProject } from "vitest/config";

/* Les tests de l'API tournent contre de vrais MySQL et Redis, lancés
   dans des conteneurs par tests/setup/conteneurs.ts : une contrainte
   d'unicité ou un verrou ne se vérifient pas sur une base simulée.
   Les fichiers passent l'un après l'autre, sur une base vidée entre
   chaque test. */
process.env.TZ = "Europe/Paris";

export default defineProject({
  test: {
    name: "api",
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/setup/conteneurs.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000
  }
});
