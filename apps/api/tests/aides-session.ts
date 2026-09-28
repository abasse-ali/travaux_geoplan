/* ============================================================
   Outils des tests d'authentification

   creerCompte pose un vrai compte (empreinte argon2id), connecter passe
   par la vraie route, executerCompte lance la vraie commande dans un
   processus Node, comme le propriétaire sur le serveur, et
   monterAppJournal recueille tout ce que l'API écrit dans son journal.
   ============================================================ */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inject } from "vitest";
import { createApp, type Deps, type Module } from "../src/app.ts";
import { creerLog } from "../src/log.ts";
import { hacher } from "../src/auth/motdepasse.ts";
import { COOKIE } from "../src/auth/sessions.ts";
import { users } from "../src/db/schema.ts";
import { appel, monterApp, type AppEssai, type Reponse } from "./aides.ts";

export const EMAIL = "geoffrey@geoplan.test";
export const MOT_DE_PASSE = "cheval-agrafe-pile-42";

/** Un compte, haché comme le ferait la commande du propriétaire. */
export async function creerCompte(app: AppEssai, email = EMAIL, motDePasse = MOT_DE_PASSE): Promise<string> {
  const id = "u_" + randomBytes(8).toString("hex");
  await app.deps.db.insert(users).values({ id, email, passwordHash: await hacher(motDePasse) });
  return id;
}

export function connecter(app: AppEssai, email: string, motDePasse: string,
                          o: { cookie?: string; origine?: string | null; entetes?: Record<string, string> } = {}): Promise<Reponse> {
  return appel(app, "POST", "/api/session", { corps: { email, password: motDePasse }, ...o });
}

/** La ligne Set-Cookie de la session, entière (avec ses attributs). */
export function ligneCookie(r: Reponse): string | undefined {
  return r.entetes.getSetCookie().find(c => c.startsWith(COOKIE + "="));
}

/** Le cookie de session posé par une réponse, prêt à renvoyer : « geoplan_sid=… ». */
export function cookieDe(r: Reponse): string {
  const ligne = ligneCookie(r);
  if (!ligne) throw new Error("La réponse ne pose pas de cookie de session (statut " + r.statut + ")");
  return ligne.split(";")[0]!;
}

/** L'identifiant de session que porte un cookie « geoplan_sid=… ». */
export const identifiant = (cookie: string): string => cookie.slice(COOKIE.length + 1);

/** Où Redis range une session : sous l'empreinte de son identifiant. */
export const empreinte = (id: string): string => createHash("sha256").update(id).digest("hex");
export const cleSession = (id: string): string => "sess:" + empreinte(id);

/* ---------- la commande du propriétaire ---------- */

const COMMANDE = fileURLToPath(new URL("../src/cli/compte.ts", import.meta.url));

export interface Execution { code: number | null; sortie: string; erreurs: string }

/** Lance `compte <args>` comme sur le serveur, l'entrée standard
    redirigée depuis `entree` (ce n'est donc pas un terminal). */
export function executerCompte(args: string[], entree = ""): Promise<Execution> {
  return new Promise((ok, ko) => {
    const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", COMMANDE, ...args], {
      env: { ...process.env, DATABASE_URL: inject("DATABASE_URL"), REDIS_URL: inject("REDIS_URL") },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let sortie = "", erreurs = "";
    p.stdout.setEncoding("utf8").on("data", (d: string) => { sortie += d; });
    p.stderr.setEncoding("utf8").on("data", (d: string) => { erreurs += d; });
    p.on("error", ko);
    p.on("close", code => ok({ code, sortie, erreurs }));
    p.stdin.end(entree);
  });
}

/* ---------- le journal ---------- */

export interface AppJournal extends AppEssai {
  /** Tout ce que pino a écrit depuis le montage, une ligne JSON par événement. */
  journal: () => string;
  lignes: () => Record<string, unknown>[];
}

/* monterApp journalise en silence. On remonte la même application, sur
   la même base et le même Redis, avec un journal au niveau le plus
   bavard qui écrit ici plutôt que sur la sortie standard. */
export async function monterAppJournal(modules: Module[]): Promise<AppJournal> {
  const socle = await monterApp();
  let texte = "";
  const flux = new Writable({ write(morceau, _codage, fait) { texte += String(morceau); fait(); } });
  const deps: Deps = { ...socle.deps, log: creerLog("trace", flux) };
  const serveur: Server = await new Promise(ok => { const s = createApp(deps, modules).listen(0, "127.0.0.1", () => ok(s)); });
  const { port } = serveur.address() as AddressInfo;
  return {
    ...socle, deps,
    url: `http://127.0.0.1:${port}`,
    journal: () => texte,
    lignes: () => texte.split("\n").filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>),
    fermer: async () => {
      await new Promise<void>(ok => serveur.close(() => ok()));
      await socle.fermer();
    }
  };
}
