/* ============================================================
   La commande du propriétaire (ADR-002)

   Lancée pour de vrai, dans un processus Node, l'entrée standard
   redirigée : c'est ainsi qu'un script de déploiement l'appellera, et
   c'est le chemin qui ne demande pas de terminal. On vérifie ensuite,
   par la vraie route, que le compte s'ouvre ou ne s'ouvre plus.
   ============================================================ */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appel, monterApp, vider, type AppEssai } from "./aides.ts";
import { EMAIL, creerCompte, connecter, cookieDe, executerCompte } from "./aides-session.ts";
import { session } from "../src/routes/session.ts";
import { users } from "../src/db/schema.ts";

const ANCIEN = "ancien-mot-de-passe-1";
const NOUVEAU = "nouveau-mot-de-passe-2";

let app: AppEssai;
beforeAll(async () => { app = await monterApp([session]); });
afterAll(async () => { await app.fermer(); });
beforeEach(async () => { await vider(app.base, app.redis); });

const connecte = async (cookie: string): Promise<boolean> =>
  (await appel(app, "GET", "/api/session", { cookie })).statut === 200;

describe("compte creer", () => {
  it("crée un compte depuis une entrée redirigée, haché en argon2id ; la connexion l'accepte", async () => {
    const r = await executerCompte(["creer", "  Geoffrey@GEOPLAN.test "], NOUVEAU + "\n");
    expect(r.erreurs).toBe("");
    expect(r.code).toBe(0);
    expect(r.sortie).toBe("Compte créé : " + EMAIL + "\n");

    const lignes = await app.deps.db.select().from(users);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.email).toBe(EMAIL);
    expect(lignes[0]!.id).toMatch(/^u_[A-Za-z0-9_-]{16}$/);
    expect(lignes[0]!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

    expect((await connecter(app, EMAIL, NOUVEAU)).statut).toBe(204);
  });

  it("ne lit que la première ligne, fin de ligne Windows comprise", async () => {
    const r = await executerCompte(["creer", EMAIL], NOUVEAU + "\r\nune-autre-ligne\n");
    expect(r.code).toBe(0);
    expect((await connecter(app, EMAIL, NOUVEAU)).statut).toBe(204);
  });

  it("« créer », avec l'accent de l'ADR, fait la même chose", async () => {
    expect((await executerCompte(["créer", EMAIL], NOUVEAU)).code).toBe(0);
    expect((await connecter(app, EMAIL, NOUVEAU)).statut).toBe(204);
  });

  it("refuse un mot de passe trop court, vide, ou bordé d'une espace, et ne crée rien", async () => {
    for (const [entree, motif] of [
      ["court-123\n", /trop court : 10 caractères au moins/],
      ["", /Aucun mot de passe/],
      ["\n", /Aucun mot de passe/],
      [NOUVEAU + " \n", /espace/]
    ] as const) {
      const r = await executerCompte(["creer", EMAIL], entree);
      expect(r.code, JSON.stringify(entree)).toBe(1);
      expect(r.erreurs).toMatch(motif);
      expect(r.sortie).toBe("");
    }
    expect(await app.deps.db.select().from(users)).toEqual([]);
  });

  it("refuse une adresse déjà prise, ou invalide", async () => {
    await creerCompte(app, EMAIL, ANCIEN);
    const deja = await executerCompte(["creer", EMAIL], NOUVEAU);
    expect(deja.code).toBe(1);
    expect(deja.erreurs).toContain("existe déjà");

    /* Une adresse accentuée est refusée d'emblée : la collation de MySQL
       la confondrait avec le compte existant. */
    for (const adresse of ["pas-une-adresse", "geoffréy@geoplan.test"]) {
      const invalide = await executerCompte(["creer", adresse], NOUVEAU);
      expect(invalide.code, adresse).toBe(1);
      expect(invalide.erreurs).toBe("Erreur : Adresse e-mail invalide\n");
    }

    expect(await app.deps.db.select().from(users)).toHaveLength(1);
    expect((await connecter(app, EMAIL, ANCIEN)).statut).toBe(204);
  });
});

describe("compte mot-de-passe", () => {
  it("change le mot de passe et révoque toutes les sessions du compte, pas celles des autres", async () => {
    await creerCompte(app, EMAIL, ANCIEN);
    await creerCompte(app, "mathieu@geoplan.test", ANCIEN);
    const iphone = cookieDe(await connecter(app, EMAIL, ANCIEN));
    const ordinateur = cookieDe(await connecter(app, EMAIL, ANCIEN));
    const mathieu = cookieDe(await connecter(app, "mathieu@geoplan.test", ANCIEN));

    const r = await executerCompte(["mot-de-passe", EMAIL], NOUVEAU + "\n");
    expect(r.erreurs).toBe("");
    expect(r.code).toBe(0);
    expect(r.sortie).toBe(`Mot de passe changé pour ${EMAIL} ; 2 session(s) révoquée(s)\n`);

    expect(await connecte(iphone)).toBe(false);
    expect(await connecte(ordinateur)).toBe(false);
    expect(await connecte(mathieu)).toBe(true);
    expect((await connecter(app, EMAIL, ANCIEN)).statut).toBe(401);
    expect((await connecter(app, EMAIL, NOUVEAU)).statut).toBe(204);
  });

  it("une adresse sans compte : refus, et rien n'est lu ni écrit", async () => {
    const r = await executerCompte(["mot-de-passe", "personne@geoplan.test"], NOUVEAU);
    expect(r.code).toBe(1);
    expect(r.erreurs).toContain("Aucun compte pour personne@geoplan.test");
  });
});

describe("compte revoquer", () => {
  it("ferme toutes les sessions du compte ; le mot de passe reste le même", async () => {
    await creerCompte(app, EMAIL, ANCIEN);
    const cookie = cookieDe(await connecter(app, EMAIL, ANCIEN));

    const r = await executerCompte(["revoquer", EMAIL]);
    expect(r.code).toBe(0);
    expect(r.sortie).toBe(`1 session(s) révoquée(s) pour ${EMAIL}\n`);
    expect(await connecte(cookie)).toBe(false);
    expect((await connecter(app, EMAIL, ANCIEN)).statut).toBe(204);
  });
});

/* Relecture adversariale de W3 : sans action « supprimer », un compte se
   supprimait en SQL, et ses sessions continuaient de lire et d'écrire
   jusqu'à 180 jours. */
describe("compte supprimer", () => {
  it("révoque les sessions du compte, puis le supprime ; les autres comptes ne bougent pas", async () => {
    await creerCompte(app, EMAIL, ANCIEN);
    await creerCompte(app, "mathieu@geoplan.test", ANCIEN);
    const cookie = cookieDe(await connecter(app, EMAIL, ANCIEN));
    const autre = cookieDe(await connecter(app, "mathieu@geoplan.test", ANCIEN));

    const r = await executerCompte(["supprimer", EMAIL]);
    expect(r.erreurs).toBe("");
    expect(r.code).toBe(0);
    expect(r.sortie).toBe(`Compte supprimé : ${EMAIL} ; 1 session(s) révoquée(s)\n`);
    expect(await connecte(cookie)).toBe(false);
    expect(await connecte(autre)).toBe(true);
    expect((await connecter(app, EMAIL, ANCIEN)).statut).toBe(401);
    expect((await app.deps.db.select({ email: users.email }).from(users)).map(u => u.email)).toEqual(["mathieu@geoplan.test"]);
  });
});

describe("un compte supprimé à la main, en SQL", () => {
  it("ses sessions ne valent plus rien, et sont effacées au passage", async () => {
    await creerCompte(app, EMAIL, ANCIEN);
    const cookie = cookieDe(await connecter(app, EMAIL, ANCIEN));
    expect(await connecte(cookie)).toBe(true);
    await app.deps.db.delete(users);
    expect(await connecte(cookie)).toBe(false);
    expect(await app.redis.keys("sess:*")).toEqual([]);
  });
});

describe("compte lister", () => {
  it("écrit les adresses des comptes, une par ligne, et rien d'autre", async () => {
    await creerCompte(app, "mathieu@geoplan.test", ANCIEN);
    await creerCompte(app, EMAIL, ANCIEN);
    const r = await executerCompte(["lister"]);
    expect(r.code).toBe(0);
    expect(r.erreurs).toBe("");
    expect(r.sortie).toBe(EMAIL + "\nmathieu@geoplan.test\n");
  });
});

describe("compte, mal appelée", () => {
  it("sans action, action inconnue, adresse manquante ou argument de trop : l'aide, code 2", async () => {
    for (const args of [[], ["effacer", EMAIL], ["creer"], ["mot-de-passe"], ["supprimer"], ["lister", EMAIL], ["creer", EMAIL, NOUVEAU]]) {
      const r = await executerCompte(args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.erreurs).toContain("Usage : npm run compte");
    }
    expect(await app.deps.db.select().from(users)).toEqual([]);
  });
});
