/* ============================================================
   La relance du samedi

   Chaque samedi à 9 h, heure de Paris, chaque compagnon qui a une
   adresse reçoit un e-mail nominatif avec le lien de sa demande pour la
   semaine suivante. Remplace la fonction Edge Supabase, et corrige ce
   qu'elle faisait mal (JOURNAL.md, constats P3 et P4) :

   - IDEMPOTENTE. `sent_at` est posé après chaque envoi réussi ; un
     compagnon qui a déjà reçu l'e-mail de la semaine, ou déjà répondu,
     n'en reçoit pas d'autre. Relancer ne renvoie qu'à ceux dont l'envoi
     a échoué, et aux compagnons ajoutés depuis.
   - UN SEUL À LA FOIS. Un verrou Redis par semaine (SET NX EX) : deux
     lancements simultanés — deux processus, le planificateur et la
     commande — ne se marchent pas dessus ; le second rend « déjà en
     cours » sans rien faire.
   - À BLANC par défaut (MAIL_MODE=a-blanc) : elle calcule tout et
     journalise tout, mais n'écrit rien dans les demandes — ni sent_at,
     ni demande nouvelle, qui ferait croire sur l'écran de Geoffrey que
     le compagnon a été relancé. Seule trace : son bilan dans job_runs.
     Une seconde relance à blanc de la même semaine rend « déjà faite »,
     sauf `forcer`.
   - TRAÇABLE. Le bilan de chaque exécution est rendu, écrit dans
     job_runs et journalisé — avec des identifiants et des nombres, sans
     adresse ni jeton.
   ============================================================ */

import { randomBytes } from "node:crypto";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { fmtRange } from "@geoplan/domain";
import type { Deps } from "../app.ts";
import { availRequests, jobRuns, people } from "../db/schema.ts";
import {
  MAINTENANT_UTC, assurerDemandes, erreurSansDonnees, lienDispo, lireDemandesDe, prenom,
  type LigneDemande
} from "../dispo/demandes.ts";
import { estLundi, semaineVisee } from "../dispo/semaine.ts";
import { ErreurEnvoi, courrielRappel, envoiBrevo, type EnvoiCourriel } from "../mail/brevo.ts";

export const TACHE = "rappel";
const VERROU_S = 3600;

export interface OptionsRappel {
  /** L'instant du lancement : la semaine visée est le lundi qui suit. */
  maintenant?: Date;
  /** La semaine visée (un lundi), à la place de celle que donne `maintenant`. */
  semaine?: string;
  /** Par défaut : à blanc, sauf si MAIL_MODE=brevo. */
  aBlanc?: boolean;
  /** Refaire une relance à blanc déjà faite pour cette semaine. */
  forcer?: boolean;
  /** Le moyen d'envoi. Par défaut : Brevo, d'après la configuration. */
  envoyer?: EnvoiCourriel;
}

export type BilanRappel = {
  /** « fait », ou pourquoi rien n'a été fait. */
  statut: "fait" | "deja-en-cours" | "deja-faite";
  semaine: string;
  aBlanc: boolean;
  /** E-mails partis ; à blanc : qui partiraient. */
  envoyes: number;
  /** Compagnons qui ont déjà répondu pour cette semaine. */
  deja: number;
  /** Compagnons déjà relancés cette semaine, sans réponse : pas de second e-mail. */
  dejaEnvoyes: number;
  /** Compagnons sans adresse e-mail. */
  sans: number;
  /** Demandes créées ; à blanc : qui le seraient. */
  creees: number;
  erreurs: { compagnonId: string; message: string }[];
};

/* Relâcher le verrou seulement s'il est encore à nous : s'il a expiré et
   qu'un autre lancement l'a pris, ce n'est pas à nous de l'ôter. */
const RELACHER = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export async function lancerRappel(deps: Deps, o: OptionsRappel = {}): Promise<BilanRappel> {
  const { config, db, redis, log } = deps;
  const semaine = o.semaine ?? semaineVisee(o.maintenant ?? new Date(), config.RAPPEL_TZ);
  if (!estLundi(semaine)) throw new Error("La semaine visée doit être un lundi (AAAA-MM-JJ)");
  const aBlanc = o.aBlanc ?? config.MAIL_MODE !== "brevo";
  /* Une seule règle, quel que soit l'appelant : rien ne part sans
     MAIL_MODE=brevo. Un oubli de configuration n'envoie pas d'e-mail. */
  if (!aBlanc && config.MAIL_MODE !== "brevo") throw new Error("L'envoi réel exige MAIL_MODE=brevo");
  const envoyer = aBlanc ? null : (o.envoyer ?? envoiBrevo(config));

  const bilan: BilanRappel = {
    statut: "fait", semaine, aBlanc, envoyes: 0, deja: 0, dejaEnvoyes: 0, sans: 0, creees: 0, erreurs: []
  };

  /* Une relance à blanc n'écrit rien d'autre que son bilan : elle a son
     propre verrou. Lancée à la main à 9 h, elle ne doit pas faire
     croire à la vraie relance qu'elle est déjà en cours. */
  const verrou = (aBlanc ? "verrou:rappel-a-blanc:" : "verrou:rappel:") + semaine;
  const porteur = randomBytes(16).toString("hex");
  if ((await redis.set(verrou, porteur, "EX", VERROU_S, "NX")) !== "OK") {
    log.info({ semaine, aBlanc }, "relance : déjà en cours ailleurs, rien à faire");
    return { ...bilan, statut: "deja-en-cours" };
  }

  try {
    if (aBlanc && !o.forcer && await dejaFaiteABlanc(deps, semaine)) {
      log.info({ semaine }, "relance à blanc : déjà faite pour cette semaine, rien à refaire");
      return { ...bilan, statut: "deja-faite" };
    }

    const [{ id: execution }] = await db.insert(jobRuns)
      .values({ job: TACHE, cle: semaine, aBlanc, startedAt: MAINTENANT_UTC })
      .$returningId();
    log.info({ semaine, aBlanc, execution }, "relance du samedi : début");

    try {
      await relancer(deps, semaine, envoyer, bilan);
    } catch (e) {
      /* Une panne en cours de route (base, Redis) : l'exécution reste
         sans date de fin, et son bilan dit où elle en était. */
      const sure = erreurSansDonnees(e);
      await db.update(jobRuns)
        .set({ bilan: { ...bilan, echec: sure instanceof Error ? sure.message : String(sure) } })
        .where(eq(jobRuns.id, execution))
        .catch(() => { /* la base est peut-être la cause : l'erreur d'origine prime */ });
      throw sure;
    }

    await db.update(jobRuns).set({ finishedAt: MAINTENANT_UTC, bilan: { ...bilan } })
      .where(eq(jobRuns.id, execution));
    log.info({ bilan }, "relance du samedi : bilan");
    return bilan;
  } finally {
    await redis.eval(RELACHER, 1, verrou, porteur)
      .catch(() => { /* il expirera de lui-même dans l'heure */ });
  }
}

async function dejaFaiteABlanc({ db }: Deps, semaine: string): Promise<boolean> {
  const [r] = await db.select({ id: jobRuns.id }).from(jobRuns)
    .where(and(eq(jobRuns.job, TACHE), eq(jobRuns.cle, semaine), eq(jobRuns.aBlanc, true),
               isNotNull(jobRuns.finishedAt)))
    .limit(1);
  return !!r;
}

/** Le travail lui-même ; remplit `bilan` au fil de l'eau. `envoyer` nul :
    à blanc. */
async function relancer(deps: Deps, semaine: string, envoyer: EnvoiCourriel | null,
                        bilan: BilanRappel): Promise<void> {
  const { config, db, log } = deps;
  const aBlanc = envoyer === null;

  const tous = await db.select({ id: people.id, name: people.name, email: people.email })
    .from(people).orderBy(asc(people.id));
  const avecAdresse = tous.filter(p => p.email.trim() !== "");
  for (const p of tous) if (!p.email.trim())
    log.info({ compagnon: p.id, semaine }, "relance : pas d'adresse e-mail");
  bilan.sans = tous.length - avecAdresse.length;
  const ids = avecAdresse.map(p => p.id);

  let demandes: Map<string, LigneDemande>;
  const changees: string[] = [];
  if (aBlanc) {
    demandes = await lireDemandesDe(db, ids, semaine);
    bilan.creees = ids.filter(id => !demandes.has(id)).length;
  } else {
    const r = await assurerDemandes(db, ids, semaine);
    demandes = new Map(r.demandes.map(d => [d.personId, d]));
    bilan.creees = r.creees.length;
    changees.push(...r.creees);
  }

  const plage = fmtRange(semaine);
  for (const p of avecAdresse) {
    const d = demandes.get(p.id);
    if (d?.answeredAt) {
      bilan.deja++;
      log.info({ compagnon: p.id, semaine }, "relance : a déjà répondu");
      continue;
    }
    if (d?.sentAt) {
      bilan.dejaEnvoyes++;
      log.info({ compagnon: p.id, semaine }, "relance : déjà relancé cette semaine");
      continue;
    }
    if (aBlanc) {
      bilan.envoyes++;
      log.info({ compagnon: p.id, semaine, aBlanc }, "relance à blanc : l'e-mail partirait");
      continue;
    }
    if (!d) continue;                   // supprimé entre-temps : plus personne à relancer

    try {
      await envoyer(courrielRappel({
        email: p.email, nom: p.name, prenom: prenom(p.name), plage,
        lien: lienDispo(config.APP_ORIGIN, d.token), chef: config.MAIL_FROM_NAME
      }));
    } catch (e) {
      /* Un échec n'arrête pas les autres ; sans sent_at, ce compagnon
         repartira à la relance suivante. */
      const message = e instanceof ErreurEnvoi ? e.message
        : "Échec de l'envoi (" + ((e as { name?: string })?.name ?? "erreur") + ")";
      bilan.erreurs.push({ compagnonId: p.id, message });
      log.warn({ compagnon: p.id, semaine, erreur: message }, "relance : envoi en échec");
      continue;
    }

    bilan.envoyes++;
    changees.push(d.id);
    try {
      await db.update(availRequests).set({ sentAt: MAINTENANT_UTC })
        .where(and(eq(availRequests.id, d.id), isNull(availRequests.sentAt)));
      log.info({ compagnon: p.id, semaine }, "relance : e-mail envoyé");
    } catch (e) {
      const message = "E-mail parti, mais son envoi n'a pas pu être noté : il repartira à la relance suivante";
      bilan.erreurs.push({ compagnonId: p.id, message });
      log.error({ compagnon: p.id, semaine, err: erreurSansDonnees(e) }, "relance : " + message);
    }
  }

  /* L'écran de Geoffrey voit « relancé » sans recharger. */
  if (changees.length) deps.diffuser({ quoi: "avail", ids: [...new Set(changees)] });
}
