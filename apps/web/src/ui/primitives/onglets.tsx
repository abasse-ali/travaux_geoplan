/* ============================================================
   Les onglets — le Tabs de shadcn/ui (Radix) : role="tablist", "tab"
   et "tabpanel" reliés entre eux ; les flèches du clavier passent
   d'un onglet à l'autre (focus itinérant, activation automatique),
   Début et Fin vont aux extrémités, Entrée et Espace choisissent.

   Deux dessins, demandés comme ceux d'un bouton (pas de
   tailwind-merge) : la barre d'onglets du bas (« barre ») et la bande
   des jours (« jours »). Ce qui dépend de l'onglet lui-même (le jour
   d'aujourd'hui, le week-end, le trait qui coulisse) est ajouté par
   l'écran, sans rien contredire ici.

   Écarts voulus avec shadcn/ui :
   • Le panneau ne prend pas le focus (Radix lui donne tabIndex=0) : il
     contient toujours des boutons, et un appui sur une zone vide lui
     donnait le focus — qu'un Échap rendait ensuite visible, cadre
     orange autour de tout l'écran.
   • Radix choisit un onglet à l'appui (mousedown), plus au relâché :
     au doigt, l'iPhone envoie l'un juste avant l'autre, après le
     toucher ; rien ne change sous le doigt.
   ============================================================ */

import * as Radix from "@radix-ui/react-tabs";
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { anneauDedans, cibleRangee, cn } from "./classes";

type Variante = "barre" | "jours";

const LISTE: Record<Variante, string> = {
  barre: "flex flex-none border-t border-line bg-surface"
    + " min-h-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)]",
  jours: "relative flex flex-none gap-0.75 border-b border-line bg-surface-2 px-2 pt-0 pb-2"
};

/* L'onglet choisi : aria-selected, que Radix tient à jour. Le rétrécissement
   à l'appui se passe du mouvement réduit. */
const ONGLET: Record<Variante, string> = {
  barre: anneauDedans + " relative flex flex-1 flex-col items-center gap-1 px-1 py-2.25"
    + " font-display text-[9.5px]/none font-semibold tracking-[.07em] uppercase text-muted"
    + " [transition:color_.18s_ease,transform_.12s_ease] motion-safe:active:[transform:scale(.94)]"
    + " aria-selected:text-accent-texte"
    + " [&_svg]:size-5.25 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.7]"
    + " [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]",
  /* Le fond et le bord d'un jour dépendent du jour (aujourd'hui, week-end) :
     l'écran les donne. Le jour choisi n'en a plus — une pastille unique
     coulisse dessous. */
  jours: cibleRangee["1.5px"] + " group flex min-w-0 flex-1 flex-col items-center gap-0.75 rounded-[9px] border px-0.5 pt-1.5 pb-1.75"
    + " [transition:transform_.12s_ease,border-color_.16s] motion-safe:active:[transform:scale(.93)]"
    + " aria-selected:border-transparent aria-selected:bg-transparent"
};

/** La racine : tient l'onglet choisi (`value`, `onValueChange`). */
export const Onglets = Radix.Root;

export const ListeOnglets = forwardRef<
  ComponentRef<typeof Radix.List>,
  ComponentPropsWithoutRef<typeof Radix.List> & { variante?: Variante }
>(function ListeOnglets({ variante = "barre", className, ...props }, ref){
  return <Radix.List ref={ref} className={cn(LISTE[variante], className)} {...props} />;
});

export const Onglet = forwardRef<
  ComponentRef<typeof Radix.Trigger>,
  ComponentPropsWithoutRef<typeof Radix.Trigger> & { variante?: Variante }
>(function Onglet({ variante = "barre", className, ...props }, ref){
  return <Radix.Trigger ref={ref} className={cn(ONGLET[variante], className)}
    data-cible={variante === "jours" ? "serree" : undefined} {...props} />;
});

export const PanneauOnglet = forwardRef<
  ComponentRef<typeof Radix.Content>,
  ComponentPropsWithoutRef<typeof Radix.Content>
>(function PanneauOnglet(props, ref){
  return <Radix.Content ref={ref} tabIndex={undefined} {...props} />;
});
