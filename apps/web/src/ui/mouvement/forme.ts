/* ============================================================
   Une forme qui change de taille, jouée par le navigateur (ADR-006)

   Le principe de Flip, en Web Animations : noter la taille d'un élément
   avant le changement (`noterForme`), laisser React dessiner la
   nouvelle, puis aller de l'une à l'autre (`jouerForme`). `auto` reste
   `auto` : on ne pose rien en ligne, l'animation s'efface à sa fin.

   Interrompu en chemin (un second appui), l'élément repart de la taille
   où il en est : on la note pendant que l'animation court, on arrête
   celle-ci, puis on repart de là. Seule notre animation est arrêtée,
   pas les transitions CSS de l'élément (son rayon, sa couleur).

   L'horloge est celle du document : le filet, qui fige Date.now
   (page.clock.setFixedTime), ne la fige pas.
   ============================================================ */

import { mouvementReduit } from "./reduit";

export interface Forme { l: number; h: number }

const enCours = new WeakMap<Element, Animation>();

export const noterForme = (el: Element): Forme => {
  const r = el.getBoundingClientRect();
  return { l: r.width, h: r.height };
};

export function jouerForme(el: HTMLElement, avant: Forme,
  { duree = 400, courbe = "cubic-bezier(.215,.61,.355,1)" }: { duree?: number; courbe?: string } = {}): void {
  enCours.get(el)?.cancel();
  enCours.delete(el);
  if (mouvementReduit()) return;
  const apres = noterForme(el);
  if (Math.abs(apres.l - avant.l) < 0.5 && Math.abs(apres.h - avant.h) < 0.5) return;
  const a = el.animate(
    [{ width: avant.l + "px", height: avant.h + "px" }, { width: apres.l + "px", height: apres.h + "px" }],
    { duration: duree, easing: courbe });
  enCours.set(el, a);
  a.onfinish = () => { if (enCours.get(el) === a) enCours.delete(el); };
}
