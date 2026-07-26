import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["pwa-192x192.png", "pwa-512x512.png"],
      manifest: {
        name: "Nina — Assistente Pessoal",
        short_name: "Nina",
        description: "Seu assistente pessoal por voz e texto.",
        lang: "pt-BR",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#0E7C86",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            // Deixa a lista de tarefas disponível offline (mostra a última vista).
            urlPattern: ({ url }) => url.pathname.startsWith("/api/tarefas"),
            handler: "NetworkFirst",
            options: {
              cacheName: "nina-tarefas",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    // Durante o desenvolvimento, encaminha /api para o backend na porta 3001.
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
