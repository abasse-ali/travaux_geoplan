/* ============================================================
   Propriétés de l'avancement : la barre et les cases

   Règle du domaine : « la barre et les cases ne doivent jamais se
   contredire ; le pourcentage d'une étape, c'est le nombre de ses
   missions faites ». Glisser la barre coche les N premières missions ;
   cocher une case rend le pourcentage correspondant. Ces propriétés
   figent ce contrat, et vérifient qu'aucun des deux gestes ne touche
   autre chose que l'étape visée.

   Graine : GRAINE (arbitraires.ts). 1 000 tirages par propriété.
   ============================================================ */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  PHASES, setPhasePct, setTask, taskCount, taskDone, tasksTicked,
  type Site
} from "../../src/domain.ts";
import { arbSpecChantier, chantier, GRAINE } from "./arbitraires.ts";

fc.configureGlobal({ seed: GRAINE, numRuns: 1000 });

/* La semaine n'a pas d'effet sur l'avancement : on en fixe une. */
const WK = "2026-09-14";
const arbEtape = fc.integer({ min: 0, max: PHASES.length - 1 });
const site = (spec: Parameters<typeof chantier>[0]): Site => chantier(spec, WK, []);

describe("setPhasePct — propriétés", () => {

  it("coche les N premières missions, N arrondi de la barre, et écrit le pourcentage des coches", () => {
    fc.assert(fc.property(arbSpecChantier, arbEtape, fc.double({ min: 0, max: 100, noNaN: true }),
      (spec, i, v) => {
        const s = site(spec);
        const avant = structuredClone(s);
        const tot = taskCount(i);
        const ret = setPhasePct(s, i, v);

        const n = Math.max(0, Math.min(tot, Math.round(v / 100 * tot)));
        expect(tasksTicked(s, i)).toBe(n);
        expect(s.ph[i]).toBe(Math.round(n / tot * 100));
        expect(ret).toBe(s.ph[i]);

        /* Et rien d'autre ne bouge : ni les autres étapes, ni le plan.
           À zéro coche, l'entrée disparaît (même convention que setTask). */
        const attendu = structuredClone(avant);
        attendu.ph[i] = Math.round(n / tot * 100);
        if (n) attendu.tasks[String(i)] = Array.from({ length: tot }, (_, j) => j < n);
        else delete attendu.tasks[String(i)];
        expect(s).toStrictEqual(attendu);
      }));
  });

  /* Constat D6 (connu, JOURNAL.md) — figé tel quel.
     setPhasePct(NaN) écrit NaN dans l'avancement ; ±Infinity, eux, sont
     bornés correctement. Contre-exemple réduit : n'importe quelle étape,
     v = NaN → s.ph[i] = NaN. La garde est prévue en W3 (validation
     d'entrée de l'API) : ce test passera alors en `it`. */
  it.fails("garde un avancement entier entre 0 et 100 quelle que soit la valeur reçue (D6)", () => {
    fc.assert(fc.property(arbSpecChantier, arbEtape, fc.double(), (spec, i, v) => {
      const s = site(spec);
      setPhasePct(s, i, v);
      expect(Number.isInteger(s.ph[i]), `ph[${i}] = ${s.ph[i]} pour v = ${v}`).toBe(true);
      expect(s.ph[i]).toBeGreaterThanOrEqual(0);
      expect(s.ph[i]).toBeLessThanOrEqual(100);
    }), { endOnFailure: true });
  });
});

describe("setTask — propriétés", () => {

  const arbCoche = fc.tuple(arbSpecChantier, arbEtape, fc.nat(), fc.boolean());

  it("rend le pourcentage des coches, et ne touche que la case visée", () => {
    fc.assert(fc.property(arbCoche, ([spec, i, jBrut, on]) => {
      const s = site(spec);
      const avant = structuredClone(s);
      const tot = taskCount(i), j = jBrut % tot;
      const ret = setTask(s, i, j, on);

      const coches = tasksTicked(s, i);
      expect(ret).toBe(Math.round(coches / tot * 100));
      expect(!!taskDone(s, i)[j]).toBe(on);
      for (let m = 0; m < tot; m++)
        if (m !== j) expect(!!taskDone(s, i)[m], `mission ${m}`).toBe(!!taskDone(avant, i)[m]);
      /* Une étape sans coche disparaît ; sinon elle a une case par mission. */
      if (coches) expect(s.tasks[String(i)]).toHaveLength(tot);
      else expect(s.tasks[String(i)]).toBeUndefined();

      /* setTask ne touche ni aux pourcentages (l'appelant écrit le
         retour), ni aux autres étapes, ni au plan. */
      const reste = structuredClone(s), restAvant = structuredClone(avant);
      delete reste.tasks[String(i)]; delete restAvant.tasks[String(i)];
      expect(reste).toStrictEqual(restAvant);
    }));
  });

  it("donne un pourcentage que la barre relit en autant de coches", () => {
    /* L'aller-retour cases → pourcentage → barre ne perd aucune mission :
       c'est ce qui permet d'afficher la barre à partir des cases. */
    fc.assert(fc.property(arbCoche, ([spec, i, jBrut, on]) => {
      const s = site(spec);
      const tot = taskCount(i);
      const pct = setTask(s, i, jBrut % tot, on);
      const coches = tasksTicked(s, i);
      setPhasePct(s, i, pct);
      expect(tasksTicked(s, i)).toBe(coches);
      expect(s.ph[i]).toBe(pct);
    }));
  });
});
