/* ============================================================
   Le vivier qui se déforme sous une puce (ADR-006)

   Une puce posée qu'on glisse au-dessus du vivier : l'îlot se gonfle un
   peu depuis son coin (il vient au-devant d'elle), tant qu'elle est là ;
   elle repart, ou elle y tombe, il reprend sa forme. Une puce prise dans
   le vivier ne le gonfle pas : elle en vient, et l'y reposer ne change
   rien.

   Web Animations, sur transform : le compositeur le joue. Interrompu
   (la puce entre et sort vite), le mouvement repart à l'envers d'où il
   en est (Animation.reverse). Sous le mouvement réduit, rien : le fond
   orange de .island.over dit déjà que le vivier attend la puce.

   Un écrasement au lâcher (il « avalait » la puce) a été essayé : il
   tombait sur le rendu du dépôt et coûtait 0,6 image par glisser en
   moyenne (journal, W6). Retiré : le fantôme qui vient s'y poser dit
   déjà que le vivier a pris la puce.
   ============================================================ */

import { mouvementReduit } from "./reduit";

const GONFLE = "scale(1.035)";
const gonflements = new WeakMap<Element, Animation>();

/** La puce arrive au-dessus du vivier. */
export function gonfler(ilot: HTMLElement): void {
  if (mouvementReduit()) return;
  const a = gonflements.get(ilot);
  if (a && a.playbackRate < 0) { a.reverse(); return; }      // il se dégonflait : il repart
  if (a) return;
  const b = ilot.animate([{ transform: "none" }, { transform: GONFLE }],
    { duration: 200, easing: "cubic-bezier(.34,1.3,.64,1)", fill: "forwards" });
  gonflements.set(ilot, b);
}

/** La puce repart, ou s'y pose : il reprend sa forme. */
export function degonfler(ilot: HTMLElement): void {
  const a = gonflements.get(ilot);
  if (!a || a.playbackRate < 0) return;
  a.reverse();
  a.onfinish = () => { if (a.playbackRate < 0) { a.cancel(); gonflements.delete(ilot); } };
}
