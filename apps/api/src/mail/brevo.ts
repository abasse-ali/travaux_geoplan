/* ============================================================
   L'e-mail du samedi, et son envoi par Brevo

   Le texte est celui de la fonction Edge qu'il remplace
   (supabase/functions/rappel-dispos) : les compagnons reçoivent le même
   message, signé du chef d'équipe (MAIL_FROM_NAME), et une réponse
   arrive chez lui (MAIL_REPLY_TO), pas sur l'adresse technique.

   Dans la version HTML, ce qui vient de la base (le nom) et le lien sont
   échappés : un nom saisi « <b>Kia » ne doit pas devenir du balisage
   dans la boîte du compagnon.

   Brevo est appelé par fetch, sans SDK. L'URL vient de la configuration
   (BREVO_API_URL) : les tests envoient à un faux Brevo local, par le
   même code que la production.
   ============================================================ */

import type { Config } from "../config.ts";

export interface Courriel {
  a: { email: string; nom: string };
  sujet: string;
  texte: string;
  html: string;
}

export type EnvoiCourriel = (c: Courriel) => Promise<void>;

/** Un envoi refusé ou impossible. Son message ne cite ni l'adresse ni la
    clé : il part au journal et dans le bilan de la relance. */
export class ErreurEnvoi extends Error {}

const ENTITES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const echapper = (s: string): string => s.replace(/[&<>"']/g, c => ENTITES[c]);

export interface Rappel {
  email: string;
  nom: string;          // le nom complet, pour l'en-tête « À »
  prenom: string;       // celui du « Bonjour »
  plage: string;        // « 28 sept. – 4 oct. » (fmtRange)
  lien: string;
  chef: string;         // MAIL_FROM_NAME : la signature
}

export function courrielRappel(r: Rappel): Courriel {
  const texte =
`Bonjour ${r.prenom},

Peux-tu m'indiquer tes jours de présence pour la semaine du ${r.plage} ?
Ça prend trente secondes, il n'y a rien à installer :

${r.lien}

Merci,
${r.chef}`;

  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#EDEDEA;
padding:28px 16px;font:400 15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#15171A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:440px;background:#FBFBF9;border-radius:16px;
border:1px solid #DCDDD8;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="padding:26px 24px 6px">
  <div style="width:34px;height:34px;border-radius:9px;background:#26476E;margin-bottom:16px"></div>
  <h1 style="margin:0 0 10px;font-size:20px;line-height:1.25;font-weight:700">Bonjour ${echapper(r.prenom)}</h1>
  <p style="margin:0;color:#474D55">Quels jours es-tu disponible la semaine du
    <strong style="color:#15171A">${echapper(r.plage)}</strong> ?</p>
</td></tr>
<tr><td style="padding:20px 24px 24px">
  <a href="${echapper(r.lien)}" style="display:block;text-align:center;background:#E24F17;color:#fff;
    text-decoration:none;font-weight:600;font-size:16px;padding:15px;border-radius:12px">
    Indiquer mes disponibilités</a>
  <p style="margin:16px 0 0;font-size:12px;color:#787E86;text-align:center">
    Trente secondes, rien à installer. Tu peux revenir sur ce lien pour corriger.</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:11px;color:#787E86">${echapper(r.chef)} — planification des chantiers</p>
</td></tr></table></body></html>`;

  return {
    a: { email: r.email, nom: r.nom },
    sujet: `Tes dispos pour la semaine du ${r.plage} ?`,
    texte, html
  };
}

/* Pourquoi un appel n'a pas abouti, sans rien de ce qu'il transportait. */
function raison(e: unknown): string {
  const x = e as { name?: string; cause?: { code?: string } };
  if (x?.name === "TimeoutError" || x?.name === "AbortError") return "délai dépassé";
  return x?.cause?.code || x?.name || "erreur";
}

/** L'envoi par l'API transactionnelle de Brevo. Exige BREVO_API_KEY et
    MAIL_FROM ; `delaiMs` borne l'attente d'une réponse, pour qu'un
    Brevo muet ne bloque pas la relance (et son verrou) indéfiniment. */
export function envoiBrevo(config: Config, o: { delaiMs?: number } = {}): EnvoiCourriel {
  const cle = config.BREVO_API_KEY;
  const expediteur = config.MAIL_FROM;
  if (!cle || !expediteur) throw new Error("L'envoi par Brevo exige BREVO_API_KEY et MAIL_FROM");
  const nomExpediteur = config.MAIL_FROM_NAME;

  return async c => {
    let r: Response;
    try {
      r = await fetch(config.BREVO_API_URL, {
        method: "POST",
        headers: { "api-key": cle, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { email: expediteur, name: nomExpediteur },
          to: [{ email: c.a.email, name: c.a.nom }],
          /* Un compagnon qui répond doit tomber sur une vraie boîte lue par
             quelqu'un, pas sur l'adresse technique de l'expéditeur. */
          ...(config.MAIL_REPLY_TO ? { replyTo: { email: config.MAIL_REPLY_TO, name: nomExpediteur } } : {}),
          subject: c.sujet, htmlContent: c.html, textContent: c.texte
        }),
        signal: AbortSignal.timeout(o.delaiMs ?? 15_000)
      });
    } catch (e) {
      throw new ErreurEnvoi("Brevo injoignable (" + raison(e) + ")");
    }
    if (!r.ok) {
      /* Le message d'erreur de Brevo cite volontiers l'adresse en cause :
         on n'en garde que le code, fait de lettres et de soulignés. */
      let code = "";
      try {
        const j = await r.json() as { code?: unknown };
        if (typeof j?.code === "string" && /^[a-z_]{1,40}$/.test(j.code)) code = ", " + j.code;
      } catch { /* corps illisible : le statut suffit */ }
      throw new ErreurEnvoi(`Brevo a refusé l'envoi (HTTP ${r.status}${code})`);
    }
    await r.body?.cancel();
  };
}
