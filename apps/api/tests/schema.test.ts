/* ============================================================
   Le schéma tient-il ses promesses (ADR-001) ?

   Ces tests parlent SQL directement, sans passer par les routes : ils
   vérifient ce que la base garantit à elle seule, quel que soit le code
   qui l'appellera.
   ============================================================ */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { ouvrirBase, type Base } from "../src/db/client.ts";
import { ouvrirRedis, type Redis } from "../src/redis.ts";
import { vider } from "./aides.ts";

let base: Base;
let redis: Redis;

beforeAll(() => {
  base = ouvrirBase(inject("DATABASE_URL"));
  redis = ouvrirRedis(inject("REDIS_URL"));
});
afterAll(async () => { await base.fermer(); redis.disconnect(); });

beforeEach(async () => {
  await vider(base, redis);
  const q = (s: string, v: unknown[] = []) => base.pool.query(s, v);
  const niveaux = JSON.stringify({ elec: 1, plomb: 1, platre: 1, peint: 1, menuis: 1 });
  const jours = JSON.stringify([true, true, true, true, true, false, false]);
  for (const id of ["p_nixon", "p_giorgi"])
    await q("INSERT INTO people (id, name, days, sk) VALUES (?, ?, ?, ?)", [id, id.slice(2), jours, niveaux]);
  for (const id of ["s_a", "s_b"])
    await q("INSERT INTO sites (id, code, start_date, months, coef, ph, tasks) VALUES (?, ?, '2026-09-14', 2, 1, ?, '{}')",
      [id, id.toUpperCase(), JSON.stringify(Array(12).fill(0))]);
});

const poser = (site: string, jour: string, pid: string, urgence = false) =>
  base.pool.query(
    "INSERT INTO assignments (site_id, day, person_id, urgence, occupe, position) VALUES (?, ?, ?, ?, ?, 0)",
    [site, jour, pid, urgence, urgence ? null : 1]);

const errno = async (p: Promise<unknown>): Promise<number | null> => {
  try { await p; return null; } catch (e) { return (e as { errno?: number }).errno ?? -1; }
};

describe("assignments — un homme, un chantier, par jour", () => {
  it("refuse une seconde affectation normale le même jour, sur un autre chantier", async () => {
    await poser("s_a", "2026-09-16", "p_nixon");
    expect(await errno(poser("s_b", "2026-09-16", "p_nixon"))).toBe(1062);   // ER_DUP_ENTRY
  });

  it("accepte la même personne un autre jour", async () => {
    await poser("s_a", "2026-09-16", "p_nixon");
    expect(await errno(poser("s_b", "2026-09-17", "p_nixon"))).toBeNull();
  });

  it("laisse l'urgence poser la même personne ailleurs le même jour, et c'est écrit", async () => {
    await poser("s_a", "2026-09-16", "p_nixon");
    expect(await errno(poser("s_b", "2026-09-16", "p_nixon", true))).toBeNull();
    const [lignes] = await base.pool.query("SELECT site_id, urgence FROM assignments WHERE person_id = 'p_nixon' ORDER BY site_id");
    expect(lignes).toEqual([{ site_id: "s_a", urgence: 0 }, { site_id: "s_b", urgence: 1 }]);
  });

  it("refuse deux fois la même personne sur le même chantier le même jour, même en urgence", async () => {
    await poser("s_a", "2026-09-16", "p_nixon", true);
    expect(await errno(poser("s_a", "2026-09-16", "p_nixon", true))).toBe(1062);
  });

  it("refuse une affectation incohérente (urgence sans lever la règle, ou l'inverse)", async () => {
    const incoherente = (urgence: boolean, occupe: number | null) => base.pool.query(
      "INSERT INTO assignments (site_id, day, person_id, urgence, occupe, position) VALUES ('s_a', '2026-09-16', 'p_giorgi', ?, ?, 0)",
      [urgence, occupe]);
    expect(await errno(incoherente(true, 1))).toBe(3819);      // ER_CHECK_CONSTRAINT_VIOLATED
    expect(await errno(incoherente(false, null))).toBe(3819);
  });

  it("supprimer un compagnon retire ses affectations et ses demandes, en cascade", async () => {
    await poser("s_a", "2026-09-16", "p_nixon");
    await base.pool.query(
      "INSERT INTO avail_requests (id, token, person_id, week, expires_at) VALUES ('p_nixon@2026-09-21', 'jeton', 'p_nixon', '2026-09-21', '2026-11-20 00:00:00')");
    await base.pool.query("DELETE FROM people WHERE id = 'p_nixon'");
    const [a] = await base.pool.query("SELECT COUNT(*) AS n FROM assignments");
    const [d] = await base.pool.query("SELECT COUNT(*) AS n FROM avail_requests");
    expect([(a as { n: number }[])[0].n, (d as { n: number }[])[0].n]).toEqual([0, 0]);
  });

  it("supprimer un chantier retire ses affectations, en cascade", async () => {
    await poser("s_a", "2026-09-16", "p_nixon");
    await base.pool.query("DELETE FROM sites WHERE id = 's_a'");
    const [a] = await base.pool.query("SELECT COUNT(*) AS n FROM assignments");
    expect((a as { n: number }[])[0].n).toBe(0);
  });
});

describe("dates", () => {
  it("rend une DATE telle qu'écrite, sans décalage de fuseau", async () => {
    await poser("s_a", "2026-10-25", "p_nixon");                 // passage à l'heure d'hiver
    const [l] = await base.pool.query("SELECT day FROM assignments");
    expect((l as { day: string }[])[0].day).toBe("2026-10-25");
  });
});

describe("identifiants et jetons — comparés à l'octet près", () => {
  it("distingue deux identifiants qui ne diffèrent que par la casse", async () => {
    const niveaux = JSON.stringify({ elec: 1, plomb: 1, platre: 1, peint: 1, menuis: 1 });
    const jours = JSON.stringify([true, true, true, true, true, false, false]);
    await base.pool.query("INSERT INTO people (id, name, days, sk) VALUES ('P_NIXON', 'Autre', ?, ?)", [jours, niveaux]);
    const [l] = await base.pool.query("SELECT id FROM people WHERE id = 'p_nixon'");
    expect(l).toEqual([{ id: "p_nixon" }]);
  });

  it("ne retrouve un jeton qu'à la casse exacte", async () => {
    await base.pool.query(
      "INSERT INTO avail_requests (id, token, person_id, week, expires_at) VALUES ('p_nixon@2026-09-21', 'AbCdEfGhIjKlMnOpQr', 'p_nixon', '2026-09-21', '2026-11-20 00:00:00')");
    const [exact] = await base.pool.query("SELECT id FROM avail_requests WHERE token = 'AbCdEfGhIjKlMnOpQr'");
    const [autre] = await base.pool.query("SELECT id FROM avail_requests WHERE token = 'abcdefghijklmnopqr'");
    expect([(exact as unknown[]).length, (autre as unknown[]).length]).toEqual([1, 0]);
  });
});
