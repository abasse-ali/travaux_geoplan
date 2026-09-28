/* Lecture de l'en-tête Cookie. Dix lignes : pas de bibliothèque. Un
   cookie mal formé est ignoré, jamais une raison d'échouer. */
export function lireCookies(entete: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!entete) return out;
  for (const morceau of entete.split(";")) {
    const i = morceau.indexOf("=");
    if (i < 1) continue;
    const nom = morceau.slice(0, i).trim();
    const val = morceau.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
    try { if (!(nom in out)) out[nom] = decodeURIComponent(val); } catch { /* valeur illisible : ignorée */ }
  }
  return out;
}
