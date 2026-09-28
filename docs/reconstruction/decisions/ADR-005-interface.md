# ADR-005 — L'interface : Tailwind, jetons, primitives shadcn/ui

**Statut** : accepté (W5 l'implémente) · **Date** : 2026-09-26 · Le mouvement qu'il cite (Framer Motion, `ui/ressorts.ts`, `MotionConfig`) est remplacé en W6 : voir l'ADR-006.

## Contexte

L'interface tient dans une feuille de 820 lignes (`apps/web/src/styles.css`) et des classes écrites à la main. Rien ne relie les couleurs, les rayons et les ombres entre eux ; des règles sont en double, d'autres ne servent plus. W5 doit passer à Tailwind et à shadcn/ui sans que Geoffrey voie autre chose que des corrections annoncées, et sans alourdir la page compagnon.

## Décision

### Une source pour les jetons

`src/jetons.css` tient les valeurs : couleurs de l'interface, teintes des métiers, ombres, rayon des cartes, ressort, polices, en clair puis en sombre (`prefers-color-scheme`). Le thème Tailwind (`@theme inline`) ne fait que les nommer pour les classes : `bg-surface`, `text-ink`, `border-line`, `font-display`, `shadow-carte`, `rounded-carte`, `ease-ressort`, `h-tabbar`.

- Les palettes, polices, ombres et animations par défaut de Tailwind sont retirées : une couleur hors palette ne s'écrit pas par mégarde, et l'AA se vérifie sur une liste finie de couples.
- Les teintes des métiers (`--t-*`) ne sont pas des classes : le domaine dit quelle teinte va à quel métier (`skColor`, `phaseColor`) et le composant la reçoit par `style` (`style={{ "--c": skColor(k) }}`, puis `bg-(--c)`).
- Les espacements restent ceux de Tailwind (pas de 4 px ; un quart de pas vaut 1 px : `p-2.25` = 9 px). Les tailles de texte, réglées une à une par le dessin d'origine (une quarantaine de valeurs), s'écrivent telles quelles (`text-[11.5px]/none`) : les ramener à une échelle changerait chaque écran pour rien.
- `data-theme` disparaît : rien ne le posait. Le sombre suit le téléphone.

### Des couches, et une migration qui ne se voit pas

Pendant la migration, `app.css` ordonnait `theme, base, legacy, utilities` : l'ancienne feuille, importée dans `legacy`, perdait contre les classes de Tailwind quelle que soit la spécificité, un écran passait aux classes sans combat de sélecteurs, et `legacy` rétrécissait écran par écran. Elle a disparu à la fin de W5. Restent deux petites feuilles, justifiées :

- `mouvement.css` : les six animations nommées, que les classes citent (une animation nommée s'écrit mal en classe), et la règle du mouvement réduit ;
- `etats.css` (couche `etats`, avant les classes) : ce que `useDrag` pose en classes hors de React pendant un glisser — zone survolée, puce soulevée, îlot survolé — et le fond au repos de la zone et de l'îlot, qu'une classe empêcherait de changer. Six classes.

Pas de *preflight* : `base.css` a sa propre remise à zéro, et le *preflight* aurait changé tous les écrans à la fois.

La conversion d'un écran ne change **aucun pixel** : les captures de référence (`e2e/captures.spec.ts`, clair et sombre, 44 depuis la relecture) le prouvent. Les changements voulus (cibles de 44 px, contrastes AA, focus visible, défauts visuels) passent dans des commits à part, chacun avec la liste des captures qu'il change et pourquoi. La comparaison se fait **au pixel près** : la tolérance par défaut de Playwright (0,2 d'écart de couleur par pixel) laissait passer un vrai changement de teinte, et avait caché 22 des 40 images que l'étape d'accessibilité avait changées (relecture adversariale). Le rendu est déterministe.

### Garde-fous

`npm run verifier-css`, après construction :

1. aucune classe de la couche `etats` (pendant la migration, l'ancienne feuille) ne porte le nom d'une classe Tailwind (Tailwind fabrique des classes à partir de tous les mots du code : `className="grid"` recevait `display:grid` par-dessus sa règle — premier cas trouvé, la grille de compétences de l'écran Équipe) ;
2. aucune animation définie deux fois (Tailwind garde son `@keyframes pulse` dès qu'une feuille cite ce nom, hors couche : il écrasait le nôtre) ;
3. aucune classe de la couche `etats` qu'aucune chaîne du code n'écrit (CSS mort) ;
4. aucune classe de Tailwind qu'aucune chaîne du code n'écrit : Tailwind en fabrique aussi à partir des mots des commentaires et des identifiants (`static`, `transition`, `invisible`…), exclus explicitement (`@source not inline`, avec la raison).

Les chaînes, pas les mots : esbuild retire types, JSX et commentaires, l'analyseur de Rollup relève chaque chaîne et chaque morceau de gabarit. Chercher les noms comme des mots laissait passer une classe dont un identifiant portait le nom.

### Le prix d'un restyle

Tailwind v4 écrit beaucoup de ses classes avec des variables : chaque espacement vaut `calc(var(--spacing) * n)`, et la bordure, l'ombre, la graisse, l'interligne, la transition, les filtres et les transformations composent des propriétés déclarées (`@property --tw-*`). Le navigateur les résout à chaque restyle d'un élément. C'est invisible sur un élément qui change une fois ; pas sur ceux qu'une animation restyle à chaque image. Sur un changement de jour, la puce qui glisse à sa place et l'îlot du vivier qui change de taille font à eux deux 80 % des restyles, et W5 y passait un tiers de temps de plus que W4 (mesure : journal, W5).

Deux règles, au même dessin :

1. les valeurs par défaut du thème que citent les classes (espacement, graisses, transition par défaut) sont figées dans les règles (`@theme inline`, `jetons.css`) ;
2. les pièces qu'une animation restyle à chaque image — la puce, l'îlot et ses deux visages, le remplissage des barres d'étape, le fantôme qui suit le doigt, le toast — n'emploient pas les classes qui composent des variables déclarées : leurs bordure, ombre, flou, graisse et transition s'écrivent en propriétés directes (`[border-style:solid]`, `[box-shadow:var(--shadow-1)]`, `[transition:…]`). `tests/classes-chaudes.test.ts` le garde, sur leur rendu. Ailleurs, les classes ordinaires restent : un élément restylé une fois ne paie presque rien.

### Primitives

shadcn/ui n'est pas une dépendance : c'est du code copié, adapté, qui nous appartient (`src/ui/primitives/`). On le prend pour ce que Radix fait mieux que nous — accessibilité, focus, clavier : la feuille du bas (Drawer, vaul), l'interrupteur (Switch), les onglets (Tabs), et les dialogues et menus s'il en faut. **Pas** pour la puce qu'on glisse, les barres d'étapes ni le vivier : ce sont des gestes à nous, réglés au millième de seconde, que W6 mesure.

La feuille du bas garde exactement le dessin d'avant (les captures de ses sept formes sont identiques au pixel) ; ce qui change se sent sans se voir : focus gardé dans la feuille et rendu à la fermeture, reste de la page masqué aux lecteurs d'écran, glisser vers le bas pour fermer, et `prefers-reduced-motion` respecté (animation CSS, test K3). À l'ouverture, le focus va à la feuille elle-même, pas à son premier champ, qui ouvrirait le clavier de l'iPhone : vaul annule le focus automatique de Radix, et sans rien de focalisé dedans, le piège n'avait rien où ramener le focus — Tab sortait vers la page cachée (relecture adversariale, test L3). La garde de 260 ms (le doigt qui relève une puce ne clique pas dans sa fiche) s'écrit en style : Radix écrit `pointer-events` en ligne, par-dessus une classe. Une fiche rouverte pendant que la précédente descend repart de zéro (une clé par ouverture).

**Les feuilles se chargent à la demande** (`ui/Feuilles.tsx`) : vaul, le Dialog de Radix et le code des sept feuilles forment un morceau de 27,9 ko que l'ouverture du planning ne paie pas. Il se charge dès que l'application est au repos, pas à la première feuille : après un déploiement, l'ancien morceau n'existe plus sur le serveur, et hors ligne il pourrait manquer au cache. S'il ne se charge quand même pas, une barrière à lui ferme la fiche demandée et dit de recharger ; le planning reste (test K4). Avec lui dans le paquet principal, `index.html` prenait 26 ko.

**Les onglets de Radix coûtent à chaque rendu** (contextes, références, focus itinérant, effets), là où W4 avait de simples boutons. La coque se redessine à chaque changement des données, pour ses compteurs ; la bande des jours et la barre des onglets sont donc des composants mémorisés (`BandeJours`, `BarreOnglets`), qui ne se redessinent qu'avec le jour, la semaine ou l'onglet. Sans cela, cocher une mission perdait une demi-image de plus qu'en W4 (journal, W5).

**Les toasts** vivent dans une région `aria-live` explicite : un lecteur d'écran les annonce, même quand une feuille modale cache le reste de la page (Radix laisse ces régions audibles).

**La page compagnon n'importe que la marque et les ressorts** (`ui/marque.tsx`, `ui/ressorts.ts`) : importer `bits.tsx` lui faisait charger vaul, qui injecte sa feuille au chargement et ne s'élague donc pas (+23 ko mesurés, au-delà des 10 % du principe 7).

### Les tests suivent les rôles, pas les classes

Les tests de W1 trouvent beaucoup d'éléments par leur classe (`article.card.site`, `.chip`, `.sheet-head p`). Quand une classe disparaît, le test la remplace par un rôle, un nom accessible ou un attribut `data-*` ; ce qu'il vérifie ne change pas. Les lecteurs communs de `e2e/helpers.ts` (carte, zone, puces, jours, onglets, feuille, toasts) n'en dépendent déjà plus. Un état qui n'était qu'une classe (`on`, `bad`, `off`) devient un attribut qui le nomme (`data-etat="pose"`, `data-indispo`).

### La page compagnon

`dispo.css` est sa propre entrée : Tailwind n'y génère que les classes de `dispo.tsx` et de ce qu'elle importe. Elle ne charge ni Radix ni vaul, et n'embarque que ses règles.

### Accessibilité, mesurée

La conversion ne change aucun pixel ; l'accessibilité, si, dans une étape à part dont chaque capture changée est expliquée.

- **Contrastes AA.** Chaque couple texte / fond des jetons passe le seuil (4,5 ; 3 pour ce qui fait voir un contrôle), en clair et en sombre : `npm run contrastes`, lu dans `jetons.css`. Les couleurs de remplissage gardent leur éclat ; le texte coloré passe par des variantes plus foncées en clair (`accent-texte`, `ok-texte`, `warn-texte`, `urgence-texte`), qui tiennent aussi sur leur propre teinte (un badge). L'orange des boutons fonce d'un cran (#E24F17 → #D04915) pour son texte blanc ; le gris `muted` aussi (#787E86 → #62676E). Le logo garde l'orange de W4, celui de l'icône d'écran d'accueil (`--marque`) : un logo n'a pas de seuil à tenir. Les fonds mêlés d'une teinte (`color-mix`) qui portent du texte sont mesurés aussi : cases de la semaine, drapeaux, badges, étape en cours, zone et îlot survolés. Le contour d'un champ, d'une case, d'un interrupteur a son jeton (`line-champ`, 3:1) ; les filets des cartes restent décoratifs. Plus d'estompe par opacité sur un texte lu : un week-end ou un jour indisponible se signalent autrement (gris, barré).
- **Pas seulement la couleur** (WCAG 1.4.1). Un compagnon posé un jour où il s'est déclaré absent : barre creuse dans ses pastilles, trait en tirets et description accessible dans la grille de la semaine.
- **Cibles au doigt.** 44 × 44 px (Apple ; WCAG 2.5.5), sans rien changer au dessin : une zone invisible prolonge la cible (`cible` dans `primitives/classes.ts`), sous son contenu (isolate, -z-10). Là où les voisines sont trop proches pour 44 px sans agrandir le dessin, la cible s'étend de la moitié de l'écart, et garde au moins 24 px (WCAG 2.5.8) ; elle porte `data-cible="serree"` (`cibleSerree`) : les puces (33 px), les cases de la grille Semaine, le titre (28 px) et la barre (24 px) d'une étape, les volets empilés, les cinq niveaux d'une compétence (31 px), « Ses jours dispo » et « Aucun », la tête du vivier. Les sept jours de la bande et du sélecteur de jours ont 44 px de haut, et en largeur la moitié de l'écart (`cibleRangee`) : plus de 44 sur un iPhone 15, 41 à 43 à 320 px, où une zone de 44 mordait sur le jour voisin. Une zone ne crée jamais de geste là où il n'y en avait pas : un simple appui dans la zone de la barre d'une étape, entre elle et la première mission, ne bascule rien (on peut l'y glisser). Agrandir les grappes serrées est une décision de dessin, pas d'accessibilité : elle reste ouverte.
- **Le reste.** Chaque contrôle a un nom, jamais son seul texte d'exemple : le libellé d'un champ nomme sa saisie, ou son groupe ; le focus clavier se voit, dessiné à l'intérieur (`anneauDedans`) là où un conteneur qui rogne ou le bord de l'écran le couperait ; les onglets et les jours se parcourent aux flèches ; les messages passagers et l'échec d'un envoi de la page compagnon sont annoncés ; les ressorts de Framer Motion s'arrêtent quand le téléphone demande moins de mouvement (`MotionConfig reducedMotion="user"`, constat U10). Glisser n'est jamais le seul moyen : une puce se pose depuis sa fiche (« Poser sur… »), qui s'ouvre aussi au clavier, une étape s'avance en cochant ses missions ou au clavier.
- **Vérifié** par `e2e/accessibilite.spec.ts` : L1 (noms, dans chaque écran et chaque feuille, sans compter le texte d'exemple), L2 (chaque cible mesurée au doigt, pixel par pixel depuis son centre, dans chaque écran et chaque feuille, et à 320 px), L3 (le focus se voit, anneau mesuré contre ce qui le rogne ; il reste dans la feuille ouverte ; une puce s'ouvre au clavier).

## Conséquences

- Une couleur, un rayon, une ombre se changent à un endroit.
- Tout le dessin est en classes. Ce qui ne peut pas l'être tient en deux feuilles, rangées et justifiées (`mouvement.css`, `etats.css`).
- Un défaut visuel se corrige dans un commit à part, qui nomme les captures qu'il change.
- Les captures deviennent la référence visuelle de W6 : une animation ajoutée ne doit pas déplacer l'état de repos.
