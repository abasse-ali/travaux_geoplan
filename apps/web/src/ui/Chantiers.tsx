/* ============================================================
   Onglet Chantiers — les fiches, jour par jour
   ============================================================ */

import { useEffect, useRef, useState, memo, type CSSProperties, type ReactNode } from "react";
import { Acc, Chevron, Pips, plur } from "./bits";
import { Repli } from "./mouvement/repli";
import { useEntree } from "./mouvement/entree";
import { anneauDedans, bouton, carte, cible, cn, indiceVide, pile, surtitre } from "./primitives/classes";
import { puce, puceNom } from "./puce";
import {
  PHASES, DAYS_L, pad, parse, addDays, fmtDay, phaseColor, skLabel, skColor,
  teamOn, weekRoster, daysOnSite, siteProgress, currentPhase, span, isActive,
  forecast, conflicts, taskDone, taskCount, tasksTicked, weekDates,
  type Person, type Site
} from "@geoplan/domain";
import { useUi } from "./etat";
import type { Actions, PointerStart, SetLocal, UiCoque, Vue } from "./types";

/* La teinte d'une étape ou d'un métier vient du domaine (phaseColor,
   skColor) et passe par --c : la classe ne fait que la lire (bg-(--c)). */
const teinte = (c: string, autres?: CSSProperties): CSSProperties =>
  ({ ...autres, "--c": c }) as CSSProperties;

/* Le remplissage d'une barre d'étape, sur le curseur (largeur) comme sur
   l'échelle des douze étapes (hauteur). Il se restyle à chaque image de
   sa transition : comme la puce (puce.ts), sa transition s'écrit en
   propriété directe, pas avec transition-*, duration-*, ease-*, qui
   composent des variables déclarées (ADR-005, « Le prix d'un restyle » ;
   gardé par tests/classes-chaudes.test.ts). */
const REMPLISSAGE = "block bg-(--c) will-change-[width,height]"
  + " [transition:width_.28s_cubic-bezier(.22,.9,.3,1),height_.28s_cubic-bezier(.22,.9,.3,1)]"
  + " motion-reduce:transition-none";

/* Une puce posée entre par chipIn (mouvement.css), jouée par le
   compositeur. Elle ne glisse plus à sa place à chaque rendu (`layout`
   de Framer Motion, retiré en W6), et ne s'efface pas en partant : le
   fantôme porte le geste. */
function Chip({ p, site, week, vue, entre }: { p: Person; site: Site; week: string; vue: Vue; entre: boolean }){
  const anime = useEntree(entre);
  const on = daysOnSite(site, p.id, week);
  const dates = weekDates(week);
  const bad = on.map((v, i) => v && !vue.availableOn(p.id, dates[i]!));
  return (
    <button className={cn(puce(), anime && "animate-[chipIn_.18s_ease] motion-reduce:animate-none")} data-cible="serree"
      data-pid={p.id} data-name={p.name} data-site={site.id}>
      <span className={puceNom}>{p.name}</span>
      <Pips on={on} bad={bad} />
    </button>
  );
}

/* L'indice d'une zone vide, en fondu s'il arrive après le premier affichage. */
function Indice({ entre, children }: { entre: boolean; children: ReactNode }){
  const anime = useEntree(entre);
  return <p className={cn(indiceVide, anime && "animate-[fade_.2s_ease] motion-reduce:animate-none")}>{children}</p>;
}

/* ---------- prévision ---------- */

const PREVISION = "flex flex-wrap items-center gap-1.5 px-3 pt-2.25 text-[11.5px] text-muted";
/* Les nombres de la prévision ; la couleur à part (la fin en retard change). */
const CHIFFRE = "font-mono font-semibold tabular-nums";
const SEP = "text-line-2";
const DRAPEAU = "rounded-[5px] px-1.5 py-0.75 font-display text-[9.5px]/none font-semibold tracking-[.08em] uppercase";
/* Les fonds s'écrivent en color-mix srgb, comme avant : le modificateur
   de Tailwind (bg-warn/16) mélange en oklab, une autre valeur calculée. */
const DRAPEAUX = {
  retard: "bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-warn-texte",
  arret: "bg-[color-mix(in_srgb,var(--urgence)_14%,transparent)] text-urgence-texte",
  livre: "bg-[color-mix(in_srgb,var(--ok)_15%,transparent)] text-ok-texte"
} as const;

function Drapeau({ sorte, children }: { sorte: keyof typeof DRAPEAUX; children: ReactNode }){
  return <span data-drapeau={sorte} className={cn(DRAPEAU, DRAPEAUX[sorte])}>{children}</span>;
}

function Forecast({ site, week, vue }: { site: Site; week: string; vue: Vue }){
  const availableOn = vue.availableOn;
  const f = forecast(site, week, availableOn);
  if (f.done) return <div data-prevision className={PREVISION}><Drapeau sorte="livre">Livré</Drapeau></div>;
  const rest = Math.round(f.rest!);          // hors « livré », forecast donne toujours le reste
  if (f.stalled) return (
    <div data-prevision className={PREVISION}>
      <b className={cn(CHIFFRE, "text-ink-2")}>{rest}</b> j·h restants<span className={SEP}>·</span>
      <Drapeau sorte="arret">Personne cette semaine</Drapeau>
    </div>
  );
  const bad = conflicts(site, week, availableOn).length;
  return (
    <div data-prevision className={PREVISION}>
      <b className={cn(CHIFFRE, "text-ink-2")}>{rest}</b> j·h restants<span className={SEP}>·</span>
      <b className={cn(CHIFFRE, "text-ink-2")}>{f.cap}</b> j·h posés<span className={SEP}>·</span>
      fin <b className={cn(CHIFFRE, f.late ? "text-warn-texte" : "text-ink-2")}>{fmtDay(f.end!)}</b>
      {f.late && <Drapeau sorte="retard">Après le {fmtDay(f.planned)}</Drapeau>}
      {bad > 0 && <Drapeau sorte="arret">{plur(bad, "jour")} en conflit</Drapeau>}
    </div>
  );
}

/* ---------- une étape, ses missions ---------- */

interface PhaseProps {
  site: Site; i: number; open: boolean;
  onToggle: () => void;
  onTask: (i: number, j: number, on: boolean) => void;
  onBar: (e: PointerStart | null, i: number, el: HTMLElement | null,
          direct?: number, setLocal?: SetLocal) => void;
}

function Phase({ site, i, open, onToggle, onTask, onBar }: PhaseProps){
  const P = PHASES[i];
  /* Pendant le glisser, la valeur vit ici : redessiner toute la liste
     des chantiers à chaque mouvement du doigt coûtait trois images. */
  const [glisse, setGlisse] = useState<number | null>(null);
  const v = glisse ?? site.ph[i];
  const cur = currentPhase(site);
  const done = site.ph.every(x => x >= 100);
  const isCur = i === cur && !done;
  const ticks = taskDone(site, i);
  const n = tasksTicked(site, i), tot = taskCount(i);

  return (
    <div className={cn("flex gap-2.25 border-t border-line py-2 first:border-t-0",
      isCur && "-mx-1.5 rounded-[8px] bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] px-1.5")}>
      <div className="w-5 flex-none pt-px text-right font-mono text-[11px]/[1.5] font-semibold text-muted">{pad(i + 1)}</div>
      <div className="min-w-0 flex-1">
        {/* Titre et barre d'une étape se partagent 37 px : 44 chacun est
            impossible sans agrandir la ligne. Le titre s'étend jusqu'au
            filet du haut (8 px) et de la moitié de l'écart avec la barre
            (3 px) : 28 px au doigt ; la barre, de 3 px vers le titre et de
            7 px vers le bas : 24 px (WCAG 2.5.8). */}
        <button data-cible="serree" onClick={onToggle} aria-expanded={open}
          className="relative isolate flex w-full items-baseline gap-1.75 text-left after:absolute after:-z-10 after:inset-x-0 after:-top-2 after:-bottom-[3px] after:content-['']">
          <span data-etape-nom className={cn("min-w-0 flex-1 font-body text-[13px]/[1.3] font-semibold", v >= 100 && "text-muted")}>{P.n}</span>
          <span data-etape-missions className="font-mono text-[10px]/none font-medium text-muted">{n ? n + "/" + tot : "S" + P.wk}</span>
          <span data-etape-pct className="w-9 text-right font-mono text-[12px]/none font-semibold tabular-nums">{v}%</span>
          {/* Le chevron se centre sur la ligne, à 2 px du pourcentage. */}
          <span className="ml-0.5 flex self-center"><Chevron haut={open} /></span>
        </button>

        {/* Pas de sélection de texte depuis la barre : à la souris, un
            geste vertical parti d'elle sélectionnait les missions, et le
            glisser suivant emportait la sélection (un glisser-déposer du
            navigateur, qui interrompt le geste) au lieu de régler l'étape. */}
        <div data-cible="serree"
          className="relative isolate mt-1.5 h-3.5 touch-pan-y rounded-[4px] bg-surface-3 select-none before:absolute before:-z-10 before:inset-x-0 before:-top-[3px] before:-bottom-[7px] before:content-['']"
          role="slider" tabIndex={0}
          aria-label={"Étape " + (i + 1) + " " + P.n}
          aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}
          onPointerDown={e => onBar(e, i, e.currentTarget, undefined, setGlisse)}
          onKeyDown={e => {
            const step = 100 / tot;
            if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onBar(null, i, null, v + step); }
            else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onBar(null, i, null, v - step); }
            else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBar(null, i, null, v >= 100 ? 0 : 100); }
          }}>
          {/* Les barres s'animent par une transition du compositeur, pas par
              React (douze par fiche, elles coûtaient un composant animé
              chacune) ; celle de l'étape en cours pousse depuis la gauche
              à son arrivée. Le calque qui rogne la barre et porte son filet
              est à l'intérieur : sur la barre elle-même, il rognerait aussi
              sa zone de toucher. */}
          <span className="absolute inset-0 overflow-hidden rounded-[4px] after:absolute after:inset-0 after:rounded-[4px] after:border after:border-[color-mix(in_srgb,var(--ink)_9%,transparent)]">
            <b className={cn("absolute inset-y-0 left-0 origin-left", REMPLISSAGE,
              isCur && "animate-[barGrow_.3s_var(--spring)] motion-reduce:animate-none")}
              style={teinte(phaseColor(i), { width: v + "%" })} />
          </span>
        </div>

        <Repli ouvert={open}>
            <ul className="mx-0 mt-2 mb-0.5 flex flex-col gap-0.75 overflow-hidden p-0">
              {P.tasks.map((T, j) => (
                /* La case à cocher sert de puce. Le « – » de l'ancienne liste
                   se posait seul sur sa ligne, au-dessus de chaque mission
                   (constat V2) : retiré. */
                <li key={j} className="block list-none text-[11.5px]/[1.4] text-ink-2">
                  <button className={cn(cible, anneauDedans, "flex w-full items-start gap-2 px-0.5 py-1.25 text-left font-body text-[12px]/[1.4] font-normal text-ink-2")}
                    aria-pressed={!!ticks[j]}
                    onClick={() => onTask(i, j, !ticks[j])}>
                    <span className={cn("mt-px grid size-4.25 flex-none place-items-center rounded-[5px] border-[1.5px]",
                      ticks[j] ? "border-transparent bg-accent" : "border-line-champ bg-surface-2")}>
                      {/* La coche paraît par tickIn (CSS). Framer Motion
                          l'animait aussi, par-dessus : retiré en W6. */}
                      <svg viewBox="0 0 24 24" aria-hidden="true"
                        className={cn("size-2.75 fill-none stroke-on-accent stroke-3 [stroke-linecap:round] [stroke-linejoin:round]",
                          ticks[j] ? "opacity-100 animate-[tickIn_.2s_var(--spring)] motion-reduce:animate-none" : "opacity-0")}>
                        <path d="m5 12.5 4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                    <span className={cn("flex min-w-0 flex-col gap-0.75", ticks[j] && "text-muted line-through")}>
                      <span className={ticks[j] ? "line-through" : undefined}>{T.t}</span>
                      <span className={cn("flex flex-wrap items-center gap-1.25 font-display text-[10px]/[1.3] font-medium tracking-[.04em] uppercase text-muted",
                        ticks[j] && "line-through")}>
                        {T.sk
                          ? <><i className="inline-block size-1.5 flex-none rounded-[2px] bg-(--c)" style={teinte(skColor(T.sk))} />{skLabel(T.sk)} niv. {T.lv}</>
                          : "polyvalent"}
                        {" · " + T.jh + " j·h"}{T.permis && " · permis"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
        </Repli>
      </div>
    </div>
  );
}

/* ---------- la fiche d'un chantier ---------- */

interface SiteCardProps {
  site: Site;
  vue: Vue;
  day: string; week: string; dayIdx: number;
  act: Actions;
  entre: boolean;                // arrivée après le premier affichage de la liste
}

/* La zone de dépôt. `zone` reste sur l'élément : useDrag la cherche pour
   effacer le survol, et pose `over` (et `urg` en mode urgence) sous le
   doigt, hors de React. Son trait et son fond, qui suivent ces états,
   restent donc dans etats.css (.zone) : en variantes ([&.over]:…), les
   mots « over » et « urg » seraient dans l'attribut class au repos, là
   où les tests lisent l'état. */
const ZONE = "zone mx-2.25 mb-2.25 rounded-[11px] p-2.25";

/* L'étiquette de l'étape en cours : teinte de l'étape, ou vert une fois livré. */
const ETIQUETTE = "inline-flex items-center gap-1.5 rounded-[7px] px-2.25 py-1 font-body text-[11.5px]/[1.25] font-semibold text-on-blue";

function SiteCardBrut({ site, vue, day, week, dayIdx, act, entre }: SiteCardProps){
  const anime = useEntree(entre);
  /* Après son premier affichage, ce qui arrive dans la fiche (puces,
     indice) entre en mouvement. */
  const affichee = useRef(false);
  useEffect(() => { affichee.current = true; }, []);
  /* Chaque carte lit ce qui la concerne : déplier la note d'un chantier
     ne redessine que lui. */
  const openSite = useUi(s => s.openSite === site.id);
  const openNote = useUi(s => s.openNote === site.id);
  const openPhaseIdx = useUi(s => s.openPhase && s.openPhase.startsWith(site.id + "#")
    ? +s.openPhase.slice(site.id.length + 1) : -1);
  const person = (id: string) => vue.person(id);
  const cur = currentPhase(site);
  const pct = siteProgress(site);
  const team = teamOn(site, day);
  const roster = weekRoster(site, week);
  const prevDay = addDays(day, -1);
  const prevTeam = teamOn(site, prevDay);
  const done = site.ph.every(v => v >= 100);
  const active = isActive(site, week);

  /* content-visibility : une fiche hors écran n'est ni disposée ni
     peinte ; le navigateur se contente de la hauteur annoncée (520 px),
     qu'il corrige dès qu'elle approche. Sur six chantiers ouverts, un
     rendu ne coûte que ce qui est visible. */
  return (
    <article
      className={cn(carte, "overflow-hidden [contain-intrinsic-size:auto_520px] [content-visibility:auto]",
        anime && "animate-[carte-in_.3s_cubic-bezier(.22,.9,.3,1)] motion-reduce:animate-none")}
      data-site={site.id} data-inactif={!active || undefined}>

      <div className="flex items-start gap-2.5 px-3 pt-3">
        <div>
          <div data-code className="font-mono text-[19px]/none font-semibold tracking-[-.02em]">{site.code}</div>
          <p data-adresse className="m-0 mt-1.25 text-[12.5px] text-muted">{site.addr || "Adresse à compléter"}</p>
        </div>
        <div className="ml-auto flex flex-none items-start gap-1.5 text-right">
          <div>
            <b data-avancement className="block font-mono text-[19px]/none font-semibold tracking-[-.03em] tabular-nums">{pct}%</b>
            <span data-duree className="mt-0.75 block font-display text-[9px]/none font-semibold tracking-[.1em] text-muted uppercase">{site.months} mois</span>
          </div>
          <button className={cn(cible, "-mt-0.75 grid size-6.5 place-items-center rounded-[8px] font-body text-[15px]/none font-semibold text-muted")}
            aria-label="Modifier le chantier"
            onClick={() => act.sheet({ type: "site", id: site.id })}>⋮</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.75 px-3 pt-2.5">
        {done
          ? <span data-etape className={cn(ETIQUETTE, "bg-ok")}>Chantier livré</span>
          : <>
              <span data-etape className={cn(ETIQUETTE, "bg-(--c)")} style={teinte(phaseColor(cur))}>
                <span className="font-mono">{pad(cur + 1)}</span>{PHASES[cur].n}
              </span>
              <span data-etape-note className="text-[11.5px] text-muted">
                {active ? "semaine " + PHASES[cur].wk + " sur 8"
                  : (week < span(site).first ? "démarre le " + fmtDay(site.start) : "période dépassée")}
              </span>
            </>}
      </div>

      <Forecast site={site} week={week} vue={vue} />

      <div data-echelle className="flex items-end gap-0.75 p-3">
        {site.ph.map((v, i) => {
          const enCours = i === cur && !done;
          return (
            <i key={i} aria-current={enCours ? "step" : undefined}
              className={cn("relative block flex-1 overflow-hidden rounded-[2px] bg-surface-3",
                enCours ? "h-7.75 outline-[1.5px] outline-offset-[1.5px] outline-accent" : "h-6.25")}
              title={"Étape " + (i + 1) + " — " + PHASES[i].n}>
              <b className={cn("absolute inset-x-0 bottom-0", REMPLISSAGE)}
                style={teinte(phaseColor(i), { height: v + "%" })} />
            </i>
          );
        })}
      </div>

      <div className={ZONE} data-drop={site.id}>
        <div className="mb-2 flex items-center gap-2">
          <span data-zone-titre className={surtitre}>{DAYS_L[dayIdx]} {fmtDay(day)} · {team.length}</span>
          <span className="flex-1" />
          <button className={bouton({ taille: "petit" })} onClick={() => act.sheet({ type: "suggest", id: site.id })}>
            Composer
          </button>
        </div>
        <div className="flex min-h-8 flex-wrap items-start gap-1.5">
          {team.length
            ? (team.map(person).filter(Boolean) as Person[]).map(p =>
                <Chip key={p.id} p={p} site={site} week={week} vue={vue} entre={affichee.current} />)
            : prevTeam.length
              ? <Indice key="again" entre={affichee.current}>
                  Personne ce jour-là.{" "}
                  <button className={cn(bouton({ taille: "petit" }), "mt-1.5")}
                    onClick={() => act.again(site.id)}>
                    Reprendre l'équipe de la veille
                  </button>
                </Indice>
              : <Indice key="vide" entre={affichee.current}>
                  Glissez un compagnon depuis le vivier, ou demandez une composition.
                </Indice>}
        </div>
        {roster.length > 0 && (
          <p className="mx-0.5 mt-2 mb-0 text-[11px]/[1.45] text-muted">
            Sur la semaine : {roster.map(id => person(id)?.name).filter(Boolean).join(", ")}
          </p>
        )}
      </div>

      <Acc open={openSite}
        onToggle={() => act.openSite(openSite ? null : site.id)}
        label="Les 12 étapes"
        right={<span className="font-mono text-[10px]/none font-medium text-muted">{site.ph.filter(v => v >= 100).length}/12</span>}>
        {openSite && site.ph.map((_, i) => (
          <Phase key={i} site={site} i={i}
            open={openPhaseIdx === i}
            onToggle={() => act.openPhase(openPhaseIdx === i ? null : site.id + "#" + i)}
            onTask={(pi, pj, on) => act.task(site.id, pi, pj, on)}
            /* Le cinquième argument, c'est le retour visuel pendant le
               glisser : sans lui, la barre ne suivait pas le doigt (U2). */
            onBar={(e, pi, el, direct, setLocal) => act.bar(site.id, pi, e, el, direct, setLocal)} />
        ))}
      </Acc>

      <Acc open={openNote}
        onToggle={() => act.openNote(openNote ? null : site.id)}
        label="Note de chantier"
        right={site.note ? <span data-pastille className="inline-block size-1.75 flex-none rounded-[2px] bg-accent" /> : null}>
        <textarea className="min-h-19 w-full resize-y rounded-[10px] border border-line-champ bg-surface-2 p-2.5 font-body text-[15px]/[1.45] font-normal placeholder:text-muted"
          defaultValue={site.note}
          placeholder="Réserves, matériel à commander, accès…"
          onChange={e => act.note(site.id, e.target.value)} />
      </Acc>
    </article>
  );
}

/* Une fiche ne se redessine que si elle a changé, ou si le jour, la
   semaine ou son état d'ouverture ont changé. Sans cela, choisir un
   autre jour reconstruisait les six fiches.
   Les données ne sont plus modifiées sur place : un chantier touché par
   un geste est un nouvel objet, et l'identité suffit (plus de `_rev`,
   constat U13). La fiche lit aussi les compagnons (noms des puces) et
   leurs réponses (jours en conflit) : elle se redessine quand l'une de
   ces listes change — un compagnon renommé, une réponse arrivée — ce
   qu'elle ne faisait pas avant W4 (constat U5). */
const SiteCard = memo(SiteCardBrut, (a: SiteCardProps, b: SiteCardProps) =>
  a.site === b.site && a.vue.people === b.vue.people && a.vue.avail === b.vue.avail &&
  a.day === b.day && a.week === b.week && a.dayIdx === b.dayIdx && a.act === b.act);

export interface ChantiersProps {
  vue: Vue; ui: UiCoque; act: Actions;
  day: string; dayIdx: number;
}

export default function Chantiers({ vue, ui, act, day, dayIdx }: ChantiersProps){
  const week = ui.week;
  /* Les chantiers du premier affichage ; un chantier ouvert ensuite entre
     en mouvement (carte-in). */
  const premiers = useRef<Set<string> | null>(null);
  premiers.current ??= new Set(vue.sites.map(s => s.id));

  if (!vue.sites.length) return (
    <div className={cn(carte, "flex flex-col items-center gap-3 px-4.5 py-6.5 text-center")}>
      <h3 className="m-0 font-display text-[16px]/[1.25] font-bold">Aucun chantier</h3>
      <p className="m-0 max-w-[30ch] text-[13px]/[1.55] text-muted">Ouvrez votre premier chantier : un code court, une adresse, une date de début.
        Les 12 étapes sont créées automatiquement.</p>
      <button className={bouton({ teinte: "primaire" })} onClick={() => act.sheet({ type: "site", id: null })}>
        Ouvrir un chantier
      </button>
    </div>
  );

  const sorted = vue.sites.slice().sort((a, b) =>
    (isActive(b, week) ? 1 : 0) - (isActive(a, week) ? 1 : 0) || a.start.localeCompare(b.start));
  const ouverts = vue.sites.filter(s => teamOn(s, day).length).length;

  return (
    <div className={pile}>
      <div className={cn(carte, "flex items-center gap-2.5 px-3 py-2.5")}>
        <div>
          <span data-bandeau-jour className={surtitre}>{DAYS_L[dayIdx]}</span>
          <p data-bandeau-resume className="m-0 mt-1 font-mono text-[14px]/[1.1] font-semibold text-ink-2">{fmtDay(day)} · {plur(ouverts, "chantier")}</p>
        </div>
        <span className="flex-1" />
        <button className={bouton({ teinte: "bleu", taille: "petit" })} onClick={act.brief}>Partager le brief</button>
      </div>

      {sorted.map(s => (
        <SiteCard key={s.id} site={s} vue={vue} day={day} week={week} dayIdx={dayIdx} act={act}
          entre={!premiers.current!.has(s.id)} />
      ))}
    </div>
  );
}
