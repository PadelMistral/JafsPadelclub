const CACHE_NAME = "padeluminatis-v6.8";
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
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("Deleting old cache:", cacheName);
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        }),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function cachePut(request, response) {
  if (!response || (!response.ok && response.type !== "opaque")) return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, fallbackUrl = null) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    return await cachePut(request, response);
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  return cachePut(request, response);
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const networkFetch = fetch(request)
    .then((response) => cachePut(request, response))
    .catch(() => null);
  return cached || networkFetch || fetch(request);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // HTML (Navigation): Network first for instant updates in browser + PWA.
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "./index.html"));
    return;
  }

  // JS/CSS: Network first to avoid "manual cache clear" updates.
  if (url.pathname.match(/\.(js|css)$/)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Images: Cache first.
  if (url.pathname.match(/\.(png|jpg|jpeg|svg|webp|gif)$/)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Default static assets.
  event.respondWith(staleWhileRevalidate(event.request));
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
    tag: data.tag || `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    renotify: true,
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

  const rawUrl = event.notification.data?.url || "./home.html";
  const urlToOpen = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Prefer reusing an existing window to avoid duplicates.
        for (const client of windowClients) {
          if (!("focus" in client)) continue;
          if (client.url === urlToOpen) return client.focus();
          if (client.url.startsWith(self.location.origin)) return client.focus();
        }

        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      }),
  );
});
