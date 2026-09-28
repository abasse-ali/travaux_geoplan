/* ============================================================
   Comptes : l'adresse e-mail, et le compte qu'elle désigne

   La route de connexion et la commande du propriétaire normalisent
   l'adresse de la même façon (espaces retirés, minuscules) : un compte
   créé sur le serveur s'ouvre avec ce que Geoffrey tape sur son iPhone,
   majuscule automatique comprise.
   ============================================================ */

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { users } from "../db/schema.ts";

/** Une adresse telle que les comptes la stockent. 120 : la colonne. */
export const AdresseEmail = z.string().trim().toLowerCase().min(1).max(120);

export interface Compte { id: string; email: string; passwordHash: string }

/** Le compte dont l'adresse est exactement `email` (déjà normalisée). */
export async function trouverCompte(db: Db, email: string): Promise<Compte | null> {
  const [c] = await db.select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users).where(eq(users.email, email)).limit(1);
  /* La collation de MySQL confond les majuscules et les minuscules, mais
     aussi « e » et « é ». Sans cette comparaison exacte, chaque variante
     accentuée d'une adresse désignerait le même compte tout en ayant son
     propre compteur d'échecs : la limite de 5 par quart d'heure se
     contournerait en changeant un accent. */
  return c && c.email === email ? c : null;
}
