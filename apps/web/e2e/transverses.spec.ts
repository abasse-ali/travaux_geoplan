/* K. Transverses : mouvement réduit, feuilles du bas, toasts. */

import { expect, test, type Page } from "@playwright/test";
import {
  S12, S9, TODAY, carte, effectifAvec, feuille, glisser, glisserDansLaPage, montrerZone, openLocal, poser, puceSur,
  puceVivier, survolerLeVivier, toastsVus, vivier, vuToast, zone
} from "./helpers";

test.describe.configure({ timeout: 60_000 });

const etat = (page: Page) => page.getByRole("button", { name: "État des données" });

/* L'animation d'un toast, dès qu'il paraît (un appui sur « Urgence » en
   fait paraître un) : son nom et sa durée calculée. Pas sa forme image
   après image : sous WebKit, getComputedStyle ne suit pas une animation
   CSS jouée par le compositeur (la même valeur revient pendant 120 ms,
   vérifié en W6). */
const animationDuToast = (page: Page): Promise<{ nom: string; duree: string }> => page.evaluate(async () => {
  document.querySelector<HTMLElement>("#vivier [role=switch]")!.click();
  let t: HTMLElement | null = null;
  while (!(t = document.querySelector<HTMLElement>("[data-toast]"))) await new Promise(r => requestAnimationFrame(r));
  const s = getComputedStyle(t);
  return { nom: s.animationName, duree: s.animationDuration };
});

test.describe("K3 — prefers-reduced-motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("K3 — les animations CSS décoratives sont coupées", async ({ page }) => {
    await openLocal(page);
    const puce = vivier(page).locator(".chip").first();
    await expect(puce).toBeVisible();
    // L'entrée des puces du vivier (chipIn) disparaît.
    expect(await puce.evaluate(el => getComputedStyle(el).animationName)).toBe("none");
    // Les transitions CSS restantes tombent à 0,01 ms.
    const zone = page.locator(".zone").first();
    const duree = await zone.evaluate(el => getComputedStyle(el).transitionDuration);
    for (const d of duree.split(",")) expect(parseFloat(d)).toBeLessThan(0.001);
  });

  test("K3 — au lâcher, rien ne vole", async ({ page }) => {
    /* Témoin : B1, où le même glisser fait voler le fantôme. */
    await openLocal(page);
    await montrerZone(page, S12);
    const r = await glisserDansLaPage(page, '#vivier [data-name="Nixon"]', `[data-drop="${S12}"]`);
    expect(r).toEqual({ enVol: false, arriveeCachee: false, soulevee: false,
      plusTard: { fantome: false, atterrit: 0, lifted: 0 } });
  });

  test("K3 — le vivier ne se déforme pas sous une puce", async ({ page }) => {
    /* Témoin : B3, où le même glisser le gonfle. */
    await openLocal(page, effectifAvec(e => poser(e, S9, TODAY, ["p_giorgi"])));
    await montrerZone(page, S9);
    expect(await survolerLeVivier(page, '[data-drop] [data-name="Giorgi"]')).toEqual({ survol: 0, apres: 0, transform: "none" });
  });

  test("K3 — le vivier change de forme d'un coup", async ({ page }) => {
    /* Web Animations échappe à la règle CSS du mouvement réduit : le
       code le demande lui-même (ui/mouvement/reduit.ts). Témoin : B15,
       où la même mesure trouve des hauteurs intermédiaires. */
    await openLocal(page);
    const r = await page.evaluate(async () => {
      const v = document.querySelector<HTMLElement>("#vivier")!;
      const depart = v.getBoundingClientRect().height;
      v.querySelector<HTMLElement>('[aria-label="Réduire le vivier"]')!.click();
      const hauteurs: number[] = [];
      for (let i = 0; i < 20; i++) {
        await new Promise(r => requestAnimationFrame(r));
        hauteurs.push(v.getBoundingClientRect().height);
      }
      return { depart, hauteurs };
    });
    const fin = r.hauteurs[r.hauteurs.length - 1]!;
    expect(fin).toBeLessThan(r.depart - 20);
    expect(r.hauteurs.filter(h => h < r.depart - 1 && h > fin + 1)).toEqual([]);
  });

  test("K3 — la feuille du bas se pose d'un coup", async ({ page }) => {
    /* Depuis W5, la feuille est le Drawer de shadcn/ui (vaul), animé en
       CSS : la règle prefers-reduced-motion l'arrête. */
    await openLocal(page);
    await etat(page).click();
    const f = feuille(page, "Données");
    await expect(f).toBeVisible();
    const duree = await f.evaluate(el => getComputedStyle(el).animationDuration);
    for (const d of duree.split(",")) expect(parseFloat(d)).toBeLessThan(0.001);
  });

  test("K3 — un toast paraît sans bouger", async ({ page }) => {
    /* Constat U10, corrigé en W5 : un toast montait encore par un
       ressort de Framer Motion. Depuis W6, il entre en CSS : la règle du
       mouvement réduit ramène son animation à 0,01 ms. Témoin : K5, où
       la même lecture trouve 0,3 s. */
    await openLocal(page);
    const a = await animationDuToast(page);
    expect(a.nom).toBe("toast-in");
    expect(parseFloat(a.duree)).toBeLessThan(0.001);
  });
});

test("K4 — une feuille se ferme par « Fermer », par Échap et par le fond", async ({ page }) => {
  await openLocal(page);
  const f = feuille(page, "Données");

  await etat(page).click();
  await expect(f).toBeVisible();
  await f.getByRole("button", { name: "Fermer" }).click();
  await expect(f).toBeHidden();

  await etat(page).click();
  await expect(f).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(f).toBeHidden();

  await etat(page).click();
  await expect(f).toBeVisible();
  // Le fond, au-dessus de la feuille.
  await page.locator("[data-vaul-overlay]").click({ position: { x: 30, y: 30 } });
  await expect(f).toBeHidden();
});

test("K4 — glissée vers le bas, une feuille se ferme ; un petit glisser la laisse revenir", async ({ page }) => {
  /* Relecture adversariale de W5 : ce geste n'était testé nulle part.
     vaul refuse tout glisser dans les 500 ms qui suivent l'ouverture, et
     calcule la vitesse du geste avec l'horloge — figée par openLocal. On
     l'avance à chaque pas du doigt : un geste de 400 ms. */
  await openLocal(page);
  const f = feuille(page, "Données");
  await etat(page).click();
  await expect(f).toBeVisible();
  // La feuille arrivée, pas en chemin (voir L2, accessibilite.spec.ts).
  await f.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => undefined))));
  const tete = (await f.locator("header").boundingBox())!;
  const x = tete.x + tete.width / 2, y = tete.y + tete.height / 2;
  const glisser = async (dy: number) => {
    let t = await page.evaluate(() => Date.now()) + 1_000;
    await page.clock.setFixedTime(t);
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) {
      t += 50;
      await page.clock.setFixedTime(t);
      await page.mouse.move(x, y + dy * k / 8);
    }
    await page.mouse.up();
  };
  await glisser(30);
  await page.waitForTimeout(700);
  await expect(f).toBeVisible();
  expect((await f.locator("header").boundingBox())!.y).toBeCloseTo(tete.y, 0);
  /* Glisser à la souris sélectionne le texte de l'en-tête (pas un doigt),
     et vaul refuse tout glisser tant qu'un texte est sélectionné. */
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await glisser(400);
  await expect(f).toBeHidden();
});

test("K4 — si les fiches ne se chargent pas, le planning reste et on le dit", async ({ page }) => {
  /* Relecture adversariale de W5 : les feuilles sont un morceau chargé à
     part. Après un déploiement, l'ancien n'existe plus sur le serveur ;
     s'il ne se chargeait pas, l'erreur remontait à la barrière de toute
     l'application, et le planning cédait la place à « Cet écran n'a pas
     pu s'afficher ». */
  await page.route(/Feuilles[^/]*\.(js|tsx)/, route => route.abort());
  await openLocal(page);
  await carte(page, S9).getByRole("button", { name: "Composer" }).click();
  await vuToast(page, "rechargez l'application");
  await expect(page.getByText("Cet écran n'a pas pu s'afficher")).toHaveCount(0);
  await expect(carte(page, S9)).toBeVisible();
  // Une deuxième fiche demandée le redit, sans rien casser.
  await carte(page, S9).getByRole("button", { name: "Modifier le chantier" }).click();
  await expect.poll(async () => (await toastsVus(page)).filter(t => t.texte.includes("rechargez")).length).toBe(2);
  await expect(carte(page, S9)).toBeVisible();
});

test("K4 — une feuille annonce son sous-titre", async ({ page }) => {
  /* Relecture adversariale de W5 : la description était retirée de toutes
     les feuilles, sous-titre ou non ; il n'était jamais annoncé. */
  await openLocal(page);
  await etat(page).click();
  const f = feuille(page, "Données");
  await expect(f).toBeVisible();
  // « Stockage local » en mode local, « Synchronisé » avec une base.
  await expect(f).toHaveAccessibleDescription(/^(Stockage local|Synchronisé)$/);
});

test("K4 — une feuille ignore le doigt le temps d'une frappe après son ouverture", async ({ page }) => {
  /* Le doigt qui vient de relever une puce déclenche un clic juste après
     l'ouverture de sa fiche : la feuille et son fond ne prennent aucun
     appui pendant 260 ms. En W5, Radix écrivait pointer-events:auto en
     ligne par-dessus la classe qui les neutralisait : la garde ne gardait
     plus rien (relecture adversariale). On lit ce que le navigateur
     applique, 60 ms puis 700 ms après l'apparition de la feuille. */
  await openLocal(page);
  await page.evaluate(() => {
    const w = window as unknown as { __garde: string[] };
    w.__garde = [];
    new MutationObserver((_, obs) => {
      const d = document.querySelector("[role=dialog]"), o = document.querySelector("[data-vaul-overlay]");
      if (!d || !o) return;
      obs.disconnect();
      const lire = (quand: string) => w.__garde.push(quand + " " + getComputedStyle(d).pointerEvents + " " + getComputedStyle(o).pointerEvents);
      setTimeout(() => lire("tôt"), 60);
      setTimeout(() => lire("tard"), 700);
    }).observe(document.body, { childList: true, subtree: true });
  });
  await etat(page).click();
  await expect(feuille(page, "Données")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __garde: string[] }).__garde))
    .toEqual(["tôt none none", "tard auto auto"]);
});

test("K5 — deux toasts au plus, et chacun vit 2,8 s", async ({ page }) => {
  await openLocal(page);
  await expect(vivier(page).getByRole("switch", { name: "Urgence" })).toBeVisible();
  // Trois messages coup sur coup (activer, désactiver, réactiver), une
  // image d'écart : aucun n'a le temps d'expirer, même sur une machine chargée.
  await page.evaluate(async () => {
    const lab = document.querySelector("#vivier [role=switch]") as HTMLElement;
    for (let i = 0; i < 3; i++) {
      lab.click();
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    }
  });
  await expect.poll(async () => (await toastsVus(page)).map(t => t.texte)).toEqual([
    "Mode urgence — un compagnon peut être posé sur deux chantiers le même jour",
    "Mode urgence désactivé",
    "Mode urgence — un compagnon peut être posé sur deux chantiers le même jour"
  ]);
  // Le plus ancien est chassé : il en reste deux.
  await expect(page.locator("[data-toast]")).toHaveText(["Mode urgence désactivé", /^Mode urgence — un compagnon/]);

  // Le dernier disparaît au bout de 2,8 s (plus l'animation de sortie).
  const dernier = (await toastsVus(page))[2];
  await expect(page.locator("[data-toast]")).toHaveCount(0, { timeout: 8_000 });
  const fin = await page.evaluate(() => performance.now());
  const vie = fin - dernier.t;
  expect(vie).toBeGreaterThanOrEqual(2_800);
  expect(vie).toBeLessThan(6_000);
});

test("K6 — une entrée ne se rejoue pas quand l'application se redessine", async ({ page }) => {
  /* Les entrées sont des animations CSS : une classe d'entrée ajoutée à
     un élément déjà là la rejoue. En W6, le libellé de la semaine, « Auj. »
     et le fondu de l'écran recevaient la leur au deuxième rendu de la coque
     (une référence relue à chaque rendu) : le libellé glissait sans que la
     semaine change, et couvrait 2 px de la flèche (L2, une fois sur deux).
     On note chaque animation qui démarre, dès le chargement ; la coque se
     redessine (l'urgence, deux fois) sans que rien n'arrive. */
  await page.addInitScript(() => {
    const w = window as unknown as { __entrees: string[] };
    w.__entrees = [];
    document.addEventListener("animationstart", e => {
      const el = e.target as Element;
      w.__entrees.push(e.animationName + " @ " + (el.closest("[data-semaine]") ? "semaine"
        : el.getAttribute("role") ?? el.textContent?.trim().slice(0, 12) ?? el.tagName));
    }, true);
  });
  await openLocal(page);
  await page.waitForTimeout(1_500);
  const urgence = vivier(page).getByRole("switch", { name: "Urgence" });
  await urgence.click();
  await urgence.click();
  await page.waitForTimeout(800);
  const entrees = await page.evaluate(() => (window as unknown as { __entrees: string[] }).__entrees);
  expect(entrees.filter(e => /^(semaine-|auj-in|fade @ tabpanel)/.test(e))).toEqual([]);
});

test("K7 — le son des gestes : éteint par défaut, une note pour poser, une pour retirer, retenu sur l'appareil", async ({ page }) => {
  /* W6 (Web Audio) : une note brève quand on pose ou retire une puce,
     désactivée par défaut. On n'écoute pas le haut-parleur du navigateur
     de test : un espion remplace le moteur audio et note chaque note
     jouée (sa fréquence de départ : 660 Hz pour poser, 520 pour retirer). */
  await page.addInitScript(() => {
    const w = window as unknown as { __notes: number[]; AudioContext: unknown };
    w.__notes = [];
    w.AudioContext = class {
      state = "running"; currentTime = 0; destination = {};
      resume() { return Promise.resolve(); }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: unknown) => d }; }
      createOscillator() {
        let f = 0;
        return { type: "", connect: (d: unknown) => d, stop() {}, start() { w.__notes.push(f); },
          frequency: { setValueAtTime(v: number) { if (!f) f = v; }, exponentialRampToValueAtTime() {} } };
      }
    };
  });
  await openLocal(page);
  const notes = () => page.evaluate(() => (window as unknown as { __notes: number[] }).__notes);

  // Éteint par défaut : poser ne fait aucun bruit.
  await montrerZone(page, S12);
  await glisser(page, puceVivier(page, "Nixon"), zone(page, S12));
  await vuToast(page, "Nixon sur 12AB49");
  expect(await notes()).toEqual([]);

  // L'activer, dans « Données » : on entend le son d'une puce posée.
  await etat(page).click();
  const f = feuille(page, "Données");
  await f.getByRole("switch", { name: "Sons des gestes" }).click();
  expect(await notes()).toEqual([660]);
  await f.getByRole("button", { name: "Fermer" }).click();
  await expect(f).toBeHidden();

  // Retirer : la note qui descend.
  await montrerZone(page, S12);
  await glisser(page, puceSur(page, S12, "Nixon"), vivier(page));
  await vuToast(page, "Nixon retiré de 12AB49");
  expect(await notes()).toEqual([660, 520]);

  // Retenu d'un lancement à l'autre.
  await page.reload();
  await etat(page).click();
  await expect(feuille(page, "Données").getByRole("switch", { name: "Sons des gestes" })).toBeChecked();
});

test("K5 — un toast entre en montant, et s'éteint avant de partir", async ({ page }) => {
  /* Témoin de K3 : sans mouvement réduit, la même lecture trouve une
     entrée de 0,3 s. Puis, à 2,8 s, il s'éteint (toast-out) avant de
     quitter l'écran. */
  await openLocal(page);
  expect(await animationDuToast(page)).toEqual({ nom: "toast-in", duree: "0.3s" });
  /* L'extinction ne dure que 180 ms : on la suit dans la page, image
     après image (un sondage depuis le test la manquerait). */
  const sortie = await page.evaluate(async () => {
    const t = document.querySelector<HTMLElement>("[data-toast]")!;
    const image = () => new Promise(r => requestAnimationFrame(r));
    while (!t.className.includes("toast-out")) {
      if (!t.isConnected) return { nom: "parti sans s'éteindre", duree: 0 };
      await image();
    }
    const debut = performance.now(), nom = getComputedStyle(t).animationName;
    while (t.isConnected) await image();
    return { nom, duree: performance.now() - debut };
  });
  expect(sortie.nom).toBe("toast-out");
  expect(sortie.duree).toBeGreaterThan(120);
  expect(sortie.duree).toBeLessThan(1_000);
});

test("K5 — un toast est centré et tient dans l'écran", async ({ page }) => {
  // Constat U15, corrigé : le CSS centrait le toast par
  // `left:50%; transform:translateX(-50%)`, que Framer Motion écrasait par
  // son propre transform ; et left:50% bornait sa largeur à la moitié de
  // l’écran. Il partait du milieu et butait sur le bord droit.
  await openLocal(page);
  await vivier(page).getByText("Urgence", { exact: true }).click();
  const t = page.locator("[data-toast]").filter({ hasText: "Mode urgence" });
  await expect(t).toBeVisible();
  const largeur = page.viewportSize()!.width;
  await expect.poll(async () => {
    const b = (await t.boundingBox())!;
    return Math.round(b.x + b.width / 2);
  }, { timeout: 2_000 }).toBe(Math.round(largeur / 2));
  const b = (await t.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(8);
  expect(b.x + b.width).toBeLessThanOrEqual(largeur - 8);
});
