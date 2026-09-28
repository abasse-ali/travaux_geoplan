/* ============================================================
   La file des gestes et la synchronisation (ADR-004)

   Chaque règle de src/donnees/synchro.ts, contre une source factice
   dont le test règle la conduite : réponses, pannes, refus, lenteurs.
   ============================================================ */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { normPerson, normSite, teamOn } from "@geoplan/domain";
import { appliquer } from "@geoplan/domain/operations";
import { REESSAI_MS, Synchro } from "../src/donnees/synchro";
import {
  Injoignable, NonConnecte, RefusDefinitif,
  type Compte, type Depot, type Instantane, type Operation, type Source
} from "../src/donnees/types";

const JOUR = "2026-09-15";
const COMPTE: Compte = { id: "geoffrey@exemple.fr", email: "geoffrey@exemple.fr" };

const depart = (): Instantane => ({
  donnees: {
    people: ["p_a", "p_b"].map(id => normPerson(id, { name: id })),
    sites: ["s_1", "s_2"].map(id => normSite(id, { code: id.toUpperCase(), start: "2026-08-31" })),
    avail: []
  },
  versions: {}
});

const poser = (pid: string, sid = "s_1"): Operation =>
  ({ type: "poser", site: sid, jour: JOUR, compagnon: pid, urgence: false });

type Conduite = (op: Operation, cle: string, confirme: Instantane) => Promise<(i: Instantane) => Instantane>;

interface Factice {
  conduite: Conduite;
  accepter: Conduite;
  lecture: () => Promise<Instantane>;
  serveur: Instantane;
  envois: { op: Operation; cle: string }[];
  readonly maxEnVol: number;
  annoncer: (a: { mutation?: string }) => void;
  depot: Depot;
}

/** Une source factice : le « serveur » applique les gestes avec le domaine. */
function factice(source: Source = "api"): Factice {
  let serveur = depart();
  const envois: { op: Operation; cle: string }[] = [];
  let enVol = 0, maxEnVol = 0;
  const annonces: ((a: { mutation?: string }) => void)[] = [];
  const accepter: Conduite = async op => {
    serveur = { ...serveur, donnees: appliquer(serveur.donnees, op) };
    return i => ({ ...i, donnees: appliquer(i.donnees, op) });
  };
  const f: Factice = {
    conduite: accepter,
    accepter,
    lecture: async (): Promise<Instantane> => structuredClone(serveur),
    get serveur() { return serveur; },
    set serveur(s: Instantane) { serveur = s; },
    envois, get maxEnVol() { return maxEnVol; },
    annoncer: (a: { mutation?: string }) => annonces.forEach(cb => cb(a)),
    depot: {
      source,
      compte: async () => COMPTE,
      connecter: async () => COMPTE,
      deconnecter: async () => {},
      charger: (): Promise<Instantane> => f.lecture(),
      envoyer: async (op: Operation, cle: string, confirme: Instantane) => {
        envois.push({ op, cle });
        enVol++; maxEnVol = Math.max(maxEnVol, enVol);
        try { return await f.conduite(op, cle, confirme); } finally { enVol--; }
      },
      demanderDispos: async () => [],
      ecouter: (cb: (a: { mutation?: string }) => void) => { annonces.push(cb); return () => {}; }
    } satisfies Depot
  };
  return f;
}

let client: QueryClient;
const ouvertes: Synchro[] = [];

function ouvrir(f: ReturnType<typeof factice>, compte = COMPTE): Synchro {
  const s = new Synchro(f.depot, compte, client);
  ouvertes.push(s);
  return s;
}

/** Ce que fait useQuery au montage : une première lecture. */
const lire = (s: Synchro) => client.fetchQuery({ queryKey: s.cle, queryFn: s.lire });
const vide = (s: Synchro) => vi.waitFor(() => expect(s.file.getState().ops).toHaveLength(0));
const equipe = (s: Synchro, sid = "s_1") => teamOn(s.affichees().sites.find(x => x.id === sid)!, JOUR);

beforeEach(() => {
  localStorage.clear();
  (localStorage as unknown as { plein: boolean }).plein = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  for (const s of ouvertes.splice(0)) s.arreter();
  vi.useRealTimers();
});

describe("un geste", () => {
  it("se voit aussitôt, part, puis sort de la file une fois confirmé", async () => {
    const f = factice();
    const s = ouvrir(f);
    await lire(s);
    s.geste(poser("p_a"));
    expect(equipe(s)).toEqual(["p_a"]);                 // avant toute réponse
    await vide(s);
    expect(equipe(s)).toEqual(["p_a"]);                 // désormais dans l'instantané
    expect(teamOn(s.instantane()!.donnees.sites[0]!, JOUR)).toEqual(["p_a"]);
    expect(f.envois).toHaveLength(1);
  });

  it("n'attend pas le réseau pour s'afficher, même avant la première lecture", async () => {
    const f = factice();
    const s = ouvrir(f);
    client.setQueryData(s.cle, depart());               // une copie locale, sans lecture fraîche
    s.geste(poser("p_a"));
    expect(equipe(s)).toEqual(["p_a"]);
    await new Promise(r => setTimeout(r, 20));
    expect(f.envois).toHaveLength(0);                   // rien ne part avant une lecture du serveur
    await lire(s);
    await vide(s);
    expect(f.envois).toHaveLength(1);
  });
});

describe("l'ordre", () => {
  it("un seul envoi à la fois, dans l'ordre des gestes (S2)", async () => {
    const f = factice();
    f.conduite = async (op, cle, c) => { await new Promise(r => setTimeout(r, 5)); return f.accepter(op, cle, c); };
    const s = ouvrir(f);
    await lire(s);
    s.geste(poser("p_a"));
    s.geste(poser("p_b"));
    s.geste(poser("p_a", "s_2"));
    await vide(s);
    expect(f.maxEnVol).toBe(1);
    expect(f.envois.map(e => e.op)).toEqual([poser("p_a"), poser("p_b"), poser("p_a", "s_2")]);
    expect(equipe(s)).toEqual(["p_b"]);
    expect(equipe(s, "s_2")).toEqual(["p_a"]);
  });

  it("un geste fait pendant un envoi est un geste de plus, jamais avalé (S1)", async () => {
    const f = factice();
    let lacher!: () => void;
    const retenu = new Promise<void>(r => { lacher = r; });
    f.conduite = async (op, cle, c) => { if (op.type === "poser" && op.compagnon === "p_a") await retenu; return f.accepter(op, cle, c); };
    const s = ouvrir(f);
    await lire(s);
    s.geste(poser("p_a"));
    await vi.waitFor(() => expect(f.envois).toHaveLength(1));
    s.geste(poser("p_b"));                              // pendant l'envoi du premier
    lacher();
    await vide(s);
    expect(f.envois.map(e => e.op)).toEqual([poser("p_a"), poser("p_b")]);
    expect(f.serveur.donnees.sites[0]!.plan[JOUR]).toEqual(["p_a", "p_b"]);
  });
});

describe("les pannes", () => {
  it("injoignable : le geste reste, l'état dit « échec », et il repart toutes les 6 s", async () => {
    vi.useFakeTimers();
    const f = factice();
    let pannes = 2;
    f.conduite = async (op, cle, c) => { if (pannes-- > 0) throw new Injoignable("réseau"); return f.accepter(op, cle, c); };
    const s = ouvrir(f);
    await lire(s);
    await vi.advanceTimersByTimeAsync(10);             // la relance que programme toute lecture
    s.geste(poser("p_a"));
    await vi.advanceTimersByTimeAsync(10);            // l’envoi attend que le geste soit dessiné
    expect(s.file.getState()).toMatchObject({ envoi: "echec", ops: [{ op: poser("p_a") }] });
    expect(equipe(s)).toEqual(["p_a"]);                 // toujours affiché
    await vi.advanceTimersByTimeAsync(REESSAI_MS);
    expect(f.envois).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(REESSAI_MS);
    expect(s.file.getState().ops).toHaveLength(0);
    /* La même clé à chaque essai : l'idempotence du serveur l'exige. */
    expect(new Set(f.envois.map(e => e.cle)).size).toBe(1);
  });

  it("hors ligne, on n'essaie même pas", async () => {
    const f = factice();
    const s = ouvrir(f);
    await lire(s);
    (navigator as { onLine: boolean }).onLine = false;
    try {
      s.geste(poser("p_a"));
      await new Promise(r => setTimeout(r, 10));
      expect(f.envois).toHaveLength(0);
      expect(s.file.getState().envoi).toBe("echec");
    } finally { (navigator as { onLine: boolean }).onLine = true; }
    s.relancer();
    await vide(s);
  });

  it("refus définitif : le geste sort de la file, on le dit, et les suivants passent (S8)", async () => {
    const f = factice();
    f.conduite = async (op, cle, c) => {
      if (op.type === "poser" && op.site === "s_x") throw new RefusDefinitif("Chantier introuvable");
      return f.accepter(op, cle, c);
    };
    const s = ouvrir(f);
    const refus: string[] = [];
    s.on.refus = m => refus.push(m);
    await lire(s);
    s.geste(poser("p_a", "s_x"));
    s.geste(poser("p_b"));
    await vide(s);
    expect(refus).toEqual(["Chantier introuvable"]);
    expect(equipe(s)).toEqual(["p_b"]);
  });

  it("session expirée : le geste est gardé, et l'écran de connexion est demandé", async () => {
    const f = factice();
    f.conduite = async () => { throw new NonConnecte("401"); };
    const s = ouvrir(f);
    let deconnecte = false;
    s.on.deconnexion = () => { deconnecte = true; };
    await lire(s);
    s.geste(poser("p_a"));
    await vi.waitFor(() => expect(deconnecte).toBe(true));
    expect(s.file.getState().ops).toHaveLength(1);
  });
});

describe("la persistance", () => {
  it("la file survit à un rechargement, rangée par source et par compte (S7)", async () => {
    const f = factice();
    f.conduite = async () => { throw new Injoignable("réseau"); };
    const s = ouvrir(f);
    await lire(s);
    s.geste(poser("p_a"));
    await vi.waitFor(() => expect(s.file.getState().envoi).toBe("echec"));
    const cle = s.file.getState().ops[0]!.cle;
    s.arreter();

    const apres = ouvrir(f);                            // même compte : il retrouve son geste, même clé
    expect(apres.file.getState().ops).toEqual([{ cle, op: poser("p_a") }]);
    const autre = ouvrir(f, { id: "associe@exemple.fr", email: "associe@exemple.fr" });
    expect(autre.file.getState().ops).toEqual([]);      // un autre compte ne reçoit rien
    const local = ouvrir(factice("local"));
    expect(local.file.getState().ops).toEqual([]);
  });

  it("un stockage plein est signalé, une fois", async () => {
    const f = factice();
    f.conduite = async () => { throw new Injoignable("réseau"); };
    const s = ouvrir(f);
    let signale = 0;
    s.on.stockagePlein = () => { signale++; };
    await lire(s);
    (localStorage as unknown as { plein: boolean }).plein = true;
    s.geste(poser("p_a"));
    s.geste(poser("p_b"));
    expect(signale).toBe(1);
    expect(s.file.getState().stockagePlein).toBe(true);
  });
});

describe("relire pendant qu'un geste part", () => {
  it("une confirmation arrivée pendant la lecture n'est pas effacée par elle", async () => {
    const f = factice();
    const s = ouvrir(f);
    await lire(s);
    /* La lecture part AVANT que le serveur applique le geste, et répond
       APRÈS sa confirmation : sans précaution, elle effacerait le geste. */
    let lacherLecture!: () => void;
    const figee = structuredClone(f.serveur);
    f.lecture = () => new Promise(r => { lacherLecture = () => r(figee); });
    const relecture = lire(s);
    s.geste(poser("p_a"));
    await vide(s);
    lacherLecture();
    await relecture;
    expect(equipe(s)).toEqual(["p_a"]);
  });
});

describe("regrouper la frappe d'une note", () => {
  it("deux modifications de la même fiche, en file, n'en font qu'une, sous une clé neuve", async () => {
    const f = factice();
    f.conduite = async () => { throw new Injoignable("réseau"); };
    const s = ouvrir(f);
    await lire(s);
    s.geste(poser("p_a"));                              // en tête de file, en échec
    await vi.waitFor(() => expect(s.file.getState().envoi).toBe("echec"));
    s.geste({ type: "modifierChantier", site: "s_1", champs: { note: "a" } });
    const premiere = s.file.getState().ops[1]!.cle;
    s.geste({ type: "modifierChantier", site: "s_1", champs: { note: "ab" } });
    s.geste({ type: "modifierChantier", site: "s_1", champs: { code: "S1B" } });
    const ops = s.file.getState().ops;
    expect(ops.map(o => o.op)).toEqual([
      poser("p_a"),
      { type: "modifierChantier", site: "s_1", champs: { note: "ab", code: "S1B" } }
    ]);
    expect(ops[1]!.cle).not.toBe(premiere);
    expect(s.affichees().sites[0]!.note).toBe("ab");
  });

  it("ne touche jamais au geste en cours d'envoi", async () => {
    const f = factice();
    let lacher!: () => void;
    const retenu = new Promise<void>(r => { lacher = r; });
    f.conduite = async (op, cle, c) => { await retenu; return f.accepter(op, cle, c); };
    const s = ouvrir(f);
    await lire(s);
    s.geste({ type: "modifierChantier", site: "s_1", champs: { note: "a" } });
    await vi.waitFor(() => expect(f.envois).toHaveLength(1));
    s.geste({ type: "modifierChantier", site: "s_1", champs: { note: "ab" } });
    expect(s.file.getState().ops).toHaveLength(2);
    lacher();
    await vide(s);
    expect(f.envois.map(e => e.op.type === "modifierChantier" && e.op.champs.note)).toEqual(["a", "ab"]);
  });
});

describe("ce qui vient d'ailleurs", () => {
  it("une réponse de compagnon arrivée entre deux lectures est signalée ; la première lecture ne signale rien", async () => {
    const f = factice();
    f.serveur = { ...f.serveur, donnees: { ...f.serveur.donnees, avail: [
      { id: "p_a@2026-09-14", token: "t", personId: "p_a", week: "2026-09-14", days: null, note: "", answeredAt: null },
      { id: "p_b@2026-09-14", token: "u", personId: "p_b", week: "2026-09-14", days: [true, false, false, false, false, false, false], note: "", answeredAt: "2026-09-12T08:00:00Z" }
    ] } };
    const s = ouvrir(f);
    const reponses: string[] = [];
    s.on.reponse = pid => reponses.push(pid);
    client.setQueryData(s.cle, depart());               // la copie locale, plus ancienne
    await lire(s);
    expect(reponses).toEqual([]);
    const avail = f.serveur.donnees.avail.map(a => a.personId === "p_a"
      ? { ...a, days: [true, true, true, true, true, false, false], answeredAt: "2026-09-16T08:00:00Z" } : a);
    f.serveur = { ...f.serveur, donnees: { ...f.serveur.donnees, avail } };
    await client.fetchQuery({ queryKey: s.cle, queryFn: s.lire, staleTime: 0 });
    expect(reponses).toEqual(["p_a"]);
  });
});

describe("reprendre la file d'avant W4", () => {
  it("les modifications non envoyées de l'ancienne version deviennent des gestes, une seule fois", () => {
    const e = depart().donnees;
    e.sites[0]!.plan[JOUR] = ["p_a"];
    localStorage.setItem("geoplan.cache.v1", JSON.stringify({
      people: e.people, sites: e.sites, avail: [],
      dirty: ["sites/s_1", "people/p_x", "sites/s_9"], gone: ["people/p_x", "sites/s_9"]
    }));
    const s = ouvrir(factice("supabase"));
    expect(s.file.getState().ops.map(o => o.op.type)).toEqual(["creerChantier", "supprimerCompagnon", "supprimerChantier"]);
    const cree = s.file.getState().ops[0]!.op;
    expect(cree.type === "creerChantier" && cree.chantier.plan[JOUR]).toEqual(["p_a"]);
    expect(JSON.parse(localStorage.getItem("geoplan.cache.v1")!).dirty).toEqual([]);
    s.arreter();
    /* Relancée, l'application ne les reprend pas une seconde fois : ils
       sont dans la nouvelle file. */
    expect(ouvrir(factice("supabase")).file.getState().ops).toHaveLength(3);
  });
});

/* ---------- la relecture adversariale de W4 ----------
   Chaque test ci-dessous échouait avant sa correction. */

describe("relecture adversariale de W4", () => {
  const CLE_FILE = "geoplan.file.v4:api:" + COMPTE.id;

  it("deux lectures qui se chevauchent ne perdent pas une confirmation", async () => {
    const f = factice();
    const s = ouvrir(f);
    await lire(s);
    /* Deux lectures parties avant le geste, et retenues : la seconde
       annule la première pour TanStack, mais la première court toujours. */
    const figee = structuredClone(f.serveur);
    const lachers: (() => void)[] = [];
    f.lecture = () => new Promise(r => { lachers.push(() => r(structuredClone(figee))); });
    void lire(s).catch(() => {});
    const seconde = client.refetchQueries({ queryKey: s.cle });
    await vi.waitFor(() => expect(lachers).toHaveLength(2));
    s.geste(poser("p_a"));
    await vide(s);                                    // confirmé pendant les deux lectures
    lachers[0]!();                                    // la première finit : elle ne doit rien effacer
    await new Promise(r => setTimeout(r, 0));
    lachers[1]!();
    await seconde;
    expect(equipe(s)).toEqual(["p_a"]);
    expect(teamOn(s.instantane()!.donnees.sites[0]!, JOUR)).toEqual(["p_a"]);
  });

  it("arrêtée, la synchronisation n'envoie plus le geste suivant", async () => {
    const f = factice();
    let lacher!: () => void;
    const retenu = new Promise<void>(r => { lacher = r; });
    let premier = true;
    f.conduite = async (op, cle, c) => { if (premier) { premier = false; await retenu; } return f.accepter(op, cle, c); };
    const s = ouvrir(f);
    await lire(s);
    s.geste(poser("p_a"));
    s.geste(poser("p_b"));
    await vi.waitFor(() => expect(f.envois).toHaveLength(1));
    s.arreter();                                      // déconnexion pendant l'envoi de p_a
    lacher();
    await new Promise(r => setTimeout(r, 50));
    expect(f.envois).toHaveLength(1);
    /* p_b reste dans la file de ce compte, pour sa prochaine ouverture. */
    expect(s.file.getState().ops.map(o => o.op)).toEqual([poser("p_b")]);
  });

  it("arrêtée, elle ne réessaie plus un envoi en échec", async () => {
    vi.useFakeTimers();
    const f = factice();
    let lacher!: () => void;
    const retenu = new Promise<void>(r => { lacher = r; });
    f.conduite = async () => { await retenu; throw new Injoignable("réseau"); };
    const s = ouvrir(f);
    await lire(s);
    await vi.advanceTimersByTimeAsync(10);
    s.geste(poser("p_a"));
    await vi.advanceTimersByTimeAsync(10);
    expect(f.envois).toHaveLength(1);
    s.arreter();
    lacher();
    await vi.advanceTimersByTimeAsync(REESSAI_MS * 3);
    expect(f.envois).toHaveLength(1);
  });

  it("deux onglets du même compte partagent la file au lieu de s'écraser", async () => {
    const f = factice();
    f.conduite = async () => { throw new Injoignable("réseau"); };
    const onglet1 = ouvrir(f);
    const onglet2 = ouvrir(f);
    await lire(onglet1);
    onglet1.demarrer();
    onglet1.geste(poser("p_a"));
    onglet2.geste(poser("p_b"));
    const stockee = (JSON.parse(localStorage.getItem(CLE_FILE)!) as { op: Operation }[]).map(o => o.op);
    expect(stockee).toEqual([poser("p_a"), poser("p_b")]);
    /* L'onglet 1 apprend le geste de l'onglet 2 par l'événement storage. */
    window.dispatchEvent(Object.assign(new Event("storage"), { key: CLE_FILE }));
    expect(onglet1.file.getState().ops.map(o => o.op)).toEqual([poser("p_a"), poser("p_b")]);
  });

  it("une confirmation écrit l'instantané aussitôt, pas 250 ms plus tard", async () => {
    const f = factice();
    const s = ouvrir(f);
    await lire(s);
    s.geste(poser("p_a"));
    await vide(s);
    const stocke = JSON.parse(localStorage.getItem("geoplan.instantane.v4:api:" + COMPTE.id)!) as Instantane;
    expect(teamOn(stocke.donnees.sites.find(x => x.id === "s_1")!, JOUR)).toEqual(["p_a"]);
  });

  it("reprise de l'ancienne file, stockage plein : les marques restent tant que la nouvelle file n'est pas écrite", () => {
    const e = depart().donnees;
    localStorage.setItem("geoplan.cache.v1", JSON.stringify({
      people: e.people, sites: e.sites, avail: [], dirty: ["sites/s_1"], gone: []
    }));
    const stockage = localStorage as unknown as { setItem: (k: string, v: string) => void };
    const ecrire = stockage.setItem.bind(localStorage);
    stockage.setItem = (k, v) => {
      if (k.startsWith("geoplan.file.v4")) throw new DOMException("quota", "QuotaExceededError");
      ecrire(k, v);
    };
    try {
      const s = ouvrir(factice("supabase"));
      expect(s.file.getState().ops).toHaveLength(1);                      // en mémoire
      expect(s.file.getState().stockagePlein).toBe(true);
      expect(JSON.parse(localStorage.getItem("geoplan.cache.v1")!).dirty).toEqual(["sites/s_1"]);
    } finally { stockage.setItem = ecrire; }
  });

  it("caché entre le geste et l'image suivante, l'envoi part quand même", async () => {
    vi.useFakeTimers();
    const g = globalThis as { requestAnimationFrame?: (f: () => void) => number };
    g.requestAnimationFrame = () => 0;                // l'onglet ne peint plus : jamais rappelé
    try {
      const f = factice();
      const s = ouvrir(f);
      await lire(s);
      await vi.advanceTimersByTimeAsync(10);
      s.geste(poser("p_a"));
      await vi.advanceTimersByTimeAsync(150);
      expect(f.envois).toHaveLength(1);
    } finally { delete g.requestAnimationFrame; }
  });
});

describe("arrêtée puis redémarrée", () => {
  it("comme le fait StrictMode en développement : elle envoie de nouveau", async () => {
    const f = factice();
    const s = ouvrir(f);
    s.demarrer();
    s.arreter();
    s.demarrer();
    await lire(s);
    s.geste(poser("p_a"));
    await vide(s);
    expect(f.envois).toHaveLength(1);
  });
});
