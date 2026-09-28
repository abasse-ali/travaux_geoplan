/* La marque : les douze barres d'étapes réduites à trois, la première
   en orange de traçage comme l'étape en cours. Même dessin, et même
   orange (--marque), que l'icône de l'écran d'accueil. Trois tailles :
   la barre du haut, les pages (compagnon, erreurs), l'écran de
   connexion.

   Un module à part : la page compagnon l'importe seul, sans le reste
   des briques d'interface (qui tirent vaul et Radix). */

import { cn } from "./primitives/classes";

const MARQUE = {
  barre: "size-7.75 rounded-[8px] [&>svg]:size-5.25",
  page: "mb-4 size-10.5 rounded-[11px] [&>svg]:size-7",
  accueil: "mb-4.5 size-11.5 rounded-[12px] [&>svg]:size-7.5"
} as const;

export function Mark({ taille = "barre" }: { taille?: keyof typeof MARQUE }){
  return (
    <div className={cn("grid flex-none place-items-center bg-blue text-on-blue", MARQUE[taille])}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="block">
        <rect x="4" y="6" width="16" height="3.2" rx="1.6" fill="var(--marque)" />
        <rect x="4" y="10.9" width="11.5" height="3.2" rx="1.6" fill="currentColor" />
        <rect x="4" y="15.8" width="7" height="3.2" rx="1.6" fill="currentColor" />
      </svg>
    </div>
  );
}
