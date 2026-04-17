/* ===============================================================
   JafsPadel Service Worker v5 — PWA + Background Push Ready
   =============================================================== */

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const CACHE_NAME = "jafs-padel-runtime-v6";
const BASE_PATH = self.location.pathname.replace(/\/[^\/]*$/, "");
const withBase = (path) =>
  path.startsWith("http")
    ? path
    : `${BASE_PATH}${path.startsWith("/") ? path : "/" + path}`;

const OFFLINE_URLS = [
  "/",
  "/index.html",
  "/home.html",
  "/calendario.html",
  "/historial.html",
  "/palas.html",
  "/offline.html",
  "/imagenes/Logojafs.png",
].map(withBase);

// ─── INSTALL ────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(OFFLINE_URLS))
      .catch(() => null)
  );
  self.skipWaiting();
});

// ─── ACTIVATE ───────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── MESSAGES ───────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "PING") {
    event.source?.postMessage({ type: "PONG", ts: Date.now() });
  }
});

// ─── FETCH (Stale-while-revalidate for fast load) ───────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  const url = new URL(request.url);
  const isHtml = request.mode === "navigate" || request.destination === "document";
  const isAsset = ["script", "style", "worker", "image", "font"].includes(request.destination) || /\.(js|css|png|jpg|woff2)$/i.test(url.pathname);

  if (isHtml || isAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        }).catch(() => null);

        // STALE-WHILE-REVALIDATE: Return cache immediately if available, otherwise wait for network
        if (cached) return cached;
        return fetchPromise.then((response) => 
            response || caches.match(withBase("/offline.html")) || caches.match(withBase("/"))
        );
      })
    );
    return;
  }

  // Network first for APIs or other things
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// Nota: OneSignalSDK.sw.js maneja internamente los eventos 'push' y 'notificationclick'.
// Se ha eliminado el listener custom para evitar doble-notificación o que falle la recepción en 2º plano.

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true })
      .then((sub) => {
        return self.clients.matchAll().then((clients) => {
          clients.forEach((c) =>
            c.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED", subscription: sub.toJSON() })
          );
        });
      })
      .catch((e) => console.warn("[SW] pushsubscriptionchange failed:", e))
  );
});
