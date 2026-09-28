/* ============================================================
   Idempotence des écritures (ADR-003)

   Le client range chaque geste dans une file persistée, et le renvoie
   tant qu'il n'a pas reçu de réponse : coupure du réseau, application
   tuée, iPhone en veille. Le serveur doit donc pouvoir recevoir deux
   fois le même geste sans l'appliquer deux fois.

   Chaque écriture porte un en-tête `Idempotency-Key` (1 à 100
   caractères visibles), unique par geste. Dans Redis :

     idem:<userId>:<clé>  → { etat: "en-cours" }                 (2 min)
                          → { etat: "fait", statut, corps }      (7 jours)

   • Première réception : on pose « en-cours » (SET NX, atomique), on
     exécute, on garde la réponse, puis seulement on l'envoie — ainsi
     un renvoi qui arriverait juste après la réponse la retrouve.
   • Renvoi après coup : la réponse gardée est rendue telle quelle, sans
     rien réexécuter (en-tête `Idempotent-Replayed: true`).
   • Renvoi pendant l'exécution : 409 `{ erreur: "en-cours" }` ; le
     client réessaiera plus tard et retrouvera la réponse.

   Seuls les SUCCÈS sont gardés. Une erreur n'a rien appliqué (la
   transaction est annulée) : la réexécuter est sans risque, et c'est
   même ce qu'il faut. Après un 409 de version, le client rejoue son
   geste sur la fiche fraîche sous la même clé (ADR-003) ; une pose
   refusée en 404 parce que son compagnon n'était pas encore créé passe
   une fois qu'il l'est (relecture adversariale de W3 : ce 404 était
   gardé sept jours). On efface alors la marque « en-cours ».

   La marque « en-cours » expire seule au bout de deux minutes : un
   processus tué en pleine requête ne bloque pas la clé pour sept jours.
   Une requête vivante, elle, finit bien avant : une transaction
   n'attend jamais un verrou plus de 5 s (db/client.ts) et se rejoue au
   plus cinq fois.

   La clé sert aussi d'identifiant de mutation dans les annonces temps
   réel (res.locals.mutation) : l'appareil qui a fait le geste reconnaît
   le sien et l'ignore.
   ============================================================ */

import type { RequestHandler, Response } from "express";
import type { Deps } from "../app.ts";
import type { Utilisateur } from "../auth/sessions.ts";
import { ErreurHttp } from "./erreurs.ts";

export const ENTETE = "idempotency-key";
export const DUREE_S = 7 * 24 * 3600;
const EN_COURS_S = 120;
const FORME = /^[\x21-\x7E]{1,100}$/;

interface EnCours { etat: "en-cours"; empreinte: string }
interface Faite { etat: "fait"; empreinte: string; statut: number; corps: unknown }

const aGarder = (statut: number): boolean => statut >= 200 && statut < 300;

export function idempotence(deps: Deps): RequestHandler {
  return async (req, res, next) => {
    try {
      const cle = req.headers[ENTETE];
      if (cle === undefined) return next();
      if (typeof cle !== "string" || !FORME.test(cle))
        throw new ErreurHttp(400, "requete-invalide", "En-tête Idempotency-Key invalide (1 à 100 caractères visibles)");

      const u = res.locals.utilisateur as Utilisateur;
      const k = `idem:${u.id}:${cle}`;
      /* Une même clé ne doit pas servir à deux gestes différents : on
         garde de quoi reconnaître la requête d'origine. Pas le corps —
         après un 409, le client renvoie la même clé avec une version
         plus récente, et c'est voulu. */
      const empreinte = req.method + " " + req.originalUrl;

      for (let essai = 0; ; essai++) {
        const marque: EnCours = { etat: "en-cours", empreinte };
        if (await deps.redis.set(k, JSON.stringify(marque), "EX", EN_COURS_S, "NX") === "OK") break;
        const brut = await deps.redis.get(k);
        if (!brut) {
          /* La marque a expiré entre les deux commandes : on retente. */
          if (essai < 3) continue;
          throw new ErreurHttp(409, "en-cours", "Cette modification est déjà en cours d'envoi");
        }
        const g = JSON.parse(brut) as EnCours | Faite;
        if (g.empreinte !== empreinte)
          throw new ErreurHttp(422, "cle-reutilisee", "Cette clé d'idempotence a déjà servi à une autre requête");
        if (g.etat === "en-cours")
          throw new ErreurHttp(409, "en-cours", "Cette modification est déjà en cours d'envoi");
        res.setHeader("Idempotent-Replayed", "true");
        res.status(g.statut).json(g.corps);
        return;
      }

      res.locals.mutation = cle;
      intercepter(res, deps, k, empreinte);
      next();
    } catch (e) { next(e); }
  };
}

/* Toutes les réponses de l'API passent par res.json — celles des routes
   comme celles du gestionnaire d'erreurs. On s'y glisse pour garder la
   réponse AVANT de l'envoyer. */
function intercepter(res: Response, deps: Deps, k: string, empreinte: string): void {
  const envoyer = res.json.bind(res);
  let vu = false;
  res.json = ((corps: unknown) => {
    if (vu) return envoyer(corps);
    vu = true;
    const statut = res.statusCode;
    const faite: Faite = { etat: "fait", empreinte, statut, corps };
    const memoriser = aGarder(statut)
      ? deps.redis.set(k, JSON.stringify(faite), "EX", DUREE_S)
      : deps.redis.del(k);
    const partir = () => { try { envoyer(corps); } catch (e) { deps.log.error({ err: e }, "réponse non envoyée"); } };
    memoriser.then(partir, e => {
      /* Redis ne répond plus : la réponse part quand même. La marque
         « en-cours » expirera, et un renvoi serait réexécuté. C'est un
         filet, pas le seul : chaque geste de l'API décrit un état visé
         (« posé », « coché », version attendue), qu'on peut appliquer
         deux fois sans rien changer la seconde. */
      deps.log.warn({ err: e }, "idempotence : réponse non mémorisée");
      partir();
    });
    return res;
  }) as typeof res.json;
}
