importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const CACHE_VERSION = "v8.7.0";
const SHELL_CACHE = `padeluminatis-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `padeluminatis-runtime-${CACHE_VERSION}`;
const OFFLINE_FALLBACK_URL = "./offline.html";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./home.html",
  "./admin.html",
  "./calendario.html",
  "./eventos.html",
  "./notificaciones.html",
  "./perfil.html",
  "./offline.html",
  "./css/global.css",
  "./css/auth.css",
  "./css/home-v2.css",
  "./css/calendar.css",
  "./css/notificaciones.css",
  "./css/perfil.css",
  "./css/admin-core.css",
  "./css/production-upgrade.css",
  "./js/login.js",
  "./js/home-core.js",
  "./js/admin.js",
  "./js/ui-core.js",
  "./js/firebase-service.js",
  "./js/modules/theme-manager.js",
  "./js/modules/pwa-shell.js",
  "./js/modules/push-notifications.js",
  "./js/utils/team-utils.js",
  "./imagenes/Logojafs.png",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => {
          if (name !== SHELL_CACHE && name !== RUNTIME_CACHE) {
            return caches.delete(name);
          }
          return Promise.resolve();
        }),
      );
      if ("navigationPreload" in self.registration) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function putRuntimeCache(request, response) {
  if (!response || (!response.ok && response.type !== "opaque")) return response;
  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, fallbackUrl = null, preloadResponsePromise = null) {
  try {
    if (preloadResponsePromise) {
      const preloadResponse = await preloadResponsePromise.catch(() => null);
      if (preloadResponse) return await putRuntimeCache(request, preloadResponse);
    }
    const response = await fetch(request, { cache: "no-store" });
    return await putRuntimeCache(request, response);
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
  return putRuntimeCache(request, response);
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const networkPromise = fetch(request)
    .then((response) => putRuntimeCache(request, response))
    .catch(() => null);
  return cached || networkPromise || fetch(request);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, OFFLINE_FALLBACK_URL, event.preloadResponse));
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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "./home.html";

  event.waitUntil(
    clients.matchAll({ type: "window" }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === url && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
      return null;
    }),
  );
});
