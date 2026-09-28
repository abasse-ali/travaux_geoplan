import { defineConfig } from "drizzle-kit";

/* Les migrations sont générées depuis le schéma (npm run migrations -w
   @geoplan/api), versionnées dans drizzle/, et appliquées par l'API à
   son démarrage. On ne modifie jamais une migration déjà livrée : on en
   ajoute une. */
export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema.ts",
  out: "./drizzle"
});
