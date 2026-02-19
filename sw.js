const CACHE_NAME = "padeluminatis-v7.2";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./home.html",
  "./admin.html",
  "./prueba-ranking.html",
  "./css/core-bundle.css",
  "./css/themes.css",
  "./css/layout.css",
  "./css/home.css",
  "./css/premium-v7.css",
  "./css/design-system.css",
  "./css/components-premium.css",
  "./css/auth.css",
  "./js/home-logic.js",
  "./js/admin.js",
  "./js/prueba-ranking.js",
  "./js/provisional-ranking-logic.js",
  "./js/ui-core.js",
  "./js/firebase-service.js",
  "./js/modules/theme-manager.js",
  "./js/login.js",
  "./imagenes/Logojafs.png",
  "./manifest.json",
  // ⚠️ NO incluimos archivos de OneSignal aquí
];

// ⚠️ Eliminamos eventos push y notificationclick para que OneSignal se encargue

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      );
      await self.clients.claim();
    })()
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

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "./index.html"));
    return;
  }

  if (url.pathname.match(/\.(js|css)$/)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (url.pathname.match(/\.(png|jpg|jpeg|svg|webp|gif)$/)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});
