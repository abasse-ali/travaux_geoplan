/* ============================================================
   Geoplan — coque de l'application

   Elle lit trois choses : la vue des données affichées (le serveur, et
   les gestes pas encore confirmés par-dessus), l'état de l'interface
   (Zustand), et l'état de la synchronisation pour le bouton du haut.
   Les actions ajoutent des gestes à la file (ui/actions.ts).
   ============================================================ */

import { Component, lazy, memo, Suspense, useRef, useEffect, useLayoutEffect, useMemo, useState, useCallback,
  type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { mouvementReduit } from "./mouvement/reduit";
import { useEntree } from "./mouvement/entree";
import { useDrag } from "./useDrag";
import { Mark, Toasts, plur } from "./bits";
import { boutonIcone, cible, cn } from "./primitives/classes";
import { Onglet, Onglets, ListeOnglets, PanneauOnglet } from "./primitives/onglets";

const chargerFeuilles = () => import("./Feuilles");
const Feuilles = lazy(chargerFeuilles);
/* Sous un service worker, les feuilles viennent de son cache : elles ne
   coûtent rien au lancement, et elles se chargent tout de suite. Après un
   déploiement, le nouveau service worker s'installe pendant que cette
   page tourne encore, et à son activation il retire du cache l'ancien
   morceau, que le serveur n'a plus : chargé 1,2 s après l'ouverture de
   l'application, qui attend la session, il arrivait trop tard, et plus
   aucune fiche ne s'ouvrait jusqu'au relancement suivant (constat R1). */
if (navigator.serviceWorker?.controller) void chargerFeuilles().catch(() => undefined);
import Island from "./Island";
import Chantiers from "./Chantiers";
import Semaine from "./Semaine";
import Equipe from "./Equipe";
import {
  DAYS, WEEKEND, weekDates, weekNum, fmtRange, mondayOf,
  todayISO, addDays, dayIndex, parse, teamOn
} from "@geoplan/domain";
import { useEtatDonnees, useSynchro, useVue } from "../donnees/react";
import type { Synchro } from "../donnees/synchro";
import { Vue } from "../donnees/vue";
import { creerActions } from "./actions";
import { patchUi, toast, useUi } from "./etat";
import { html } from "./html";
import type { Actions, Tab, UiCoque, UiState } from "./types";

/* Ce que la coque lit de l'état d'interface : pas les toasts, ni la
   feuille ouverte, ni ce qui est déplié. Un toast, une feuille, une
   note dépliée ne redessinent donc qu'eux-mêmes, jamais toute
   l'application. */
const champsUi = (s: UiState): UiCoque => ({
  tab: s.tab, poolState: s.poolState, urgence: s.urgence, week: s.week, day: s.day
});

/* Les feuilles sont un morceau à part (ui/Feuilles.tsx) : l'ouverture du
   planning ne les paie pas. Sans service worker (première visite), elles
   se chargent dès que l'application est au repos, pas à la première
   feuille ouverte : déjà en mémoire, elles ne peuvent plus manquer.
   Ce composant suit seul l'état « une feuille est ouverte » : la coque
   ne se redessine pas quand une feuille s'ouvre. */
function FeuillesALaDemande(props: { vue: Vue; act: Actions; synchro: Synchro; ui: UiCoque }){
  const ouverte = useUi(s => s.sheet !== null);
  const [chargees, setChargees] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { chargerFeuilles().catch(() => undefined); }, 1200);
    return () => clearTimeout(t);
  }, []);
  if (ouverte && !chargees) setChargees(true);
  return chargees
    ? <BarriereFeuilles ouverte={ouverte}><Suspense fallback={null}><Feuilles {...props} /></Suspense></BarriereFeuilles>
    : null;
}

/* Si le morceau ne se charge quand même pas, la fiche ne s'ouvre pas, et
   on le dit, à chaque fiche demandée : le planning reste là. Sans cette
   barrière, l'erreur remontait à celle de toute l'application, qui
   remplaçait le planning par « Cet écran n'a pas pu s'afficher »
   (relecture adversariale de W5, test K4). Pas de nouvel essai : le
   navigateur garde l'échec d'un module jusqu'au rechargement. */
const feuillesEnEchec = () => {
  patchUi({ sheet: null });
  toast(html`Les fiches n'ont pas pu se charger : rechargez l'application`);
};
class BarriereFeuilles extends Component<{ ouverte: boolean; children: ReactNode }, { plante: boolean }> {
  state = { plante: false };
  static getDerivedStateFromError(): { plante: boolean } { return { plante: true }; }
  componentDidCatch(e: unknown): void { console.error("Feuilles en échec", e); feuillesEnEchec(); }
  componentDidUpdate(avant: { ouverte: boolean }): void {
    if (this.state.plante && this.props.ouverte && !avant.ouverte) feuillesEnEchec();
  }
  render(): ReactNode { return this.state.plante ? null : this.props.children; }
}

/* Le temps de relire la session : la marque seule, qui respire (boot-in,
   dans mouvement.css). Assez discret pour ne pas ressembler à un écran de plus.
   Connecté, deux attentes se suivent au lancement, celle de la racine
   (main.tsx) puis celle de la coque : la seconde reprend l'apparition là
   où la première l'a laissée (un délai négatif), au lieu de rallumer la
   marque depuis zéro (relecture adversariale de W6). */
let debutAttente: number | null = null;
export function Attente(){
  const [ecoule] = useState(() => {
    if (debutAttente === null) { debutAttente = performance.now(); return 0; }
    return performance.now() - debutAttente;
  });
  return (
    <div className="grid min-h-dvh place-items-center animate-[boot-in_.5s_ease_both]"
      style={ecoule ? { animationDelay: -Math.round(ecoule) + "ms" } : undefined}><Mark /></div>
  );
}

/* Le bouton d'état, selon l'état des envois : sa couleur, et celle du
   point (qui clignote pendant un envoi : sdot-pulse, dans mouvement.css). */
const ETAT = {
  ok: { bouton: "border-[color-mix(in_srgb,var(--ok)_35%,transparent)] text-ok-texte", point: "bg-ok" },
  off: { bouton: "border-[color-mix(in_srgb,var(--warn)_45%,transparent)] text-warn-texte", point: "bg-warn" },
  busy: { bouton: "border-line-2 text-muted", point: "bg-blue animate-[sdot-pulse_1.2s_ease-in-out_infinite]" },
  local: { bouton: "border-line-2 text-muted", point: "bg-muted" }
} as const;

/* Le bouton d'état : il est seul à suivre les envois. */
function BoutonEtat({ ouvrir }: { ouvrir: () => void }){
  const { etat, enAttente } = useEtatDonnees();
  return (
    <button data-etat={etat} onClick={ouvrir} aria-label="État des données"
      className={cn(cible, "flex h-8.5 flex-none items-center gap-1.25 rounded-[10px] border bg-surface-2 px-2.25",
        "font-display text-[9.5px]/none font-semibold tracking-[.07em] uppercase", ETAT[etat].bouton)}>
      <span className={cn("size-1.75 flex-none rounded-[50%]", ETAT[etat].point)} />
      {/* Rien à envoyer, mais aucune lecture n'a réussi depuis le
          lancement : « 0 en attente » n'était pas vrai (constat U29). */}
      <span>{etat === "ok" ? "À jour"
        : etat === "off" ? (enAttente ? enAttente + " en attente" : "Hors ligne")
        : etat === "local" ? "Local" : "…"}</span>
    </button>
  );
}

function ToastsUi(){
  return <Toasts items={useUi(s => s.toasts)} />;
}

/* Les flèches de la barre semaine. */
const FLECHE = cible + " grid size-8 flex-none place-items-center rounded-[9px] text-ink-2 active:bg-surface-3"
  + " [&_svg]:size-3.75 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[2.2]"
  + " [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]";

/* Le fond et le bord d'un jour de la bande : aujourd'hui est cerné
   d'orange, le week-end reste en retrait (sans fond, bord gris). Le
   jour choisi n'a ni l'un ni l'autre (primitives/onglets.tsx). */
const fondJour = (weekEnd: boolean, auj: boolean): string =>
  cn(auj ? "border-accent" : weekEnd ? "border-line" : "border-transparent",
    weekEnd ? "bg-transparent" : "bg-surface");

/* Le nom et le quantième d'un jour : au-dessus de la pastille, lisibles
   sur son orange quand le jour est choisi. Le week-end, en retrait : son
   quantième passe au gris (muted) — une opacité de 72 % tombait sous le
   seuil AA (2,4:1 pour le nom). */
const texteJour = "relative group-aria-selected:text-on-accent";

const ONGLETS: [Tab, string][] = [["chantiers", "Chantiers"], ["semaine", "Semaine"], ["equipe", "Équipe"]];

/* Les entrées de la coque sont des animations CSS : décidées à la
   naissance de l'élément, une fois. Une classe d'entrée ajoutée à un
   élément déjà là rejouerait l'animation — c'est ce que faisait une
   condition relue à chaque rendu (test K6). */

/* Le libellé de la semaine entre en glissant dans le sens de la
   navigation (mouvement.css), quand la semaine change : une clé par
   semaine. Au premier affichage, non. */
function LibelleSemaine({ entre, sens, children }: { entre: boolean; sens: number; children: ReactNode }){
  const [anime] = useState(() => !entre ? undefined : sens > 0
    ? "animate-[semaine-suivante_.2s_cubic-bezier(.22,.9,.3,1)]"
    : "animate-[semaine-precedente_.2s_cubic-bezier(.22,.9,.3,1)]");
  return (
    <b className={cn("block font-mono text-[12.5px]/[1.2] font-semibold tracking-[-.01em] text-ink-2 [grid-area:1/1]",
      "group-data-[hors-semaine]:text-accent-texte", anime)}>{children}</b>
  );
}

/* « Auj. » paraît (auj-in) quand on quitte aujourd'hui ; pas s'il est là
   dès le premier affichage. */
function BoutonAuj({ entre, onClick }: { entre: boolean; onClick: () => void }){
  const anime = useEntree(entre);
  return (
    <button
      className={cn(cible, "flex-none rounded-[8px] border border-accent px-2.25 py-1.5 text-accent-texte",
        "font-display text-[10px]/none font-semibold tracking-[.08em] uppercase",
        anime && "animate-[auj-in_.24s_var(--spring)]")}
      onClick={onClick}>Auj.</button>
  );
}

/* La bande des jours et la barre des onglets, à part et mémorisées. La
   coque se redessine à chaque changement des données (ses compteurs :
   chantiers ouverts, compagnons libres) ; ces deux barres n'en dépendent
   pas. En W4, c'étaient de simples boutons ; ce sont maintenant dix
   onglets de Radix, avec leurs contextes, leurs références et leurs
   effets : les redessiner à chaque mission cochée coûtait une demi-image
   par geste (mesure A/B, journal, W5). */

const choisirJour = (jour: number) => patchUi({ day: jour });

/* Sept jours : sur un chantier, le samedi se travaille. Le week-end
   reste visuellement en retrait, il est l'exception. Des onglets eux
   aussi (flèches du clavier), sans panneau à eux : le jour choisi change
   le contenu de la liste, pas d'écran. */
const BandeJours = memo(function BandeJours({ week, day, aujourdhui }: { week: string; day: number; aujourdhui: string }){
  /* Largeur d'un jour, espace compris : ce qui sépare deux positions de
     la pastille. Mesuré dès que la bande existe, puis à chaque
     changement de largeur. La bande n'existe qu'une fois les données
     lues : la mesurer au premier rendu ne trouvait rien, et la pastille
     n'était jamais dessinée (constat U3). */
  const [bande, setBande] = useState<HTMLDivElement | null>(null);
  const [pas, setPas] = useState(0);
  useEffect(() => {
    if (!bande) return;
    const mesurer = () => {
      const b = bande.querySelector("button");
      if (b) setPas(b.getBoundingClientRect().width + 3);
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(bande);
    return () => ro.disconnect();
  }, [bande]);

  return (
    <Onglets asChild value={String(day)} onValueChange={v => choisirJour(Number(v))}>
      <ListeOnglets variante="jours" aria-label="Jour affiché" ref={setBande}>
        {/* Une pastille unique qui coulisse. On l'a d'abord écrite avec
            `layoutId`, ce qui était plus court — mais toute animation de
            mise en page partagée force Framer à remesurer l'arbre entier,
            fiches de chantier comprises : douze millisecondes prélevées
            sur chaque changement de jour. Ici, une simple translation en
            pixels, en transition CSS (W6) : le compositeur s'en charge,
            rien n'est mesuré. */}
        {pas > 0 && (
          <span data-jour-actif aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-2 left-2 rounded-[9px] bg-accent [transition:transform_.28s_cubic-bezier(.25,.8,.25,1)]"
            style={{ width: pas - 3, transform: "translateX(" + day * pas + "px)" }} />
        )}
        {weekDates(week).map((d, i) => (
          <Onglet key={d} variante="jours" value={String(i)} aria-controls={undefined}
            className={fondJour(WEEKEND[i], d === aujourdhui)}>
            <em className={cn("font-display text-[9px]/none font-semibold tracking-[.05em] text-muted not-italic",
              texteJour)}>{DAYS[i]}</em>
            <b className={cn("font-mono text-[14px]/none font-semibold tabular-nums",
              WEEKEND[i] ? "text-muted" : "text-ink-2", texteJour)}>{parse(d).getDate()}</b>
          </Onglet>
        ))}
      </ListeOnglets>
    </Onglets>
  );
});

const BarreOnglets = memo(function BarreOnglets({ tab, choisir }: { tab: Tab; choisir: (id: Tab) => void }){
  /* Le trait sous l'onglet actif vit dans cet onglet ; quand l'onglet
     change, il part de là où était l'ancien et glisse jusqu'au nouveau.
     C'était `layoutId`, qui faisait remesurer à Framer toute la mise en
     page (fiches et puces comprises) à chaque changement d'onglet. Les
     onglets ont la même largeur : l'écart se calcule d'une mesure, et
     le compositeur joue la translation (Web Animations). Au repos, le
     trait n'a pas de transform : son dessin ne change pas. */
  const trait = useRef<HTMLSpanElement | null>(null);
  const avant = useRef(tab);
  /* Le glissement en cours. Un autre onglet touché en chemin le reprend
     d'où il en est : le trait sautait à l'onglet d'avant, puis revenait
     (relecture adversariale de W6). L'ancien trait a quitté le DOM, mais
     son animation court encore : elle dit où il en était. */
  const glisse = useRef<{ anim: Animation; ecart: number } | null>(null);
  useLayoutEffect(() => {
    const de = ONGLETS.findIndex(([id]) => id === avant.current), a = ONGLETS.findIndex(([id]) => id === tab);
    avant.current = tab;
    const el = trait.current, nav = el?.closest("nav");
    if (!el || !nav || de === a || mouvementReduit()) return;
    let ecart = (de - a) * nav.getBoundingClientRect().width / ONGLETS.length;
    const g = glisse.current;
    if (g && g.anim.playState === "running") {
      const fait = g.anim.effect?.getComputedTiming().progress;
      if (typeof fait === "number") ecart += g.ecart * (1 - fait);
      g.anim.cancel();
    }
    glisse.current = {
      anim: el.animate([{ transform: "translateX(" + ecart + "px)" }, { transform: "none" }],
        { duration: 280, easing: "cubic-bezier(.25,.8,.25,1)" }),
      ecart
    };
  }, [tab]);

  return (
    <ListeOnglets asChild aria-label="Onglets">
      <nav>
        {/* Un seul panneau est monté, celui de l'onglet ouvert : les autres
            onglets ne désignent rien (aria-controls retiré). */}
        {ONGLETS.map(([id, label]) => (
          <Onglet key={id} value={id} onClick={() => choisir(id)} {...(tab === id ? {} : { "aria-controls": undefined })}>
            {tab === id && (
              <span ref={trait} className="absolute top-0 left-[calc(50%-13px)] h-[2.5px] w-6.5 rounded-b-[3px] bg-accent" />
            )}
            {id === "chantiers" && <svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V9l7-5 7 5v12M9.5 21v-6h5v6" /></svg>}
            {id === "semaine" && <svg viewBox="0 0 24 24">
              <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
              <path d="M3.5 10h17M8 3v4M16 3v4M8.5 14h1.5M14 14h1.5M8.5 17.5h1.5M14 17.5h1.5" /></svg>}
            {id === "equipe" && <svg viewBox="0 0 24 24">
              <circle cx="9" cy="8" r="3.2" /><path d="M2.6 20a6.4 6.4 0 0 1 12.8 0" />
              <path d="M16.4 6.3a3 3 0 0 1 0 5.4M17.8 20a6.4 6.4 0 0 0-2-4.5" /></svg>}
            {label}
          </Onglet>
        ))}
      </nav>
    </ListeOnglets>
  );
});


export default function App(){
  const synchro = useSynchro();
  const vue = useVue();
  const ui = useUi(useShallow(champsUi));
  const scrollRef = useRef<HTMLElement | null>(null);

  const act = useMemo(() => creerActions({
    synchro, enHaut: () => scrollRef.current?.scrollTo(0, 0)
  }), [synchro]);

  /* Ce que la synchronisation a à dire : une réponse de compagnon
     arrivée pendant qu'on regarde, un geste refusé, un stockage plein. */
  useEffect(() => {
    synchro.on.reponse = (pid, semaine) => {
      const p = new Vue(synchro.affichees()).person(pid);
      if (p) toast(html`<b>${p.name}</b> a répondu pour la semaine ${weekNum(semaine)}`);
    };
    synchro.on.refus = m => toast(html`Modification annulée : ${m}`);
    synchro.on.stockagePlein = () =>
      toast(html`<b>Stockage plein</b> — les modifications en attente ne survivraient pas à une fermeture`);
  }, [synchro]);

  const week = ui.week;
  const day = addDays(week, ui.day);

  /* Semaine visée par une demande de dispo : à partir du vendredi, on
     prépare la suivante — sauf si l'écran est posé ailleurs. */
  const askWeek = useCallback(() => {
    const today = todayISO(), base = mondayOf(today);
    if (week !== base) return week;
    return dayIndex(today) >= 4 ? addDays(base, 7) : base;
  }, [week]);

  /* Le libellé de la semaine glisse dans le sens du geste : on sait d'où
     l'on vient. Une référence suffit — elle n'a pas à provoquer de rendu,
     elle est lue au moment de l'animation. */
  const sensSem = useRef(1);
  /* Le premier écran s'affiche sans fondu ; les onglets suivants, en fondu.
     Le premier écran est le premier qui montre quelque chose : sans rien
     sur l'appareil (première connexion, sources api et supabase), la coque
     dessine d'abord l'attente, et le libellé de la semaine et « Auj. »
     naissent au rendu suivant — ils entraient alors en glissant sans que
     rien n'arrive (constat V6, test K6). */
  const premierRendu = useRef(true);
  const affiche = vue != null;
  useEffect(() => { if (affiche) premierRendu.current = false; }, [affiche]);
  /* Le fondu d'un onglet se décide quand l'onglet change, pas à chaque
     rendu : relu à chaque rendu, il se rejouait sur l'écran déjà là au
     deuxième rendu de la coque (test K6). */
  const panneau = useRef<{ tab: Tab; fondu: boolean }>({ tab: ui.tab, fondu: false });
  if (panneau.current.tab !== ui.tab) panneau.current = { tab: ui.tab, fondu: true };

  /* Toucher un onglet, même celui qui est ouvert, remonte en haut de la
     liste. Radix ne prévient que d'un changement (au clavier comme à
     l'appui) : le toucher de l'onglet ouvert passe par onClick. Stable,
     pour que la barre des onglets ne se redessine pas avec la coque. */
  const choisirOnglet = useCallback((id: Tab) => {
    patchUi({ tab: id }); scrollRef.current?.scrollTo(0, 0);
  }, []);

  /* ---------- glisser-déposer ---------- */

  useDrag({
    scrollRef,
    urgence: ui.urgence,
    onDrop: (pid, sid) => act.assign(pid, sid),
    onTap: (pid, fromSite) => act.sheet({ type: "chip", id: pid, from: fromSite })
  });

  /* Rien encore de lu, ni sur l'appareil ni du serveur. */
  if (!vue) return <Attente />;

  /* ---------- rendu ---------- */

  const isFreeOn = (pid: string, d: string) => !vue.sites.some(x => teamOn(x, d).includes(pid));
  const free = vue.people
    .filter(p => vue.availableOn(p.id, day) && isFreeOn(p.id, day))
    .sort((a, b) => b.days.filter(Boolean).length - a.days.filter(Boolean).length);
  const ouverts = vue.sites.filter(x => teamOn(x, day).length).length;
  const aujourdhui = todayISO();
  const now = mondayOf(aujourdhui);

  return (
    <>
      {/* La racine des onglets est la coque elle-même : la barre du bas et
          le panneau (le contenu de la liste) sont reliés par Radix. */}
      <Onglets value={ui.tab} onValueChange={v => choisirOnglet(v as Tab)}
        className={cn("relative mx-auto flex h-screen min-h-[520px] max-w-[430px] flex-col overflow-hidden",
          "border-x border-line bg-ground supports-[height:100dvh]:h-dvh")}>
        <header className={cn("flex flex-none items-center gap-2.25 border-b border-line bg-surface",
          "px-3 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5")}>
          <Mark />
          <div className="min-w-0 flex-1">
            <h1 className="m-0 font-display text-[17px]/[1.1] font-bold tracking-[-.01em]">Geoplan</h1>
            <p className="mx-0 mt-0.5 mb-0 truncate text-[11.5px] text-muted">
              {plur(ouverts, "chantier ouvert", "chantiers ouverts")} · {plur(free.length, "libre")}
            </p>
          </div>
          <BoutonEtat ouvrir={() => act.sheet({ type: "data" })} />
          <button className={boutonIcone(true)} aria-label="Ajouter"
            onClick={() => act.sheet(ui.tab === "equipe" ? { type: "person", id: null } : { type: "site", id: null })}>
            +
          </button>
        </header>

        {/* Pas d'animation ici : ce bandeau ne change jamais d'état une fois
            l'application lancée, et l'animer en hauteur « auto » obligeait
            Framer à mesurer la mise en page à chaque rendu — neuf
            millisecondes prélevées sur chaque changement de jour. */}
        {synchro.depot.source === "local" && (
          <div data-bandeau="local"
            className={cn("flex flex-none items-center gap-2.25 overflow-hidden px-3 py-2.25",
              "border-b border-[color-mix(in_srgb,var(--warn)_35%,transparent)]",
              "bg-[color-mix(in_srgb,var(--warn)_14%,var(--surface))] text-[11.5px]/[1.4] text-ink-2")}>
            <span><b className="font-semibold text-warn-texte">Mode local</b> — les données restent sur cet appareil.
              Renseignez <code>config.ts</code> pour les synchroniser.</span>
          </div>
        )}

        <div className="flex flex-none items-center gap-1 border-b border-line bg-surface-2 px-2 py-1.75">
          <button className={FLECHE} aria-label="Semaine précédente"
            onClick={() => { sensSem.current = -1; patchUi({ week: addDays(week, -7) }); }}>
            <svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7" /></svg>
          </button>
          {/* Le libellé entre en glissant dans le sens de la navigation
              (mouvement.css) ; l'ancien laisse sa place d'un coup. Pas au
              premier affichage. Hors de la semaine courante, il passe à
              l'orange. */}
          <div data-semaine={week} data-hors-semaine={week !== now || undefined}
            className="group grid flex-1 overflow-hidden text-center leading-[1.2]">
            <LibelleSemaine key={week} entre={!premierRendu.current} sens={sensSem.current}>
              Sem. {weekNum(week)} · {fmtRange(week)}
            </LibelleSemaine>
          </div>
          {/* « Auj. » paraît avant la flèche, pas après : c'est le libellé qui
              lui fait place, les flèches ne bougent jamais. Après elle, il
              prenait la place exacte de la flèche, qui glissait à gauche :
              un second appui rapide sur « Semaine suivante » tombait sur
              « Auj. » et ramenait à aujourd'hui (défaut de W4, relecture
              adversariale de W5, test A2). */}
          {(week !== now || ui.day !== dayIndex(todayISO())) && (
            <BoutonAuj entre={!premierRendu.current}
              onClick={() => {
                /* Revenir à aujourd'hui a un sens, lui aussi : le libellé
                   entrait comme la dernière flèche touchée (relecture
                   adversariale de W6). */
                sensSem.current = now < week ? -1 : 1;
                patchUi({ week: now, day: dayIndex(todayISO()) });
              }} />
          )}
          <button className={FLECHE} aria-label="Semaine suivante"
            onClick={() => { sensSem.current = 1; patchUi({ week: addDays(week, 7) }); }}>
            <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
          </button>
        </div>

        <BandeJours week={week} day={ui.day} aujourdhui={aujourdhui} />
        {/* La liste défile, sauf pendant un glisser (.dragging, que useDrag
            pose sur body). */}
        <main ref={scrollRef}
          className="flex-1 overflow-y-auto in-[.dragging]:overflow-hidden overscroll-contain [-webkit-overflow-scrolling:touch] px-2.75 pt-3.25 pb-5"
          style={{ paddingBottom: ui.tab === "chantiers" ? (ui.poolState === "open" ? 190 : 90) : 20 }}>
          {/* Le contenu ne glisse pas : translater tout le sous-arbre
              coûtait neuf millisecondes au premier cadre, et le
              pré-promouvoir en calque coûtait plus cher encore sur le
              changement de jour. Le sens du geste est donné par le trait
              qui coulisse sous les onglets — c'est lui que l'œil suit.

              Le nouvel onglet entre en fondu ; l'ancien part d'un coup.
              Son fondu de sortie le gardait monté par-dessus le nouveau
              (constat V4) : un doigt pouvait toucher une fiche en train de
              disparaître, deux panneaux coexistaient, et, revenu sur
              Chantiers, l'écran reprenait parfois le jour d'avant — la
              bande des jours en montrant un autre (1 fois sur 16, A6). */}
          <PanneauOnglet key={ui.tab} value={ui.tab} asChild>
            <div className={panneau.current.fondu ? "animate-[fade_.19s_cubic-bezier(.22,.9,.3,1)]" : undefined}>
              {ui.tab === "chantiers" && <Chantiers vue={vue} ui={ui} act={act} day={day} dayIdx={ui.day} />}
              {ui.tab === "semaine" && <Semaine vue={vue} ui={ui} act={act} />}
              {ui.tab === "equipe" && <Equipe vue={vue} ui={ui} act={act} day={day} dayIdx={ui.day} askWeek={askWeek} />}
            </div>
          </PanneauOnglet>
        </main>

        {ui.tab === "chantiers" && vue.people.length > 0 && (
          <Island free={free} daysOf={(p, w) => vue.daysOf(p, w)} week={week} dayIndex={ui.day}
            state={ui.poolState} setState={v => patchUi({ poolState: v })}
            urgence={ui.urgence} setUrgence={v => { patchUi({ urgence: v });
              toast(v ? html`<b>Mode urgence</b> — un compagnon peut être posé sur deux chantiers le même jour`
                      : html`Mode urgence désactivé`); }} />
        )}

        <BarreOnglets tab={ui.tab} choisir={choisirOnglet} />
      </Onglets>

      <FeuillesALaDemande vue={vue} act={act} synchro={synchro} ui={ui} />
      <ToastsUi />
    </>
  );
}
