/* ============================================================
   Les feuilles du bas, chargées à la demande

   Elles tirent vaul, le Dialog de Radix et le code de toutes les
   feuilles : rien de cela n'est utile pour afficher le planning. Le
   morceau part à la première ouverture d'une feuille (depuis le cache
   du service worker, hors ligne compris) ; l'ouverture du planning ne
   le paie pas.
   ============================================================ */

import { useReducer, useRef } from "react";
import { FeuilleRacine } from "./primitives/feuille";
import {
  PersonSheet, EditPerson, EditSite, SuggestSheet, OptimizeSheet, AvailSheet, DataSheet
} from "./sheets";
import { deconnecter, useEtatDonnees, useSession } from "../donnees/react";
import type { Synchro } from "../donnees/synchro";
import type { Vue } from "../donnees/vue";
import { toast, useUi } from "./etat";
import { html } from "./html";
import type { Actions, SheetState, UiCoque } from "./types";

/* La feuille ouverte : seule à suivre `sheet`, et l'état des envois pour
   la feuille Données.

   Une seule racine (le Drawer), toujours montée. Fermée, la feuille
   descend encore un moment : elle reste affichée telle qu'elle était à
   la fermeture, avec la vue de cet instant — une fiche supprimée
   ailleurs ne doit pas la faire planter en chemin. */
interface Ouverte { sheet: SheetState; vue: Vue; ui: UiCoque; n: number }

export default function Feuilles({ vue, act, synchro, ui }: { vue: Vue; act: Actions; synchro: Synchro; ui: UiCoque }){
  const sheet = useUi(s => s.sheet);
  const { etat, enAttente } = useEtatDonnees();
  const stockagePlein = synchro.file(e => e.stockagePlein);
  const compte = useSession(s => s.compte);
  const derniere = useRef<Ouverte | null>(null);
  const [, redessiner] = useReducer((n: number) => n + 1, 0);
  /* Chaque ouverture a son numéro, qui sert de clé : une fiche rouverte
     pendant que la précédente descend repart de zéro, au lieu de garder
     le brouillon de l'autre (même composant, même place). */
  if (sheet) {
    const d = derniere.current;
    derniere.current = { sheet, vue, ui, n: d && d.sheet === sheet ? d.n : (d?.n ?? 0) + 1 };
  }
  const close = () => act.sheet(null);
  const fermee = () => { if (!useUi.getState().sheet) { derniere.current = null; redessiner(); } };
  return (
    <FeuilleRacine ouverte={!!sheet} onFermer={close} onFermee={fermee}>
      {derniere.current && (({ sheet, vue, ui, n }: Ouverte) => {
        const key = sheet.type + ":" + n;
        switch (sheet.type) {
          case "chip": return <PersonSheet key={key} vue={vue} ui={ui} act={act}
            pid={sheet.id} fromSite={sheet.from} onClose={close} />;
          case "person": return <EditPerson key={key} vue={vue} act={act} synchro={synchro} pid={sheet.id} onClose={close} />;
          case "site": return <EditSite key={key} vue={vue} act={act} synchro={synchro} sid={sheet.id} onClose={close} />;
          case "suggest": return <SuggestSheet key={key} vue={vue} ui={ui} act={act} sid={sheet.id} onClose={close} />;
          case "optimize": return <OptimizeSheet key={key} vue={vue} ui={ui} act={act} onClose={close} />;
          case "avail": return <AvailSheet key={key} vue={vue} act={act} source={synchro.depot.source}
            week={sheet.week} onClose={close} />;
          case "data": return <DataSheet key={key} vue={vue} act={act} source={synchro.depot.source}
            email={compte?.email ?? ""} etat={etat} enAttente={enAttente} stockagePlein={stockagePlein}
            relancer={synchro.relancer} onClose={close}
            deconnecter={() => void deconnecter().catch((e: Error) => toast(html`${e.message}`))} />;
          default: return null;
        }
      })(derniere.current)}
    </FeuilleRacine>
  );
}
