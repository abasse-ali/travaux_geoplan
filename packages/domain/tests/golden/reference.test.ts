/* ============================================================
   Golden master du métier

   Le scénario de référence (sim/scenario.ts) rejoue seize
   semaines d'usage. Sa sortie complète — chaque affectation, chaque
   raison, chaque trou de couverture, chaque pourcentage d'étape — est
   figée dans reference.golden.json.

   Si ce test échoue, le comportement du moteur a changé. Deux cas :
     • ce n'était pas voulu : c'est une régression, on la corrige ;
     • c'était voulu : c'est une évolution de l'algorithme. Elle se fait
       dans un commit à part, qui présente le tableau avant/après des
       indicateurs (npm run sim) et explique pourquoi l'après est
       meilleur. Alors seulement : npx vitest run -u tests/golden
   ============================================================ */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { referencePeople, referenceSites, runScenario } from "../../sim/scenario.ts";

const raw = JSON.parse(readFileSync(new URL("../../sim/effectif-reference.json", import.meta.url), "utf8"));
const run = () => runScenario(referencePeople(raw), referenceSites());

describe("scénario de référence", () => {
  const r = run();

  it("se calcule dans le fuseau de Geoffrey", () => {
    expect(r.params.tz).toBe("Europe/Paris");
  });

  it("donne deux fois la même chose", () => {
    expect(run()).toEqual(r);
  });

  it("ne pose jamais quelqu'un sur deux chantiers le même jour", () => {
    expect(r.indicators.doublesRepartiteur).toBe(0);
  });

  it("garde ses indicateurs", async () => {
    await expect(JSON.stringify(r.indicators, null, 2) + "\n")
      .toMatchFileSnapshot("./indicators.golden.json");
  });

  it("garde sa sortie complète, à l'identique", async () => {
    await expect(JSON.stringify(r, null, 1) + "\n")
      .toMatchFileSnapshot("./reference.golden.json");
  });
});
