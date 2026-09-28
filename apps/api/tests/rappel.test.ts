/* ============================================================
   La relance du samedi : semaine visée, à blanc, envoi réel contre un
   faux Brevo local, lancements simultanés, planification, commande,
   journaux. Aucun e-mail réel ne part : en mode « brevo », la
   configuration d'essai pointe toujours sur le faux serveur.
   ============================================================ */

import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { weekNum } from "@geoplan/domain";
import { ORIGINE, appel, configEssai, vider } from "./aides.ts";
import {
  CLE_BREVO_ESSAI, ajouterCompagnon, ajouterDemande, configBrevo, demarrerFauxBrevo, lireDemande,
  lireDemandes, lireExecutions, monterAppDispo, type AppDispo, type FauxBrevo
} from "./aides-dispo.ts";
import { semaineVisee } from "../src/dispo/semaine.ts";
import { erreurSansDonnees, nouveauJeton } from "../src/dispo/demandes.ts";
import { lancerRappel, type OptionsRappel } from "../src/taches/rappel.ts";
import { planifierTaches } from "../src/taches.ts";
import { availRequests } from "../src/db/schema.ts";

const SAMEDI = new Date("2026-09-26T07:00:00Z");       // samedi 26 septembre 2026, 9 h à Paris
const SEMAINE = "2026-09-28";
const NOM_KIA = `Kia<i>&"'`;                           // de quoi casser un HTML mal échappé
const JOURS = [true, true, false, false, true, false, false];

let app: AppDispo;
let faux: FauxBrevo;
let jetonNixon: string;

beforeAll(async () => {
  app = await monterAppDispo();
  faux = await demarrerFauxBrevo();
});
afterAll(async () => {
  await app.fermer();
  await faux.fermer();
});

/* L'effectif d'essai : un compagnon qui a déjà répondu, un sans demande
   au nom piégé, un dont la demande attend, un sans adresse. */
beforeEach(async () => {
  await vider(app.base, app.redis);
  faux.vider();
  app.changements.length = 0;
  app.journal.length = 0;
  await ajouterCompagnon(app.base, "p_giorgi", "Giorgi", "giorgi@exemple.fr");
  await ajouterCompagnon(app.base, "p_kia", NOM_KIA, "kia@exemple.fr");
  await ajouterCompagnon(app.base, "p_nixon", "Nixon", "nixon@exemple.fr");
  await ajouterCompagnon(app.base, "p_erwan", "Erwan");
  await ajouterDemande(app.base, { personId: "p_giorgi", semaine: SEMAINE, jours: JOURS });
  jetonNixon = await ajouterDemande(app.base, { personId: "p_nixon", semaine: SEMAINE });
});

const aBlanc = (o: OptionsRappel = {}) => lancerRappel(app.deps, { maintenant: SAMEDI, ...o });
const reel = (o: OptionsRappel = {}, plus: Record<string, string> = {}) =>
  lancerRappel({ ...app.deps, config: configBrevo(faux, plus) }, { maintenant: SAMEDI, ...o });
const destinataires = () => faux.recus.map(r => r.corps.to[0].email as string);

describe("la semaine visée", () => {
  it("samedi 26 septembre 2026 → lundi 28 septembre", () => {
    expect(semaineVisee(new Date("2026-09-26T07:00:00Z"))).toBe("2026-09-28");
  });

  it("samedi 24 octobre 2026, veille du passage à l'heure d'hiver → lundi 26 octobre", () => {
    expect(semaineVisee(new Date("2026-10-24T07:00:00Z"))).toBe("2026-10-26");
    expect(semaineVisee(new Date("2026-10-24T21:59:59Z"))).toBe("2026-10-26");   // 23 h 59 à Paris
  });

  it("samedi 26 décembre 2026 → lundi 28 décembre, en semaine 53", () => {
    expect(semaineVisee(new Date("2026-12-26T08:00:00Z"))).toBe("2026-12-28");
    expect(weekNum("2026-12-28")).toBe(53);
  });

  it("compte à l'heure de Paris : lundi 0 h 30 à Paris, encore dimanche en UTC, vise le lundi d'après", () => {
    expect(semaineVisee(new Date("2026-09-27T22:30:00Z"))).toBe("2026-10-05");
  });
});

describe("la relance à blanc", () => {
  it("fait un bilan juste, sans rien envoyer ni rien écrire dans les demandes", async () => {
    const avant = await lireDemandes(app.base);
    const bilan = await aBlanc();
    expect(bilan).toEqual({
      statut: "fait", semaine: SEMAINE, aBlanc: true,
      envoyes: 2,           // Kia et Nixon
      deja: 1,              // Giorgi a répondu
      dejaEnvoyes: 0,
      sans: 1,              // Erwan n'a pas d'adresse
      creees: 1,            // la demande de Kia, qui serait créée
      erreurs: []
    });
    expect(faux.recus).toHaveLength(0);
    expect(await lireDemandes(app.base)).toEqual(avant);
    expect(app.changements).toEqual([]);
  });

  it("relancée pour la même semaine, elle ne refait rien ; --forcer la refait", async () => {
    await aBlanc();
    const seconde = await aBlanc();
    expect(seconde).toMatchObject({ statut: "deja-faite", semaine: SEMAINE, aBlanc: true, envoyes: 0 });
    expect(await lireExecutions(app.base)).toHaveLength(1);

    expect((await aBlanc({ forcer: true })).statut).toBe("fait");
    expect(await lireExecutions(app.base)).toHaveLength(2);
    expect(faux.recus).toHaveLength(0);
  });

  it("laisse sa trace dans job_runs", async () => {
    const bilan = await aBlanc();
    const [x] = await lireExecutions(app.base);
    expect(x).toMatchObject({ job: "rappel", cle: SEMAINE, a_blanc: 1 });
    expect(x.started_at).toBeTruthy();
    expect(x.finished_at).toBeTruthy();
    expect(x.bilan).toEqual(bilan);
  });

  it("ne bloque pas la vraie relance de la même semaine", async () => {
    await aBlanc();
    const bilan = await reel();
    expect(bilan).toMatchObject({ statut: "fait", aBlanc: false, envoyes: 2 });
    expect(faux.recus).toHaveLength(2);
  });

  /* Relecture adversariale de W3 : les deux partageaient le même verrou,
     et une relance à blanc lancée à la main à 9 h faisait répondre
     « déjà en cours » à la vraie. */
  it("même en cours au moment où part la vraie relance", async () => {
    await app.redis.set("verrou:rappel-a-blanc:" + SEMAINE, "une-relance-a-blanc", "EX", 60);
    expect(await reel()).toMatchObject({ statut: "fait", envoyes: 2 });
  });

  it("l'envoi réel est refusé tant que MAIL_MODE n'est pas brevo", async () => {
    await expect(aBlanc({ aBlanc: false })).rejects.toThrow(/MAIL_MODE=brevo/);
    expect(faux.recus).toHaveLength(0);
    expect(await lireExecutions(app.base)).toEqual([]);
  });

  it("refuse une semaine qui n'est pas un lundi", async () => {
    await expect(aBlanc({ semaine: "2026-09-29" })).rejects.toThrow(/lundi/);
  });
});

describe("la relance réelle, contre un faux Brevo", () => {
  it("envoie un e-mail par compagnon concerné, texte et HTML justes, et pose sent_at", async () => {
    const bilan = await reel();
    expect(bilan).toEqual({
      statut: "fait", semaine: SEMAINE, aBlanc: false,
      envoyes: 2, deja: 1, dejaEnvoyes: 0, sans: 1, creees: 1, erreurs: []
    });
    expect(destinataires()).toEqual(["kia@exemple.fr", "nixon@exemple.fr"]);

    const kia = (await lireDemande(app.base, "p_kia@" + SEMAINE))!;
    const nixon = (await lireDemande(app.base, "p_nixon@" + SEMAINE))!;
    const giorgi = (await lireDemande(app.base, "p_giorgi@" + SEMAINE))!;
    expect(nixon.token).toBe(jetonNixon);                  // le lien existant n'a pas changé
    expect(kia.sent_at).toBeTruthy();
    expect(nixon.sent_at).toBeTruthy();
    expect(giorgi.sent_at).toBeNull();

    const e = faux.recus[0];
    const lien = ORIGINE + "/dispo.html?t=" + kia.token;
    expect(e.entetes["api-key"]).toBe(CLE_BREVO_ESSAI);
    expect(e.corps).toMatchObject({
      sender: { email: "planning@geoplan.test", name: "Geoffrey" },
      to: [{ email: "kia@exemple.fr", name: NOM_KIA }],
      replyTo: { email: "geoffrey@geoplan.test", name: "Geoffrey" },
      subject: "Tes dispos pour la semaine du 28 sept. – 4 oct. ?"
    });
    expect(e.corps.textContent).toBe(
`Bonjour ${NOM_KIA},

Peux-tu m'indiquer tes jours de présence pour la semaine du 28 sept. – 4 oct. ?
Ça prend trente secondes, il n'y a rien à installer :

${lien}

Merci,
Geoffrey`);
    const html: string = e.corps.htmlContent;
    expect(html).toContain("Bonjour Kia&lt;i&gt;&amp;&quot;&#39;</h1>");
    expect(html).not.toContain("<i>");
    expect(html).toContain(`href="${lien}"`);
    expect(html).toContain("<strong style=\"color:#15171A\">28 sept. – 4 oct.</strong>");
    expect(html).toContain("Geoffrey — planification des chantiers");
    expect(faux.recus[1].corps.textContent).toContain(ORIGINE + "/dispo.html?t=" + jetonNixon);

    /* L'écran de Geoffrey l'apprend, et le lien envoyé s'ouvre. */
    expect(app.changements).toEqual([{ quoi: "avail", ids: ["p_kia@" + SEMAINE, "p_nixon@" + SEMAINE] }]);
    expect((await appel(app, "GET", "/api/dispo/" + kia.token)).corps).toMatchObject({ name: NOM_KIA, week: SEMAINE });
  });

  it("sans MAIL_REPLY_TO, l'e-mail ne porte pas de replyTo", async () => {
    const config = configBrevo(faux);
    await lancerRappel({ ...app.deps, config: { ...config, MAIL_REPLY_TO: undefined } }, { maintenant: SAMEDI });
    expect(faux.recus).toHaveLength(2);
    expect(faux.recus[0].corps).not.toHaveProperty("replyTo");
  });

  /* Relecture adversariale de W3 : une demande expirée était réutilisée
     telle quelle, et le compagnon recevait un lien qui répondait 404. */
  it("une demande expirée reprend 60 jours, même jeton : le lien envoyé s'ouvre", async () => {
    await vider(app.base, app.redis);
    await ajouterCompagnon(app.base, "p_nixon", "Nixon", "nixon@exemple.fr");
    const jeton = await ajouterDemande(app.base, { personId: "p_nixon", semaine: SEMAINE, expiree: true });
    expect((await appel(app, "GET", "/api/dispo/" + jeton)).statut).toBe(404);

    expect(await reel()).toMatchObject({ statut: "fait", envoyes: 1 });
    expect(faux.recus[0].corps.textContent).toContain("dispo.html?t=" + jeton);
    expect((await appel(app, "GET", "/api/dispo/" + jeton)).statut).toBe(200);
  });

  it("relancée, elle n'envoie aucun e-mail de plus", async () => {
    await reel();
    const seconde = await reel();
    expect(seconde).toEqual({
      statut: "fait", semaine: SEMAINE, aBlanc: false,
      envoyes: 0, deja: 1, dejaEnvoyes: 2, sans: 1, creees: 0, erreurs: []
    });
    expect(faux.recus).toHaveLength(2);
  });

  it("un compagnon qui répond entre deux relances n'est plus relancé", async () => {
    await reel();
    faux.vider();
    await ajouterCompagnon(app.base, "p_quentin", "Quentin", "quentin@exemple.fr");
    const q = await ajouterDemande(app.base, { personId: "p_quentin", semaine: SEMAINE });
    await appel(app, "POST", "/api/dispo/" + q, { corps: { days: JOURS } });
    const bilan = await reel();
    expect(bilan).toMatchObject({ envoyes: 0, deja: 2, dejaEnvoyes: 2 });
    expect(faux.recus).toHaveLength(0);
  });

  it("un échec Brevo est rapporté, n'arrête pas les autres, et repart à la relance suivante", async () => {
    faux.echouerPour.add("kia@exemple.fr");
    const premiere = await reel();
    expect(premiere).toMatchObject({ statut: "fait", envoyes: 1, dejaEnvoyes: 0 });
    expect(premiere.erreurs).toEqual([
      { compagnonId: "p_kia", message: "Brevo a refusé l'envoi (HTTP 400, invalid_parameter)" }
    ]);
    expect(JSON.stringify(premiere)).not.toContain("kia@exemple.fr");   // Brevo cite l'adresse ; le bilan, non
    expect(destinataires()).toEqual(["nixon@exemple.fr"]);
    expect((await lireDemande(app.base, "p_kia@" + SEMAINE))?.sent_at).toBeNull();

    faux.echouerPour.clear();
    const seconde = await reel();
    expect(seconde).toMatchObject({ envoyes: 1, dejaEnvoyes: 1, erreurs: [] });
    expect(destinataires()).toEqual(["nixon@exemple.fr", "kia@exemple.fr"]);
    expect((await lireDemande(app.base, "p_kia@" + SEMAINE))?.sent_at).toBeTruthy();
  });

  it("Brevo injoignable : chaque envoi est rapporté en échec, et rien n'est noté", async () => {
    const bilan = await reel({}, { BREVO_API_URL: "http://127.0.0.1:9/v3/smtp/email" });
    expect(bilan.envoyes).toBe(0);
    expect(bilan.erreurs).toEqual([
      { compagnonId: "p_kia", message: expect.stringMatching(/^Brevo injoignable \(/) },
      { compagnonId: "p_nixon", message: expect.stringMatching(/^Brevo injoignable \(/) }
    ]);
    expect((await lireDemandes(app.base)).every(d => d.sent_at === null)).toBe(true);
  });

  it("deux lancements simultanés : un seul travaille, un seul e-mail par compagnon", async () => {
    faux.delaiMs = 150;                                    // la première tient le verrou pendant l'envoi
    const [a, b] = await Promise.all([reel(), reel()]);
    expect([a.statut, b.statut].sort()).toEqual(["deja-en-cours", "fait"]);
    expect(destinataires().sort()).toEqual(["kia@exemple.fr", "nixon@exemple.fr"]);
    expect(await lireExecutions(app.base)).toHaveLength(1);
    expect(await app.redis.exists("verrou:rappel:" + SEMAINE)).toBe(0);   // relâché à la fin

    /* Verrou relâché : la relance suivante travaille, et ne renvoie rien. */
    expect(await reel()).toMatchObject({ statut: "fait", envoyes: 0, dejaEnvoyes: 2 });
    expect(faux.recus).toHaveLength(2);
  });
});

describe("la planification", () => {
  it("part le samedi à 9 h, heure de Paris, l'été comme l'hiver", async () => {
    const t = planifierTaches({ ...app.deps, config: configEssai({ RAPPEL_ACTIF: "true" }) });
    try {
      expect(t.rappel).not.toBeNull();
      expect(t.rappel!.nextRun(new Date("2026-09-25T12:00:00Z"))!.toISOString()).toBe("2026-09-26T07:00:00.000Z");
      /* Après le passage à l'heure d'hiver (25 octobre) : toujours 9 h à Paris, donc 8 h UTC. */
      expect(t.rappel!.nextRun(new Date("2026-10-26T00:00:00Z"))!.toISOString()).toBe("2026-10-31T08:00:00.000Z");
    } finally { await t.arreter(); }
    expect(t.rappel!.isStopped()).toBe(true);
  });

  it("RAPPEL_ACTIF=false : rien n'est planifié", async () => {
    const t = planifierTaches({ ...app.deps, config: configEssai({ RAPPEL_ACTIF: "false" }) });
    expect(t.rappel).toBeNull();
    await t.arreter();
  });

  it("déclenchée, elle relance à blanc tant que MAIL_MODE n'est pas brevo", async () => {
    const t = planifierTaches({ ...app.deps, config: configEssai({ RAPPEL_ACTIF: "true" }) });
    try { await t.rappel!.trigger(); } finally { await t.arreter(); }
    const [x] = await lireExecutions(app.base);
    expect(x).toMatchObject({ job: "rappel", cle: semaineVisee(new Date()), a_blanc: 1 });
    expect(x.finished_at).toBeTruthy();
    expect(faux.recus).toHaveLength(0);
  });

  it("déclenchée avec MAIL_MODE=brevo, elle envoie", async () => {
    const t = planifierTaches({ ...app.deps, config: configBrevo(faux, { RAPPEL_ACTIF: "true" }) });
    try { await t.rappel!.trigger(); } finally { await t.arreter(); }
    const [x] = await lireExecutions(app.base);
    expect(x).toMatchObject({ cle: semaineVisee(new Date()), a_blanc: 0 });
    expect(x.bilan.envoyes).toBeGreaterThan(0);
    expect(faux.recus).toHaveLength(x.bilan.envoyes);
  });
});

describe("la commande npm run rappel", () => {
  const CLI = fileURLToPath(new URL("../src/cli/rappel.ts", import.meta.url));

  function commande(args: string[], plus: Record<string, string> = {}):
      Promise<{ code: number; sortie: string; erreurs: string }> {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(env)) if (/^(MAIL_|BREVO_|RAPPEL_|NODE_OPTIONS$)/.test(k)) delete env[k];
    Object.assign(env, {
      TZ: "Europe/Paris", NODE_ENV: "test", LOG_LEVEL: "info",
      DATABASE_URL: inject("DATABASE_URL"), REDIS_URL: inject("REDIS_URL"), APP_ORIGIN: ORIGINE,
      ...plus
    });
    return new Promise(ok => {
      execFile(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, ...args], { env, timeout: 60_000 },
        (err, sortie, erreurs) => ok({ code: err ? Number((err as { code?: unknown }).code ?? 1) : 0, sortie, erreurs }));
    });
  }

  it("à blanc par défaut : affiche le bilan en JSON, et dit « déjà faite » la seconde fois", async () => {
    const r = await commande(["--semaine", SEMAINE]);
    expect(r.erreurs).not.toMatch(/@exemple\.fr/);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.sortie)).toEqual({
      statut: "fait", semaine: SEMAINE, aBlanc: true,
      envoyes: 2, deja: 1, dejaEnvoyes: 0, sans: 1, creees: 1, erreurs: []
    });
    expect(faux.recus).toHaveLength(0);

    const r2 = await commande(["--semaine", SEMAINE]);
    expect(JSON.parse(r2.sortie).statut).toBe("deja-faite");
    const r3 = await commande(["--semaine", SEMAINE, "--forcer"]);
    expect(JSON.parse(r3.sortie).statut).toBe("fait");
  });

  it("--envoyer exige MAIL_MODE=brevo", async () => {
    const r = await commande(["--envoyer", "--semaine", SEMAINE]);
    expect(r.code).toBe(2);
    expect(r.erreurs).toContain("MAIL_MODE=brevo");
    expect(await lireExecutions(app.base)).toEqual([]);
  });

  it("--envoyer avec MAIL_MODE=brevo envoie (ici, au faux Brevo)", async () => {
    const r = await commande(["--envoyer", "--semaine", SEMAINE], {
      MAIL_MODE: "brevo", BREVO_API_KEY: CLE_BREVO_ESSAI, BREVO_API_URL: faux.url, MAIL_FROM: "planning@geoplan.test"
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.sortie)).toMatchObject({ statut: "fait", aBlanc: false, envoyes: 2 });
    expect(destinataires()).toEqual(["kia@exemple.fr", "nixon@exemple.fr"]);
  });

  it("refuse une semaine qui n'est pas un lundi, et une option inconnue", async () => {
    expect((await commande(["--semaine", "2026-09-29"])).code).toBe(2);
    expect((await commande(["--envoie"])).code).toBe(2);
    expect(await lireExecutions(app.base)).toEqual([]);
  });
});

describe("les journaux", () => {
  it("ne contiennent ni jeton ni adresse e-mail, pour une relance comme pour une réponse de compagnon", async () => {
    faux.echouerPour.add("kia@exemple.fr");                // l'erreur de Brevo cite l'adresse
    await aBlanc();
    await reel();
    await appel(app, "GET", "/api/dispo/" + jetonNixon);
    await appel(app, "POST", "/api/dispo/" + jetonNixon, { corps: { days: JOURS, note: "Merci" } });
    await appel(app, "GET", "/api/dispo/" + nouveauJeton());

    const texte = app.journal.join("");
    /* Le journal a bien été écrit : identifiants et chemins masqués y sont. */
    expect(texte).toContain("p_nixon");
    expect(texte).toContain("p_kia");
    expect(texte).toContain("/api/dispo/…");
    expect(texte).toContain("relance du samedi : bilan");

    const jetons = (await lireDemandes(app.base)).map(d => d.token);
    expect(jetons.length).toBeGreaterThanOrEqual(3);
    for (const j of jetons) expect(texte).not.toContain(j);
    expect(texte).not.toMatch(/@exemple\.fr/);
    expect(texte).not.toContain("planning@geoplan.test");
    expect(texte).not.toContain(CLE_BREVO_ESSAI);

    /* Ni dans les bilans gardés en base. */
    const bilans = JSON.stringify((await lireExecutions(app.base)).map(x => x.bilan));
    expect(bilans).not.toMatch(/@exemple\.fr/);
    for (const j of jetons) expect(bilans).not.toContain(j);
  });

  it("une erreur de base est rapportée sans les valeurs de la requête", async () => {
    let erreur: unknown;
    try {
      await app.deps.db.insert(availRequests).values({
        id: "p_kia@" + SEMAINE, token: jetonNixon, personId: "p_kia", week: SEMAINE, expiresAt: "2030-01-01 00:00:00"
      });
    } catch (e) { erreur = e; }
    const brut = erreur as Error;
    expect(brut.message).toContain(jetonNixon);            // drizzle recopie les valeurs liées…
    const sure = erreurSansDonnees(erreur) as Error & { errno?: number; code?: string };
    expect(sure.errno).toBe(1062);                         // …le code MySQL reste, pour traduire en 409
    expect(sure.code).toBe("ER_DUP_ENTRY");
    expect(sure.message + String(sure.stack) + JSON.stringify(sure)).not.toContain(jetonNixon);
  });
});
