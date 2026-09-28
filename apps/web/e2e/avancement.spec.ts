/* C. Suivre l'avancement d'un chantier : les 12 étapes, leurs missions,
   la barre de chaque étape, la carte et la note.

   Les vérifications d'état passent par `relire()` (changer de jour et
   revenir) : elles lisent ce qui est enregistré, indépendamment du rendu
   (voir affecter.spec.ts, constat U13). Le vivier est replié : il n'a rien à faire ici et
   couvrirait le bas des cartes. */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { JOURS, S12, S30, S9, TODAY, carte, chantier, effectif, effectifAvec, openLocal, poser, relire } from "./helpers";

test.describe.configure({ timeout: 60_000 });

const replie = { ui: { poolState: "bubble" as const } };
/* Le titre d'une étape. Son nom exact, parce qu'une mission peut porter
   le même mot (l'étape « Démolition » a une mission « Démolition »). */
const titreEtape = (c: Locator, nom: string): Locator =>
  c.getByRole("button").filter({
    has: c.page().locator("[data-etape-nom]", { hasText: new RegExp("^" + nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") })
  });
/* Les missions de l'étape dépliée : les boutons de sa liste. */
const missionsDe = (c: Locator): Locator => c.getByRole("list").getByRole("button");

/* « Les 12 étapes », puis le titre d'une étape. */
async function ouvrirEtape(page: Page, sid: string, nom: string): Promise<void> {
  const c = carte(page, sid);
  const acc = c.getByRole("button", { name: /^Les 12 étapes/ });
  if ((await acc.getAttribute("aria-expanded")) !== "true") await acc.click();
  await titreEtape(c, nom).click();
  await expect(titreEtape(c, nom)).toHaveAttribute("aria-expanded", "true");
  // L'étape repliée a fini de se refermer : les barres ne bougent plus.
  await expect(c.getByRole("list")).toHaveCount(1);
}

const etatsMissions = (missions: Locator): Promise<(string | null)[]> =>
  missions.evaluateAll(els => els.map(e => e.getAttribute("aria-pressed")));

test("C1 — « Les 12 étapes » s'ouvre sur l'étape en cours ; un seul chantier ouvert à la fois", async ({ page }) => {
  // Démolition finie : l'étape en cours de 9MD49 est la deuxième.
  await openLocal(page, { ...effectifAvec(e => { (chantier(e, S9).ph as number[])[0] = 100; }), ...replie });
  const c9 = carte(page, S9), c12 = carte(page, S12);
  const acc9 = c9.getByRole("button", { name: /^Les 12 étapes/ });
  await expect(acc9).toHaveAttribute("aria-expanded", "false");
  await expect(acc9).toContainText("1/12");
  await acc9.click();
  await expect(acc9).toHaveAttribute("aria-expanded", "true");
  await expect(c9.getByRole("slider")).toHaveCount(12);
  await expect(titreEtape(c9, "Saignées & passages réseaux")).toHaveAttribute("aria-expanded", "true");
  await expect(missionsDe(c9)).toHaveCount(2);

  const acc12 = c12.getByRole("button", { name: /^Les 12 étapes/ });
  await acc12.click();
  await expect(acc12).toHaveAttribute("aria-expanded", "true");
  await expect(titreEtape(c12, "Démolition")).toHaveAttribute("aria-expanded", "true");
  await expect(acc9).toHaveAttribute("aria-expanded", "false");
  await expect(c9.getByRole("slider")).toHaveCount(0);
});

test("C2 — le titre d'une étape déplie ses missions, une seule étape à la fois", async ({ page }) => {
  await openLocal(page, replie);
  const c = carte(page, S9);
  await c.getByRole("button", { name: /^Les 12 étapes/ }).click();
  const demolition = titreEtape(c, "Démolition");
  await expect(demolition).toHaveAttribute("aria-expanded", "true");
  await expect(missionsDe(c)).toHaveCount(5);

  const sols = titreEtape(c, "Sols & plinthes");
  await sols.click();
  await expect(sols).toHaveAttribute("aria-expanded", "true");
  await expect(demolition).toHaveAttribute("aria-expanded", "false");
  await expect(missionsDe(c)).toHaveCount(4);
  await expect(missionsDe(c).first()).toContainText("Ragréage");

  const finition = titreEtape(c, "Finition");
  await finition.click();
  await expect(sols).toHaveAttribute("aria-expanded", "false");
  await expect(missionsDe(c)).toHaveCount(3);
  await finition.click();
  await expect(finition).toHaveAttribute("aria-expanded", "false");
  await expect(missionsDe(c)).toHaveCount(0);
});

test("C1 — un volet qui s'ouvre ne défile pas sur lui-même quand le focus y entre", async ({ page }) => {
  /* Constat U26 : rogné par overflow: hidden, le volet était une zone de
     défilement. Un élément qu'on y faisait paraître pendant qu'il s'ouvre
     (le focus au clavier ou d'un lecteur d'écran, scrollIntoView) le
     faisait défiler sur lui-même ; puis le contenu redescendait image après
     image à mesure qu'il grandissait. Sous le doigt de Playwright, qui fait
     paraître ce qu'il touche : le titre visé descendait entre l'appui et le
     relâché, et le toucher ne dépliait rien (C5, C6, contre l'API, deux à
     trois fois sur quarante). */
  await openLocal(page, replie);
  const acc = carte(page, S9).getByRole("button", { name: /^Les 12 étapes/ });
  const defile = await acc.evaluate(async el => {
    (el as HTMLElement).click();
    await new Promise(r => requestAnimationFrame(r));
    const volet = document.getElementById(el.getAttribute("aria-controls")!)!;
    const titres = volet.querySelectorAll<HTMLElement>("[data-etape-nom]");
    titres[titres.length - 1]!.closest("button")!.focus();
    return volet.scrollTop;
  });
  expect(defile).toBe(0);
});

/* Replie l'étape ouverte (appui sur son titre) et relève, image après
   image, la hauteur de son volet (null : il a quitté le DOM) et celle de
   sa ligne ; puis la rouvre, posée. */
async function replierEtRelever(page: Page): Promise<{ hauteurs: (number | null)[]; lignes: number[] }> {
  return page.evaluate(async () => {
    const volet = document.querySelector<HTMLElement>("article[data-site] ul")!.parentElement!;
    const ligne = volet.parentElement!.parentElement!;
    const titre = ligne.querySelector<HTMLElement>("button[aria-expanded]")!;
    const image = () => new Promise(r => requestAnimationFrame(r));
    titre.click();
    const hauteurs: (number | null)[] = [], lignes: number[] = [];
    for (let i = 0; i < 40; i++) {
      await image();
      hauteurs.push(volet.isConnected ? Math.round(volet.getBoundingClientRect().height) : null);
      lignes.push(Math.round(ligne.getBoundingClientRect().height));
      if (hauteurs.filter(h => h === null).length > 2) break;
    }
    titre.click();
    await new Promise(r => setTimeout(r, 450));
    return { hauteurs, lignes };
  });
}

test.describe("C2 — une étape qui se replie", () => {
  /* Relecture adversariale de W6. Les missions de l'étape en cours de
     9MD49, déjà dépliées, repliées puis rouvertes vingt fois. */
  async function ouvrirEtapes(page: Page): Promise<void> {
    await openLocal(page);
    const c = carte(page, S9);
    await c.getByRole("button", { name: /^Les 12 étapes/ }).click();
    await expect(c.getByRole("list")).toBeVisible();
    await page.waitForTimeout(600);
  }

  test("C2 — ne repasse pas à pleine hauteur avant de quitter l'écran", async ({ page }) => {
    /* L'animation de repli rendait la hauteur « auto » à sa fin, le temps
       que React retire le volet : tout son contenu reparaissait une image,
       une fois sur quatre environ. */
    await ouvrirEtapes(page);
    const eclairs: string[] = [];
    for (let n = 0; n < 20; n++) {
      const h = (await replierEtRelever(page)).hauteurs.filter((x): x is number => x !== null);
      eclairs.push(...h.flatMap((x, i) => (i > 1 && x > h[i - 1]! + 1 ? [`${h[i - 1]} → ${x}`] : [])));
    }
    expect(eclairs).toEqual([]);
  });

  test("C2 — sa ligne ne saute pas quand les missions partent", async ({ page }) => {
    /* Rogné par overflow: clip (U26), le volet ne contenait plus les marges
       de la liste : la ligne de l'étape sautait de 8 px à la fin du repli. */
    await ouvrirEtapes(page);
    const r = await replierEtRelever(page);
    const parti = r.hauteurs.indexOf(null);
    let dernierZero = -1;
    for (let i = 0; i < parti; i++) if (r.hauteurs[i]! <= 1) dernierZero = i;
    expect(parti > 0 && dernierZero >= 0, JSON.stringify(r)).toBe(true);
    expect(Math.abs(r.lignes[parti]! - r.lignes[dernierZero]!), JSON.stringify(r)).toBeLessThanOrEqual(1);
  });
});

test.describe("C3 — cocher les missions", () => {
  test("C3 — cocher trois missions sur quatre met la barre à 75 %, décocher la fait reculer", async ({ page }) => {
    await openLocal(page, replie);
    const c = carte(page, S9);
    await ouvrirEtape(page, S9, "Sols & plinthes");
    const barre = c.getByRole("slider", { name: "Étape 10 Sols & plinthes" });
    const missions = missionsDe(c);
    await expect(missions).toHaveCount(4);
    await expect(barre).toHaveAttribute("aria-valuenow", "0");

    for (const j of [0, 1, 2]) await missions.nth(j).click();
    await relire(page);
    await expect(barre).toHaveAttribute("aria-valuenow", "75");
    expect(await etatsMissions(missions)).toEqual(["true", "true", "true", "false"]);
    const titre = titreEtape(c, "Sols & plinthes");
    await expect(titre.locator("[data-etape-missions]")).toHaveText("3/4");
    await expect(titre.locator("[data-etape-pct]")).toHaveText("75%");
    // L'avancement du chantier suit : 75 / 12 ≈ 6 %.
    await expect(c.locator("[data-avancement]")).toHaveText("6%");

    await missions.nth(1).click();
    await relire(page);
    await expect(barre).toHaveAttribute("aria-valuenow", "50");
    expect(await etatsMissions(missions)).toEqual(["true", "false", "true", "false"]);
  });

  test("C3 — la case et la barre réagissent aussitôt", async ({ page }) => {
    // Constat U13, corrigé : la mission était enregistrée, mais ni la case
    // ni la barre ne bougeaient avant le prochain changement de jour.
    await openLocal(page, replie);
    const c = carte(page, S9);
    await ouvrirEtape(page, S9, "Sols & plinthes");
    await missionsDe(c).first().click();
    await expect(missionsDe(c).first()).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
    await expect(c.getByRole("slider", { name: "Étape 10 Sols & plinthes" })).toHaveAttribute("aria-valuenow", "25", { timeout: 2_000 });
  });
});

test.describe("C4 — glisser sur la barre", () => {
  /* La barre fait 14 px de haut : on la prend en son milieu, amenée au
     centre de la liste pour que le vivier replié ne la couvre pas. */
  async function barreDe(page: Page): Promise<{ barre: Locator; x: (f: number) => number; y: number }> {
    const barre = carte(page, S9).getByRole("slider", { name: "Étape 10 Sols & plinthes" });
    await barre.evaluate(el => el.scrollIntoView({ block: "center" }));
    // hover attend que la barre soit immobile et découverte.
    await barre.hover();
    const b = (await barre.boundingBox())!;
    return { barre, x: f => b.x + b.width * f, y: b.y + b.height / 2 };
  }

  test("C4 — glisser coche les N premières missions ; à zéro tout se décoche ; un geste vertical ne change rien", async ({ page }) => {
    await openLocal(page, replie);
    const c = carte(page, S9);
    await ouvrirEtape(page, S9, "Sols & plinthes");
    const missions = missionsDe(c);
    let { barre, x, y } = await barreDe(page);

    await page.mouse.move(x(0.02), y);
    await page.mouse.down();
    await page.mouse.move(x(0.74), y, { steps: 8 });
    await page.mouse.up();
    await relire(page);
    await expect(barre).toHaveAttribute("aria-valuenow", "75");
    expect(await etatsMissions(missions)).toEqual(["true", "true", "true", "false"]);

    // Un geste vertical est lu comme un défilement : rien ne bouge.
    ({ barre, x, y } = await barreDe(page));
    await page.mouse.move(x(0.3), y);
    await page.mouse.down();
    await page.mouse.move(x(0.3), y + 40, { steps: 6 });
    await page.mouse.up();
    await relire(page);
    await expect(barre).toHaveAttribute("aria-valuenow", "75");

    // Jusqu'au bord gauche : tout se décoche.
    ({ barre, x, y } = await barreDe(page));
    await page.mouse.move(x(0.6), y);
    await page.mouse.down();
    await page.mouse.move(x(-0.1), y, { steps: 8 });
    await page.mouse.up();
    await relire(page);
    await expect(barre).toHaveAttribute("aria-valuenow", "0");
    expect(await etatsMissions(missions)).toEqual(["false", "false", "false", "false"]);
  });

  test("C4 — la barre suit le doigt pendant le glisser", async ({ page }) => {
    // Constat U2, corrigé : Chantiers.jsx ne transmettait pas le cinquième
    // argument (setGlisse) à act.bar, et la valeur locale n'était jamais
    // posée pendant le geste.
    await openLocal(page, replie);
    await ouvrirEtape(page, S9, "Sols & plinthes");
    const { barre, x, y } = await barreDe(page);
    await page.mouse.move(x(0.02), y);
    await page.mouse.down();
    await page.mouse.move(x(0.74), y, { steps: 8 });
    // Le doigt est toujours posé.
    await expect(barre).toHaveAttribute("aria-valuenow", "75", { timeout: 2_000 });
    await page.mouse.up();
  });

  test("C4 — un glisser interrompu par le système ne règle rien, et la barre revient à ce qui est enregistré", async ({ page }) => {
    /* Constat U23 : interrompu (pointercancel : un appel, une notification,
       un défilement que le navigateur reprend), le geste n'enregistrait
       rien, mais la barre gardait l'aperçu du glisser jusqu'à ce que
       l'étape se replie. Joué dans la page, comme B4 : la souris de
       Playwright ne sait pas annuler. */
    await openLocal(page, replie);
    const c = carte(page, S9);
    await ouvrirEtape(page, S9, "Sols & plinthes");
    const { barre } = await barreDe(page);
    await expect(barre).toHaveAttribute("aria-valuenow", "0");
    await barre.evaluate(async el => {
      const b = el.getBoundingClientRect();
      const y = b.y + b.height / 2;
      const ev = (type: string, x: number, sur: EventTarget) => sur.dispatchEvent(new PointerEvent(type,
        { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerId: 7, isPrimary: true, pointerType: "touch" }));
      ev("pointerdown", b.x + b.width * 0.02, el);
      for (let k = 1; k <= 8; k++) {
        await new Promise(r => requestAnimationFrame(r));
        ev("pointermove", b.x + b.width * (0.02 + 0.72 * k / 8), document);
      }
    });
    // L'aperçu suit le doigt…
    await expect(barre).toHaveAttribute("aria-valuenow", "75", { timeout: 2_000 });
    await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointercancel",
      { bubbles: true, pointerId: 7, isPrimary: true, pointerType: "touch" })));
    // …et s'efface avec le geste : rien n'est enregistré.
    await expect(barre).toHaveAttribute("aria-valuenow", "0", { timeout: 2_000 });
    expect(await etatsMissions(missionsDe(c))).toEqual(["false", "false", "false", "false"]);
    await relire(page);
    await expect(barre).toHaveAttribute("aria-valuenow", "0");
  });
});

test("C5 — un simple appui sur la barre bascule l'étape entre 0 et 100 %", async ({ page }) => {
  // ⚠ constat U4 (geste non documenté) : on fige le comportement tel quel.
  await openLocal(page, replie);
  const c = carte(page, S9);
  await ouvrirEtape(page, S9, "Sols & plinthes");
  const barre = c.getByRole("slider", { name: "Étape 10 Sols & plinthes" });
  await barre.click();
  await relire(page);
  await expect(barre).toHaveAttribute("aria-valuenow", "100");
  expect(await etatsMissions(missionsDe(c))).toEqual(["true", "true", "true", "true"]);
  await barre.click();
  await relire(page);
  await expect(barre).toHaveAttribute("aria-valuenow", "0");
});

test("C5 — un appui entre la barre et la première mission ne bascule rien", async ({ page }) => {
  /* Relecture adversariale de W5 : la zone de toucher de la barre (24 px,
     WCAG 2.5.8) couvre l'espace, mort en W4, qui la sépare de la première
     mission. Un appui là, en visant la mission, basculait l'étape à 100 %
     (ou décochait tout). La bascule n'a lieu que dans la barre dessinée ;
     dans sa zone, on peut la glisser, pas la basculer. */
  await openLocal(page, replie);
  const c = carte(page, S9);
  await ouvrirEtape(page, S9, "Sols & plinthes");
  const barre = c.getByRole("slider", { name: "Étape 10 Sols & plinthes" });
  /* La barre au milieu de la liste : laissée où le clic de l'étape l'a
     mise, elle finissait parfois au bord de ce qui se voit, et le point
     visé tombait sous la bande des jours ou sur la barre d'onglets
     (une fois sur six, W6). */
  await barre.evaluate(el => el.scrollIntoView({ block: "center" }));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const b = (await barre.boundingBox())!;
  const m = (await missionsDe(c).first().boundingBox())!;
  const x = b.x + b.width / 2, y = (b.y + b.height + m.y) / 2;
  // Le point visé est bien dans la zone de la barre, hors de son dessin.
  expect(y).toBeGreaterThan(b.y + b.height);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.getAttribute("role"), [x, y])).toBe("slider");
  await page.mouse.click(x, y);
  await relire(page);
  await expect(barre).toHaveAttribute("aria-valuenow", "0");
  expect(await etatsMissions(missionsDe(c))).toEqual(["false", "false", "false", "false"]);
});

test.describe("C6 — la barre au clavier", () => {
  test("C6 — les flèches avancent ou reculent d'un cran, Entrée et Espace basculent 0/100 %", async ({ page }) => {
    await openLocal(page, replie);
    await ouvrirEtape(page, S9, "Sols & plinthes");
    const barre = carte(page, S9).getByRole("slider", { name: "Étape 10 Sols & plinthes" });
    const attendu: [string, string][] = [
      ["ArrowRight", "25"], ["ArrowUp", "50"], ["ArrowLeft", "25"], ["ArrowDown", "0"],
      ["Enter", "100"], ["Space", "0"]
    ];
    for (const [touche, valeur] of attendu) {
      await barre.press(touche);
      await relire(page);
      await expect(barre, touche).toHaveAttribute("aria-valuenow", valeur);
    }
  });

  test("C6 — deux flèches de suite avancent de deux crans", async ({ page }) => {
    // Constat U13, corrigé : la barre n'étant pas redessinée, la seconde
    // flèche repartait de la valeur affichée (0) : un seul cran au total.
    await openLocal(page, replie);
    await ouvrirEtape(page, S9, "Sols & plinthes");
    const barre = carte(page, S9).getByRole("slider", { name: "Étape 10 Sols & plinthes" });
    await barre.press("ArrowRight");
    await barre.press("ArrowRight");
    await relire(page);
    await expect(barre).toHaveAttribute("aria-valuenow", "50", { timeout: 2_000 });
  });
});

test("C7 — la carte montre l'étape en cours, la prévision et douze barres", async ({ page }) => {
  const e = effectifAvec(e => {
    // 9MD49 : Nixon et Giorgi toute la semaine, Kia posé un jour où il est absent.
    for (const j of JOURS.slice(0, 5)) poser(e, S9, j, ["p_nixon", "p_giorgi"]);
    poser(e, S9, TODAY, ["p_nixon", "p_giorgi", "p_kia"]);
    // 12AB49 : livré.
    chantier(e, S12).ph = Array(12).fill(100);
    // 30JA90 : démarre plus tard.
    chantier(e, S30).start = "2026-10-05";
    // Un vieux chantier, dont la période est passée.
    e.sites.push({ ...effectif().sites[0], id: "s_vieux", code: "VIEUX1", addr: "1 rue Ancienne", start: "2026-06-01", plan: {} });
  });
  await openLocal(page, { ...e, ...replie });

  const c9 = carte(page, S9);
  await expect(c9.locator("[data-etape]")).toHaveText("01Démolition");
  await expect(c9.locator("[data-etape-note]")).toHaveText("semaine 1 sur 8");
  const fc9 = c9.locator("[data-prevision]");
  await expect(fc9).toContainText("114 j·h restants");
  await expect(fc9).toContainText("10 j·h posés");
  await expect(fc9).toContainText("fin 6 déc.");
  await expect(fc9.locator("[data-drapeau]").first()).toHaveText("Après le 1 nov.");
  await expect(fc9.locator("[data-drapeau=arret]")).toHaveText("1 jour en conflit");
  await expect(c9.locator("[data-echelle] i")).toHaveCount(12);
  await expect(c9.locator("[data-echelle] i[aria-current=step]")).toHaveCount(1);

  const c12 = carte(page, S12);
  await expect(c12.locator("[data-etape]")).toHaveText("Chantier livré");
  await expect(c12.locator("[data-prevision]")).toHaveText("Livré");
  await expect(c12.locator("[data-avancement]")).toHaveText("100%");
  await expect(c12.locator("[data-echelle] i")).toHaveCount(12);

  const c30 = carte(page, S30);
  await expect(c30.locator("[data-etape-note]")).toHaveText("démarre le 5 oct.");
  await expect(c30.locator("[data-prevision]")).toContainText("114 j·h restants");
  await expect(c30.locator("[data-prevision] [data-drapeau=arret]")).toHaveText("Personne cette semaine");
  await expect(c30).toHaveAttribute("data-inactif");

  const vieux = carte(page, "s_vieux");
  await expect(vieux.locator("[data-etape-note]")).toHaveText("période dépassée");
  await expect(vieux).toHaveAttribute("data-inactif");

  // Les chantiers actifs d'abord.
  const ordre = await page.locator("article[data-site]").evaluateAll(els => els.map(e => e.getAttribute("data-site")));
  expect(ordre.slice(0, 2).sort()).toEqual([S12, S9].sort());
});

test("C8 — la note de chantier s'enregistre à chaque frappe et se signale par un point", async ({ page }) => {
  await openLocal(page, replie);
  const c = carte(page, S9);
  const acc = c.getByRole("button", { name: /^Note de chantier/ });
  await expect(acc.locator("[data-pastille]")).toHaveCount(0);
  await acc.click();
  const note = c.getByPlaceholder("Réserves, matériel à commander, accès…");
  await note.pressSequentially("Clés chez le gardien");
  await relire(page);
  await expect(acc.locator("[data-pastille]")).toBeVisible();

  // Rien n'a quitté le champ : chaque frappe a déjà été enregistrée.
  await page.reload();
  const c2 = carte(page, S9);
  await expect(c2.getByRole("button", { name: /^Note de chantier/ }).locator("[data-pastille]")).toBeVisible();
  await c2.getByRole("button", { name: /^Note de chantier/ }).click();
  await expect(c2.getByPlaceholder("Réserves, matériel à commander, accès…")).toHaveValue("Clés chez le gardien");
});
