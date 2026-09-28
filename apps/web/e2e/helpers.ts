/* Outils partagés des tests de bout en bout. */

import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";
import { FAUX, FauxSupabase, sessionEnregistree } from "./supabase/faux";

/* Le « maintenant » de tous les tests : mercredi 16 septembre 2026,
   8 h à Paris. Semaine 38, du lundi 14 au dimanche 20. */
export const NOW = new Date("2026-09-16T08:00:00+02:00");
export const WEEK = "2026-09-14";
export const TODAY = "2026-09-16";

/* Les jours de la semaine de référence, par index (lundi = 0). */
export const JOURS = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"];
export const IDX_AUJ = 2;

/* Les trois chantiers de l'effectif de référence. */
export const S9 = "s_9md49";
export const S12 = "s_12ab49";
export const S30 = "s_30ja90";

export interface Effectif { people: Record<string, unknown>[]; sites: Record<string, unknown>[] }

/* L'effectif de référence (13 compagnons, 3 chantiers ouverts le
   31 août), le même que celui du golden master. */
export function effectif(): Effectif {
  const raw = JSON.parse(readFileSync(new URL("../../../packages/domain/sim/effectif-reference.json", import.meta.url), "utf8"));
  return { people: raw.people, sites: raw.sites };
}

/* L'effectif de référence, retouché avant le chargement : un plan déjà
   posé, un chantier avancé… On part toujours d'une copie fraîche. */
export function effectifAvec(retouche: (e: Effectif) => void): Effectif {
  const e = effectif();
  retouche(e);
  return e;
}

/* Pose des compagnons sur un chantier, un jour donné, dans un effectif
   qui n'est pas encore chargé. */
export function poser(e: Effectif, siteId: string, jour: string, ids: string[]): void {
  const s = e.sites.find(x => x.id === siteId);
  if (!s) throw new Error("chantier inconnu : " + siteId);
  const plan = ((s.plan as Record<string, string[]> | undefined) ?? {});
  plan[jour] = ids;
  s.plan = plan;
}

export function chantier(e: Effectif, siteId: string): Record<string, unknown> {
  const s = e.sites.find(x => x.id === siteId);
  if (!s) throw new Error("chantier inconnu : " + siteId);
  return s;
}

export function compagnon(e: Effectif, id: string): Record<string, unknown> {
  const p = e.people.find(x => x.id === id);
  if (!p) throw new Error("compagnon inconnu : " + id);
  return p;
}

export interface Seed {
  people?: Record<string, unknown>[];
  sites?: Record<string, unknown>[];
  /* Demandes de dispo et réponses déjà reçues, au format du cache :
     { id, token, personId, week, days, note, answeredAt }. */
  avail?: Record<string, unknown>[];
  ui?: { tab?: string; poolState?: "open" | "bubble"; urgence?: boolean };
  /* Un autre « maintenant » que NOW, pour les gestes qui dépendent du
     jour de la semaine (la demande de dispos à partir du vendredi). */
  now?: Date;
  /* Source api seulement : un vrai mot de passe pour le compte, et
     l'ouverture sans session (écran de connexion). */
  motDePasse?: string;
  sansSession?: boolean;
}

/* Prépare une page en mode local, avant son premier chargement :
     • l'heure est figée sur NOW (les minuteries, elles, tournent) ;
     • aucune requête ne sort : polices et Supabase sont coupés ;
     • le cache local est rempli UNE fois par onglet — un rechargement
       retrouve donc ce que l'application a elle-même écrit, ce qui permet
       de tester la persistance. */
/** La source de données contre laquelle ce test tourne (ADR-004). */
export type Source = "local" | "api" | "supabase";
export const source = (): Source => {
  const p = test.info().project.name;
  return p.endsWith("-api") ? "api" : p.endsWith("-supabase") ? "supabase" : "local";
};

export async function openLocal(page: Page, seed: Seed = {}, path = "/"): Promise<void> {
  if (source() === "api") return ouvrirApi(page, seed, path);
  if (source() === "supabase") return ouvrirSupabase(page, seed, path);
  await page.clock.setFixedTime(seed.now ?? NOW);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r: Route) => r.abort());
  await page.route(/supabase\.co/, (r: Route) => r.abort());
  await noterLesToasts(page);
  const data =seed.people || seed.sites ? { people: seed.people || [], sites: seed.sites || [] } : effectif();
  await page.addInitScript(({ data, avail, ui }) => {
    if (sessionStorage.getItem("__e2e_seeded")) return;
    sessionStorage.setItem("__e2e_seeded", "1");
    localStorage.setItem("geoplan.cache.v1", JSON.stringify({
      people: data.people, sites: data.sites, avail, dirty: [], gone: []
    }));
    localStorage.setItem("geoplan.ui.v3", JSON.stringify({ tab: "chantiers", poolState: "open", urgence: false, ...ui }));
  }, { data, avail: seed.avail || [], ui: seed.ui || {} });
  await page.goto(path);
  // L'application est dessinée : les vérifications qui suivent partent d'un écran prêt.
  await expect(page.getByRole("banner")).toBeVisible({ timeout: 20_000 });
}

/* La même chose pour la source api : l'effectif est écrit dans la base
   de l'API de test (e2e/api/amorcer.ts), et la page s'ouvre avec une
   session déjà ouverte. Seul l'état d'interface passe par le
   navigateur. */
async function ouvrirApi(page: Page, seed: Seed, path: string): Promise<void> {
  await page.clock.setFixedTime(seed.now ?? NOW);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r: Route) => r.abort());
  await page.route(/supabase\.co/, (r: Route) => r.abort());
  await noterLesToasts(page);
  const data = seed.people || seed.sites ? { people: seed.people || [], sites: seed.sites || [] } : effectif();
  const { amorcerApi } = await import("./api/amorcer");
  const cookie = await amorcerApi({
    people: data.people as never, sites: data.sites as never, avail: (seed.avail || []) as never
  }, { motDePasse: seed.motDePasse, sansSession: seed.sansSession });
  if (cookie) await page.context().addCookies([{ name: cookie.nom, value: cookie.valeur, url: test.info().project.use.baseURL! }]);
  await page.addInitScript(ui => {
    if (sessionStorage.getItem("__e2e_seeded")) return;
    sessionStorage.setItem("__e2e_seeded", "1");
    localStorage.setItem("geoplan.ui.v3", JSON.stringify({ tab: "chantiers", poolState: "open", urgence: false, ...ui }));
  }, seed.ui || {});
  await page.goto(path);
  await expect(cookie ? page.getByRole("banner") : page.getByRole("button", { name: "Se connecter" }))
    .toBeVisible({ timeout: 20_000 });
}

/* La même chose pour la source supabase : un faux Supabase en mémoire,
   propre à ce test (e2e/supabase/faux.ts), et la session déjà rangée
   là où supabase-js la cherche. */
const fauxParContexte = new WeakMap<BrowserContext, FauxSupabase>();
export const fauxDe = (page: Page): FauxSupabase => {
  const f = fauxParContexte.get(page.context());
  if (!f) throw new Error("pas de faux Supabase pour ce test");
  return f;
};

async function ouvrirSupabase(page: Page, seed: Seed, path: string): Promise<void> {
  const maintenant = seed.now ?? NOW;
  await page.clock.setFixedTime(maintenant);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r: Route) => r.abort());
  await noterLesToasts(page);
  const data = seed.people || seed.sites ? { people: seed.people || [], sites: seed.sites || [] } : effectif();
  const faux = new FauxSupabase({ people: data.people, sites: data.sites, avail: seed.avail || [] });
  await faux.installer(page.context());
  fauxParContexte.set(page.context(), faux);
  const session = seed.sansSession ? null : sessionEnregistree(maintenant);
  await page.addInitScript(({ cfg, session, ui }) => {
    (globalThis as Record<string, unknown>).__GEOPLAN_E2E__ = cfg;
    if (sessionStorage.getItem("__e2e_seeded")) return;
    sessionStorage.setItem("__e2e_seeded", "1");
    if (session) localStorage.setItem(session.cle, session.valeur);
    localStorage.setItem("geoplan.ui.v3", JSON.stringify({ tab: "chantiers", poolState: "open", urgence: false, ...ui }));
  }, { cfg: FAUX, session, ui: seed.ui || {} });
  await page.goto(path);
  await expect(session ? page.getByRole("banner") : page.getByRole("button", { name: "Se connecter" }))
    .toBeVisible({ timeout: 20_000 });
}

/* ---------- ce que le serveur a enregistré (sources distantes) ---------- */

/** Les affectations d'un jour, dans l'ordre des chantiers puis des puces. */
export async function affectationsServeur(page: Page, jour: string): Promise<unknown[]> {
  if (source() === "supabase") return fauxDe(page).affectations(jour);
  const { lireBase } = await import("./api/amorcer");
  return lireBase("SELECT site_id, person_id FROM assignments WHERE day = ? ORDER BY site_id, position", [jour]);
}

/** Les identifiants des demandes de dispo enregistrées. */
export async function demandesServeur(page: Page): Promise<string[]> {
  if (source() === "supabase") return [...fauxDe(page).tables.avail_requests.keys()].sort();
  const { lireBase } = await import("./api/amorcer");
  return (await lireBase("SELECT id FROM avail_requests ORDER BY id") as { id: string }[]).map(l => l.id);
}

/* Un faux Supabase pour dispo.html. L'URL est factice : rien ne peut
   atteindre la vraie base, même en cas d'oubli d'interception. */
export const FAKE_SUPABASE = { url: "https://e2e-factice.supabase.co", key: "sb_publishable_e2e_factice_0123456789" };

export async function useFakeSupabase(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r: Route) => r.abort());
  await page.addInitScript(cfg => { (globalThis as Record<string, unknown>).__GEOPLAN_E2E__ = cfg; }, FAKE_SUPABASE);
}

/* ---------- lecteurs de l'écran ----------
   Par rôle, nom accessible ou attribut data-*, jamais par une classe :
   les classes changent avec le dessin (W5), pas ce qu'on vérifie. */

export const carte = (page: Page, sid: string): Locator => page.locator(`article[data-site="${sid}"]`);
export const zone = (page: Page, sid: string): Locator => page.locator(`[data-drop="${sid}"]`);
export const vivier = (page: Page): Locator => page.locator("section#vivier");
export const puceVivier = (page: Page, nom: string): Locator => vivier(page).locator(`[data-name="${nom}"]`);
export const puceSur = (page: Page, sid: string, nom: string): Locator => zone(page, sid).locator(`[data-name="${nom}"]`);
export const jours = (page: Page): Locator => page.getByRole("tablist", { name: "Jour affiché" }).getByRole("tab");
export const onglet = (page: Page, nom: "Chantiers" | "Semaine" | "Équipe"): Locator =>
  page.getByRole("tablist", { name: "Onglets" }).getByRole("tab", { name: nom });
export const feuille = (page: Page, titre: string | RegExp): Locator => page.getByRole("dialog", { name: titre });

/* Un toast à l'écran, reconnu à son texte (le HTML injecté ne compte
   pas : on lit le texte tel qu'il s'affiche). */
export const toast = (page: Page, texte: string | RegExp): Locator => page.locator("[data-toast]").filter({ hasText: texte });

/* Garde la trace de chaque toast affiché, avec son heure d'apparition.
   Un toast ne vit que 2,8 s : sur une machine chargée, l'étape qui
   précède la vérification (une feuille qui se referme) peut durer plus
   longtemps que lui. On vérifie donc qu'il est APPARU, pas qu'il est
   encore là — et l'on peut prouver qu'aucun autre n'est apparu.
   openLocal l'installe toujours ; l'appel est sans effet la seconde fois. */
export interface ToastVu { texte: string; t: number }

export async function noterLesToasts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __toasts?: { texte: string; t: number }[] };
    if (w.__toasts) return;
    const vus: { texte: string; t: number }[] = [];
    w.__toasts = vus;
    new MutationObserver(ms => {
      for (const m of ms) for (const n of Array.from(m.addedNodes))
        if (n instanceof HTMLElement && n.hasAttribute("data-toast"))
          vus.push({ texte: n.textContent || "", t: performance.now() });
    }).observe(document, { childList: true, subtree: true });
  });
}

export const toastsVus = (page: Page): Promise<ToastVu[]> =>
  page.evaluate(() => (window as unknown as { __toasts?: ToastVu[] }).__toasts ?? []);

/* Attend qu'un toast portant ce texte soit apparu depuis le chargement
   de la page (sous-chaîne, ou expression régulière sur le texte entier). */
export async function vuToast(page: Page, texte: string | RegExp, timeout = 10_000): Promise<void> {
  await expect.poll(async () => (await toastsVus(page)).some(t =>
    typeof texte === "string" ? t.texte.includes(texte) : texte.test(t.texte)),
  { message: `toast « ${texte} »`, timeout }).toBe(true);
}

/* ---------- gestes ---------- */

/* Amène la zone d'un chantier en haut de la liste, au-dessus du vivier
   déplié qui couvre le bas de l'écran — et hors des bandes de 56 px
   qui déclenchent le défilement automatique pendant un glisser. */
export async function montrerZone(page: Page, sid: string): Promise<void> {
  await zone(page, sid).evaluate(z => {
    const sc = z.closest("main") as HTMLElement;
    sc.scrollTop += z.getBoundingClientRect().top - sc.getBoundingClientRect().top - 40;
  });
}

export interface OptionsGlisser {
  /* Tenir le doigt immobile 250 ms (le seuil est à 190 ms) avant de
     bouger ; sinon, la puce se soulève dès 8 px de mouvement. */
  appuiLong?: boolean;
  /* Ce qui se passe une fois la puce soulevée, avant de viser : en
     pratique, faire défiler la liste comme le ferait le défilement
     automatique, pour amener une cible lointaine sous le doigt. */
  pendant?: () => Promise<void>;
  /* Ce qu'on vérifie le doigt encore posé sur la cible (la zone
     survolée change de couleur, par exemple). */
  avantDeLacher?: () => Promise<void>;
}

/* Le glisser-déposer au doigt passe par les Pointer Events : la souris
   de Playwright les produit, l'écran tactile ne sait que taper. On vise
   le centre de la cible, que useDrag retrouve par elementFromPoint.

   Piège : pendant un glisser, un doigt tenu à moins de 56 px du haut ou
   du bas de la liste la fait défiler, image après image. Une puce de la
   dernière rangée du vivier est dans la bande du bas : on la soulève
   donc d'un seul mouvement vers une hauteur neutre, avant de viser —
   sinon la liste défile sous la cible pendant qu'on la mesure. */
export async function glisser(page: Page, puce: Locator, cible: Locator, o: OptionsGlisser = {}): Promise<void> {
  await puce.hover();
  /* Une puce qui vient d'entrer dans le vivier (changement de jour)
     glisse encore à sa place : sur une machine chargée, l'appui tombait
     à côté, et le glisser ne partait pas. On attend qu'elle ne bouge
     plus d'une image à l'autre. */
  await expect.poll(async () => {
    const a = await puce.boundingBox();
    await page.waitForTimeout(100);
    const b = await puce.boundingBox();
    return !!a && JSON.stringify(a) === JSON.stringify(b);
  }, { timeout: 10_000 }).toBe(true);
  await puce.hover();
  const depart = await puce.boundingBox();
  if (!depart) throw new Error("puce invisible");
  const x0 = depart.x + depart.width / 2, y0 = depart.y + depart.height / 2;
  const liste = await page.locator("main").boundingBox();
  const yNeutre = liste ? Math.min(Math.max(y0, liste.y + 70), liste.y + liste.height - 70) : y0;
  await page.mouse.down();
  if (o.appuiLong) {
    await page.waitForTimeout(250);            // tenir l'appui long, sans bouger
    await expect(puce).toHaveClass(/\blifted\b/);
  }
  // Plus de 8 px, en un seul mouvement : la puce se soulève (si ce n'est déjà fait).
  await page.mouse.move(x0 + 12, yNeutre, { steps: 1 });
  await expect(puce).toHaveClass(/\blifted\b/);
  if (o.pendant) await o.pendant();
  const b = await cible.boundingBox();
  if (!b) throw new Error("cible invisible");
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  if (o.avantDeLacher) await o.avantDeLacher();
  await page.mouse.up();
}

/* Un glisser joué dans la page, d'une traite (un doigt : pointerdown,
   douze pas, pointerup ou pointercancel), et ce qu'on voit à l'image qui
   suit le relâché, puis 700 ms plus tard. Pour le vol du fantôme (W6) :
   le relâché doit être observé sans l'attente de Playwright. La cible
   est relue à chaque pas : la mise en page peut encore bouger. */
export interface ApresLacher {
  enVol: boolean;               // le fantôme visible, une animation en cours
  arriveeCachee: boolean;       // la puce d'arrivée invisible (.atterrit)
  soulevee: boolean;            // la puce de départ encore estompée (.lifted)
  plusTard: { fantome: boolean; atterrit: number; lifted: number };
}
export async function glisserDansLaPage(page: Page, puce: string, cible: string, fin: "pointerup" | "pointercancel" = "pointerup"): Promise<ApresLacher> {
  return page.evaluate(async ({ puce, cible, fin }) => {
    const p = document.querySelector<HTMLElement>(puce)!, c = document.querySelector<HTMLElement>(cible)!;
    const a = p.getBoundingClientRect();
    const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2;
    const centre = () => { const b = c.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] as const; };
    const ev = (type: string, x: number, y: number, sur: EventTarget) => sur.dispatchEvent(new PointerEvent(type,
      { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerId: 9, isPrimary: true, pointerType: "touch" }));
    const image = () => new Promise(r => requestAnimationFrame(r));
    ev("pointerdown", x0, y0, p);
    for (let k = 1; k <= 12; k++) {
      await image();
      const [x1, y1] = centre();
      ev("pointermove", x0 + (x1 - x0) * k / 12, y0 + (y1 - y0) * k / 12, document);
    }
    ev(fin, ...centre(), document);
    await image(); await image();
    const g = document.querySelector<HTMLElement>("[data-fantome]")!;
    const apres = {
      enVol: !g.hidden && g.getAnimations().length > 0,
      arriveeCachee: !!document.querySelector(".chip.atterrit"),
      soulevee: p.isConnected && p.classList.contains("lifted")
    };
    await new Promise(r => setTimeout(r, 700));
    return { ...apres, plusTard: { fantome: !g.hidden,
      atterrit: document.querySelectorAll(".chip.atterrit").length, lifted: document.querySelectorAll(".chip.lifted").length } };
  }, { puce, cible, fin });
}

/* Une puce posée glissée jusqu'au vivier, dans la page : les animations
   que le script joue sur l'îlot pendant le survol (pas ses transitions
   CSS de fond et de bord), puis 700 ms après le lâcher, et sa
   transformation finale (W6 : il se gonfle, puis avale la puce). */
export async function survolerLeVivier(page: Page, puce: string): Promise<{ survol: number; apres: number; transform: string }> {
  return page.evaluate(async puce => {
    const p = document.querySelector<HTMLElement>(puce)!;
    const ilot = document.querySelector<HTMLElement>("#vivier")!;
    const titre = ilot.querySelector<HTMLElement>("[data-vivier-titre]")!;
    const a = p.getBoundingClientRect();
    const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2;
    const centre = () => { const b = titre.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] as const; };
    const ev = (type: string, x: number, y: number, sur: EventTarget) => sur.dispatchEvent(new PointerEvent(type,
      { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerId: 11, isPrimary: true, pointerType: "touch" }));
    const image = () => new Promise(r => requestAnimationFrame(r));
    const scripts = () => ilot.getAnimations().filter(x => !(x instanceof CSSTransition) && !(x instanceof CSSAnimation)).length;
    ev("pointerdown", x0, y0, p);
    for (let k = 1; k <= 12; k++) {
      await image();
      const [x1, y1] = centre();
      ev("pointermove", x0 + (x1 - x0) * k / 12, y0 + (y1 - y0) * k / 12, document);
    }
    await image(); await image();
    const survol = scripts();
    ev("pointerup", ...centre(), document);
    await new Promise(r => setTimeout(r, 700));
    return { survol, apres: scripts(), transform: getComputedStyle(ilot).transform };
  }, puce);
}

/* ---------- lectures ---------- */

/* Change de jour et revient : la carte est reconstruite de zéro, et ce
   qu'elle montre est ce qui est enregistré, indépendamment du rendu
   incrémental (qui a eu son défaut, constat U13). */
export async function relire(page: Page): Promise<void> {
  const t = jours(page);
  const i = await t.evaluateAll(els => els.findIndex(e => e.getAttribute("aria-selected") === "true"));
  const autre = (i + 1) % 7;
  await t.nth(autre).click();
  await expect(t.nth(autre)).toHaveAttribute("aria-selected", "true");
  await t.nth(i).click();
  await expect(t.nth(i)).toHaveAttribute("aria-selected", "true");
}

/* Les noms posés sur chaque chantier, jour par jour, lus dans la grille
   de l'onglet Semaine (le libellé accessible de chaque case donne tous
   les noms, sans la troncature « +N » de l'affichage). */
export async function grille(page: Page): Promise<Record<string, Record<string, string[]>>> {
  const labels = await page.locator('[data-grille-semaine] [data-ligne="chantier"] button[data-case]').evaluateAll(
    els => els.map(e => e.getAttribute("aria-label") || ""));
  const out: Record<string, Record<string, string[]>> = {};
  for (const l of labels) {
    const m = /^(\S+) (\S+) : (.*)$/.exec(l);
    if (!m) continue;
    const [, code, jour, noms] = m;
    (out[code] ??= {})[jour] = noms === "personne" ? [] : noms.split(", ");
  }
  return out;
}
