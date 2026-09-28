# ADR-006 — Le mouvement : CSS et Web Animations, sans bibliothèque

**Statut** : proposé (W6 l'implémente ; les mesures du journal le fondent) · **Date** : 2026-09-28

## Contexte

À la fin de W5, le mouvement de Geoplan tient dans trois mécanismes :

- **Framer Motion** (11.15), dans l'application et dans la page compagnon : vingt-trois usages. Des animations de mise en page (`layout`, `layoutId` : les puces, l'îlot du vivier, les lignes de l'équipe, le trait sous l'onglet), des entrées et sorties (`AnimatePresence` : fiches, puces, toasts, volets, libellé de la semaine, « Auj. », écran de connexion), des ressorts sur une valeur (la pastille du jour, la coche d'une mission).
- **Le CSS** : six animations nommées (`mouvement.css`) et quelques transitions (barres d'étape, puce pressée, onglets).
- **vaul**, pour la feuille du bas (son animation CSS).

L'inventaire a trouvé quatre éléments animés deux fois, en CSS et par Framer, sur les mêmes propriétés : les initiales de la grille Semaine, les puces du vivier, la coche d'une mission, le toast. Et la puce garde une transition CSS sur `transform`, que chaque écriture de `layout` relance (W5 : une centaine de restyles par changement de jour).

La mission prévoyait GSAP « là où il excelle » : les séquences (« Répartir toute l'équipe »), la physique du lâcher, la déformation du vivier.

Le poids (gzip -9, mesuré) :

| | gzip |
|---|---|
| Framer Motion (`motion`, `AnimatePresence`, `MotionConfig`) | 37,5 ko |
| GSAP (cœur) | 27,0 ko |
| GSAP + Flip | 35,6 ko |
| GSAP + Flip + Inertia | 38,3 ko |

Framer Motion est dans le paquet principal (147,5 ko) et dans la page compagnon (97,3 ko), où il pèse près de 40 % pour une coche, un appui et un message.

## Décision

### Le navigateur joue le mouvement

| Usage | Qui | Pourquoi |
|---|---|---|
| Entrées (une puce, un toast, une fiche, un libellé qui glisse, un fondu d'écran) | CSS (`@keyframes`, `mouvement.css`) | le compositeur les joue, même quand React travaille ; rien à charger ; Playwright les termine pour les captures |
| Une valeur qui suit un état (la pastille du jour, une coche, une barre) | transition CSS | idem ; plus de mesure de mise en page |
| Un changement de forme ou de place, au geste (l'îlot du vivier, le trait sous l'onglet, un volet qui se déplie) | Web Animations (`element.animate`), par le principe de Flip : noter avant, laisser React dessiner, aller de l'un à l'autre (`ui/mouvement/forme.ts`, `ui/mouvement/repli.tsx`) | aucun script à chaque image ; interrompu en chemin, il repart d'où il en est |
| Séquences, lâcher d'une puce, déformation du vivier | Web Animations, avec des délais et des images clés | même raison, mesurée ci-dessous |
| Retour d'appui (puce, bouton) | `:active` en CSS | déjà là |
| La feuille du bas | vaul (CSS) | inchangé |

**Framer Motion est retiré** : il ne lui reste aucun usage que le navigateur ne tienne mieux, et ses 37,5 ko quittent les deux pages. La page compagnon n'a que du CSS (principe 7).

### Pourquoi pas GSAP

Il a été essayé, là où la mission l'attendait : la forme du vivier par GSAP Flip (chargé à la demande, 36,6 ko gzip, hors du paquet principal), contre la même forme en Web Animations, même durée, même courbe. Images perdues par ouverture ou fermeture du vivier, 50 gestes par version, alternés, Chromium bridé ×4 : **GSAP 1,86, Web Animations 0,44** (journal, W6). GSAP calcule chaque image en script, comme Framer ; le navigateur, non. Les deux autres usages prévus (la séquence de « Répartir », le lâcher) ne font que translater et estomper : le compositeur les joue sans script du tout.

Et son horloge est `Date.now` : le filet la fige (`page.clock.setFixedTime`, pour que « aujourd'hui » soit toujours le même jour). Toute animation GSAP y resterait à sa première image ; l'îlot garderait la forme d'avant, écrite en ligne. Web Animations suit l'horloge du document.

C'est un écart avec la pile cible (`prompt.md` : « Tailwind, shadcn/ui, GSAP ») : question au propriétaire (journal). Reprendre GSAP plus tard ne coûterait qu'un module : le mouvement passe déjà par `ui/mouvement/`.

### Sorties

Une sortie n'est animée que si elle dit quelque chose : un toast qui s'éteint, un volet qui se referme, le visage du vivier qui cède la place. Une puce qui quitte une zone ne s'efface pas : le fantôme, qui porte le geste, suffit. Un changement de jour ou de semaine remplace le contenu d'un coup ; la pastille qui coulisse et le libellé qui glisse disent le sens. Ce qui arrive après le premier affichage entre en mouvement ; ce qui était là d'emblée, non (comme `AnimatePresence initial={false}`), décidé à la naissance de l'élément pour que l'animation ne se rejoue pas.

### Le mouvement réduit

`prefers-reduced-motion` coupe tout le décoratif :

- le CSS, par la règle de `mouvement.css` (durées ramenées à 0,01 ms) ;
- Web Animations, qui échappe à cette règle : le code demande lui-même (`ui/mouvement/reduit.ts`) et pose l'état final d'un coup ;
- vaul, par la même règle CSS (test K3).

Ce qui porte une information reste : l'état final, jamais le chemin.

### Le son et le toucher

Un retour sonore discret (Web Audio, synthétisé : aucun fichier) pour poser et retirer une puce, désactivable, **désactivé par défaut**. Le retour haptique (`navigator.vibrate`) reste là où il existe.

### Three.js

Seulement pour un usage réel, chargé à la demande, jamais dans `dispo`. Le journal dit s'il en existe un.

### Mesurer

Chaque animation ajoutée, retirée ou déplacée d'un mécanisme à l'autre a sa mesure A/B d'images perdues dans le journal (`npm run images-perdues`, 50 gestes au moins par version, alternés, Chromium bridé ×4), sur le geste qui la déclenche. L'outil connaît neuf gestes : jour, onglet, cocher, glisser, vivier, semaine, feuille, déplier, répartir.

## Conséquences

- Les deux pages s'allègent de Framer Motion, et rien ne le remplace dans le paquet.
- Plus d'animations de mise en page implicites : une puce ne glisse plus à sa place à chaque rendu, le vivier ne réinterpole plus sa taille quand son contenu change. Là où un changement de forme a un sens (le vivier qu'on ouvre), il est joué explicitement, au moment du geste.
- Les tests ne dépendent plus des sorties de Framer (`AnimatePresence`) ni d'une horloge de script : une liste repliée disparaît quand sa sortie est jouée, par l'horloge du document.
