/* ============================================================
   Page de réponse du compagnon

   Ouverte depuis le lien reçu par e-mail ou par SMS. Pas de compte,
   pas d'installation, un seul écran. Le jeton de l'URL est la seule
   clé : il n'ouvre qu'une ligne, via deux fonctions SQL. La page ne
   peut rien lire ni écrire d'autre.

   Elle est volontairement séparée de l'application : elle ne charge ni
   la planification, ni les données, juste son formulaire.

   Elle suit la même source que l'application (ADR-004) :
   • api : GET et POST /api/dispo/<jeton>, par fetch, rien d'autre ;
   • supabase : les fonctions avail_get et avail_set, par supabase-js,
     chargé à la demande — la page s'affiche sans l'attendre.
   ============================================================ */

import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";
import { DAYS_L, WEEKEND, NDAYS, MONTHS, parse, addDays, fmtRange } from "@geoplan/domain";
import { Mark } from "./ui/marque";
import { Ecran, PAGE, TITRE, message } from "./ui/ecran";
import { cn } from "./ui/primitives/classes";
import "./dispo.css";

const token = new URLSearchParams(location.search).get("t") || "";

/** Ce que renvoie avail_get (supabase/schema.sql) pour un jeton valide. */
interface DispoData {
  name: string; week: string;
  days: boolean[] | null;        // null : pas encore répondu
  note: string; answered: boolean;
}

/* Lire la demande, et y répondre : les deux seules choses que la page
   sait faire. `lire` rend null pour un lien inconnu ou expiré. */
interface Acces {
  lire(): Promise<DispoData | null>;
  repondre(days: boolean[], note: string): Promise<boolean>;
}

const SOURCE = import.meta.env.VITE_GEOPLAN_SOURCE as string | undefined;

async function ouvrirAcces(): Promise<Acces | "config"> {
  if (SOURCE === "api") {
    const chemin = "/api/dispo/" + encodeURIComponent(token);
    return {
      lire: async () => {
        const r = await fetch(chemin, { cache: "no-store" });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("réseau");
        return await r.json() as DispoData;
      },
      repondre: async (days, note) => {
        const r = await fetch(chemin, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ days, note })
        });
        return r.ok;
      }
    };
  }
  if (SOURCE === "local" || !SUPABASE_URL || !SUPABASE_ANON_KEY) return "config";
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(SUPABASE_URL.trim().replace(/\/$/, ""), SUPABASE_ANON_KEY.trim(),
    { auth: { persistSession: false } });
  return {
    lire: async () => {
      const { data, error } = await sb.rpc("avail_get", { p_token: token });
      if (error) throw error;
      return (data as DispoData | null) ?? null;
    },
    repondre: async (days, note) => {
      const { data: ok, error } = await sb.rpc("avail_set", { p_token: token, p_days: days, p_note: note });
      return !error && !!ok;
    }
  };
}

/* Un seul état, dont un seul champ est rempli à la fois. Pas d'union
   discriminée : la forme du code reste celle d'avant la conversion. */
interface LoadState {
  loading?: boolean;
  error?: "lien" | "config" | "expire" | "reseau";
  acces?: Acces;
  data?: DispoData;
}

/* ---------- le dessin (classes Tailwind, jetons de jetons.css) ----------
   La page, le titre et l'encadré du message sont ceux des écrans d'un
   seul message (ui/ecran.tsx), que partagent les écrans d'erreur de
   l'application. */

/* Le texte d'accueil, et « Chargement… », qui en a le corps. */
const TEXTE = "m-0 text-[14px]/[1.55] text-muted";

/* La semaine demandée, en pastille ; son surtitre en petites capitales. */
const SEMAINE = "mt-3.5 inline-flex items-center gap-2 self-start rounded-[10px] border border-line bg-surface"
  + " px-3 py-2 font-mono text-[14px]/none font-semibold";
const SEMAINE_SURTITRE = "font-display text-[9.5px]/none font-semibold tracking-[.11em] text-muted uppercase not-italic";

/* Un jour : une ligne entière à toucher. Cochée, elle prend l'orange ;
   le week-end, elle reste en retrait (sans fond, trait tireté) tant
   qu'elle n'est pas cochée. Le fond se mélange en srgb, comme avant (le
   modificateur de Tailwind, bg-accent/9, mélangerait en oklab). Sous le
   doigt, elle s'enfonce à peine (CSS ; Framer Motion avant W6). */
const JOUR = "group flex w-full items-center gap-3.25 rounded-[13px] border-[1.5px] border-line-2 px-4 py-3.75"
  + " text-left font-body text-[16px]/none font-semibold text-ink"
  + " [transition:transform_.12s_ease] active:[transform:scale(.985)]"
  + " aria-pressed:border-accent aria-pressed:bg-[color-mix(in_srgb,var(--accent)_9%,var(--surface))]";
const JOUR_SEMAINE = "bg-surface";
const JOUR_WEEK_END = "border-dashed bg-transparent aria-pressed:border-solid";

/* La case du jour, sa coche, sa date. La coche paraît en grandissant
   quand le jour est coché, et s'efface quand il ne l'est plus : une
   transition CSS sur l'état du bouton (Framer Motion avant W6). */
const CASE = "grid size-6.5 flex-none place-items-center rounded-[8px] border-[1.5px] border-line-champ bg-surface-2"
  + " group-aria-pressed:border-transparent group-aria-pressed:bg-accent";
const COCHE = "size-3.75 fill-none stroke-on-accent stroke-[2.6] [stroke-linecap:round] [stroke-linejoin:round]"
  + " opacity-0 [transform:scale(.3)] group-aria-pressed:opacity-100 group-aria-pressed:[transform:none]"
  + " [transition:transform_.3s_var(--spring),opacity_.2s_ease]";
const DATE = "font-mono text-[13px]/none font-medium text-muted group-aria-pressed:text-accent-texte";

/* Le mot facultatif. */
const MOT = "min-h-18 w-full resize-y rounded-[11px] border border-line-champ bg-surface p-3"
  + " font-body text-[16px]/[1.45] font-normal";

/* Le bouton d'envoi : celui de bouton({ teinte: "primaire", large: true }),
   en plus grand (15 px de marge, texte de 16 px, rayon de 12 px). bouton()
   n'a pas cette taille, et l'on n'ajoute pas à côté de ses classes des
   classes qui les contrediraient : il est donc écrit en entier. */
const ENVOYER = "inline-flex w-full items-center justify-center gap-1.75 rounded-[12px] border border-transparent"
  + " bg-accent p-3.75 font-body text-[16px]/none font-semibold text-on-accent no-underline"
  + " active:translate-y-px disabled:opacity-50";

/* Le pied de page. */
const PIED = "text-center text-[11.5px]/[1.5] text-muted";

function Form({ acces, data }: { acces: Acces; data: DispoData }){
  const week = data.week;
  const [days, setDays] = useState(() =>
    Array.from({ length: NDAYS }, (_, i) => !!(data.days && data.days[i])));
  const [note, setNote] = useState(data.note || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async () => {
    setBusy(true); setErr(null);
    const ok = await acces.repondre(days, note.slice(0, 300)).catch(() => false);
    if (!ok) {
      setErr("L'envoi n'a pas abouti. Vérifiez votre réseau et réessayez.");
      setBusy(false);
      return;
    }
    setSent(true);
  };

  if (sent) {
    const list = DAYS_L.filter((l, i) => days[i]);
    return (
      <Ecran titre={"C'est envoyé, merci " + data.name}>
        Pour la semaine du <b>{fmtRange(week)}</b>,{" "}
        {list.length
          ? <>tu es noté disponible : <b>{list.join(", ").toLowerCase()}</b>.</>
          : <>tu es noté <b>indisponible toute la semaine</b>.</>}
        {note && <><br /><br />Message transmis : « {note} »</>}
      </Ecran>
    );
  }

  return (
    <main className={PAGE}>
      <header>
        <Mark taille="page" />
        <h1 className={TITRE}>Bonjour {data.name}</h1>
        <p className={TEXTE}>Quels jours es-tu disponible cette semaine-là ?
          Touche les jours où tu peux venir, week-end compris, puis envoie.</p>
        <span data-semaine={week} className={SEMAINE}><em className={SEMAINE_SURTITRE}>Semaine du</em>{fmtRange(week)}</span>
      </header>

      <div className="flex flex-col gap-2">
        {DAYS_L.map((label, i) => {
          const jour = addDays(week, i);
          const date = parse(jour);
          return (
            <button key={i} type="button" data-jour={jour}
              className={cn(JOUR, WEEKEND[i] ? JOUR_WEEK_END : JOUR_SEMAINE)}
              aria-pressed={days[i]}
              onClick={() => setDays(d => d.map((v, j) => j === i ? !v : v))}>
              <span className={CASE}>
                <svg viewBox="0 0 24 24" aria-hidden="true" className={COCHE}>
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              </span>
              <span data-jour-nom className="flex-1">{label}</span>
              <span data-jour-date className={DATE}>{date.getDate()} {MONTHS[date.getMonth()]}</span>
            </button>
          );
        })}
      </div>

      <textarea value={note} onChange={e => setNote(e.target.value)} className={MOT}
        placeholder="Un mot à ajouter ? (facultatif)" />

      <button className={ENVOYER} onClick={send} disabled={busy}>
        {busy ? "Envoi…" : data.answered ? "Mettre à jour ma réponse" : "Envoyer mes disponibilités"}
      </button>

      {err && (
        /* role="alert" : un lecteur d'écran annonce l'échec de l'envoi. */
        <div data-etat="erreur" role="alert" className={cn(message(true), "animate-[message-in_.2s_ease] motion-reduce:animate-none")}>
          {err}
        </div>
      )}

      <p className={PIED}>
        {data.answered
          ? "Tu as déjà répondu : tu peux corriger tant que la semaine n'est pas passée."
          : "Tu peux revenir sur ce lien pour corriger."}
      </p>
    </main>
  );
}

function Dispo(){
  const [state, setState] = useState<LoadState>({ loading: true });

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!token) return alive && setState({ error: "lien" });
      try {
        const acces = await ouvrirAcces();
        if (!alive) return;
        if (acces === "config") return setState({ error: "config" });
        const data = await acces.lire();
        if (!alive) return;
        if (!data) return setState({ error: "expire" });
        setState({ acces, data });
      } catch(e) { if (alive) setState({ error: "reseau" }); }
    })();
    return () => { alive = false; };
  }, []);

  if (state.loading) return <main className={PAGE}><p className={TEXTE}>Chargement…</p></main>;

  if (state.error === "lien") return (
    <Ecran titre="Lien incomplet" erreur>
      Ce lien ne contient pas de code. Ouvrez celui reçu par message, en entier.
    </Ecran>
  );
  if (state.error === "config") return (
    <Ecran titre="Application non configurée" erreur>
      Le formulaire a besoin de la base. Prévenez la personne qui vous a envoyé ce lien.
    </Ecran>
  );
  if (state.error === "expire") return (
    <Ecran titre="Lien expiré" erreur>
      Cette demande n'existe plus, ou elle a dépassé sa date limite. Demandez-en une nouvelle.
    </Ecran>
  );
  if (state.error) return (
    <Ecran titre="Connexion impossible" erreur>
      Vérifiez votre réseau, puis rouvrez le lien.
    </Ecran>
  );

  return <Form acces={state.acces!} data={state.data!} />;
}

/* Moins de mouvement demandé : la règle de mouvement-commun.css arrête
   net ses transitions et ses animations (constat U10). */
createRoot(document.getElementById("root")!).render(
  <StrictMode><Dispo /></StrictMode>
);
