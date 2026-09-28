/* ============================================================
   Un contenu qui se déplie et se replie en hauteur (ADR-006).

   Remplace AnimatePresence et `height: auto` de Framer Motion pour les
   volets (« Les 12 étapes », la note, les jours de « Répartir ») et les
   missions d'une étape. Le navigateur joue la hauteur (Web Animations) :
   plus de script à chaque image.

   • Ouvert au premier affichage : posé tel quel, sans animation (comme
     `initial={false}`).
   • Il s'ouvre : monté aussitôt, il grandit de 0 à sa hauteur.
   • Il se replie : il garde le contenu qu'il montrait, rétrécit jusqu'à
     0, puis disparaît du DOM. Rouvert en chemin, il repart de la
     hauteur où il en était.
   • Mouvement réduit : ni l'un ni l'autre, l'état final d'un coup.
   ============================================================ */

import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { mouvementReduit } from "./reduit";

const DUREE = 260;
const COURBE = "cubic-bezier(.22,.9,.3,1)";

/* Rogné, mais pas défilable. Avec overflow: hidden, le volet est une
   zone de défilement : un élément qu'on y fait paraître pendant qu'il
   s'ouvre (le focus, scrollIntoView) le fait défiler sur lui-même, puis
   le contenu redescend image après image à mesure qu'il grandit — sous
   le doigt (constat U26). overflow: clip rogne pareil, sans défilement ;
   Safari le connaît depuis la version 16, hidden reste pour les autres.
   Mais clip, lui, ne contient pas les marges de son contenu : celles de
   la liste des missions traversaient le volet, et la ligne sautait de
   8 px à la fin d'un repli (relecture adversariale). display: flow-root
   les contient, comme le faisait hidden. */
const ROGNE = typeof CSS !== "undefined" && CSS.supports?.("overflow", "clip") ? "clip" : "hidden";

export function Repli({ ouvert, children, style, ...attributs }: {
  ouvert: boolean;
  children?: ReactNode;
} & HTMLAttributes<HTMLDivElement>){
  const [monte, setMonte] = useState(ouvert);
  if (ouvert && !monte) setMonte(true);
  /* Ce qu'il montrait ouvert : pendant qu'il se replie, le parent ne
     lui donne souvent plus rien (`open && …`). */
  const montre = useRef(children);
  if (ouvert) montre.current = children;

  const el = useRef<HTMLDivElement | null>(null);
  /* L'état déjà joué : l'effet ne joue que ce qui change. Un drapeau de
     premier rendu ne suffisait pas : en développement, StrictMode rejoue
     l'effet au montage, et un volet monté ouvert s'animait de sa hauteur
     à sa hauteur (relecture adversariale). */
  const joue = useRef(ouvert);
  /* Monté avant ce rendu : il repart de la hauteur où il en est ; monté
     à l'instant, il part de 0. */
  const etaitMonte = useRef(ouvert);
  useLayoutEffect(() => {
    if (joue.current === ouvert) return;
    joue.current = ouvert;
    const n = el.current;
    if (!n) return;
    const depuis = etaitMonte.current ? n.getBoundingClientRect().height : 0;
    etaitMonte.current = true;
    for (const a of n.getAnimations()) a.cancel();
    const fin = () => { etaitMonte.current = false; setMonte(false); };
    if (mouvementReduit()) { if (!ouvert) fin(); return; }
    const plein = n.scrollHeight;
    /* Replié, il garde sa fin (fill) jusqu'à quitter le DOM : sans elle, la
       hauteur revenait à « auto » le temps que React le retire, et le
       contenu entier reparaissait une image (relecture adversariale). */
    const anim = n.animate(
      ouvert
        ? [{ height: depuis + "px", opacity: depuis ? 1 : 0 }, { height: plein + "px", opacity: 1 }]
        : [{ height: depuis + "px", opacity: 1 }, { height: "0px", opacity: 0 }],
      { duration: DUREE, easing: COURBE, fill: ouvert ? "none" : "forwards" });
    if (!ouvert) anim.onfinish = fin;
  }, [ouvert]);

  if (!monte) return null;
  return (
    <div ref={el} style={{ ...style, overflow: ROGNE, display: "flow-root" }} {...attributs}>
      {ouvert ? children : montre.current}
    </div>
  );
}
