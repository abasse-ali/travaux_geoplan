/* ============================================================
   Redis : sessions, limitation de débit, verrous, identifiants de
   mutations déjà appliquées, et canal du temps réel entre processus.
   ============================================================ */

import { Redis } from "ioredis";

export type { Redis };

export function ouvrirRedis(url: string): Redis {
  return new Redis(url, {
    /* Au démarrage, attendre Redis plutôt qu'échouer : docker compose
       lance les services ensemble. Ensuite, une commande qui ne peut pas
       partir échoue vite, et la route répond 503. */
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    lazyConnect: false
  });
}
