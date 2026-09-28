/* ============================================================
   Transactions

   Toute écriture passe par ici. Deux choix, et leur raison :

   • READ COMMITTED plutôt que REPEATABLE READ. Une écriture commence
     par verrouiller les lignes qu'elle touche (SELECT … FOR UPDATE) ;
     ce qu'elle lit ENSUITE doit être l'état validé à cet instant, pas
     un instantané pris avant d'avoir obtenu le verrou. READ COMMITTED
     pose aussi beaucoup moins de verrous d'intervalle, source première
     des interblocages sur un index unique.

   • Un interblocage (1213) ou une attente de verrou expirée (1205) ne
     sont pas des erreurs du client : InnoDB a annulé la transaction en
     entier, la rejouer est sans risque. On la rejoue donc, quelques
     fois, avant d'abandonner.
   ============================================================ */

import type { Db } from "./client.ts";

/** Ce que reçoit le corps d'une transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const ER_LOCK_WAIT_TIMEOUT = 1205;
const ER_LOCK_DEADLOCK = 1213;
const ESSAIS = 5;

/* Drizzle enveloppe l'erreur de mysql2 dans `cause`. */
export const errnoDe = (e: unknown): number | undefined =>
  (e as { errno?: number })?.errno ?? (e as { cause?: { errno?: number } })?.cause?.errno;

const aRejouer = (e: unknown): boolean => {
  const n = errnoDe(e);
  return n === ER_LOCK_DEADLOCK || n === ER_LOCK_WAIT_TIMEOUT;
};

export async function enTransaction<T>(db: Db, corps: (tx: Tx) => Promise<T>): Promise<T> {
  for (let essai = 1; ; essai++) {
    try {
      return await db.transaction(corps, { isolationLevel: "read committed" });
    } catch (e) {
      if (essai >= ESSAIS || !aRejouer(e)) throw e;
      /* Un peu d'aléa, pour que deux transactions qui viennent de se
         bloquer mutuellement ne recommencent pas au même instant. */
      await new Promise(ok => setTimeout(ok, 5 * essai + Math.random() * 20));
    }
  }
}

/** Une lecture cohérente de plusieurs tables : un seul instantané,
    donc aucune affectation qui pointe vers un chantier pas encore lu.
    (Pas de `withConsistentSnapshot` : Drizzle l'écrirait sans la
    virgule qui le sépare de READ ONLY, et MySQL refuserait la phrase.
    L'instantané se prend de toute façon à la première lecture.) */
export function enLecture<T>(db: Db, corps: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(corps, { isolationLevel: "repeatable read", accessMode: "read only" });
}
