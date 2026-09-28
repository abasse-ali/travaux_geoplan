/* ============================================================
   L'état de l'interface (ADR-004) : Zustand

   Onglet, semaine, jour, vivier, urgence, son, ce qui est déplié, la
   feuille ouverte, les toasts. Seuls `tab`, `poolState`, `urgence` et
   `sons` survivent à un rechargement (« geoplan.ui.v3 »), et ils sont
   validés à la relecture : une valeur inattendue — `null`, un onglet
   inconnu — donnait un écran blanc (constat U17).
   ============================================================ */

import { create } from "zustand";
import { dayIndex, mondayOf, todayISO } from "@geoplan/domain";
import type { Balise } from "./html";
import type { ToastItem } from "./bits";
import type { PoolState, SheetState, Tab, UiState } from "./types";

export const UIKEY = "geoplan.ui.v3";

export function relireUi(): Pick<UiState, "tab" | "poolState" | "urgence" | "sons"> {
  let o: unknown = null;
  try { o = JSON.parse(localStorage.getItem(UIKEY) || "null"); } catch { /* illisible : valeurs par défaut */ }
  const r = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const tab: Tab = r.tab === "semaine" || r.tab === "equipe" ? r.tab : "chantiers";
  const poolState: PoolState = r.poolState === "bubble" ? "bubble" : "open";
  return { tab, poolState, urgence: r.urgence === true, sons: r.sons === true };
}

export interface EtatUi extends UiState {
  sheet: SheetState | null;
  toasts: ToastItem[];
  /** Le dernier plan de « Répartir » appliqué : la grille Semaine pose
      en vague les noms qu'il fait arriver (W6). L'instant (performance.now),
      la semaine, et chaque nom posé (« chantier#jour#compagnon »). */
  vague: Vague | null;
}

export interface Vague { t: number; semaine: string; noms: ReadonlySet<string> }

export const useUi = create<EtatUi>(() => {
  const t = todayISO();
  return {
    ...relireUi(),
    openSite: null, openPhase: null, openNote: null,
    week: mondayOf(t), day: dayIndex(t),
    sheet: null, toasts: [], vague: null
  };
});

useUi.subscribe((e, a) => {
  if (e.tab === a.tab && e.poolState === a.poolState && e.urgence === a.urgence && e.sons === a.sons) return;
  try { localStorage.setItem(UIKEY, JSON.stringify({ tab: e.tab, poolState: e.poolState, urgence: e.urgence, sons: e.sons })); }
  catch { /* stockage refusé : l'état ne sera simplement pas retenu */ }
});

export const patchUi = (p: Partial<EtatUi>): void => useUi.setState(p);

/** Un message passager : deux à la fois au plus, 2,8 s chacun ; puis il
    s'éteint (`sortie`, ui/bits.tsx) et part 180 ms plus tard. Le plus
    ancien, chassé par un troisième, part d'un coup. */
const EXTINCTION = 180;
export function toast(m: Balise): void {
  const id = Math.random().toString(36).slice(2);
  useUi.setState(e => ({ toasts: [...e.toasts.slice(-1), { id, html: m.__html }] }));
  setTimeout(() => {
    useUi.setState(e => ({ toasts: e.toasts.map(x => x.id === id ? { ...x, sortie: true } : x) }));
    setTimeout(() => useUi.setState(e => ({ toasts: e.toasts.filter(x => x.id !== id) })), EXTINCTION);
  }, 2800);
}
