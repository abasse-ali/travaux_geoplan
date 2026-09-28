/* Le mouvement réduit, pour ce que la règle CSS ne touche pas.

   La règle de mouvement.css ramène les animations et transitions CSS à
   0,01 ms. Les animations jouées par script (Web Animations, GSAP) lui
   échappent : elles demandent ici si l'appareil veut moins de mouvement,
   et ne se jouent pas (ADR-006). La réponse suit le réglage en direct :
   matchMedia est relu à chaque question. */

const requete = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

export const mouvementReduit = (): boolean => !!requete?.matches;
