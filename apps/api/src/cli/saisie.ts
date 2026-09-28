/* ============================================================
   Lire un mot de passe sur l'entrée standard, sans jamais l'afficher

   Partagé par la commande des comptes et l'outil de migration
   Supabase : dans un terminal, la saisie est masquée ; une entrée
   redirigée (script, fichier) donne sa première ligne.
   ============================================================ */

/* Saisie sans écho : le terminal passe en mode brut, chaque touche
   arrive ici et rien ne s'affiche. Entrée valide, Ctrl-C abandonne. */
export function saisieMasquee(question: string, abandon: () => Error = () => new Error("Abandon")): Promise<string> {
  const entree = process.stdin;
  process.stderr.write(question);
  entree.setRawMode(true);
  entree.setEncoding("utf8");
  entree.resume();
  return new Promise((ok, ko) => {
    let saisie = "";
    const finir = (e?: Error): void => {
      entree.off("data", lire);
      entree.setRawMode(false);
      entree.pause();
      process.stderr.write("\n");
      if (e) ko(e); else ok(saisie);
    };
    const lire = (morceau: string): void => {
      for (const c of morceau) {
        if (c === "\r" || c === "\n") return finir();
        if (c === "\u0003" || c === "\u0004") return finir(abandon());   // Ctrl-C, Ctrl-D
        if (c === "\u007f" || c === "\b") saisie = Array.from(saisie).slice(0, -1).join("");
        else if (c >= " ") saisie += c;
      }
    };
    entree.on("data", lire);
  });
}

/* Entrée redirigée (un script, un fichier) : la première ligne, sans
   son retour à la ligne. Une marque d'ordre des octets, que certains
   éditeurs Windows posent en tête de fichier, n'en fait pas partie. */
export async function premiereLigne(): Promise<string> {
  let tout = "";
  process.stdin.setEncoding("utf8");
  for await (const morceau of process.stdin) tout += morceau;
  return (tout.replace(/^﻿/, "").split(/\r?\n/)[0]) ?? "";
}
