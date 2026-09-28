/* ============================================================
   Aucun secret dans les journaux (ADR-002)

   Le journal de l'API est recueilli, au niveau le plus bavard, pendant
   des connexions réussies et ratées, une lecture de session et une
   déconnexion. On y cherche ensuite, mot pour mot, tout ce qui
   permettrait d'entrer : il ne doit rien y avoir.
   ============================================================ */

import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appel, vider } from "./aides.ts";
import {
  EMAIL, MOT_DE_PASSE, creerCompte, connecter, cookieDe, identifiant, empreinte, monterAppJournal, type AppJournal
} from "./aides-session.ts";
import { session } from "../src/routes/session.ts";
import { creerLog } from "../src/log.ts";

let app: AppJournal;
beforeAll(async () => { app = await monterAppJournal([session]); });
afterAll(async () => { await app.fermer(); });
beforeEach(async () => { await vider(app.base, app.redis); });

/* Le journal d'accès écrit quand la réponse est partie : on attend que
   la n-ième requête y soit inscrite avant de le lire. */
const requetes = (): Record<string, unknown>[] => app.lignes().filter(l => l.msg === "requête");
const attendreRequetes = (n: number): Promise<void> =>
  vi.waitFor(() => { expect(requetes().length).toBeGreaterThanOrEqual(n); });

describe("journaux", () => {
  it("connexions réussie et ratée : ni mot de passe, ni cookie, ni identifiant de session", async () => {
    const FAUX = "mauvais-secret-" + randomBytes(8).toString("hex");
    /* Il arrive qu'on tape son mot de passe dans le champ de l'adresse. */
    const DANS_ADRESSE = "tape-dans-adresse-" + randomBytes(8).toString("hex");
    await creerCompte(app);
    const avant = requetes().length;

    const ok = await connecter(app, EMAIL, MOT_DE_PASSE);
    expect(ok.statut).toBe(204);
    const cookie = cookieDe(ok);
    const id = identifiant(cookie);
    expect((await appel(app, "GET", "/api/session", { cookie })).statut).toBe(200);
    expect((await connecter(app, EMAIL, FAUX)).statut).toBe(401);
    expect((await connecter(app, DANS_ADRESSE, MOT_DE_PASSE)).statut).toBe(401);
    expect((await appel(app, "DELETE", "/api/session", { cookie })).statut).toBe(204);
    await attendreRequetes(avant + 5);

    const journal = app.journal();
    /* Le journal a bien parlé : sinon le test ne prouverait rien. */
    expect(requetes().slice(avant).map(l => [l.methode, l.chemin, l.statut])).toEqual([
      ["POST", "/api/session", 204],
      ["GET", "/api/session", 200],
      ["POST", "/api/session", 401],
      ["POST", "/api/session", 401],
      ["DELETE", "/api/session", 204]
    ]);
    expect(journal).toContain("connexion refusée");

    for (const secret of [MOT_DE_PASSE, FAUX, DANS_ADRESSE, id, encodeURIComponent(id), cookie, empreinte(id)])
      expect(journal, secret).not.toContain(secret);
  });

  it("le jeton d'un lien compagnon est retiré du chemin : /api/dispo/…", async () => {
    const jeton = "jeton-" + randomBytes(16).toString("base64url");
    const avant = requetes().length;
    await appel(app, "GET", `/api/dispo/${jeton}?semaine=2026-09-28`);
    await appel(app, "POST", `/api/dispo/${jeton}`, { corps: { jours: [] } });
    await attendreRequetes(avant + 2);

    expect(requetes().slice(avant).map(l => l.chemin)).toEqual(["/api/dispo/…?semaine=2026-09-28", "/api/dispo/…"]);
    expect(app.journal()).not.toContain(jeton);
  });
});

/* Relecture adversariale de W3 : quand Redis refusait une écriture
   (mémoire pleine, disque plein), ioredis joignait à l'erreur la commande
   et ses arguments, et pino les écrivait. La réponse que l'idempotence
   voulait garder partait ainsi au journal, adresse et téléphone compris.
   Le sérialiseur des erreurs retire maintenant ces champs, pour tous
   les appelants. */
describe("erreurs au journal", () => {
  function journalA(): { log: ReturnType<typeof creerLog>; texte: () => string } {
    let texte = "";
    const flux = new Writable({ write(m, _c, fait) { texte += String(m); fait(); } });
    return { log: creerLog("trace", flux), texte: () => texte };
  }

  it("une écriture refusée par Redis n'emporte pas ses arguments", async () => {
    const TEL = "+3361" + randomBytes(4).readUInt32BE(0).toString().padStart(8, "0").slice(0, 7);
    const { log, texte } = journalA();
    await app.redis.config("SET", "maxmemory", "1");
    let e: unknown;
    try {
      e = await app.redis.set("idem:u_geoffrey:geste-1", JSON.stringify({ phone: TEL })).then(() => null, (x: unknown) => x);
    } finally { await app.redis.config("SET", "maxmemory", "0"); }
    /* La fuite existait bien : l'erreur de ioredis porte la commande. */
    expect(JSON.stringify((e as { command?: unknown }).command)).toContain(TEL);
    log.warn({ err: e }, "idempotence : réponse non mémorisée");
    expect(texte()).toContain("OOM");
    expect(texte()).not.toContain(TEL);
  });

  it("une requête SQL en échec n'emporte ni ses valeurs ni la valeur fautive, d'où qu'elle soit journalisée", () => {
    const SECRET = "jeton-" + randomBytes(8).toString("hex");
    const { log, texte } = journalA();
    const e = Object.assign(new Error("Failed query: insert into avail_requests …\nparams: " + SECRET), {
      query: "insert into avail_requests …", params: [SECRET],
      cause: Object.assign(new Error("Duplicate entry '" + SECRET + "' for key 'token'"),
        { errno: 1062, code: "ER_DUP_ENTRY", sql: "insert …", sqlMessage: "Duplicate entry '" + SECRET + "'" })
    });
    log.warn({ err: e, quoi: "site" }, "diffusion impossible");
    expect(texte()).toContain("ER_DUP_ENTRY");
    expect(texte()).not.toContain(SECRET);
  });
});
