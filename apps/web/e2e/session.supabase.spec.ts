/* S10. Lancement hors ligne avec un jeton expiré (source supabase).

   Geoffrey ouvre l'application au fond d'un sous-sol : pas de réseau, et
   le jeton de sa session a expiré depuis une heure. Avant W4, supabase-js
   ne rendait plus de session, et l'écran de connexion remplaçait le
   planning. L'application doit s'ouvrir sur ce qu'elle a gardé. */

import { expect, test } from "@playwright/test";
import { NOW, effectif } from "./helpers";
import { FAUX, sessionEnregistree } from "./supabase/faux";

test("S10 — hors ligne, un jeton expiré rouvre l'application sur son cache, pas sur l'écran de connexion", async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  const tentatives: string[] = [];
  await page.route(/supabase\.co/, r => { tentatives.push(r.request().url()); return r.abort("internetdisconnected"); });
  await page.routeWebSocket(/supabase\.co/, ws => { ws.close(); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());

  /* Une session expirée il y a une heure, et le cache d'avant W4. */
  const session = JSON.parse(sessionEnregistree(new Date(NOW.getTime() - 2 * 3600 * 1000)).valeur) as { expires_at: number };
  session.expires_at = Math.floor(NOW.getTime() / 1000) - 3600;
  const e = effectif();
  await page.addInitScript(({ cfg, session, e }) => {
    (globalThis as Record<string, unknown>).__GEOPLAN_E2E__ = cfg;
    if (sessionStorage.getItem("__e2e_seeded")) return;
    sessionStorage.setItem("__e2e_seeded", "1");
    localStorage.setItem("sb-e2e-factice-auth-token", JSON.stringify(session));
    localStorage.setItem("geoplan.cache.v1", JSON.stringify({ people: e.people, sites: e.sites, avail: [], dirty: [], gone: [] }));
  }, { cfg: FAUX, session, e });

  await page.goto("/");
  await expect(page.getByRole("banner")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("article[data-site]")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Se connecter" })).toHaveCount(0);
  /* Rien n’a été relu du serveur : le bouton ne prétend pas « À jour ». */
  await expect(page.getByRole("button", { name: "État des données" })).not.toHaveText(/à jour/i);
  /* Il a bien essayé de rafraîchir le jeton : c'est hors ligne qu'il a échoué. */
  expect(tentatives.some(u => u.includes("/auth/v1/token"))).toBe(true);
});
