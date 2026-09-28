/* ============================================================
   Configuration de l'API, lue une fois dans l'environnement

   Tout ce qui est secret (mot de passe MySQL, clé Brevo) n'existe que
   dans l'environnement du serveur : jamais dans le dépôt, jamais dans
   le paquet du client. Une valeur manquante ou mal formée arrête le
   démarrage avec un message qui dit laquelle.
   ============================================================ */

import { z } from "zod";

const booleen = z.enum(["0", "1", "false", "true"]).transform(v => v === "1" || v === "true");

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z.string().url().refine(u => u.startsWith("mysql://"), "doit commencer par mysql://"),
  REDIS_URL: z.string().url().refine(u => u.startsWith("redis://") || u.startsWith("rediss://"), "doit commencer par redis://"),

  /* L'origine publique de l'application (https://geoplan.exemple.fr).
     Sert à refuser les écritures venues d'ailleurs, et à construire les
     liens envoyés aux compagnons. */
  APP_ORIGIN: z.string().url().transform(u => u.replace(/\/$/, "")),

  /* Nombre de mandataires de confiance devant l'API (nginx, puis
     Cloudflare si présent) : c'est ce qui permet de lire la vraie adresse
     du client pour la limitation de débit. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(3).default(1),

  /* La relance du samedi. « a-blanc » par défaut : elle calcule tout,
     journalise tout, et n'envoie rien. */
  MAIL_MODE: z.enum(["a-blanc", "brevo"]).default("a-blanc"),
  BREVO_API_KEY: z.string().min(10).optional(),
  /* Réglable pour que les tests, et un serveur d'essai, envoient à un faux
     Brevo local : le code d'envoi testé est alors celui de la production. */
  BREVO_API_URL: z.string().url().default("https://api.brevo.com/v3/smtp/email"),
  MAIL_FROM: z.string().email().optional(),
  MAIL_FROM_NAME: z.string().min(1).default("Geoplan"),
  MAIL_REPLY_TO: z.string().email().optional(),
  RAPPEL_ACTIF: booleen.default(true),
  RAPPEL_CRON: z.string().default("0 9 * * 6"),     // samedi 9 h…
  RAPPEL_TZ: z.string().default("Europe/Paris")       // …à l'heure de Paris, été comme hiver
}).superRefine((c, ctx) => {
  if (c.MAIL_MODE === "brevo" && (!c.BREVO_API_KEY || !c.MAIL_FROM))
    ctx.addIssue({ code: "custom", message: "MAIL_MODE=brevo exige BREVO_API_KEY et MAIL_FROM" });
  /* Le cookie de session est Secure en production : hors https, il ne
     serait jamais renvoyé. Seule exception, l'essai local de la pile
     (http://localhost), que les navigateurs traitent comme sûr. */
  if (c.NODE_ENV === "production" && !c.APP_ORIGIN.startsWith("https://")
      && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(c.APP_ORIGIN))
    ctx.addIssue({ code: "custom", message: "APP_ORIGIN doit être en https:// en production" });
});

export type Config = z.infer<typeof Schema>;

export function lireConfig(env: NodeJS.ProcessEnv = process.env): Config {
  /* docker compose transmet une variable facultative non remplie comme
     une chaîne vide : c'est une absence, pas une valeur. */
  const renseignees = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  const r = Schema.safeParse(renseignees);
  if (!r.success) {
    const lignes = r.error.issues.map(i => `  ${i.path.join(".") || "config"} : ${i.message}`);
    throw new Error("Configuration invalide :\n" + lignes.join("\n"));
  }
  return r.data;
}
