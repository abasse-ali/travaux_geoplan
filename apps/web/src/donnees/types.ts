/* ============================================================
   Le dépôt : ce que le client attend d'une source de données
   (ADR-004)

   Trois sources, une seule interface : `local` (ce navigateur),
   `supabase` (la production jusqu'à la bascule), `api` (le serveur de
   W3). L'écran ne sait jamais laquelle il a devant lui ; il ajoute des
   gestes à la file (synchro.ts), et lit l'instantané du serveur sur
   lequel ces gestes sont rejoués.
   ============================================================ */

import type { Avail } from "@geoplan/domain";
import type { Donnees, Operation } from "@geoplan/domain/operations";

export type { Donnees, Operation };

export type Source = "local" | "supabase" | "api";

/** Le compte connecté. `id` range le cache et la file (constat S7). */
export interface Compte { id: string; email: string }

/** L'état du serveur tel qu'on le connaît. `versions` porte le verrou
    optimiste des fiches pour la source api (ADR-003) : « site:<id> » ou
    « person:<id> » → version lue. */
export interface Instantane { donnees: Donnees; versions: Record<string, number> }

export const instantaneVide = (): Instantane =>
  ({ donnees: { people: [], sites: [], avail: [] }, versions: {} });

/** Un lien de disponibilité prêt à envoyer. */
export interface LienDispo { avail: Avail; url: string }

/** Ce qu'une annonce venue d'ailleurs apprend : il faut relire.
    `mutation` : la clé du geste qui l'a causée, pour reconnaître les
    siens. `reprise` : la liaison vient de revenir, tout a pu changer. */
export interface Annonce { mutation?: string; reprise?: boolean }

/** Le geste ne passera jamais (fiche supprimée ailleurs, donnée refusée) :
    il sort de la file, et on le dit. */
export class RefusDefinitif extends Error {}
/** Réseau coupé, serveur indisponible, trop de requêtes : on réessaiera. */
export class Injoignable extends Error {}
/** La session n'est plus valable : retour à l'écran de connexion, la
    file est gardée pour ce compte. */
export class NonConnecte extends Error {}

export interface Depot {
  readonly source: Source;
  /** Le compte connecté ; null : il faut se connecter. Hors ligne, une
      source qui ne peut pas le vérifier rend le dernier compte connu
      plutôt que l'écran de connexion (constat S10). */
  compte(): Promise<Compte | null>;
  connecter(email: string, motDePasse: string): Promise<Compte>;
  deconnecter(): Promise<void>;
  /** Supabase seulement : créer un compte. Rend le compte si la session
      s'ouvre aussitôt, null si une confirmation par e-mail est exigée. */
  inscrire?(email: string, motDePasse: string): Promise<Compte | null>;
  /** Supabase seulement : le lien de réinitialisation par e-mail. */
  reinitialiser?(email: string): Promise<void>;

  /** Tout ce que l'écran affiche. */
  charger(): Promise<Instantane>;
  /** Envoie un geste. `confirme` : l'instantané confirmé, sur lequel le
      geste s'applique. Rend ce que la réponse change à l'instantané. */
  envoyer(op: Operation, cle: string, confirme: Instantane): Promise<(i: Instantane) => Instantane>;
  /** Crée (ou retrouve) les demandes de dispo de ces compagnons. */
  demanderDispos(ids: string[], semaine: string): Promise<LienDispo[]>;
  /** Les changements venus d'autres appareils ; rend de quoi se désabonner. */
  ecouter(surAnnonce: (a: Annonce) => void): () => void;
}
