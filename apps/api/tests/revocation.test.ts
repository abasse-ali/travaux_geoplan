/* ============================================================
   Sessions : ce que la relecture de code de W3 a demandé

   • Une session active voit son cookie reposé quand elle est prolongée :
     sinon Safari l'effacerait 180 jours après la connexion, même si
     Geoffrey s'est servi de l'application tous les jours.
   • Une prolongation ne ressuscite pas une session supprimée entre-temps.
   • Se déconnecter, ou révoquer les sessions d'un compte, coupe aussitôt
     les connexions temps réel ouvertes avec elles.
   ============================================================ */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { COOKIE, DUREE_S, lireSession, revoquerSessions, supprimerSession } from "../src/auth/sessions.ts";
import { users } from "../src/db/schema.ts";
import { appel, sessionEssai, vider, type AppEssai } from "./aides.ts";
import { monterAvecTempsReel, socket } from "./aides-donnees.ts";

let app: AppEssai;
beforeAll(async () => { app = await monterAvecTempsReel(); });
afterAll(async () => { await app.fermer(); });
beforeEach(async () => { await vider(app.base, app.redis); });

const cleRedis = (cookie: string): string =>
  "sess:" + createHash("sha256").update(cookie.split("=")[1]).digest("hex");

/* Vieillir une session : sa dernière visite remonte à deux heures. */
async function vieillir(cookie: string): Promise<void> {
  const k = cleRedis(cookie);
  const s = JSON.parse((await app.redis.get(k))!);
  s.vuLe -= 2 * 3600 * 1000;
  await app.redis.set(k, JSON.stringify(s), "KEEPTTL");
}

describe("prolonger une session", () => {
  it("repose le cookie, pour 180 jours de plus, quand la session est prolongée", async () => {
    const cookie = await sessionEssai(app);
    const frais = await appel(app, "GET", "/api/donnees", { cookie });
    expect(frais.entetes.get("set-cookie")).toBeNull();          // vue il y a moins d'une heure : rien
    await vieillir(cookie);
    const r = await appel(app, "GET", "/api/donnees", { cookie });
    expect(r.statut).toBe(200);
    expect(r.entetes.get("set-cookie")).toMatch(new RegExp("^" + COOKIE + "=.*Max-Age=15552000"));
  });

  it("ne ressuscite pas une session supprimée entre la lecture et la prolongation", async () => {
    const cookie = await sessionEssai(app);
    await vieillir(cookie);
    const id = cookie.split("=")[1];
    /* On intercale la suppression entre le GET et le SET de lireSession. */
    const get = app.redis.get.bind(app.redis);
    app.redis.get = (async (k: string) => {
      const v = await get(k);
      if (k === cleRedis(cookie)) await app.redis.del(k);
      return v;
    }) as typeof app.redis.get;
    try {
      expect(await lireSession(app.redis, id)).toBeNull();
    } finally { app.redis.get = get; }
    expect(await app.redis.exists(cleRedis(cookie))).toBe(0);
  });

  it("l'ensemble des sessions du compte expire, et vit au moins autant qu'elles", async () => {
    const cookie = await sessionEssai(app);
    const ttl = () => app.redis.ttl("sessions-de:u_geoffrey");
    expect(await ttl()).toBeGreaterThan(DUREE_S - 60);
    await app.redis.expire("sessions-de:u_geoffrey", 10);
    await vieillir(cookie);
    await appel(app, "GET", "/api/donnees", { cookie });          // prolongée : l'ensemble aussi
    expect(await ttl()).toBeGreaterThan(DUREE_S - 60);
  });
});

describe("couper le temps réel", () => {
  const fermee = (s: Awaited<ReturnType<typeof socket>>) =>
    new Promise<string>(ok => s.once("disconnect", raison => ok(raison)));

  it("à la déconnexion, la connexion temps réel de cette session tombe", async () => {
    const cookie = await sessionEssai(app);
    const autre = await sessionEssai(app, "associe@geoplan.test");
    const [moi, lui] = await Promise.all([socket(app, { cookie }), socket(app, { cookie: autre })]);
    const coupure = fermee(moi);
    expect((await appel(app, "DELETE", "/api/session", { cookie })).statut).toBe(204);
    expect(await coupure).toBe("io server disconnect");
    expect(lui.connected).toBe(true);                             // l'autre appareil n'est pas touché
    lui.close();
  });

  it("à la révocation d'un compte, toutes ses connexions tombent", async () => {
    const c1 = await sessionEssai(app);
    const c2 = await sessionEssai(app);
    const [a, b] = await Promise.all([socket(app, { cookie: c1 }), socket(app, { cookie: c2 })]);
    const coupures = Promise.all([fermee(a), fermee(b)]);
    const s = await lireSession(app.redis, c1.split("=")[1]);
    expect(await revoquerSessions(app.redis, s!.userId)).toBe(2);
    expect(await coupures).toEqual(["io server disconnect", "io server disconnect"]);
  });

  /* Relecture adversariale de W3 : une révocation tombée entre la lecture
     de la session et l'entrée dans sa salle s'adressait à une salle vide,
     et la socket restait ouverte. La fenêtre est forcée ici ; en vrai,
     elle dure quelques millisecondes. */
  it("une révocation qui tombe pendant la connexion ne laisse pas la socket ouverte", async () => {
    const cookie = await sessionEssai(app);
    const id = cookie.split("=")[1];
    const get = app.redis.get.bind(app.redis);
    let revoquee = false;
    app.redis.get = (async (k: string) => {
      const v = await get(k);
      if (!revoquee && k === cleRedis(cookie)) { revoquee = true; await supprimerSession(app.redis, id); }
      return v;
    }) as typeof app.redis.get;
    try {
      const s = await socket(app, { cookie });
      await vi.waitFor(() => { expect(s.connected).toBe(false); });
      s.close();
    } finally { app.redis.get = get; }
    expect(revoquee).toBe(true);
  });

  it("filet de la minute : une révocation dont l'annonce s'est perdue coupe quand même la connexion", async () => {
    const rapide = await monterAvecTempsReel({ verifierToutesLesMs: 100 });
    try {
      const c1 = await sessionEssai(rapide);
      const c2 = await sessionEssai(rapide, "associe@geoplan.test");
      const [a, b] = await Promise.all([socket(rapide, { cookie: c1 }), socket(rapide, { cookie: c2 })]);
      /* La session disparaît sans annonce ; le compte de l'associé est
         supprimé en SQL. */
      await rapide.redis.del(cleRedis(c1));
      await rapide.deps.db.delete(users).where(eq(users.id, "u_associe"));
      await vi.waitFor(() => { expect([a.connected, b.connected]).toEqual([false, false]); });
      a.close(); b.close();
    } finally { await rapide.fermer(); }
  });

  it("la session d'un compte supprimé n'ouvre plus de connexion temps réel", async () => {
    const cookie = await sessionEssai(app);
    await app.deps.db.delete(users).where(eq(users.id, "u_geoffrey"));
    await expect(socket(app, { cookie })).rejects.toThrow("non-connecte");
  });
});
