/* npm run sim — rejoue le scénario de référence et affiche ses
   indicateurs. Le détail complet est figé par tests/golden ; ceci est
   la vue lisible, pour comparer deux versions du moteur d'un coup d'œil.

   Usage : npm run sim [-- --json]                                        */

process.env.TZ = "Europe/Paris";   // avant tout calcul de date (constat D4)

import { readFileSync } from "node:fs";
import { REF, referencePeople, referenceSites, runScenario } from "../../packages/domain/sim/scenario.ts";

const raw = JSON.parse(readFileSync(new URL("../../packages/domain/sim/effectif-reference.json", import.meta.url), "utf8"));
const t0 = performance.now();
const r = runScenario(referencePeople(raw), referenceSites());
const ms = Math.round(performance.now() - t0);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(r.indicators, null, 2));
} else {
  const i = r.indicators;
  const rows: [string, string | number][] = [
    ["Semaines simulées", `${REF.weeks} (du ${REF.start}, graine ${REF.seed}, ${r.params.tz})`],
    ["j·h restants en fin de scénario", i.jhRestants],
    ["Journées posées", i.journeesPosees],
    ["  dont utiles", i.journeesUtiles],
    ["  dont stériles (rien à prendre)", i.journeesSteriles],
    ["Journées au dépôt (disponibles, non posées)", i.journeesDepot],
    ["Doubles réclamations — répartiteur", i.doublesRepartiteur],
    ["Doubles réclamations — chantier par chantier", i.doublesIsole],
    ["Équipes reconduites d'un jour sur l'autre", (i.reconduction * 100).toFixed(1) + " %"],
    ["Raisons orphelines (constat D1)", i.raisonsOrphelines],
    ["Posés sans raison affichée (constat D1)", i.poseesSansRaison],
    ["Chantiers terminés", i.chantiersTermines.join(", ") || "aucun"],
    ["Durée du calcul", ms + " ms"]
  ];
  const w = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) console.log(k.padEnd(w + 2) + v);
}
