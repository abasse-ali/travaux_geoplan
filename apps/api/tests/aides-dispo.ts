/* ============================================================
   Outils des tests du lien compagnon et de la relance du samedi

   - monterAppDispo : la vraie application, routes de src/modules.ts
     comprises, dont le journal est recueilli ligne à ligne (pour
     vérifier qu'aucun jeton ni aucune adresse n'y entre) ;
   - demarrerFauxBrevo : un serveur HTTP local qui répond comme l'API
     Brevo. Aucun test n'envoie d'e-mail réel : en mode « brevo »,
     la configuration d'essai pointe TOUJOURS sur ce faux serveur ;
   - des fabriques de compagnons et de demandes, en SQL direct.
   ============================================================ */

import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { createApp, type Changement, type Deps } from "../src/app.ts";
import { MODULES } from "../src/modules.ts";
import type { Config } from "../src/config.ts";
import { ouvrirBase, type Base } from "../src/db/client.ts";
import { ouvrirRedis } from "../src/redis.ts";
import { creerLog } from "../src/log.ts";
import { nouveauJeton } from "../src/dispo/demandes.ts";
import { configEssai, type AppEssai } from "./aides.ts";

/* ---------- l'application, journal compris ---------- */

export interface AppDispo extends AppEssai {
  /** Chaque ligne JSON écrite par pino, dans l'ordre. */
  journal: string[];
}

export async function monterAppDispo(plus: Record<string, string> = {}): Promise<AppDispo> {
  const config = configEssai({ RAPPEL_ACTIF: "false", ...plus });
  const base = ouvrirBase(config.DATABASE_URL);
  const redis = ouvrirRedis(config.REDIS_URL);
  const changements: Changement[] = [];
  const journal: string[] = [];
  const flux = new Writable({ write(morceau, _enc, fini) { journal.push(String(morceau)); fini(); } });
  const deps: Deps = {
    config, db: base.db, redis,
    log: creerLog("debug", flux),
    diffuser: c => { changements.push(c); }
  };
  const app = createApp(deps, MODULES);
  const serveur: Server = await new Promise(ok => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  const { port } = serveur.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    deps, base, redis, changements, journal,
    fermer: async () => {
      await new Promise<void>(ok => serveur.close(() => ok()));
      await base.fermer();
      redis.disconnect();
    }
  };
}

/* ---------- le faux Brevo ---------- */

export interface EnvoiRecu { entetes: IncomingHttpHeaders; corps: any }

export interface FauxBrevo {
  url: string;
  /** Les e-mails acceptés, dans l'ordre d'arrivée. */
  recus: EnvoiRecu[];
  /** Nombre d'envois refusés. */
  refuses: number;
  /** Les adresses pour lesquelles il répond 400, comme le vrai Brevo
      devant une adresse invalide — message d'erreur compris, qui la cite. */
  echouerPour: Set<string>;
  /** Attente avant chaque réponse, pour faire durer une relance. */
  delaiMs: number;
  vider: () => void;
  fermer: () => Promise<void>;
}

export async function demarrerFauxBrevo(): Promise<FauxBrevo> {
  const f = {
    recus: [] as EnvoiRecu[], refuses: 0, echouerPour: new Set<string>(), delaiMs: 0
  };
  const serveur = createServer(async (req, res) => {
    let brut = "";
    for await (const m of req) brut += String(m);
    const corps = JSON.parse(brut || "null");
    if (f.delaiMs) await new Promise(ok => setTimeout(ok, f.delaiMs));
    const email = corps?.to?.[0]?.email;
    if (f.echouerPour.has(email)) {
      f.refuses++;
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "invalid_parameter", message: `email ${email} is not valid in to` }));
      return;
    }
    f.recus.push({ entetes: req.headers, corps });
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ messageId: "<" + f.recus.length + "@faux-brevo>" }));
  });
  await new Promise<void>(ok => serveur.listen(0, "127.0.0.1", () => ok()));
  const { port } = serveur.address() as AddressInfo;
  const faux: FauxBrevo = Object.assign(f, {
    url: `http://127.0.0.1:${port}/v3/smtp/email`,
    vider: () => { f.recus.length = 0; f.refuses = 0; f.echouerPour.clear(); f.delaiMs = 0; },
    fermer: () => new Promise<void>(ok => serveur.close(() => ok()))
  });
  return faux;
}

export const CLE_BREVO_ESSAI = "xkeysib-essai-0123456789abcdef";

/** Une configuration d'envoi réel… vers le faux Brevo, et lui seul. */
export function configBrevo(faux: FauxBrevo, plus: Record<string, string> = {}): Config {
  return configEssai({
    MAIL_MODE: "brevo",
    BREVO_API_KEY: CLE_BREVO_ESSAI,
    BREVO_API_URL: faux.url,
    MAIL_FROM: "planning@geoplan.test",
    MAIL_FROM_NAME: "Geoffrey",
    MAIL_REPLY_TO: "geoffrey@geoplan.test",
    RAPPEL_ACTIF: "false",
    ...plus
  });
}

/* ---------- données ---------- */

const JOURS = JSON.stringify([true, true, true, true, true, false, false]);
const NIVEAUX = JSON.stringify({ elec: 1, plomb: 1, platre: 1, peint: 1, menuis: 1 });

export async function ajouterCompagnon(base: Base, id: string, name: string, email = ""): Promise<void> {
  await base.pool.query("INSERT INTO people (id, name, email, days, sk) VALUES (?, ?, ?, ?, ?)",
    [id, name, email, JOURS, NIVEAUX]);
}

export interface DemandeEssai {
  personId: string;
  semaine: string;
  jeton?: string;
  /** Les jours de la réponse, si le compagnon a déjà répondu. */
  jours?: boolean[];
  envoyee?: boolean;
  expiree?: boolean;
}

/** Une demande posée directement en base ; rend son jeton. */
export async function ajouterDemande(base: Base, d: DemandeEssai): Promise<string> {
  const jeton = d.jeton ?? nouveauJeton();
  await base.pool.query(
    `INSERT INTO avail_requests (id, token, person_id, week, days, created_at, expires_at, answered_at, sent_at)
     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL ${d.expiree ? "-1 SECOND" : "60 DAY"},
             ${d.jours ? "UTC_TIMESTAMP(3)" : "NULL"}, ${d.envoyee ? "UTC_TIMESTAMP(3)" : "NULL"})`,
    [d.personId + "@" + d.semaine, jeton, d.personId, d.semaine, d.jours ? JSON.stringify(d.jours) : null]);
  return jeton;
}

export interface LigneEssai {
  id: string; token: string; person_id: string; week: string;
  days: boolean[] | null; note: string;
  created_at: string; expires_at: string; answered_at: string | null; sent_at: string | null;
}

export async function lireDemandes(base: Base): Promise<LigneEssai[]> {
  const [lignes] = await base.pool.query("SELECT * FROM avail_requests ORDER BY id");
  return lignes as LigneEssai[];
}

export async function lireDemande(base: Base, id: string): Promise<LigneEssai | undefined> {
  return (await lireDemandes(base)).find(l => l.id === id);
}

export interface ExecutionEssai {
  id: number; job: string; cle: string; a_blanc: number;
  started_at: string; finished_at: string | null; bilan: any;
}

export async function lireExecutions(base: Base): Promise<ExecutionEssai[]> {
  const [lignes] = await base.pool.query("SELECT * FROM job_runs ORDER BY id");
  return lignes as ExecutionEssai[];
}
