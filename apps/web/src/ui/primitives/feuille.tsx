/* ============================================================
   La feuille du bas — le Drawer de shadcn/ui (vaul, et le Dialog de
   Radix dessous) : focus gardé dans la feuille puis rendu à la
   fermeture, Échap, appui hors de la feuille, nom accessible (le
   titre), glisser vers le bas pour fermer.

   Une racine pour toute l'application (FeuilleRacine, dans App) ; chaque
   feuille n'en fournit que le contenu (Feuille). À l'ouverture, le focus
   va à la feuille elle-même, pas à son premier champ : sur l'iPhone, un
   champ focalisé ouvrirait le clavier. vaul annule le focus automatique
   de Radix, et sans rien de focalisé dedans, le piège n'avait rien où
   ramener le focus : Tab sortait vers la page cachée (relecture
   adversariale de W5, test L3).
   ============================================================ */

import { Drawer } from "vaul";
import { useEffect, useState, type ReactNode } from "react";
import { boutonIcone, cn } from "./classes";

export function FeuilleRacine({ ouverte, onFermer, onFermee, children }: {
  ouverte: boolean;
  onFermer: () => void;          // Échap, appui dehors, glisser : on demande la fermeture
  onFermee: () => void;          // la feuille a fini de descendre
  children?: ReactNode;
}){
  return (
    <Drawer.Root open={ouverte} noBodyStyles
      onOpenChange={o => { if (!o) onFermer(); }}
      onAnimationEnd={o => { if (!o) onFermee(); }}>
      {children}
    </Drawer.Root>
  );
}

export interface FeuilleProps {
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
}

export function Feuille({ title, sub, onClose, children }: FeuilleProps){
  /* Le doigt qui vient de relever une puce déclenche un clic juste
     après l'ouverture : on neutralise la feuille le temps d'une frappe.
     En style, pas en classe : Radix écrit pointer-events en ligne sur la
     feuille et son fond, et fusionne le style qu'on lui donne après le
     sien (test K4). */
  const [armee, setArmee] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmee(true), 260); return () => clearTimeout(t); }, []);
  const garde = armee ? undefined : { pointerEvents: "none" as const };

  return (
    <Drawer.Portal>
      <Drawer.Overlay className="fixed inset-0 z-50 bg-[rgba(10,12,15,.44)]" style={garde} />
      {/* Sans sous-titre, pas de description : Radix en réclamerait une. */}
      <Drawer.Content {...(sub ? {} : { "aria-describedby": undefined })} style={garde}
        onOpenAutoFocus={e => { e.preventDefault(); (e.currentTarget as HTMLElement).focus(); }}
        className={cn("fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-[430px] flex-col",
          "max-h-[88vh] supports-[max-height:88dvh]:max-h-[88dvh]",
          "rounded-t-[20px] bg-surface pb-[env(safe-area-inset-bottom)] shadow-feuille outline-none")}>
        <header className="flex flex-none items-center gap-2.5 border-b border-line px-4 pt-4 pb-2.75">
          <div className="flex-1">
            <Drawer.Title className="m-0 flex-1 font-display text-[17px]/[1.2] font-bold tracking-[-.01em]">
              {title}
            </Drawer.Title>
            {sub && <Drawer.Description className="m-0 mt-0.75 text-[12px] text-muted">{sub}</Drawer.Description>}
          </div>
          <button className={boutonIcone()} onClick={onClose} aria-label="Fermer">×</button>
        </header>
        <div className="flex flex-col gap-3.5 overflow-y-auto overscroll-contain px-4 pt-3.5 pb-4.5">{children}</div>
      </Drawer.Content>
    </Drawer.Portal>
  );
}
