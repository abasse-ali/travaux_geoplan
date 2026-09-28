/* ============================================================
   L. Accessibilité (W5)

   Mesurée, pas déclarée :
   • chaque bouton, onglet, interrupteur, champ a un nom accessible ;
   • chaque cible tactile fait au moins 44 × 44 px au doigt (Apple ;
     WCAG 2.5.5) : depuis son centre, on mesure pixel par pixel jusqu'où
     un toucher lui arrive encore — zone agrandie sans rien changer au
     dessin comprise. Dans une grappe serrée (data-cible="serree" :
     puces, cases de la grille, titre et barre d'une étape…), 44 px sont
     impossibles sans agrandir le dessin : 24 px au moins (WCAG 2.5.8) ;
   • le focus clavier se voit.

   Chaque cible est mesurée ramenée au centre de l'écran, l'îlot du
   vivier masqué (sauf pour ses propres contrôles) : un élément que
   recouvre la barre d'onglets ou l'îlot n'est pas une cible trop
   petite, il est caché.

   Les contrastes des jetons ont leur outil : npm run contrastes.
   ============================================================ */

import { expect, test, type Page } from "@playwright/test";
import {
  FAKE_SUPABASE, S9, TODAY, carte, effectifAvec, feuille, onglet, openLocal, poser, puceSur, source, useFakeSupabase, vivier
} from "./helpers";

const INTERACTIFS = "button, a[href], input, textarea, select, [role=tab], [role=switch], [role=slider], [tabindex]:not([tabindex='-1'])";

/* Les cibles de la page (ou d'une feuille) qui n'atteignent pas leur
   taille au doigt, décrites pour qu'on les retrouve. */
async function ciblesTropPetites(page: Page, portee = "body"): Promise<string[]> {
  return page.evaluate(async ({ selecteur, portee }) => {
    const racine = document.querySelector(portee) ?? document.body;
    /* Attendre qu'un élément ne bouge plus d'une image à l'autre : une
       feuille qui monte encore (0,5 s, vaul), une ligne qui glisse à sa
       place (layout de Framer Motion) seraient mesurées en chemin — sous
       charge, l'animation peut même n'avoir pas encore démarré. */
    const image = () => new Promise(r => requestAnimationFrame(() => r(null)));
    const immobile = async (el: Element) => {
      let avant = JSON.stringify(el.getBoundingClientRect());
      for (let i = 0; i < 90; i++) {
        await image(); await image();
        const apres = JSON.stringify(el.getBoundingClientRect());
        if (apres === avant) return;
        avant = apres;
      }
    };
    /* La montée d'une feuille est une animation CSS (vaul) : sous WebKit,
       getBoundingClientRect rend la même position deux images de suite
       pendant qu'elle court, et immobile() la croyait arrivée — le
       dernier bouton de la feuille Données était alors mesuré sous le bord
       de l'écran (81×42, une fois sur deux). D'abord la fin de ses
       animations, puis l'immobilité. */
    if (racine !== document.body) {
      await Promise.all(racine.getAnimations().map(a => a.finished.catch(() => undefined)));
      await immobile(racine);
    }
    const vivier = document.getElementById("vivier");
    const visibles = [...racine.querySelectorAll<HTMLElement>(selecteur)].filter(el => {
      const b = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && s.visibility !== "hidden" && s.pointerEvents !== "none" &&
        !el.closest("[aria-hidden=true]") && !el.closest("[inert]");
    });
    const decrire = (el: HTMLElement) =>
      (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
    const echecs: string[] = [];
    for (const el of visibles) {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      await immobile(el);
      const masquer = !!vivier && !vivier.contains(el);
      if (masquer) vivier!.style.visibility = "hidden";
      try {
        const b = el.getBoundingClientRect();
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        /* Un toucher sur le libellé qui contient le contrôle lui arrive. */
        const touche = (x: number, y: number) => {
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
          const t = document.elementFromPoint(x, y);
          const libelle = t?.closest("label");
          return !!t && (t === el || el.contains(t) || (!!libelle && libelle.contains(el)));
        };
        if (!touche(cx, cy)) continue;                   // recouvert ici : rien à mesurer
        const jusqua = (dx: number, dy: number) => {
          let n = 0;
          for (let k = 1; k <= 40; k++) { if (!touche(cx + dx * k, cy + dy * k)) break; n = k; }
          return n;
        };
        const haut = jusqua(0, -1) + jusqua(0, 1) + 1, large = jusqua(-1, 0) + jusqua(1, 0) + 1;
        const seuil = el.dataset.cible === "serree" ? 24 : 44;
        if (haut < seuil || large < seuil)
          echecs.push(`${decrire(el)} : ${large}×${haut} au doigt (${seuil} attendus)`);
      } finally {
        if (masquer) vivier!.style.visibility = "";
      }
    }
    return echecs;
  }, { selecteur: INTERACTIFS, portee });
}

/* Les contrôles sans nom. Le texte d'exemple (placeholder) ne compte pas :
   il disparaît dès la première frappe (relecture adversariale de W5 — les
   champs des feuilles n'avaient que lui). */
async function sansNom(page: Page, portee = "body"): Promise<string[]> {
  const vides: string[] = [];
  const roles = ["button", "tab", "switch", "textbox", "slider", "link", "checkbox", "combobox", "spinbutton", "radio"] as const;
  for (const role of roles) {
    const els = page.locator(portee).getByRole(role);
    const n = await els.count();
    for (let i = 0; i < n; i++) {
      const el = els.nth(i);
      if (!(await el.isVisible())) continue;
      const nom = await el.evaluate(e => {
        const textes = (ids: string) => ids.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? "").join(" ");
        const par = e.getAttribute("aria-labelledby");
        const libelles = [...((e as HTMLInputElement).labels ?? [])].map(l => l.textContent ?? "").join(" ");
        const saisie = ["INPUT", "TEXTAREA", "SELECT"].includes(e.tagName);
        return e.getAttribute("aria-label") || (par ? textes(par) : "") || libelles
          || (saisie ? "" : e.textContent?.trim() ?? "") || e.getAttribute("title") || "";
      });
      if (!nom.trim()) vides.push(role + " : " + (await el.evaluate(e => e.outerHTML.slice(0, 80))));
    }
  }
  return vides;
}

const seed = () => effectifAvec(e => poser(e, S9, TODAY, ["p_nixon", "p_giorgi"]));

test.describe("L — accessibilité", () => {
  test.describe.configure({ timeout: 120_000 });

  test("L1 — chaque contrôle a un nom", async ({ page }) => {
    await openLocal(page, seed());
    expect(await sansNom(page)).toEqual([]);
    await onglet(page, "Équipe").click();
    expect(await sansNom(page)).toEqual([]);
    await onglet(page, "Semaine").click();
    expect(await sansNom(page)).toEqual([]);
  });

  test("L1 — chaque contrôle a un nom : les feuilles", async ({ page }) => {
    await openLocal(page, { ...seed(), ui: { poolState: "bubble" } });
    const dans = "[role=dialog]";
    const verifier = async (ouvrir: () => Promise<unknown>, titre: string | RegExp) => {
      await ouvrir();
      await expect(feuille(page, titre)).toBeVisible();
      expect(await sansNom(page, dans), String(titre)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    await verifier(() => puceSur(page, S9, "Nixon").click(), "Nixon");
    await verifier(() => carte(page, S9).getByRole("button", { name: "Composer" }).click(), /^Composition/);
    await verifier(() => carte(page, S9).getByRole("button", { name: "Modifier le chantier" }).click(), "9MD49");
    await verifier(() => page.getByRole("button", { name: "Ajouter" }).click(), "Nouveau chantier");
    await onglet(page, "Équipe").click();
    await verifier(() => page.locator("[data-personne]").filter({ hasText: "Nixon" }).click(), "Nixon");
    await verifier(() => page.getByRole("button", { name: "Ajouter" }).click(), "Nouveau compagnon");
    await verifier(() => page.getByRole("button", { name: /^Demander les dispos/ }).click(), "Demander les dispos");
    await onglet(page, "Semaine").click();
    await verifier(() => page.getByRole("button", { name: "Répartir toute l'équipe sur la semaine" }).click(), "Répartir la semaine");
    await verifier(() => page.getByRole("button", { name: "État des données" }).click(), "Données");
  });

  test("L2 — chaque cible au doigt : chantiers, vivier, étapes et missions", async ({ page }) => {
    await openLocal(page, seed());
    expect(await ciblesTropPetites(page)).toEqual([]);             // vivier ouvert
    await page.getByRole("button", { name: "Réduire le vivier" }).click();
    await carte(page, S9).getByRole("button", { name: /^Les 12 étapes/ }).click();
    expect(await ciblesTropPetites(page)).toEqual([]);             // étapes dépliées, missions de l'étape en cours
  });

  test("L2 — chaque cible au doigt : semaine, équipe", async ({ page }) => {
    await openLocal(page, { ...seed(), ui: { tab: "semaine" } });
    expect(await ciblesTropPetites(page)).toEqual([]);
    await onglet(page, "Équipe").click();
    expect(await ciblesTropPetites(page)).toEqual([]);
  });

  test("L2 — chaque cible au doigt : les feuilles", async ({ page }) => {
    await openLocal(page, { ...seed(), ui: { poolState: "bubble" } });
    const dans = "[role=dialog]";
    await puceSur(page, S9, "Nixon").click();
    await expect(feuille(page, "Nixon")).toBeVisible();
    expect(await ciblesTropPetites(page, dans)).toEqual([]);
    await page.keyboard.press("Escape");
    await carte(page, S9).getByRole("button", { name: "Composer" }).click();
    await expect(feuille(page, /^Composition/)).toBeVisible();
    expect(await ciblesTropPetites(page, dans)).toEqual([]);
    await page.keyboard.press("Escape");
    await carte(page, S9).getByRole("button", { name: "Modifier le chantier" }).click();
    await expect(feuille(page, "9MD49")).toBeVisible();
    expect(await ciblesTropPetites(page, dans)).toEqual([]);
    await page.keyboard.press("Escape");
    await onglet(page, "Équipe").click();
    await page.locator("[data-personne]").filter({ hasText: "Nixon" }).click();
    await expect(feuille(page, "Nixon")).toBeVisible();
    expect(await ciblesTropPetites(page, dans)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Demander les dispos/ }).click();
    await expect(feuille(page, "Demander les dispos")).toBeVisible();
    expect(await ciblesTropPetites(page, dans)).toEqual([]);
    await page.keyboard.press("Escape");
    await onglet(page, "Semaine").click();
    await page.getByRole("button", { name: "Répartir toute l'équipe sur la semaine" }).click();
    await expect(feuille(page, "Répartir la semaine")).toBeVisible();
    expect(await ciblesTropPetites(page, dans)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "État des données" }).click();
    await expect(feuille(page, "Données")).toBeVisible();
    expect(await ciblesTropPetites(page, dans)).toEqual([]);
  });

  test.describe("sur un écran étroit (320 px, iPhone SE de première génération)", () => {
    /* Relecture adversariale de W5 : les zones de 44 px dépendaient de la
       largeur de l'écran. À 320 px, les sept jours n'ont plus 44 px de
       large, et leurs zones débordaient sur le jour voisin. */
    test.use({ viewport: { width: 320, height: 568 } });
    test("L2 — chaque cible au doigt, à 320 px : l'écran, les jours, une fiche", async ({ page }) => {
      await openLocal(page, { ...seed(), ui: { poolState: "bubble" } });
      expect(await ciblesTropPetites(page)).toEqual([]);
      await onglet(page, "Équipe").click();
      await page.locator("[data-personne]").filter({ hasText: "Nixon" }).click();
      await expect(feuille(page, "Nixon")).toBeVisible();
      expect(await ciblesTropPetites(page, "[role=dialog]")).toEqual([]);
    });
  });

  test("L2 — chaque cible au doigt : connexion, page compagnon", async ({ page }) => {
    /* L'écran de connexion et la page compagnon de Supabase, simulés ici :
       les autres sources ont les leurs (connexion.api, dispo.api). */
    test.skip(source() !== "local", "écrans de la source locale");
    await useFakeSupabase(page);
    await page.route(/supabase\.co/, route => {
      if (route.request().url() === FAKE_SUPABASE.url + "/rest/v1/rpc/avail_get")
        return route.fulfill({ json: { name: "Nixon", week: "2026-09-21", days: null, note: "", answered: false } });
      return route.abort();
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible({ timeout: 20_000 });
    expect(await ciblesTropPetites(page)).toEqual([]);
    await page.goto("/dispo.html?t=bon");
    await expect(page.getByRole("heading", { name: "Bonjour Nixon" })).toBeVisible({ timeout: 20_000 });
    expect(await ciblesTropPetites(page)).toEqual([]);
  });

  test("L3 — le focus clavier se voit", async ({ page }) => {
    await openLocal(page, seed());
    const sansContour: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const f = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const visible = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2) || s.boxShadow !== "none";
        return visible ? null : (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40);
      });
      if (f) sansContour.push(f);
    }
    expect(sansContour).toEqual([]);
  });

  test("L3 — l'anneau du focus se voit : jamais rogné sur deux côtés ou plus", async ({ page }) => {
    /* Relecture adversariale de W5 : L3 lisait le contour calculé sans
       vérifier qu'il se voit. Treize anneaux étaient rognés sur deux côtés
       au moins par un conteneur qui rogne (liste des missions, carte,
       îlot) ou par le bord de l'écran ; celui d'« Ouvrir le vivier »,
       tout entier. On mesure l'anneau peint (bord, décalage, épaisseur)
       contre chaque ancêtre qui rogne et l'écran. Un seul côté coupé est
       admis : l'élément au bord de la liste qui défile. */
    await openLocal(page, { ...seed(), ui: { poolState: "bubble" } });
    await carte(page, S9).getByRole("button", { name: /^Les 12 étapes/ }).click();
    await page.waitForTimeout(600);
    const rognes = new Map<string, string>();
    const parcourir = async (n: number) => {
      for (let i = 0; i < n; i++) {
        await page.keyboard.press("Tab");
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const w = parseFloat(s.outlineWidth) || 0, o = parseFloat(s.outlineOffset) || 0;
          const b = el.getBoundingClientRect();
          const a = { l: b.left - o - w, t: b.top - o - w, r: b.right + o + w, b: b.bottom + o + w };
          let c = { l: 0, t: 0, r: innerWidth, b: innerHeight };
          for (let p = el.parentElement; p; p = p.parentElement) {
            const ps = getComputedStyle(p);
            if (ps.overflowX === "visible" && ps.overflowY === "visible") continue;
            const pb = p.getBoundingClientRect();
            c = { l: Math.max(c.l, pb.left), t: Math.max(c.t, pb.top), r: Math.min(c.r, pb.right), b: Math.min(c.b, pb.bottom) };
          }
          const cotes = [a.l < c.l - 0.5, a.t < c.t - 0.5, a.r > c.r + 0.5, a.b > c.b + 0.5].filter(Boolean).length;
          return { nom: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 34), cotes };
        });
        if (r && r.cotes >= 2) rognes.set(r.nom, r.cotes + " côtés");
      }
    };
    await parcourir(60);
    await onglet(page, "Semaine").click();
    await parcourir(45);
    await onglet(page, "Équipe").click();
    await parcourir(45);
    expect([...rognes].map(([n, c]) => n + " : " + c)).toEqual([]);
  });

  test("L3 — au clavier, une puce ouvre sa fiche (« Poser sur… », sans glisser)", async ({ page }) => {
    /* Relecture adversariale de W5 : la fiche d'une puce ne s'ouvrait
       qu'au pointeur (useDrag, pointerup) ; au clavier, Entrée et Espace
       ne faisaient rien, et « Poser sur… », l'alternative au glisser,
       restait hors d'atteinte. Déjà vrai en W4. */
    await openLocal(page, seed());
    for (const touche of ["Enter", " "]) {
      await puceSur(page, S9, "Nixon").focus();
      await page.keyboard.press(touche);
      await expect(feuille(page, "Nixon")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(feuille(page, "Nixon")).toBeHidden();
    }
    // Au doigt, la fiche s'ouvre une fois, pas deux (le clic qui suit l'appui est ignoré).
    await puceSur(page, S9, "Nixon").click();
    await expect(feuille(page, "Nixon")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });

  test("L3 — au clavier, replier ou ouvrir le vivier garde le focus", async ({ page }) => {
    /* Relecture adversariale de W6 : le visage qui avait le focus quitte le
       DOM 220 ms après le geste, et le focus tombait sur la page. */
    const focus = () => page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return !el || el === document.body ? "page" : el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName;
    });
    await openLocal(page);
    await vivier(page).getByRole("button", { name: "Réduire le vivier" }).focus();
    await page.keyboard.press("Enter");
    await expect(vivier(page).getByRole("button", { name: /^Ouvrir le vivier/ })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await focus()).toMatch(/^Ouvrir le vivier/);
    await page.keyboard.press("Enter");
    await expect(vivier(page).getByRole("button", { name: "Réduire le vivier" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await focus()).toBe("Réduire le vivier");
  });

  test("L3 — au clavier, le focus reste dans la feuille ouverte", async ({ page }) => {
    /* Relecture adversariale de W5 : vaul annule le focus automatique (sur
       l'iPhone, il ouvrirait le clavier) ; rien n'avait alors le focus
       dans la feuille, et le piège de Radix n'avait rien où le ramener.
       Tab sortait vers la page cachée, et Entrée y changeait la semaine,
       feuille ouverte. */
    await openLocal(page, seed());
    const semaine = await page.locator("[data-semaine]").getAttribute("data-semaine");
    await page.getByRole("button", { name: "Ajouter" }).focus();
    await page.keyboard.press("Enter");
    await expect(feuille(page, "Nouveau chantier")).toBeVisible();
    const dehors: string[] = [];
    for (const touche of ["Tab", "Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
      await page.keyboard.press(touche);
      const hors = await page.evaluate(() => {
        const el = document.activeElement;
        return el && !el.closest("[role=dialog]") ? (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30) : null;
      });
      if (hors) dehors.push(touche + " → " + hors);
    }
    expect(dehors).toEqual([]);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-semaine]")).toHaveAttribute("data-semaine", semaine!);
  });
});
