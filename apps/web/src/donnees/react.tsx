/* ============================================================
   Les données dans React

   <Racine> choisit la source, retrouve le compte, et ne rend
   l'application qu'une fois tout cela su : pas d'écran de connexion
   entrevu au lancement quand une session valide était enregistrée.
   L'application reçoit ensuite, par contexte, la synchronisation de ce
   compte ; les écrans lisent la vue des données affichées.
   ============================================================ */

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { create } from "zustand";
import { choisirSource, creerDepot } from "./choix";
import { Synchro } from "./synchro";
import { Injoignable, NonConnecte, type Compte, type Depot, type Instantane } from "./types";
import type { Vue } from "./vue";

export const clientRequetes = new QueryClient({
  defaultOptions: { queries: { gcTime: Infinity } }
});

/* ---------- la session ---------- */

interface EtatSession {
  depot: Depot | null;
  /** undefined : pas encore su ; null : il faut se connecter. */
  compte: Compte | null | undefined;
  /** Le chargement de la source a échoué. */
  erreur: string | null;
}

export const useSession = create<EtatSession>(() => ({ depot: null, compte: undefined, erreur: null }));

export async function ouvrirSession(): Promise<void> {
  useSession.setState({ erreur: null, compte: undefined });
  try {
    const depot = await creerDepot(choisirSource());
    useSession.setState({ depot });
    /* iOS efface le stockage d'une application posée sur l'écran
       d'accueil quand il manque de place : on demande à le garder. */
    try { void navigator.storage?.persist?.(); } catch { /* sans effet ailleurs */ }
    useSession.setState({ compte: await depot.compte() });
  } catch (e) {
    useSession.setState({ erreur: (e as Error)?.message || "Chargement impossible" });
  }
}

export async function connecter(email: string, motDePasse: string): Promise<void> {
  const depot = useSession.getState().depot;
  if (!depot) throw new Error("Application pas encore prête");
  useSession.setState({ compte: await depot.connecter(email, motDePasse) });
}

/** Se déconnecter. Si la source ne peut pas révoquer la session (api,
    hors ligne), l'erreur remonte et l'on reste connecté : la session
    serait sinon rouverte au lancement suivant. */
export async function deconnecter(): Promise<void> {
  const depot = useSession.getState().depot;
  try { await depot?.deconnecter(); }
  catch (e) { if (e instanceof Injoignable) throw e; /* sinon, la session locale part quand même */ }
  useSession.setState({ compte: null });
}

/* ---------- la synchronisation du compte connecté ---------- */

/* Deux contextes : la synchronisation, qui ne change pas, et l'état de
   la requête, qui change à chaque lecture. Seul le bouton d'état lit le
   second ; l'application, elle, ne se redessine pas à chaque réponse du
   serveur. */
const SynchroCtx = createContext<Synchro | null>(null);
const RequeteCtx = createContext<UseQueryResult<Instantane> | null>(null);

export function useSynchro(): Synchro {
  const s = useContext(SynchroCtx);
  if (!s) throw new Error("useSynchro hors de <AvecSynchro>");
  return s;
}

function AvecSynchroInterne({ depot, compte, children }: { depot: Depot; compte: Compte; children: ReactNode }){
  const s = useMemo(() => new Synchro(depot, compte, clientRequetes), [depot, compte.id]);
  useEffect(() => {
    s.on.deconnexion = () => useSession.setState({ compte: null });
    s.demarrer();
    return () => s.arreter();
  }, [s]);
  const q = useQuery<Instantane>({
    queryKey: s.cle,
    queryFn: s.lire,
    initialData: () => s.initiale(),
    initialDataUpdatedAt: 0,
    staleTime: 0,
    retry: (_n, e) => !(e instanceof NonConnecte),
    retryDelay: 8000,
    networkMode: depot.source === "local" ? "always" : "online"
  });
  return (
    <SynchroCtx.Provider value={s}>
      <RequeteCtx.Provider value={q}>{children}</RequeteCtx.Provider>
    </SynchroCtx.Provider>
  );
}

export function AvecSynchro({ depot, compte, children }: { depot: Depot; compte: Compte; children: ReactNode }){
  return (
    <QueryClientProvider client={clientRequetes}>
      <AvecSynchroInterne depot={depot} compte={compte}>{children}</AvecSynchroInterne>
    </QueryClientProvider>
  );
}

/** Ce que l'écran affiche : l'instantané, et par-dessus les gestes
    encore en file (voir Synchro.vue). null tant que rien n'a jamais été lu. */
export function useVue(): Vue | null {
  const s = useSynchro();
  return useSyncExternalStore(s.abonnerVue, s.vue, s.vue);
}

export type EtatBouton = "local" | "ok" | "busy" | "off";

/** Ce que dit le bouton d'état : « Local », « À jour », « … », « N en attente ». */
export function useEtatDonnees(): { etat: EtatBouton; enAttente: number } {
  const c = { s: useSynchro(), q: useContext(RequeteCtx)! };
  /* En mode local, rien n'attend jamais : ne pas suivre les envois
     évite de redessiner le bouton à chaque geste. */
  const local = c.s.depot.source === "local";
  const n = c.s.file(e => (local ? 0 : e.ops.length));
  const envoi = c.s.file(e => (local ? "repos" : e.envoi));
  if (local) return { etat: "local", enAttente: 0 };
  if (n && envoi === "echec") return { etat: "off", enAttente: n };
  /* Ce qui s'affiche ne vient encore que de l'appareil (copie gardée) :
     « À jour » serait faux tant qu'aucune lecture n'a réussi. */
  const jamaisLu = c.q.dataUpdatedAt === 0;
  if (jamaisLu && c.q.failureCount > 0) return { etat: "off", enAttente: n };
  if (envoi === "envoi" || n || (jamaisLu && c.q.isFetching)) return { etat: "busy", enAttente: n };
  return { etat: "ok", enAttente: 0 };
}

/* ---------- la racine ---------- */

let sessionLancee = false;

export function Racine({ attente, erreur, connexion, children }: {
  attente: ReactNode;
  erreur: (message: string, reessayer: () => void) => ReactNode;
  connexion: ReactNode;
  children: ReactNode;
}){
  const { depot, compte, erreur: e } = useSession();
  /* Une seule ouverture, même quand le mode strict de React rejoue les
     effets en développement. */
  useEffect(() => { if (!sessionLancee) { sessionLancee = true; void ouvrirSession(); } }, []);
  if (e) return <>{erreur(e, () => void ouvrirSession())}</>;
  if (!depot || compte === undefined) return <>{attente}</>;
  if (compte === null) return <>{connexion}</>;
  return <AvecSynchro key={depot.source + ":" + compte.id} depot={depot} compte={compte}>{children}</AvecSynchro>;
}
