/* ============================================================
   La commande du propriétaire : les comptes (ADR-002)

     npm run compte -w @geoplan/api -- creer <email>
     npm run compte -w @geoplan/api -- mot-de-passe <email>
     npm run compte -w @geoplan/api -- revoquer <email>
     npm run compte -w @geoplan/api -- supprimer <email>
     npm run compte -w @geoplan/api -- lister

   Il n'y a ni inscription publique ni « mot de passe oublié » par
   e-mail : sur l'iPhone, un lien reçu s'ouvre dans Safari, pas dans la
   PWA. C'est donc ici, sur le serveur, qu'un compte naît et qu'un mot de
   passe perdu se remplace.

   Le mot de passe se lit sur l'entrée standard : deux fois et sans écho
   dans un terminal, une seule ligne si l'entrée est redirigée. Jamais
   dans les arguments, qui finiraient dans l'historique du shell et dans
   la liste des processus ; jamais dans la sortie.

   Lit DATABASE_URL, et REDIS_URL pour révoquer les sessions.
   ============================================================ */

import { randomBytes } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ouvrirBase, type Base } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { ouvrirRedis, type Redis } from "../redis.ts";
import { AdresseEmail, trouverCompte, type Compte } from "../auth/comptes.ts";
import { hacher, LONGUEUR_MIN, LONGUEUR_MAX } from "../auth/motdepasse.ts";
import { revoquerSessions } from "../auth/sessions.ts";
import { premiereLigne, saisieMasquee } from "./saisie.ts";

const USAGE = `Usage : npm run compte -w @geoplan/api -- <action>
  creer <email>          crée un compte (mot de passe lu sur l'entrée standard)
  mot-de-passe <email>   change le mot de passe, et révoque toutes les sessions du compte
  revoquer <email>       révoque toutes les sessions du compte
  supprimer <email>      révoque toutes les sessions du compte, puis le supprime
  lister                 les adresses des comptes
`;

/** Un refus dont le message est écrit pour le propriétaire. */
class Refus extends Error {}

const ecrire = (ligne: string): void => { process.stdout.write(ligne + "\n"); };

function variable(nom: string, prefixes: string[]): string {
  const v = process.env[nom] || "";
  if (!prefixes.some(p => v.startsWith(p)))
    throw new Refus(`${nom} manquante ou mal formée (attendu : ${prefixes.join(" ou ")}…)`);
  return v;
}

/* ---------- le mot de passe, sur l'entrée standard ---------- */

async function lireMotDePasse(): Promise<string> {
  let mdp: string;
  if (process.stdin.isTTY) {
    mdp = await saisieMasquee("Mot de passe : ", () => new Refus("Abandon"));
    if (await saisieMasquee("Encore une fois : ", () => new Refus("Abandon")) !== mdp) throw new Refus("Les deux saisies diffèrent");
  } else {
    mdp = await premiereLigne();
  }
  if (!mdp) throw new Refus("Aucun mot de passe reçu sur l'entrée standard");
  if (mdp.length < LONGUEUR_MIN) throw new Refus(`Mot de passe trop court : ${LONGUEUR_MIN} caractères au moins`);
  if (mdp.length > LONGUEUR_MAX) throw new Refus(`Mot de passe trop long : ${LONGUEUR_MAX} caractères au plus`);
  /* Une espace en bord, c'est presque toujours celle qu'un « echo »
     laisse avant le « | » : Geoffrey ne la taperait pas, et ne pourrait
     jamais entrer. On refuse plutôt que de deviner. */
  if (mdp !== mdp.trim()) throw new Refus("Le mot de passe commence ou finit par une espace : retirez-la");
  return mdp;
}

/* ---------- les actions ---------- */

function adresse(brut: string | undefined): string {
  const r = AdresseEmail.pipe(z.email()).safeParse(brut ?? "");
  if (!r.success) throw new Refus("Adresse e-mail invalide");
  return r.data;
}

async function compteExistant(base: Base, brut: string | undefined): Promise<Compte> {
  const email = adresse(brut);
  const c = await trouverCompte(base.db, email);
  if (!c) throw new Refus("Aucun compte pour " + email);
  return c;
}

async function creer(base: Base, brut: string | undefined): Promise<void> {
  const email = adresse(brut);
  /* Avant la saisie : inutile de taper un mot de passe pour rien. */
  if (await trouverCompte(base.db, email)) throw new Refus("Un compte existe déjà pour " + email);
  const passwordHash = await hacher(await lireMotDePasse());
  const id = "u_" + randomBytes(12).toString("base64url");
  try {
    await base.db.insert(users).values({ id, email, passwordHash });
  } catch (e) {
    /* Deux créations lancées en même temps : l'unicité de la base
       tranche, et le message reste celui du propriétaire. */
    const x = e as { errno?: number; cause?: { errno?: number } };
    if ((x.errno ?? x.cause?.errno) === 1062) throw new Refus("Un compte existe déjà pour " + email);
    throw e;
  }
  ecrire("Compte créé : " + email);
}

async function changerMotDePasse(base: Base, redis: () => Redis, brut: string | undefined): Promise<void> {
  const c = await compteExistant(base, brut);
  const passwordHash = await hacher(await lireMotDePasse());
  await base.db.update(users)
    .set({ passwordHash, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
    .where(eq(users.id, c.id));
  /* Un mot de passe se change parce qu'il a fui, ou qu'un téléphone a
     été perdu : les sessions ouvertes avec l'ancien tombent avec lui. */
  let n: number;
  try { n = await revoquerSessions(redis(), c.id); }
  catch (e) {
    throw new Refus(`Mot de passe changé, mais les sessions n'ont pas pu être révoquées (${(e as Error).message}). `
      + `Relancez : npm run compte -w @geoplan/api -- revoquer ${c.email}`);
  }
  ecrire(`Mot de passe changé pour ${c.email} ; ${n} session(s) révoquée(s)`);
}

async function revoquer(base: Base, redis: () => Redis, brut: string | undefined): Promise<void> {
  const c = await compteExistant(base, brut);
  const n = await revoquerSessions(redis(), c.id);
  ecrire(`${n} session(s) révoquée(s) pour ${c.email}`);
}

/* Les sessions d'abord : si Redis ne répond pas, le compte reste, et la
   commande peut être relancée. Supprimé d'abord, il ne se retrouverait
   plus par son adresse pour révoquer ce qui resterait. (L'API refuse de
   toute façon une session dont le compte n'existe plus.) */
async function supprimer(base: Base, redis: () => Redis, brut: string | undefined): Promise<void> {
  const c = await compteExistant(base, brut);
  let n: number;
  try { n = await revoquerSessions(redis(), c.id); }
  catch (e) {
    throw new Refus(`Sessions non révoquées (${(e as Error).message}) : le compte ${c.email} n'est pas supprimé. Relancez.`);
  }
  await base.db.delete(users).where(eq(users.id, c.id));
  ecrire(`Compte supprimé : ${c.email} ; ${n} session(s) révoquée(s)`);
}

async function lister(base: Base): Promise<void> {
  const lignes = await base.db.select({ email: users.email }).from(users).orderBy(asc(users.email));
  for (const l of lignes) ecrire(l.email);
}

/* ---------- l'aiguillage ---------- */

async function principal(args: string[]): Promise<number> {
  const [action, email, ...reste] = args;
  /* « créer », avec l'accent, est l'orthographe de l'ADR-002 : acceptée. */
  const actions = ["creer", "créer", "mot-de-passe", "revoquer", "supprimer", "lister"];
  if (!action || !actions.includes(action) || reste.length || (action === "lister") !== (email === undefined)) {
    process.stderr.write(USAGE);
    return 2;
  }

  let base: Base | undefined;
  let r: Redis | undefined;
  /* Redis ne sert qu'aux révocations : créer ou lister un compte ne
     doit pas échouer parce qu'il est arrêté. */
  const redis = (): Redis => (r ??= ouvrirRedis(variable("REDIS_URL", ["redis://", "rediss://"])));
  try {
    base = ouvrirBase(variable("DATABASE_URL", ["mysql://"]));
    if (action === "creer" || action === "créer") await creer(base, email);
    else if (action === "mot-de-passe") await changerMotDePasse(base, redis, email);
    else if (action === "revoquer") await revoquer(base, redis, email);
    else if (action === "supprimer") await supprimer(base, redis, email);
    else await lister(base);
    return 0;
  } catch (e) {
    /* Drizzle recopie la requête et ses paramètres dans son message,
       empreinte comprise : seule la cause, celle de MySQL, est montrée. */
    const detail = e instanceof Refus ? e.message
      : (e as { cause?: Error }).cause?.message ?? (e as Error).message;
    process.stderr.write("Erreur : " + detail + "\n");
    return 1;
  } finally {
    await base?.fermer();
    r?.disconnect();
  }
}

process.exitCode = await principal(process.argv.slice(2));
