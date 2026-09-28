import { defineConfig } from "vitest/config";

/* Chaque espace de travail décrit ses propres tests ; `npm test` à la
   racine les lance tous. */
export default defineConfig({
  test: {
    projects: ["packages/domain", "apps/web", "apps/api"]
  }
});
