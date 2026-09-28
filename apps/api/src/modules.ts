/* Les domaines de routes montés par l'API, dans l'ordre. Chacun vit
   dans src/routes/ et rend un routeur Express (voir Module dans app.ts). */

import type { Module } from "./app.ts";
import { session } from "./routes/session.ts";
import { routesDonnees } from "./routes/donnees.ts";
import { routesCompagnons } from "./routes/compagnons.ts";
import { routesChantiers } from "./routes/chantiers.ts";
import { routesAffectations } from "./routes/affectations.ts";
import { dispo } from "./routes/dispo.ts";
import { demandes } from "./routes/demandes.ts";

export const MODULES: Module[] = [
  session,
  routesDonnees,
  routesCompagnons,
  routesChantiers,
  routesAffectations,
  dispo,
  demandes
];
