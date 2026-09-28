/* ============================================================
   Les classes communes, écrites une fois (ADR-005).

   Pas de tailwind-merge : une variante ne s'obtient pas en ajoutant
   une classe qui en contredit une autre (l'ordre de la feuille, pas
   celui de l'attribut, déciderait), mais en demandant la variante. Ce
   qu'on ajoute à côté (flex-1, marges) ne doit rien contredire.
   ============================================================ */

/** Joint des classes, en sautant les absentes. */
export const cn = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(" ");

/* ---------- cibles au doigt ---------- */

/* Au moins 44 × 44 px au doigt (Apple ; WCAG 2.5.5), sans rien changer
   au dessin : un pseudo-élément invisible prolonge la cible jusqu'à 44 px
   dans chaque sens où elle est plus petite — un toucher sur lui arrive à
   la cible. Pour une cible dont aucune voisine interactive n'est à moins
   de 44 px de centre à centre (sinon cibleSerree, ou cibleRangee pour une
   rangée qui se partage la largeur). L'élément devient `relative` ; pas
   sur un élément qui rogne (overflow-hidden), qui rognerait sa zone. La
   zone passe sous le contenu de la cible (isolate, -z-10) : elle se
   touche autour, et ce que la cible contient reste au-dessus d'elle. */
export const cible = "relative isolate after:absolute after:-z-10 after:content-[''] after:inset-[min(0px,calc((100%-44px)/2))]";

/* Dans une grappe serrée (puces, cases de la grille, niveaux…), 44 px
   sont impossibles sans agrandir le dessin : la cible s'étend de la
   moitié de l'écart qui la sépare de ses voisines, pas plus, et aucune
   ne mord sur l'autre. Chacune garde au moins 24 px (WCAG 2.5.8, AA). Le
   test L2 (e2e/accessibilite.spec.ts) les reconnaît à data-cible="serree". */
export const cibleSerree = {
  "1.5px": "relative isolate after:absolute after:-z-10 after:content-[''] after:-inset-[1.5px]",
  "2px": "relative isolate after:absolute after:-z-10 after:content-[''] after:-inset-[2px]",
  "3px": "relative isolate after:absolute after:-z-10 after:content-[''] after:-inset-[3px]"
} as const;

/* Une rangée de cibles qui se partagent la largeur (les sept jours) : 44 px
   de haut, mais en largeur la moitié de l'écart avec la voisine, pas plus.
   Sur un iPhone 15, chaque jour fait plus de 44 px de large ; à 320 px, il
   n'en fait plus que 41 à 43, et une zone de 44 mordait sur le jour d'à
   côté (relecture adversariale de W5). Marquées data-cible="serree". */
export const cibleRangee = {
  "1.5px": "relative isolate after:absolute after:-z-10 after:content-[''] after:-inset-x-[1.5px] after:inset-y-[min(0px,calc((100%-44px)/2))]",
  "2px": "relative isolate after:absolute after:-z-10 after:content-[''] after:-inset-x-[2px] after:inset-y-[min(0px,calc((100%-44px)/2))]"
} as const;

/* Le contour du focus clavier (base.css : 2 px d'orange, à 2 px du bord),
   dessiné à l'intérieur de la cible. Pour une cible qui remplit un
   conteneur qui rogne (la liste des missions, animée en hauteur ; une
   carte ; l'îlot) ou qui touche le bord de l'écran (les onglets du bas) :
   dehors, le contour était coupé sur deux côtés ou plus, voire tout
   entier (« Ouvrir le vivier » ; relecture adversariale de W5, test L3).
   Jamais sur un fond orange, où un contour orange intérieur disparaîtrait. */
export const anneauDedans = "focus-visible:outline-offset-[-2px]";

/* ---------- bouton ---------- */

const BOUTON = cible + " inline-flex items-center justify-center gap-1.75 border font-body font-semibold leading-none"
  + " no-underline active:translate-y-px disabled:opacity-50";

const TEINTES = {
  neutre: "bg-surface-2 border-line-2 text-ink",
  primaire: "bg-accent border-transparent text-on-accent",
  bleu: "bg-blue border-transparent text-on-blue",
  danger: "bg-transparent border-urgence/40 text-urgence-texte"
} as const;

const TAILLES = {
  normal: "px-3.5 py-2.5 rounded-[10px] text-[14px]",
  petit: "px-2.75 py-1.75 rounded-[9px] text-[12.5px]",
  /* dans un groupe de boutons (.seg) : chacun sa part de la ligne */
  segment: "flex-1 px-1 py-2.25 rounded-[10px] text-[13px]"
} as const;

export interface BoutonOptions {
  teinte?: keyof typeof TEINTES;
  taille?: keyof typeof TAILLES;
  large?: boolean;
}

export const bouton = ({ teinte = "neutre", taille = "normal", large = false }: BoutonOptions = {}): string =>
  cn(BOUTON, TEINTES[teinte], TAILLES[taille], large && "w-full");

/** Le bouton carré de la barre du haut et des feuilles (×, +). */
export const boutonIcone = (primaire = false): string =>
  cn(cible, "grid size-8.5 flex-none place-items-center rounded-[10px] border font-body text-[20px]/none font-semibold",
    primaire ? "bg-accent border-transparent text-on-accent" : "bg-surface-2 border-line-2 text-ink-2");

/* ---------- textes ---------- */

/** Le surtitre : petites capitales espacées, en gris. */
export const surtitre = "font-display text-[10.5px]/none font-semibold tracking-[.11em] uppercase text-muted";

/** Une aide sous un champ ou un titre. */
export const indice = "text-[11.5px]/[1.45] text-muted";

/** « Rien ici » dans une liste. */
export const indiceVide = "px-0.5 py-1.5 text-[12px]/[1.5] text-muted";

/* ---------- surfaces ---------- */

export const carte = "bg-surface border border-line rounded-carte shadow-carte";

/** Une pile verticale : cartes d'un écran, blocs d'une feuille. */
export const pile = "flex flex-col gap-2.75";
