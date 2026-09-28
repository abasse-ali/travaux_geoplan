/* ============================================================
   Du texte mis en forme, sans HTML injecté (constat U8)

   Les toasts mettent un nom ou un code en gras. Avant W4, la chaîne
   entière était injectée telle quelle : un compagnon nommé « <img
   onerror=…> » exécutait du code. Ici, seul le gabarit écrit dans le
   code source est du HTML ; tout ce qui y est interpolé est échappé.

     toast(html`${p.name} sur <b>${site.code}</b>`)

   Le type `Balise` ne se fabrique que par `html` : une chaîne ordinaire
   ne peut pas être passée à un toast par erreur.
   ============================================================ */

declare const marque: unique symbol;
export interface Balise { readonly [marque]: true; readonly __html: string }

const ENTITES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
export const echapper = (v: unknown): string => String(v).replace(/[&<>"']/g, c => ENTITES[c]!);

export function html(bouts: TemplateStringsArray, ...valeurs: unknown[]): Balise {
  let s = bouts[0]!;
  valeurs.forEach((v, i) => { s += echapper(v) + bouts[i + 1]; });
  return { __html: s } as Balise;
}
