/* ===============================================================
   JafsPadel Service Worker v5 — PWA + Background Push Ready
   =============================================================== */

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const CACHE_NAME = "jafs-padel-runtime-v6";
const BASE_PATH = new URL(self.registration.scope || "/").pathname.replace(/\/$/, "");
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

// ─── FETCH (Cache-first, fallback to network) ───────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  const url = new URL(request.url);
  const isHtml = request.mode === "navigate" || request.destination === "document";
  const isAsset = ["script", "style", "worker"].includes(request.destination) || /\.(js|css)$/i.test(url.pathname);

  if (isHtml || isAsset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy).catch(() => null));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return caches.match(withBase("/offline.html")) || caches.match(withBase("/"));
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy).catch(() => null));
          return response;
        })
        .catch(() =>
          caches.match(withBase("/offline.html")) ||
          caches.match(withBase("/"))
        );
    })
  );
});

// ─── PUSH NOTIFICATIONS (Background, PWA cerrada) ───────────────
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = { title: "JafsPadel", body: event.data?.text() || "Nuevo aviso" };
  }

  const title = data.headings?.es || data.title || "JafsPadel";
  const body = data.contents?.es || data.body || "Tienes un nuevo aviso";
  const icon = data.icon || "/imagenes/Logojafs.png";
  const badge = data.badge || "/imagenes/Logojafs.png";
  const url = data.url || data.launchURL || "/notificaciones.html";
  const tag = data.tag || "jafs-push";
  const requireInteraction = data.requireInteraction ?? true;

  const notifOptions = {
    body,
    icon,
    badge,
    tag,
    requireInteraction,
    vibrate: [200, 100, 200],
    data: { url, openUrl: url },
    actions: [
      { action: "open", title: "Ver ahora" },
      { action: "dismiss", title: "Cerrar" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, notifOptions)
  );
});

// ─── NOTIFICATION CLICK ─────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || "/notificaciones.html";
  const fullUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Busca una ventana abierta y la enfoca
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.navigate(fullUrl);
            return client.focus();
          }
        }
        // Si no hay ventana abierta, abre una nueva
        return self.clients.openWindow(fullUrl);
      })
  );
});

// ─── PUSH SUBSCRIPTION CHANGE ───────────────────────────────────
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true })
      .then((sub) => {
        // Notifica a los clientes activos para re-registrar en Firestore
        return self.clients.matchAll().then((clients) => {
          clients.forEach((c) =>
            c.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED", subscription: sub.toJSON() })
          );
        });
      })
      .catch((e) => console.warn("[SW] pushsubscriptionchange failed:", e))
  );
});
