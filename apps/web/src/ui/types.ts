/* ============================================================
   Le contrat entre la coque (App) et les écrans

   App tient l'état de l'interface et les actions ; chaque écran les
   reçoit en props. Les écrire ici, une fois, permet de convertir les
   écrans un par un sans attendre qu'App le soit.
   ============================================================ */

import type { WeekPlan } from "@geoplan/domain";
import type { Balise } from "./html";

export type { Vue } from "../donnees/vue";

export type Tab = "chantiers" | "semaine" | "equipe";
export type PoolState = "open" | "bubble";

/** L'état de l'interface. Seuls `tab`, `poolState`, `urgence` et `sons`
    sont retenus d'un lancement à l'autre (localStorage « geoplan.ui.v3 »). */
export interface UiState {
  tab: Tab;
  poolState: PoolState;
  urgence: boolean;
  sons: boolean;                 // le son des gestes (ui/son.ts), éteint par défaut
  openSite: string | null;       // un seul chantier déplié dans toute l'application
  openPhase: string | null;      // « idChantier#étape » : une seule étape ouverte
  openNote: string | null;
  week: string;                  // lundi ISO de la semaine affichée
  day: number;                   // 0 = lundi … 6 = dimanche
}

/** Ce que la coque lit de l'état d'interface, et transmet aux écrans.
    Pas ce qui est déplié : chaque carte de chantier le lit elle-même,
    et déplier une note ne redessine qu'elle. */
export type UiCoque = Pick<UiState, "tab" | "poolState" | "urgence" | "week" | "day">;

/** La feuille du bas ouverte, s'il y en a une. */
export type SheetState =
  | { type: "chip"; id: string; from?: string | null } // fiche d'une puce, `from` = chantier d'origine
  | { type: "person"; id: string | null }            // null : nouveau compagnon
  | { type: "site"; id: string | null }              // null : nouveau chantier
  | { type: "suggest"; id: string }
  | { type: "optimize" }
  | { type: "avail"; week: string }
  | { type: "data" };

/** Retour visuel pendant le glisser sur une barre d'étape. */
export type SetLocal = (v: number | null) => void;

/** Le point de départ d'un glisser sur une barre. */
export interface PointerStart { clientX: number; clientY: number; pointerId: number }

/** Les actions de l'écran (ui/actions.ts). Créées une fois : elles lisent
    l'état courant au moment où elles s'exécutent, jamais celui de leur
    création. */
export interface Actions {
  toast(m: Balise): void;
  sheet(s: SheetState | null): void;
  openSite(id: string | null): void;
  openPhase(k: string | null): void;
  openNote(id: string | null): void;
  goDay(i: number): void;

  assign(pid: string, sid: string | null): void;
  toggleDay(pid: string, sid: string, d: string): void;
  fillDays(pid: string, sid: string, mode: "dispo" | "none"): void;
  again(sid: string): void;
  applyTeam(sid: string, ids: string[], days: string[]): void;
  applyPlan(res: WeekPlan, days: string[]): void;

  task(sid: string, i: number, j: number, on: boolean): void;
  bar(sid: string, i: number, e: PointerStart | null, el: HTMLElement | null,
      direct?: number, setLocal?: SetLocal): void;
  note(sid: string, v: string): void;

  deletePerson(pid: string): void;
  /** Le lien de disponibilité d'un compagnon pour une semaine, créé s'il
      n'existe pas encore. */
  lienDispo(pid: string, week: string): Promise<string>;
  brief(): void;
  copy(url: string): void;
  exportBackup(): void;
  importBackup(txt: string): void;
}
