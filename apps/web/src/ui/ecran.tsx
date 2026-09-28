/* ============================================================
   Les pages d'un seul message : la page compagnon (dispo.tsx : lien
   incomplet, expiré, réponse envoyée…) et les écrans d'erreur de
   l'application (main.tsx : écran en échec, chargement impossible).
   Même mise en page : une colonne de téléphone, la marque, un titre,
   et le message dans un encadré bordé à gauche — de vert, ou de
   fuchsia pour une erreur.

   Un module à part, comme la marque : la page compagnon l'importe sans
   le reste des briques d'interface (principe 7), et dispo.css le lit
   pour générer ses classes.
   ============================================================ */

import type { ReactNode } from "react";
import { cn } from "./primitives/classes";
import { Mark } from "./marque";

/** La page : une colonne centrée, sur le sol, haute comme l'écran
    affiché (100dvh) là où le navigateur connaît cette unité, 100vh sinon. */
export const PAGE = cn("mx-auto flex min-h-screen max-w-[430px] flex-col gap-5 bg-ground",
  "px-5 pt-6.5 pb-[calc(28px+env(safe-area-inset-bottom))] supports-[min-height:100dvh]:min-h-dvh");

/** Le titre de la page. */
export const TITRE = "mx-0 mt-0 mb-1.5 font-display text-[25px]/[1.15] font-bold tracking-[-.02em]";

/** L'encadré du message ; le gras y reprend l'encre pleine. */
export const message = (erreur: boolean): string =>
  cn("rounded-[13px] border-l-3 bg-surface p-4 text-[14.5px]/[1.55] text-ink-2 [&_b]:text-ink",
    erreur ? "border-l-urgence" : "border-l-ok");

/** Une page d'un seul message, centré dans la hauteur. */
export function Ecran({ titre, erreur = false, children }: { titre: string; erreur?: boolean; children: ReactNode }){
  return (
    <main className={PAGE}>
      <div className="flex flex-1 flex-col justify-center gap-3.5">
        <Mark taille="page" />
        <h1 className={TITRE}>{titre}</h1>
        <div data-etat={erreur ? "erreur" : "ok"} className={message(erreur)}>{children}</div>
      </div>
    </main>
  );
}
