const CACHE_NAME = "padeluminatis-v6.5";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./home.html",
  "./css/core-bundle.css",
  "./css/themes.css",
  "./css/layout.css",
  "./css/home.css",
  "./css/premium-v7.css",
  "./css/design-system.css",
  "./css/components-premium.css",
  "./css/auth.css",
  "./js/home-logic.js",
  "./js/ui-core.js",
  "./js/firebase-service.js",
  "./js/modules/theme-manager.js",
  "./js/login.js",
  "./imagenes/Logojafs.png",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) return caches.delete(cacheName);
        }),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  if (isSameOrigin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return res;
          })
          .catch(() => caches.match("./index.html"));
      }),
    );
    return;
  }

  event.respondWith(fetch(event.request));
});

// --- PUSH NOTIFICATIONS HANDLING ---
self.addEventListener("push", (event) => {
  let data = {
    title: "Padeluminatis Pro",
    body: "Nueva actualización en la Matrix.",
    icon: "./imagenes/Logojafs.png",
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || "./imagenes/Logojafs.png",
    badge: "./imagenes/Logojafs.png",
    vibrate: [200, 100, 200],
    data: {
      url: data.url || "./home.html",
    },
    actions: [
      { action: "open", title: "Ver ahora" },
      { action: "close", title: "Cerrar" },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "close") return;

  const urlToOpen = event.notification.data.url || "./home.html";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Look for an existing app window and focus it
        for (let i = 0; i < windowClients.length; i++) {
          const client = windowClients[i];
          if (client.url === urlToOpen && "focus" in client) {
            return client.focus();
          }
        }
        // If no window found, open a new one
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      }),
  );
});
