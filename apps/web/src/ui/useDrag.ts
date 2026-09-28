/* ============================================================
   Glisser-déposer tactile

   Le drag-and-drop HTML5 n'existe pas sur iOS : on le reconstruit au
   doigt. Les puces sont en touch-action:none — un geste qui part d'une
   puce ne peut pas faire défiler la liste, autant le convertir tout de
   suite en déplacement.

   Le glisser vit hors de React : pendant qu'un doigt tient une puce,
   redessiner l'arbre arracherait le nœud sous le doigt. On ne touche
   donc qu'au fantôme et aux classes des cibles, et on ne prévient
   React qu'au dépôt.

   Ces classes (dragging sur body, lifted sur la puce, over et urg sur
   la cible) se dessinent ailleurs : en variantes in-[.dragging]:… là où
   un élément réagit au glisser (ui/Island.tsx), en CSS pour les autres
   (etats.css : .zone.over, .island.over, .chip.lifted).
   ============================================================ */

import { useEffect, useRef, type RefObject } from "react";
import { voler, type Vol } from "./mouvement/atterrissage";
import { degonfler, gonfler } from "./mouvement/vivier";

/* Le fantôme qui suit le doigt : le nom du compagnon sur une étiquette
   penchée, cernée d'orange, centrée sur le doigt (un peu au-dessus :
   moveGhost). Créé une fois dans body, hors de React, caché entre deux
   glisser par l'attribut `hidden` ; `data-fantome` le nomme pour les
   tests. Il se restyle à chaque mouvement du doigt : sa bordure, sa
   graisse et son ombre s'écrivent en propriétés directes (ADR-005, « Le
   prix d'un restyle » ; tests/classes-chaudes.test.ts). */
export const FANTOME = "pointer-events-none fixed z-80 rounded-[10px] [border-width:1.5px] [border-style:solid] border-accent"
  + " bg-surface px-3 py-2 font-body text-[14px]/none [font-weight:600] [box-shadow:var(--shadow-3)]"
  + " [transform:translate(-50%,-50%)_rotate(-2deg)]";

interface Pt { x: number; y: number }

/** Un glisser en cours : la puce tenue, où le doigt est parti, où il est. */
interface DragState {
  pid: string; name: string; chip: HTMLElement;
  start: Pt; cur: Pt; active: boolean;
  target: string | null;               // id du chantier survolé, « __pool » pour le vivier
  timer: ReturnType<typeof setTimeout>;
}

export interface DragOptions {
  onDrop: (pid: string, sid: string | null) => void;        // null : rendu au vivier
  onTap: (pid: string, fromSite: string | null) => void;    // appui sans glisser
  urgence: boolean;
  scrollRef?: RefObject<HTMLElement | null>;
}

export function useDrag({ onDrop, onTap, urgence, scrollRef }: DragOptions): void {
  const drag = useRef<DragState | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);
  /* Les fonctions changent à chaque rendu ; on lit toujours la dernière
     sans réabonner les écouteurs. */
  const latest = useRef({ onDrop, onTap, urgence });
  latest.current = { onDrop, onTap, urgence };

  useEffect(() => {
    const g = document.createElement("div");
    g.className = FANTOME;
    g.dataset.fantome = "";
    g.hidden = true;
    document.body.appendChild(g);
    ghost.current = g;

    const clearHints = () => {
      document.querySelectorAll(".zone.over").forEach(z => z.classList.remove("over", "urg"));
      document.querySelectorAll("#vivier.over").forEach(z => z.classList.remove("over"));
    };

    const moveGhost = (pt: Pt) => { g.style.left = pt.x + "px"; g.style.top = (pt.y - 26) + "px"; };

    /* Le vol du fantôme après un lâcher (ui/mouvement/atterrissage.ts). */
    let vol: Vol | null = null;

    const lift = () => {
      const d = drag.current;
      if (!d || d.active) return;
      vol?.finir();              // le lâcher d'avant se pose d'un coup
      vol = null;
      d.active = true;
      clearTimeout(d.timer);
      d.chip.classList.add("lifted");
      document.body.classList.add("dragging");
      g.textContent = d.name;
      g.hidden = false;
      moveGhost(d.cur);
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch(e){} }
    };

    const autoScroll = (pt: Pt) => {
      const sc = scrollRef?.current;
      cancelAnimationFrame(raf.current);
      if (!sc) return;
      const r = sc.getBoundingClientRect();
      let dir = 0;
      if (pt.y < r.top + 56) dir = -1;
      else if (pt.y > r.bottom - 56) dir = 1;
      if (!dir) return;
      const step = () => {
        if (drag.current?.active) { sc.scrollTop += dir * 9; raf.current = requestAnimationFrame(step); }
      };
      raf.current = requestAnimationFrame(step);
    };

    /* La fin du dernier geste au doigt (onClick l'ignore dans la foulée). */
    let finDuGeste = -Infinity;

    const onDown = (e: PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      const chip = (e.target as Element).closest?.<HTMLElement>(".chip");
      if (!chip || !chip.dataset.pid) return;
      const start = { x: e.clientX, y: e.clientY };
      drag.current = {
        pid: chip.dataset.pid, name: chip.dataset.name || "", chip,
        start, cur: start, active: false, target: null,
        timer: setTimeout(lift, 190)
      };
    };

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const pt = { x: e.clientX, y: e.clientY };
      d.cur = pt;
      if (!d.active) {
        const dx = pt.x - d.start.x, dy = pt.y - d.start.y;
        if (dx*dx + dy*dy > 64) lift(); else return;
      }
      e.preventDefault();
      moveGhost(pt);
      const under = document.elementFromPoint(pt.x, pt.y);
      const zone = under?.closest?.<HTMLElement>("[data-drop]") || null;
      const viv = under?.closest?.("#vivier") || null;
      const next = zone ? zone.dataset.drop as string : (viv ? "__pool" : null);
      if (next !== d.target) {
        const avant = d.target;
        clearHints();
        d.target = next;
        if (zone) { zone.classList.add("over"); if (latest.current.urgence) zone.classList.add("urg"); }
        else if (viv) viv.classList.add("over");
        /* Une puce posée au-dessus du vivier : il se gonfle ; elle
           repart : il se dégonfle (ui/mouvement/vivier.ts). */
        const ilot = d.chip.dataset.site ? document.getElementById("vivier") : null;
        if (ilot && next === "__pool") gonfler(ilot);
        else if (ilot && avant === "__pool") degonfler(ilot);
      }
      autoScroll(pt);
    };

    /* La fin d'un geste, quelle qu'elle soit : le glisser est rangé. Le
       fantôme, lui, finit son vol (voler) avant de se cacher. */
    const finir = (): DragState | null => {
      const d = drag.current;
      if (!d) return null;
      finDuGeste = performance.now();
      clearTimeout(d.timer);
      cancelAnimationFrame(raf.current);
      drag.current = null;
      document.body.classList.remove("dragging");
      clearHints();
      return d;
    };

    /* Rien n'est posé : le fantôme revient à la puce soulevée, qui
       reprend sa couleur quand il l'a rejointe. */
    const revenir = (d: DragState) => {
      vol = voler(g, () => d.chip, () => d.chip.classList.remove("lifted"));
    };

    const onUp = () => {
      const d = finir();
      if (!d) return;
      /* Un appui sans glisser n'a jamais montré le fantôme (s'il vole
         encore, c'est le lâcher d'avant : il se cachera en arrivant). */
      if (!d.active) { latest.current.onTap(d.pid, d.chip.dataset.site || null); return; }
      if (!d.target) { revenir(d); return; }
      /* Une puce posée, lâchée dans le vivier : il reprend sa forme, et
         le fantôme va s'y poser. */
      const ilot = d.target === "__pool" && d.chip.dataset.site ? document.getElementById("vivier") : null;
      if (ilot) degonfler(ilot);
      d.chip.classList.remove("lifted");
      latest.current.onDrop(d.pid, d.target === "__pool" ? null : d.target);
      /* Là où la puce paraît : sa zone, ou le vivier (ses puces s'il est
         ouvert, l'îlot lui-même s'il est replié). */
      const pid = CSS.escape(d.pid), cible = d.target;
      vol = voler(g, () => cible === "__pool"
        ? document.querySelector(`#vivier .chip[data-pid="${pid}"]`) ?? document.getElementById("vivier")
        : document.querySelector(`[data-drop="${CSS.escape(cible)}"] .chip[data-pid="${pid}"]`));
    };

    /* Le système interrompt le geste (un appel, une notification, le
       centre de contrôle) : rien n'est posé, aucune fiche ne s'ouvre. Un
       pointercancel était traité comme un relâchement, et la puce se
       posait sur la zone survolée à cet instant (constat U6). */
    const onCancel = () => {
      const d = finir();
      if (!d?.active) return;
      const ilot = d.target === "__pool" && d.chip.dataset.site ? document.getElementById("vivier") : null;
      if (ilot) degonfler(ilot);
      revenir(d);
    };

    const noScroll = (e: Event) => { if (drag.current?.active) e.preventDefault(); };
    const noMenu = (e: Event) => { if (drag.current?.active) e.preventDefault(); };

    /* Une puce activée sans pointeur (Entrée, Espace, lecteur d'écran)
       ouvre sa fiche comme un appui : « Poser sur… », l'alternative au
       glisser, doit rester à portée du clavier (relecture adversariale de
       W5). Le clic qui suit un geste au doigt est ignoré : pointerup a
       déjà ouvert la fiche, ou déposé la puce. */
    const onClick = (e: MouseEvent) => {
      if (performance.now() - finDuGeste < 600) return;
      const chip = (e.target as Element).closest?.<HTMLElement>(".chip");
      if (!chip || !chip.dataset.pid) return;
      latest.current.onTap(chip.dataset.pid, chip.dataset.site || null);
    };

    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("touchmove", noScroll, { passive: false });
    document.addEventListener("contextmenu", noMenu);
    document.addEventListener("click", onClick);

    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", noScroll);
      document.removeEventListener("contextmenu", noMenu);
      document.removeEventListener("click", onClick);
      cancelAnimationFrame(raf.current);
      vol?.finir();
      g.remove();
    };
  }, [scrollRef]);
}
