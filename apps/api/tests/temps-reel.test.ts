/* ============================================================
   Temps réel : une écriture validée atteint tous les appareils
   connectés, en moins d'une seconde, et aucun appareil sans session.
   ============================================================ */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
import { COOKIE } from "../src/auth/sessions.ts";
import { appel, sessionEssai, vider, type AppEssai } from "./aides.ts";
import { chantier, compagnon, monterAvecTempsReel, prochainChangement, socket, MARDI } from "./aides-donnees.ts";

const COOKIE_INCONNU = COOKIE + "=" + "a".repeat(43);

let app: AppEssai;
let cookie: string;
const ouvertes: Socket[] = [];

beforeAll(async () => { app = await monterAvecTempsReel(); });
afterAll(async () => { await app.fermer(); });
beforeEach(async () => {
  await vider(app.base, app.redis);
  cookie = await sessionEssai(app);
  await chantier(app, "s_a");
  await compagnon(app, "p_erwan");
});
afterEach(() => { while (ouvertes.length) ouvertes.pop()!.close(); });

const connecter = async (o: Parameters<typeof socket>[1]): Promise<Socket> => {
  const s = await socket(app, o);
  ouvertes.push(s);
  return s;
};

describe("temps réel", () => {
  it("une écriture HTTP atteint les deux appareils connectés en moins d'une seconde", async () => {
    const iphone = await connecter({ cookie });
    const ipad = await connecter({ cookie: await sessionEssai(app, "associe@geoplan.test") });
    const attendus = [prochainChangement(iphone), prochainChangement(ipad)];

    const t0 = performance.now();
    const r = await appel(app, "POST", "/api/affectations/poser", {
      cookie, corps: { chantierId: "s_a", jour: MARDI, compagnonId: "p_erwan", urgence: false },
      entetes: { "idempotency-key": "pose-temps-reel" }
    });
    expect(r.statut).toBe(200);
    const recus = await Promise.all(attendus);

    for (const { c } of recus)
      expect(c).toEqual({ quoi: "assignments", ids: ["s_a"], jours: [MARDI], mutation: "pose-temps-reel" });
    const delais = recus.map(({ recuA }) => recuA - t0);
    console.log("délai écriture → annonce : " + delais.map(d => d.toFixed(1) + " ms").join(", "));
    for (const d of delais) expect(d).toBeLessThan(1000);
  });

  it("une socket sans cookie est refusée", async () => {
    await expect(connecter({})).rejects.toThrow("non-connecte");
  });

  it("une socket avec une session inconnue ou révoquée est refusée", async () => {
    await expect(connecter({ cookie: COOKIE_INCONNU })).rejects.toThrow("non-connecte");
    const perimee = await sessionEssai(app, "parti@geoplan.test");
    await app.redis.del(...await app.redis.keys("sess:*"));
    await expect(connecter({ cookie: perimee })).rejects.toThrow("non-connecte");
  });

  it("une socket ouverte depuis une autre origine est refusée, même avec le cookie", async () => {
    await expect(connecter({ cookie, origine: "https://ailleurs.example" })).rejects.toThrow();
  });

  it("un second processus API reçoit aussi les annonces (adaptateur Redis)", async () => {
    const second = await monterAvecTempsReel();
    try {
      const s = await socket(second, { cookie });
      ouvertes.push(s);
      const attendu = prochainChangement(s);
      const t0 = performance.now();
      /* L'écriture passe par le PREMIER processus ; l'appareil est
         connecté au SECOND. */
      await appel(app, "POST", "/api/chantiers/s_a/missions", { cookie, corps: { etape: 0, mission: 0, faite: true } });
      const { c, recuA } = await attendu;
      expect(c).toEqual({ quoi: "site", ids: ["s_a"] });
      console.log("délai d'un processus à l'autre : " + (recuA - t0).toFixed(1) + " ms");
      expect(recuA - t0).toBeLessThan(1000);
    } finally {
      await second.fermer();
    }
  });
});
