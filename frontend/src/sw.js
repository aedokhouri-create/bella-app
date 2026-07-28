// Service worker customizado (injectManifest) — precacheia como antes, mas também
// escuta "push" pra mostrar notificação de verdade mesmo com o app fechado.
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

precacheAndRoute(self.__WB_MANIFEST);

// Deixa a lista de tarefas disponível offline (mostra a última vista).
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/tarefas"),
  new NetworkFirst({
    cacheName: "nina-tarefas",
    plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 7 })],
  })
);

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { title: "Bella", body: event.data?.text() || "" };
  }
  event.waitUntil(
    self.registration.showNotification(dados.title || "Bella", {
      body: dados.body || "",
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      data: { url: dados.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      const aberta = janelas.find((j) => j.url.includes(self.location.origin));
      if (aberta) return aberta.focus();
      return self.clients.openWindow(url);
    })
  );
});

self.skipWaiting();
self.addEventListener("activate", () => self.clients.claim());
