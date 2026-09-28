/* ============================================================
   La synchronisation : l'instantané, la file des gestes (ADR-004)

   Pour un dépôt et un compte :

   • L'INSTANTANÉ est l'état du serveur tel qu'on le connaît. C'est une
     requête TanStack Query (`cle`) : relue au lancement, au retour du
     réseau et de l'application au premier plan, et à chaque annonce
     venue d'un autre appareil. Il est gardé dans localStorage, sous une
     clé propre à la source et au compte : au lancement, l'écran
     s'affiche avant toute réponse du réseau.

   • LA FILE est la suite des gestes pas encore confirmés, dans l'ordre
     où ils ont été faits, chacun avec sa clé d'idempotence. Elle aussi
     survit à un rechargement. Un seul envoi à la fois ; un geste ne
     sort de la file que confirmé, ou refusé pour de bon.

   • CE QUE L'ÉCRAN AFFICHE : l'instantané, sur lequel les gestes de la
     file sont rejoués par les fonctions du domaine. Un geste se voit
     donc aussitôt, et une relecture du serveur ne l'efface jamais.

   Les défauts de l'ancien magasin que cette forme règle : une écriture
   faite pendant un envoi n'est plus avalée (S1) ; un seul envoi à la
   fois (S2) ; un minuteur par usage (S3) ; relecture à la reprise du
   temps réel (S5) ; stockage plein signalé (S6) ; cache rangé par
   compte (S7) ; un refus définitif ne bloque plus la file (S8).

   Et ceux que la relecture adversariale de W4 a prouvés, réglés
   depuis : deux lectures qui se chevauchent ne perdent plus une
   confirmation ; une synchronisation arrêtée (déconnexion) n'envoie
   plus rien ; deux onglets du même compte partagent la même file au
   lieu de s'écraser ; l'instantané est écrit dès qu'une confirmation
   vide la file.
   ============================================================ */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { QueryClient } from "@tanstack/react-query";
import type { Avail } from "@geoplan/domain";
import { normPerson, normSite, type Person, type Site } from "@geoplan/domain";
import { appliquer } from "@geoplan/domain/operations";
import { CLE_LOCALE, lireCacheV1 } from "./local";
import { Vue, stabiliser } from "./vue";
import {
  NonConnecte, RefusDefinitif, instantaneVide,
  type Compte, type Depot, type Donnees, type Instantane, type Operation
} from "./types";

/** Un geste en attente de confirmation. */
export interface EnAttente { cle: string; op: Operation }

export interface EtatFile {
  ops: EnAttente[];
  /** repos : rien à envoyer ; envoi : un geste part ; echec : le dernier
      envoi n'a pas abouti, on réessaiera. */
  envoi: "repos" | "envoi" | "echec";
  /** Une écriture dans le stockage du navigateur a échoué (quota plein) :
      ce qui attend ne survivrait pas à un rechargement. */
  stockagePlein: boolean;
}

/** Réessai des envois en échec : 6 s, comme avant W4. */
export const REESSAI_MS = 6000;

/* randomUUID manque aux Safari d'avant 15.4 : 16 octets aléatoires font
   aussi bien l'affaire. */
const nouvelleCle = (): string => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
};

/* Rend la main jusqu'après la prochaine image peinte : requestAnimationFrame
   précède la peinture, le setTimeout qui suit vient après. Onglet caché,
   ou hors navigateur : pas d'image à attendre. Caché ENTRE-TEMPS,
   l'onglet ne peint plus et requestAnimationFrame ne rappellerait qu'au
   retour : un minuteur prend le relais. */
const apresLImage = (): Promise<void> => new Promise(ok => {
  if (typeof requestAnimationFrame === "function" && typeof document !== "undefined" && document.visibilityState === "visible") {
    const secours = setTimeout(ok, 100);
    requestAnimationFrame(() => { clearTimeout(secours); setTimeout(ok, 0); });
  } else setTimeout(ok, 0);
});

type Maj = (i: Instantane) => Instantane;

const estQuota = (e: unknown): boolean =>
  e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);

export interface Evenements {
  /** Un geste refusé pour de bon : il sort de la file. */
  refus?: (message: string, op: Operation) => void;
  /** La session n'est plus valable. */
  deconnexion?: () => void;
  /** Une réponse de compagnon est arrivée pendant qu'on regardait. */
  reponse?: (personId: string, semaine: string) => void;
  /** Le stockage du navigateur refuse d'écrire. */
  stockagePlein?: () => void;
}

export class Synchro {
  /** La clé de l'instantané dans TanStack Query. */
  readonly cle: readonly unknown[];
  readonly file: UseBoundStore<StoreApi<EtatFile>>;
  on: Evenements = {};

  private readonly cleFile: string;
  private readonly cleInstantane: string;
  private readonly suffixe: string;
  private enCours = false;
  /** Arrêtée (déconnexion, autre compte) : plus rien ne part, plus
      rien ne se relance. Un envoi en vol à l'arrêt se termine, rien
      après lui. */
  private arretee = false;
  /** La dernière écriture de la file a réussi : la file stockée fait
      foi (voir changerFile). */
  private fileStockee = true;
  /** La file vient d'être relue du stockage : inutile de la réécrire. */
  private depuisStockage = false;
  private minuteur: ReturnType<typeof setTimeout> | undefined;
  private minuteurCache: ReturnType<typeof setTimeout> | undefined;
  private minuteurRelecture: ReturnType<typeof setTimeout> | undefined;
  /** Les lectures en cours, chacune avec les confirmations arrivées
      depuis son départ : elle est peut-être partie avant elles, on les
      rejoue sur son résultat. Une liste PAR lecture : relire annule la
      lecture en cours pour TanStack, mais elle court toujours, et un
      champ commun remis à zéro à sa fin faisait oublier à la suivante
      une confirmation arrivée entre-temps — le geste disparaissait de
      l'écran, puis de la base avec Supabase (relecture adversariale). */
  private lectures = new Set<Maj[]>();
  /** Une lecture a réussi dans cette session : l'instantané est à jour.
      Avant cela, on n'envoie rien — Supabase réécrit des lignes
      entières, qu'il faut calculer depuis l'état du serveur. */
  private frais = false;
  private dejaLu = false;
  /** Les clés des derniers gestes envoyés : leurs annonces sont les
      nôtres, inutile de relire. */
  private miennes: string[] = [];
  private arrets: (() => void)[] = [];

  constructor(readonly depot: Depot, readonly compte: Compte, readonly client: QueryClient) {
    this.cle = ["donnees", depot.source, compte.id];
    this.suffixe = depot.source + ":" + compte.id;
    this.cleFile = "geoplan.file.v4:" + this.suffixe;
    this.cleInstantane = "geoplan.instantane.v4:" + this.suffixe;
    const reprise = depot.source === "supabase" ? this.reprendreAncienneFile() : null;
    this.file = create<EtatFile>(() => ({
      ops: [...this.lireFile(), ...(reprise?.ops ?? [])], envoi: "repos", stockagePlein: false
    }));
    /* Les marques de l'ancienne version ne s'effacent qu'une fois la
       nouvelle file écrite : stockage plein, elles restent, et seront
       reprises au lancement suivant plutôt que perdues. */
    if (reprise && this.ecrireFile(this.file.getState().ops)) reprise.effacerMarques();
    this.file.subscribe((e, avant) => {
      if (e.ops === avant.ops) return;
      if (!this.depuisStockage) this.ecrireFile(e.ops);
      this.rafraichirVue();
    });
  }

  /* ---------- l'instantané ---------- */

  /** Ce que l'écran peut montrer avant toute réponse du réseau. */
  initiale(): Instantane | undefined {
    if (this.depot.source === "local") return { donnees: lireCacheV1(), versions: {} };
    try {
      const brut = localStorage.getItem(this.cleInstantane);
      if (brut) return JSON.parse(brut) as Instantane;
    } catch { /* illisible : on relira le serveur */ }
    /* Première ouverture après la mise à jour : le cache d'avant W4, pour
       rester utilisable hors ligne (principe 6). */
    if (this.depot.source === "supabase") {
      const v1 = lireCacheV1();
      if (v1.people.length || v1.sites.length) return { donnees: v1, versions: {} };
    }
    return undefined;
  }

  instantane(): Instantane | undefined { return this.client.getQueryData<Instantane>(this.cle); }

  /** La fonction de lecture de la requête. */
  lire = async ({ signal }: { signal?: AbortSignal } = {}): Promise<Instantane> => {
    const avant = this.instantane();
    const recentes: Maj[] = [];
    this.lectures.add(recentes);
    try {
      const lu = await this.depot.charger();
      const apres = recentes.reduce((i, maj) => maj(i), lu);
      /* Abandonnée (une autre lecture l'a remplacée) : TanStack ignore
         son résultat, elle n'a rien à signaler. */
      if (signal?.aborted || this.arretee) return apres;
      if (this.dejaLu && avant) this.signalerReponses(avant.donnees, apres.donnees);
      this.dejaLu = true;
      this.frais = true;
      setTimeout(() => this.relancer(), 0);     // la file attendait peut-être cette lecture
      return apres;
    } catch (e) {
      if (e instanceof NonConnecte && !this.arretee) this.on.deconnexion?.();
      throw e;
    } finally {
      this.lectures.delete(recentes);
    }
  };

  /** Relire le serveur (annonce, reprise). Regroupe les annonces rapprochées. */
  relire(): void {
    if (this.arretee) return;
    clearTimeout(this.minuteurRelecture);
    this.minuteurRelecture = setTimeout(() => {
      void this.client.invalidateQueries({ queryKey: this.cle });
    }, 120);
  }

  private confirmer(maj: Maj): void {
    const i = this.instantane() ?? instantaneVide();
    this.client.setQueryData(this.cle, maj(i));
    for (const l of this.lectures) l.push(maj);
  }

  /** Les demandes de dispo que le serveur vient de créer ou de rendre. */
  integrerDemandes(liste: Avail[]): void {
    if (!liste.length) return;
    this.confirmer(i => {
      const neuves = new Map(liste.map(a => [a.id, a]));
      const avail = i.donnees.avail.map(a => neuves.get(a.id) ?? a);
      for (const a of liste) if (!i.donnees.avail.some(x => x.id === a.id)) avail.push(a);
      return { ...i, donnees: { ...i.donnees, avail } };
    });
  }

  /** Ce que l'écran affiche À CET INSTANT : l'instantané, et les gestes
      en file par-dessus. Les actions le relisent à chaque appel : deux
      touchers rapprochés voient chacun l'effet du précédent. */
  affichees(): Donnees {
    const i = this.instantane();
    const ops = this.file.getState().ops;
    if (i === this.memo.i && ops === this.memo.ops) return this.memo.d;
    const d = ops.reduce((acc, e) => appliquer(acc, e.op), (i ?? instantaneVide()).donnees);
    this.memo = { i, ops, d };
    return d;
  }
  private memo: { i: Instantane | undefined; ops: EnAttente[]; d: Donnees } =
    { i: undefined, ops: [], d: instantaneVide().donnees };

  /* ---------- la vue affichée, calculée hors de React ----------

     L'écran ne s'abonne qu'à elle (useSyncExternalStore). Elle n'est
     recalculée que quand l'instantané ou la file change, et l'écran
     n'est prévenu que si ce qu'il montre a VRAIMENT changé : un geste
     confirmé, qui passe de la file à l'instantané sans rien changer à
     l'écran, ne redessine rien. Calculée dans React, elle redessinait
     toute l'application trois fois par geste. */

  private vueCourante: Vue | null = null;
  private vueCalculee = false;
  private abonnesVue = new Set<() => void>();

  abonnerVue = (f: () => void): (() => void) => {
    this.abonnesVue.add(f);
    return () => { this.abonnesVue.delete(f); };
  };

  /** La vue affichée ; null tant que rien n'a jamais été lu. */
  vue = (): Vue | null => {
    if (!this.vueCalculee) { this.vueCalculee = true; this.vueCourante = this.calculerVue(); }
    return this.vueCourante;
  };

  private calculerVue(): Vue | null {
    if (!this.instantane()) {
      /* Premier lancement sans copie locale, et serveur injoignable : une
         application vide, comme avant W4, plutôt qu'une attente sans fin. */
      const echecs = this.client.getQueryState(this.cle)?.fetchFailureCount ?? 0;
      return echecs > 0 ? (this.vueCourante ?? new Vue(instantaneVide().donnees)) : null;
    }
    const d = this.affichees();
    const p = this.vueCourante;
    const stable = p ? stabiliser(p.donnees, d) : d;
    return p && stable === p.donnees ? p : new Vue(stable);
  }

  private rafraichirVue(): void {
    const v = this.calculerVue();
    this.vueCalculee = true;
    if (v === this.vueCourante) return;
    this.vueCourante = v;
    for (const f of this.abonnesVue) f();
  }

  private signalerReponses(avant: Donnees, apres: Donnees): void {
    const deja = new Map(avant.avail.map(a => [a.id, !!a.answeredAt]));
    for (const a of apres.avail)
      if (a.answeredAt && !deja.get(a.id)) this.on.reponse?.(a.personId, a.week);
  }

  /* ---------- la file ---------- */

  /** Ajoute un geste. Il se voit aussitôt, et part dès que possible.

      Deux modifications de la même fiche qui se suivent en file, sans
      que la première soit déjà partie, n'en font qu'une : la note d'un
      chantier s'écrit lettre par lettre, et chaque lettre ne doit pas
      devenir une requête. */
  geste(op: Operation): void {
    this.changerFile(ops => {
      const dernier = ops[ops.length - 1];
      const enVol = this.enCours ? ops[0]?.cle : undefined;
      if (dernier && dernier.cle !== enVol) {
        const a = dernier.op;
        const fusion: Operation | null =
          a.type === "modifierChantier" && op.type === "modifierChantier" && a.site === op.site
            ? { ...a, champs: { ...a.champs, ...op.champs } }
          : a.type === "modifierCompagnon" && op.type === "modifierCompagnon" && a.compagnon === op.compagnon
            ? { ...a, champs: { ...a.champs, ...op.champs } }
          : null;
        /* Une clé neuve : un premier envoi a pu atteindre le serveur sans
           que sa réponse revienne, et rejouer sa clé rendrait sa réponse
           à lui, sans les dernières frappes. */
        if (fusion) return [...ops.slice(0, -1), { cle: nouvelleCle(), op: fusion }];
      }
      return [...ops, { cle: nouvelleCle(), op }];
    });
    this.relancer();
  }

  /** Tente d'envoyer ce qui attend, maintenant. */
  relancer = (): void => {
    if (this.arretee) return;
    clearTimeout(this.minuteur);
    void this.vider();
  };

  /* La file stockée est la référence, commune aux onglets du même
     compte : chaque changement part d'elle, tant que le stockage
     accepte d'écrire. Chaque onglet réécrivait sinon sa propre file
     entière, et le dernier à écrire effaçait les gestes de l'autre
     (relecture adversariale de W4). Un stockage plein : la mémoire
     fait foi, elle seule a tout. */
  private changerFile(f: (ops: EnAttente[]) => EnAttente[]): void {
    const base = this.fileStockee ? this.lireFile() : this.file.getState().ops;
    this.file.setState({ ops: f(base) });
  }

  private retirer(cle: string): void {
    this.changerFile(ops => ops.filter(o => o.cle !== cle));
  }

  private echec(): void {
    this.file.setState({ envoi: "echec" });
    clearTimeout(this.minuteur);
    if (!this.arretee) this.minuteur = setTimeout(this.relancer, REESSAI_MS);
  }

  private async vider(): Promise<void> {
    if (this.enCours || this.arretee) return;
    this.enCours = true;
    try {
      /* Le geste d'abord, l'envoi ensuite. Appelée pendant le toucher,
         cette boucle écrivait le cache et recalculait la vue avant même
         que React dessine le geste : une demi-image de plus par mission
         cochée (mesure A/B de W4). On attend que l'image soit peinte. */
      await apresLImage();
      /* Un onglet à la fois envoie la file d'un compte : deux onglets qui
         partent du même geste l'enverraient deux fois. */
      const verrous = typeof navigator !== "undefined" ? navigator.locks : undefined;
      if (verrous) await verrous.request("geoplan.envoi:" + this.suffixe, () => this.envoyerLaFile());
      else await this.envoyerLaFile();
    } finally {
      this.enCours = false;
    }
  }

  private async envoyerLaFile(): Promise<void> {
    for (;;) {
      if (this.arretee) return;
      const e = this.file.getState().ops[0];
      if (!e) { this.file.setState({ envoi: "repos" }); return; }
      if (this.depot.source !== "local") {
        if (!this.frais) return;                    // la première lecture relancera
        if (typeof navigator !== "undefined" && navigator.onLine === false) { this.echec(); return; }
      }
      const confirme = this.instantane();
      if (!confirme) return;
      this.file.setState({ envoi: "envoi" });
      try {
        const maj = await this.depot.envoyer(e.op, e.cle, confirme);
        this.miennes = [...this.miennes.slice(-49), e.cle];
        this.confirmer(maj);
        /* L'instantané d'abord, la file ensuite : fermée entre les
           deux, l'application rouvre avec le geste dans l'un ou
           l'autre, jamais dans aucun des deux. */
        if (this.depot.source !== "local") this.ecrireInstantane(this.instantane() ?? confirme);
        this.retirer(e.cle);
      } catch (err) {
        if (err instanceof RefusDefinitif) {
          this.retirer(e.cle);
          if (!this.arretee) this.on.refus?.(err.message, e.op);
          this.relire();                            // l'écran retrouve l'état du serveur
          continue;
        }
        if (err instanceof NonConnecte) {
          this.file.setState({ envoi: "echec" });
          if (!this.arretee) this.on.deconnexion?.();
          return;
        }
        if (estQuota(err)) this.signalerStockagePlein();
        this.echec();
        return;
      }
    }
  }

  /* ---------- démarrage, arrêt ---------- */

  /* StrictMode (en développement) arrête puis redémarre la même
     synchronisation : démarrer la remet en marche. */
  demarrer(): void {
    this.arretee = false;
    const memeCle = (k: readonly unknown[]) => k.join("|") === this.cle.join("|");
    this.arrets.push(this.client.getQueryCache().subscribe(ev => {
      if (ev.type === "updated" && memeCle(ev.query.queryKey)) this.rafraichirVue();
    }));
    this.rafraichirVue();
    this.arrets.push(this.depot.ecouter(a => {
      if (a.mutation && this.miennes.includes(a.mutation)) return;
      this.relire();
    }));
    const auPremierPlan = () => { if (document.visibilityState === "visible") this.relancer(); };
    /* Un autre onglet du même compte a changé la file : on la reprend. */
    const autreOnglet = (ev: Event) => {
      if ((ev as StorageEvent).key !== this.cleFile) return;
      this.depuisStockage = true;
      try { this.file.setState({ ops: this.lireFile() }); } finally { this.depuisStockage = false; }
      this.relancer();
    };
    window.addEventListener("online", this.relancer);
    window.addEventListener("storage", autreOnglet);
    document.addEventListener("visibilitychange", auPremierPlan);
    this.arrets.push(() => {
      window.removeEventListener("online", this.relancer);
      window.removeEventListener("storage", autreOnglet);
      document.removeEventListener("visibilitychange", auPremierPlan);
    });
    if (this.depot.source !== "local")
      this.arrets.push(this.client.getQueryCache().subscribe(ev => {
        if (ev.type !== "updated" || !memeCle(ev.query.queryKey)) return;
        const d = ev.query.state.data as Instantane | undefined;
        if (!d) return;
        clearTimeout(this.minuteurCache);
        this.minuteurCache = setTimeout(() => this.ecrireInstantane(d), 250);
      }));
    this.relancer();
  }

  arreter(): void {
    this.arretee = true;
    for (const f of this.arrets.splice(0)) f();
    clearTimeout(this.minuteur);
    clearTimeout(this.minuteurCache);
    clearTimeout(this.minuteurRelecture);
  }

  /* ---------- stockage ---------- */

  /* Les modifications que l'application d'avant W4 n'avait pas encore
     envoyées quand elle a été mise à jour : elle les marquait dans son
     cache (« dirty », « gone »). Chacune devient un geste qui réécrit la
     ligne entière, exactement ce qu'elle aurait envoyé. Une seule fois :
     les marques sont effacées ensuite (effacerMarques, une fois la
     nouvelle file écrite), les données gardées.

     Un écart assumé : une suppression de compagnon reprise devient
     supprimerCompagnon, qui le retire aussi des équipes des chantiers
     où il figure encore en base. L'ancienne version n'envoyait que la
     suppression de la ligne, et laissait son identifiant dans les
     plans. */
  private reprendreAncienneFile(): { ops: EnAttente[]; effacerMarques: () => void } | null {
    let c: { people?: unknown[]; sites?: unknown[]; dirty?: unknown[]; gone?: unknown[] } | null = null;
    try { c = JSON.parse(localStorage.getItem(CLE_LOCALE) || "null"); } catch { return null; }
    if (!c || !Array.isArray(c.dirty) || !c.dirty.length) return null;
    const gone = new Set((c.gone ?? []).map(String));
    const people = (Array.isArray(c.people) ? c.people : []) as (Partial<Person> & { id?: string })[];
    const sites = (Array.isArray(c.sites) ? c.sites : []) as (Partial<Site> & { id?: string })[];
    const ops: EnAttente[] = [];
    for (const chemin of c.dirty.map(String)) {
      const [table, id] = [chemin.slice(0, chemin.indexOf("/")), chemin.slice(chemin.indexOf("/") + 1)];
      if (!id) continue;
      if (table === "sites") {
        const s = sites.find(x => x?.id === id);
        ops.push({ cle: nouvelleCle(), op: gone.has(chemin) || !s
          ? { type: "supprimerChantier", site: id }
          : { type: "creerChantier", chantier: normSite(id, s) } });
      } else if (table === "people") {
        const p = people.find(x => x?.id === id);
        ops.push({ cle: nouvelleCle(), op: gone.has(chemin) || !p
          ? { type: "supprimerCompagnon", compagnon: id }
          : { type: "creerCompagnon", compagnon: normPerson(id, p) } });
      }
    }
    const cache = c;
    return {
      ops,
      effacerMarques: () => {
        try { localStorage.setItem(CLE_LOCALE, JSON.stringify({ ...cache, dirty: [], gone: [] })); }
        catch { /* les marques resteront : reprises à nouveau, sans dommage */ }
      }
    };
  }

  private lireFile(): EnAttente[] {
    try {
      const v = JSON.parse(localStorage.getItem(this.cleFile) || "[]") as unknown;
      return Array.isArray(v) ? v.filter((o): o is EnAttente =>
        !!o && typeof (o as EnAttente).cle === "string" && !!(o as EnAttente).op) : [];
    } catch { return []; }
  }

  private ecrireFile(ops: EnAttente[]): boolean {
    try {
      if (ops.length) localStorage.setItem(this.cleFile, JSON.stringify(ops));
      else localStorage.removeItem(this.cleFile);
      this.fileStockee = true;
      return true;
    } catch (e) {
      this.fileStockee = false;
      if (estQuota(e)) this.signalerStockagePlein();
      return false;
    }
  }

  private ecrireInstantane(i: Instantane): void {
    try { localStorage.setItem(this.cleInstantane, JSON.stringify(i)); }
    catch (e) { if (estQuota(e)) this.signalerStockagePlein(); }
  }

  private signalerStockagePlein(): void {
    if (this.file.getState().stockagePlein) return;
    this.file.setState({ stockagePlein: true });
    this.on.stockagePlein?.();
  }
}
