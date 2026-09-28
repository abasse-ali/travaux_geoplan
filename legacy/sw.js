/* ============================================================
   Geoplan — service worker
   Met la coque de l'application en cache pour qu'elle démarre sans
   réseau, dans un appartement en travaux comme dans un parking.

   Stratégie :
   • coque (HTML, CSS, JS, icônes) — réseau d'abord, cache en secours,
     de sorte qu'un déploiement soit pris en compte au rechargement
     suivant sans jamais laisser l'appli inaccessible hors ligne ;
   • polices Google — cache d'abord, elles ne changent pas ;
   • Supabase — jamais mis en cache, c'est de la donnée vivante.

   Après un déploiement, incrémentez VERSION : les anciens caches
   sont supprimés à l'activation.
   ============================================================ */

const VERSION = "geoplan-v11";
const SHELL = [
  "./",
  "./index.html",
  "./dispo.html",
  "./styles.css",
  "./config.js",
  "./js/app.js",
  "./js/dispo.js",
  "./js/store.js",
  "./js/domain.js",
  "./js/mark.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())      // un fichier manquant ne doit pas bloquer l'installation
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  /* Donnée vivante : ne jamais servir depuis le cache. */
  if (url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.in")) return;

  /* Polices : cache d'abord. */
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" ||
      url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit))
    );
    return;
  }

  /* Coque : réseau d'abord, cache en secours. */
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
  );
});
