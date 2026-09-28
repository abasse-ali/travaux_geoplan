/* ============================================================
   Le vivier, en îlot

   Un seul élément passe de la pastille au panneau. Sa forme change au
   geste : on note la forme de l'îlot juste avant, React dessine la
   nouvelle, et le navigateur va de l'une à l'autre (Web Animations,
   ui/mouvement/forme.ts ; ADR-006). `height: auto` reste `auto`. Un
   second appui en chemin repart de la forme où l'îlot en est. Sous le
   mouvement réduit, l'îlot change de forme d'un coup.

   Avant W6, Framer Motion tenait cette forme (`layout`) et la
   réinterpolait à chaque rendu, jusque sur un changement de jour. Le
   contenu qui change (un jour choisi, une puce qui part) change
   maintenant sa taille d'un coup : seul le geste de l'ouvrir ou de le
   replier se déroule.

   Le dessin est en classes (W5). Reste dans etats.css le fond de
   l'îlot (.island, .island.over) : useDrag pose `over` sur #vivier,
   hors de React, quand une puce le survole — comme sur les zones de
   dépôt. En variante ([&.over]:…), le mot « over » serait dans
   l'attribut class au repos.
   ============================================================ */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Interrupteur } from "./primitives/interrupteur";
import { anneauDedans, cn, indiceVide, surtitre } from "./primitives/classes";
import { puce, puceJours, puceNom } from "./puce";
import { jouerForme, noterForme, type Forme } from "./mouvement/forme";
import { useEntree } from "./mouvement/entree";
import { DAYS, DAYS_L, countDays, type Person } from "@geoplan/domain";
import type { PoolState } from "./types";

/* Une puce libre entre par chipIn (mouvement.css : une animation nommée
   s'écrit mal en classe) quand elle arrive dans une liste déjà montrée :
   un jour choisi, une puce rendue au vivier. Celles que la liste montre
   d'emblée — au lancement, à l'ouverture du vivier, qui a son propre
   fondu — n'entrent pas (ADR-006) ; elles entraient toutes, comme en W5
   (relecture adversariale de W6). Décidé à la naissance de la puce.
   Jamais de fill-mode « both » : si l'animation ne démarre pas, la puce
   reste visible. */
const PUCE_LIBRE = puce();
const PUCE_ARRIVEE = cn(PUCE_LIBRE, "animate-[chipIn_.18s_ease] motion-reduce:animate-none");

function Chip({ p, days, entre }: { p: Person; days: boolean[]; entre: boolean }){
  const anime = useEntree(entre);
  return (
    <button className={anime ? PUCE_ARRIVEE : PUCE_LIBRE} data-cible="serree" data-pid={p.id} data-name={p.name}>
      <span className={puceNom}>{p.name}</span>
      <span data-jours className={puceJours}>{countDays(days)}j</span>
    </button>
  );
}

/* « Personne de libre » : même règle que les puces. */
function Vide({ entre, children }: { entre: boolean; children: ReactNode }){
  const anime = useEntree(entre);
  return <p className={cn(indiceVide, anime && "animate-[fade_.2s_ease] motion-reduce:animate-none")}>{children}</p>;
}

/* La liste des libres, montée avec le visage déplié : ce qu'elle montre
   à sa naissance était là d'emblée. */
function Libres({ free, daysOf, week, dayIndex }: Pick<IslandProps, "free" | "daysOf" | "week" | "dayIndex">){
  const affichee = useRef(false);
  useEffect(() => { affichee.current = true; }, []);
  return free.length
    ? <>{free.map(p => <Chip key={p.id} p={p} days={daysOf(p, week)} entre={affichee.current} />)}</>
    : <Vide key="vide" entre={affichee.current}>Personne de libre {DAYS_L[dayIndex].toLowerCase()}.</Vide>;
}

/* L'îlot, comme l'îlot dynamique d'un iPhone. Replié, il ne prend que
   la place de son contenu, calé à droite ; déplié, toute la largeur.
   `left:auto` fait l'ancrage, `width:auto` la taille — et l'animation
   va de l'une à l'autre, en largeur et en hauteur (pas en échelle : le
   texte ne se déforme pas). Le rayon (24 px replié, 20 px déplié) est
   écrit en ligne, et sa transition CSS l'adoucit ; l'animation n'y
   touche pas.
   Le flou est coûteux quand le contenu défile derrière : assez marqué
   pour détacher l'îlot du fond, pas plus.
   Pendant un glisser (.dragging, posé sur body par useDrag), l'îlot
   s'annonce comme cible : trait orange, en tirets.
   L'îlot se restyle à chaque image quand il change de taille, et ses
   visages avec lui : comme la puce (puce.ts), leurs bordure, ombre, flou
   et fondu s'écrivent en propriétés directes, pas avec les classes qui
   composent des variables déclarées (ADR-005, « Le prix d'un
   restyle »). */
const ILOT = cn("island group/ilot absolute right-3 left-auto z-7 flex flex-col overflow-hidden",
  "bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+12px)]",
  "w-[calc(100%-24px)] data-[state=bubble]:w-auto",
  "[border-width:1px] [border-style:solid] border-line-2 [box-shadow:var(--shadow-2)]",
  "[-webkit-backdrop-filter:blur(10px)] [backdrop-filter:blur(10px)]",
  "[transition:border-radius_.42s_var(--spring),background_.16s,border-color_.16s]",
  /* Il se gonfle sous une puce depuis son coin, vers elle (ui/mouvement/vivier.ts). */
  "[transform-origin:100%_100%]",
  "motion-reduce:[transition:none]",
  "in-[.dragging]:border-dashed in-[.dragging]:border-accent");

/* Les deux visages se croisent en fondu ; celui qui s'efface sort du
   flux, ne se touche plus, et quitte le DOM une fois éteint. L'état se
   lit sur l'îlot (group/ilot) : le visage sortant, qui n'a pas changé,
   s'éteint par sa transition. Le visage entrant s'allume (fade). */
const FONDU = "[transition:opacity_.2s_ease]";
const ENTRE = "animate-[fade_.2s_ease] motion-reduce:animate-none";
const EFFACE_OUVERT = "group-data-[state=open]/ilot:pointer-events-none group-data-[state=open]/ilot:absolute"
  + " group-data-[state=open]/ilot:inset-0 group-data-[state=open]/ilot:opacity-0";
const EFFACE_BULLE = "group-data-[state=bubble]/ilot:pointer-events-none group-data-[state=bubble]/ilot:absolute"
  + " group-data-[state=bubble]/ilot:inset-0 group-data-[state=bubble]/ilot:opacity-0";
/* Le temps que le visage sortant s'éteigne (FONDU), un peu plus. */
const SORTIE = 220;

/* Les traits des icônes. */
const TRAIT = "fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round]";

export interface IslandProps {
  free: Person[];                                  // disponibles ET libres ce jour-là
  daysOf: (p: Person, wk: string) => boolean[];    // jours effectifs de la semaine
  week: string;
  dayIndex: number;
  state: PoolState;
  setState: (s: PoolState) => void;
  urgence: boolean;
  setUrgence: (v: boolean) => void;
}

export default function Island({ free, daysOf, week, dayIndex, state, setState, urgence, setUrgence }: IslandProps){
  const open = state === "open";
  const vide = !free.length;

  /* Le visage montré, et celui qui s'éteint encore. Ajusté pendant le
     rendu, pas après : le visage sortant garde son nœud, et sa
     transition d'opacité peut se jouer. */
  const [visages, setVisages] = useState<{ courant: PoolState; sortant: PoolState | null }>({ courant: state, sortant: null });
  if (visages.courant !== state) setVisages({ courant: state, sortant: visages.courant });
  useEffect(() => {
    if (!visages.sortant) return;
    const t = setTimeout(() => setVisages(v => ({ ...v, sortant: null })), SORTIE);
    return () => clearTimeout(t);
  }, [visages.sortant]);
  const montre = (v: PoolState) => v === state || v === visages.sortant;

  /* Le visage du premier affichage ne s'allume pas, tant qu'il reste
     monté ; un visage qui arrive ensuite s'allume, une fois. Décidé à
     sa naissance : sa classe ne change plus tant qu'il vit, et
     l'animation ne se rejoue pas. */
  const premiers = useRef(new Set<PoolState>([state]));
  for (const v of ["open", "bubble"] as const) if (!montre(v)) premiers.current.delete(v);
  const entre = (v: PoolState) => !premiers.current.has(v);

  /* La forme : notée avant le changement, jouée après. */
  const ilot = useRef<HTMLElement | null>(null);
  const forme = useRef<Forme | null>(null);
  const changer = (s: PoolState) => {
    forme.current = ilot.current ? noterForme(ilot.current) : null;
    setState(s);
  };
  useLayoutEffect(() => {
    const avant = forme.current;
    forme.current = null;
    if (avant && ilot.current) jouerForme(ilot.current, avant);
  }, [state]);

  return (
    <section
      ref={ilot}
      id="vivier"
      className={ILOT}
      data-state={state}
      data-vide={vide || undefined}
      style={{ borderRadius: open ? 20 : 24 }}>
      {montre("open") && (
        <div key="full" className={cn("flex min-h-0 flex-col", FONDU, EFFACE_BULLE, entre("open") && ENTRE)}>
          <div className="flex flex-none items-center gap-2.25 px-3.25 pt-2.75 pb-2">
            {/* La tête tient sur 30 px, les puces commencent 8 px plus bas :
                chaque contrôle s'étend autant que la place le permet, sans
                mordre sur un voisin (poignée 30 px, interrupteur et
                « Réduire » 40 px ; WCAG 2.5.8). */}
            <button data-cible="serree" onClick={() => changer("bubble")} aria-expanded="true"
              className="relative isolate flex min-w-0 flex-1 items-center gap-2.25 text-left after:absolute after:-z-10 after:inset-x-0 after:-inset-y-[9.5px] after:content-['']">
              <span data-vivier-titre className={surtitre}>
                Vivier · {DAYS[dayIndex].toLowerCase()} · {free.length}
              </span>
            </button>
            <Interrupteur checked={urgence} onCheckedChange={setUrgence}>Urgence</Interrupteur>
            <button data-cible="serree" onClick={() => changer("bubble")}
              className="relative isolate grid size-7.5 flex-none place-items-center rounded-[9px] border border-line bg-surface-2 text-muted active:bg-surface-3 after:absolute after:-z-10 after:-inset-[5px] after:content-['']"
              aria-label="Réduire le vivier">
              <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-4 stroke-[2.2]", TRAIT)}><path d="m6 10 6 6 6-6" /></svg>
            </button>
          </div>
          {/* La liste ne défile plus pendant un glisser. */}
          <div className="flex min-h-0 flex-wrap items-start gap-1.5 overflow-y-auto overscroll-contain px-3 pb-3 in-[.dragging]:overflow-hidden">
            <Libres free={free} daysOf={daysOf} week={week} dayIndex={dayIndex} />
          </div>
        </div>
      )}
      {montre("bubble") && (
        <button key="face"
          className={cn("flex h-11.5 flex-none items-center gap-1.75 px-4 text-ink-2 active:[transform:scale(.96)]",
            anneauDedans, FONDU, EFFACE_OUVERT, entre("bubble") && ENTRE)}
          onClick={() => changer("open")}
          aria-label={"Ouvrir le vivier — " + free.length + " disponible"}>
          {/* Vivier vide : le nombre et l'icône passent au gris. */}
          <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-4.75 flex-none stroke-[1.7]", TRAIT, vide && "text-muted")}>
            <circle cx="9" cy="8" r="3.2" />
            <path d="M2.6 20a6.4 6.4 0 0 1 12.8 0" />
            <path d="M16.4 6.3a3 3 0 0 1 0 5.4M17.8 20a6.4 6.4 0 0 0-2-4.5" />
          </svg>
          <b className={cn("font-mono text-[15px]/none font-semibold tabular-nums", vide ? "text-muted" : "text-ink")}>{free.length}</b>
          <span className="font-display text-[9.5px]/none font-semibold tracking-[.09em] uppercase text-muted">Vivier</span>
        </button>
      )}
    </section>
  );
}
