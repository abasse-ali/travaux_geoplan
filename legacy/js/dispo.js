/* ============================================================
   Geoplan — page de réponse du compagnon
   Ouverte depuis le lien reçu par SMS. Pas de compte, pas
   d'installation, un seul écran.

   Le jeton de l'URL est la seule clé : il n'ouvre qu'une ligne, via
   deux fonctions SQL. La page ne peut rien lire ni écrire d'autre.
   ============================================================ */

import { DAYS_L, WEEKEND, NDAYS, MONTHS, parse, addDays, fmtRange } from "./domain.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";
import { markHTML } from "./mark.js";

const SB_VERSION = "2.112.4";
const rep = document.getElementById("rep");
const esc = t => String(t == null ? "" : t)
  .replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

const token = new URLSearchParams(location.search).get("t") || "";

function screen(html, cls){
  rep.className = "rep" + (cls ? " " + cls : "");
  rep.innerHTML = html;
}

function fail(title, msg){
  screen('<div class="center">' + markHTML() +
    "<h1>" + esc(title) + "</h1>" +
    '<div class="state err">' + msg + "</div></div>");
}

async function main(){
  if (!token) {
    fail("Lien incomplet",
      "Ce lien ne contient pas de code. Ouvrez celui reçu par message, en entier.");
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    fail("Application non configurée",
      "Le formulaire de disponibilité a besoin de la base. " +
      "Prévenez la personne qui vous a envoyé ce lien.");
    return;
  }

  let sb;
  try {
    const {createClient} = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@" + SB_VERSION + "/+esm");
    sb = createClient(SUPABASE_URL.trim().replace(/\/$/, ""), SUPABASE_ANON_KEY.trim(),
      {auth:{persistSession:false}});
  } catch(e) {
    fail("Connexion impossible", "Vérifiez votre réseau, puis rouvrez le lien.");
    return;
  }

  const {data, error} = await sb.rpc("avail_get", {p_token: token});
  if (error) {
    fail("Connexion impossible", "Vérifiez votre réseau, puis rouvrez le lien.");
    return;
  }
  if (!data) {
    fail("Lien expiré",
      "Cette demande n'existe plus, ou elle a dépassé sa date limite. " +
      "Demandez-en une nouvelle.");
    return;
  }

  render(sb, data);
}

function render(sb, d){
  const week = d.week;
  const days = Array.isArray(d.days)
    ? Array.from({length: NDAYS}, (_, i) => !!d.days[i])
    : Array(NDAYS).fill(false);
  let note = d.note || "";

  const rows = DAYS_L.map((label, i) => {
    const date = parse(addDays(week, i));
    return '<button class="dayrow' + (WEEKEND[i] ? " we" : "") + '" type="button" data-i="' + i +
      '" aria-pressed="' + days[i] + '">' +
      '<span class="box"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>' +
      '<span class="dt">' + label + "</span>" +
      '<span class="num">' + date.getDate() + " " + MONTHS[date.getMonth()] + "</span>" +
      "</button>";
  }).join("");

  screen(
    "<header>" + markHTML() +
      "<h1>Bonjour " + esc(d.name) + "</h1>" +
      '<p class="lead">Quels jours es-tu disponible cette semaine-là ? ' +
      "Touche les jours où tu peux venir, week-end compris, puis envoie.</p>" +
      '<span class="week"><em>Semaine du</em>' + esc(fmtRange(week)) + "</span>" +
    "</header>" +
    '<div class="grid5" id="days">' + rows + "</div>" +
    '<textarea id="note" placeholder="Un mot à ajouter ? (facultatif)">' + esc(note) + "</textarea>" +
    '<button class="btn primary wide send" id="send">' +
      (d.answered ? "Mettre à jour ma réponse" : "Envoyer mes disponibilités") + "</button>" +
    '<p class="foot">' + (d.answered
      ? "Tu as déjà répondu : tu peux corriger tant que la semaine n'est pas passée."
      : "Tu peux revenir sur ce lien pour corriger.") + "</p>");

  rep.querySelector("#days").addEventListener("click", e => {
    const b = e.target.closest(".dayrow");
    if (!b) return;
    const i = +b.dataset.i;
    days[i] = !days[i];
    b.setAttribute("aria-pressed", String(days[i]));
  });

  rep.querySelector("#send").addEventListener("click", async () => {
    const btn = rep.querySelector("#send");
    note = rep.querySelector("#note").value.slice(0, 300);
    btn.disabled = true;
    btn.textContent = "Envoi…";
    const {data: ok, error} = await sb.rpc("avail_set",
      {p_token: token, p_days: days, p_note: note});
    if (error || !ok) {
      btn.disabled = false;
      btn.textContent = "Réessayer";
      const box = document.createElement("div");
      box.className = "state err";
      box.textContent = "L'envoi n'a pas abouti. Vérifiez votre réseau et réessayez.";
      btn.insertAdjacentElement("afterend", box);
      return;
    }
    const list = DAYS_L.filter((l, i) => days[i]);
    screen('<div class="center">' + markHTML() +
      "<h1>C'est envoyé, merci " + esc(d.name) + "</h1>" +
      '<div class="state">Pour la semaine du <b>' + esc(fmtRange(week)) + "</b>, " +
      (list.length
        ? "tu es noté disponible : <b>" + list.join(", ").toLowerCase() + "</b>."
        : "tu es noté <b>indisponible toute la semaine</b>.") +
      (note ? "<br><br>Message transmis : « " + esc(note) + " »" : "") +
      "</div>" +
      '<p class="foot">Tu peux fermer cette page. Rouvre le lien si tu dois corriger.</p></div>');
  });
}

main().catch(() => fail("Une erreur est survenue",
  "Rouvrez le lien depuis votre message. Si cela persiste, prévenez le chef de chantier."));
