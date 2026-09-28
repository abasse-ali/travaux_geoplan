/* ============================================================
   Les actions de l'écran (ADR-004)

   Mêmes noms et mêmes signatures qu'avant W4 (`Actions`, types.ts) : les
   écrans n'ont pas changé leur façon de les appeler. Ce qui change,
   c'est ce qu'elles font. Elles ne modifient plus d'objets : elles
   ajoutent à la file un geste du domaine (`Operation`), que l'écran
   montre aussitôt et que la synchronisation envoie.

   Chaque action relit, au moment où elle s'exécute, les données
   affichées et l'état de l'interface. Elle ne garde jamais ceux du
   rendu où elle est née (c'était le constat U1).
   ============================================================ */

import {
  DAYS_L, PHASES, addDays, currentPhase, fmtDay, mondayOf, normPerson, normSite,
  phaseSteps, taskDone, teamOn, todayISO, weekDates, weekNum,
  type Person, type Site
} from "@geoplan/domain";
import type { Operation } from "@geoplan/domain/operations";
import type { Synchro } from "../donnees/synchro";
import { Vue } from "../donnees/vue";
import { patchUi, toast, useUi } from "./etat";
import { html } from "./html";
import { plur } from "./bits";
import { jouerSon } from "./son";
import type { Actions, SheetState } from "./types";

/** Un identifiant neuf, tiré au hasard par le navigateur (constat D17 :
    celui du domaine pouvait rendre moins de six caractères). */
export function nouvelId(prefixe: "p_" | "s_"): string {
  const a = crypto.getRandomValues(new Uint8Array(10));
  return prefixe + Array.from(a, b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
}

/** Ce que vaudra une étape réglée à `v` % : un cran par mission, comme
    setPhasePct du domaine, mais sans rien modifier (le chantier affiché
    est en lecture seule). */
export function apercuEtape(i: number, v: number): number {
  const tot = phaseSteps(i);
  const n = Math.max(0, Math.min(tot, Math.round(v / 100 * tot)));
  return Math.round(n / tot * 100);
}

export interface Branchements {
  synchro: Synchro;
  /** Faire défiler la liste en haut (changement d'onglet ou de jour). */
  enHaut: () => void;
}

export function creerActions({ synchro, enHaut }: Branchements): Actions {
  const vue = () => new Vue(synchro.affichees());
  const geste = (op: Operation) => synchro.geste(op);
  const courant = () => {
    const ui = useUi.getState();
    const day = addDays(ui.week, ui.day);
    return { ui, day, week: ui.week, dates: weekDates(ui.week) };
  };
  const isFreeOn = (v: Vue, pid: string, d: string) => !v.sites.some(x => teamOn(x, d).includes(pid));
  const quand = () => { const c = courant(); return ` · ${DAYS_L[c.ui.day]!.toLowerCase()} ${fmtDay(c.day)}`; };

  /* ---------- partage et sauvegarde ---------- */

  function briefText(): string {
    const { ui, day } = courant();
    const v = vue();
    const out = ["GEOPLAN — " + DAYS_L[ui.day] + " " + fmtDay(day), ""];
    const active = v.sites.filter(x => teamOn(x, day).length);
    if (!active.length) out.push("Personne n'est affecté ce jour-là.");
    active.forEach(site => {
      const cur = currentPhase(site), P = PHASES[cur]!;
      out.push(site.code + " · " + site.addr);
      out.push("Étape " + (cur + 1) + "/12 — " + P.n + " (S" + P.wk + ")");
      out.push("Équipe : " + teamOn(site, day).map(id => v.person(id)?.name).filter(Boolean).join(", "));
      P.tasks.forEach((T, j) => { if (!taskDone(site, cur)[j]) out.push("· " + T.t); });
      if (site.note) out.push("Note : " + site.note.replace(/\n/g, " / "));
      out.push("");
    });
    const idle = v.people.filter(p => v.availableOn(p.id, day) && isFreeOn(v, p.id, day));
    if (idle.length) out.push("Disponibles non affectés : " + idle.map(p => p.name).join(", "));
    return out.join("\n").trim();
  }

  async function shareText(title: string, text: string): Promise<void> {
    try { if (navigator.share) { await navigator.share({ title, text }); return; } }
    catch (e) { if ((e as Error)?.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(text); toast(html`Copié — collez-le dans votre message`); }
    catch { toast(html`Copie impossible`); }
  }

  function exportBackup(): void {
    const v = vue();
    const data = JSON.stringify({
      app: "geoplan", v: 3, exportedAt: new Date().toISOString(),
      people: v.people, sites: v.sites
    }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = "geoplan-" + todayISO() + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(html`Sauvegarde téléchargée`);
  }

  function importBackup(txt: string): void {
    try {
      /* Un fichier venu d'ailleurs : on ne fait confiance qu'à la forme
         générale, et la normalisation du domaine borne le reste. Une
         fiche sans identifiant en reçoit un neuf. */
      const data = JSON.parse(txt) as { people?: unknown; sites?: unknown };
      if (!Array.isArray(data.people) || !Array.isArray(data.sites)) throw new Error("format");
      const people = (data.people as Partial<Person>[]).map(p => normPerson(p?.id || nouvelId("p_"), p ?? {}));
      const sites = (data.sites as Partial<Site>[]).map(x => normSite(x?.id || nouvelId("s_"), x ?? {}));
      geste({ type: "remplacerTout", people, sites });
      toast(html`${data.people.length} compagnons et ${data.sites.length} chantiers restaurés`);
    } catch { toast(html`Sauvegarde illisible — vérifiez le fichier`); }
  }

  /* ---------- les actions ---------- */

  const act: Actions = {
    toast,
    sheet: (s: SheetState | null) => patchUi({ sheet: s }),
    openSite: id => {
      const s = id ? vue().site(id) : undefined;
      patchUi({ openSite: id, openPhase: id && s ? id + "#" + currentPhase(s) : null });
    },
    openPhase: k => patchUi({ openPhase: k }),
    openNote: id => patchUi({ openNote: id }),
    goDay: i => { patchUi({ tab: "chantiers", day: i }); enHaut(); },

    assign: (pid, sid) => {
      const v = vue();
      const p = v.person(pid);
      if (!p) return;
      const { day, ui } = courant();
      const before = v.sites.filter(x => teamOn(x, day).includes(pid));
      if (!sid) {
        if (!before.length) return;
        geste({ type: "retirer", jour: day, compagnon: pid, site: null });
        jouerSon("retrait");
        toast(html`${p.name} retiré de <b>${before[0]!.code}</b>${quand()}`);
        return;
      }
      const t = v.site(sid);
      if (!t) return;                          // supprimé ailleurs entre-temps
      /* Déjà posé là : rien ne change, mais le geste est confirmé,
         comme avant W4. */
      if (teamOn(t, day).includes(pid)) { toast(html`${p.name} sur <b>${t.code}</b>${quand()}`); return; }
      geste({ type: "poser", site: sid, jour: day, compagnon: pid, urgence: ui.urgence });
      jouerSon("pose");
      if (ui.urgence && before.length) toast(html`<b>Urgence</b> — ${p.name} est aussi sur <b>${t.code}</b>${quand()}`);
      else if (before.length) toast(html`${p.name} : <b>${before[0]!.code}</b> → <b>${t.code}</b>${quand()}`);
      else toast(html`${p.name} sur <b>${t.code}</b>${quand()}`);
      if (!v.availableOn(pid, day))
        setTimeout(() => toast(html`Attention : ${p.name} s'est déclaré absent ce jour-là`), 2900);
    },

    toggleDay: (pid, sid, d) => {
      const site = vue().site(sid);
      if (!site) return;
      if (teamOn(site, d).includes(pid)) { geste({ type: "retirer", jour: d, compagnon: pid, site: sid }); jouerSon("retrait"); }
      else { geste({ type: "poser", site: sid, jour: d, compagnon: pid, urgence: courant().ui.urgence }); jouerSon("pose"); }
    },

    fillDays: (pid, sid, mode) => {
      const v = vue();
      const site = v.site(sid), p = v.person(pid);
      if (!site || !p) return;
      const { week, dates, ui } = courant();
      const eff = v.daysOf(p, week);
      dates.forEach((d, i) => {
        const want = mode === "dispo" && eff[i];
        const on = teamOn(site, d).includes(pid);
        if (want && !on) geste({ type: "poser", site: sid, jour: d, compagnon: pid, urgence: ui.urgence });
        else if (!want && on) geste({ type: "retirer", jour: d, compagnon: pid, site: sid });
      });
      toast(mode === "dispo"
        ? html`${p.name} posé sur <b>${site.code}</b> tous ses jours dispo`
        : html`${p.name} retiré de <b>${site.code}</b> cette semaine`);
    },

    again: sid => {
      const v = vue();
      const site = v.site(sid);
      if (!site) return;
      const { day, ui } = courant();
      let n = 0;
      teamOn(site, addDays(day, -1)).forEach(pid => {
        if (!v.availableOn(pid, day)) return;
        if (!isFreeOn(v, pid, day) && !ui.urgence) return;
        geste({ type: "poser", site: sid, jour: day, compagnon: pid, urgence: ui.urgence });
        n++;
      });
      toast(n ? html`${plur(n, "compagnon reconduit", "compagnons reconduits")} sur <b>${site.code}</b>`
              : html`Aucun n'est disponible et libre ce jour-là`);
    },

    applyTeam: (sid, ids, days) => {
      const v = vue();
      const site = v.site(sid);
      if (!site) return;
      const urgence = courant().ui.urgence;
      let posed = 0;
      days.forEach(d => ids.forEach(pid => {
        if (!v.availableOn(pid, d)) return;
        if (teamOn(site, d).includes(pid)) return;
        geste({ type: "poser", site: sid, jour: d, compagnon: pid, urgence });
        posed++;
      }));
      toast(html`<b>${site.code}</b> : ${plur(posed, "journée posée", "journées posées")}`);
    },

    /* « Appliquer ce plan » : un seul geste pour toute la semaine. Il
       porte les équipes que l'écran montrait (`avant`) : un autre
       appareil qui a posé quelqu'un entre-temps ne perd rien (ADR-003). */
    applyPlan: (res, days) => {
      const v = vue();
      const semaine = mondayOf(days[0] ?? courant().week);
      const toute = weekDates(semaine);
      const plan: Record<string, Record<string, string[]>> = {};
      const avant: Record<string, Record<string, string[]>> = {};
      for (const s of res.targets) {
        plan[s.id] = Object.fromEntries(days.map(d => [d, (res.plan[s.id] || {})[d] || []]));
        const cur = v.site(s.id);
        avant[s.id] = Object.fromEntries(toute.map(d => [d, cur ? teamOn(cur, d) : []]));
      }
      /* La grille Semaine pose en vague, jour après jour, les noms que ce
         plan fait arriver (W6) — ceux-là seuls : tout nom qui naissait
         dans la seconde suivante entrait en vague, ceux de la semaine
         d'après comme la grille entière remontée (relecture adversariale). */
      const noms = new Set<string>();
      for (const [sid, jours] of Object.entries(plan))
        for (const [d, ids] of Object.entries(jours))
          for (const pid of ids) if (!avant[sid]?.[d]?.includes(pid)) noms.add(sid + "#" + d + "#" + pid);
      patchUi({ vague: { t: performance.now(), semaine, noms } });
      geste({ type: "plan", semaine, plan, avant, urgence: courant().ui.urgence });
      toast(html`<b>${res.posed}</b> journées posées sur la semaine ${weekNum(semaine)}`);
    },

    task: (sid, i, j, on) => geste({ type: "cocher", site: sid, etape: i, mission: j, faite: on }),

    /* La barre s'arrête sur un cran par mission : glisser, c'est cocher.
       Pendant le glisser, seule l'étape bouge à l'écran (setLocal) ; le
       geste part au relâchement, une fois. */
    bar: (sid, i, e, el, direct, setLocal) => {
      const regler = (v: number) => geste({ type: "regler", site: sid, etape: i, pourcentage: apercuEtape(i, v) });
      if (direct != null) { regler(direct); return; }
      if (!e || !el) return;
      const steps = phaseSteps(i);
      const val = (clientX: number) => {
        const r = el.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        return Math.round(frac * steps) / steps * 100;
      };
      const startX = e.clientX, startY = e.clientY;
      /* Le doigt qui a pris la barre la règle seul : un second doigt ne la
         déplace pas et ne la lâche pas (relecture adversariale de W6). */
      const autreDoigt = (ev: PointerEvent) => ev.pointerId !== e.pointerId;
      /* La barre a une zone de toucher plus haute qu'elle (24 px, WCAG
         2.5.8), qui couvre l'espace, mort en W4, entre elle et la première
         mission : un appui là vise la mission. Glisser depuis la zone
         déplace la barre ; un simple appui n'y bascule rien (relecture
         adversariale de W5). */
      const dessin = el.getBoundingClientRect();
      const dansLeDessin = startY >= dessin.top && startY <= dessin.bottom;
      let on = false;
      let derniere: number | null = null;
      const move = (ev: PointerEvent) => {
        if (autreDoigt(ev)) return;
        if (!on) {
          const dx = Math.abs(ev.clientX - startX), dy = Math.abs(ev.clientY - startY);
          if (dy > dx && dy > 6) return stop();      // l'utilisateur défile
          if (dx < 4) return;
          on = true;
          try { el.setPointerCapture(ev.pointerId); } catch { /* capture refusée : le suivi continue */ }
        }
        ev.preventDefault();
        derniere = apercuEtape(i, val(ev.clientX));
        setLocal?.(derniere);
      };
      const up = (ev: PointerEvent) => {
        if (autreDoigt(ev)) return;
        if (!on) {
          /* Un simple appui bascule l'étape entre 0 et 100 %, comme avant
             W4 (constat U4, gardé en l'état) — sur la barre dessinée
             seulement. */
          const site = vue().site(sid);
          if (site && dansLeDessin) regler(site.ph[i]! >= 100 ? 0 : 100);
        } else if (derniere !== null) regler(derniere);
        setLocal?.(null);
        stop();
      };
      /* Un geste interrompu par le système (appel, notification, un
         défilement que le navigateur reprend) ne règle rien, et la barre
         revient à ce qui est enregistré : elle gardait l'aperçu du glisser
         (constat U23). */
      const annuler = (ev: PointerEvent) => {
        if (autreDoigt(ev)) return;
        setLocal?.(null);
        stop();
      };
      const stop = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", annuler);
      };
      document.addEventListener("pointermove", move, { passive: false });
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", annuler);
    },

    note: (sid, v) => geste({ type: "modifierChantier", site: sid, champs: { note: v } }),

    deletePerson: pid => {
      const p = vue().person(pid);
      if (!p) return;
      geste({ type: "supprimerCompagnon", compagnon: pid });
      toast(html`${p.name} supprimé`);
    },

    /* Le lien d'un compagnon, créé au moment où on le demande — et non à
       l'ouverture de la feuille, qui marquait tout le monde « relancé »
       sans rien envoyer (constat U11). */
    lienDispo: async (pid, week) => {
      const [l] = await synchro.depot.demanderDispos([pid], week);
      if (!l) throw new Error("Ce compagnon n'existe plus");
      synchro.integrerDemandes([l.avail]);
      return l.url;
    },

    brief: () => { void shareText("Brief " + DAYS_L[courant().ui.day], briefText()); },
    copy: url => { void navigator.clipboard?.writeText(url); toast(html`Lien copié`); },
    exportBackup, importBackup
  };
  return act;
}
