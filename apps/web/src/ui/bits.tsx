/* ============================================================
   Geoplan — briques d'interface partagées
   ============================================================ */

import { useId, type ReactNode } from "react";
import { SKILLS, DAYS, WEEKEND, skColor, type Person } from "@geoplan/domain";
import { anneauDedans, cibleRangee, cn, surtitre } from "./primitives/classes";
import { Repli } from "./mouvement/repli";

export { Mark } from "./marque";

/* Le niveau d'une compétence : des barres empilées, de bas en haut. */
export function Meter({ level, color, max = 5 }: { level: number; color: string; max?: number }){
  return (
    <span className="flex flex-col-reverse items-center gap-[1.5px]">
      {Array.from({ length: max }, (_, i) => (
        <s key={i} className="block h-[3.5px] w-3 rounded-[1px] no-underline"
          style={{ background: i < level ? color : "var(--surface-3)" }} />
      ))}
    </span>
  );
}

/* Sept pastilles : les jours où le compagnon est posé sur ce chantier.
   Une pastille fuchsia signale une journée posée alors qu'il s'est
   déclaré absent. */
export function Pips({ on, bad }: { on: boolean[]; bad: boolean[] }){
  const absent = on.some((v, i) => v && bad[i]);
  return (
    <span className="flex items-center gap-[1.5px]">
      {on.map((v, i) => {
        const etat = v ? (bad[i] ? "absent" : "pose") : undefined;
        /* Posé un jour où il s'est déclaré absent : une barre creuse, pas
           seulement d'une autre teinte (WCAG 1.4.1 : la couleur ne doit
           pas être le seul signe). */
        return (
          <s key={i} data-etat={etat} className={cn("block w-1 rounded-[1px] no-underline",
            WEEKEND[i] ? "h-2 self-center" : "h-2.75",
            etat === "absent" ? "border border-urgence bg-transparent" : etat === "pose" ? "bg-blue" : "bg-surface-3")} />
        );
      })}
      {absent && <span className="sr-only">, posé un jour où il s'est déclaré absent</span>}
    </span>
  );
}

export function SkillGrid({ person }: { person: Person }){
  return (
    <span className="flex flex-none gap-1.25">
      {SKILLS.map(sk => (
        <span className="flex w-4.75 flex-col items-center gap-0.75" key={sk.id} data-competence={sk.id}>
          <em className="font-display text-[8.5px]/none font-semibold tracking-[.03em] text-muted not-italic">{sk.ab}</em>
          <Meter level={person.sk[sk.id]} color={sk.c} />
        </span>
      ))}
    </span>
  );
}

/* Sélecteur de jours, réutilisé partout : fiche compagnon, présence sur
   un chantier, réponse du compagnon. */
export interface DayPickerProps {
  nom: string;                   // ce que choisissent ces jours : nomme le groupe
  value: boolean[];
  onToggle: (i: number) => void;
  dates?: string[];              // les dates ISO de la semaine, pour afficher le quantième
  disabled?: boolean[];          // jours marqués indisponibles (restent cliquables)
}

export function DayPicker({ nom, value, onToggle, dates, disabled }: DayPickerProps){
  return (
    <div className="flex gap-1" role="group" aria-label={nom}>
      {DAYS.map((d, i) => (
        <button key={i} type="button"
          aria-pressed={!!value[i]} data-indispo={disabled?.[i] || undefined} data-cible="serree"
          className={cn(cibleRangee["2px"], "group flex min-w-0 flex-1 flex-col items-center gap-0.75 rounded-[9px] border border-line-2 px-0.5 py-2",
            "aria-pressed:border-transparent aria-pressed:bg-blue",
            WEEKEND[i] ? "bg-transparent" : "bg-surface-2")}
          onClick={() => onToggle(i)}>
          <em className={cn("font-display text-[9.5px]/none font-semibold tracking-[.04em] text-muted not-italic group-aria-pressed:text-on-blue",
            disabled?.[i] && "line-through")}>{d}</em>
          {dates && <b className="font-mono text-[12px]/none font-semibold text-ink-2 group-aria-pressed:text-on-blue">
            {new Date(dates[i] + "T00:00:00").getDate()}</b>}
        </button>
      ))}
    </div>
  );
}

/* ---------- messages passagers ---------- */

/** Un message passager. `html` ne vient que du gabarit `html` (ui/html.ts),
    qui échappe tout ce qu'on y interpole : un nom n'est jamais du code
    (constat U8). `sortie` : il s'éteint, et quitte l'écran juste après
    (ui/etat.ts). */
export interface ToastItem { id: string; html: string; sortie?: boolean }

/* Centré par les marges, pas par translateX(-50%) : left:50% bornait la
   largeur à la moitié de l'écran (constat U15). Il entre et s'éteint en
   CSS (toast-in, toast-out : mouvement.css) ; Framer Motion l'animait
   aussi, par-dessus le CSS, avant W6. Graisse et ombre en propriétés
   directes (ADR-005, « Le prix d'un restyle »). Il ne prend pas le
   doigt : il couvre le milieu du vivier ouvert, et une puce lâchée là
   n'y retournait pas (constat U22). */
const TOAST = "pointer-events-none fixed inset-x-0 bottom-[calc(92px+env(safe-area-inset-bottom))] z-90 mx-auto w-max"
  + " max-w-[min(320px,calc(100vw-32px))] rounded-[11px] bg-ink px-3.75 py-2.5 text-center"
  + " font-body text-[13px]/[1.35] [font-weight:500] text-ground [box-shadow:var(--shadow-3)]"
  + " [&_b]:font-mono [&_b]:font-semibold";
const ENTREE_TOAST = "animate-[toast-in_.3s_cubic-bezier(.22,.9,.3,1)]";
/* Il reste éteint jusqu'à son départ, 180 ms plus tard. */
const SORTIE_TOAST = "animate-[toast-out_.18s_ease_forwards]";

export function Toasts({ items }: { items: ToastItem[] }){
  return (
    /* Une région vivante, toujours là : un lecteur d'écran annonce chaque
       message. aria-live explicite : Radix laisse ces régions audibles
       quand une feuille modale cache le reste de la page. */
    <div role="status" aria-live="polite">
      {items.map(t => (
        <div key={t.id} className={cn(TOAST, t.sortie ? SORTIE_TOAST : ENTREE_TOAST)} data-toast
          dangerouslySetInnerHTML={{ __html: t.html }} />
      ))}
    </div>
  );
}

/* ---------- accordéon ---------- */

export interface AccProps {
  open: boolean;
  onToggle: () => void;
  label: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}

/** Le chevron d'un volet : vers le bas fermé, vers le haut ouvert. */
export function Chevron({ haut }: { haut: boolean }){
  return (
    <span aria-hidden="true" className={cn("size-2 border-r-[1.6px] border-b-[1.6px] border-muted transition-transform duration-[.18s] ease-[ease]",
      haut ? "-rotate-135" : "mb-0.75 rotate-45")} />
  );
}

export function Acc({ open, onToggle, label, right, children }: AccProps){
  const id = useId();
  return (
    <div className="border-t border-line">
      {/* Empilés sans écart (les deux volets d'une fiche, les jours de
          « Répartir ») : 33 px au doigt, pas plus sans agrandir le dessin
          (WCAG 2.5.8). */}
      <button data-cible="serree" className={cn("flex w-full items-center gap-2 px-3 py-2.75 text-left active:bg-surface-2", anneauDedans)}
        onClick={onToggle} aria-expanded={open} aria-controls={id} id={id + "-titre"}>
        <span className={surtitre}>{label}</span>
        <span className="flex-1" />
        {right}
        <Chevron haut={open} />
      </button>
      <Repli ouvert={open} id={id} role="region" aria-labelledby={id + "-titre"}>
        <div className="px-3 pb-3">{children}</div>
      </Repli>
    </div>
  );
}

export const plur = (n: number, sing: string, plu?: string): string =>
  n + " " + (n > 1 ? (plu || sing + "s") : sing);
export { skColor };
