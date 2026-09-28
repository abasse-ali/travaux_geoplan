/* ============================================================
   La puce d'un compagnon, dessinée une fois (ADR-005) : posée sur un
   chantier (Chantiers.tsx), libre dans le vivier (Island.tsx).

   La classe `chip` reste sur l'élément : c'est la poignée que useDrag.ts
   cherche (closest(".chip"), puis data-pid) au début d'un glisser, et
   que les tests lisent. Pendant le glisser, useDrag pose et retire la
   classe `lifted` hors de React : elle se dessine dans etats.css
   (.chip.lifted), pas en variante [&.lifted]:… — le mot « lifted »
   serait alors dans l'attribut class au repos, là où les tests lisent
   l'état.

   Le pressé s'écrit en `transform`, pas en `scale` : Framer Motion tient
   le `transform` en ligne de la puce, et l'état pressé doit se ranger
   derrière lui comme avant.
   ============================================================ */

import { cibleSerree, cn } from "./primitives/classes";

/* Au doigt : les puces sont à 6 px l'une de l'autre, et 44 px de haut
   doubleraient la hauteur des zones. Chacune s'étend de la moitié de
   l'écart (3 px) : 33 px (WCAG 2.5.8 demande 24). L'élément porte
   data-cible="serree" pour le test L2.

   Une puce se restyle à chaque image quand elle glisse à sa place
   (layout de Framer Motion) : une centaine de fois par changement de
   jour. Sa bordure, son ombre, sa graisse et sa transition s'écrivent
   donc en propriétés directes, au même dessin, et pas avec border,
   shadow-*, font-semibold, transition-* : ces classes-là composent des
   variables déclarées (@property --tw-*), que le navigateur résout à
   chaque restyle (ADR-005, « Le prix d'un restyle » ; gardé par
   tests/classes-chaudes.test.ts). */
const PUCE = cibleSerree["3px"] + " chip flex items-center gap-1.75 rounded-[9px] [border-width:1px] [border-style:solid]"
  + " bg-surface py-1.5 pr-2.25 font-body text-[13px]/none [font-weight:600] touch-none select-none"
  + " will-change-transform [transition:transform_.12s_ease,opacity_.12s_ease]"
  + " active:[transform:scale(.97)]";

/* Pas de variante « en urgence » (liseré fuchsia) ni « soulevée » : aucune
   puce ne les prenait, en W4 déjà (.chip.urg était du CSS mort, porté tel
   quel en W5 ; relecture adversariale). Soulevée, c'est useDrag qui le
   sait, hors de React : .chip.lifted, dans etats.css. */
export const puce = (): string => cn(PUCE, "border-line-2 pl-2.25 [box-shadow:var(--shadow-1)]");

/** Le nom, sur une ligne. */
export const puceNom = "whitespace-nowrap";

/** Le compteur de jours (« 4j »), dans le vivier. */
export const puceJours = "font-mono text-[10.5px]/none font-medium text-muted";
