/* ============================================================
   Le son des gestes (ADR-006)

   Un retour discret quand on pose une puce et quand on la retire : une
   note brève, synthétisée (aucun fichier à charger), qui monte pour
   poser, qui descend pour retirer. Désactivé par défaut ; il se règle
   sur chaque appareil, dans la feuille « Données ».

   Sur l'iPhone, le son d'une page ne part qu'après un geste : le
   contexte audio naît et se réveille dans l'appui qui active le réglage,
   puis à chaque son s'il s'est endormi (l'application passée en
   arrière-plan). Là où Safari connaît la session audio, elle est
   « ambient » : le son se mêle à la musique ou au podcast du chantier au
   lieu de les couper, et se tait avec le bouton de silence.
   ============================================================ */

import { useUi } from "./etat";

export type SonDeGeste = "pose" | "retrait";

let contexte: AudioContext | null = null;

function ouvrir(): AudioContext | null {
  if (contexte) return contexte;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) try { session.type = "ambient"; } catch { /* réglage refusé : le son part quand même */ }
  try { contexte = new AC(); } catch { return null; }
  return contexte;
}

/** Dans un appui : réveille le son (l'iPhone ne le permet qu'ici). */
export function eveillerSon(): void {
  const c = ouvrir();
  if (c && c.state !== "running") c.resume().catch(() => undefined);
}

/* Fréquence de départ et d'arrivée, en hertz : une quinte qui monte, une
   tierce qui descend. */
const NOTES: Record<SonDeGeste, [number, number]> = { pose: [660, 990], retrait: [520, 350] };

/** Le son d'un geste, si le réglage est actif. */
export function jouerSon(sorte: SonDeGeste): void {
  if (!useUi.getState().sons) return;
  const c = ouvrir();
  if (!c) return;
  if (c.state !== "running") c.resume().catch(() => undefined);
  const t = c.currentTime + 0.01;
  const [depart, arrivee] = NOTES[sorte];
  const note = c.createOscillator(), volume = c.createGain();
  note.type = "sine";
  note.frequency.setValueAtTime(depart, t);
  note.frequency.exponentialRampToValueAtTime(arrivee, t + 0.07);
  volume.gain.setValueAtTime(0.0001, t);
  volume.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
  volume.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  note.connect(volume).connect(c.destination);
  note.start(t);
  note.stop(t + 0.15);
}
