/* La marque de l'application : les douze barres d'étapes réduites à
   trois, la première en orange de traçage comme l'étape en cours.
   Même dessin que l'icône de l'écran d'accueil (tools/make-icons.js) —
   changer l'un sans l'autre les ferait diverger. */

export const MARK =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="4" y="6" width="16" height="3.2" rx="1.6" fill="var(--accent)"/>' +
    '<rect x="4" y="10.9" width="11.5" height="3.2" rx="1.6" fill="currentColor"/>' +
    '<rect x="4" y="15.8" width="7" height="3.2" rx="1.6" fill="currentColor"/>' +
  "</svg>";

export const markHTML = (cls) => '<div class="mark' + (cls ? " " + cls : "") + '">' + MARK + "</div>";
