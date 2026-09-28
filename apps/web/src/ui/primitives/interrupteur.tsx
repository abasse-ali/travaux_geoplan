/* ============================================================
   L'interrupteur — le Switch de shadcn/ui (Radix) : un bouton
   role="switch", aria-checked, Espace et Entrée, focus visible.
   Remplace une case à cocher cachée, que le clavier atteignait sans
   que rien ne se voie.

   Deux dessins, demandés comme ceux d'un bouton : « urgence », dans la
   tête du vivier (petites capitales, fuchsia une fois actif) ; et
   « réglage », une ligne entière d'une feuille (le libellé à gauche,
   l'interrupteur à droite, l'orange de l'application une fois actif).
   ============================================================ */

import * as Radix from "@radix-ui/react-switch";
import type { ReactNode } from "react";

type Variante = "urgence" | "reglage";

/* Tout le libellé se touche. Urgence : il s'étend de 10 px en haut et
   en bas, 40 px au doigt, autant que la tête du vivier le permet.
   Réglage : une ligne de 44 px. */
const LIBELLE: Record<Variante, string> = {
  urgence: "relative isolate inline-flex items-center gap-1.5 font-display text-[10px]/none font-semibold tracking-[.09em] uppercase text-muted after:absolute after:-z-10 after:inset-x-0 after:-inset-y-[10px] after:content-['']",
  reglage: "flex min-h-11 w-full flex-row-reverse items-center justify-between gap-3 font-body text-[14px]/[1.3] text-ink-2"
};
const INTERRUPTEUR: Record<Variante, string> = {
  urgence: "relative h-5 w-8.5 rounded-full border border-line-champ bg-surface-3 transition-[background] duration-[.16s] ease-[ease] data-[state=checked]:border-transparent data-[state=checked]:bg-urgence",
  reglage: "relative h-5 w-8.5 flex-none rounded-full border border-line-champ bg-surface-3 transition-[background] duration-[.16s] ease-[ease] data-[state=checked]:border-transparent data-[state=checked]:bg-accent"
};

export function Interrupteur({ checked, onCheckedChange, children, variante = "urgence" }: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  children: ReactNode;                     // le libellé, qui nomme l'interrupteur
  variante?: Variante;
}){
  return (
    <label className={LIBELLE[variante]}>
      <Radix.Root checked={checked} onCheckedChange={onCheckedChange} data-cible={variante === "urgence" ? "serree" : undefined}
        className={INTERRUPTEUR[variante]}>
        <Radix.Thumb className="absolute top-0.5 left-0.5 block size-3.5 rounded-full bg-surface shadow-carte transition-transform duration-[.16s] ease-[ease] data-[state=checked]:translate-x-3.5" />
      </Radix.Root>
      <span className={variante === "urgence" && checked ? "text-urgence-texte" : undefined}>{children}</span>
    </label>
  );
}
