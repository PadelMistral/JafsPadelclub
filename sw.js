const CACHE_NAME = 'padeluminatis-v2.0';
const ASSETS = [
  './',
  './index.html',
  './home.html',
  './calendario.html',
  './perfil.html',
  './ranking.html',
  './puntosRanking.html',
  './historial.html',
  './diario.html',
  './palas.html',
  './css/core.css',
  './css/mistral-ui.css',
  './js/home-logic.js',
  './js/firebase-service.js',
  './js/ui-core.js',
  './js/match-service.js',
  './js/modules/ui-loader.js',
  './js/modules/galaxy-bg.js',
  './js/modules/gamification.js',
  './js/modules/vecina-chat.js',
  './imagenes/Logojafs.png',
  './imagenes/default-avatar.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700&display=swap'
];


self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use individual add and catch errors to be resilient
      return Promise.allSettled(ASSETS.map(url => cache.add(url)));
    })
  );
});


self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Network first for logic, Cache first for assets
  const isResource = e.request.url.includes('.png') || e.request.url.includes('.css') || e.request.url.includes('fonts');
  
  if (isResource) {
    e.respondWith(
      caches.match(e.request).then((res) => res || fetch(e.request))
    );
  } else {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  }
});

