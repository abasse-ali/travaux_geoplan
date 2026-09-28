import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "path";

/* Deux pages : l'application, et la page de réponse du compagnon —
   ouverte depuis un lien reçu par message, sans compte ni installation.
   Elle est volontairement séparée : elle ne doit charger ni React
   Router, ni l'interface de planification, juste son formulaire. */

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png"],
      manifest: {
        name: "Geoplan — chantiers",
        short_name: "Geoplan",
        description:
          "Affectation des compagnons aux chantiers : 12 étapes, compétences, composition d'équipe.",
        lang: "fr",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "portrait",
        background_color: "#EDEDEA",
        theme_color: "#26476E",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        /* Le lien du samedi porte le jeton du compagnon : /dispo.html?t=…
           Sans cette règle, l'adresse ne correspondait pas à l'entrée
           précachée « dispo.html », et la navigation retombait sur
           index.html : dès sa deuxième semaine, le compagnon voyait
           l'écran de connexion de l'application (constat P1). Le
           formulaire lit le jeton dans l'adresse, pas dans la réponse. */
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^t$/],
        /* Supabase, c'est de la donnée vivante : jamais de cache. Et la
           page compagnon ne doit jamais recevoir l'application à sa place,
           même si son entrée venait à manquer au précache. */
        navigateFallbackDenylist: [/^\/api/, /^\/dispo\.html/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "polices",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        dispo: resolve(__dirname, "dispo.html")
      }
    }
  },
  server: { port: 5173, host: true }
});
