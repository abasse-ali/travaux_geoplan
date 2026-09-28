/* ============================================================
   Geoplan — les feuilles du bas
   ============================================================ */

import { Children, cloneElement, isValidElement, useState, useEffect, useId, useMemo, useRef,
  type ReactElement, type ReactNode } from "react";
import { DayPicker, Acc, plur } from "./bits";
import { mouvementReduit } from "./mouvement/reduit";
import { Feuille as Sheet } from "./primitives/feuille";
import { Interrupteur } from "./primitives/interrupteur";
import { patchUi, useUi } from "./etat";
import { eveillerSon, jouerSon } from "./son";
import { bouton, cible, cibleSerree, cn, indice, indiceVide } from "./primitives/classes";
import {
  SKILLS, SK, DAYS, DAYS_L, PHASES, TOTAL_JH, skLabel, skColor,
  weekDates, weekNum, fmtDay, fmtRange, addDays, todayISO, parse,
  normPerson, normSite, normEmail, normPhone, countDays,
  teamOn, weekRoster, daysOnSite, currentPhase, span, loadLeft,
  neededHeadcount, suggestTeam, coverage, uncovered, optimizeWeek, codeFromAddr,
  type Person, type Site, type Why as Raison
} from "@geoplan/domain";
import type { Synchro } from "../donnees/synchro";
import type { EtatBouton } from "../donnees/react";
import type { Source } from "../donnees/types";
import { nouvelId } from "./actions";
import { html } from "./html";
import type { Actions, UiCoque, Vue } from "./types";

/* Ce qu'une fiche a changé depuis son ouverture, champ par champ. Une
   fiche renvoyait tous ses champs : après un 409, ils étaient rejoués
   sur la version fraîche, et écrasaient ce qu'un autre appareil venait
   d'y changer (ADR-003 : des correctifs par champ ; relecture
   adversariale de W4). */
export function ecart<T extends object>(avant: T, apres: T): Partial<T> {
  const champs: Partial<T> = {};
  for (const k of Object.keys(apres) as (keyof T)[])
    if (JSON.stringify(avant[k]) !== JSON.stringify(apres[k])) champs[k] = apres[k];
  return champs;
}

/* Toute feuille reçoit de quoi se fermer. */
interface Base { vue: Vue; act: Actions; onClose: () => void }

/* Une feuille ouverte sur une fiche qu'un autre appareil vient de
   supprimer se referme, et le dit. Avant W4, elle lisait un objet
   disparu et l'écran devenait blanc (constat U16). `ici` : la
   suppression vient de cette feuille, elle a déjà son propre message. */
function useFermeSiDisparu(existe: boolean, onClose: () => void, act: Actions, quoi: string,
                           ici?: { current: boolean }): void {
  useEffect(() => {
    if (existe || ici?.current) return;
    onClose();
    act.toast(html`${quoi} a été supprimé sur un autre appareil`);
  }, [existe]);
}

/* ---------- le dessin des feuilles (ADR-005) ----------
   Les classes que seules les feuilles emploient, écrites une fois. */

/* Un champ : son libellé en petites capitales, puis la saisie. Le libellé
   nomme ce qu'il annonce : la saisie, quand il n'y en a qu'une (label
   relié) ; le groupe, quand il y en a plusieurs (« Restaurer »). Avant,
   il n'était relié à rien : un champ n'avait pour nom que son texte
   d'exemple, qui disparaît à la première frappe, et « Début » n'en avait
   aucun (relecture adversariale de W5, test L1). Des boutons de choix ont
   leur nom, et le sélecteur de jours son propre groupe nommé : pas de
   groupe par-dessus, qui le doublerait. */
const SAISIES = ["input", "textarea", "select"];
function Champ({ libelle, children }: { libelle: ReactNode; children?: ReactNode }){
  const id = useId();
  const saisies = Children.toArray(children).filter(c => isValidElement(c) && SAISIES.includes(c.type as string));
  const seule = saisies.length === 1, groupe = saisies.length > 1;
  return (
    <div className="flex flex-col gap-1.5" data-champ
      role={groupe ? "group" : undefined} aria-labelledby={groupe ? id + "-libelle" : undefined}>
      <label id={id + "-libelle"} htmlFor={seule ? id : undefined}
        className="font-display text-[10.5px]/none font-semibold tracking-[.1em] uppercase text-muted">{libelle}</label>
      {seule
        ? Children.map(children, c => isValidElement(c) && SAISIES.includes(c.type as string)
            ? cloneElement(c as ReactElement<{ id?: string }>, { id }) : c)
        : children}
    </div>
  );
}

/* Les saisies d'un champ : texte, fichier, zone de texte. */
const SAISIE = "w-full rounded-[10px] border border-line-champ bg-surface-2";
const TEXTE = cn(SAISIE, "px-3 py-2.75 text-[16px]");
/* 44 px au moins : WebKit dessine le choix de fichier assez haut de
   lui-même, Chromium (Android, bureau) à 42 px. */
const FICHIER = cn(SAISIE, "min-h-11 p-2.25 font-body text-[13px]");
const ZONE_TEXTE = cn(SAISIE, "min-h-[130px] resize-y px-3 py-2.75 font-mono text-[12px]/[1.5]");

/* Un groupe de choix : une ligne de boutons à parts égales, le choix
   retenu en bleu (aria-pressed). Pas bouton({ taille: "segment" }) : le
   choix d'un groupe est à l'encre secondaire et arrondi à 9 px, le
   bouton segment à l'encre pleine et à 10 px. */
const GROUPE = "flex gap-1.25";
const CHOIX = cible + " flex-1 rounded-[9px] border border-line-2 bg-surface-2 px-1 py-2.25 font-body text-[13px]/none font-semibold text-ink-2"
  + " aria-pressed:border-transparent aria-pressed:bg-blue aria-pressed:text-on-blue";
/* « Ses jours dispo », « Aucun » : de petits boutons dans un groupe. Pas
   bouton({ taille: "petit" }), pour la même raison : dans un groupe,
   l'encre est secondaire. */
/* 6 px sous le sélecteur de jours : la moitié de l'écart (3 px) au doigt. */
const PETIT_CHOIX = cibleSerree["3px"] + " inline-flex flex-1 items-center justify-center gap-1.75 rounded-[9px] border border-line-2 bg-surface-2"
  + " px-2.75 py-1.75 font-body text-[12.5px]/none font-semibold text-ink-2 no-underline active:translate-y-px disabled:opacity-50";

/* Un encart : une note posée dans la feuille, un filet à gauche —
   orange, ou ocre quand elle met en garde. */
const encart = (garde = false): string =>
  cn("rounded-[10px] border-l-3 bg-surface-2 px-3 py-2.5 text-[12.5px]/[1.5] text-ink-2 [&_b]:font-mono [&_b]:text-ink",
    garde ? "border-l-warn" : "border-l-accent");

/* Une ligne d'une liste de compagnons, un filet au-dessus (sauf la première). */
const LIGNE = "flex gap-2.5 border-t border-t-line py-2.75 first:border-t-0";

/* Une étiquette : une raison, un nombre de jours, une adresse. */
const ETIQUETTES = {
  neutre: "border-line bg-surface-2",
  cle: "border-accent bg-accent/10 text-accent-texte",          // le seuil qu'il débloque
  alerte: "border-warn/45 bg-surface-2 text-warn-texte"
} as const;
const etiquette = (teinte: keyof typeof ETIQUETTES = "neutre"): string =>
  cn("inline-flex items-center gap-1.25 rounded-[6px] border px-1.75 py-0.5 font-body text-[11px]/[1.5] font-medium",
    ETIQUETTES[teinte]);

/* Les étiquettes sous un nom, en une ligne qui passe à la ligne. */
const RAISONS = "mt-1.25 flex flex-wrap items-center gap-1.25 text-[11.5px] text-ink-2";

/* La pastille d'un métier : sa teinte vient du domaine, par style. */
const PASTILLE = "inline-block size-1.75 flex-none rounded-[2px]";

/* La couverture des métiers : une ligne par métier (ou par manque). */
const COUVERTURE = "flex flex-col gap-2";
const LIGNE_COUVERTURE = "flex items-center gap-2.25";
const METIER = "flex w-21 flex-none items-center gap-1.5 font-body text-[11.5px]/[1.2] font-medium text-ink-2";

/* ---------- pourquoi telle personne a été retenue ---------- */

const WHY: Record<string, (r: Raison) => string> = {
  gate:    r => "débloque " + skLabel(r.k!) + " niv. " + r.lv,
  sk:      r => skLabel(r.k!) + " " + r.lv + "/5",
  poly:    () => "main-d'œuvre",
  permis:  () => "permis",
  suite:   () => "suite de la veille",
  retard:  () => "chantier en retard",
  rien:    () => "rien à sa portée ici",
  encadre: () => "encadré",
  seul:    () => "novice sans encadrement"
};

/* Sous un nom proposé (Composer), les raisons forment leur propre ligne
   (className = RAISONS) ; dans le plan de la semaine, elles suivent le
   nom, sans dessin propre. */
function Why({ reasons, className }: { reasons: Raison[] | undefined; className?: string }){
  return (
    <span className={className} data-pourquoi>
      {(reasons || []).slice(0, 3).map((r, i) => (
        <span key={i} data-etiquette className={etiquette(r.type === "gate" ? "cle"
          : r.type === "retard" || r.type === "seul" || r.type === "rien" ? "alerte" : "neutre")}>
          {r.k && <span className={PASTILLE} style={{ background: skColor(r.k) }} />}
          {(WHY[r.type] || (() => r.type))(r)}
        </span>
      ))}
    </span>
  );
}

/* ============================================================
   Fiche d'un compagnon — ouverte en touchant une puce
   ============================================================ */

export function PersonSheet({ vue, ui, act, pid, fromSite, onClose }:
    Base & { ui: UiCoque; pid: string; fromSite?: string | null }){
  const p = vue.person(pid);
  useFermeSiDisparu(!!p, onClose, act, "Ce compagnon");
  if (!p) return null;
  const week = ui.week;
  const day = addDays(week, ui.day);
  const dates = weekDates(week);
  const here = vue.sites.filter(s => teamOn(s, day).includes(pid));
  const a = vue.availOf(pid, week);
  const eff = vue.daysOf(p, week);
  const site = fromSite ? vue.site(fromSite) : null;

  return (
    <Sheet title={p.name} onClose={onClose}
      sub={`${DAYS_L[ui.day]} ${fmtDay(day)} · ${here.length ? "sur " + here.map(s => s.code).join(" + ") : "libre"} · dispo ${DAYS.filter((d, i) => eff[i]).join(" ")}`}>

      {site && (
        <Champ libelle={<>Jours sur {site.code} · sem. {weekNum(week)}</>}>
          <DayPicker nom={`Jours sur ${site.code}`}
            value={daysOnSite(site, pid, week)}
            dates={dates}
            disabled={dates.map(d => !vue.availableOn(pid, d))}
            onToggle={i => act.toggleDay(pid, site.id, dates[i])} />
          <div className={cn(GROUPE, "mt-1.5")}>
            <button className={PETIT_CHOIX} data-cible="serree" onClick={() => { act.fillDays(pid, site.id, "dispo"); onClose(); }}>
              Ses jours dispo
            </button>
            <button className={PETIT_CHOIX} data-cible="serree" onClick={() => { act.fillDays(pid, site.id, "none"); onClose(); }}>
              Aucun
            </button>
          </div>
        </Champ>
      )}

      {a?.days && (
        <div className={encart()} data-encart>
          A répondu pour la semaine {weekNum(week)} :{" "}
          <b>{countDays(a.days) ? DAYS.filter((d, i) => a.days![i]).join(" ") : "aucun jour"}</b>
          {a.note && <><br />« {a.note} »</>}
        </div>
      )}
      {a && !a.days && (
        <div className={encart(true)} data-encart>
          Demande envoyée pour la semaine {weekNum(week)}, sans réponse pour l'instant.
        </div>
      )}

      <Champ libelle="Contact">
        {p.phone || p.email ? (
          <div className={GROUPE}>
            {p.phone && <a className={bouton({ taille: "segment" })} href={"tel:" + p.phone}>Appeler</a>}
            {p.phone && <a className={bouton({ taille: "segment" })} href={"sms:" + p.phone}>SMS</a>}
            {p.phone && <a className={bouton({ taille: "segment" })} target="_blank" rel="noopener"
              href={"https://wa.me/" + p.phone.slice(1)}>WhatsApp</a>}
            {!p.phone && p.email && <a className={bouton({ taille: "segment" })} href={"mailto:" + p.email}>Écrire</a>}
          </div>
        ) : (
          <p className={indice}>Aucun contact enregistré. Ajoutez au moins une adresse e-mail
            pour que les demandes de disponibilité lui parviennent.</p>
        )}
      </Champ>

      {vue.sites.length > 0 && (
        <Champ libelle={<>Poser sur · {DAYS_L[ui.day].toLowerCase()} {fmtDay(day)}</>}>
          {vue.sites.map(s => {
            const on = teamOn(s, day).includes(pid);
            /* Calé à gauche : en ligne, pour ne pas contredire le
               centrage de bouton(). Posé ici, il est grisé (disabled). */
            return (
              <button key={s.id} className={cn(bouton({ large: true }), "mb-1.5")} disabled={on}
                style={{ justifyContent: "flex-start" }}
                onClick={() => { act.assign(pid, s.id); onClose(); }}>
                <span className="font-mono font-semibold">{s.code}</span>
                <span className="text-[12.5px] font-normal text-muted">{s.addr}</span>
                {on && <><span className="flex-1" /><span className="text-[12px] text-ok-texte">ici</span></>}
              </button>
            );
          })}
        </Champ>
      )}

      {here.length > 0 && (
        <button className={bouton({ large: true })} onClick={() => { act.assign(pid, null); onClose(); }}>
          Retirer de ce jour
        </button>
      )}
      <button className={bouton({ teinte: "bleu", large: true })} onClick={() => act.sheet({ type: "person", id: pid })}>
        Modifier la fiche
      </button>
    </Sheet>
  );
}

/* ============================================================
   Fiche compagnon — création et modification
   ============================================================ */

/* Un compagnon en cours de saisie : `id` vaut null tant qu'il n'est pas
   enregistré. normPerson ne lit pas ce champ. */
type BrouillonPersonne = Omit<Person, "id"> & { id: string | null };

export function EditPerson({ vue, act, synchro, pid, onClose }: Base & { synchro: Synchro; pid: string | null }){
  const trouve = pid ? vue.person(pid) : undefined;
  const base: BrouillonPersonne = trouve ?? {
    id: null, name: "", phone: "", email: "",
    days: [true, true, true, true, true, false, false], permis: false,
    sk: { elec: 1, plomb: 1, platre: 1, peint: 1, menuis: 1 }, note: ""
  };
  const [d, setD] = useState<BrouillonPersonne>(() => JSON.parse(JSON.stringify(base)));
  const [ouverture] = useState<BrouillonPersonne>(() => JSON.parse(JSON.stringify(base)));
  const [armed, setArmed] = useState(false);
  const supprimeIci = useRef(false);
  useFermeSiDisparu(!pid || !!trouve, onClose, act, "Ce compagnon", supprimeIci);
  if (pid && !trouve) return null;
  const n = countDays(d.days);

  const save = () => {
    if (!d.name.trim()) return act.toast(html`Il manque le nom`);
    if (!d.days.some(Boolean)) return act.toast(html`Il faut au moins un jour de présence`);
    if (d.phone.trim() && !normPhone(d.phone)) return act.toast(html`Ce numéro n'a pas l'air valide`);
    if (d.email.trim() && !normEmail(d.email)) return act.toast(html`Cette adresse e-mail n'est pas valide`);
    const rec = normPerson(pid || nouvelId("p_"), d as unknown as Partial<Person>);
    if (pid) {
      const { id: _id, ...apres } = rec;
      const { id: _id0, ...avant } = normPerson(pid, ouverture as unknown as Partial<Person>);
      const champs = ecart(avant, apres);
      if (Object.keys(champs).length) synchro.geste({ type: "modifierCompagnon", compagnon: pid, champs });
    } else synchro.geste({ type: "creerCompagnon", compagnon: rec });
    onClose();
    act.toast(html`<b>${rec.name}</b> ${pid ? "enregistré" : "ajouté au vivier"}`);
  };

  return (
    <Sheet title={pid ? base.name : "Nouveau compagnon"}
      sub={pid ? "Fiche compagnon" : "Ajouter au vivier"} onClose={onClose}>

      <Champ libelle="Nom">
        <input className={TEXTE} type="text" value={d.name} placeholder="Prénom"
          onChange={e => setD({ ...d, name: e.target.value })} />
      </Champ>

      <Champ libelle="Adresse e-mail">
        <input className={TEXTE} type="email" inputMode="email" autoComplete="email" value={d.email}
          placeholder="erwan@exemple.fr"
          onChange={e => setD({ ...d, email: e.target.value })} />
        <p className={indice}>C'est par là que part la demande de disponibilité du samedi,
          automatiquement. Sans adresse, le compagnon ne la reçoit pas.</p>
      </Champ>

      <Champ libelle="Téléphone">
        <input className={TEXTE} type="tel" inputMode="tel" autoComplete="tel" value={d.phone}
          placeholder="06 12 34 56 78"
          onChange={e => setD({ ...d, phone: e.target.value })} />
        <p className={indice}>Pour l'appeler ou lui écrire depuis sa fiche. Les numéros français
          sont convertis au format international.</p>
      </Champ>

      <Champ libelle="Disponibilité habituelle">
        <DayPicker nom="Disponibilité habituelle" value={d.days}
          onToggle={i => { const days = d.days.slice(); days[i] = !days[i]; setD({ ...d, days }); }} />
        <p className={indice}>
          {plur(n, "jour")} par semaine, soit {n} j·h fournis.
          {(d.days[5] || d.days[6]) && " Week-end compris."}
        </p>
      </Champ>

      <Champ libelle="Permis de conduire">
        <div className={GROUPE}>
          <button className={CHOIX} aria-pressed={d.permis} onClick={() => setD({ ...d, permis: true })}>Oui</button>
          <button className={CHOIX} aria-pressed={!d.permis} onClick={() => setD({ ...d, permis: false })}>Non</button>
        </div>
        <p className={indice}>Le moteur de composition garde au moins un permis par équipe,
          pour l'amenée matérielle.</p>
      </Champ>

      <Champ libelle="Compétences · niveau 1 à 5">
        <div>
          {SKILLS.map(sk => (
            <div className="flex items-center gap-2.5 border-t border-t-line py-2.25 first:border-t-0" key={sk.id} data-niveau={sk.id}>
              <span className="flex flex-1 items-center gap-2 font-body text-[14px]/[1.2] font-medium">
                <span className={PASTILLE} style={{ background: sk.c }} />{sk.label}
              </span>
              <span className="flex gap-1">
                {[1, 2, 3, 4, 5].map(v => (
                  /* Le niveau retenu prend la teinte du métier (du domaine, par style). */
                  <button key={v} aria-pressed={d.sk[sk.id] === v}
                    /* Cinq niveaux de 27 px à 4 px d'écart : 2 px de plus
                       chacun au doigt (31 px ; WCAG 2.5.8). */
                    data-cible="serree"
                    className={cn(cibleSerree["2px"], "size-6.75 rounded-[7px] border border-line-2 bg-surface-2 font-mono text-[12px]/none font-semibold text-muted aria-pressed:border-transparent aria-pressed:text-on-blue")}
                    style={d.sk[sk.id] === v ? { background: sk.c } : undefined}
                    onClick={() => setD({ ...d, sk: { ...d.sk, [sk.id]: v } })}>{v}</button>
                ))}
              </span>
            </div>
          ))}
        </div>
      </Champ>

      <Champ libelle="Remarque">
        <input className={TEXTE} type="text" value={d.note} placeholder="Spécialité, contrainte…"
          onChange={e => setD({ ...d, note: e.target.value })} />
      </Champ>

      <button className={bouton({ teinte: "primaire", large: true })} onClick={save}>
        {pid ? "Enregistrer" : "Ajouter au vivier"}
      </button>
      {pid && (
        <button className={bouton({ teinte: "danger", large: true })} onClick={() => {
          if (!armed) return setArmed(true);
          supprimeIci.current = true;
          act.deletePerson(pid); onClose();
        }}>{armed ? "Confirmer la suppression" : "Supprimer " + base.name}</button>
      )}
    </Sheet>
  );
}

/* ============================================================
   Fiche chantier
   ============================================================ */

/* Un chantier en cours de saisie : `id` vaut null tant qu'il n'est pas
   enregistré. */
type BrouillonChantier = Omit<Site, "id"> & { id: string | null };

export function EditSite({ vue, act, synchro, sid, onClose }: Base & { synchro: Synchro; sid: string | null }){
  const trouve = sid ? vue.site(sid) : undefined;
  const base: BrouillonChantier = trouve ?? {
    id: null, code: "", addr: "", start: todayISO(), months: 2, coef: 1,
    ph: Array(12).fill(0), note: "", plan: {}, tasks: {}
  };
  const [d, setD] = useState(() => ({
    code: base.code, addr: base.addr, start: base.start, months: base.months, coef: base.coef
  }));
  const [ouverture] = useState(d);
  /* Le code se déduit de l'adresse tant qu'on ne l'a pas écrit soi-même. */
  const [auto, setAuto] = useState(!base.code || base.code === codeFromAddr(base.addr));
  const [armed, setArmed] = useState(false);
  const supprimeIci = useRef(false);
  useFermeSiDisparu(!sid || !!trouve, onClose, act, "Ce chantier", supprimeIci);
  if (sid && !trouve) return null;

  const COEFS = [{ v: 0.7, l: "Studio" }, { v: 1, l: "T2 · T3" }, { v: 1.4, l: "T4 et +" }];
  const tot = Math.round(TOTAL_JH * d.coef);
  const weeks = Math.round(d.months * 4.33);

  const setAddr = (addr: string) => {
    const next = { ...d, addr };
    if (auto) next.code = codeFromAddr(addr);
    setD(next);
  };

  const save = () => {
    const code = d.code.trim().toUpperCase();
    if (!code) return act.toast(html`Il manque le code chantier`);
    const champs = { code, addr: d.addr.trim(), start: d.start || todayISO(), months: d.months, coef: d.coef };
    if (sid) {
      const modifies = ecart(ouverture, champs);
      if (Object.keys(modifies).length) synchro.geste({ type: "modifierChantier", site: sid, champs: modifies });
    } else synchro.geste({ type: "creerChantier", chantier: normSite(nouvelId("s_"), {
      ph: Array(12).fill(0), note: "", plan: {}, tasks: {}, ...champs
    }) });
    onClose();
    act.toast(html`<b>${code}</b> ${sid ? "enregistré" : "ouvert"}`);
  };

  return (
    <Sheet title={sid ? base.code : "Nouveau chantier"}
      sub={sid ? base.addr : "Adresse, puis le code se remplit tout seul"} onClose={onClose}>

      <Champ libelle="Adresse">
        <input className={TEXTE} type="text" value={d.addr} placeholder="151 Henri Desbals apt 7"
          onChange={e => setAddr(e.target.value)} />
      </Champ>

      <Champ libelle="Code chantier">
        <input className={TEXTE} type="text" value={d.code} placeholder="151HD7" autoCapitalize="characters"
          onChange={e => { setD({ ...d, code: e.target.value }); setAuto(false); }} />
        <p className={indice}>
          {auto
            ? "Proposé depuis l'adresse : numéro de voie + initiales de la rue + numéro d'appartement."
            : "Code saisi à la main : il ne suivra plus l'adresse."}
        </p>
      </Champ>

      <Champ libelle="Début">
        <input className={TEXTE} type="date" value={d.start} onChange={e => setD({ ...d, start: e.target.value })} />
      </Champ>

      <Champ libelle="Durée annoncée">
        <div className={GROUPE}>
          {[2, 3, 4].map(m => (
            <button key={m} className={CHOIX} aria-pressed={d.months === m}
              onClick={() => setD({ ...d, months: m })}>{m} mois</button>
          ))}
        </div>
      </Champ>

      <Champ libelle="Volume">
        <div className={GROUPE}>
          {COEFS.map(c => (
            <button key={c.v} className={CHOIX} aria-pressed={d.coef === c.v}
              onClick={() => setD({ ...d, coef: c.v })}>{c.l}</button>
          ))}
        </div>
        <p className={indice}>
          Charge de référence : <b>{tot} jours-homme</b> sur les 12 étapes. Réparti sur{" "}
          {weeks} semaines, il faut environ <b>{Math.max(1, Math.ceil(tot / (weeks * 4.6)))} compagnons</b> à plein temps.
        </p>
      </Champ>

      <button className={bouton({ teinte: "primaire", large: true })} onClick={save}>
        {sid ? "Enregistrer" : "Ouvrir le chantier"}
      </button>
      {sid && (
        <button className={bouton({ teinte: "danger", large: true })} onClick={() => {
          if (!armed) return setArmed(true);
          supprimeIci.current = true;
          synchro.geste({ type: "supprimerChantier", site: sid });
          onClose();
          act.toast(html`<b>${base.code}</b> supprimé`);
        }}>{armed ? "Confirmer — l'équipe sera libérée" : "Supprimer le chantier"}</button>
      )}
    </Sheet>
  );
}

/* ============================================================
   Composer une équipe pour un chantier
   ============================================================ */

export function SuggestSheet({ vue, ui, act, sid, onClose }: Base & { ui: UiCoque; sid: string }){
  const trouve = vue.site(sid);
  useFermeSiDisparu(!!trouve, onClose, act, "Ce chantier");
  return trouve ? <Composer vue={vue} ui={ui} act={act} s={trouve} onClose={onClose} /> : null;
}

function Composer({ vue, ui, act, s, onClose }: Base & { ui: UiCoque; s: Site }){
  const sid = s.id;
  const week = ui.week;
  const day = addDays(week, ui.day);
  const dates = weekDates(week);
  const [scope, setScope] = useState<"day" | "week">("week");
  const reco = neededHeadcount(s, week);
  const [size, setSize] = useState(Math.max(2, Math.min(5, reco || weekRoster(s, week).length || 3)));

  const person = (id: string) => vue.person(id);
  const isFreeOn = (pid: string, d: string) => !vue.sites.some(x => teamOn(x, d).includes(pid));
  const usable = (p: Person) => (scope === "day" ? [day] : dates).filter(d =>
    vue.availableOn(p.id, d) && (isFreeOn(p.id, d) || teamOn(s, d).includes(p.id))).length;
  const wasYest = (p: Person) => teamOn(s, addDays(day, -1)).includes(p.id);

  const r = useMemo(() => suggestTeam(s, size, week, vue.people, usable, wasYest),
    [sid, size, scope, week, ui.day, vue]);

  const cov = coverage(r.team.map(t => t.p.id), person);
  const blocked = uncovered(s, r.team.map(t => t.p.id), person).sort((a, b) => a.phase - b.phase);
  const maxNeed = Math.max(...SK.map(k => r.need.need[k]), 0.001);
  const cap = r.team.reduce((a, t) => a + t.days, 0);
  const rest = Math.round(loadLeft(s));
  const endWeeks = cap && scope === "week" ? Math.ceil(rest / cap) : 0;
  const cur = currentPhase(s);

  return (
    <Sheet title={"Composition · " + s.code}
      sub={"Étape " + (cur + 1) + " — " + PHASES[cur].n} onClose={onClose}>

      <Champ libelle="Poser sur">
        <div className={GROUPE}>
          <button className={CHOIX} aria-pressed={scope === "day"} onClick={() => setScope("day")}>
            {DAYS_L[ui.day]} {parse(day).getDate()}
          </button>
          <button className={CHOIX} aria-pressed={scope === "week"} onClick={() => setScope("week")}>
            Semaine {weekNum(week)}
          </button>
        </div>
      </Champ>

      <div className={encart()} data-encart>
        Il reste <b>{rest} j·h</b>. Pour tenir la date annoncée ({fmtDay(addDays(span(s).last, 6))}),
        il faudrait environ <b>{reco} compagnons</b>.
        {cap > 0 && <> Cette équipe pose <b>{plur(cap, "journée")}</b>
          {endWeeks > 0 && <>, soit une fin en <b>{plur(endWeeks, "semaine")}</b></>}.</>}
      </div>

      <Champ libelle="Taille de l'équipe">
        <div className={GROUPE}>
          {[2, 3, 4, 5].map(k => (
            <button key={k} className={CHOIX} aria-pressed={k === size} onClick={() => setSize(k)}>{k}</button>
          ))}
        </div>
      </Champ>

      <div>
        {r.team.length ? r.team.map((t, i) => (
          /* Les rangées entrent en cascade (rangee-in), 40 ms l'une après
             l'autre ; sous le mouvement réduit, ensemble et d'un coup. */
          <div className={cn(LIGNE, "items-start animate-[rangee-in_.3s_cubic-bezier(.22,.9,.3,1)_backwards]")}
            key={t.p.id} data-compagnon={t.p.id}
            style={{ animationDelay: mouvementReduit() ? undefined : i * 40 + "ms" }}>
            <span className="w-4.5 flex-none font-mono text-[12px]/[1.4] font-semibold text-accent-texte">{i + 1}</span>
            <span>
              <span className="font-body text-[14.5px]/[1.2] font-semibold" data-nom>{t.p.name}</span>
              <Why reasons={t.why} className={RAISONS} />
              <span className={RAISONS} data-pourquoi><span className={etiquette()} data-etiquette>{plur(t.days, "j posable")}</span></span>
            </span>
          </div>
        )) : (
          <p className={indiceVide}>Personne de disponible et libre sur cette période.
            Changez de semaine, libérez quelqu'un, ou activez le mode urgence.</p>
        )}
      </div>

      <Champ libelle="Couverture des métiers restants">
        <div className={COUVERTURE}>
          {SKILLS.map(sk => {
            const share = r.need.need[sk.id] / maxNeed;
            const req = r.need.soon[sk.id];
            const short = req && cov[sk.id] < req;
            return (
              <div className={LIGNE_COUVERTURE} key={sk.id} data-couverture={sk.id}>
                <span className={METIER}><span className={PASTILLE} style={{ background: sk.c }} />{sk.label}</span>
                <span className="relative h-2.25 flex-1 overflow-hidden rounded-[3px] bg-surface-3">
                  {/* La barre pousse depuis la gauche à l'ouverture (couverture-in,
                      le compositeur) ; quand l'équipe change, sa largeur suit. */}
                  <b className="absolute inset-y-0 left-0 block origin-left animate-[couverture-in_.35s_cubic-bezier(.22,.9,.3,1)] [transition:width_.3s_cubic-bezier(.22,.9,.3,1)]"
                    style={{ width: (cov[sk.id] / 5 * 100) + "%", background: short ? "var(--urgence)" : sk.c,
                             opacity: 0.35 + 0.65 * share }} />
                </span>
                <span className={cn("w-8.5 text-right font-mono text-[11px]/none font-semibold", short ? "text-urgence-texte" : "text-muted")}>
                  {cov[sk.id]}{req ? "/" + req : ""}
                </span>
              </div>
            );
          })}
        </div>
        <p className={indice}>La longueur donne le meilleur niveau de l'équipe, le chiffre celui que
          les missions proches exigent. En fuchsia, le compte n'y est pas.</p>
      </Champ>

      {blocked.length > 0 && (
        <Champ libelle="Missions hors de portée">
          <ul className="mx-0 mt-2 mb-0.5 flex flex-col gap-0.75 overflow-hidden p-0">
            {blocked.slice(0, 5).map((b, i) => (
              <li key={i} className="block list-none text-[11.5px]/[1.4] text-ink-2 before:text-muted before:content-['\2013']">
                {b.task.t} — {skLabel(b.task.sk!)} niv. {b.need} requis,{" "}
                {b.have || "aucun"} dans l'équipe</li>
            ))}
          </ul>
          <p className={indice}>Le reste du chantier avance, mais pas ces missions-là.</p>
        </Champ>
      )}

      {r.team.length > 0 && (
        <button className={bouton({ teinte: "primaire", large: true })}
          onClick={() => { act.applyTeam(sid, r.team.map(t => t.p.id), scope === "day" ? [day] : dates); onClose(); }}>
          Affecter
        </button>
      )}
    </Sheet>
  );
}

/* ============================================================
   Répartir toute l'équipe sur la semaine
   ============================================================ */

export function OptimizeSheet({ vue, ui, act, onClose }: Base & { ui: UiCoque }){
  const week = ui.week;
  const dates = weekDates(week);
  /* Recalculé quand les données changent, comme avant W4. */
  const res = useMemo(
    () => optimizeWeek(vue.sites, vue.people, week, (pid, d) => vue.availableOn(pid, d)),
    [week, vue]);
  const [openDay, setOpenDay] = useState(ui.day);

  if (!res.targets.length) return (
    <Sheet title="Répartir la semaine" sub={fmtRange(week)} onClose={onClose}>
      <div className={encart(true)} data-encart>Aucun chantier actif à pourvoir cette semaine.</div>
    </Sheet>
  );

  const seen = new Set<string>();
  const gaps = res.gaps.filter(g => {
    const k = g.site.id + "#" + g.sk + "#" + g.need;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, 6);

  return (
    <Sheet title="Répartir la semaine"
      sub={"Semaine " + weekNum(week) + " · " + fmtRange(week)} onClose={onClose}>

      <div className={encart()} data-encart>
        <b>{res.posed}</b> journée{res.posed > 1 ? "s" : ""} répartie{res.posed > 1 ? "s" : ""} sur{" "}
        <b>{res.targets.length}</b> chantier{res.targets.length > 1 ? "s" : ""}. Chaque nom porte la
        raison de sa présence : le seuil qu'il débloque, le métier qu'il couvre, ou la continuité
        avec la veille.
      </div>

      {gaps.length > 0 && (
        <Champ libelle="Ce que personne ne couvre">
          <div className={COUVERTURE}>
            {gaps.map((g, i) => (
              <div className={LIGNE_COUVERTURE} key={i} data-couverture={g.sk}>
                <span className={METIER}><span className={PASTILLE} style={{ background: skColor(g.sk) }} />{g.site.code}</span>
                <span className="flex-1 text-[11.5px] text-ink-2">
                  {skLabel(g.sk)} niv. {g.need} requis, {g.have || "aucun"} sur place
                </span>
              </div>
            ))}
          </div>
          <p className={indice}>Ces missions demandent un niveau que l'équipe du jour n'atteint pas.
            Le travail peut avancer, mais pas celles-là.</p>
        </Champ>
      )}

      <div>
        {dates.map((d, i) => {
          const total = res.targets.reduce((a, s) => a + ((res.plan[s.id] || {})[d] || []).length, 0);
          const idle = vue.people.filter(p => vue.availableOn(p.id, d) &&
            !res.targets.some(s => ((res.plan[s.id] || {})[d] || []).includes(p.id)));
          return (
            <Acc key={d} open={openDay === i} onToggle={() => setOpenDay(openDay === i ? -1 : i)}
              label={DAYS_L[i] + " " + fmtDay(d)}
              right={<span className="font-mono text-[10px]/none font-medium text-muted">{total}</span>}>
              {res.targets.map(s => {
                const ids = (res.plan[s.id] || {})[d] || [];
                if (!ids.length) return null;
                return (
                  <div className="flex items-start gap-2.25 border-t border-t-line py-1.75 first:border-t-0" key={s.id} data-chantier={s.id}>
                    <span className="w-14 flex-none font-mono text-[12px]/[1.5] font-semibold tracking-[-.02em]" data-code>{s.code}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      {ids.map(pid => (
                        <span className="flex flex-wrap items-center gap-1.25" key={pid} data-affecte={pid}>
                          <b className="font-body text-[13px]/[1.2] font-semibold">{vue.person(pid)?.name}</b>
                          <Why reasons={res.why[s.id + "#" + d + "#" + pid]} />
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })}
              {total === 0 && <p className={indiceVide}>Personne de disponible.</p>}
              {idle.length > 0 && (
                <p className={indiceVide}>Non affectés : {idle.map(p => p.name).join(", ")}</p>
              )}
            </Acc>
          );
        })}
      </div>

      <button className={bouton({ teinte: "primaire", large: true })}
        onClick={() => { act.applyPlan(res, dates); onClose(); }}>
        Appliquer ce plan
      </button>
      <p className={indice}>Le plan actuel de la semaine sera remplacé sur ces chantiers.</p>
    </Sheet>
  );
}

/* ============================================================
   Demander les disponibilités
   ============================================================ */

/* Le lien d'une demande déjà connue, sans passer par le réseau : c'est
   la même adresse que celle que le serveur construit. */
const lienDe = (token: string): string =>
  location.origin + location.pathname.replace(/[^/]*$/, "") + "dispo.html?t=" + token;

/* Copier un texte qui n'existe qu'après une requête. Safari n'autorise
   l'écriture du presse-papiers que pendant le geste de l'utilisateur :
   une promesse passée à ClipboardItem garde ce geste ouvert le temps
   que la réponse arrive. */
async function copierApres(texte: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({
      "text/plain": texte.then(t => new Blob([t], { type: "text/plain" }))
    })]);
    return;
  }
  await navigator.clipboard?.writeText(await texte);
}

export function AvailSheet({ vue, act, source, week, onClose }: Base & { source: Source; week: string }){
  const [attente, setAttente] = useState<string | null>(null);     // compagnon dont le lien se prépare
  const [erreur, setErreur] = useState<string | null>(null);
  const targets = vue.people.filter(p => p.email);
  const noMail = vue.people.filter(p => !p.email);
  const head = "Semaine " + weekNum(week) + " · " + fmtRange(week);

  if (source === "local") return (
    <Sheet title="Demander les dispos" sub={head} onClose={onClose}>
      <div className={encart(true)} data-encart>Cette fonction a besoin de la base : le compagnon ouvre un
        lien qui doit exister quelque part. Connectez-vous, puis revenez ici.</div>
    </Sheet>
  );

  if (!targets.length) return (
    <Sheet title="Demander les dispos" sub={head} onClose={onClose}>
      <div className={encart(true)} data-encart>Aucune adresse e-mail enregistrée.</div>
      <p className={indice}>Ouvrez une fiche compagnon depuis l'onglet Équipe et ajoutez son adresse :
        l'envoi automatique du samedi s'en servira.</p>
    </Sheet>
  );

  /* Le lien d'un compagnon : déjà connu, ou créé maintenant. Un
     compagnon supprimé entre-temps donne une erreur dite en clair, pas
     un écran blanc (constat U18). */
  const url = async (p: Person): Promise<string> => {
    const a = vue.availOf(p.id, week);
    if (a) return lienDe(a.token);
    setAttente(p.id); setErreur(null);
    try { return await act.lienDispo(p.id, week); }
    catch (e) { setErreur((e as Error)?.message || "erreur réseau"); throw e; }
    finally { setAttente(null); }
  };

  return (
    <Sheet title="Demander les dispos" sub={head} onClose={onClose}>
      <div className={encart()} data-encart>
        Les demandes partent <b>automatiquement chaque samedi</b> par e-mail. Cet écran sert à
        relancer à la main, ou à récupérer un lien pour l'envoyer par SMS.
      </div>

      {erreur && <div className={encart(true)} data-encart>Impossible de créer le lien : {erreur}</div>}

      {targets.map(p => {
        const a = vue.availOf(p.id, week);
        return (
          <div className={cn(LIGNE, "items-center")} key={p.id} data-compagnon={p.id}>
            <span className="min-w-0 flex-1">
              <span className="font-body text-[14.5px]/[1.2] font-semibold" data-nom>{p.name}</span>
              <span className={RAISONS} data-pourquoi>
                {a?.days
                  ? <span className={cn(etiquette(), "text-ok-texte")} data-etiquette>
                      {countDays(a.days) ? DAYS.filter((d, i) => a.days![i]).join(" ") : "aucun jour"}
                    </span>
                  : a ? <span className={etiquette()} data-etiquette>en attente</span> : null}
                <span className={etiquette()} data-etiquette>{p.email}</span>
              </span>
            </span>
            <span className="flex flex-none gap-1.25">
              {p.phone && (
                <button className={bouton({ taille: "petit" })} disabled={attente === p.id}
                  onClick={() => { url(p).then(u => { location.href = smsHref(p.phone, msgFor(p, week, u)); }, () => {}); }}>
                  SMS
                </button>
              )}
              <button className={bouton({ taille: "petit" })} disabled={attente === p.id}
                onClick={() => {
                  copierApres(url(p)).then(() => act.toast(html`Lien copié`), () => {});
                }}>
                {attente === p.id ? "…" : "Lien"}
              </button>
            </span>
          </div>
        );
      })}

      {noMail.length > 0 && (
        <p className={indice}>Sans adresse e-mail, donc non relancés : {noMail.map(p => p.name).join(", ")}.</p>
      )}
    </Sheet>
  );
}

const msgFor = (p: Person, week: string, url: string): string =>
  `Bonjour ${p.name}, peux-tu m'indiquer tes jours de présence pour la semaine du ${fmtRange(week)} ? ` +
  `Ça prend 30 secondes : ${url}`;
const smsHref = (tel: string, body: string): string => "sms:" + tel + "?&body=" + encodeURIComponent(body);

/* ============================================================
   Données
   ============================================================ */

interface DataProps extends Base {
  source: Source;
  email: string;
  etat: EtatBouton;
  enAttente: number;
  stockagePlein: boolean;
  relancer: () => void;
  deconnecter: () => void;
}

export function DataSheet({ vue, act, source, email, enAttente, stockagePlein, relancer, deconnecter, onClose }: DataProps){
  const sons = useUi(s => s.sons);
  const [txt, setTxt] = useState("");
  /* Remplacer toutes les données se confirme : avant W4, un fichier
     choisi par erreur écrasait tout, sans question (constat U7). */
  const [arme, setArme] = useState(false);
  /* Ce que contient la sauvegarde, si elle a la bonne forme. */
  const lue = useMemo(() => {
    try {
      const d = JSON.parse(txt) as { people?: unknown; sites?: unknown };
      return Array.isArray(d.people) && Array.isArray(d.sites) ? { people: d.people.length, sites: d.sites.length } : null;
    } catch { return null; }
  }, [txt]);

  const where = source === "local"
    ? "Aucun serveur configuré : les données restent dans ce navigateur."
    : "Connecté en tant que " + email + ". Les données sont " +
      (source === "api" ? "sur le serveur de Geoplan" : "sur votre base Supabase") +
      " et se mettent à jour en direct sur tous vos appareils.";

  return (
    <Sheet title="Données"
      sub={source === "local" ? "Stockage local" : "Synchronisé"}
      onClose={onClose}>

      {enAttente > 0 && (
        <div className={encart(true)} data-encart>
          <b>{enAttente}</b> modification{enAttente > 1 ? "s" : ""} en attente d'envoi.
          Elles sont conservées ici et repartiront dès que la liaison sera rétablie.
        </div>
      )}
      {stockagePlein && (
        <div className={encart(true)} data-encart>
          Le stockage de ce navigateur est plein : ce qui attend d'être envoyé ne survivrait pas à une
          fermeture de l'application. Gardez-la ouverte jusqu'au retour du réseau.
        </div>
      )}

      <p className={indice}>{where}</p>

      <Champ libelle="Contenu">
        <p className={indice}><b>{vue.people.length}</b> compagnons · <b>{vue.sites.length}</b> chantiers</p>
      </Champ>

      {/* Le son des gestes (ui/son.ts) : désactivé par défaut, retenu sur
          cet appareil. L'activer fait entendre le son d'une puce posée —
          et, sur l'iPhone, c'est cet appui qui autorise le son. */}
      <Champ libelle="Sur cet appareil">
        <Interrupteur variante="reglage" checked={sons}
          onCheckedChange={v => { patchUi({ sons: v }); if (v) { eveillerSon(); jouerSon("pose"); } }}>
          Sons des gestes
        </Interrupteur>
        <p className={indice}>Une note brève quand on pose ou retire un compagnon. Elle se tait avec le bouton
          de silence de l'iPhone.</p>
      </Champ>

      {enAttente > 0 && (
        <button className={bouton({ teinte: "bleu", large: true })} onClick={() => { relancer(); onClose(); act.toast(html`Envoi relancé`); }}>
          Réessayer l'envoi
        </button>
      )}

      <button className={bouton({ large: true })} onClick={act.exportBackup}>Exporter un fichier de sauvegarde</button>

      <Champ libelle="Restaurer">
        <input className={FICHIER} type="file" accept="application/json,.json" aria-label="Fichier de sauvegarde" onChange={e => {
          const f = e.target.files?.[0];
          if (!f) return;
          const rd = new FileReader();
          rd.onload = () => { setTxt(String(rd.result)); setArme(false); };
          rd.readAsText(f);
        }} />
        <p className={indice}>Ou collez le contenu d'une sauvegarde :</p>
        <textarea className={ZONE_TEXTE} aria-label="Contenu d'une sauvegarde" value={txt} onChange={e => { setTxt(e.target.value); setArme(false); }}
          placeholder='{ "app": "geoplan", … }' />
        {arme && lue && (
          <div className={encart(true)} data-encart>
            Les <b>{plur(lue.people, "compagnon")}</b> et <b>{plur(lue.sites, "chantier")}</b> de la
            sauvegarde vont remplacer les {plur(vue.people.length, "compagnon")} et{" "}
            {plur(vue.sites.length, "chantier")} actuels, sur tous les appareils.
          </div>
        )}
        <button className={bouton({ teinte: "danger" })} onClick={() => {
          /* Illisible : refusé tout de suite, comme avant W4. */
          if (!lue) { act.importBackup(txt); onClose(); return; }
          if (!arme) return setArme(true);
          act.importBackup(txt); onClose();
        }}>
          {arme ? "Confirmer : tout sera remplacé" : "Remplacer les données"}
        </button>
      </Champ>

      {source !== "local" && (
        <button className={bouton({ large: true })} onClick={() => { deconnecter(); onClose(); }}>
          Se déconnecter
        </button>
      )}
    </Sheet>
  );
}
