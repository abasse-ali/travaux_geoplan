/* Ce qui arrive après le premier affichage d'une liste (un jour choisi,
   un dépôt, une fiche ajoutée) entre en mouvement ; ce qui était là
   d'emblée, non — comme AnimatePresence initial={false} avant W6.
   Décidé à la naissance de l'élément, une fois : sa classe ne change
   plus tant qu'il vit, et son animation CSS ne se rejoue pas (ADR-006,
   « Sorties »). */

import { useState } from "react";

export const useEntree = (entre: boolean): boolean => useState(entre)[0];
