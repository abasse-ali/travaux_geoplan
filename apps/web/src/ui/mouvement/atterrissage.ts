/* ============================================================
   Le lâcher d'une puce (ADR-006)

   Au relâché, le fantôme ne disparaît plus d'un coup. Il va se poser là
   où la puce paraît (dans sa zone, dans le vivier), ou revient à la puce
   qu'on a soulevée quand rien n'est posé (lâchée hors de toute cible,
   geste interrompu). Le compositeur joue le vol (Web Animations :
   translation, rotation, échelle, opacité). La puce d'arrivée reste
   invisible pendant le vol (.chip.atterrit, etats.css) : c'est le
   fantôme qui devient elle.

   La puce d'arrivée n'existe qu'après le rendu qui suit le dépôt : on
   la cherche à l'image suivante, trois fois au plus ; introuvable, le
   fantôme s'efface sur place, comme avant. Sous le mouvement réduit,
   rien ne vole.
   ============================================================ */

import { mouvementReduit } from "./reduit";

const DUREE = 240;
const COURBE = "cubic-bezier(.2,.8,.3,1)";

export interface Vol {
  /** Arrête le vol où il en est et range tout (un nouveau glisser commence). */
  finir(): void;
}

/** Fait voler le fantôme `g` jusqu'à ce que `trouver` désigne, puis le
    cache et appelle `apres`. */
export function voler(g: HTMLElement, trouver: () => Element | null, apres: () => void = () => {}): Vol {
  let fini = false, essais = 0, attente = 0;
  let anim: Animation | null = null, cible: Element | null = null;
  const finir = () => {
    if (fini) return;
    fini = true;
    cancelAnimationFrame(attente);
    anim?.cancel();
    g.hidden = true;
    cible?.classList.remove("atterrit");
    apres();
  };
  if (mouvementReduit()) { finir(); return { finir }; }

  const partir = () => {
    const c = trouver();
    cible = c && c.isConnected ? c : null;
    if (!cible && ++essais < 3) { attente = requestAnimationFrame(partir); return; }
    const a = g.getBoundingClientRect();
    if (!cible || !a.width) { finir(); return; }
    const b = cible.getBoundingClientRect();
    const puce = cible.classList.contains("chip");
    /* Une puce : le fantôme prend sa taille. Le vivier replié : il s'y
       engouffre en rapetissant. */
    const echelle = puce ? Math.min(1.2, Math.max(0.5, b.width / a.width)) : 0.4;
    const dx = b.x + b.width / 2 - (a.x + a.width / 2), dy = b.y + b.height / 2 - (a.y + a.height / 2);
    if (puce && !cible.classList.contains("lifted")) cible.classList.add("atterrit");
    const arrivee = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(0deg) scale(${echelle})`;
    anim = g.animate([
      { transform: "translate(-50%, -50%) rotate(-2deg)", opacity: 1 },
      { transform: arrivee, opacity: 1, offset: 0.8 },
      { transform: arrivee, opacity: 0 }
    ], { duration: DUREE, easing: COURBE });
    anim.onfinish = finir;
  };
  attente = requestAnimationFrame(partir);
  return { finir };
}
