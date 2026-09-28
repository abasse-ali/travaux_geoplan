/* ============================================================
   Amorçage et migration Supabase → MySQL

   L'écrivain est rejouable, ne perd rien, et traduit ce que Supabase
   ne savait pas dire (l'urgence) sans casser la règle de la base.
   ============================================================ */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { normPerson, normSite, type Person, type Site, type Avail } from "@geoplan/domain";
import { ouvrirBase, type Base } from "../src/db/client.ts";
import { ouvrirRedis, type Redis } from "../src/redis.ts";
import { importer, compter, ImportRefuse } from "../src/migration/importer.ts";
import { lireSupabase } from "../src/migration/supabase.ts";
import { vider } from "./aides.ts";

/* Une réponse comme celles de PostgREST, total compris (Prefer: count=exact). */
function reponsePostgrest(lignes: unknown[], debut = 0, total = lignes.length): Response {
  const plage = lignes.length ? debut + "-" + (debut + lignes.length - 1) : "*";
  return Response.json(lignes, { headers: { "content-range": plage + "/" + total } });
}

let base: Base;
let redis: Redis;
beforeAll(() => { base = ouvrirBase(inject("DATABASE_URL")); redis = ouvrirRedis(inject("REDIS_URL")); });
afterAll(async () => { await base.fermer(); redis.disconnect(); });
beforeEach(async () => { await vider(base, redis); });

const effectif = JSON.parse(readFileSync(
  new URL("../../../packages/domain/sim/effectif-reference.json", import.meta.url), "utf8")) as { people: Person[]; sites: Site[] };

/* Deux chantiers, un plan qui pose Nixon sur les deux le même lundi
   (Supabase ne gardait pas l'urgence), et un compagnon inconnu. */
function avecDoublon(): { people: Person[]; sites: Site[]; avail: Avail[] } {
  const sites = effectif.sites.slice(0, 2).map(s => ({ ...s, plan: {} as Record<string, string[]> }));
  sites[0].plan["2026-09-14"] = ["p_nixon", "p_erwan"];
  sites[1].plan["2026-09-14"] = ["p_giorgi", "p_nixon", "p_fantome"];
  const avail: Avail[] = [
    { id: "p_nixon@2026-09-21", token: "ancienjetonsupa18c", personId: "p_nixon", week: "2026-09-21",
      days: [true, false, true, false, false, false, false], note: "tôt", answeredAt: "2026-09-19T08:00:00Z" },
    { id: "p_fantome@2026-09-21", token: "jetonorphelin12345", personId: "p_fantome", week: "2026-09-21",
      days: null, note: "", answeredAt: null }
  ];
  return { people: effectif.people, sites, avail };
}

describe("importer", () => {
  it("amorce une base neuve depuis l'effectif de référence", async () => {
    const r = await importer(base.db, { people: effectif.people, sites: effectif.sites, avail: [] });
    expect(r.avant).toEqual({ people: 0, sites: 0, assignments: 0, avail_requests: 0 });
    expect(r.apres).toEqual({ people: 13, sites: 3, assignments: 0, avail_requests: 0 });
  });

  it("à blanc, calcule le rapport et n'écrit rien", async () => {
    const r = await importer(base.db, avecDoublon(), { aBlanc: true });
    expect(r.aBlanc).toBe(true);
    expect(r.doublesEnUrgence).toHaveLength(1);
    expect(await compter(base.db)).toEqual({ people: 0, sites: 0, assignments: 0, avail_requests: 0 });
  });

  it("pose en urgence la seconde occurrence d'un doublon, ignore l'inconnu, garde les jetons", async () => {
    const r = await importer(base.db, avecDoublon());
    expect(r.doublesEnUrgence).toEqual([{ chantier: "s_12ab49", jour: "2026-09-14", compagnon: "p_nixon" }]);
    expect(r.orphelines).toEqual([{ chantier: "s_12ab49", jour: "2026-09-14", compagnon: "p_fantome" }]);
    expect(r.demandesIgnorees).toEqual(["p_fantome@2026-09-21"]);
    expect(r.apres.assignments).toBe(4);

    const [lignes] = await base.pool.query(
      "SELECT site_id, person_id, urgence, position FROM assignments WHERE day = '2026-09-14' ORDER BY site_id, position");
    expect(lignes).toEqual([
      { site_id: "s_12ab49", person_id: "p_giorgi", urgence: 0, position: 0 },
      { site_id: "s_12ab49", person_id: "p_nixon", urgence: 1, position: 1 },
      { site_id: "s_9md49", person_id: "p_nixon", urgence: 0, position: 0 },
      { site_id: "s_9md49", person_id: "p_erwan", urgence: 0, position: 1 }
    ]);
    const [demandes] = await base.pool.query("SELECT token, days, note, answered_at FROM avail_requests");
    expect(demandes).toEqual([{
      token: "ancienjetonsupa18c", days: [true, false, true, false, false, false, false],
      note: "tôt", answered_at: "2026-09-19 08:00:00.000"
    }]);
  });

  it("rejoué sur les mêmes données, ne change rien", async () => {
    await importer(base.db, avecDoublon());
    const premier = await compter(base.db);
    const r = await importer(base.db, avecDoublon());
    expect(r.avant).toEqual(premier);
    expect(r.apres).toEqual(premier);
  });

  it("ne touche pas aux affectations des chantiers que l'import ne cite pas", async () => {
    await importer(base.db, { people: effectif.people, sites: effectif.sites, avail: [] });
    await base.pool.query(
      "INSERT INTO assignments (site_id, day, person_id, urgence, occupe, position) VALUES ('s_30ja90', '2026-09-14', 'p_nixon', 0, 1, 0)");
    const r = await importer(base.db, avecDoublon());
    /* Nixon, déjà occupé le 14 sur 30JA90, passe en urgence partout où
       l'import le pose ce jour-là : la base ne refuse rien. */
    expect(r.doublesEnUrgence.map(d => d.chantier).sort()).toEqual(["s_12ab49", "s_9md49"]);
  });
});

describe("lireSupabase", () => {
  /* Un faux Supabase : il vérifie qu'on s'y présente comme l'application
     (clé publiable, puis jeton de session) et rend des lignes au format
     de supabase/schema.sql. */
  function fauxSupabase(vus: string[]): typeof fetch {
    return (async (entree: string | URL | Request, init?: RequestInit) => {
      const url = String(entree);
      const h = new Headers(init?.headers);
      vus.push(url.replace(/^https:\/\/[^/]+/, "") + " " + (h.get("authorization") ? "avec-jeton" : "sans-jeton"));
      expect(h.get("apikey")).toBe("sb_publishable_essai");
      if (url.endsWith("/auth/v1/token?grant_type=password")) {
        const corps = JSON.parse(String(init?.body));
        if (corps.password !== "bon") return new Response("{}", { status: 400 });
        return Response.json({ access_token: "jeton-session" });
      }
      expect(h.get("authorization")).toBe("Bearer jeton-session");
      expect(h.get("prefer")).toBe("count=exact");
      if (url.includes("/rest/v1/people")) return reponsePostgrest(effectif.people.slice(0, 2));
      if (url.includes("/rest/v1/sites")) return reponsePostgrest([{
        id: "s_9md49", code: "9MD49", addr: "9 Mont Doré", start_date: "2026-08-31", months: 2, coef: 1,
        ph: Array(12).fill(0), note: "", plan: { "2026-09-14": ["p_geoffrey"] }, tasks: {}
      }]);
      if (url.includes("/rest/v1/avail_requests")) return reponsePostgrest([{
        id: "p_geoffrey@2026-09-21", token: "abcdefghijkmnpqrst", person_id: "p_geoffrey",
        week: "2026-09-21", days: null, note: "", answered_at: null
      }]);
      return new Response("", { status: 404 });
    }) as typeof fetch;
  }

  it("se connecte comme l'application, lit les trois tables et les traduit", async () => {
    const vus: string[] = [];
    const d = await lireSupabase({ url: "https://projet.supabase.co", cle: "sb_publishable_essai",
      email: "geoffrey@exemple.fr", motDePasse: "bon", fetch: fauxSupabase(vus) });
    expect(vus).toEqual([
      "/auth/v1/token?grant_type=password sans-jeton",
      "/rest/v1/people?select=*&order=id.asc avec-jeton",
      "/rest/v1/sites?select=*&order=id.asc avec-jeton",
      "/rest/v1/avail_requests?select=*&order=id.asc avec-jeton"
    ]);
    expect(d.sites[0].start).toBe("2026-08-31");
    expect(d.avail[0]).toMatchObject({ personId: "p_geoffrey", answeredAt: null, token: "abcdefghijkmnpqrst" });

    const r = await importer(base.db, d);
    expect(r.apres).toEqual({ people: 2, sites: 1, assignments: 1, avail_requests: 1 });
  });

  it("refuse une clé secrète, et un mot de passe faux", async () => {
    await expect(lireSupabase({ url: "https://p.supabase.co", cle: "sb_secret_x", email: "a@b.fr", motDePasse: "x" }))
      .rejects.toThrow(/Clé secrète refusée/);
    await expect(lireSupabase({ url: "https://p.supabase.co", cle: "sb_publishable_essai",
      email: "a@b.fr", motDePasse: "faux", fetch: fauxSupabase([]) })).rejects.toThrow(/refusée \(400\)/);
  });
});

describe("migration — ce que la relecture a montré", () => {
  it("lit au-delà du plafond de 1 000 lignes de Supabase, page par page", async () => {
    const pages: string[] = [];
    const nombreux = Array.from({ length: 1003 }, (_, i) => ({ ...effectif.people[i % 13], id: "p_" + String(i).padStart(4, "0") }));
    const f = (async (entree: string | URL | Request, init?: RequestInit) => {
      const url = String(entree);
      if (url.includes("/auth/")) return Response.json({ access_token: "j" });
      const plage = new Headers(init?.headers).get("range") || "";
      pages.push(url.split("/rest/v1/")[1]?.split("?")[0] + " " + plage);
      const [a, b] = plage.split("-").map(Number);
      /* Comme PostgREST : jamais plus de 1 000 lignes par réponse. */
      const tout = url.includes("/people") ? nombreux : [];
      return reponsePostgrest(tout.slice(a, Math.min(b + 1, a + 1000)), a, tout.length);
    }) as typeof fetch;
    const d = await lireSupabase({ url: "https://p.supabase.co", cle: "sb_publishable_essai", email: "a@b.fr", motDePasse: "x", fetch: f });
    expect(d.people).toHaveLength(1003);
    expect(pages.filter(p => p.startsWith("people"))).toEqual(["people 0-999", "people 1000-1999"]);
  });

  /* Relecture adversariale de W3 : la lecture s'arrêtait à la première
     page incomplète. Un projet réglé à 500 lignes par réponse était lu à
     500 lignes sur 1 200, sans erreur. */
  it("lit tout un projet réglé plus bas que 1 000 lignes par réponse", async () => {
    const nombreux = Array.from({ length: 1200 }, (_, i) => ({ ...effectif.people[i % 13], id: "p_" + String(i).padStart(4, "0") }));
    const f = (async (entree: string | URL | Request, init?: RequestInit) => {
      const url = String(entree);
      if (url.includes("/auth/")) return Response.json({ access_token: "j" });
      const [a, b] = (new Headers(init?.headers).get("range") || "").split("-").map(Number);
      const tout = url.includes("/people") ? nombreux : [];
      return reponsePostgrest(tout.slice(a, Math.min(b + 1, a + 500)), a, tout.length);
    }) as typeof fetch;
    const d = await lireSupabase({ url: "https://p.supabase.co", cle: "sb_publishable_essai", email: "a@b.fr", motDePasse: "x", fetch: f });
    expect(d.people.map(p => p.id)).toEqual(nombreux.map(p => p.id));
  });

  it("sans total, ou avec une page vide avant le total, refuse plutôt que de tronquer", async () => {
    const auth = (url: string) => url.includes("/auth/") ? Response.json({ access_token: "j" }) : null;
    const sansTotal = (async (e: string | URL | Request) => auth(String(e)) ?? Response.json([])) as typeof fetch;
    await expect(lireSupabase({ url: "https://p.supabase.co", cle: "sb_publishable_essai", email: "a@b.fr", motDePasse: "x", fetch: sansTotal }))
      .rejects.toThrow(/nombre de lignes de people/);
    const troue = (async (e: string | URL | Request) => auth(String(e)) ?? reponsePostgrest([], 0, 5)) as typeof fetch;
    await expect(lireSupabase({ url: "https://p.supabase.co", cle: "sb_publishable_essai", email: "a@b.fr", motDePasse: "x", fetch: troue }))
      .rejects.toThrow(/incomplète : 0 lignes sur 5/);
  });

  it("garde l'échéance d'origine d'une demande : un lien expiré dans Supabase reste expiré", async () => {
    await importer(base.db, {
      people: effectif.people.slice(0, 1), sites: [],
      avail: [{ id: "p_geoffrey@2026-06-01", token: "vieuxjetonexpire123", personId: "p_geoffrey", week: "2026-06-01",
        days: null, note: "", answeredAt: null, createdAt: "2026-05-30T07:00:00Z", expiresAt: "2026-07-29T07:00:00Z" }]
    });
    const [l] = await base.pool.query("SELECT created_at, expires_at FROM avail_requests");
    expect(l).toEqual([{ created_at: "2026-05-30 07:00:00.000", expires_at: "2026-07-29 07:00:00.000" }]);
  });

  it("rejouée, n'efface pas une réponse donnée entre-temps par le lien de l'API", async () => {
    await importer(base.db, avecDoublon());
    /* Nixon répond par l'API, plus tard que sa réponse connue de Supabase. */
    await base.pool.query(
      "UPDATE avail_requests SET days = ?, note = 'finalement', answered_at = '2026-09-20 18:00:00' WHERE id = 'p_nixon@2026-09-21'",
      [JSON.stringify([false, true, false, true, false, false, false])]);
    await importer(base.db, avecDoublon());
    const [l] = await base.pool.query("SELECT days, note FROM avail_requests WHERE id = 'p_nixon@2026-09-21'");
    expect(l).toEqual([{ days: [false, true, false, true, false, false, false], note: "finalement" }]);
  });
});

/* ---------- ce que la relecture adversariale de W3 a montré ---------- */

const compagnon = (id: string, champs: Partial<Person> = {}): Person => normPerson(id, { name: id, ...champs });
const chantier = (id: string, plan: Record<string, string[]> = {}): Site =>
  normSite(id, { code: id.toUpperCase(), start: "2026-08-31", plan });
const MARDI = "2026-09-15";
const SEMAINE = "2026-09-28";
const jetonDe = async (id: string): Promise<string> =>
  ((await base.pool.query("SELECT token FROM avail_requests WHERE id = ?", [id]))[0] as { token: string }[])[0]!.token;

describe("importer en miroir", () => {
  it("ce que la source n'a plus disparaît : le compagnon parti, le chantier supprimé et son affectation", async () => {
    await importer(base.db, {
      people: [compagnon("p_erwan"), compagnon("p_parti", { email: "parti@exemple.fr" })],
      sites: [chantier("s_a"), chantier("s_supprime", { [MARDI]: ["p_erwan"] })], avail: []
    }, { miroir: true });
    const r = await importer(base.db, {
      people: [compagnon("p_erwan")], sites: [chantier("s_a", { [MARDI]: ["p_erwan"] })], avail: []
    }, { miroir: true });
    expect(r.supprimes).toEqual({ people: ["p_parti"], sites: ["s_supprime"], avail: [] });
    /* L'ancienne affectation ne fait plus passer la vraie en urgence. */
    expect(r.doublesEnUrgence).toEqual([]);
    const [lignes] = await base.pool.query("SELECT site_id, person_id, urgence FROM assignments");
    expect(lignes).toEqual([{ site_id: "s_a", person_id: "p_erwan", urgence: 0 }]);
    expect(await compter(base.db)).toMatchObject({ people: 1, sites: 1 });
  });

  it("à blanc, nomme ce qui serait supprimé, et n'écrit rien", async () => {
    await importer(base.db, { people: [compagnon("p_erwan"), compagnon("p_parti")], sites: [chantier("s_a")], avail: [] });
    const avant = await compter(base.db);
    const r = await importer(base.db, { people: [compagnon("p_erwan")], sites: [], avail: [] }, { miroir: true, aBlanc: true });
    expect(r.supprimes).toEqual({ people: ["p_parti"], sites: ["s_a"], avail: [] });
    expect(await compter(base.db)).toEqual(avant);
  });

  it("garde une demande absente de la source que l'API a déjà envoyée ; supprime les autres", async () => {
    await importer(base.db, { people: [compagnon("p_nixon"), compagnon("p_kia")], sites: [], avail: [] });
    await base.pool.query(`INSERT INTO avail_requests (id, token, person_id, week, created_at, expires_at, sent_at) VALUES
      ('p_nixon@${SEMAINE}', 'jetonenvoyeparlapi1', 'p_nixon', '${SEMAINE}', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 60 DAY, UTC_TIMESTAMP(3)),
      ('p_kia@${SEMAINE}', 'jetonjamaisenvoye12', 'p_kia', '${SEMAINE}', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 60 DAY, NULL)`);
    const r = await importer(base.db, { people: [compagnon("p_nixon"), compagnon("p_kia")], sites: [], avail: [] }, { miroir: true });
    expect(r.demandesGardees).toEqual(["p_nixon@" + SEMAINE]);
    expect(r.supprimes.avail).toEqual(["p_kia@" + SEMAINE]);
    const [ids] = await base.pool.query("SELECT id FROM avail_requests");
    expect(ids).toEqual([{ id: "p_nixon@" + SEMAINE }]);
  });
});

describe("importer — fiches, jetons, identifiants, relances", () => {
  const version = async (table: "people" | "sites", id: string): Promise<number> =>
    ((await base.pool.query("SELECT version FROM " + table + " WHERE id = ?", [id]))[0] as { version: number }[])[0]!.version;

  it("une fiche n'est réécrite que si elle a changé, et sa version avance alors", async () => {
    const donnees = (note: string) => ({ people: [compagnon("p_erwan", { note })], sites: [{ ...chantier("s_a"), note }], avail: [] });
    await importer(base.db, donnees("a"));
    const meme = await importer(base.db, donnees("a"));
    expect(meme.modifies).toEqual({ people: [], sites: [] });
    expect([await version("people", "p_erwan"), await version("sites", "s_a")]).toEqual([1, 1]);
    const autre = await importer(base.db, donnees("b"));
    expect(autre.modifies).toEqual({ people: ["p_erwan"], sites: ["s_a"] });
    /* Un appareil qui avait lu la version 1 recevra un 409, comme après
       tout PATCH (ADR-003). */
    expect([await version("people", "p_erwan"), await version("sites", "s_a")]).toEqual([2, 2]);
  });

  it("le jeton de la source l'emporte, sauf si l'API a déjà diffusé le sien", async () => {
    await importer(base.db, { people: [compagnon("p_nixon"), compagnon("p_kia")], sites: [], avail: [] });
    await base.pool.query(`INSERT INTO avail_requests (id, token, person_id, week, created_at, expires_at, sent_at) VALUES
      ('p_nixon@${SEMAINE}', 'jetonapinonenvoye1', 'p_nixon', '${SEMAINE}', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 60 DAY, NULL),
      ('p_kia@${SEMAINE}', 'jetonapienvoye1234', 'p_kia', '${SEMAINE}', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 60 DAY, UTC_TIMESTAMP(3))`);
    const demande = (pid: string, token: string): Avail =>
      ({ id: pid + "@" + SEMAINE, token, personId: pid, week: SEMAINE, days: null, note: "", answeredAt: null });
    const r = await importer(base.db, {
      people: [compagnon("p_nixon"), compagnon("p_kia")], sites: [],
      avail: [demande("p_nixon", "supabasejetonnixon"), demande("p_kia", "supabasejetonkia18")]
    });
    expect(r.jetonsNonImportes).toEqual(["p_kia@" + SEMAINE]);
    expect(await jetonDe("p_nixon@" + SEMAINE)).toBe("supabasejetonnixon");
    expect(await jetonDe("p_kia@" + SEMAINE)).toBe("jetonapienvoye1234");
  });

  it("un identifiant que l'API refuserait bloque l'écriture ; à blanc, il est nommé", async () => {
    const donnees = { people: [compagnon("p_élodie"), compagnon("p_erwan")], sites: [chantier("s a")], avail: [] };
    const r = await importer(base.db, donnees, { aBlanc: true, miroir: true });
    expect(r.identifiantsInvalides).toEqual(["p_élodie", "s a"]);
    await expect(importer(base.db, donnees, { miroir: true })).rejects.toBeInstanceOf(ImportRefuse);
    expect(await compter(base.db)).toEqual({ people: 0, sites: 0, assignments: 0, avail_requests: 0 });
  });

  it("une demande dont la relance Supabase est passée arrive relancée ; les suivantes restent à relancer", async () => {
    const demande = (week: string, token: string): Avail =>
      ({ id: "p_nixon@" + week, token, personId: "p_nixon", week, days: null, note: "", answeredAt: null });
    /* Mercredi 30 septembre : la relance du samedi 26 (semaine du 28) est
       partie de Supabase ; celle du samedi 3 octobre, pas encore. */
    await importer(base.db, {
      people: [compagnon("p_nixon")], sites: [],
      avail: [demande("2026-09-28", "jetonsemaine28abcd"), demande("2026-10-05", "jetonsemaine05abcd")]
    }, { maintenant: new Date("2026-09-30T10:00:00Z") });
    const [l] = await base.pool.query("SELECT week, sent_at FROM avail_requests ORDER BY week");
    expect(l).toEqual([
      { week: "2026-09-28", sent_at: "2026-09-26 07:00:00.000" },
      { week: "2026-10-05", sent_at: null }
    ]);
  });
});

describe("amorcer", () => {
  const AMORCER = fileURLToPath(new URL("../src/cli/amorcer.ts", import.meta.url));
  const lancer = (args: string[]): Promise<{ code: number; erreurs: string }> => new Promise(ok => {
    execFile(process.execPath, ["--disable-warning=ExperimentalWarning", AMORCER, ...args],
      { env: { ...process.env, DATABASE_URL: inject("DATABASE_URL") } },
      (e, _sortie, erreurs) => ok({ code: e ? Number(e.code ?? 1) : 0, erreurs }));
  });

  /* Relecture adversariale de W3 : lancé sur la base en service, il
     vidait les plans et les coches des vrais chantiers. */
  it("refuse une base qui n'est pas vide, sauf --forcer", async () => {
    const fichier = join(mkdtempSync(join(tmpdir(), "geoplan-amorcer-")), "effectif.json");
    writeFileSync(fichier, JSON.stringify({ people: effectif.people, sites: effectif.sites }));
    expect((await lancer([fichier])).code).toBe(0);
    await base.pool.query("INSERT INTO assignments (site_id, day, person_id, urgence, occupe, position) VALUES (?, '2026-09-15', ?, 0, 1, 0)",
      [effectif.sites[0].id, effectif.people[0].id]);

    const refus = await lancer([fichier]);
    expect(refus.code).toBe(1);
    expect(refus.erreurs).toContain("La base n'est pas vide");
    expect((await compter(base.db)).assignments).toBe(1);

    expect((await lancer([fichier, "--forcer"])).code).toBe(0);
  });
});
