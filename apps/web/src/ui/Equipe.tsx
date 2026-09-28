/* ============================================================
   Onglet Équipe — l'effectif et ses disponibilités
   ============================================================ */

import { useRef, type ButtonHTMLAttributes } from "react";
import { SkillGrid } from "./bits";
import { bouton, carte, cn, indice, pile, surtitre } from "./primitives/classes";
import { useEntree } from "./mouvement/entree";
import {
  DAYS, DAYS_L, WEEKEND, weekNum, fmtDay,
  teamOn, weekRoster, avgLv, type Person
} from "@geoplan/domain";
import type { Actions, UiCoque, Vue } from "./types";

export interface EquipeProps {
  vue: Vue; ui: UiCoque; act: Actions;
  day: string;                 // date ISO du jour affiché
  dayIdx: number;
  askWeek: () => string;       // semaine visée par « Demander les dispos »
}

/* Le texte d'une carte de résumé, sous son surtitre. */
const RESUME = "m-0 mt-2 font-body text-[13.5px]/[1.5] font-normal text-ink-2";
/* Une carte en colonne : surtitre, aide, boutons. */
const COLONNE = "flex flex-col gap-2.25 p-3";

/* ---------- une ligne de l'effectif ---------- */

/* Le chantier de la semaine, ou « Libre ». */
const BADGE = "rounded-[5px] bg-surface-3 px-1.25 py-0.75 font-mono text-[10px]/none font-semibold";

/* L'état de la demande de disponibilité. Les fonds s'écrivent en
   color-mix srgb, comme avant (le modificateur de Tailwind mélange en oklab). */
const DEMANDE = "rounded-[5px] px-1.5 py-0.75 font-display text-[9.5px]/none font-semibold tracking-[.07em] uppercase";
const DEMANDES = {
  repondu: "bg-[color-mix(in_srgb,var(--ok)_15%,transparent)] text-ok-texte",
  relance: "bg-[color-mix(in_srgb,var(--warn)_15%,transparent)] text-warn-texte",
  "sans-email": "bg-surface-3 text-muted"
} as const;

/* Les sept jours de présence de la semaine. Posés en bleu ; en orange
   quand le compagnon les a déclarés lui-même pour cette semaine. Le
   week-end, un carré en pointillés, plein s'il vient. */
function Jours({ jours, repondu, nom }: { jours: boolean[]; repondu: boolean; nom: string }){
  return (
    <span data-jours-dispo data-repondu={repondu || undefined} className="flex gap-0.5"
      title={repondu ? "Jours déclarés par " + nom : undefined}>
      {DAYS.map((d, i) => {
        const on = !!jours[i];
        return (
          <s key={i} data-dispo={on || undefined}
            className={cn("block size-3.25 rounded-[3px] text-center font-display text-[8px]/[13px] font-semibold no-underline",
              WEEKEND[i] && (on ? "border border-transparent" : "border border-dashed border-line-2"),
              on ? (repondu ? "bg-accent text-on-accent" : "bg-blue text-on-blue")
                : cn(WEEKEND[i] ? "bg-transparent" : "bg-surface-3", "text-muted"))}>{d[0]}</s>
        );
      })}
    </span>
  );
}

/* Une ligne ajoutée pendant qu'on regarde la liste entre en fondu (CSS).
   Avant W6, Framer Motion faisait aussi glisser les lignes à leur place
   et effaçait celles qui partaient : une liste qui se retrie change
   maintenant d'un coup. */
function Ligne({ entre, className, ...props }: { entre: boolean } & ButtonHTMLAttributes<HTMLButtonElement>){
  const anime = useEntree(entre);
  return <button className={cn(className, anime && "animate-[fade_.2s_ease] motion-reduce:animate-none")} {...props} />;
}

export default function Equipe({ vue, ui, act, day, dayIdx, askWeek }: EquipeProps){
  const week = ui.week;
  /* Les compagnons du premier affichage. */
  const premiers = useRef<Set<string> | null>(null);
  premiers.current ??= new Set(vue.people.map(p => p.id));

  if (!vue.people.length) return (
    <div className={cn(carte, "flex flex-col items-center gap-3 px-4.5 py-6.5 text-center")} data-carte="vide">
      <h3 className="m-0 font-display text-[16px]/[1.25] font-bold">Aucun compagnon</h3>
      <p className="m-0 max-w-[30ch] text-[13px]/[1.55] text-muted">Ajoutez votre équipe : un nom, les jours de présence, le permis,
        et le niveau de 1 à 5 dans les cinq corps de métier.</p>
      <button className={bouton({ teinte: "primaire" })} onClick={() => act.sheet({ type: "person", id: null })}>
        Ajouter un compagnon
      </button>
    </div>
  );

  const sitesInWeek = (pid: string) => vue.sites.filter(s => weekRoster(s, week).includes(pid));
  const answered = (p: Person) => { const a = vue.availOf(p.id, week); return a?.days ? a : null; };
  const libre = vue.people.filter(p =>
    vue.availableOn(p.id, day) && !vue.sites.some(s => teamOn(s, day).includes(p.id))).length;
  const avecMail = vue.people.filter(p => p.email).length;
  const repondu = vue.people.filter(answered).length;
  const cible = askWeek();

  const sorted = vue.people.slice()
    .sort((a, b) => avgLv(b) - avgLv(a) || a.name.localeCompare(b.name));

  return (
    <div className={pile}>
      <div className={cn(carte, "p-3")} data-carte="effectif">
        <span className={surtitre}>Effectif · semaine {weekNum(week)}</span>
        <p className={RESUME}>
          <b>{vue.people.length}</b> compagnons. {DAYS_L[dayIdx]} {fmtDay(day)}, <b>{libre}</b>{" "}
          {libre > 1 ? "sont disponibles et non affectés" : "est disponible et non affecté"}.
          Touchez une ligne pour régler les niveaux, les jours de présence et le contact.
        </p>
      </div>

      <div className={cn(carte, COLONNE)} data-carte="dispos">
        <div className="flex items-center gap-2.25">
          <span className={cn(surtitre, "flex-1")}>Disponibilités · sem. {weekNum(week)}</span>
          <span data-reponses className="font-mono text-[10px]/none font-medium text-muted">{repondu}/{vue.people.length}</span>
        </div>
        <p className={indice}>
          Chaque samedi, un e-mail part tout seul avec un lien nominatif : le compagnon coche
          ses jours, et sa réponse remplace ici sa disponibilité habituelle pour cette semaine-là.
          {avecMail < vue.people.length &&
            <> <b>{vue.people.length - avecMail}</b>{" "}
              {vue.people.length - avecMail > 1 ? "fiches n'ont" : "fiche n'a"} pas d'adresse e-mail.</>}
        </p>
        <button className={bouton({ teinte: "bleu" })} onClick={() => act.sheet({ type: "avail", week: cible })}>
          Demander les dispos · semaine {weekNum(cible)}
          {cible !== week ? " (la prochaine)" : ""}
        </button>
      </div>

      <div className={carte} data-carte="compagnons">
          {sorted.map(p => {
            const on = sitesInWeek(p.id);
            const ans = answered(p);
            const req = vue.availOf(p.id, week);
            const eff = vue.daysOf(p, week);
            return (
              <Ligne key={p.id} data-personne={p.id} entre={!premiers.current!.has(p.id)}
                className="flex w-full items-center gap-2.75 border-t border-line px-3 py-2.75 text-left first-of-type:border-t-0"
                onClick={() => act.sheet({ type: "person", id: p.id })}>
                <span className="min-w-0 flex-1">
                  <span data-nom className="font-body text-[15px]/[1.2] font-semibold">{p.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                    {on.length
                      ? on.map(s => <span data-badge className={cn(BADGE, "text-ink-2")} key={s.id}>{s.code}</span>)
                      : <span data-badge className={cn(BADGE, "text-ok-texte")}>Libre</span>}
                    <Jours jours={eff} repondu={!!ans} nom={p.name} />
                    {ans ? <span data-demande="repondu" className={cn(DEMANDE, DEMANDES.repondu)}>a répondu</span>
                      : req ? <span data-demande="relance" className={cn(DEMANDE, DEMANDES.relance)}>relancé</span>
                      : !p.email ? <span data-demande="sans-email" className={cn(DEMANDE, DEMANDES["sans-email"])}>pas d'e-mail</span> : null}
                    {p.permis && <span>permis</span>}
                  </span>
                </span>
                <SkillGrid person={p} />
              </Ligne>
            );
          })}
      </div>

      <div className={cn(carte, COLONNE)} data-carte="sauvegarde">
        <span className={surtitre}>Sauvegarde</span>
        <p className={indice}>
          Un fichier à garder de côté, ou à transférer vers un autre appareil.
        </p>
        <button className={bouton()} onClick={act.exportBackup}>Exporter un fichier de sauvegarde</button>
        <button className={bouton()} onClick={() => act.sheet({ type: "data" })}>Restaurer une sauvegarde</button>
      </div>
    </div>
  );
}
