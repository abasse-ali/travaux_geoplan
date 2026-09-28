/* ============================================================
   Geoplan — rappel hebdomadaire des disponibilités

   Fonction Edge appelée chaque samedi par pg_cron. Elle :
     1. calcule le lundi de la semaine suivante ;
     2. crée, pour chaque compagnon ayant une adresse, la demande de
        cette semaine-là si elle n'existe pas déjà — en réutilisant le
        jeton existant, pour ne pas casser un lien déjà envoyé ;
     3. envoie un e-mail nominatif avec ce lien, à ceux qui n'ont pas
        encore répondu.

   Elle est idempotente : la relancer deux fois n'envoie pas deux fois
   à quelqu'un qui a déjà répondu, et ne change aucun jeton.

   Secrets attendus (Supabase › Edge Functions › Secrets) :
     APP_URL          https://geoplans.netlify.app
     BREVO_API_KEY    ou RESEND_API_KEY
     MAIL_FROM        expediteur@votredomaine.fr
     MAIL_FROM_NAME   Geoffrey           (le nom qui s'affiche chez le destinataire)
     MAIL_REPLY_TO    geoffrey@…         (ou repondre arrive chez vous)
     CRON_SECRET      un mot de passe, exigé dans l'en-tête x-cron-key
   ============================================================ */

import { createClient } from "jsr:@supabase/supabase-js@2";

const MOIS = ["janv.","févr.","mars","avr.","mai","juin",
              "juil.","août","sept.","oct.","nov.","déc."];

/* Lundi de la semaine suivante, en heure de Paris. */
function lundiProchain(): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const jour = (d.getUTCDay() + 6) % 7;              // lundi = 0
  d.setUTCDate(d.getUTCDate() - jour + 7);
  return d.toISOString().slice(0, 10);
}

function plage(lundi: string): string {
  const a = new Date(lundi + "T00:00:00Z");
  const b = new Date(a); b.setUTCDate(b.getUTCDate() + 6);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()} – ${b.getUTCDate()} ${MOIS[b.getUTCMonth()]}`
    : `${a.getUTCDate()} ${MOIS[a.getUTCMonth()]} – ${b.getUTCDate()} ${MOIS[b.getUTCMonth()]}`;
}

const jeton = () => {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
};

const echappe = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/* ---------- l'e-mail ---------- */

function corps(nom: string, semaine: string, lien: string){
  const chef = Deno.env.get("MAIL_FROM_NAME") || "Geoplan";
  const texte =
`Bonjour ${nom},

Peux-tu m'indiquer tes jours de présence pour la semaine du ${semaine} ?
Ça prend trente secondes, il n'y a rien à installer :

${lien}

Merci,
${chef}`;

  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#EDEDEA;
padding:28px 16px;font:400 15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#15171A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:440px;background:#FBFBF9;border-radius:16px;
border:1px solid #DCDDD8;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="padding:26px 24px 6px">
  <div style="width:34px;height:34px;border-radius:9px;background:#26476E;margin-bottom:16px"></div>
  <h1 style="margin:0 0 10px;font-size:20px;line-height:1.25;font-weight:700">Bonjour ${echappe(nom)}</h1>
  <p style="margin:0;color:#474D55">Quels jours es-tu disponible la semaine du
    <strong style="color:#15171A">${echappe(semaine)}</strong> ?</p>
</td></tr>
<tr><td style="padding:20px 24px 24px">
  <a href="${lien}" style="display:block;text-align:center;background:#E24F17;color:#fff;
    text-decoration:none;font-weight:600;font-size:16px;padding:15px;border-radius:12px">
    Indiquer mes disponibilités</a>
  <p style="margin:16px 0 0;font-size:12px;color:#787E86;text-align:center">
    Trente secondes, rien à installer. Tu peux revenir sur ce lien pour corriger.</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:11px;color:#787E86">${echappe(chef)} — planification des chantiers</p>
</td></tr></table></body></html>`;

  return { texte, html };
}

async function envoyer(to: string, nom: string, sujet: string, texte: string, html: string){
  const from = Deno.env.get("MAIL_FROM");
  const fromName = Deno.env.get("MAIL_FROM_NAME") || "Geoplan";
  /* Un compagnon qui repond doit tomber sur une vraie boite lue par
     quelqu'un, pas sur l'adresse technique de l'expediteur. */
  const replyTo = Deno.env.get("MAIL_REPLY_TO") || "";
  if (!from) throw new Error("MAIL_FROM manquant");

  const brevo = Deno.env.get("BREVO_API_KEY");
  if (brevo) {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": brevo, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: from, name: fromName },
        to: [{ email: to, name: nom }],
        ...(replyTo ? { replyTo: { email: replyTo, name: fromName } } : {}),
        subject: sujet, htmlContent: html, textContent: texte
      })
    });
    if (!r.ok) throw new Error("Brevo " + r.status + " " + await r.text());
    return;
  }

  const resend = Deno.env.get("RESEND_API_KEY");
  if (resend) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + resend, "content-type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${from}>`, to: [to], subject: sujet, html, text: texte,
        ...(replyTo ? { reply_to: replyTo } : {})
      })
    });
    if (!r.ok) throw new Error("Resend " + r.status + " " + await r.text());
    return;
  }

  throw new Error("Aucune clé d'envoi : renseignez BREVO_API_KEY ou RESEND_API_KEY");
}

/* ---------- la fonction ---------- */

Deno.serve(async (req) => {
  /* La fonction n'est pas publique : seul le cron, qui connaît le
     secret, peut la déclencher. */
  const attendu = Deno.env.get("CRON_SECRET");
  if (attendu && req.headers.get("x-cron-key") !== attendu)
    return new Response("non autorisé", { status: 401 });

  const appUrl = (Deno.env.get("APP_URL") || "").replace(/\/$/, "");
  if (!appUrl) return new Response("APP_URL manquant", { status: 500 });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,       // côté serveur : jamais dans la page
    { auth: { persistSession: false } }
  );

  const semaine = lundiProchain();
  const libelle = plage(semaine);

  const { data: gens, error: e1 } = await sb
    .from("people").select("id, name, email").neq("email", "");
  if (e1) return new Response("lecture impossible : " + e1.message, { status: 500 });

  /* On crée les demandes manquantes sans toucher aux existantes. */
  const lignes = (gens ?? []).map(p => ({
    id: p.id + "@" + semaine, token: jeton(), person_id: p.id, week: semaine
  }));
  if (lignes.length) {
    const { error } = await sb.from("avail_requests")
      .upsert(lignes, { onConflict: "id", ignoreDuplicates: true });
    if (error) return new Response("écriture impossible : " + error.message, { status: 500 });
  }

  const { data: demandes, error: e2 } = await sb
    .from("avail_requests").select("id, token, person_id, answered_at").eq("week", semaine);
  if (e2) return new Response("relecture impossible : " + e2.message, { status: 500 });

  const parId = new Map((demandes ?? []).map(d => [d.person_id, d]));
  const bilan = { semaine, envoyes: 0, deja: 0, sans: 0, erreurs: [] as string[] };

  for (const p of gens ?? []) {
    const d = parId.get(p.id);
    if (!d) { bilan.sans++; continue; }
    if (d.answered_at) { bilan.deja++; continue; }     // il a déjà répondu
    const lien = `${appUrl}/dispo.html?t=${d.token}`;
    const { texte, html } = corps(p.name, libelle, lien);
    try {
      await envoyer(p.email, p.name, `Tes dispos pour la semaine du ${libelle} ?`, texte, html);
      bilan.envoyes++;
    } catch (err) {
      bilan.erreurs.push(`${p.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return new Response(JSON.stringify(bilan, null, 2),
    { headers: { "content-type": "application/json" } });
});
