/* ============================================================
   La source api du client (src/donnees/api.ts), face à un faux fetch

   Ce que le serveur répond, et ce que la source en fait : le compte
   gardé hors ligne (S10), le rejeu sur 409 sous la même clé, une
   suppression déjà faite, le rangement des erreurs pour la file.
   ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normSite } from "@geoplan/domain";
import { depotApi } from "../src/donnees/api";
import { Injoignable, NonConnecte, RefusDefinitif, type Instantane, type Operation } from "../src/donnees/types";

interface Appel { methode: string; chemin: string; corps: unknown; cle: string | null }
let appels: Appel[] = [];
let repondre: (a: Appel) => Response | Promise<Response> = () => new Response(null, { status: 500 });

beforeEach(() => {
  localStorage.clear();
  appels = [];
  vi.stubGlobal("fetch", async (chemin: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    const a: Appel = {
      methode: init.method ?? "GET", chemin, cle: h.get("idempotency-key"),
      corps: init.body ? JSON.parse(String(init.body)) : undefined
    };
    appels.push(a);
    return repondre(a);
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

const json = (status: number, corps?: unknown) =>
  new Response(corps === undefined ? null : JSON.stringify(corps), { status, headers: { "content-type": "application/json" } });

const confirme = (): Instantane => ({
  donnees: { people: [], sites: [normSite("s_a", { code: "A", start: "2026-08-31" })], avail: [] },
  versions: { "site:s_a": 3 }
});
const fiche = (version: number, champs: object = {}) =>
  ({ ...normSite("s_a", { code: "A", start: "2026-08-31", ...champs }), version, urgences: {} });

describe("le compte", () => {
  it("connecté : le serveur le dit, et il est retenu pour le hors-ligne", async () => {
    repondre = () => json(200, { email: "geoffrey@geoplan.test" });
    expect(await depotApi().compte()).toEqual({ id: "geoffrey@geoplan.test", email: "geoffrey@geoplan.test" });
    repondre = () => { throw new TypeError("Failed to fetch"); };
    /* Hors ligne : le dernier compte connu, pas l'écran de connexion (S10). */
    expect(await depotApi().compte()).toEqual({ id: "geoffrey@geoplan.test", email: "geoffrey@geoplan.test" });
  });

  it("401 à la lecture : il faut se connecter, et le compte retenu est oublié", async () => {
    repondre = () => json(200, { email: "geoffrey@geoplan.test" });
    await depotApi().compte();
    repondre = () => json(401, { erreur: "non-connecte" });
    await expect(depotApi().charger()).rejects.toBeInstanceOf(NonConnecte);
    repondre = () => { throw new TypeError("Failed to fetch"); };
    expect(await depotApi().compte()).toBeNull();
  });

  it("401 à la question de la session, sans compte retenu : l'écran de connexion", async () => {
    repondre = () => json(401, { erreur: "non-connecte" });
    expect(await depotApi().compte()).toBeNull();
  });

  /* R3 (relecture de la recette, W8) : un serveur qui ne répond pas ne
     retient plus l'ouverture. Le compte retenu suffit, comme pour la
     source supabase (S10) ; la première lecture dira si la session tient. */
  it("un compte retenu ouvre l'application sans rien demander au serveur", async () => {
    repondre = () => json(200, { email: "geoffrey@geoplan.test" });
    await depotApi().compte();
    appels = [];
    repondre = () => new Promise<Response>(() => {});        // le serveur ne répond plus
    expect(await depotApi().compte()).toEqual({ id: "geoffrey@geoplan.test", email: "geoffrey@geoplan.test" });
    expect(appels).toEqual([]);
  });

  it("hors ligne, sans compte déjà vu : l'écran de connexion", async () => {
    repondre = () => { throw new TypeError("Failed to fetch"); };
    expect(await depotApi().compte()).toBeNull();
  });

  it("la connexion dit ses refus en clair", async () => {
    repondre = () => json(401, { erreur: "non-connecte" });
    await expect(depotApi().connecter("g@x.fr", "mauvais")).rejects.toThrow("Adresse ou mot de passe incorrect.");
    repondre = () => json(429, { reessayerDans: 600 });
    await expect(depotApi().connecter("g@x.fr", "mauvais")).rejects.toThrow("Réessayez dans 10 min.");
    repondre = () => { throw new TypeError("Failed to fetch"); };
    await expect(depotApi().connecter("g@x.fr", "x")).rejects.toThrow("Serveur injoignable");
  });
});

describe("les gestes", () => {
  it("un 409 de version : rejoué sur la fiche actuelle, sous la même clé", async () => {
    let n = 0;
    repondre = a => (n++ === 0
      ? json(409, { erreur: "conflit", actuel: fiche(5, { note: "d'un autre appareil" }) })
      : json(200, fiche(6, { note: "la mienne" })));
    const maj = await depotApi().envoyer({ type: "modifierChantier", site: "s_a", champs: { note: "la mienne" } }, "cle-1", confirme());
    expect(appels.map(a => [a.methode, a.chemin, (a.corps as { version: number }).version, a.cle])).toEqual([
      ["PATCH", "/api/chantiers/s_a", 3, "cle-1"],
      ["PATCH", "/api/chantiers/s_a", 5, "cle-1"]
    ]);
    const apres = maj(confirme());
    expect(apres.donnees.sites[0]!.note).toBe("la mienne");
    expect(apres.versions["site:s_a"]).toBe(6);
  });

  it("supprimer ce qui n'existe plus n'est pas un échec", async () => {
    repondre = () => json(404, { erreur: "introuvable", message: "Chantier introuvable" });
    const maj = await depotApi().envoyer({ type: "supprimerChantier", site: "s_a" }, "cle-2", confirme());
    expect(maj(confirme()).donnees.sites).toEqual([]);
  });

  it("une pose : l'équipe que rend le serveur remplace celle de l'instantané, jours vidés compris", async () => {
    repondre = () => json(200, { chantiers: { s_a: { plan: { "2026-09-15": ["p_b", "p_a"], "2026-09-16": [] }, urgences: {} } } });
    const i = confirme();
    i.donnees.sites[0]!.plan = { "2026-09-16": ["p_c"] };
    const maj = await depotApi().envoyer({ type: "poser", site: "s_a", jour: "2026-09-15", compagnon: "p_a", urgence: false }, "cle-3", i);
    expect(maj(i).donnees.sites[0]!.plan).toEqual({ "2026-09-15": ["p_b", "p_a"] });
    expect(appels[0]).toMatchObject({ methode: "POST", chemin: "/api/affectations/poser", cle: "cle-3",
      corps: { chantierId: "s_a", jour: "2026-09-15", compagnonId: "p_a", urgence: false } });
  });

  it("« retirer » sans chantier part avec chantierId: null (retour au vivier)", async () => {
    repondre = () => json(200, { chantiers: {} });
    await depotApi().envoyer({ type: "retirer", jour: "2026-09-15", compagnon: "p_a" }, "cle-4", confirme());
    expect(appels[0]!.corps).toEqual({ jour: "2026-09-15", compagnonId: "p_a", chantierId: null });
  });

  it("chaque réponse est rangée pour la file : réessayer, abandonner, se reconnecter", async () => {
    const op = { type: "cocher", site: "s_a", etape: 0, mission: 0, faite: true } as const;
    const cas: [() => Response, unknown][] = [
      [() => json(400, { message: "Requête invalide" }), RefusDefinitif],
      [() => json(404, { message: "Chantier introuvable" }), RefusDefinitif],
      [() => json(422, { message: "Affectation incohérente" }), RefusDefinitif],
      [() => json(401, { message: "Connexion requise" }), NonConnecte],
      [() => json(409, { erreur: "en-cours" }), Injoignable],
      [() => json(429, {}), Injoignable],
      [() => json(503, {}), Injoignable],
      [() => { throw new TypeError("Failed to fetch"); }, Injoignable]
    ];
    for (const [reponse, attendu] of cas) {
      repondre = reponse;
      await expect(depotApi().envoyer(op, "k", confirme())).rejects.toBeInstanceOf(attendu);
    }
  });
});

describe("relecture adversariale de W4", () => {
  const cocher = { type: "cocher", site: "s_a", etape: 0, mission: 0, faite: true } as const;

  it("les 409 : réessayer ce qui aboutira, refuser le reste (la file ne se bloque plus)", async () => {
    const cas: [() => Response, unknown][] = [
      [() => json(409, { erreur: "en-cours" }), Injoignable],
      [() => json(409, { erreur: "conflit", regle: "un-homme-un-jour" }), Injoignable],
      [() => json(409, { erreur: "conflit", actuel: fiche(9) }), Injoignable],
      [() => json(409, { erreur: "conflit", message: "Cet enregistrement existe déjà" }), RefusDefinitif],
      /* L'origine refusée : une configuration à corriger, pas des gestes à jeter. */
      [() => json(403, { erreur: "origine" }), Injoignable]
    ];
    for (const [reponse, attendu] of cas) {
      repondre = reponse;
      await expect(depotApi().envoyer(cocher, "k", confirme())).rejects.toBeInstanceOf(attendu);
    }
  });

  it("une création déjà faite (réponse perdue, clé oubliée du serveur) est un succès", async () => {
    repondre = () => json(409, { erreur: "conflit", message: "Cet enregistrement existe déjà" });
    const chantier = normSite("s_b", { code: "B", start: "2026-09-07" });
    const maj = await depotApi().envoyer({ type: "creerChantier", chantier }, "k", confirme());
    expect(maj(confirme()).donnees.sites.map(s => s.id)).toEqual(["s_a", "s_b"]);
  });

  it("hors ligne, « se déconnecter » refuse plutôt que de laisser la session ouverte", async () => {
    repondre = () => json(200, { email: "geoffrey@geoplan.test" });
    await depotApi().compte();
    repondre = () => { throw new TypeError("Failed to fetch"); };
    await expect(depotApi().deconnecter()).rejects.toBeInstanceOf(Injoignable);
    expect(await depotApi().compte()).not.toBeNull();   // toujours le compte retenu
    repondre = () => new Response(null, { status: 204 });
    await depotApi().deconnecter();
    repondre = () => { throw new TypeError("Failed to fetch"); };
    expect(await depotApi().compte()).toBeNull();
  });
});

describe("un plan de la semaine dont un chantier a disparu", () => {
  it("s'applique pour le reste, sous la même clé, au lieu d'être perdu en entier", async () => {
    let n = 0;
    repondre = () => (n++ === 0
      ? json(404, { erreur: "introuvable", message: "Chantier introuvable", ids: ["s_x"] })
      : json(200, { chantiers: { s_a: { plan: { "2026-09-14": ["p_1"] }, urgences: {} } } }));
    const op: Operation = {
      type: "plan", semaine: "2026-09-14", urgence: false,
      plan: { s_a: { "2026-09-14": ["p_1"] }, s_x: { "2026-09-14": ["p_2"] } },
      avant: { s_a: { "2026-09-14": [] }, s_x: { "2026-09-14": [] } }
    };
    const maj = await depotApi().envoyer(op, "cle-plan", confirme());
    expect(appels).toHaveLength(2);
    expect(appels[1]!.corps).toMatchObject({ plan: { s_a: { "2026-09-14": ["p_1"] } }, avant: { s_a: { "2026-09-14": [] } } });
    expect(Object.keys((appels[1]!.corps as { plan: object }).plan)).toEqual(["s_a"]);
    expect(appels.map(a => a.cle)).toEqual(["cle-plan", "cle-plan"]);
    expect(maj(confirme()).donnees.sites[0]!.plan["2026-09-14"]).toEqual(["p_1"]);
  });
});
