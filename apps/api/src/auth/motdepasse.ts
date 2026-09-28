/* ============================================================
   Mots de passe (ADR-002)

   argon2id, 19 Mio de mémoire, 2 passes, parallélisme 1 : le minimum
   recommandé par l'OWASP, une trentaine de millisecondes sur un petit
   VPS. La limitation de débit rend la force brute en ligne sans objet ;
   ce coût ne protège que d'une fuite de la base.

   Les paramètres vivent ici et nulle part ailleurs : la route de
   connexion et la commande du propriétaire hachent de la même façon.
   ============================================================ */

import { randomBytes } from "node:crypto";
import { hash, verify, type Options } from "@node-rs/argon2";

/* Algorithm.Argon2id vaut 2. La bibliothèque le déclare en « const
   enum » ambiant, que Node (qui retire les types sans les lire) ne peut
   pas remplacer par sa valeur : on écrit la valeur. */
const ARGON2ID = 2;

export const PARAMETRES: Options = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/* Bornes d'un mot de passe. Au-dessus de 200, la route de connexion
   refuse le corps : un compte créé avec plus ne pourrait jamais entrer. */
export const LONGUEUR_MIN = 10;
export const LONGUEUR_MAX = 200;

/* Un « é » tapé sur l'iPhone et le même « é » tapé dans un terminal
   peuvent arriver sous deux formes Unicode différentes. On hache et on
   vérifie toujours la forme composée : le même mot de passe reste le
   même mot de passe, d'où qu'il soit saisi. */
const forme = (motDePasse: string): string => motDePasse.normalize("NFC");

export function hacher(motDePasse: string): Promise<string> {
  return hash(forme(motDePasse), PARAMETRES);
}

/* Une empreinte qui ne correspond à aucun mot de passe, calculée une
   fois avec les mêmes paramètres. Quand l'adresse ne correspond à aucun
   compte, on vérifie quand même contre elle : la réponse prend le même
   temps, et ne dit pas si l'adresse existe. */
let factice: Promise<string> | undefined;
export function empreinteFactice(): Promise<string> {
  factice ??= hacher(randomBytes(32).toString("base64url"))
    .catch(e => { factice = undefined; throw e; });
  return factice;
}

/** Vérifie un mot de passe contre l'empreinte d'un compte, ou contre
    l'empreinte factice si le compte n'existe pas (empreinte null). */
export async function verifier(empreinte: string | null, motDePasse: string): Promise<boolean> {
  const cible = empreinte ?? await empreinteFactice();
  /* Une empreinte illisible en base vaut un refus, pas une erreur 500. */
  const ok = await verify(cible, forme(motDePasse)).catch(() => false);
  return ok && empreinte !== null;
}
