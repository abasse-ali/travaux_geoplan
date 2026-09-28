import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { monterApp, type AppEssai } from "./aides.ts";

let app: AppEssai;
beforeAll(async () => { app = await monterApp(); });
afterAll(async () => { await app.fermer(); });

describe("GET /api/health", () => {
  it("dit que MySQL et Redis répondent", async () => {
    const r = await fetch(app.url + "/api/health");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, mysql: true, redis: true });
  });

  it("une route inconnue répond 404 en JSON", async () => {
    const r = await fetch(app.url + "/api/nulle-part");
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ erreur: "introuvable" });
  });

  it("un corps JSON illisible répond 400, sans détail interne", async () => {
    const r = await fetch(app.url + "/api/health", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{pas du json"
    });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erreur: "requete-invalide", message: "Requête invalide" });
  });
});
