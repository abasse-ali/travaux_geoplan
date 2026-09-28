/* ============================================================
   Onglet Semaine — chantiers en lignes, sept jours en colonnes
   Répond à « est-ce que ma semaine tient debout ? », qu'aucun écran
   ne montrait depuis que tout se pose au jour.
   ============================================================ */

import { useId, useState } from "react";
import { bouton, carte, cibleSerree, cn, pile, surtitre } from "./primitives/classes";
import { useUi } from "./etat";
import { mouvementReduit } from "./mouvement/reduit";
import {
  DAYS, DAYS_L, WEEKEND, weekDates, parse, todayISO, fmtRange, weekNum,
  teamOn, weekRoster, siteProgress, isActive, type Person
} from "@geoplan/domain";
import type { Actions, UiCoque, Vue } from "./types";

/* ---------- la grille ----------
   Une colonne d'étiquettes, puis les sept jours ; elle défile
   horizontalement si l'écran est trop étroit. */
const LIGNE = "grid grid-cols-[58px_repeat(7,minmax(38px,1fr))] gap-0.75";
const ETIQUETTE = "flex min-w-0 flex-col justify-center gap-0.5 px-0.5 py-1";
const CASE = "flex flex-col items-center justify-center gap-px rounded-[7px] px-px py-0.75";
/* Les initiales d'une case pleine, et son « +N ». Elles entrent par
   une animation à l'insertion (chipIn, dans mouvement.css : une animation
   nommée s'écrit mal en classe). */
const INITIALES = "font-display text-[9.5px]/[1.15] font-semibold tracking-[.02em] not-italic";
const ENTREE = "animate-[chipIn_.2s_ease] motion-reduce:animate-none";

/* La séquence de « Répartir » (W6) : juste après « Appliquer ce plan »,
   les noms qui arrivent dans la grille s'y posent un à un, en vague,
   jour après jour puis rangée après rangée (pose-in, mouvement.css). La
   vague part quand la feuille a presque fini de descendre (250 ms), et
   chaque nom attend son tour dans son état de départ (backwards). Le
   délai est décidé à la naissance du nom : il ne se rejoue pas. Sous le
   mouvement réduit, pas de vague. */
const VAGUE = { fenetre: 1200, depart: 250, parJour: 70, parRangee: 30 };
const EN_VAGUE = "animate-[pose-in_.34s_var(--spring)_backwards]";

function Initiales({ nom, delai }: { nom: string; delai: number | null }){
  const [d] = useState(delai);
  return (
    <i className={cn(INITIALES, "text-ink-2", d === null ? ENTREE : EN_VAGUE)}
      style={d === null ? undefined : { animationDelay: d + "ms" }}>{nom}</i>
  );
}

/* Le fond et le trait d'une case de chantier. Le conflit prime sur
   tout, week-end compris ; puis une équipe posée (plus pâle le
   week-end), puis le week-end. Le jour affiché ne change que le trait,
   sauf en conflit. Les mélanges s'écrivent en color-mix srgb, comme
   avant : le modificateur de Tailwind (bg-blue/16) mélange en oklab. */
function teinteCase({ we, pleine, conflit, affiche }: {
  we: boolean; pleine: boolean; conflit: boolean; affiche: boolean;
}): string {
  const fond = conflit ? "bg-[color-mix(in_srgb,var(--urgence)_18%,var(--surface))]"
    : pleine ? (we ? "bg-[color-mix(in_srgb,var(--blue)_10%,var(--surface))]" : "bg-[color-mix(in_srgb,var(--blue)_16%,var(--surface))]")
    : we ? "bg-transparent" : "bg-surface-2";
  /* Un conflit se voit aussi à son trait en tirets : pas seulement à sa
     teinte (WCAG 1.4.1). */
  const trait = conflit ? "border-dashed border-urgence"
    : affiche ? "border-accent" : we ? "border-line" : "border-transparent";
  return cn(fond, trait);
}

export default function Semaine({ vue, ui, act }: { vue: Vue; ui: UiCoque; act: Actions }){
  const week = ui.week;
  const dates = weekDates(week);
  const today = todayISO();
  const idConflit = useId();
  /* Juste après « Appliquer ce plan » : les noms qui arrivent entrent en vague. */
  const vague = useUi(s => s.vague);
  const enVague = vague !== null && performance.now() - vague < VAGUE.fenetre && !mouvementReduit();
  const person = (id: string) => vue.person(id);
  const availableOn = (pid: string, d: string) => vue.availableOn(pid, d);
  const isFreeOn = (pid: string, d: string) => !vue.sites.some(s => teamOn(s, d).includes(pid));

  const rows = vue.sites.filter(s => isActive(s, week) || weekRoster(s, week).length);
  const posed = rows.reduce((a, s) => a + dates.reduce((b, d) => b + teamOn(s, d).length, 0), 0);

  return (
    <div className={pile}>
      <div className={cn(carte, "p-3")} data-carte="bilan">
        <span className={surtitre}>Semaine {weekNum(week)} · {fmtRange(week)}</span>
        <p className="m-0 mt-2 font-body text-[13.5px]/[1.5] font-normal text-ink-2">
          <b>{posed}</b> journée{posed > 1 ? "s" : ""} posée{posed > 1 ? "s" : ""} sur{" "}
          <b>{rows.length}</b> chantier{rows.length > 1 ? "s" : ""}. Touchez une case pour aller à ce jour.
        </p>
        <button className={cn(bouton({ teinte: "bleu", large: true }), "mt-2.75")}
          onClick={() => act.sheet({ type: "optimize" })}>
          Répartir toute l'équipe sur la semaine
        </button>
      </div>

      {rows.length ? (
        <div className={cn(carte, "overflow-x-auto overscroll-x-contain p-2.5")} data-carte="grille">
          <div className="flex min-w-85 flex-col gap-0.75" data-grille-semaine>
            <span id={idConflit} hidden>Conflit : un compagnon posé ce jour-là s'est déclaré absent.</span>
            <div className={LIGNE} data-ligne="entete">
              <div className={ETIQUETTE} />
              {dates.map((d, i) => {
                const affiche = i === ui.day;
                return (
                  <button key={d} data-case={d} data-cible="serree"
                    className={cn(CASE, cibleSerree["1.5px"], "min-h-8.5", affiche && "bg-accent")}
                    onClick={() => act.goDay(i)}>
                    <em className={cn("font-display text-[9px]/none font-semibold tracking-[.05em] not-italic",
                      affiche ? "text-on-accent" : "text-muted")}>{DAYS[i]}</em>
                    <b className={cn("font-mono text-[13px]/none font-semibold",
                      affiche ? "text-on-accent" : d === today ? "text-accent-texte" : "text-ink-2")}>{parse(d).getDate()}</b>
                  </button>
                );
              })}
            </div>

            {rows.map((s, r) => (
              <div className={LIGNE} key={s.id} data-ligne="chantier">
                <div className={ETIQUETTE}>
                  <b className="overflow-hidden font-mono text-[12px]/[1.1] font-semibold tracking-[-.02em] text-ellipsis">{s.code}</b>
                  <em className="font-mono text-[9.5px]/none font-medium text-muted not-italic">{siteProgress(s)}%</em>
                </div>
                {dates.map((d, i) => {
                  const crew = teamOn(s, d).map(person).filter(Boolean) as Person[];
                  const bad = crew.some(p => !availableOn(p.id, d));
                  const shown = crew.slice(0, 3);
                  const more = crew.length - shown.length;
                  return (
                    <button key={d} data-case={d}
                      data-pleine={crew.length > 0 || undefined} data-conflit={bad || undefined} data-cible="serree"
                      className={cn(CASE, cibleSerree["1.5px"], "min-h-10 border",
                        teinteCase({ we: WEEKEND[i], pleine: crew.length > 0, conflit: bad, affiche: i === ui.day }))}
                      onClick={() => act.goDay(i)}
                      aria-describedby={bad ? idConflit : undefined}
                      aria-label={s.code + " " + DAYS_L[i] + " : " +
                        (crew.length ? crew.map(p => p.name).join(", ") : "personne")}>
                      {crew.length ? (
                        <>
                          {shown.map(p => (
                            <Initiales key={p.id} nom={p.name.slice(0, 2)}
                              delai={enVague ? VAGUE.depart + i * VAGUE.parJour + r * VAGUE.parRangee : null} />
                          ))}
                          {/* À l'encre des initiales : en gris, il tombait sous le seuil AA
                              sur une case pleine (4,2:1) ou en conflit (4,0). */}
                          {more > 0 && <i className={cn(INITIALES, ENTREE, "text-ink-2")}>+{more}</i>}
                        </>
                      ) : <i className="font-display text-[12px]/[1.15] font-semibold tracking-[.02em] text-line-2 not-italic">·</i>}
                    </button>
                  );
                })}
              </div>
            ))}

            <div className={cn(LIGNE, "mt-0.5 border-t border-line pt-1")} data-ligne="libres">
              <div className={ETIQUETTE}>
                <b className="overflow-hidden font-display text-[9.5px]/[1.1] font-semibold tracking-[.09em] text-muted uppercase text-ellipsis">Libres</b>
              </div>
              {dates.map(d => {
                const n = vue.people.filter(p => availableOn(p.id, d) && isFreeOn(p.id, d)).length;
                return (
                  <div key={d} data-case={d} className={cn(CASE, "min-h-7")}>
                    <i className="font-mono text-[11px]/[1.15] font-semibold tracking-[.02em] text-ok-texte not-italic">{n}</i>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className={carte} data-carte="vide">
          <p className="px-3 pt-2.75 pb-3.25 text-[12.5px]/[1.5] text-muted">Aucun chantier sur cette semaine.</p>
        </div>
      )}
    </div>
  );
}
