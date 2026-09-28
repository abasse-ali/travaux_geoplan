/* ============================================================
   Geoplan — interface
   Rendu, glisser-déposer tactile, feuilles et événements.

   L'écran est toujours posé sur UN JOUR : la barre du haut choisit la
   semaine, la bande en dessous le jour. Tout ce qu'on glisse s'affecte
   à ce jour-là.
   ============================================================ */

import {
  SKILLS, SK, skLabel, skColor, PHASES, TOTAL_JH, phaseColor, phaseTrades,
  NDAYS, DAYS, DAYS_L, WEEKEND, pad, parse, todayISO, addDays, mondayOf,
  weekNum, weekDates, dayIndex, fmtDay, fmtRange,
  normPerson, normSite, uid, normPhone, fmtPhone, countDays, codeFromAddr,
  teamOn, setTeamOn, weekRoster, daysOnSite, dispoOf, avgLv, siteProgress,
  currentPhase, span, isActive, loadLeft, forecast, conflicts,
  neededHeadcount, suggestTeam, coverage, optimizeWeek, uncovered, siteNeed,
  taskDone, taskCount, setTask, tasksTicked, setPhasePct, phaseSteps
} from "./domain.js";
import { Store } from "./store.js";
import { markHTML } from "./mark.js";

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const esc = t => String(t == null ? "" : t)
  .replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

const view = $("#view");

/* Le rendu reconstruit des chaines HTML entieres. Les reecrire a
   l'identique fait clignoter l'ecran et rejoue toutes les animations
   d'entree : on ne touche au DOM que si quelque chose a change. */
const lastHTML = new WeakMap();
function setHTML(el, html){
  if (lastHTML.get(el) === html) return false;
  lastHTML.set(el, html);
  el.innerHTML = html;
  return true;
}

/* En francais, zero prend le singulier : « 0 libre », « 2 libres ». */
const plur = (n, sing, plu) => n + " " + (n > 1 ? (plu || sing + "s") : sing);
const ghost = $("#ghost");
const sheetRoot = $("#sheetRoot");

/* Une seule étape dépliée dans toute l'application : en ouvrir une
   referme la précédente. Clé « idChantier#index », ou null. */
let openPhase = null;

/* Vrai le temps du clic fantôme qui suit un dépôt sur la bulle. */
let bubbleWasDropTarget = false;
function clearDropHints(){
  $$(".zone.over").forEach(z => z.classList.remove("over", "urg"));
  $("#vivier").classList.remove("over");

}

/* ---------- préférences d'affichage, purement locales ---------- */
const UIKEY = "geoplan.ui.v2";
/* poolState : "bubble" (rétracté), "peek" (une rangée), "open" (déplié) */
const ui = {tab:"chantiers", urgence:false, poolState:"open", openSite:null};
try { Object.assign(ui, JSON.parse(localStorage.getItem(UIKEY) || "{}")); } catch(e){}
if (ui.poolState !== "bubble") ui.poolState = "open";   // « peek » n'existe plus
ui.week = mondayOf(todayISO());                  // on ouvre toujours sur la semaine en cours
ui.day = dayIndex(todayISO());                   // et sur aujourd'hui
function saveUi(){ try { localStorage.setItem(UIKEY, JSON.stringify(ui)); } catch(e){} }

/* ---------- magasin ---------- */
const store = new Store({
  onData: () => requestRender(),
  onStatus: (s, n) => paintStatus(s, n),
  onAuth: () => { paintGate(); requestRender(); },
  onAnswer: (p, a) => toast("<b>" + esc(p.name) + "</b> a répondu pour la semaine " +
    weekNum(a.week) + " : " + (countDays(a.days)
      ? DAYS.filter((d, i) => a.days[i]).join(" ") : "aucun jour"))
});

const person = id => store.person(id);
const site = id => store.site(id);

/* Semaine visée par une demande de dispo. À partir du vendredi, celle
   qu'on prépare n'est plus la semaine en cours mais la suivante — sauf
   si l'écran est posé sur une autre semaine, auquel cas on la respecte. */
function askWeek(){
  const today = todayISO(), base = mondayOf(today);
  if (ui.week !== base) return ui.week;
  return dayIndex(today) >= 4 ? addDays(base, 7) : base;
}

/* ---------- lectures du jour ---------- */
const curDay = () => addDays(ui.week, ui.day);
const sitesOnDay = (pid, day) => store.sites.filter(s => teamOn(s, day).indexOf(pid) > -1);
const isFreeOn = (pid, day) => sitesOnDay(pid, day).length === 0;
const availableOn = (pid, day) => store.availableOn(pid, day);
const daysOf = (p, wk) => store.daysOf(p, wk);
const dispoWk = (p, wk) => countDays(daysOf(p, wk));
const answered = (p, wk) => { const a = store.availOf(p.id, wk); return a && a.days ? a : null; };
/* Chantiers où le compagnon passe dans la semaine affichée. */
const sitesInWeek = (pid, wk) => store.sites.filter(s => weekRoster(s, wk).indexOf(pid) > -1);

/* ============================================================
   Rendu
   ============================================================ */

function meterHTML(lv, color, max){
  let h = '<span class="meter">';
  for (let i = 1; i <= (max || 5); i++)
    h += '<s style="background:' + (i <= lv ? color : "var(--surface-3)") + '"></s>';
  return h + "</span>";
}

/* Sept pastilles : les jours où le compagnon est posé sur ce chantier.
   Une pastille barrée signale une journée posée alors qu'il s'est
   déclaré absent. */
function pipsHTML(s, p, wk){
  const on = daysOnSite(s, p.id, wk);
  const dates = weekDates(wk);
  return '<span class="pips">' + on.map((v, i) => {
    const bad = v && !availableOn(p.id, dates[i]);
    return '<s class="' + (v ? (bad ? "bad" : "on") : "") + (WEEKEND[i] ? " we" : "") + '"></s>';
  }).join("") + "</span>";
}

function chipHTML(p, s){
  const wk = ui.week;
  const sub = s ? pipsHTML(s, p, wk) : '<span class="d">' + dispoWk(p, wk) + "j</span>";
  const urg = s && sitesOnDay(p.id, curDay()).length > 1;
  return '<button class="chip' + (urg ? " urg" : "") + '" data-pid="' + p.id + '"' +
         (s ? ' data-site="' + s.id + '"' : "") + ">" +
         '<span class="nm">' + esc(p.name) + "</span>" + sub + "</button>";
}

function forecastHTML(s, wk){
  const f = forecast(s, wk, availableOn);
  if (f.done) return '<div class="fc"><span class="flag ok">Livré</span></div>';
  const rest = Math.round(f.rest);
  if (f.stalled)
    return '<div class="fc"><b>' + rest + "</b> j·h restants" +
      '<span class="sep">·</span><span class="flag stop">Personne cette semaine</span></div>';
  const bad = conflicts(s, wk, availableOn).length;
  return '<div class="fc' + (f.late ? " late" : "") + '">' +
    "<b>" + rest + "</b> j·h restants<span class=\"sep\">·</span>" +
    "<b>" + f.cap + "</b> j·h posés<span class=\"sep\">·</span>" +
    'fin <b class="end">' + fmtDay(f.end) + "</b>" +
    (f.late ? '<span class="flag">Après le ' + fmtDay(f.planned) + "</span>" : "") +
    (bad ? '<span class="flag stop">' + bad + " jour" + (bad > 1 ? "s" : "") + " en conflit</span>" : "") +
    "</div>";
}

function renderChantiers(){
  if (!store.sites.length) {
    setHTML(view, '<div class="card blank"><h3>Aucun chantier</h3>' +
      "<p>Ouvrez votre premier chantier : un code court, une adresse, une date de début. " +
      "Les 12 étapes sont créées automatiquement.</p>" +
      '<button class="btn primary" id="firstSite">Ouvrir un chantier</button></div>');
    return;
  }
  const wk = ui.week, day = curDay();
  const sorted = store.sites.slice().sort((a, b) =>
    (isActive(b, wk) ? 1 : 0) - (isActive(a, wk) ? 1 : 0) || a.start.localeCompare(b.start));

  const briefBar = '<div class="card daybrief">' +
    '<div><span class="eyebrow">' + DAYS_L[ui.day] + "</span>" +
    '<p>' + fmtDay(day) + " · " +
    plur(store.sites.filter(x => teamOn(x, day).length).length, "chantier") + "</p></div>" +
    '<span class="spacer"></span>' +
    '<button class="btn sm blue" id="shareBtn">Partager le brief</button></div>';

  setHTML(view, '<div class="stack">' + briefBar + sorted.map(s => {
    const cur = currentPhase(s), pct = siteProgress(s);
    const team = teamOn(s, day);
    const roster = weekRoster(s, wk);
    const prevDay = addDays(day, -1), prevTeam = teamOn(s, prevDay);
    const done = s.ph.every(v => v >= 100);
    const active = isActive(s, wk);

    const ladder = s.ph.map((v, i) =>
      '<i class="' + (i === cur && !done ? "cur" : "") + '" title="Étape ' + (i+1) + " — " + PHASES[i].n + '">' +
        '<b style="height:' + v + "%;background:" + phaseColor(i) + '"></b></i>').join("");

    let chips;
    if (team.length) chips = team.map(person).filter(Boolean).map(p => chipHTML(p, s)).join("");
    else if (prevTeam.length) chips =
      '<p class="empty-hint">Personne ce jour-là. ' +
      '<button class="btn sm" data-again="' + s.id + '" style="margin-top:6px">Reprendre l\'équipe de ' +
      DAYS_L[dayIndex(prevDay)].toLowerCase() + " (" +
      prevTeam.map(id => { const p = person(id); return p ? esc(p.name) : ""; }).filter(Boolean).join(", ") +
      ")</button></p>";
    else chips = '<p class="empty-hint">Glissez un compagnon depuis le vivier, ' +
      "ou demandez une composition pour la semaine.</p>";

    const phases = s.ph.map((v, i) => {
      const P = PHASES[i], isCur = i === cur && !done;
      const ticks = taskDone(s, i), n = tasksTicked(s, i), tot = taskCount(i);
      const open = openPhase === s.id + "#" + i;
      return '<div class="phase' + (v >= 100 ? " done" : "") + (isCur ? " cur" : "") + '">' +
        '<div class="ph-n">' + pad(i+1) + "</div>" +
        '<div class="ph-body">' +
          '<button class="ph-top" data-phase="' + s.id + "#" + i + '" aria-expanded="' + open + '">' +
            '<span class="ph-name">' + esc(P.n) + "</span>" +
            '<span class="ph-wk">' + (n ? n + "/" + tot : "S" + P.wk) + "</span>" +
            '<span class="ph-pct">' + v + "%</span>" +
            '<span class="caret"></span>' +
          "</button>" +
          '<div class="ph-track" data-sid="' + s.id + '" data-i="' + i + '" role="slider" tabindex="0" ' +
               'aria-label="Étape ' + (i+1) + " " + esc(P.n) + '" aria-valuenow="' + v +
               '" aria-valuemin="0" aria-valuemax="100">' +
            '<b style="width:' + v + "%;background:" + phaseColor(i) + '"></b></div>' +
          (open ? '<ul class="ph-tasks">' + P.tasks.map((T, j) =>
            '<li><button class="task' + (ticks[j] ? " on" : "") + '" data-task="' + s.id + "#" + i + "#" + j +
            '" aria-pressed="' + !!ticks[j] + '">' +
            '<span class="box"><svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>' +
            '<span class="tx">' + esc(T.t) +
            '<span class="req">' +
              (T.sk ? '<i style="background:' + skColor(T.sk) + '"></i>' + esc(skLabel(T.sk)) +
                      " niv. " + T.lv : "polyvalent") +
              " · " + T.jh + " j·h" + (T.permis ? " · permis" : "") +
            "</span></span></button></li>").join("") + "</ul>" : "") +
        "</div></div>";
    }).join("");

    return '<article class="card site' + (active ? "" : " inactive") + '" data-site="' + s.id + '">' +
      '<div class="site-head">' +
        '<div><div class="site-code">' + esc(s.code) + "</div>" +
        '<p class="site-addr">' + esc(s.addr || "Adresse à compléter") + "</p></div>" +
        '<div class="site-pct"><div class="num"><b>' + pct + '%</b><span>' + s.months + " mois</span></div>" +
        '<button class="kebab" data-edit-site="' + s.id + '" aria-label="Modifier le chantier">&#8942;</button></div>' +
      "</div>" +
      '<div class="stage-line">' +
        (done
          ? '<span class="stage-tag" style="background:var(--ok)">Chantier livré</span>'
          : '<span class="stage-tag" style="background:' + phaseColor(cur) + '">' +
            '<span class="n">' + pad(cur+1) + "</span>" + esc(PHASES[cur].n) + "</span>" +
            '<span class="stage-note">' +
              (active ? "semaine " + PHASES[cur].wk + " sur 8"
                      : (wk < span(s).first ? "démarre le " + fmtDay(s.start) : "période dépassée")) +
            "</span>") +
      "</div>" +
      forecastHTML(s, wk) +
      '<div class="ladder">' + ladder + "</div>" +
      '<div class="zone" data-drop="' + s.id + '">' +
        '<div class="zone-top"><span class="eyebrow">' +
          DAYS_L[ui.day] + " " + fmtDay(day) + " · " + team.length + "</span>" +
          '<span class="spacer"></span><button class="btn sm" data-suggest="' + s.id + '">Composer</button></div>' +
        '<div class="chips">' + chips + "</div>" +
        (roster.length ? '<p class="week-roster">Sur la semaine : ' +
          roster.map(id => { const p = person(id); return p ? esc(p.name) : ""; })
                .filter(Boolean).join(", ") + "</p>" : "") +
      "</div>" +
      '<details class="acc"' + (ui.openSite === s.id ? " open" : "") + ' data-acc="' + s.id + '">' +
        '<summary><span class="eyebrow">Les 12 étapes</span><span class="spacer"></span>' +
        '<span class="ph-wk">' + s.ph.filter(v => v >= 100).length + '/12</span><span class="caret"></span></summary>' +
        '<div class="acc-body">' + phases + "</div>" +
      "</details>" +
      '<details class="acc">' +
        '<summary><span class="eyebrow">Note de chantier</span><span class="spacer"></span>' +
        (s.note ? '<span class="dot" style="background:var(--accent)"></span>' : "") + '<span class="caret"></span></summary>' +
        '<div class="acc-body"><textarea class="note" data-note="' + s.id + '" ' +
        'placeholder="Réserves, matériel à commander, accès…">' + esc(s.note) + "</textarea></div>" +
      "</details>" +
    "</article>";
  }).join("") + "</div>");
}

/* Vue Semaine : chantiers en lignes, sept jours en colonnes.
   Répond à « est-ce que ma semaine tient debout ? », qu'aucun écran ne
   montrait plus depuis que tout est posé au jour. */
function renderSemaine(){
  const wk = ui.week, dates = weekDates(wk), today = todayISO();
  const rows = store.sites.filter(s => isActive(s, wk) || weekRoster(s, wk).length);

  const head = '<div class="wrow whead">' +
    '<div class="wlbl"></div>' +
    dates.map((d, i) => '<button class="wcell whd' + (WEEKEND[i] ? " we" : "") +
      (d === today ? " today" : "") + (i === ui.day ? " sel" : "") + '" data-jump="' + i + '">' +
      "<em>" + DAYS[i] + "</em><b>" + parse(d).getDate() + "</b></button>").join("") + "</div>";

  const body = rows.map(s => {
    const cells = dates.map((d, i) => {
      const crew = teamOn(s, d).map(person).filter(Boolean);
      const bad = crew.some(p => !availableOn(p.id, d));
      const shown = crew.slice(0, 3), more = crew.length - shown.length;
      return '<button class="wcell' + (WEEKEND[i] ? " we" : "") + (crew.length ? " full" : "") +
        (bad ? " bad" : "") + (i === ui.day ? " sel" : "") + '" data-jump="' + i + '"' +
        ' aria-label="' + esc(s.code) + " " + DAYS_L[i] + " : " +
        (crew.length ? esc(crew.map(p => p.name).join(", ")) : "personne") + '">' +
        (crew.length
          ? shown.map(p => "<i>" + esc(p.name.slice(0, 2)) + "</i>").join("") +
            (more > 0 ? '<i class="more">+' + more + "</i>" : "")
          : '<i class="none">·</i>') + "</button>";
    }).join("");
    return '<div class="wrow"><div class="wlbl"><b>' + esc(s.code) + "</b>" +
      "<em>" + siteProgress(s) + "%</em></div>" + cells + "</div>";
  }).join("");

  const foot = '<div class="wrow wfoot"><div class="wlbl"><b>Libres</b></div>' +
    dates.map((d, i) => {
      const n = store.people.filter(p => availableOn(p.id, d) && isFreeOn(p.id, d)).length;
      return '<div class="wcell' + (WEEKEND[i] ? " we" : "") + (i === ui.day ? " sel" : "") + '">' +
        "<i" + (n ? "" : ' class="none"') + ">" + n + "</i></div>";
    }).join("") + "</div>";

  const posed = rows.reduce((a, s) =>
    a + dates.reduce((b, d) => b + teamOn(s, d).length, 0), 0);

  setHTML(view, '<div class="stack">' +
    '<div class="card" style="padding:12px">' +
      '<span class="eyebrow">Semaine ' + weekNum(wk) + " · " + fmtRange(wk) + "</span>" +
      '<p style="margin:8px 0 0;font:400 13.5px/1.5 var(--fb);color:var(--ink-2)">' +
        "<b>" + posed + "</b> journée" + (posed > 1 ? "s" : "") + " posée" + (posed > 1 ? "s" : "") +
        " sur <b>" + rows.length + "</b> chantier" + (rows.length > 1 ? "s" : "") +
        ". Touchez une case pour aller à ce jour." +
      "</p>" +
      '<button class="btn blue wide" id="optiBtn" style="margin-top:11px">' +
        "Répartir toute l'équipe sur la semaine</button></div>" +
    (rows.length
      ? '<div class="card wgrid-wrap"><div class="wgrid">' + head + body + foot + "</div></div>"
      : '<div class="card"><p class="brief-empty">Aucun chantier sur cette semaine.</p></div>') +
    "</div>");
}

function renderEquipe(){
  if (!store.people.length) {
    setHTML(view, '<div class="card blank"><h3>Aucun compagnon</h3>' +
      "<p>Ajoutez votre équipe : un nom, les jours de présence, le permis, " +
      "et le niveau de 1 à 5 dans les cinq corps de métier.</p>" +
      '<button class="btn primary" id="firstPerson">Ajouter un compagnon</button></div>');
    return;
  }
  const wk = ui.week;
  const rows = store.people.slice()
    .sort((a, b) => avgLv(b) - avgLv(a) || a.name.localeCompare(b.name)).map(p => {
    const on = sitesInWeek(p.id, wk);
    const badges = on.length
      ? on.map(s => '<span class="badge-site">' + esc(s.code) + "</span>").join("")
      : '<span class="badge-site" style="color:var(--ok)">Libre</span>';
    const eff = daysOf(p, wk), ans = answered(p, wk), req = store.availOf(p.id, wk);
    const days = '<span class="wkdays' + (ans ? " answered" : "") + '"' +
      (ans ? ' title="Jours déclarés par ' + esc(p.name) + '"' : "") + ">" +
      DAYS.map((d, i) => '<s class="' + (eff[i] ? "on" : "") + (WEEKEND[i] ? " we" : "") + '">' +
        d[0] + "</s>").join("") + "</span>";
    const askState = ans ? '<span class="ask ok">a répondu</span>'
      : req ? '<span class="ask wait">relancé</span>'
      : (p.phone ? "" : '<span class="ask none">pas de numéro</span>');
    const grid = SKILLS.map(sk =>
      '<span class="sk"><em>' + sk.ab + "</em>" + meterHTML(p.sk[sk.id], sk.c, 5) + "</span>").join("");
    return '<button class="prow" data-edit-person="' + p.id + '">' +
      '<span class="who"><span class="nm">' + esc(p.name) + "</span>" +
      '<span class="meta">' + badges + days + askState +
      (p.permis ? "<span>permis</span>" : "") + "</span></span>" +
      '<span class="grid">' + grid + "</span></button>";
  }).join("");

  const day = curDay();
  const libre = store.people.filter(p => availableOn(p.id, day) && isFreeOn(p.id, day)).length;
  const withPhone = store.people.filter(p => p.phone).length;
  const got = store.people.filter(p => answered(p, wk)).length;

  setHTML(view,
    '<div class="stack">' +
      '<div class="card" style="padding:12px">' +
        '<span class="eyebrow">Effectif · semaine ' + weekNum(wk) + "</span>" +
        '<p style="margin:8px 0 0;font:400 13.5px/1.5 var(--fb);color:var(--ink-2)">' +
          "<b>" + store.people.length + "</b> compagnons. " + DAYS_L[ui.day] + " " + fmtDay(day) +
          ", <b>" + libre + "</b> sont disponibles et non affectés. " +
          "Touchez une ligne pour régler les niveaux, les jours de présence et le permis." +
        "</p></div>" +
      '<div class="card" style="padding:12px;display:flex;flex-direction:column;gap:9px">' +
        '<div style="display:flex;align-items:center;gap:9px">' +
          '<span class="eyebrow" style="flex:1">Disponibilités · sem. ' + weekNum(wk) + "</span>" +
          '<span class="ph-wk">' + got + "/" + store.people.length + "</span></div>" +
        '<p class="hint">Envoyez à chacun un lien nominatif : il coche ses jours, ' +
        "et sa réponse remplace ici sa disponibilité habituelle pour cette semaine-là." +
        (withPhone < store.people.length
          ? " <b>" + (store.people.length - withPhone) + "</b> fiche" +
            (store.people.length - withPhone > 1 ? "s n'ont" : " n'a") + " pas de numéro."
          : "") + "</p>" +
        '<button class="btn blue" id="askAll">Demander les dispos · semaine ' + weekNum(askWeek()) +
          (askWeek() !== wk ? " (la prochaine)" : "") + "</button>" +
      "</div>" +
      '<div class="card">' + rows + "</div>" +
    "</div>");
}

function renderWeekbar(){
  const wk = ui.week, now = mondayOf(todayISO()), today = todayISO();
  const lbl = $("#wkLbl");
  lbl.classList.toggle("off", wk !== now);
  lbl.querySelector("b").textContent = "Sem. " + weekNum(wk) + " · " + fmtRange(wk);
  $("#wkToday").hidden = wk === now && ui.day === dayIndex(today);

  setHTML($("#daybar"), weekDates(wk).map((d, i) => {
    const dt = parse(d);
    return '<button role="tab" data-day="' + i + '" aria-selected="' + (i === ui.day) + '"' +
      ' class="' + (WEEKEND[i] ? "we " : "") + (d === today ? "today" : "") + '">' +
      "<em>" + DAYS[i] + "</em><b>" + dt.getDate() + "</b></button>";
  }).join(""));
}

/* Une mise à jour peut arriver du serveur pendant un glisser ou une
   saisie : on diffère alors le rendu pour ne pas arracher le DOM. */
let renderPending = false;
function requestRender(){
  const ae = document.activeElement;
  if ((drag && drag.active) || bar || (ae && ae.matches && ae.matches("textarea,input"))) {
    renderPending = true; return;
  }
  renderPending = false;
  render();
}
function flushRender(){ if (renderPending) requestRender(); }

function render(){
  $$(".tabbar button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === ui.tab)));
  $("#banner").hidden = store.mode !== "local";
  renderWeekbar();
  if (ui.tab === "chantiers") renderChantiers();
  else if (ui.tab === "semaine") renderSemaine();
  else renderEquipe();
  renderPool();

  const day = curDay();
  $("#topsub").textContent =
    plur(store.sites.filter(s => teamOn(s, day).length).length, "chantier ouvert", "chantiers ouverts") +
    " · " + plur(store.people.filter(p => availableOn(p.id, day) && isFreeOn(p.id, day)).length, "libre");
}

function renderPool(){
  const day = curDay();
  const hide = ui.tab !== "chantiers" || !store.people.length;
  /* Le vivier ne montre que ceux qui peuvent venir CE jour-là. */
  const free = store.people.filter(p => availableOn(p.id, day) && isFreeOn(p.id, day))
    .sort((a, b) => dispoWk(b, ui.week) - dispoWk(a, ui.week) || avgLv(b) - avgLv(a));

  const island = $("#vivier");
  island.hidden = hide;
  if (hide) return;

  $("#bubbleN").textContent = free.length;
  island.classList.toggle("empty", !free.length);
  island.dataset.state = ui.poolState;
  $("#vivierFace").setAttribute("aria-label",
    "Ouvrir le vivier — " + free.length + " disponible" + (free.length > 1 ? "s" : ""));

  setHTML($("#pool"), free.length
    ? free.map(p => chipHTML(p, null)).join("")
    : '<p class="empty-hint">Personne de libre ' + DAYS_L[ui.day].toLowerCase() + ".</p>");
  $("#vivierLbl").textContent = "Vivier · " + DAYS[ui.day].toLowerCase() + " · " + free.length;
  $("#vivierHead").setAttribute("aria-expanded", String(ui.poolState === "open"));
  sizeIsland();
}

/* Hauteur et largeur de l'îlot.
   Deux valeurs en pixels de part et d'autre : une largeur en pourcentage
   ne s'interpole pas, et une hauteur « auto » non plus. On mesure donc
   le contenu, et on plafonne pour ne jamais couvrir l'écran. */
function sizeIsland(){
  const island = $("#vivier");
  /* L'îlot flotte au-dessus de la liste : on lui réserve sa place en bas
     du défilement, sinon la dernière fiche passe dessous. */
  const reserve = h => { view.style.paddingBottom = (h + 26) + "px"; };
  if (island.hidden) { view.style.paddingBottom = ""; return; }
  if (ui.poolState === "bubble") {
    island.style.maxWidth = "152px";
    island.style.maxHeight = "46px";
    reserve(46);
    return;
  }
  island.style.maxWidth = "640px";                 // au-delà de la colonne : plein cadre
  requestAnimationFrame(() => {
    const full = $("#vivierFull"), pool = $("#pool");
    if (!full || ui.poolState !== "open") return;
    /* Sans cela on mesurerait la mesure précédente : la hauteur du
       vivier plafonne son propre contenu, et l'îlot rétrécit à chaque
       rendu jusqu'à couper son texte. */
    pool.style.maxHeight = "";
    /* On additionne les deux morceaux plutot que de lire scrollHeight sur
       .island-full : cette derniere est contrainte par la hauteur deja
       posee sur l'ilot, et se mesurerait elle-meme. */
    const headH = $(".island-head").offsetHeight;
    const wanted = headH + pool.scrollHeight + 12 + 2;
    const capped = Math.min(wanted, Math.round(window.innerHeight * 0.42));
    island.style.maxHeight = capped + "px";
    pool.style.maxHeight = Math.max(40, capped - headH - 14) + "px";
    reserve(capped);
  });
}
addEventListener("resize", () => { if (ui.tab === "chantiers") sizeIsland(); });

function paintStatus(s, n){
  const el = $("#statusBtn");
  el.className = "status " + (s === "ok" ? "ok" : s === "off" ? "off" : s === "local" ? "local" : "busy");
  $("#statusTxt").textContent =
    s === "ok" ? "À jour" : s === "off" ? n + " en attente" : s === "local" ? "Local" : "…";
}

/* ---------- écran de connexion ---------- */
function paintGate(){
  const gate = $("#gate");
  if (store.mode === "local" || store.user) { gate.hidden = true; return; }
  gate.hidden = false;
  gate.innerHTML =
    markHTML() +
    "<h2>Geoplan</h2>" +
    "<p>Planification des chantiers et de l'équipe. Entrez votre adresse : " +
    "vous recevrez un lien de connexion, sans mot de passe à retenir.</p>" +
    '<form id="gateForm">' +
      '<input type="email" id="gateMail" placeholder="vous@exemple.fr" ' +
             'autocomplete="email" inputmode="email" required>' +
      '<button class="btn primary wide" type="submit" id="gateGo">Recevoir le lien</button>' +
    "</form>" +
    '<div id="gateMsg"></div>';

  $("#gateForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("#gateGo"), mail = $("#gateMail").value.trim();
    if (!mail) return;
    btn.disabled = true; btn.textContent = "Envoi…";
    try {
      await store.signIn(mail);
      $("#gateMsg").innerHTML = '<div class="msg">Lien envoyé à <b>' + esc(mail) +
        "</b>. Ouvrez-le depuis ce téléphone : vous serez connecté directement.</div>";
      btn.textContent = "Lien envoyé";
    } catch(err) {
      $("#gateMsg").innerHTML = '<div class="msg err">' +
        esc(err && err.message ? err.message : "Envoi impossible") + "</div>";
      btn.disabled = false; btn.textContent = "Recevoir le lien";
    }
  });
}

/* ============================================================
   Affectation — l'unité est le jour
   ============================================================ */

/* Pose ou retire un compagnon sur un chantier, un jour donné.
   Hors mode urgence, il quitte les autres chantiers de CE jour. */
function assignDay(pid, sid, day, urgence){
  const before = sitesOnDay(pid, day);
  if (!sid) {
    before.forEach(s => { setTeamOn(s, day, teamOn(s, day).filter(x => x !== pid)); store.touchSite(s.id); });
    return before;
  }
  const target = site(sid);
  if (!target || teamOn(target, day).indexOf(pid) > -1) return [];
  if (!urgence)
    before.forEach(s => { setTeamOn(s, day, teamOn(s, day).filter(x => x !== pid)); store.touchSite(s.id); });
  setTeamOn(target, day, teamOn(target, day).concat([pid]));
  store.touchSite(target.id);
  return before;
}

function assign(pid, sid, urgence){
  const day = curDay(), p = person(pid);
  if (!p) return;
  const quand = " · " + DAYS_L[ui.day].toLowerCase() + " " + fmtDay(day);
  const before = assignDay(pid, sid, day, urgence);

  if (!sid) {
    if (!before.length) return;
    toast(esc(p.name) + " retiré de <b>" + esc(before[0].code) + "</b>" + quand);
  } else {
    const target = site(sid);
    if (urgence && before.length)
      toast("<b>Urgence</b> — " + esc(p.name) + " est aussi sur <b>" + esc(target.code) + "</b>" + quand);
    else if (before.length)
      toast(esc(p.name) + " : <b>" + esc(before[0].code) + "</b> &rarr; <b>" +
        esc(target.code) + "</b>" + quand);
    else
      toast(esc(p.name) + " sur <b>" + esc(target.code) + "</b>" + quand);
    if (!availableOn(pid, day))
      setTimeout(() => toast("Attention : " + esc(p.name) + " s'est déclaré absent ce jour-là"), 2900);
  }
  render();
}

/* ============================================================
   Glisser-déposer tactile
   Le drag-and-drop HTML5 n'existe pas sur iOS : on le reconstruit au
   doigt. Les puces sont en touch-action:none — un geste qui part d'une
   puce ne peut pas faire défiler la liste, autant le convertir tout de
   suite en déplacement.
   ============================================================ */

let drag = null;

function lift(){
  if (!drag || drag.active) return;
  drag.active = true;
  clearTimeout(drag.timer);
  drag.chip.classList.add("lifted");
  document.body.classList.add("dragging");
  const p = person(drag.pid);
  ghost.textContent = p ? p.name : "";
  ghost.hidden = false;
  moveGhost(drag.cur);
  if (navigator.vibrate) { try { navigator.vibrate(12); } catch(e){} }
}

function moveGhost(pt){
  ghost.style.left = pt.x + "px";
  ghost.style.top = (pt.y - 26) + "px";
}

document.addEventListener("pointerdown", e => {
  if (e.button !== undefined && e.button !== 0) return;
  const chip = e.target.closest && e.target.closest(".chip");
  if (!chip) return;
  const start = {x:e.clientX, y:e.clientY};
  drag = {pid:chip.dataset.pid, chip, start, cur:start, active:false, target:null,
          timer:setTimeout(lift, 190)};
}, {passive:true});

document.addEventListener("pointermove", e => {
  if (!drag) return;
  const pt = {x:e.clientX, y:e.clientY};
  drag.cur = pt;
  if (!drag.active) {
    const dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
    if (dx*dx + dy*dy > 64) lift(); else return;
  }
  e.preventDefault();
  moveGhost(pt);
  const under = document.elementFromPoint(pt.x, pt.y);
  const zone = under && under.closest ? under.closest("[data-drop]") : null;
  const viv = under && under.closest ? under.closest("#vivier") : null;
  const next = zone ? zone.dataset.drop : (viv ? "__pool" : null);
  if (next !== drag.target) {
    clearDropHints();
    drag.target = next;
    if (zone) { zone.classList.add("over"); if (ui.urgence) zone.classList.add("urg"); }
    else if (viv) viv.classList.add("over");
  }
  autoScroll(pt);
}, {passive:false});

let scrollRAF = null;
function autoScroll(pt){
  const r = view.getBoundingClientRect();
  let dir = 0;
  if (pt.y < r.top + 56) dir = -1;
  else if (pt.y > r.bottom - 56) dir = 1;
  cancelAnimationFrame(scrollRAF);
  if (!dir) return;
  const step = () => {
    if (drag && drag.active) { view.scrollTop += dir * 9; scrollRAF = requestAnimationFrame(step); }
  };
  scrollRAF = requestAnimationFrame(step);
}

function onUp(){
  if (!drag) return;
  clearTimeout(drag.timer);
  cancelAnimationFrame(scrollRAF);
  const d = drag; drag = null;
  document.body.classList.remove("dragging");
  ghost.hidden = true;
  d.chip.classList.remove("lifted");
  clearDropHints();

  if (d.active) {
    /* Un dépôt sur la bulle ne doit pas aussi la rouvrir. Le garde-fou
       se lève tout seul : selon le navigateur, le clic fantôme ne vient
       pas toujours, et il ne doit pas manger le geste suivant. */
    if (d.target === "__pool") {
      if (ui.poolState === "bubble") {
        bubbleWasDropTarget = true;
        setTimeout(() => { bubbleWasDropTarget = false; }, 400);
      }
      assign(d.pid, null, false);
    }
    else if (d.target) assign(d.pid, d.target, ui.urgence);
    else flushRender();
  } else personSheet(d.pid, d.chip.dataset.site || null);
}
document.addEventListener("pointerup", onUp);
document.addEventListener("pointercancel", onUp);
document.addEventListener("touchmove", e => { if (drag && drag.active) e.preventDefault(); }, {passive:false});
document.addEventListener("contextmenu", e => { if (drag && drag.active) e.preventDefault(); });

/* ============================================================
   Barres de progression
   ============================================================ */

let bar = null;
/* La barre s'arrete sur un cran par mission : glisser, c'est cocher. */
function barValue(track, clientX){
  const r = track.getBoundingClientRect();
  const steps = phaseSteps(+track.dataset.i);
  const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  return Math.round(frac * steps) / steps * 100;
}
view.addEventListener("pointerdown", e => {
  const t = e.target.closest(".ph-track");
  if (!t) return;
  bar = {t, sid:t.dataset.sid, i:+t.dataset.i, x:e.clientX, y:e.clientY, on:false};
});
view.addEventListener("pointermove", e => {
  if (!bar) return;
  if (!bar.on) {
    const dx = Math.abs(e.clientX - bar.x), dy = Math.abs(e.clientY - bar.y);
    if (dy > dx && dy > 6) { bar = null; return; }     // l'utilisateur défile
    if (dx < 4) return;
    bar.on = true;
    if (bar.t.setPointerCapture) bar.t.setPointerCapture(e.pointerId);
  }
  e.preventDefault();
  setPhase(bar.sid, bar.i, barValue(bar.t, e.clientX), true);
});
view.addEventListener("pointerup", e => {
  if (!bar) return;
  const b = bar; bar = null;
  if (b.on) setPhase(b.sid, b.i, barValue(b.t, e.clientX), false);
  else { const s = site(b.sid); setPhase(b.sid, b.i, s.ph[b.i] >= 100 ? 0 : 100, false); }
});
view.addEventListener("pointercancel", () => { bar = null; flushRender(); });
view.addEventListener("keydown", e => {
  const t = e.target.closest(".ph-track"); if (!t) return;
  const s = site(t.dataset.sid), i = +t.dataset.i;
  let v = s.ph[i];
  if (e.key === "ArrowRight" || e.key === "ArrowUp") v = Math.min(100, v + 5);
  else if (e.key === "ArrowLeft" || e.key === "ArrowDown") v = Math.max(0, v - 5);
  else if (e.key === "Enter" || e.key === " ") v = v >= 100 ? 0 : 100;
  else return;
  e.preventDefault(); setPhase(s.id, i, v, false);
});

function setPhase(sid, i, v, live){
  const s = site(sid);
  if (!s) return;
  const before = s.ph[i];
  v = setPhasePct(s, i, v);            // la barre et les missions ne font qu'un
  if (before === v && !live) { render(); return; }
  if (live) {                                   // retour immédiat, sans re-rendu complet
    const card = view.querySelector('[data-site="' + sid + '"]');
    const track = card.querySelector('.ph-track[data-i="' + i + '"]');
    track.querySelector("b").style.width = v + "%";
    track.setAttribute("aria-valuenow", v);
    track.closest(".ph-body").querySelector(".ph-pct").textContent = v + "%";
    card.querySelectorAll(".ladder i")[i].querySelector("b").style.height = v + "%";
    card.querySelector(".site-pct b").textContent = siteProgress(s) + "%";
    const ticks = taskDone(s, i);
    card.querySelectorAll('[data-task^="' + sid + "#" + i + '#"]').forEach(b => {
      const j = +b.dataset.task.split("#")[2];
      b.classList.toggle("on", !!ticks[j]);
      b.setAttribute("aria-pressed", String(!!ticks[j]));
    });
  } else { store.touchSite(sid); render(); }
}

/* ============================================================
   Feuilles
   ============================================================ */

function closeSheet(){ sheetRoot.innerHTML = ""; flushRender(); }

function sheet(title, sub, bodyHTML, onMount){
  sheetRoot.innerHTML =
    '<div class="sheet-root"><div class="backdrop" data-close></div>' +
    '<section class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<header class="sheet-head"><div style="flex:1"><h2>' + esc(title) + "</h2>" +
      (sub ? "<p>" + esc(sub) + "</p>" : "") + "</div>" +
      '<button class="icon-btn" data-close aria-label="Fermer">&times;</button></header>' +
      '<div class="sheet-body">' + bodyHTML + "</div></section></div>";
  sheetRoot.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheet));
  if (onMount) onMount(sheetRoot);
  /* Le doigt qui vient de relever la puce déclenche un clic juste après
     l'ouverture : on neutralise la feuille le temps de cette milliseconde. */
  const panel = sheetRoot.firstElementChild;
  if (panel) {
    panel.style.pointerEvents = "none";
    setTimeout(() => { panel.style.pointerEvents = ""; }, 280);
  }
}
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

let toastT = null;
function toast(html){
  const r = $("#toastRoot");
  r.innerHTML = '<div class="toast">' + html + "</div>";
  clearTimeout(toastT);
  toastT = setTimeout(() => r.innerHTML = "", 2800);
}

/* Contact et état de la demande de disponibilité, dans la fiche. */
function contactHTML(p, wk){
  const a = store.availOf(p.id, wk);
  let etat;
  if (a && a.days)
    etat = '<div class="callout">A répondu pour la semaine ' + weekNum(wk) + " : <b>" +
      (countDays(a.days) ? DAYS.filter((d, i) => a.days[i]).join(" ") : "aucun jour") + "</b>" +
      (a.note ? "<br>« " + esc(a.note) + " »" : "") + "</div>";
  else if (a)
    etat = '<div class="callout warn">Demande envoyée pour la semaine ' + weekNum(wk) +
      ", sans réponse pour l'instant.</div>";
  else etat = "";

  if (!p.phone)
    return etat + '<div class="field"><label>Contact</label>' +
      '<p class="hint">Aucun numéro enregistré. Ajoutez-le pour pouvoir l\'appeler ' +
      "et lui demander ses disponibilités.</p></div>";

  const tel = p.phone;
  return etat +
    '<div class="field"><label>Contact · ' + esc(fmtPhone(tel)) + "</label>" +
    '<div class="seg">' +
      '<a class="btn" href="tel:' + tel + '">Appeler</a>' +
      '<a class="btn" href="sms:' + tel + '">SMS</a>' +
      '<a class="btn" href="https://wa.me/' + tel.slice(1) + '" target="_blank" rel="noopener">WhatsApp</a>' +
    "</div>" +
    '<button class="btn wide" data-ask style="margin-top:6px">Demander ses dispos · sem. ' +
      weekNum(askWeek()) + "</button></div>";
}

/* Menu d'un compagnon. Ouvert depuis une puce posée sur un chantier, il
   propose le réglage jour par jour de sa présence sur CE chantier. */
function personSheet(pid, fromSid){
  const p = person(pid); if (!p) return;
  const wk = ui.week, day = curDay();
  const here = sitesOnDay(pid, day);
  const dates = weekDates(wk);

  const dayGrid = sid => {
    const s = site(sid);
    const on = daysOnSite(s, pid, wk);
    return '<div class="field"><label>Jours sur ' + esc(s.code) + " · sem. " + weekNum(wk) + "</label>" +
      '<div class="daypick" data-site="' + sid + '">' + DAYS.map((d, i) => {
        const ok = availableOn(pid, dates[i]);
        return '<button data-i="' + i + '" aria-pressed="' + on[i] + '"' +
          (ok ? "" : ' class="off" title="s\'est déclaré absent"') + ">" +
          "<em>" + d + "</em><b>" + parse(dates[i]).getDate() + "</b></button>";
      }).join("") + "</div>" +
      '<div class="seg" style="margin-top:6px">' +
        '<button class="btn sm" data-fill="dispo" data-site="' + sid + '">Ses jours dispo</button>' +
        '<button class="btn sm" data-fill="none" data-site="' + sid + '">Aucun</button>' +
      "</div></div>";
  };

  const list = store.sites.map(s => {
    const on = teamOn(s, day).indexOf(pid) > -1;
    return '<button class="btn wide" style="justify-content:flex-start;margin-bottom:6px' +
      (on ? ";opacity:.5" : "") + '" data-go="' + s.id + '"' + (on ? " disabled" : "") + ">" +
      '<span style="font-family:var(--fm);font-weight:600">' + esc(s.code) + "</span>" +
      '<span style="color:var(--muted);font-weight:400;font-size:12.5px">' + esc(s.addr) + "</span>" +
      (on ? '<span class="spacer"></span><span style="color:var(--ok);font-size:12px">ici</span>' : "") +
      "</button>";
  }).join("");

  const eff = daysOf(p, wk);
  sheet(p.name,
    DAYS_L[ui.day] + " " + fmtDay(day) + " · " +
      (here.length ? "sur " + here.map(s => s.code).join(" + ") : "libre") +
      " · dispo " + DAYS.filter((d, i) => eff[i]).join(" "),
    (fromSid ? dayGrid(fromSid) : "") +
    contactHTML(p, wk) +
    (store.sites.length ? '<div class="field"><label>Poser sur · ' +
      DAYS_L[ui.day].toLowerCase() + " " + fmtDay(day) + "</label>" + list + "</div>" : "") +
    (here.length ? '<button class="btn wide" data-free>Retirer de ce jour</button>' : "") +
    '<button class="btn wide blue" data-edit>Modifier la fiche</button>',
    root => {
      const grid = root.querySelector(".daypick");
      if (grid) grid.addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        const s = site(grid.dataset.site), i = +b.dataset.i, d = dates[i];
        const on = teamOn(s, d).indexOf(pid) > -1;
        if (on) { setTeamOn(s, d, teamOn(s, d).filter(x => x !== pid)); store.touchSite(s.id); }
        else assignDay(pid, s.id, d, ui.urgence);
        b.setAttribute("aria-pressed", String(!on));
        render();
      });
      root.querySelectorAll("[data-fill]").forEach(b => b.addEventListener("click", () => {
        const s = site(b.dataset.site), mode = b.dataset.fill;
        dates.forEach((d, i) => {
          const want = mode === "dispo" && eff[i];
          const on = teamOn(s, d).indexOf(pid) > -1;
          if (want && !on) assignDay(pid, s.id, d, ui.urgence);
          else if (!want && on) { setTeamOn(s, d, teamOn(s, d).filter(x => x !== pid)); store.touchSite(s.id); }
        });
        closeSheet(); render();
        toast(mode === "dispo"
          ? esc(p.name) + " posé sur <b>" + esc(s.code) + "</b> tous ses jours dispo"
          : esc(p.name) + " retiré de <b>" + esc(s.code) + "</b> cette semaine");
      }));
      const ask = root.querySelector("[data-ask]");
      if (ask) ask.addEventListener("click", () => { closeSheet(); availSheet(askWeek(), [pid]); });
      root.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => {
        closeSheet(); assign(pid, b.dataset.go, ui.urgence);
      }));
      const f = root.querySelector("[data-free]");
      if (f) f.addEventListener("click", () => { closeSheet(); assign(pid, null, false); });
      root.querySelector("[data-edit]").addEventListener("click", () => editPerson(pid));
    });
}

function editPerson(pid){
  const p = pid ? person(pid)
    : {id:null, name:"", phone:"", days:[true,true,true,true,true,false,false], permis:false,
       sk:{elec:1, plomb:1, platre:1, peint:1, menuis:1}, note:""};
  const draft = JSON.parse(JSON.stringify(p));

  const levels = SKILLS.map(sk =>
    '<div class="lv"><span class="name"><span class="dot" style="background:' + sk.c + '"></span>' +
    sk.label + "</span>" +
    '<span class="steps" data-sk="' + sk.id + '">' +
      [1,2,3,4,5].map(n => '<button data-n="' + n + '" aria-pressed="' + (draft.sk[sk.id] === n) + '"' +
        (draft.sk[sk.id] === n ? ' style="background:' + sk.c + '"' : "") + ">" + n + "</button>").join("") +
    "</span></div>").join("");

  sheet(pid ? p.name : "Nouveau compagnon", pid ? "Fiche compagnon" : "Ajouter au vivier",
    '<div class="field"><label>Nom</label><input type="text" id="f-name" value="' +
      esc(draft.name) + '" placeholder="Prénom"></div>' +
    '<div class="field"><label>Téléphone</label>' +
      '<input type="tel" id="f-phone" value="' + esc(fmtPhone(draft.phone)) + '" ' +
      'placeholder="06 12 34 56 78" autocomplete="tel" inputmode="tel">' +
      '<p class="hint">Sert à l\'appeler, et à lui envoyer le lien de demande ' +
      "de disponibilité. Les numéros français sont convertis au format international.</p></div>" +
    '<div class="field"><label>Disponibilité habituelle</label>' +
      '<div class="daypick" id="f-days">' + DAYS.map((d, i) =>
        '<button data-i="' + i + '" aria-pressed="' + draft.days[i] + '"' +
        (WEEKEND[i] ? ' class="we"' : "") + "><em>" + d + "</em></button>").join("") + "</div>" +
      '<p class="hint" id="f-daysN"></p></div>' +
    '<div class="field"><label>Permis de conduire</label>' +
      '<div class="seg" id="f-permis">' +
        '<button data-v="1" aria-pressed="' + draft.permis + '">Oui</button>' +
        '<button data-v="0" aria-pressed="' + !draft.permis + '">Non</button></div>' +
      '<p class="hint">Le moteur de composition garde au moins un permis par équipe, ' +
      "pour l'amenée matérielle.</p></div>" +
    '<div class="field"><label>Compétences · niveau 1 à 5</label><div>' + levels + "</div></div>" +
    '<div class="field"><label>Remarque</label><input type="text" id="f-note" value="' +
      esc(draft.note) + '" placeholder="Spécialité, contrainte…"></div>' +
    '<button class="btn wide primary" id="f-save">' + (pid ? "Enregistrer" : "Ajouter au vivier") + "</button>" +
    (pid ? '<button class="btn wide danger" id="f-del">Supprimer ' + esc(p.name) + "</button>" : ""),
    root => {
      const daysN = root.querySelector("#f-daysN");
      const refreshDays = () => {
        const n = countDays(draft.days);
        daysN.textContent = n + " jour" + (n > 1 ? "s" : "") + " par semaine, soit " + n + " j·h fournis." +
          (draft.days[5] || draft.days[6] ? " Week-end compris." : "");
      };
      refreshDays();
      root.querySelector("#f-days").addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        const i = +b.dataset.i;
        draft.days[i] = !draft.days[i];
        b.setAttribute("aria-pressed", String(draft.days[i]));
        refreshDays();
      });
      root.querySelectorAll(".steps").forEach(g => g.addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        const k = g.dataset.sk, c = skColor(k);
        draft.sk[k] = +b.dataset.n;
        g.querySelectorAll("button").forEach(x => {
          const on = +x.dataset.n === draft.sk[k];
          x.setAttribute("aria-pressed", String(on));
          x.style.background = on ? c : "";
        });
      }));
      root.querySelector("#f-permis").addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        draft.permis = b.dataset.v === "1";
        root.querySelectorAll("#f-permis button").forEach(x =>
          x.setAttribute("aria-pressed", String((x.dataset.v === "1") === draft.permis)));
      });
      root.querySelector("#f-save").addEventListener("click", () => {
        const name = root.querySelector("#f-name").value.trim();
        if (!name) { root.querySelector("#f-name").focus(); toast("Il manque le nom"); return; }
        if (!draft.days.some(Boolean)) { toast("Il faut au moins un jour de présence"); return; }
        const rawPhone = root.querySelector("#f-phone").value.trim();
        if (rawPhone && !normPhone(rawPhone)) {
          root.querySelector("#f-phone").focus();
          toast("Ce numéro n'a pas l'air valide"); return;
        }
        draft.name = name;
        draft.phone = rawPhone;
        draft.note = root.querySelector("#f-note").value.trim();
        store.put("people", normPerson(pid || uid("p_"), draft));
        closeSheet(); render();
        toast(esc(name) + (pid ? " enregistré" : " ajouté au vivier"));
      });
      const del = root.querySelector("#f-del");
      if (del) {
        let armed = false;
        del.addEventListener("click", () => {
          if (!armed) { armed = true; del.textContent = "Confirmer la suppression"; return; }
          store.sites.forEach(s => {
            let hit = false;
            Object.keys(s.plan || {}).forEach(d => {
              if (teamOn(s, d).indexOf(pid) > -1) {
                setTeamOn(s, d, teamOn(s, d).filter(x => x !== pid)); hit = true;
              }
            });
            if (hit) store.touchSite(s.id);
          });
          store.remove("people", pid);
          closeSheet(); render(); toast(esc(p.name) + " supprimé");
        });
      }
    });
}

function editSite(sid){
  const s = sid ? site(sid)
    : {id:null, code:"", addr:"", start:todayISO(), months:2, coef:1,
       ph:Array(12).fill(0), note:"", plan:{}};
  let months = s.months, coef = s.coef || 1;
  const COEFS = [{v:0.7, l:"Studio"}, {v:1, l:"T2 · T3"}, {v:1.4, l:"T4 et +"}];

  sheet(sid ? s.code : "Nouveau chantier", sid ? s.addr : "Code court + adresse",
    '<div class="field"><label>Adresse</label><input type="text" id="c-addr" value="' +
      esc(s.addr) + '" placeholder="151 Henri Desbals apt 7"></div>' +
    '<div class="field"><label>Code chantier</label>' +
      '<input type="text" id="c-code" value="' + esc(s.code) + '" placeholder="151HD7" autocapitalize="characters">' +
      '<p class="hint" id="c-codeHint">Proposé depuis l\'adresse : numéro de voie + initiales de la ' +
      "rue + numéro d'appartement. Modifiez-le si votre convention diffère.</p></div>" +
    '<div class="field"><label>Début</label><input type="date" id="c-start" value="' + esc(s.start) + '"></div>' +
    '<div class="field"><label>Durée annoncée</label><div class="seg" id="c-months">' +
      [2,3,4].map(n => '<button data-n="' + n + '" aria-pressed="' + (months === n) + '">' +
        n + " mois</button>").join("") + "</div></div>" +
    '<div class="field"><label>Volume</label><div class="seg" id="c-coef">' +
      COEFS.map(c => '<button data-v="' + c.v + '" aria-pressed="' + (coef === c.v) + '">' +
        c.l + "</button>").join("") +
      '</div><p class="hint" id="c-load"></p></div>' +
    '<button class="btn wide primary" id="c-save">' + (sid ? "Enregistrer" : "Ouvrir le chantier") + "</button>" +
    (sid ? '<button class="btn wide danger" id="c-del">Supprimer le chantier</button>' : ""),
    root => {
      /* Le code se déduit de l'adresse, tant que l'utilisateur ne l'a
         pas écrit lui-même : on ne remplace jamais une saisie manuelle. */
      const codeEl = root.querySelector("#c-code"), addrEl = root.querySelector("#c-addr");
      const hintEl = root.querySelector("#c-codeHint");
      let auto = codeEl.value.trim() === "" || codeEl.value.trim() === codeFromAddr(addrEl.value);
      addrEl.addEventListener("input", () => {
        if (!auto) return;
        const guess = codeFromAddr(addrEl.value);
        codeEl.value = guess;
        hintEl.textContent = guess
          ? "Proposé depuis l'adresse. Modifiez-le si votre convention diffère."
          : "Saisissez l'adresse, le code se remplira tout seul.";
      });
      codeEl.addEventListener("input", () => {
        auto = codeEl.value.trim() === "" || codeEl.value.trim() === codeFromAddr(addrEl.value);
        if (!auto) hintEl.textContent = "Code saisi à la main : il ne suivra plus l'adresse.";
      });

      const loadP = root.querySelector("#c-load");
      const refresh = () => {
        const tot = Math.round(TOTAL_JH * coef), weeks = Math.round(months * 4.33);
        loadP.innerHTML = "Charge de référence : <b>" + tot + " jours-homme</b> sur les 12 étapes. " +
          "Réparti sur " + weeks + " semaines, il faut environ <b>" +
          Math.max(1, Math.ceil(tot / (weeks * 4.6))) + " compagnons</b> à plein temps.";
      };
      refresh();
      root.querySelector("#c-months").addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        months = +b.dataset.n;
        root.querySelectorAll("#c-months button").forEach(x =>
          x.setAttribute("aria-pressed", String(+x.dataset.n === months)));
        refresh();
      });
      root.querySelector("#c-coef").addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        coef = +b.dataset.v;
        root.querySelectorAll("#c-coef button").forEach(x =>
          x.setAttribute("aria-pressed", String(+x.dataset.v === coef)));
        refresh();
      });
      root.querySelector("#c-save").addEventListener("click", () => {
        const code = root.querySelector("#c-code").value.trim().toUpperCase();
        if (!code) { root.querySelector("#c-code").focus(); toast("Il manque le code chantier"); return; }
        const id = sid || uid("s_");
        const base = sid ? site(sid) : {ph:Array(12).fill(0), note:"", plan:{}};
        store.put("sites", normSite(id, Object.assign({}, base, {
          code,
          addr: root.querySelector("#c-addr").value.trim(),
          start: root.querySelector("#c-start").value || todayISO(),
          months, coef
        })));
        if (!sid) { ui.openSite = id; saveUi(); }
        closeSheet(); render();
        toast("<b>" + esc(code) + "</b> " + (sid ? "enregistré" : "ouvert"));
      });
      const del = root.querySelector("#c-del");
      if (del) {
        let armed = false;
        del.addEventListener("click", () => {
          if (!armed) { armed = true; del.textContent = "Confirmer — l'équipe sera libérée"; return; }
          store.remove("sites", sid);
          closeSheet(); render(); toast("<b>" + esc(s.code) + "</b> supprimé");
        });
      }
    });
}

/* Composition : on raisonne sur la semaine, puis on pose l'équipe jour
   par jour — chacun sur les jours où il est disponible et libre. */
function suggestSheet(sid, size, scope){
  const wk = ui.week, day = curDay(), s = site(sid);
  const dates = weekDates(wk);
  const sc = scope || "week";

  const usable = p => (sc === "day" ? [day] : dates).filter(d =>
    availableOn(p.id, d) && (isFreeOn(p.id, d) || teamOn(s, d).indexOf(p.id) > -1)).length;

  const yest = addDays(day, -1);
  const wasYest = p => teamOn(s, yest).indexOf(p.id) > -1;

  const reco = neededHeadcount(s, wk);
  const n = size || Math.max(2, Math.min(5, reco || weekRoster(s, wk).length || 3));
  const r = suggestTeam(s, n, wk, store.people, usable, wasYest);
  const cur = currentPhase(s);

  const rows = r.team.length ? r.team.map((t, i) =>
    '<div class="sug"><span class="rank">' + (i+1) + "</span>" +
      '<span><span class="nm">' + esc(t.p.name) + "</span>" +
      '<span class="why">' + whyTags(t.why) +
      '<span class="tag">' + t.days + " j posable" + (t.days > 1 ? "s" : "") + "</span>" +
      "</span></span></div>").join("") : '<p class="empty-hint">Personne de disponible et libre sur cette période. ' +
                "Changez de semaine, libérez quelqu'un, ou activez le mode urgence.</p>";

  const cov = coverage(r.team.map(t => t.p.id), person);
  const maxNeed = Math.max.apply(null, SK.map(k => r.need.need[k]).concat([0.001]));
  const covRows = SKILLS.map(sk => {
    const share = r.need.need[sk.id] / maxNeed;
    const req = r.need.soon[sk.id];
    const short = req && cov[sk.id] < req;
    return '<div class="cov-row"><span class="lbl"><span class="dot" style="background:' + sk.c + '"></span>' +
      sk.label + "</span>" +
      '<span class="cov-bar"><b style="width:' + (cov[sk.id]/5*100) + "%;background:" +
      (short ? "var(--urgence)" : sk.c) + ";opacity:" + (0.35 + 0.65*share).toFixed(2) + '"></b></span>' +
      '<span class="v' + (short ? " short" : "") + '">' + cov[sk.id] +
      (req ? "/" + req : "") + "</span></div>";
  }).join("");

  const blocked = uncovered(s, r.team.map(t => t.p.id), person)
    .sort((a, b) => a.phase - b.phase);

  const cap = r.team.reduce((a, t) => a + t.why.days, 0);
  const rest = Math.round(loadLeft(s));
  const endWeeks = cap && sc === "week" ? Math.ceil(rest / cap) : 0;

  sheet("Composition · " + s.code,
    "Étape " + (cur+1) + " — " + PHASES[cur].n,
    '<div class="field"><label>Poser sur</label><div class="seg" id="g-scope">' +
      '<button data-s="day" aria-pressed="' + (sc === "day") + '">' +
        DAYS_L[ui.day] + " " + parse(day).getDate() + "</button>" +
      '<button data-s="week" aria-pressed="' + (sc === "week") + '">Semaine ' + weekNum(wk) + "</button>" +
      "</div></div>" +
    '<div class="callout">Il reste <b>' + rest + " j·h</b>. Pour tenir la date annoncée (" +
      fmtDay(addDays(span(s).last, 6)) + "), il faudrait environ <b>" + reco + " compagnons</b>." +
      (cap ? " Cette équipe pose <b>" + cap + " journée" + (cap > 1 ? "s" : "") + "</b>" +
             (endWeeks ? ", soit une fin en <b>" + endWeeks + " semaine" +
               (endWeeks > 1 ? "s" : "") + "</b>" : "") + "." : "") + "</div>" +
    '<div class="field"><label>Taille de l\'équipe</label><div class="seg" id="g-size">' +
      [2,3,4,5].map(k => '<button data-n="' + k + '" aria-pressed="' + (k === n) + '">' +
        k + "</button>").join("") + "</div></div>" +
    "<div>" + rows + "</div>" +
    '<div class="field"><label>Couverture des métiers restants</label>' +
      '<div class="cov">' + covRows + "</div>" +
      '<p class="hint">L\'intensité de la barre indique le poids du métier dans le travail qui reste ; ' +
      "sa longueur le meilleur niveau de l'équipe, le chiffre celui que les missions exigent. " +
      "En fuchsia, le compte n'y est pas.</p></div>" +
    (blocked.length ? '<div class="field"><label>Missions hors de portée</label>' +
      '<ul class="ph-tasks">' + blocked.slice(0, 5).map(b =>
        "<li>" + esc(b.task.t) + " — " + esc(skLabel(b.task.sk)) + " niv. " + b.need +
        " requis, " + (b.have || "aucun") + " dans l'équipe</li>").join("") + "</ul>" +
      '<p class="hint">Le reste du chantier avance, mais pas ces missions-là.</p></div>' : "") +
    (r.team.length ? '<button class="btn wide primary" id="g-apply">Affecter</button>' : ""),
    root => {
      root.querySelector("#g-scope").addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        suggestSheet(sid, n, b.dataset.s);
      });
      root.querySelector("#g-size").addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        suggestSheet(sid, +b.dataset.n, sc);
      });
      const ap = root.querySelector("#g-apply");
      if (ap) ap.addEventListener("click", () => {
        const ids = r.team.map(t => t.p.id);
        let posed = 0;
        (sc === "day" ? [day] : dates).forEach(d => {
          ids.forEach(pid => {
            if (!availableOn(pid, d)) return;
            if (teamOn(site(sid), d).indexOf(pid) > -1) return;
            assignDay(pid, sid, d, ui.urgence);
            posed++;
          });
        });
        closeSheet(); render();
        toast("<b>" + esc(s.code) + "</b> : " + posed + " journée" + (posed > 1 ? "s" : "") +
          " posée" + (posed > 1 ? "s" : "") + " — " + ids.map(i => esc(person(i).name)).join(", "));
      });
    });
}

/* ============================================================
   Répartition de toute l'équipe sur la semaine
   ============================================================ */

const WHY_LABEL = {
  gate:   r => "débloque " + skLabel(r.k) + " niv. " + r.lv,
  sk:     r => skLabel(r.k) + " " + r.lv + "/5",
  poly:   () => "main-d'œuvre",
  permis: () => "permis",
  suite:  () => "suite de la veille",
  encadre:() => "encadré",
  seul:   () => "novice sans encadrement"
};
const whyTags = rs => (rs || []).slice(0, 3).map(r => {
  const f = WHY_LABEL[r.type];
  return '<span class="tag' + (r.type === "gate" ? " key" : "") +
    (r.type === "seul" ? " warn" : "") + '">' +
    (r.k ? '<span class="dot" style="background:' + skColor(r.k) + '"></span>' : "") +
    esc(f ? f(r) : r.type) + "</span>";
}).join("");

function optimizeSheet(){
  const wk = ui.week;
  const res = optimizeWeek(store.sites, store.people, wk, availableOn);
  const dates = weekDates(wk);

  if (!res.targets.length) {
    sheet("Répartir la semaine", fmtRange(wk),
      '<div class="callout warn">Aucun chantier actif à pourvoir cette semaine.</div>');
    return;
  }

  const byDay = dates.map((d, i) => {
    const lines = res.targets.map(s => {
      const ids = (res.plan[s.id] || {})[d] || [];
      if (!ids.length) return "";
      return '<div class="opline"><span class="oc">' + esc(s.code) + "</span>" +
        '<span class="ow">' + ids.map(pid => {
          const p = person(pid);
          const rs = res.why[s.id + "#" + d + "#" + pid];
          return '<span class="op"><b>' + esc(p.name) + "</b>" + whyTags(rs) + "</span>";
        }).join("") + "</span></div>";
    }).filter(Boolean).join("");
    const idle = store.people.filter(p => availableOn(p.id, d) &&
      !res.targets.some(s => ((res.plan[s.id] || {})[d] || []).indexOf(p.id) > -1));
    return '<details class="acc opday"' + (i === ui.day ? " open" : "") + ">" +
      '<summary><span class="eyebrow">' + DAYS_L[i] + " " + fmtDay(d) + "</span>" +
      '<span class="spacer"></span><span class="ph-wk">' +
      res.targets.reduce((a, s) => a + (((res.plan[s.id] || {})[d]) || []).length, 0) +
      "</span><span class=\"caret\"></span></summary>" +
      '<div class="acc-body">' + (lines || '<p class="empty-hint">Personne de disponible.</p>') +
      (idle.length ? '<p class="empty-hint">Non affectés : ' +
        idle.map(p => esc(p.name)).join(", ") + "</p>" : "") + "</div></details>";
  }).join("");

  /* Les manques : une mission exige un niveau que l'équipe du jour n'a pas. */
  const seen = new Set();
  const gapRows = res.gaps.filter(g => {
    const k = g.site.id + "#" + g.sk + "#" + g.need;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, 6).map(g =>
    '<div class="cov-row"><span class="lbl"><span class="dot" style="background:' +
    skColor(g.sk) + '"></span>' + esc(g.site.code) + "</span>" +
    '<span style="flex:1;font-size:11.5px;color:var(--ink-2)">' + esc(skLabel(g.sk)) +
    " niv. " + g.need + " requis, " + (g.have || "aucun") + " sur place</span></div>").join("");

  sheet("Répartir la semaine", "Semaine " + weekNum(wk) + " · " + fmtRange(wk),
    '<div class="callout"><b>' + res.posed + "</b> journée" + (res.posed > 1 ? "s" : "") +
      " répartie" + (res.posed > 1 ? "s" : "") + " sur <b>" + res.targets.length +
      "</b> chantier" + (res.targets.length > 1 ? "s" : "") + ". Chaque nom porte la raison de sa " +
      "présence : le seuil qu'il débloque, le métier qu'il couvre, ou la continuité avec la veille.</div>" +
    (gapRows ? '<div class="field"><label>Ce que personne ne couvre</label>' +
      '<div class="cov">' + gapRows + "</div>" +
      '<p class="hint">Ces missions demandent un niveau que l\'équipe du jour n\'atteint pas. ' +
      "Le travail peut avancer, mais pas celles-là.</p></div>" : "") +
    "<div>" + byDay + "</div>" +
    '<button class="btn wide primary" id="op-apply">Appliquer ce plan</button>' +
    '<p class="hint">Le plan actuel de la semaine sera remplacé sur ces chantiers. ' +
    "Les journées déjà posées ailleurs ne sont pas touchées.</p>",
    root => {
      root.querySelector("#op-apply").addEventListener("click", () => {
        res.targets.forEach(s => {
          dates.forEach(d => {
            const ids = (res.plan[s.id] || {})[d] || [];
            /* on retire d'abord ces personnes des autres chantiers du jour */
            if (!ui.urgence) ids.forEach(pid => sitesOnDay(pid, d).forEach(o => {
              if (o.id === s.id) return;
              setTeamOn(o, d, teamOn(o, d).filter(x => x !== pid));
              store.touchSite(o.id);
            }));
            setTeamOn(site(s.id), d, ids);
          });
          store.touchSite(s.id);
        });
        closeSheet(); render();
        toast("<b>" + res.posed + "</b> journées posées sur la semaine " + weekNum(wk));
      });
    });
}

/* ============================================================
   Demande de disponibilité
   Chaque compagnon reçoit un lien nominatif pour une semaine donnée.
   Il coche ses jours sans compte ni installation ; la réponse redescend
   ici et devient sa disponibilité de CETTE semaine.
   ============================================================ */

const MSG_KEY = "geoplan.msg.v1";
const MSG_DEFAULT =
  "Bonjour {nom}, peux-tu m'indiquer tes jours de présence pour la semaine du {semaine} ? " +
  "Ça prend 30 secondes, rien à installer : {lien}";

function msgFor(tpl, p, wk, url){
  return tpl
    .replace(/\{nom\}/g, p.name)
    .replace(/\{semaine\}/g, fmtRange(wk))
    .replace(/\{lien\}/g, url);
}
const smsHref = (tel, body) => "sms:" + tel + "?&body=" + encodeURIComponent(body);
const waHref = (tel, body) => "https://wa.me/" + tel.slice(1) + "?text=" + encodeURIComponent(body);

function availSheet(wk, onlyIds){
  let tpl = MSG_DEFAULT;
  try { tpl = localStorage.getItem(MSG_KEY) || MSG_DEFAULT; } catch(e){}

  const targets = store.people.filter(p =>
    (!onlyIds || onlyIds.indexOf(p.id) > -1) && p.phone);
  const noPhone = store.people.filter(p => !p.phone && (!onlyIds || onlyIds.indexOf(p.id) > -1));
  const head = "Semaine " + weekNum(wk) + " · " + fmtRange(wk);

  if (!store.live) {
    sheet("Demander les dispos", head,
      '<div class="callout warn">Cette fonction a besoin de la base : le compagnon ' +
      "ouvre un lien qui doit exister quelque part. Renseignez <b>config.js</b> " +
      "et connectez-vous, puis revenez ici.</div>" +
      '<p class="hint">En attendant, vous pouvez toujours l\'appeler ou lui envoyer ' +
      "un SMS depuis sa fiche.</p>");
    return;
  }
  if (!targets.length) {
    sheet("Demander les dispos", head,
      '<div class="callout warn">Aucun numéro de téléphone enregistré.</div>' +
      '<p class="hint">Ouvrez une fiche compagnon depuis l\'onglet Équipe et ' +
      "ajoutez son numéro : le bouton d'envoi apparaîtra ici.</p>");
    return;
  }

  sheet("Demander les dispos", head,
    '<div class="field"><label>Message</label>' +
      '<textarea id="a-tpl" style="font-family:var(--fb);font-size:14px;min-height:96px">' +
      esc(tpl) + "</textarea>" +
      '<p class="hint">' + esc("{nom}") + ", " + esc("{semaine}") + " et " + esc("{lien}") +
      " sont remplacés pour chaque destinataire.</p></div>" +
    '<div id="a-list"><p class="hint">Préparation des liens…</p></div>' +
    (noPhone.length ? '<p class="hint">Sans numéro, donc non listés : ' +
      noPhone.map(p => esc(p.name)).join(", ") + ".</p>" : "") +
    '<button class="btn wide" id="a-all">Copier tous les liens</button>',
    async root => {
      const list = root.querySelector("#a-list");
      const tplEl = root.querySelector("#a-tpl");
      let prepared = [];

      tplEl.addEventListener("input", () => {
        try { localStorage.setItem(MSG_KEY, tplEl.value); } catch(e){}
        paint();
      });

      function paint(){
        const t = tplEl.value;
        list.innerHTML = prepared.map(({person:p, avail:a, url}) => {
          const body = msgFor(t, p, wk, url);
          const state = a.days
            ? '<span class="tag" style="color:var(--ok)">' +
              (countDays(a.days) ? DAYS.filter((d, i) => a.days[i]).join(" ") : "aucun jour") +
              "</span>"
            : '<span class="tag">en attente</span>';
          return '<div class="sug" style="align-items:center">' +
            '<span style="flex:1;min-width:0">' +
              '<span class="nm">' + esc(p.name) + "</span>" +
              '<span class="why">' + state +
              '<span class="tag">' + esc(fmtPhone(p.phone)) + "</span></span></span>" +
            '<span style="display:flex;gap:5px;flex:none">' +
              '<a class="btn sm" href="' + esc(smsHref(p.phone, body)) + '">SMS</a>' +
              '<a class="btn sm" href="' + esc(waHref(p.phone, body)) + '" target="_blank" rel="noopener">WA</a>' +
            "</span></div>";
        }).join("");
      }

      try {
        prepared = await store.requestAvailability(targets.map(p => p.id), wk);
        paint();
      } catch(e) {
        list.innerHTML = '<div class="callout warn">Impossible de créer les liens : ' +
          esc(e && e.message ? e.message : "erreur réseau") + "</div>";
        return;
      }

      root.querySelector("#a-all").addEventListener("click", () => {
        shareText("Liens de disponibilité · semaine " + weekNum(wk),
          prepared.map(({person:p, url}) => p.name + " : " + url).join("\n"));
      });
    });
}

/* ============================================================
   Partage et sauvegarde
   ============================================================ */

function briefText(){
  const day = curDay(), di = ui.day;
  const out = ["GEOPLAN — " + DAYS_L[di] + " " + fmtDay(day), ""];
  const active = store.sites.filter(s => teamOn(s, day).length);
  if (!active.length) out.push("Personne n'est affecté ce jour-là.");
  active.forEach(s => {
    const cur = currentPhase(s), P = PHASES[cur];
    const crew = teamOn(s, day).map(person).filter(Boolean);
    out.push(s.code + " · " + s.addr);
    out.push("Étape " + (cur+1) + "/12 — " + P.n + " (S" + P.wk + ")");
    out.push("Équipe : " + crew.map(p => p.name).join(", "));
    P.tasks.forEach((T, j) => { if (!taskDone(s, cur)[j]) out.push("· " + T.t); });
    if (s.note) out.push("Note : " + s.note.replace(/\n/g, " / "));
    out.push("");
  });
  const idle = store.people.filter(p => availableOn(p.id, day) && isFreeOn(p.id, day));
  if (idle.length) out.push("Disponibles non affectés : " + idle.map(p => p.name).join(", "));
  return out.join("\n").trim();
}

/* iOS : la feuille de partage native quand elle est disponible, sinon le
   presse-papiers, sinon le texte en clair à copier à la main. */
async function shareText(title, text){
  try { if (navigator.share) { await navigator.share({title, text}); return; } }
  catch(e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); toast("Copié — collez-le dans votre message"); return; }
  catch(e){}
  sheet(title, "Sélectionnez et copiez",
    '<div class="field"><textarea id="s-txt" readonly>' + esc(text) + "</textarea></div>",
    root => { const t = root.querySelector("#s-txt"); t.focus(); t.select(); });
}

const backupJSON = () => JSON.stringify({
  app:"geoplan", v:2, exportedAt:new Date().toISOString(),
  people:store.people, sites:store.sites
}, null, 2);

function exportBackup(){
  const blob = new Blob([backupJSON()], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "geoplan-" + todayISO() + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast("Sauvegarde téléchargée");
}

function applyBackup(txt){
  const data = JSON.parse(txt);
  if (!Array.isArray(data.people) || !Array.isArray(data.sites)) throw new Error("format");
  store.replaceAll(
    data.people.map(p => normPerson(p.id || uid("p_"), p)),
    data.sites.map(s => normSite(s.id || uid("s_"), s))
  );
  render();
  toast(data.people.length + " compagnons et " + data.sites.length + " chantiers restaurés");
}

function dataSheet(){
  const where = store.mode === "local"
    ? "Aucun serveur configuré : les données restent dans ce navigateur. " +
      "Renseignez config.js pour synchroniser vos appareils."
    : store.user
      ? "Connecté en tant que " + store.user.email + ". Les données sont sur votre base Supabase " +
        "et se mettent à jour en direct sur tous vos appareils."
      : "Non connecté — les modifications restent locales.";
  const pend = store.pending
    ? '<div class="callout warn"><b>' + store.pending + "</b> modification" +
      (store.pending > 1 ? "s" : "") + " en attente d'envoi. Elles sont conservées ici " +
      "et repartiront dès que la liaison sera rétablie.</div>"
    : "";

  sheet("Données", store.mode === "local" ? "Stockage local" : (store.user ? "Synchronisé" : "Déconnecté"),
    pend +
    '<p class="hint">' + esc(where) + "</p>" +
    '<div class="field"><label>Contenu</label><p class="hint"><b>' + store.people.length +
      "</b> compagnons · <b>" + store.sites.length + "</b> chantiers</p></div>" +
    (store.pending ? '<button class="btn wide blue" id="d-flush">Réessayer l\'envoi</button>' : "") +
    '<button class="btn wide" id="d-exp">Exporter un fichier de sauvegarde</button>' +
    '<div class="field"><label>Restaurer</label>' +
      '<input type="file" id="d-file" accept="application/json,.json">' +
      '<p class="hint">Ou collez le contenu d\'une sauvegarde :</p>' +
      '<textarea id="d-txt" placeholder="{ &quot;app&quot;: &quot;geoplan&quot;, … }"></textarea>' +
      '<button class="btn danger" id="d-imp">Remplacer les données</button></div>' +
    (store.user ? '<button class="btn wide" id="d-out">Se déconnecter</button>' : ""),
    root => {
      const fl = root.querySelector("#d-flush");
      if (fl) fl.addEventListener("click", () => { closeSheet(); store.flush(); toast("Envoi relancé"); });
      root.querySelector("#d-exp").addEventListener("click", exportBackup);
      root.querySelector("#d-file").addEventListener("change", e => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          try { applyBackup(String(rd.result)); closeSheet(); }
          catch(err) { toast("Fichier illisible — ce n'est pas une sauvegarde Geoplan"); }
        };
        rd.readAsText(f);
      });
      root.querySelector("#d-imp").addEventListener("click", () => {
        try { applyBackup(root.querySelector("#d-txt").value); closeSheet(); }
        catch(err) { toast("Sauvegarde illisible — vérifiez le texte collé"); }
      });
      const out = root.querySelector("#d-out");
      if (out) out.addEventListener("click", async () => { closeSheet(); await store.signOut(); });
    });
}

/* ============================================================
   Événements
   ============================================================ */

view.addEventListener("click", e => {
  if (e.target.closest("#firstSite")) { editSite(null); return; }
  if (e.target.closest("#firstPerson")) { editPerson(null); return; }
  if (e.target.closest("#askAll")) { availSheet(askWeek(), null); return; }
  if (e.target.closest("#optiBtn")) { optimizeSheet(); return; }

  /* Cocher une tâche fait avancer la barre de son étape. */
  const task = e.target.closest("[data-task]");
  if (task) {
    const [sid, i, j] = task.dataset.task.split("#");
    const s = site(sid);
    if (!s) return;
    const on = task.getAttribute("aria-pressed") !== "true";
    s.ph[+i] = setTask(s, +i, +j, on);
    store.touchSite(sid);
    render();
    return;
  }
  const ph = e.target.closest("[data-phase]");
  if (ph) {
    openPhase = openPhase === ph.dataset.phase ? null : ph.dataset.phase;
    render();
    return;
  }
  const jump = e.target.closest("[data-jump]");
  if (jump) {
    ui.day = +jump.dataset.jump;
    ui.tab = "chantiers";
    saveUi(); render(); view.scrollTop = 0;
    return;
  }

  const again = e.target.closest("[data-again]");
  if (again) {
    const s = site(again.dataset.again), day = curDay(), prev = addDays(day, -1);
    let n = 0;
    teamOn(s, prev).forEach(pid => {
      if (!availableOn(pid, day)) return;
      if (!isFreeOn(pid, day) && !ui.urgence) return;
      assignDay(pid, s.id, day, ui.urgence); n++;
    });
    render();
    toast(n ? n + " compagnon" + (n > 1 ? "s reconduits" : " reconduit") + " sur <b>" +
              esc(s.code) + "</b>"
            : "Aucun n'est disponible et libre ce jour-là");
    return;
  }
  const sug = e.target.closest("[data-suggest]");
  if (sug) { suggestSheet(sug.dataset.suggest); return; }
  const es = e.target.closest("[data-edit-site]");
  if (es) { editSite(es.dataset.editSite); return; }
  const ep = e.target.closest("[data-edit-person]");
  if (ep) { editPerson(ep.dataset.editPerson); return; }
  if (e.target.closest("#shareBtn")) { shareText("Brief " + DAYS_L[ui.day], briefText()); return; }
});

/* La note est enregistrée à la volée, mais on laisse retomber la frappe. */
let noteT = null;
view.addEventListener("input", e => {
  const n = e.target.closest("[data-note]");
  if (!n) return;
  const s = site(n.dataset.note);
  if (!s) return;
  s.note = n.value;
  clearTimeout(noteT);
  noteT = setTimeout(() => store.touchSite(s.id), 700);
});
view.addEventListener("focusout", e => {
  if (e.target.closest("[data-note]")) setTimeout(flushRender, 60);
});

/* Un <details open> fraîchement inséré émet « toggle » de lui-même.
   Sans la garde ci-dessous, le rendu déclenchait l'événement, qui
   redéclenchait le rendu : environ 150 rendus par seconde, aucune
   animation ne pouvait aboutir. On ne réagit qu'à un vrai changement. */
view.addEventListener("toggle", e => {
  const a = e.target.closest("[data-acc]");
  if (!a) return;
  const next = a.open ? a.dataset.acc : null;
  if (next === ui.openSite) return;            // conséquence d'un rendu, pas un geste
  ui.openSite = next;
  saveUi();
  if (!next) return;
  const s = site(next);
  if (!s) return;
  openPhase = s.id + "#" + currentPhase(s);    // ouvrir la fiche ouvre l'étape en cours
  render();
}, true);

$$(".tabbar button").forEach(b => b.addEventListener("click", () => {
  ui.tab = b.dataset.tab; saveUi(); render(); view.scrollTop = 0;
}));

$("#addBtn").addEventListener("click", () => {
  if (ui.tab === "equipe") editPerson(null); else editSite(null);
});
$("#statusBtn").addEventListener("click", dataSheet);

$("#daybar").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  ui.day = +b.dataset.day; saveUi(); render(); view.scrollTop = 0;
});

function goWeek(n){
  if (n === 0) { ui.week = mondayOf(todayISO()); ui.day = dayIndex(todayISO()); }
  else ui.week = addDays(ui.week, n * 7);
  render();
}
$("#wkPrev").addEventListener("click", () => goWeek(-1));
$("#wkNext").addEventListener("click", () => goWeek(1));
$("#wkToday").addEventListener("click", () => goWeek(0));

/* L'îlot n'a que deux états : la pastille, et le panneau à la hauteur
   de son contenu. La poignée et le chevron replient, la pastille déplie. */
const collapseIsland = () => { ui.poolState = "bubble"; saveUi(); renderPool(); };
$("#vivierHead").addEventListener("click", collapseIsland);
$("#vivierMin").addEventListener("click", collapseIsland);
$("#vivierFace").addEventListener("click", () => {
  if (bubbleWasDropTarget) { bubbleWasDropTarget = false; return; }
  ui.poolState = "open"; saveUi(); renderPool();
});

$("#urgSw").checked = !!ui.urgence;
$("#urgSw").addEventListener("change", e => {
  ui.urgence = e.target.checked; saveUi();
  toast(ui.urgence
    ? "<b>Mode urgence</b> — un compagnon peut être posé sur deux chantiers le même jour"
    : "Mode urgence désactivé");
});

/* ============================================================
   Relance automatique du samedi

   Une page web ne peut pas envoyer un SMS toute seule : il n'existe
   aucune API pour ça, et une passerelle SMS serait un service payant.
   Ce que l'application fait, dès le samedi : créer d'elle-même les
   demandes de la semaine suivante, et poser le bandeau d'envoi. Il
   reste un geste par compagnon — ouvrir Messages, appuyer sur envoyer.
   ============================================================ */

const AUTO_KEY = "geoplan.autoask.v1";

async function saturdayCheck(){
  if (!store.live) return;
  const today = todayISO();
  if (dayIndex(today) < 5) return;                     // avant samedi, on ne relance pas
  const next = addDays(mondayOf(today), 7);
  let done = "";
  try { done = localStorage.getItem(AUTO_KEY) || ""; } catch(e){}
  if (done === next) { autoBanner(next); return; }     // déjà préparé cette semaine

  const targets = store.people.filter(p => p.phone);
  if (!targets.length) return;
  try {
    await store.requestAvailability(targets.map(p => p.id), next);
    try { localStorage.setItem(AUTO_KEY, next); } catch(e){}
    autoBanner(next);
    toast("Demandes de la semaine " + weekNum(next) + " préparées — " +
      targets.length + " liens prêts à envoyer");
  } catch(e) { /* réseau : on retentera au prochain lancement */ }
}

/* Bandeau tant que tout le monde n'a pas répondu pour la semaine visée. */
function autoBanner(week){
  const el = $("#autoAsk");
  const waiting = store.people.filter(p => p.phone && !(store.availOf(p.id, week) || {}).days);
  if (!waiting.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = '<span><b>Semaine ' + weekNum(week) + "</b> — " + waiting.length +
    " demande" + (waiting.length > 1 ? "s" : "") + " de dispo à envoyer</span>" +
    '<button class="btn sm primary" id="autoGo">Envoyer</button>';
  $("#autoGo").addEventListener("click", () => availSheet(week, waiting.map(p => p.id)));
}

/* ============================================================
   Démarrage
   ============================================================ */

paintGate();
render();
store.init().then(saturdayCheck);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
