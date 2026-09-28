/* ============================================================
   Le temps réel entre appareils (ADR-003)

   Socket.IO, sur le même serveur HTTP que l'API (chemin /socket.io).

   • Authentification : le MÊME cookie de session que les routes. Il
     part de lui-même avec la poignée de main (même origine) ; on le lit
     dans l'en-tête, on vérifie la session dans Redis. Sans session
     valide, la connexion est refusée — un appareil déconnecté n'apprend
     rien, pas même qu'un chantier a changé.
   • Une poignée de main venue d'une autre origine est refusée elle
     aussi : c'est le pendant, pour les WebSocket, de la garde d'origine
     des écritures (un navigateur envoie toujours Origin sur une
     WebSocket ; son absence désigne un client qui n'est pas un
     navigateur, que le cookie suffit alors à juger).
   • Tous les appareils connectés rejoignent la salle `equipe` : une
     seule équipe, un seul compte ou deux, tout le monde voit tout.
   • Chacun rejoint aussi la salle de SA session. Une déconnexion ou une
     révocation (route, commande du propriétaire) est annoncée sur Redis ;
     chaque processus coupe alors les connexions de cette session. La
     session n'est donc pas vérifiée qu'à la poignée de main.
   • Filet : une annonce publiée pendant que la connexion d'écoute se
     reconnecte à Redis est perdue. Chaque minute, chaque connexion de
     ce processus relit donc sa session ; disparue, ou son compte
     supprimé, elle est coupée.
   • Adaptateur Redis : un second processus API (redémarrage sans
     coupure, montée en charge) reçoit et relaie aussi les annonces.

   diffuser(c) émet « changement » avec `c` : { quoi, ids, jours?,
   mutation? }. Le client invalide la requête correspondante, et ignore
   les annonces dont il reconnaît la mutation comme sienne.
   ============================================================ */

import type { Server as ServeurHttp } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Changement, Deps } from "./app.ts";
import { lireCookies } from "./http/cookies.ts";
import { CANAL_REVOCATIONS, COOKIE, empreinte, empreinteValide, sessionValide, type Utilisateur } from "./auth/sessions.ts";

export const CHEMIN = "/socket.io";
export const SALLE = "equipe";
export const EVENEMENT = "changement";

export interface TempsReel {
  diffuser: (c: Changement) => void;
  fermer: () => Promise<void>;
}

export async function brancherTempsReel(serveur: ServeurHttp, deps: Deps,
                                        o: { verifierToutesLesMs?: number } = {}): Promise<TempsReel> {
  /* L'adaptateur exige deux connexions à lui : l'une publie, l'autre
     passe en mode abonné et ne peut plus rien faire d'autre. */
  const pub = deps.redis.duplicate();
  const sub = deps.redis.duplicate();
  const revocations = deps.redis.duplicate();
  /* Une connexion Redis qui tombe émet « error » : sans écouteur, le
     processus s'arrêterait. On le note ; ioredis se reconnecte seul. */
  for (const r of [pub, sub, revocations])
    r.on("error", e => deps.log.warn({ err: { message: (e as Error).message } }, "temps réel : Redis indisponible"));

  const io = new Server(serveur, {
    path: CHEMIN,
    serveClient: false,
    adapter: createAdapter(pub, sub),
    allowRequest: (req, repondre) => {
      const origine = req.headers.origin;
      repondre(null, !origine || origine === deps.config.APP_ORIGIN);
    }
  });

  io.use(async (socket, next) => {
    try {
      const id = lireCookies(socket.request.headers.cookie)[COOKIE] || "";
      const s = await sessionValide(deps, id);
      if (!s) return next(new Error("non-connecte"));
      socket.data.utilisateur = { id: s.userId, email: s.email } satisfies Utilisateur;
      socket.data.session = empreinte(id);
      next();
    } catch (e) {
      deps.log.warn({ err: e }, "temps réel : session illisible");
      next(new Error("indisponible"));
    }
  });

  /* Une révocation annoncée entre la vérification ci-dessus et l'entrée
     dans la salle de la session s'adresse à une salle encore vide. Une
     fois dans la salle, on relit donc la session : disparue, on coupe. */
  io.on("connection", socket => {
    void (async () => {
      await socket.join([SALLE, "sess:" + socket.data.session]);
      if (!await empreinteValide(deps, socket.data.session)) socket.disconnect(true);
    })().catch(e => {
      deps.log.warn({ err: e }, "temps réel : session illisible");
      socket.disconnect(true);
    });
  });

  /* Chaque processus reçoit l'annonce et coupe SES connexions : local,
     pour ne pas la rediffuser par l'adaptateur. */
  await revocations.subscribe(CANAL_REVOCATIONS);
  revocations.on("message", (_canal, e) => { io.local.in("sess:" + e).disconnectSockets(true); });

  /* L'adaptateur s'abonne au canal Redis dès sa création, sans rien
     rendre à attendre. Les commandes d'une connexion ioredis partent
     dans l'ordre : quand ce PING répond, l'abonnement est en place, et
     une annonce d'un autre processus ne peut plus se perdre. */
  await sub.ping();

  /* Le filet de la minute (voir en tête). Quelques connexions à peine :
     une lecture Redis et une ligne MySQL chacune. */
  const verifier = async (): Promise<void> => {
    for (const socket of io.of("/").sockets.values())
      if (!await empreinteValide(deps, socket.data.session)) socket.disconnect(true);
  };
  const minuterie = setInterval(() => {
    verifier().catch(e => deps.log.warn({ err: e }, "temps réel : vérification des sessions impossible"));
  }, o.verifierToutesLesMs ?? 60_000);
  minuterie.unref();

  return {
    /* L'adaptateur publie sur Redis sans rendre la promesse : un échec
       de publication devient un rejet non traité, que server.ts note au
       lieu de laisser tomber le processus. L'écriture, elle, est faite ;
       les autres appareils la verront à leur prochaine relecture. */
    diffuser: c => {
      try { io.to(SALLE).emit(EVENEMENT, c); }
      catch (e) { deps.log.warn({ err: { message: (e as Error).message } }, "temps réel : annonce perdue"); }
    },
    fermer: async () => {
      clearInterval(minuterie);
      /* io.close() déconnecte les sockets, désabonne l'adaptateur et
         ferme le serveur HTTP qu'il partage. */
      await io.close();
      pub.disconnect();
      sub.disconnect();
      revocations.disconnect();
    }
  };
}
