/* ============================================================
   Journaux structurés

   Une ligne JSON par événement. Aucun secret n'y entre : mots de passe,
   cookies, en-têtes d'autorisation et clés sont masqués par pino avant
   écriture, et le jeton d'un lien compagnon est retiré des chemins
   (/api/dispo/<jeton> devient /api/dispo/…). Un test le vérifie.

   Les erreurs passent toutes par erreurPourJournal, quel que soit
   l'appelant : elles y perdent ce qu'elles transportent de données.
   ============================================================ */

import { pino, stdSerializers, type Logger, type DestinationStream } from "pino";

export type Log = Logger;

export const CHAMPS_MASQUES = [
  "password", "motDePasse", "*.password", "*.motDePasse",
  "req.headers.cookie", "req.headers.authorization", "res.headers[\"set-cookie\"]",
  "headers.cookie", "headers.authorization",
  "token", "jeton", "*.token", "*.jeton",
  "BREVO_API_KEY", "*.BREVO_API_KEY", "apiKey", "*.apiKey"
];

/* Le jeton d'un lien compagnon est une clé : il ne doit pas finir dans
   un journal, même au détour d'une URL. */
export const masquerChemin = (url: string): string =>
  url.replace(/(\/api\/dispo\/)[^/?#]+/, "$1…");

/* Une erreur de base rapportée sans ses données. Drizzle recopie dans
   son message les valeurs liées d'une requête en échec (« params: … »),
   et MySQL cite la valeur fautive d'un doublon : jetons, adresses. Ce qui
   part au journal ou au bilan n'en garde que le code MySQL, qui suffit
   au diagnostic et à la traduction HTTP (traduireErreurMysql lit errno). */
export function erreurSansDonnees(e: unknown): unknown {
  if (!e || typeof e !== "object") return e;
  const x = e as Record<string, unknown>;
  const c = (x.cause && typeof x.cause === "object" ? x.cause : x) as Record<string, unknown>;
  const requete = "params" in x || "sql" in x || "sqlMessage" in x || "sql" in c || "sqlMessage" in c;
  if (!requete) return e;
  const code = typeof c.code === "string" ? c.code : "inconnu";
  return Object.assign(new Error("Échec de la requête SQL (" + code + ")"), {
    code, errno: typeof c.errno === "number" ? c.errno : undefined
  });
}

/* Ce qu'une erreur transporte de données, et qui n'entre jamais au
   journal. ioredis joint à son erreur la commande refusée, arguments
   compris : quand Redis refuse d'écrire (mémoire pleine, disque plein),
   c'est la réponse que l'idempotence voulait garder, adresse et
   téléphone d'un compagnon compris. mysql2 et Drizzle joignent la
   requête et ses valeurs liées. */
const CHAMPS_DE_DONNEES = new Set([
  "command", "args", "previousErrors", "lastNodeError",
  "sql", "sqlMessage", "params", "parameters", "query", "values"
]);

function sansChampsDeDonnees(o: unknown, profondeur = 0): unknown {
  if (!o || typeof o !== "object" || profondeur > 4) return o;
  if (Array.isArray(o)) return o.map(v => sansChampsDeDonnees(v, profondeur + 1));
  const x = o as Record<string, unknown>;
  for (const k of Object.keys(x)) {
    if (CHAMPS_DE_DONNEES.has(k)) delete x[k];
    else x[k] = sansChampsDeDonnees(x[k], profondeur + 1);
  }
  return x;
}

/** Le sérialiseur des erreurs de ce journal (champ `err`). */
export const erreurPourJournal = (e: unknown): unknown =>
  sansChampsDeDonnees(stdSerializers.err(erreurSansDonnees(e) as Error));

export function creerLog(niveau: string = process.env.LOG_LEVEL || "info",
                         destination?: NodeJS.WritableStream): Log {
  return pino({
    level: niveau,
    base: { app: "geoplan-api" },
    redact: { paths: CHAMPS_MASQUES, censor: "[masqué]" },
    serializers: { err: erreurPourJournal },
    timestamp: pino.stdTimeFunctions.isoTime
  }, destination as DestinationStream | undefined);
}
