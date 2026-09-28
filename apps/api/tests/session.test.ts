/* ============================================================
   Se connecter, rester connecté, se déconnecter (ADR-002)

   Contre la vraie route, un vrai MySQL et un vrai Redis : l'empreinte
   argon2id, le cookie, la limitation de débit et la durée glissante se
   vérifient tels que l'iPhone de Geoffrey les verra.
   ============================================================ */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appel, monterApp, vider, type AppEssai, type Reponse } from "./aides.ts";
import {
  EMAIL, MOT_DE_PASSE, creerCompte, connecter, cookieDe, ligneCookie, identifiant, empreinte, cleSession
} from "./aides-session.ts";
import { session } from "../src/routes/session.ts";
import { DUREE_S, type Session } from "../src/auth/sessions.ts";
import { empreinteSaisie, reseauDe } from "../src/http/limites.ts";

let app: AppEssai;
let userId: string;
beforeAll(async () => { app = await monterApp([session]); });
afterAll(async () => { await app.fermer(); });
beforeEach(async () => {
  await vider(app.base, app.redis);
  userId = await creerCompte(app);
});

const moi = (cookie?: string): Promise<Reponse> => appel(app, "GET", "/api/session", { cookie });
const REFUS = { erreur: "identifiants", message: "Adresse ou mot de passe incorrect" };

describe("POST /api/session — se connecter", () => {
  it("pose un cookie httpOnly de 180 jours, SameSite=Lax, sans Secure en test ; GET rend l'adresse", async () => {
    const r = await connecter(app, EMAIL, MOT_DE_PASSE);
    expect(r.statut).toBe(204);
    const attributs = ligneCookie(r)!.split(";").map(a => a.trim());
    expect(attributs[0]).toMatch(/^geoplan_sid=[A-Za-z0-9_-]{43}$/);   // 32 octets en base64url
    expect(attributs).toEqual(expect.arrayContaining(["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=15552000"]));
    expect(attributs).not.toContain("Secure");

    const g = await moi(cookieDe(r));
    expect(g.statut).toBe(200);
    expect(g.corps).toEqual({ email: EMAIL });
    expect(g.entetes.get("cache-control")).toBe("no-store");
  });

  it("Redis ne garde que l'empreinte de l'identifiant, jamais l'identifiant lui-même", async () => {
    const id = identifiant(cookieDe(await connecter(app, EMAIL, MOT_DE_PASSE)));
    const cles = await app.redis.keys("*");
    expect(cles).toContain("sess:" + empreinte(id));
    expect(cles.join(" ")).not.toContain(id);
    expect(await app.redis.smembers("sessions-de:" + userId)).toEqual([empreinte(id)]);
  });

  it("l'adresse est normalisée : espaces autour et majuscules ne comptent pas", async () => {
    const r = await connecter(app, "  Geoffrey@GEOPLAN.test ", MOT_DE_PASSE);
    expect(r.statut).toBe(204);
    expect((await moi(cookieDe(r))).corps).toEqual({ email: EMAIL });
  });

  it("une adresse qui ne diffère que par un accent n'ouvre pas le compte, bien que MySQL les confonde", async () => {
    /* Le constat qui justifie la comparaison exacte de trouverCompte. */
    const [lignes] = await app.base.pool.query("SELECT id FROM users WHERE email = ?", ["geoffréy@geoplan.test"]);
    expect(lignes).toHaveLength(1);

    const r = await connecter(app, "geoffréy@geoplan.test", MOT_DE_PASSE);
    expect(r.statut).toBe(401);
    expect(r.corps).toEqual(REFUS);
  });

  it("mauvais mot de passe et adresse inconnue : même statut, même corps, aucun cookie", async () => {
    const mauvais = await connecter(app, EMAIL, "pas-le-bon-mot-de-passe");
    const inconnue = await connecter(app, "personne@geoplan.test", MOT_DE_PASSE);
    expect(mauvais.statut).toBe(401);
    expect(inconnue.statut).toBe(401);
    expect(mauvais.corps).toEqual(REFUS);
    expect(inconnue.corps).toEqual(mauvais.corps);
    expect(ligneCookie(mauvais)).toBeUndefined();
    expect(ligneCookie(inconnue)).toBeUndefined();
  });

  it("une adresse inconnue répond aussi lentement qu'un mauvais mot de passe (empreinte factice)", async () => {
    /* Sans vérification factice, l'adresse inconnue répondrait en 2 ms,
       le mauvais mot de passe en 20 ou 30 : un rapport de 1 à 10. Avec,
       les deux font le même travail. 3 essais de chaque, médianes. */
    const duree = async (email: string, mdp: string): Promise<number> => {
      const t0 = performance.now();
      expect((await connecter(app, email, mdp)).statut).toBe(401);
      return performance.now() - t0;
    };
    const connue: number[] = [], inconnue: number[] = [];
    for (let i = 0; i < 3; i++) {
      connue.push(await duree(EMAIL, "pas-le-bon-mot-de-passe"));
      inconnue.push(await duree("personne@geoplan.test", "pas-le-bon-mot-de-passe"));
    }
    const mediane = (t: number[]): number => [...t].sort((a, b) => a - b)[1]!;
    expect(mediane(inconnue)).toBeGreaterThan(mediane(connue) * 0.5);
  });

  it("un corps invalide répond 400 sans rien vérifier", async () => {
    for (const corps of [
      { email: EMAIL },
      { password: MOT_DE_PASSE },
      { email: EMAIL, password: "" },
      { email: "a".repeat(109) + "@geoplan.test", password: MOT_DE_PASSE },   // 122 caractères
      { email: EMAIL, password: "x".repeat(201) },
      { email: 42, password: MOT_DE_PASSE }
    ]) {
      const r = await appel(app, "POST", "/api/session", { corps });
      expect(r.statut, JSON.stringify(corps).slice(0, 60)).toBe(400);
      expect(r.corps.erreur).toBe("requete-invalide");
    }
  });
});

describe("limitation de débit", () => {
  it("le 11ᵉ essai d'une même adresse IP dans le quart d'heure répond 429 avec Retry-After, même juste", async () => {
    /* Des adresses toutes différentes : c'est bien la limite par IP qui
       joue, pas celle par adresse e-mail. */
    for (let i = 1; i <= 10; i++)
      expect((await connecter(app, `essai${i}@geoplan.test`, "au-hasard")).statut).toBe(401);

    const r = await connecter(app, EMAIL, MOT_DE_PASSE);
    expect(r.statut).toBe(429);
    expect(r.corps.erreur).toBe("trop-de-requetes");
    const attente = Number(r.entetes.get("retry-after"));
    expect(attente).toBeGreaterThan(0);
    expect(attente).toBeLessThanOrEqual(15 * 60);

    /* Une autre adresse IP, telle que nginx la transmet, n'est pas
       concernée. */
    const ailleurs = await connecter(app, EMAIL, MOT_DE_PASSE, { entetes: { "x-forwarded-for": "203.0.113.7" } });
    expect(ailleurs.statut).toBe(204);
  });

  it("5 échecs bloquent l'adresse, même avec le bon mot de passe, jusqu'à la fin de la fenêtre", async () => {
    for (let i = 0; i < 4; i++) expect((await connecter(app, EMAIL, "faux-" + i)).statut).toBe(401);
    /* Une réussite ne compte pas comme un échec… */
    expect((await connecter(app, EMAIL, MOT_DE_PASSE)).statut).toBe(204);
    /* …le 5ᵉ échec est encore un refus ordinaire… */
    expect((await connecter(app, EMAIL, "faux-4")).statut).toBe(401);
    /* …et désormais même le bon mot de passe attend. */
    const bloque = await connecter(app, EMAIL, MOT_DE_PASSE);
    expect(bloque.statut).toBe(429);
    const attente = Number(bloque.entetes.get("retry-after"));
    expect(attente).toBeGreaterThan(0);
    expect(attente).toBeLessThanOrEqual(15 * 60);
    expect(ligneCookie(bloque)).toBeUndefined();

    /* Les autres comptes ne sont pas touchés. */
    await creerCompte(app, "mathieu@geoplan.test");
    expect((await connecter(app, "mathieu@geoplan.test", MOT_DE_PASSE)).statut).toBe(204);

    /* La fenêtre se referme : on l'avance plutôt que d'attendre 15 minutes. */
    await app.redis.pexpire("limite:connexion-echecs:" + empreinteSaisie(EMAIL), 1);
    await new Promise(ok => setTimeout(ok, 20));
    expect((await connecter(app, EMAIL, MOT_DE_PASSE)).statut).toBe(204);
  });

  it("une adresse inconnue se bloque comme une vraie : le blocage ne dit pas qui existe", async () => {
    for (let i = 0; i < 5; i++) expect((await connecter(app, "personne@geoplan.test", "faux")).statut).toBe(401);
    expect((await connecter(app, "personne@geoplan.test", "faux")).statut).toBe(429);
  });

  it("changer la casse de l'adresse ne remet pas le compteur à zéro", async () => {
    for (let i = 0; i < 5; i++) expect((await connecter(app, i % 2 ? EMAIL : EMAIL.toUpperCase(), "faux")).statut).toBe(401);
    expect((await connecter(app, " Geoffrey@geoplan.TEST", MOT_DE_PASSE)).statut).toBe(429);
  });

  /* Relecture adversariale de W3 : ce qui était tapé dans le champ de
     l'adresse (souvent le mot de passe) devenait une clé Redis en clair,
     et la limite par IP portait sur l'adresse IPv6 entière. */
  it("ce qui est tapé dans le champ de l'adresse n'apparaît dans aucune clé Redis", async () => {
    const TAPE = "cheval-agrafe-pile-" + Date.now();
    expect((await connecter(app, TAPE, "au-hasard")).statut).toBe(401);
    const cles = await app.redis.keys("*");
    expect(cles).toContain("limite:connexion-echecs:" + empreinteSaisie(TAPE.toLowerCase()));
    for (const k of cles) expect(k).not.toContain("cheval");
  });

  it("en IPv6, tout un /64 compte comme une seule adresse", async () => {
    for (let i = 1; i <= 10; i++)
      expect((await connecter(app, `essai${i}@geoplan.test`, "au-hasard",
        { entetes: { "x-forwarded-for": "2001:db8:1:2::" + i.toString(16) } })).statut).toBe(401);
    const meme = await connecter(app, EMAIL, MOT_DE_PASSE, { entetes: { "x-forwarded-for": "2001:db8:1:2:ffff::1" } });
    expect(meme.statut).toBe(429);
    const voisin = await connecter(app, EMAIL, MOT_DE_PASSE, { entetes: { "x-forwarded-for": "2001:db8:1:3::1" } });
    expect(voisin.statut).toBe(204);
  });

  it("reseauDe : IPv4 seule, IPv6 ramenée à son /64", () => {
    expect(reseauDe("203.0.113.7")).toBe("203.0.113.7");
    expect(reseauDe("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(reseauDe("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(reseauDe("2001:0DB8:0001:0002:0003:0004:0005:0006")).toBe("2001:db8:1:2::/64");
    expect(reseauDe("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(reseauDe("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(reseauDe("::1")).toBe("0:0:0:0::/64");
    expect(reseauDe("64:ff9b::1.2.3.4")).toBe("64:ff9b:0:0::/64");
    expect(reseauDe("1:2:3:4:5:6:1.2.3.4")).toBe("1:2:3:4::/64");
    expect(reseauDe("inconnue")).toBe("inconnue");
  });
});

describe("garde d'origine", () => {
  it("une connexion sans en-tête Origin, ou venue d'une autre origine, répond 403", async () => {
    for (const origine of [null, "https://ailleurs.exemple", "http://geoplan.test.ailleurs.exemple"]) {
      const r = await connecter(app, EMAIL, MOT_DE_PASSE, { origine });
      expect(r.statut, String(origine)).toBe(403);
      expect(r.corps.erreur).toBe("origine");
      expect(ligneCookie(r)).toBeUndefined();
    }
  });

  it("une déconnexion sans Origin, ou venue d'ailleurs, répond 403 et la session tient", async () => {
    const cookie = cookieDe(await connecter(app, EMAIL, MOT_DE_PASSE));
    for (const origine of [null, "https://ailleurs.exemple"])
      expect((await appel(app, "DELETE", "/api/session", { cookie, origine })).statut).toBe(403);
    expect((await moi(cookie)).statut).toBe(200);
  });
});

describe("GET /api/session", () => {
  it("sans cookie, ou avec un identifiant inconnu : 401", async () => {
    expect((await moi()).statut).toBe(401);
    const r = await moi("geoplan_sid=" + "A".repeat(43));
    expect(r.statut).toBe(401);
    expect(r.corps).toMatchObject({ erreur: "non-connecte" });
  });
});

describe("DELETE /api/session — se déconnecter", () => {
  it("la session ne vaut plus rien, et le cookie est effacé", async () => {
    const cookie = cookieDe(await connecter(app, EMAIL, MOT_DE_PASSE));
    const id = identifiant(cookie);

    const r = await appel(app, "DELETE", "/api/session", { cookie });
    expect(r.statut).toBe(204);
    const efface = ligneCookie(r)!;
    expect(efface).toMatch(/^geoplan_sid=;/);
    expect(efface).toContain("Expires=Thu, 01 Jan 1970");
    expect(efface).toContain("Path=/");

    expect((await moi(cookie)).statut).toBe(401);
    expect(await app.redis.exists(cleSession(id))).toBe(0);
    expect(await app.redis.smembers("sessions-de:" + userId)).toEqual([]);
  });

  it("sans session, ou avec une session déjà disparue : 204 quand même", async () => {
    expect((await appel(app, "DELETE", "/api/session")).statut).toBe(204);
    expect((await appel(app, "DELETE", "/api/session", { cookie: "geoplan_sid=inconnu" })).statut).toBe(204);
  });

  it("se reconnecter depuis le même navigateur remplace l'ancienne session", async () => {
    const ancien = cookieDe(await connecter(app, EMAIL, MOT_DE_PASSE));
    const nouveau = cookieDe(await connecter(app, EMAIL, MOT_DE_PASSE, { cookie: ancien }));
    expect(nouveau).not.toBe(ancien);
    expect((await moi(ancien)).statut).toBe(401);
    expect((await moi(nouveau)).statut).toBe(200);
    expect(await app.redis.scard("sessions-de:" + userId)).toBe(1);
  });
});

describe("durée glissante de 180 jours", () => {
  /* On vieillit la session à la main : TTL court, vuLe dans le passé. */
  async function vieillir(cookie: string, vuIlYa: number, ttlS: number): Promise<string> {
    const cle = cleSession(identifiant(cookie));
    const s = JSON.parse((await app.redis.get(cle))!) as Session;
    s.vuLe = Date.now() - vuIlYa;
    await app.redis.set(cle, JSON.stringify(s), "EX", ttlS);
    return cle;
  }

  it("une session vue il y a plus d'une heure repart pour 180 jours à la requête suivante", async () => {
    const cookie = cookieDe(await connecter(app, EMAIL, MOT_DE_PASSE));
    const cle = await vieillir(cookie, 2 * 3600_000, 1000);

    expect((await moi(cookie)).statut).toBe(200);
    expect(await app.redis.ttl(cle)).toBeGreaterThan(DUREE_S - 60);
    const s = JSON.parse((await app.redis.get(cle))!) as Session;
    expect(Date.now() - s.vuLe).toBeLessThan(60_000);
  });

  it("une session vue il y a moins d'une heure n'est pas réécrite", async () => {
    const cookie = cookieDe(await connecter(app, EMAIL, MOT_DE_PASSE));
    const cle = await vieillir(cookie, 10 * 60_000, 1000);

    expect((await moi(cookie)).statut).toBe(200);
    expect(await app.redis.ttl(cle)).toBeLessThanOrEqual(1000);
  });
});

describe("en production", () => {
  it("le cookie porte Secure, à la pose comme à l'effacement", async () => {
    const ORIGINE = "https://geoplan.exemple.fr";
    const prod = await monterApp([session], { NODE_ENV: "production", APP_ORIGIN: ORIGINE });
    try {
      const r = await connecter(prod, EMAIL, MOT_DE_PASSE, { origine: ORIGINE });
      expect(r.statut).toBe(204);
      const attributs = ligneCookie(r)!.split(";").map(a => a.trim());
      expect(attributs).toEqual(expect.arrayContaining(["Secure", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=15552000"]));

      const d = await appel(prod, "DELETE", "/api/session", { cookie: cookieDe(r), origine: ORIGINE });
      expect(d.statut).toBe(204);
      expect(ligneCookie(d)!.split(";").map(a => a.trim())).toContain("Secure");
    } finally { await prod.fermer(); }
  });
});
