import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App, { Attente } from "./ui/App";
import Gate from "./ui/Gate";
import { Ecran } from "./ui/ecran";
import { bouton } from "./ui/primitives/classes";
import { Racine } from "./donnees/react";
import "./app.css";

/* Un écran qui plante ne doit jamais laisser une page blanche : les
   données sont dans le cache et dans la file, un rechargement suffit.
   Même mise en page que la page compagnon (ui/ecran.tsx). */
class Barriere extends Component<{ children: ReactNode }, { plante: boolean }> {
  state = { plante: false };
  static getDerivedStateFromError(): { plante: boolean } { return { plante: true }; }
  componentDidCatch(e: unknown): void { console.error("Écran en échec", e); }
  render(): ReactNode {
    if (!this.state.plante) return this.props.children;
    return (
      <Ecran titre="Cet écran n'a pas pu s'afficher" erreur>
        Vos données et les modifications en attente sont gardées sur cet appareil.
        <br /><br />
        <button className={bouton({ teinte: "primaire" })} onClick={() => location.reload()}>Recharger</button>
      </Ecran>
    );
  }
}

const attente = <Attente />;

const erreur = (message: string, reessayer: () => void) => (
  <Ecran titre="Chargement impossible" erreur>
    {message}. Vérifiez le réseau.
    <br /><br />
    <button className={bouton({ teinte: "primaire" })} onClick={reessayer}>Réessayer</button>
  </Ecran>
);

/* index.html porte toujours #root : son absence serait une erreur de
   construction, pas un cas à gérer. Le mouvement réduit se règle en CSS
   (mouvement-commun.css) et, pour ce que joue le script, dans
   ui/mouvement/reduit.ts (ADR-006). */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Barriere>
      <Racine attente={attente} erreur={erreur} connexion={<Gate />}>
        <App />
      </Racine>
    </Barriere>
  </StrictMode>
);
