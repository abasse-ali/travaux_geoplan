/* ============================================================
   La session : se connecter, savoir qui l'on est, se déconnecter
   (ADR-002)

     POST   /api/session   { email, password }  → 204 et cookie, ou 401
     GET    /api/session                        → { email }, ou 401
     DELETE /api/session                        → 204, toujours

   Ni inscription, ni « mot de passe oublié » par e-mail : sur l'iPhone,
   un lien reçu s'ouvre dans Safari et pas dans la PWA de l'écran
   d'accueil. Un compte se crée, et un mot de passe se change, par la
   commande du serveur (src/cli/compte.ts).
   ============================================================ */

import { Router } from "express";
import { z } from "zod";
import type { Module } from "../app.ts";
import { AdresseEmail, trouverCompte } from "../auth/comptes.ts";
import { empreinteFactice, verifier, LONGUEUR_MAX } from "../auth/motdepasse.ts";
import {
  COOKIE, creerSession, supprimerSession, poserCookie, effacerCookie, exigerSession, type Utilisateur
} from "../auth/sessions.ts";
import { lireCookies } from "../http/cookies.ts";
import { ErreurHttp } from "../http/erreurs.ts";
import { adresseIp, cleIp, compter, empreinteSaisie, limiter, rendre, tropDeRequetes } from "../http/limites.ts";
import { verifierOrigine } from "../http/origine.ts";

const QUART_D_HEURE = 15 * 60;
const ESSAIS_PAR_IP = 10;
const ECHECS_PAR_ADRESSE = 5;

const Connexion = z.object({
  email: AdresseEmail,
  password: z.string().min(1).max(LONGUEUR_MAX)
});

/* Le même refus, mot pour mot, que l'adresse existe ou non : la réponse
   ne doit pas servir à dresser la liste des comptes. */
const refus = (): ErreurHttp => new ErreurHttp(401, "identifiants", "Adresse ou mot de passe incorrect");


export const session: Module = deps => {
  const r = Router();
  /* En test, l'API répond en http sur 127.0.0.1 : un cookie Secure n'y
     reviendrait jamais. Partout ailleurs, nginx sert en https. */
  const secure = deps.config.NODE_ENV === "production";
  const origine = verifierOrigine(deps.config.APP_ORIGIN);

  /* L'empreinte factice est calculée tout de suite : sinon la première
     adresse inconnue paierait ce calcul, et se trahirait par sa lenteur.
     Un échec ici sera retenté à la première connexion. */
  empreinteFactice().catch(() => {});

  r.post("/api/session", origine,
    limiter(deps.redis, "connexion-ip", ESSAIS_PAR_IP, QUART_D_HEURE, cleIp),
    async (req, res) => {
      const { email, password } = Connexion.parse(req.body);

      /* 5 échecs par adresse et par quart d'heure, que le compte existe
         ou non (sinon le blocage dirait lesquels existent). Le passage
         est compté AVANT la vérification : des essais lancés en même
         temps ne passent pas tous avant que le premier échec soit
         inscrit. Au-delà, même le bon mot de passe attend la fin de la
         fenêtre. */
      const cleEchecs = "connexion-echecs:" + empreinteSaisie(email);
      const d = await compter(deps.redis, cleEchecs, ECHECS_PAR_ADRESSE, QUART_D_HEURE);
      if (d.depasse) {
        res.setHeader("Retry-After", String(d.reessayerDans));
        throw tropDeRequetes(d.reessayerDans);
      }

      const compte = await trouverCompte(deps.db, email);
      const ok = await verifier(compte?.passwordHash ?? null, password);
      if (!ok || !compte) {
        /* Ni l'adresse tentée (on y tape parfois son mot de passe), ni
           le mot de passe : seulement d'où vient l'essai. */
        deps.log.warn({ ip: adresseIp(req) }, "connexion refusée");
        throw refus();
      }
      /* Une connexion réussie rend le passage qu'elle avait réservé
         dans le compteur d'échecs. */
      await rendre(deps.redis, cleEchecs);

      /* La session que ce navigateur avait peut-être déjà ne sert plus :
         on ne la laisse pas vivre 180 jours pour rien. */
      const ancienne = lireCookies(req.headers.cookie)[COOKIE];
      if (ancienne) await supprimerSession(deps.redis, ancienne);

      const sid = await creerSession(deps.redis, { id: compte.id, email: compte.email });
      poserCookie(res, sid, secure);
      deps.log.info({ utilisateur: compte.id }, "connexion");
      res.status(204).end();
    });

  /* L'application demande au démarrage si elle est connectée. no-store :
     ni le navigateur ni le service worker ne doivent garder la réponse
     d'une session qui n'existe peut-être plus. */
  r.get("/api/session", exigerSession(deps), (_req, res) => {
    const u = res.locals.utilisateur as Utilisateur;
    res.set("Cache-Control", "no-store").json({ email: u.email });
  });

  /* Idempotente : sans session, ou avec une session déjà expirée, la
     déconnexion réussit quand même et efface le cookie. */
  r.delete("/api/session", origine, async (req, res) => {
    const sid = lireCookies(req.headers.cookie)[COOKIE];
    if (sid) await supprimerSession(deps.redis, sid);
    effacerCookie(res, secure);
    res.status(204).end();
  });

  return r;
};
