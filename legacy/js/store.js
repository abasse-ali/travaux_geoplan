/* ============================================================
   Geoplan — persistance
   Deux modes, une seule interface :

   • local  — aucune configuration. Les données restent dans ce
              navigateur. L'application est utilisable immédiatement.
   • cloud  — Supabase. Le navigateur garde malgré tout une copie :
              l'écran s'affiche instantanément au lancement et reste
              utilisable sans réseau. Les écritures en attente
              repartent seules dès que la liaison revient.

   Dans les deux cas la vérité affichée est en mémoire ; la copie
   locale et le serveur sont deux destinations d'écriture.
   ============================================================ */

import { normPerson, normSite, normAvail, uid, mondayOf, dayIndex } from "./domain.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

const CACHE = "geoplan.cache.v1";
const SB_VERSION = "2.112.4";

/* Une clé secrète dans une page web serait lisible par tout visiteur
   et contournerait toutes les règles d'accès : on refuse de s'en
   servir plutôt que de la diffuser. */
export const SECRET_KEY_PASTED = () =>
  typeof SUPABASE_ANON_KEY === "string" && /^sb_secret_/.test(SUPABASE_ANON_KEY.trim());

const configured = () => {
  if (SECRET_KEY_PASTED()) {
    console.error("config.js contient une clé sb_secret_. Elle serait publiquement " +
      "lisible : révoquez-la dans Supabase et utilisez la clé sb_publishable_.");
    return false;
  }
  return typeof SUPABASE_URL === "string" &&
    /^https:\/\/.+\.supabase\.co\/?$/.test(SUPABASE_URL.trim()) &&
    typeof SUPABASE_ANON_KEY === "string" && SUPABASE_ANON_KEY.trim().length > 20;
};

/* ---------- correspondance table ↔ objet ---------- */

const rowToPerson = r => normPerson(r.id, {
  name:r.name, phone:r.phone, days:r.days, permis:r.permis, sk:r.sk, note:r.note});
const personToRow = p => ({
  id:p.id, name:p.name, phone:p.phone, days:p.days, permis:p.permis, sk:p.sk, note:p.note,
  updated_at:new Date().toISOString()});

const rowToSite = r => normSite(r.id, {
  code:r.code, addr:r.addr, start:r.start_date, months:r.months,
  coef:r.coef, ph:r.ph, note:r.note, plan:r.plan, tasks:r.tasks, weeks:r.weeks});
const siteToRow = s => ({
  id:s.id, code:s.code, addr:s.addr, start_date:s.start, months:s.months,
  coef:s.coef, ph:s.ph, note:s.note, plan:s.plan, tasks:s.tasks,
  updated_at:new Date().toISOString()});

const rowToAvail = r => normAvail(r.id, {
  token:r.token, personId:r.person_id, week:r.week, days:r.days,
  note:r.note, answeredAt:r.answered_at});

const TABLES = {
  people: {norm:normPerson, toRow:personToRow, fromRow:rowToPerson},
  sites:  {norm:normSite,   toRow:siteToRow,   fromRow:rowToSite}
};

/* Les demandes de disponibilité ne passent pas par la file d'attente :
   créer un lien hors ligne n'aurait pas de sens, on ne pourrait pas
   l'envoyer. On les lit, et on écoute les réponses arriver. */
const AVAIL_TABLE = "avail_requests";
const rnd = n => {
  const a = new Uint8Array(n);
  (crypto || window.crypto).getRandomValues(a);
  return Array.from(a, b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
};

export class Store {
  /* onData()   — les listes ont changé, redessiner
     onStatus() — l'état de synchronisation a changé
     onAuth()   — la session a changé (connecté / déconnecté) */
  constructor({onData, onStatus, onAuth, onAnswer}){
    this.people = [];
    this.sites = [];
    this.avail = [];              // demandes de disponibilité et réponses
    this.dirty = new Set();       // chemins modifiés localement
    this.gone = new Set();        // chemins supprimés localement
    this.status = "busy";         // busy | ok | off | local
    this.mode = configured() ? "cloud" : "local";
    this.user = null;
    this.sb = null;
    this.onData = onData || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onAuth = onAuth || (() => {});
    this.onAnswer = onAnswer || null;
    this._flushT = null;
    this._retryT = null;
  }

  person(id){ return this.people.find(p => p.id === id); }
  site(id){ return this.sites.find(s => s.id === id); }
  get pending(){ return this.dirty.size; }

  /* Demande — répondue ou non — pour un compagnon et une semaine. */
  availOf(pid, wk){ return this.avail.find(a => a.personId === pid && a.week === wk); }

  /* Jours de présence effectifs sur une semaine : la réponse du
     compagnon s'il en a donné une, sinon sa disponibilité habituelle. */
  daysOf(p, wk){
    const a = this.availOf(p.id, wk);
    return (a && a.days) ? a.days : p.days;
  }

  /* Le compagnon est-il disponible CE jour-là ? */
  availableOn(pid, day){
    const p = this.person(pid);
    if (!p) return false;
    return !!this.daysOf(p, mondayOf(day))[dayIndex(day)];
  }

  /* ---------- démarrage ---------- */

  async init(){
    this.loadCache();
    this.onData();
    if (this.mode === "local") { this.setStatus("local"); return; }
    try {
      const {createClient} = await import(
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@" + SB_VERSION + "/+esm");
      this.sb = createClient(SUPABASE_URL.trim().replace(/\/$/, ""), SUPABASE_ANON_KEY.trim(), {
        auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}
      });
    } catch(e) {
      console.warn("Supabase indisponible", e);
      this.mode = "local"; this.setStatus("local"); return;
    }

    const {data} = await this.sb.auth.getSession();
    this.user = data && data.session ? data.session.user : null;
    this.sb.auth.onAuthStateChange((_evt, session) => {
      const was = this.user && this.user.id;
      this.user = session ? session.user : null;
      if (location.hash.indexOf("access_token") > -1)
        history.replaceState(null, "", location.pathname + location.search);
      if ((this.user && this.user.id) !== was) {
        this.onAuth();
        if (this.user) this.start(); else this.setStatus("local");
      }
    });
    this.onAuth();
    if (this.user) await this.start(); else this.setStatus("local");
  }

  /* Chargement initial puis abonnement temps réel. */
  async start(){
    this.setStatus("busy");
    try {
      for (const t of Object.keys(TABLES)) {
        const {data, error} = await this.sb.from(t).select("*");
        if (error) throw error;
        this.merge(t, data.map(TABLES[t].fromRow));
      }
      const {data:av, error:ae} = await this.sb.from(AVAIL_TABLE).select("*");
      if (ae) throw ae;
      this.avail = av.map(rowToAvail);
    } catch(e) {
      console.warn("Chargement impossible", e);
      this.setStatus("off");
      clearTimeout(this._retryT);
      this._retryT = setTimeout(() => this.start(), 8000);
      return;
    }
    this.saveCache();
    this.onData();
    this.listen();
    this.flush();
  }

  listen(){
    if (this._channel) { try { this.sb.removeChannel(this._channel); } catch(e){} }
    this._channel = this.sb.channel("geoplan");
    Object.keys(TABLES).forEach(t => {
      this._channel.on("postgres_changes", {event:"*", schema:"public", table:t},
        payload => this.onRealtime(t, payload));
    });
    this._channel.on("postgres_changes", {event:"*", schema:"public", table:AVAIL_TABLE},
      payload => this.onAvailRealtime(payload));
    this._channel.subscribe(st => {
      if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") this.setStatus("off");
      else if (st === "SUBSCRIBED" && !this.dirty.size) this.setStatus("ok");
    });
  }

  onRealtime(table, payload){
    const list = this[table === "people" ? "people" : "sites"];
    const id = (payload.new && payload.new.id) || (payload.old && payload.old.id);
    if (!id) return;
    const path = table + "/" + id;
    if (this.dirty.has(path)) return;                 // notre version locale est plus fraîche
    const i = list.findIndex(o => o.id === id);
    if (payload.eventType === "DELETE") { if (i > -1) list.splice(i, 1); }
    else {
      const rec = TABLES[table].fromRow(payload.new);
      if (i > -1) list[i] = rec; else list.push(rec);
    }
    this.saveCache();
    this.onData();
  }

  /* Une réponse qui arrive pendant qu'on regarde l'écran. */
  onAvailRealtime(payload){
    const id = (payload.new && payload.new.id) || (payload.old && payload.old.id);
    if (!id) return;
    const i = this.avail.findIndex(a => a.id === id);
    if (payload.eventType === "DELETE") { if (i > -1) this.avail.splice(i, 1); }
    else {
      const rec = rowToAvail(payload.new);
      const known = i > -1 ? this.avail[i] : null;
      if (i > -1) this.avail[i] = rec; else this.avail.push(rec);
      /* Signaler la réponse : c'est l'information qu'on attendait. */
      if (rec.answeredAt && (!known || !known.answeredAt) && this.onAnswer) {
        const p = this.person(rec.personId);
        if (p) this.onAnswer(p, rec);
      }
    }
    this.saveCache();
    this.onData();
  }

  /* Fusion serveur → mémoire, en préservant ce qui n'est pas encore monté. */
  merge(table, incoming){
    const key = table === "people" ? "people" : "sites";
    const keep = this[key].filter(o => {
      const path = table + "/" + o.id;
      return this.dirty.has(path) && !this.gone.has(path);
    });
    const byId = new Map(incoming.map(o => [o.id, o]));
    keep.forEach(o => byId.set(o.id, o));             // le local non monté gagne
    this.gone.forEach(path => {
      const [t, id] = path.split("/");
      if (t === table) byId.delete(id);
    });
    this[key] = [...byId.values()];
  }

  /* ---------- copie locale ---------- */

  saveCache(){
    try {
      localStorage.setItem(CACHE, JSON.stringify({
        people:this.people, sites:this.sites, avail:this.avail,
        dirty:[...this.dirty], gone:[...this.gone]
      }));
    } catch(e){}
  }

  loadCache(){
    let raw = null;
    try { raw = localStorage.getItem(CACHE); } catch(e){}
    if (!raw) return;
    try {
      const c = JSON.parse(raw);
      this.people = (c.people || []).map(p => normPerson(p.id || uid("p_"), p));
      this.sites  = (c.sites  || []).map(s => normSite(s.id || uid("s_"), s));
      this.avail  = (c.avail  || []).map(a => normAvail(a.id, a));
      (c.dirty || []).forEach(p => this.dirty.add(p));
      (c.gone  || []).forEach(p => { this.gone.add(p); this.dirty.add(p); });
    } catch(e){}
  }

  /* ---------- écritures ---------- */

  put(table, obj){
    const key = table === "people" ? "people" : "sites";
    const i = this[key].findIndex(o => o.id === obj.id);
    if (i > -1) this[key][i] = obj; else this[key].push(obj);
    this.touch(table + "/" + obj.id);
  }
  remove(table, id){
    const key = table === "people" ? "people" : "sites";
    this[key] = this[key].filter(o => o.id !== id);
    const path = table + "/" + id;
    this.dirty.add(path); this.gone.add(path);
    this.schedule();
  }
  touch(path){ this.dirty.add(path); this.gone.delete(path); this.schedule(); }
  touchPerson(id){ this.touch("people/" + id); }
  touchSite(id){ this.touch("sites/" + id); }

  schedule(delay){
    this.saveCache();
    this.setStatus(this.dirty.size ? (this.live ? "busy" : "local") : (this.live ? "ok" : "local"));
    clearTimeout(this._flushT);
    this._flushT = setTimeout(() => this.flush(), delay == null ? 350 : delay);
  }

  get live(){ return !!(this.sb && this.user); }

  async flush(){
    if (!this.live) { this.setStatus("local"); return; }
    if (!this.dirty.size) { this.setStatus("ok"); return; }
    const paths = [...this.dirty];
    let failed = false;

    for (const path of paths) {
      const [table, id] = path.split("/");
      const spec = TABLES[table];
      if (!spec) { this.dirty.delete(path); continue; }
      const obj = table === "people" ? this.person(id) : this.site(id);
      try {
        if (this.gone.has(path) || !obj) {
          const {error} = await this.sb.from(table).delete().eq("id", id);
          if (error) throw error;
          this.gone.delete(path);
        } else {
          const {error} = await this.sb.from(table).upsert(spec.toRow(obj));
          if (error) throw error;
        }
        this.dirty.delete(path);
      } catch(e) {
        console.warn("Écriture refusée", path, e);
        failed = true;
        break;
      }
    }

    this.saveCache();
    if (failed && this.dirty.size) {
      this.setStatus("off");
      clearTimeout(this._retryT);
      this._retryT = setTimeout(() => this.flush(), 6000);
    } else this.setStatus(this.dirty.size ? "busy" : "ok");
  }

  setStatus(s){
    if (s === this.status && !this.dirty.size) return;
    this.status = s;
    this.onStatus(s, this.dirty.size);
  }

  /* ---------- import complet ---------- */

  replaceAll(people, sites){
    this.people.forEach(p => { if (!people.some(x => x.id === p.id)) {
      this.dirty.add("people/" + p.id); this.gone.add("people/" + p.id); } });
    this.sites.forEach(s => { if (!sites.some(x => x.id === s.id)) {
      this.dirty.add("sites/" + s.id); this.gone.add("sites/" + s.id); } });
    this.people = people; this.sites = sites;
    people.forEach(p => { this.dirty.add("people/" + p.id); this.gone.delete("people/" + p.id); });
    sites.forEach(s => { this.dirty.add("sites/" + s.id); this.gone.delete("sites/" + s.id); });
    this.schedule(0);
  }

  /* ---------- demandes de disponibilité ----------
     Une ligne par compagnon et par semaine, réutilisée si elle existe :
     relancer quelqu'un ne casse pas le lien déjà envoyé, et il peut
     corriger sa réponse tant que la demande n'a pas expiré. */

  availLink(token){
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    return base + "dispo.html?t=" + token;
  }

  async requestAvailability(personIds, week){
    if (!this.live) throw new Error("offline");
    const rows = personIds.map(pid => ({
      id: pid + "@" + week,
      token: rnd(18),
      person_id: pid,
      week
    }));
    /* On ne réécrit pas les demandes déjà lancées : ignoreDuplicates
       préserve le jeton d'origine et la réponse éventuelle. */
    const {error} = await this.sb.from(AVAIL_TABLE)
      .upsert(rows, {onConflict:"id", ignoreDuplicates:true});
    if (error) throw error;

    const ids = rows.map(r => r.id);
    const {data, error:e2} = await this.sb.from(AVAIL_TABLE).select("*").in("id", ids);
    if (e2) throw e2;

    data.map(rowToAvail).forEach(rec => {
      const i = this.avail.findIndex(a => a.id === rec.id);
      if (i > -1) this.avail[i] = rec; else this.avail.push(rec);
    });
    this.saveCache();
    return personIds
      .map(pid => this.availOf(pid, week))
      .filter(Boolean)
      .map(a => ({avail:a, person:this.person(a.personId), url:this.availLink(a.token)}));
  }

  async cancelRequest(id){
    this.avail = this.avail.filter(a => a.id !== id);
    this.saveCache(); this.onData();
    if (this.live) { try { await this.sb.from(AVAIL_TABLE).delete().eq("id", id); } catch(e){} }
  }

  /* ---------- authentification ---------- */

  async signIn(email){
    if (!this.sb) throw new Error("Supabase n'est pas configuré");
    const {error} = await this.sb.auth.signInWithOtp({
      email: email.trim(),
      options: {emailRedirectTo: location.origin + location.pathname}
    });
    if (error) throw error;
  }
  async signOut(){
    if (!this.sb) return;
    try { await this.sb.auth.signOut(); } catch(e){}
    this.user = null;
    this.onAuth();
  }
}
