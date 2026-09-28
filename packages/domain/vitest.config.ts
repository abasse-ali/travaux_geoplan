import { defineProject } from "vitest/config";

/* Le métier se calcule dans le fuseau de Geoffrey. `pressure` dépend du
   passage à l'heure d'hiver (constat D4) : sans fuseau fixé, le golden
   master changerait d'une machine à l'autre. Les processus de test
   héritent de cette variable. */
process.env.TZ = "Europe/Paris";

export default defineProject({
  test: {
    name: "domain",
    include: ["tests/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    /* Les tests de propriétés d'optimizeWeek font des centaines de
       répartitions : la limite par défaut (5 s) est trop courte. */
    testTimeout: 60_000
  }
});
