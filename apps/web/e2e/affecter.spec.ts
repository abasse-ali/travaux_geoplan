/* B. Affecter les compagnons — le cœur de l'application : poser au doigt.

   Constat U13 (corrigé) : les cartes chantier ne se redessinaient pas
   après une écriture — la carte mémorisée comparait `a.site._rev` à
   `b.site._rev`, deux lectures du même objet modifié sur place. Les tests
   « … aussitôt » vérifient que l'écran suit le geste. Les autres lisent
   l'état réel après `relire()` (changer de jour et revenir) : ils vérifient
   ce qui est enregistré, indépendamment du rendu. */

import { expect, test } from "@playwright/test";
import {
  IDX_AUJ, S12, S30, S9, TODAY, JOURS, WEEK, effectifAvec, feuille, glisser, glisserDansLaPage, grille, jours, montrerZone,
  onglet, openLocal, poser, puceSur, puceVivier, relire, survolerLeVivier, toastsVus, vivier, vuToast, zone
} from "./helpers";

/* WebKit sous Windows, six navigateurs en parallèle : un geste complet,
   avec ses animations et ses relectures, dépasse parfois 20 s. */
test.describe.configure({ timeout: 60_000 });

const nomsDuVivier =(page: import("@playwright/test").Page): Promise<string[]> =>
  vivier(page).locator(".chip").evaluateAll(els => els.map(e => e.getAttribute("data-name") || ""));

test.describe("B1 — poser depuis le vivier", () => {
  test("B1 — appui long puis glisser pose le compagnon sur le chantier", async ({ page }) => {
    /* Le retour haptique n'existe pas dans WebKit de bureau : on pose
       une fonction espionne là où l'iPhone aurait la sienne. */
    await page.addInitScript(() => {
      const w = window as unknown as { __vibrations: number[] };
      w.__vibrations = [];
      Object.defineProperty(navigator, "vibrate", {
        configurable: true, value: (ms: number) => { w.__vibrations.push(ms); return true; }
      });
    });
    await openLocal(page);
    await expect(vivier(page).locator("[data-vivier-titre]")).toHaveText("Vivier · mer · 11");
    await montrerZone(page, S12);

    await glisser(page, puceVivier(page, "Nixon"), zone(page, S12), { appuiLong: true });

    await vuToast(page, "Nixon sur 12AB49 · mercredi 16 sept.");
    await expect(puceVivier(page, "Nixon")).toHaveCount(0);
    await expect(vivier(page).locator("[data-vivier-titre]")).toHaveText("Vivier · mer · 10");
    await expect(page.getByRole("banner").locator("p")).toHaveText("1 chantier ouvert · 10 libres");
    expect(await page.evaluate(() => (window as unknown as { __vibrations: number[] }).__vibrations)).toEqual([12]);

    await relire(page);
    await expect(puceSur(page, S12, "Nixon")).toBeVisible();
    await expect(zone(page, S12).locator("[data-zone-titre]")).toHaveText("Mercredi 16 sept. · 1");
    // Sa pastille du mercredi est allumée, les autres jours non.
    await expect(puceSur(page, S12, "Nixon").locator("s[data-etat=pose]")).toHaveCount(1);
    await expect(puceSur(page, S12, "Nixon").locator("s").nth(IDX_AUJ)).toHaveAttribute("data-etat", "pose");
    // Et nulle part ailleurs.
    await expect(puceSur(page, S9, "Nixon")).toHaveCount(0);
    await expect(puceSur(page, S30, "Nixon")).toHaveCount(0);
  });

  test("B1 — glisser de plus de 8 px, sans attendre, soulève aussi la puce", async ({ page }) => {
    await openLocal(page);
    await montrerZone(page, S9);
    await glisser(page, puceVivier(page, "Aklan"), zone(page, S9));
    await vuToast(page, "Aklan sur 9MD49 · mercredi 16 sept.");
    await expect(puceVivier(page, "Aklan")).toHaveCount(0);
    await relire(page);
    await expect(puceSur(page, S9, "Aklan")).toBeVisible();
  });

  test("B1 — la puce posée apparaît aussitôt dans la zone du chantier", async ({ page }) => {
    // Constat U13, corrigé : la carte mémorisée comparait l'objet chantier
    // modifié sur place avec lui-même, et la zone restait vide jusqu'au
    // prochain changement de jour.
    await openLocal(page);
    await montrerZone(page, S12);
    await glisser(page, puceVivier(page, "Nixon"), zone(page, S12), { appuiLong: true });
    await vuToast(page, "Nixon sur 12AB49");
    await expect(puceSur(page, S12, "Nixon")).toBeVisible({ timeout: 2_000 });
  });
});

test("B1 — au lâcher, le fantôme vole jusqu'à la puce posée, qui paraît à son arrivée", async ({ page }) => {
  /* W6 : le fantôme ne disparaît plus d'un coup au relâché. Il va se
     poser sur la puce qui paraît dans la zone, invisible le temps du
     vol : c'est lui qui devient elle. Témoin de K3 (mouvement réduit :
     rien ne vole). */
  await openLocal(page);
  await montrerZone(page, S12);
  const r = await glisserDansLaPage(page, '#vivier [data-name="Nixon"]', `[data-drop="${S12}"]`);
  expect(r).toEqual({ enVol: true, arriveeCachee: true, soulevee: false,
    plusTard: { fantome: false, atterrit: 0, lifted: 0 } });
  await expect(puceSur(page, S12, "Nixon")).toBeVisible();
});

test("B2 — glisser d'un chantier à l'autre déplace le compagnon", async ({ page }) => {
  await openLocal(page, effectifAvec(e => poser(e, S9, TODAY, ["p_nixon"])));
  await montrerZone(page, S9);
  // La zone d'arrivée est loin : on la fait venir sous le doigt une fois
  // la puce soulevée, comme le ferait le défilement automatique.
  await glisser(page, puceSur(page, S9, "Nixon"), zone(page, S12), { pendant: () => montrerZone(page, S12) });
  await vuToast(page, "Nixon : 9MD49 → 12AB49 · mercredi 16 sept.");
  await relire(page);
  await expect(puceSur(page, S12, "Nixon")).toBeVisible();
  await expect(puceSur(page, S9, "Nixon")).toHaveCount(0);
  await expect(puceVivier(page, "Nixon")).toHaveCount(0);
});

test.describe("B3 — rendre au vivier", () => {
  const seed = () => effectifAvec(e => {
    // Un doublon laissé par le mode urgence, et un autre jour qui ne doit pas bouger.
    poser(e, S9, TODAY, ["p_nixon", "p_giorgi"]);
    poser(e, S12, TODAY, ["p_nixon"]);
    poser(e, S9, JOURS[3], ["p_nixon"]);
  });

  test("B3 — glisser une puce posée vers le vivier la retire de ce jour, sur tous les chantiers", async ({ page }) => {
    await openLocal(page, seed());
    await expect(puceVivier(page, "Nixon")).toHaveCount(0);
    await montrerZone(page, S9);
    await glisser(page, puceSur(page, S9, "Nixon"), vivier(page));
    await vuToast(page, "Nixon retiré de 9MD49 · mercredi 16 sept.");
    await expect(puceVivier(page, "Nixon")).toBeVisible();
    await relire(page);
    await expect(puceSur(page, S9, "Nixon")).toHaveCount(0);
    await expect(puceSur(page, S12, "Nixon")).toHaveCount(0);
    await expect(puceSur(page, S9, "Giorgi")).toBeVisible();
    // Le jeudi n'est pas touché.
    await jours(page).nth(3).click();
    await expect(puceSur(page, S9, "Nixon")).toBeVisible();
  });

  test("B3 — la puce rendue au vivier quitte aussitôt la zone", async ({ page }) => {
    // Constat U13, corrigé : la zone gardait la puce retirée jusqu'au
    // prochain changement de jour.
    await openLocal(page, seed());
    await montrerZone(page, S9);
    await glisser(page, puceSur(page, S9, "Nixon"), vivier(page));
    await vuToast(page, "Nixon retiré de 9MD49");
    await expect(puceSur(page, S9, "Nixon")).toHaveCount(0, { timeout: 2_000 });
  });

  test("B3 — le vivier se gonfle sous une puce posée, et reprend sa forme quand elle y tombe", async ({ page }) => {
    /* W6 (la « déformation du vivier » de la mission) : une puce posée
       au-dessus de l'îlot le gonfle depuis son coin ; lâchée dedans, il
       reprend sa forme. Témoin de K3 (mouvement réduit : rien ne bouge). */
    await openLocal(page, seed());
    await montrerZone(page, S9);
    const r = await survolerLeVivier(page, '[data-drop] [data-name="Giorgi"]');
    expect(r.survol).toBeGreaterThan(0);
    expect({ apres: r.apres, transform: r.transform }).toEqual({ apres: 0, transform: "none" });
    await vuToast(page, "Giorgi retiré de 9MD49");
  });

  test("B3 — un toast ne prend pas le doigt : lâchée sur le vivier sous un toast, la puce y retourne", async ({ page }) => {
    /* Constat U22 : 2,8 s durant après chaque dépôt, le toast couvre le
       milieu du vivier ouvert, et il prenait le doigt. Une puce lâchée
       là ne revenait pas au vivier (le dépôt ne visait plus rien), une
       puce du vivier dessous ne se prenait pas. Trouvé en W6 par la
       mesure des images perdues : un glisser sur quatre restait sans
       effet. Le second glisser est joué dans la page, d'une traite, pour
       lâcher sûrement pendant que le toast est là. */
    await openLocal(page, seed());
    await montrerZone(page, S9);
    await glisser(page, puceSur(page, S9, "Nixon"), vivier(page));
    await vuToast(page, "Nixon retiré de 9MD49");
    const lacher = await page.evaluate(async () => {
      const t = document.querySelector("[data-toast]")?.getBoundingClientRect();
      const v = document.querySelector("#vivier")!.getBoundingClientRect();
      if (!t) return "pas de toast";
      const x1 = t.x + t.width / 2, y1 = t.y + t.height / 2;
      if (x1 < v.left || x1 > v.right || y1 < v.top || y1 > v.bottom) return "le toast ne couvre pas le vivier";
      const puce = document.querySelector<HTMLElement>('[data-drop] [data-name="Giorgi"]')!;
      const a = puce.getBoundingClientRect();
      const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2;
      const ev = (type: string, x: number, y: number, sur: EventTarget) => sur.dispatchEvent(new PointerEvent(type,
        { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerId: 3, isPrimary: true, pointerType: "touch" }));
      ev("pointerdown", x0, y0, puce);
      for (let k = 1; k <= 12; k++) {
        await new Promise(r => requestAnimationFrame(r));
        ev("pointermove", x0 + (x1 - x0) * k / 12, y0 + (y1 - y0) * k / 12, document);
      }
      ev("pointerup", x1, y1, document);
      return "lâchée sous le toast";
    });
    expect(lacher).toBe("lâchée sous le toast");
    await vuToast(page, "Giorgi retiré de 9MD49");
    await expect(puceVivier(page, "Giorgi")).toBeVisible();
  });
});

test("B4 — lâcher hors de toute cible ne change rien", async ({ page }) => {
  await openLocal(page, effectifAvec(e => poser(e, S9, TODAY, ["p_giorgi"])));
  const horsCible = page.locator("[data-semaine]");

  // Une puce du vivier, lâchée sur le libellé de la semaine.
  await montrerZone(page, S12);
  await glisser(page, puceVivier(page, "Nixon"), horsCible);
  await expect(page.locator("[data-fantome]")).toBeHidden();
  await expect(puceVivier(page, "Nixon")).not.toHaveClass(/\blifted\b/);
  await expect(page.locator("body")).not.toHaveClass(/\bdragging\b/);

  // Une puce posée, lâchée au même endroit.
  await montrerZone(page, S9);
  await glisser(page, puceSur(page, S9, "Giorgi"), horsCible);

  // Un geste réussi ensuite : son toast doit être le seul de la séance.
  await montrerZone(page, S12);
  await glisser(page, puceVivier(page, "Aklan"), zone(page, S12));
  await vuToast(page, "Aklan sur 12AB49");
  await expect.poll(async () => (await toastsVus(page)).map(t => t.texte))
    .toEqual(["Aklan sur 12AB49 · mercredi 16 sept."]);

  await expect(puceVivier(page, "Nixon")).toBeVisible();
  await relire(page);
  await expect(puceSur(page, S9, "Giorgi")).toBeVisible();
  await expect(puceSur(page, S12, "Nixon")).toHaveCount(0);
});

test("B4 — lâchée hors de toute cible, le fantôme revient à la puce, qui reprend sa couleur à son retour", async ({ page }) => {
  /* W6 : on voit que rien n'a été posé. La puce reste estompée le temps
     du retour. */
  await openLocal(page);
  const r = await glisserDansLaPage(page, '#vivier [data-name="Nixon"]', "[data-semaine]");
  expect(r).toEqual({ enVol: true, arriveeCachee: false, soulevee: true,
    plusTard: { fantome: false, atterrit: 0, lifted: 0 } });
  expect(await toastsVus(page)).toEqual([]);
});

test("B4 — un glisser interrompu par le système ne pose rien", async ({ page }) => {
  /* Constat U6 : un appel, une notification, le centre de contrôle
     interrompent le geste (pointercancel). Il était traité comme un
     relâchement : la puce se posait sur la zone survolée à cet instant.
     Joué dans la page : la souris de Playwright ne sait pas annuler. */
  await openLocal(page);
  await montrerZone(page, S12);
  const issue = await page.evaluate(async () => {
    const puce = document.querySelector<HTMLElement>('#vivier [data-name="Nixon"]')!;
    const cible = document.querySelector<HTMLElement>('[data-drop="s_12ab49"]')!;
    const a = puce.getBoundingClientRect();
    const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2;
    /* Le centre de la zone, relu à chaque pas : la mise en page peut
       encore bouger (les fiches hors écran sont estimées, content-visibility). */
    const centre = () => { const b = cible.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] as const; };
    const ev = (type: string, x: number, y: number, sur: EventTarget) => sur.dispatchEvent(new PointerEvent(type,
      { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerId: 5, isPrimary: true, pointerType: "touch" }));
    ev("pointerdown", x0, y0, puce);
    for (let k = 1; k <= 10; k++) {
      await new Promise(r => requestAnimationFrame(r));
      const [x1, y1] = centre();
      ev("pointermove", x0 + (x1 - x0) * k / 10, y0 + (y1 - y0) * k / 10, document);
    }
    const survolee = cible.classList.contains("over");
    ev("pointercancel", ...centre(), document);
    return survolee ? "annulé au-dessus de la zone" : "la zone n'était pas survolée";
  });
  expect(issue).toBe("annulé au-dessus de la zone");
  await expect(page.locator("[data-fantome]")).toBeHidden();
  await expect(page.locator("body")).not.toHaveClass(/\bdragging\b/);
  await expect(puceVivier(page, "Nixon")).not.toHaveClass(/\blifted\b/);
  await expect(page.locator('[data-drop="s_12ab49"]')).not.toHaveClass(/\bover\b/);
  await page.waitForTimeout(400);
  expect(await toastsVus(page)).toEqual([]);
  await expect(puceVivier(page, "Nixon")).toBeVisible();
  await expect(puceSur(page, S12, "Nixon")).toHaveCount(0);
});

/* Plusieurs doigts, joués dans la page : chaque étape part du centre d'un
   élément ; un pointermove « pas: n » y va en n images depuis la position
   du doigt. Le second doigt n'est pas le doigt principal (isPrimary). */
type Etape = { doigt: number; type: "pointerdown" | "pointermove" | "pointerup"; sur: string; pas?: number };
async function doigts(page: import("@playwright/test").Page, etapes: Etape[]): Promise<{ lifted: string[]; fantomeVisible: boolean }> {
  return page.evaluate(async etapes => {
    const image = () => new Promise(r => requestAnimationFrame(r));
    const pos = new Map<number, [number, number]>();
    const centre = (s: string) => {
      const b = document.querySelector<HTMLElement>(s)!.getBoundingClientRect();
      return [b.x + b.width / 2, b.y + b.height / 2] as [number, number];
    };
    const ev = (type: string, doigt: number, x: number, y: number, sur: EventTarget) => sur.dispatchEvent(new PointerEvent(type,
      { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerId: doigt, isPrimary: doigt === 1, pointerType: "touch" }));
    for (const e of etapes) {
      if (e.type === "pointerdown") {
        const [x, y] = centre(e.sur);
        pos.set(e.doigt, [x, y]);
        ev("pointerdown", e.doigt, x, y, document.querySelector(e.sur)!);
      } else if (e.type === "pointermove") {
        const [x0, y0] = pos.get(e.doigt)!, [x1, y1] = centre(e.sur), n = e.pas ?? 10;
        for (let k = 1; k <= n; k++) {
          await image();
          ev("pointermove", e.doigt, x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, document);
        }
        pos.set(e.doigt, [x1, y1]);
      } else {
        const [x, y] = pos.get(e.doigt)!;
        ev("pointerup", e.doigt, x, y, document);
      }
      await image();
    }
    await new Promise(r => setTimeout(r, 700));
    return {
      lifted: [...document.querySelectorAll<HTMLElement>(".chip.lifted")].map(c => c.dataset.name || ""),
      fantomeVisible: !document.querySelector<HTMLElement>("[data-fantome]")!.hidden
    };
  }, etapes);
}

test.describe("B4 — un second doigt pendant un glisser", () => {
  /* Relecture adversariale de W6 (défaut présent depuis la première
     version) : le glisser ne regardait pas quel doigt bougeait. Un second
     doigt — l'autre main, la paume — reprenait le glisser ou le lâchait,
     et une affectation fausse était enregistrée. */
  test("B4 — posé sur une autre puce, il ne reprend pas le glisser", async ({ page }) => {
    await openLocal(page);
    await montrerZone(page, S12);
    const nixon = '#vivier [data-name="Nixon"]', giorgi = '#vivier [data-name="Giorgi"]', cible = `[data-drop="${S12}"] [data-zone-titre]`;
    const r = await doigts(page, [
      { doigt: 1, type: "pointerdown", sur: nixon },
      { doigt: 1, type: "pointermove", sur: cible, pas: 10 },
      { doigt: 2, type: "pointerdown", sur: giorgi },
      { doigt: 1, type: "pointermove", sur: `[data-drop="${S12}"]`, pas: 4 },
      { doigt: 1, type: "pointerup", sur: cible },
      { doigt: 2, type: "pointerup", sur: giorgi }
    ]);
    await expect(puceSur(page, S12, "Nixon")).toHaveCount(1);
    await expect(puceSur(page, S12, "Giorgi")).toHaveCount(0);
    expect(r).toEqual({ lifted: [], fantomeVisible: false });
  });

  test("B4 — levé ailleurs, il ne lâche pas la puce", async ({ page }) => {
    await openLocal(page);
    await montrerZone(page, S9);
    await doigts(page, [
      { doigt: 1, type: "pointerdown", sur: '#vivier [data-name="Nixon"]' },
      { doigt: 1, type: "pointermove", sur: `[data-drop="${S9}"]`, pas: 10 },
      { doigt: 2, type: "pointerdown", sur: "header h1" },
      { doigt: 2, type: "pointerup", sur: "header h1" },
      { doigt: 1, type: "pointermove", sur: "[data-bandeau-resume]", pas: 6 },
      { doigt: 1, type: "pointerup", sur: "[data-bandeau-resume]" }
    ]);
    // Lâchée hors de toute cible par le premier doigt : rien ne change (B4).
    await expect(puceSur(page, S9, "Nixon")).toHaveCount(0);
    await expect(puceVivier(page, "Nixon")).toHaveCount(1);
  });

  test("B4 — témoin : à un seul doigt, le même geste pose Nixon, et lui seul", async ({ page }) => {
    await openLocal(page);
    await montrerZone(page, S12);
    const cible = `[data-drop="${S12}"] [data-zone-titre]`;
    const r = await doigts(page, [
      { doigt: 1, type: "pointerdown", sur: '#vivier [data-name="Nixon"]' },
      { doigt: 1, type: "pointermove", sur: cible, pas: 10 },
      { doigt: 1, type: "pointermove", sur: `[data-drop="${S12}"]`, pas: 4 },
      { doigt: 1, type: "pointerup", sur: cible }
    ]);
    await expect(puceSur(page, S12, "Nixon")).toHaveCount(1);
    expect(r).toEqual({ lifted: [], fantomeVisible: false });
  });
});

test("B5 — poser quelqu'un d'absent est accepté, avec un avertissement 2,9 s plus tard", async ({ page }) => {
  // Kia ne vient que le jeudi ; il est pourtant posé ce mercredi.
  await openLocal(page, effectifAvec(e => poser(e, S9, TODAY, ["p_kia"])));
  await montrerZone(page, S9);
  await expect(puceSur(page, S9, "Kia").locator("s").nth(IDX_AUJ)).toHaveAttribute("data-etat", "absent");

  // L'instant du lâcher, noté dans la page : la minuterie part de là.
  await page.evaluate(() => addEventListener("pointerup", () => {
    (window as unknown as { __lacher?: number }).__lacher = performance.now();
  }, { capture: true }));
  await glisser(page, puceSur(page, S9, "Kia"), zone(page, S12), { pendant: () => montrerZone(page, S12) });
  await vuToast(page, "Kia : 9MD49 → 12AB49 · mercredi 16 sept.");
  await vuToast(page, "Attention : Kia s'est déclaré absent ce jour-là");

  /* Le délai se mesure dans la page, du lâcher à l'avertissement. Pas
     d'un toast à l'autre : le premier attend le rendu qui suit le lâcher,
     le plus lourd de tous, et l'écart perdait ce rendu (2 789 ms sur une
     machine chargée, porte de W5). */
  const lacher = await page.evaluate(() => (window as unknown as { __lacher?: number }).__lacher);
  const avert = (await toastsVus(page)).find(t => t.texte.startsWith("Attention : Kia"));
  expect(lacher !== undefined && avert).toBeTruthy();
  const delai = avert!.t - lacher!;
  expect(delai).toBeGreaterThanOrEqual(2_800);
  expect(delai).toBeLessThan(4_500);

  await relire(page);
  await expect(puceSur(page, S12, "Kia")).toBeVisible();
  await expect(puceSur(page, S12, "Kia").locator("s").nth(IDX_AUJ)).toHaveAttribute("data-etat", "absent");
});

test("B6 — toucher une puce posée ouvre sa fiche et ses jours sur ce chantier", async ({ page }) => {
  await openLocal(page, effectifAvec(e => {
    poser(e, S9, JOURS[0], ["p_nixon"]);
    poser(e, S9, TODAY, ["p_nixon"]);
    poser(e, S12, JOURS[3], ["p_nixon"]);      // hors urgence, « Ses jours dispo » doit l'en retirer
  }));
  await montrerZone(page, S9);
  await puceSur(page, S9, "Nixon").click();
  const f = feuille(page, "Nixon");
  await expect(f).toBeVisible();
  await expect(f.getByText("Jours sur 9MD49 · sem. 38")).toBeVisible();

  const cases = f.getByRole("group", { name: /^Jours sur / }).getByRole("button");
  await expect(cases).toHaveCount(7);
  expect(await cases.evaluateAll(b => b.map(x => x.getAttribute("aria-pressed"))))
    .toEqual(["true", "false", "true", "false", "false", "false", "false"]);
  // Samedi et dimanche : Nixon n'est pas disponible, les cases sont barrées.
  await expect(cases.nth(5)).toHaveAttribute("data-indispo");
  await expect(cases.nth(6)).toHaveAttribute("data-indispo");

  // Chaque bascule pose ou retire ce jour-là sur ce chantier.
  await cases.nth(1).click();
  await expect(cases.nth(1)).toHaveAttribute("aria-pressed", "true");
  await cases.nth(0).click();
  await expect(cases.nth(0)).toHaveAttribute("aria-pressed", "false");

  await f.getByRole("button", { name: "Ses jours dispo" }).click();
  await expect(f).toBeHidden();
  await vuToast(page, "Nixon posé sur 9MD49 tous ses jours dispo");

  await onglet(page, "Semaine").click();
  let g = await grille(page);
  for (const j of ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"]) expect(g["9MD49"][j]).toContain("Nixon");
  expect(g["9MD49"]["Samedi"]).not.toContain("Nixon");
  expect(g["12AB49"]["Jeudi"]).not.toContain("Nixon");

  // « Aucun » le retire de toute la semaine sur ce chantier.
  await onglet(page, "Chantiers").click();
  await montrerZone(page, S9);
  await puceSur(page, S9, "Nixon").click();
  await feuille(page, "Nixon").getByRole("button", { name: "Aucun" }).click();
  await expect(feuille(page, "Nixon")).toBeHidden();
  await vuToast(page, "Nixon retiré de 9MD49 cette semaine");
  await onglet(page, "Semaine").click();
  g = await grille(page);
  for (const noms of Object.values(g["9MD49"])) expect(noms).not.toContain("Nixon");
});

test("B7 — toucher une puce du vivier ouvre la fiche, sans « Jours sur… »", async ({ page }) => {
  await openLocal(page);
  await puceVivier(page, "Nixon").click();
  const f = feuille(page, "Nixon");
  await expect(f).toBeVisible();
  await expect(f.locator("header p")).toHaveText("Mercredi 16 sept. · libre · dispo Lun Mar Mer Jeu Ven");
  await expect(f.getByText(/Jours sur/)).toHaveCount(0);
  await expect(f.getByRole("group", { name: /^Jours sur / })).toHaveCount(0);
  await expect(f.getByText("Poser sur · mercredi 16 sept.")).toBeVisible();
  await expect(f.getByText("Aucun contact enregistré", { exact: false })).toBeVisible();
  await expect(f.getByRole("button", { name: "Retirer de ce jour" })).toHaveCount(0);
});

test("B8 — « Poser sur » depuis la fiche pose et ferme ; le chantier actuel est « ici »", async ({ page }) => {
  await openLocal(page, effectifAvec(e => poser(e, S9, TODAY, ["p_nixon"])));
  await montrerZone(page, S9);
  await puceSur(page, S9, "Nixon").click();
  const f = feuille(page, "Nixon");
  await expect(f.getByText("Poser sur · mercredi 16 sept.")).toBeVisible();
  const ici = f.getByRole("button", { name: /^9MD49/ });
  await expect(ici).toBeDisabled();
  await expect(ici).toContainText("ici");
  await expect(f.getByRole("button", { name: /^12AB49/ })).toBeEnabled();

  await f.getByRole("button", { name: /^12AB49/ }).click();
  await expect(f).toBeHidden();
  await vuToast(page, "Nixon : 9MD49 → 12AB49 · mercredi 16 sept.");
  await relire(page);
  await expect(puceSur(page, S12, "Nixon")).toBeVisible();
  await expect(puceSur(page, S9, "Nixon")).toHaveCount(0);
});

test("B9 — « Retirer de ce jour » le retire de tous les chantiers ce jour-là", async ({ page }) => {
  await openLocal(page, effectifAvec(e => {
    poser(e, S9, TODAY, ["p_nixon"]);
    poser(e, S12, TODAY, ["p_nixon"]);
  }));
  await montrerZone(page, S9);
  await puceSur(page, S9, "Nixon").click();
  const f = feuille(page, "Nixon");
  await expect(f.locator("header p")).toContainText("sur 9MD49 + 12AB49");
  await f.getByRole("button", { name: "Retirer de ce jour" }).click();
  await expect(f).toBeHidden();
  await vuToast(page, "Nixon retiré de 9MD49 · mercredi 16 sept.");
  await expect(puceVivier(page, "Nixon")).toBeVisible();
  await relire(page);
  await expect(puceSur(page, S9, "Nixon")).toHaveCount(0);
  await expect(puceSur(page, S12, "Nixon")).toHaveCount(0);
});

test.describe("B11 — reprendre l'équipe de la veille", () => {
  test("B11 — reconduit ceux d'hier qui sont disponibles et libres aujourd'hui", async ({ page }) => {
    await openLocal(page, effectifAvec(e => {
      // Mardi : Nixon, Giorgi et Chaggy. Chaggy ne vient que le mardi ;
      // Giorgi est déjà pris ce mercredi. Seul Nixon doit revenir.
      poser(e, S9, JOURS[1], ["p_nixon", "p_giorgi", "p_chaggy"]);
      poser(e, S12, TODAY, ["p_giorgi"]);
    }));
    await montrerZone(page, S9);
    await expect(zone(page, S9).getByText("Personne ce jour-là.")).toBeVisible();
    await zone(page, S9).getByRole("button", { name: "Reprendre l'équipe de la veille" }).click();
    await vuToast(page, "1 compagnon reconduit sur 9MD49");
    await expect(puceVivier(page, "Nixon")).toHaveCount(0);
    await relire(page);
    await expect(zone(page, S9).locator(".chip")).toHaveCount(1);
    await expect(puceSur(page, S9, "Nixon")).toBeVisible();
    await expect(puceSur(page, S12, "Giorgi")).toBeVisible();
  });

  test("B11 — personne de disponible et libre : la reprise le dit", async ({ page }) => {
    await openLocal(page, effectifAvec(e => poser(e, S9, JOURS[1], ["p_chaggy"])));
    await montrerZone(page, S9);
    await zone(page, S9).getByRole("button", { name: "Reprendre l'équipe de la veille" }).click();
    await vuToast(page, "Aucun n'est disponible et libre ce jour-là");
    await relire(page);
    await expect(zone(page, S9).locator(".chip")).toHaveCount(0);
  });
});

test.describe("B12-B13 — le mode urgence", () => {
  test("B12 — l'interrupteur « Urgence » s'active, s'annonce et se retient", async ({ page }) => {
    await openLocal(page);
    const inter = () => vivier(page).getByRole("switch", { name: "Urgence" });
    const libelle = () => vivier(page).getByText("Urgence", { exact: true });
    // On touche le libellé, comme au doigt.
    await expect(inter()).not.toBeChecked();
    await libelle().click();
    await expect(inter()).toBeChecked();
    await vuToast(page, "Mode urgence — un compagnon peut être posé sur deux chantiers le même jour");

    await page.reload();
    await expect(inter()).toBeChecked();

    await libelle().click();
    await expect(inter()).not.toBeChecked();
    await vuToast(page, "Mode urgence désactivé");
  });

  test("B12 — en urgence, glisser de A vers B copie la puce ; désactiver ne retire pas le doublon", async ({ page }) => {
    await openLocal(page, { ...effectifAvec(e => poser(e, S9, TODAY, ["p_nixon"])), ui: { urgence: true } });
    await montrerZone(page, S9);
    await glisser(page, puceSur(page, S9, "Nixon"), zone(page, S12), {
      pendant: () => montrerZone(page, S12),
      avantDeLacher: async () => {
        // La zone survolée passe en fuchsia.
        await expect(zone(page, S12)).toHaveClass(/\bover\b/);
        await expect(zone(page, S12)).toHaveClass(/\burg\b/);
      }
    });

    await vuToast(page, "Urgence — Nixon est aussi sur 12AB49 · mercredi 16 sept.");
    await relire(page);
    await expect(puceSur(page, S9, "Nixon")).toBeVisible();
    await expect(puceSur(page, S12, "Nixon")).toBeVisible();

    await vivier(page).getByText("Urgence", { exact: true }).click();
    await vuToast(page, "Mode urgence désactivé");
    await relire(page);
    await expect(puceSur(page, S9, "Nixon")).toBeVisible();
    await expect(puceSur(page, S12, "Nixon")).toBeVisible();
  });

  test("B13 — hors urgence, un compagnon n'est jamais sur deux chantiers le même jour", async ({ page }) => {
    await openLocal(page, effectifAvec(e => poser(e, S9, TODAY, ["p_nixon"])));
    await montrerZone(page, S9);
    await glisser(page, puceSur(page, S9, "Nixon"), zone(page, S12), {
      pendant: () => montrerZone(page, S12),
      avantDeLacher: async () => {
        await expect(zone(page, S12)).toHaveClass(/\bover\b/);
        await expect(zone(page, S12)).not.toHaveClass(/\burg\b/);
      }
    });
    await vuToast(page, "Nixon : 9MD49 → 12AB49");

    // Puis par la fiche, vers un troisième chantier.
    await relire(page);
    await montrerZone(page, S12);
    await puceSur(page, S12, "Nixon").click();
    await feuille(page, "Nixon").getByRole("button", { name: /^30JA90/ }).click();
    await vuToast(page, "Nixon : 12AB49 → 30JA90");

    await onglet(page, "Semaine").click();
    const g = await grille(page);
    const ceMercredi = Object.entries(g).filter(([, j]) => j["Mercredi"].includes("Nixon")).map(([c]) => c);
    expect(ceMercredi).toEqual(["30JA90"]);
  });
});

test.describe("B14-B15 — le vivier", () => {
  test("B14 — le vivier ne montre que les disponibles et libres du jour, avec leurs jours", async ({ page }) => {
    await openLocal(page, {
      ...effectifAvec(e => poser(e, S9, TODAY, ["p_nixon"])),
      // Giorgi a répondu pour cette semaine : absent le mercredi.
      avail: [{ id: "p_giorgi@" + WEEK, token: "tok-giorgi", personId: "p_giorgi", week: WEEK,
        days: [true, true, false, true, true, false, false], note: "", answeredAt: "2026-09-12T10:00:00Z" }]
    });
    await expect.poll(() => nomsDuVivier(page)).toEqual(
      ["Aklan", "Geoffrey", "Morgan", "Erwan", "Sydney", "Luidgi", "Amir", "Quentin", "Mojtaba"]);
    await expect(puceVivier(page, "Aklan").locator("[data-jours]")).toHaveText("5j");
    await expect(puceVivier(page, "Quentin").locator("[data-jours]")).toHaveText("3j");
    await expect(puceVivier(page, "Mojtaba").locator("[data-jours]")).toHaveText("1j");

    // Jeudi : Kia vient, Quentin et Mojtaba non ; Nixon et Giorgi sont libres.
    await jours(page).nth(3).click();
    await expect(vivier(page).locator("[data-vivier-titre]")).toHaveText("Vivier · jeu · 10");
    await expect.poll(() => nomsDuVivier(page)).toEqual(
      ["Aklan", "Giorgi", "Nixon", "Geoffrey", "Morgan", "Erwan", "Sydney", "Luidgi", "Amir", "Kia"]);
    // Sa réponse remplace sa disponibilité habituelle : 4 jours cette semaine.
    await expect(puceVivier(page, "Giorgi").locator("[data-jours]")).toHaveText("4j");

    // Dimanche : personne.
    await jours(page).nth(6).click();
    await expect(vivier(page).getByText("Personne de libre dimanche.")).toBeVisible();
    await expect(vivier(page).locator(".chip")).toHaveCount(0);

    // Le vivier n'existe que sur l'onglet Chantiers.
    await onglet(page, "Semaine").click();
    await expect(vivier(page)).toHaveCount(0);
    await onglet(page, "Équipe").click();
    await expect(vivier(page)).toHaveCount(0);
    await onglet(page, "Chantiers").click();
    await expect(vivier(page)).toBeVisible();
  });

  test("B15 — la pastille déplie le vivier, « Réduire » ou la poignée le replient, l'état se retient", async ({ page }) => {
    await openLocal(page, { ui: { poolState: "bubble" } });
    const v = vivier(page);
    await expect(v).toHaveAttribute("data-state", "bubble");
    await page.getByRole("button", { name: "Ouvrir le vivier — 11 disponible" }).click();
    await expect(v).toHaveAttribute("data-state", "open");
    await expect(v.locator(".chip")).toHaveCount(11);

    await page.getByRole("button", { name: "Réduire le vivier" }).click();
    await expect(v).toHaveAttribute("data-state", "bubble");

    await page.getByRole("button", { name: "Ouvrir le vivier — 11 disponible" }).click();
    await expect(v).toHaveAttribute("data-state", "open");
    await v.getByRole("button", { name: /^Vivier · / }).click();   // la poignée
    await expect(v).toHaveAttribute("data-state", "bubble");

    await page.reload();
    await expect(vivier(page)).toHaveAttribute("data-state", "bubble");
    await page.getByRole("button", { name: "Ouvrir le vivier — 11 disponible" }).click();
    await page.reload();
    await expect(vivier(page)).toHaveAttribute("data-state", "open");
  });

  test("B15 — le vivier se déroule en changeant de forme ; un second appui en chemin repart d'où il en est", async ({ page }) => {
    /* W6 : la forme de l'îlot se joue au geste (Web Animations, ADR-006).
       Sa hauteur, relevée image après image pendant qu'il se replie,
       passe par des valeurs entre ses deux formes. Puis deux appuis coup
       sur coup : il finit dans sa forme, sans animation qui traîne. Ce
       test sert aussi de témoin à K3 (mouvement réduit : d'un coup). */
    await openLocal(page);
    await expect(vivier(page)).toHaveAttribute("data-state", "open");
    const repli = await page.evaluate(async () => {
      const v = document.querySelector<HTMLElement>("#vivier")!;
      const depart = v.getBoundingClientRect().height;
      v.querySelector<HTMLElement>('[aria-label="Réduire le vivier"]')!.click();
      const hauteurs: number[] = [];
      for (let i = 0; i < 40; i++) {
        await new Promise(r => requestAnimationFrame(r));
        hauteurs.push(v.getBoundingClientRect().height);
      }
      return { depart, hauteurs, fin: v.getBoundingClientRect().height };
    });
    expect(repli.fin).toBeLessThan(repli.depart - 20);
    expect(repli.hauteurs.filter(h => h < repli.depart - 1 && h > repli.fin + 1).length).toBeGreaterThan(2);

    const double = await page.evaluate(async () => {
      const v = document.querySelector<HTMLElement>("#vivier")!;
      v.querySelector<HTMLElement>("button")!.click();                       // la pastille : ouvrir
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      v.querySelector<HTMLElement>('[aria-label="Réduire le vivier"]')!.click();  // et replier aussitôt
      await new Promise(r => setTimeout(r, 900));
      return { etat: v.dataset.state, animations: v.getAnimations().length, hauteur: v.getBoundingClientRect().height };
    });
    expect(double.etat).toBe("bubble");
    expect(double.animations).toBe(0);
    expect(double.hauteur).toBeCloseTo(repli.fin, 0);
  });

  test("B15 — replié, le vivier reçoit encore une puce qu'on lui lâche dessus", async ({ page }) => {
    await openLocal(page, { ...effectifAvec(e => poser(e, S9, TODAY, ["p_nixon"])), ui: { poolState: "bubble" } });
    await expect(page.getByRole("button", { name: "Ouvrir le vivier — 10 disponible" })).toBeVisible();
    await montrerZone(page, S9);
    await glisser(page, puceSur(page, S9, "Nixon"), vivier(page));
    await vuToast(page, "Nixon retiré de 9MD49 · mercredi 16 sept.");
    await expect(page.getByRole("button", { name: "Ouvrir le vivier — 11 disponible" })).toBeVisible();
    await expect(vivier(page)).toHaveAttribute("data-state", "bubble");
  });
});

test.describe("B1 — ce qui soulève une puce", () => {
  /* Relecture adversariale : un délai de soulèvement porté à 2 s et un
     seuil de mouvement rendu inatteignable passaient inaperçus, parce que
     l'outil glisser() attend patiemment que la puce se soulève. Ces deux
     tests mesurent le geste lui-même. */
  test("B1 — plus de 8 px de mouvement soulève la puce sur-le-champ", async ({ page }) => {
    await openLocal(page);
    const puce = puceVivier(page, "Nixon");
    await puce.hover();
    const b = (await puce.boundingBox())!;
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2, { steps: 1 });
    await expect(puce).toHaveClass(/\blifted\b/, { timeout: 500 });
    await page.mouse.up();
  });

  test("B1 — un appui tenu, sans bouger, soulève la puce en moins d'une seconde", async ({ page }) => {
    await openLocal(page);
    const puce = puceVivier(page, "Nixon");
    await puce.hover();
    await page.mouse.down();
    await expect(puce).toHaveClass(/\blifted\b/, { timeout: 1_000 });   // le seuil est à 190 ms
    await page.mouse.up();
  });

  test("B1 — la puce qu'on soulève d'un chantier s'estompe à sa place", async ({ page }) => {
    /* Constat V3 : Framer Motion écrit en ligne l'opacité d'une puce posée
       (la fin de son entrée), qui l'emportait sur la règle de la puce
       soulevée : elle restait pleine. On lit ce que l'œil voit, l'opacité
       calculée, pas la classe. */
    await openLocal(page, effectifAvec(e => { poser(e, S9, TODAY, ["p_nixon"]); }));
    await montrerZone(page, S9);
    const puce = puceSur(page, S9, "Nixon");
    await puce.hover();
    const b = (await puce.boundingBox())!;
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2, { steps: 1 });
    await expect(puce).toHaveClass(/\blifted\b/, { timeout: 500 });
    await expect(puce).toHaveCSS("opacity", "0.3");
    await page.mouse.up();
  });
});

test("B6 — hors urgence, poser un jour depuis la fiche le retire de l'autre chantier ce jour-là", async ({ page }) => {
  /* Relecture adversariale : une bascule de jour qui forçait l'urgence
     survivait. B13 le demande : toute écriture, fiche comprise. */
  await openLocal(page, effectifAvec(e => {
    poser(e, S9, TODAY, ["p_nixon"]);
    poser(e, S12, JOURS[1], ["p_nixon"]);        // mardi, sur 12AB49
  }));
  await montrerZone(page, S9);
  await puceSur(page, S9, "Nixon").click();
  const f = feuille(page, "Nixon");
  const cases = f.getByRole("group", { name: /^Jours sur / }).getByRole("button");
  await cases.nth(1).click();
  await expect(cases.nth(1)).toHaveAttribute("aria-pressed", "true");
  await f.getByRole("button", { name: "Fermer" }).click();
  await expect(f).toBeHidden();
  await onglet(page, "Semaine").click();
  const g = await grille(page);
  expect(g["9MD49"]["Mardi"]).toContain("Nixon");
  expect(g["12AB49"]["Mardi"]).not.toContain("Nixon");
});

test("B6 — « Ses jours dispo » suit la réponse du compagnon, pas ses jours habituels", async ({ page }) => {
  /* Relecture adversariale : lire p.days au lieu de la réponse de la
     semaine survivait, faute d'un compagnon qui ait répondu. */
  await openLocal(page, {
    ...effectifAvec(e => poser(e, S9, TODAY, ["p_nixon"])),
    avail: [{ id: "p_nixon@" + WEEK, token: "t-nixon", personId: "p_nixon", week: WEEK,
              days: [true, false, true, false, false, false, false], note: "", answeredAt: "2026-09-12T08:00:00.000Z" }]
  });
  await montrerZone(page, S9);
  await puceSur(page, S9, "Nixon").click();
  await feuille(page, "Nixon").getByRole("button", { name: "Ses jours dispo" }).click();
  await vuToast(page, "Nixon posé sur 9MD49 tous ses jours dispo");
  await onglet(page, "Semaine").click();
  const g = await grille(page);
  expect(g["9MD49"]["Lundi"]).toContain("Nixon");
  expect(g["9MD49"]["Mercredi"]).toContain("Nixon");
  for (const j of ["Mardi", "Jeudi", "Vendredi"]) expect(g["9MD49"][j]).not.toContain("Nixon");
});
