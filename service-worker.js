// Service Worker para Padeluminatis (versión definitiva)
const CACHE_NAME = 'padeluminatis-v2';
const BASE_PATH = '/padeluminatis/';

const ASSETS = [
  // Raíz y páginas HTML
  `${BASE_PATH}`,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}admin.html`,
  `${BASE_PATH}calendario.html`,
  `${BASE_PATH}chat.html`,
  `${BASE_PATH}clasificacion.html`,
  `${BASE_PATH}home.html`,
  `${BASE_PATH}normas.html`,
  `${BASE_PATH}perfil.html`,
  `${BASE_PATH}recuperar.html`,
  `${BASE_PATH}registro.html`,

  // CSS
  `${BASE_PATH}css/admin.css`,
  `${BASE_PATH}css/calendario.css`,
  `${BASE_PATH}css/chat.css`,
  `${BASE_PATH}css/clasificacion.css`,
  `${BASE_PATH}css/estilo.css`,
  `${BASE_PATH}css/estilos.css`,
  `${BASE_PATH}css/home.css`,
  `${BASE_PATH}css/perfil.css`,

  // JavaScript
  `${BASE_PATH}js/admin.js`,
  `${BASE_PATH}js/auth.js`,
  `${BASE_PATH}js/calendario.js`,
  `${BASE_PATH}js/chat.js`,
  `${BASE_PATH}js/clasificacion.js`,
  `${BASE_PATH}js/enlaceAdmin.js`,
  `${BASE_PATH}js/firebase-config.js`,
  `${BASE_PATH}js/login.js`,
  `${BASE_PATH}js/menu-hamburguesa.js`,
  `${BASE_PATH}js/misPartidos.js`,
  `${BASE_PATH}js/perfil.js`,
  `${BASE_PATH}js/recuperar.js`,
  `${BASE_PATH}js/registro.js`,
  `${BASE_PATH}js/usuario.js`,

  // Imágenes (verifica nombres exactos)
  `${BASE_PATH}imagenes/158877-1920x1200-desktop-hd-tennis-wallpaper-image.jpg`,
  `${BASE_PATH}imagenes/5c0e4dc8-3bc6-4692-9e73-47d471dcd846.webp`,
  `${BASE_PATH}imagenes/Logojafs.png`,
  `${BASE_PATH}imagenes/Screenshot_20210512-180610_YouTube.jpg`,
  `${BASE_PATH}imagenes/casa.jpg`,
  `${BASE_PATH}imagenes/chevron-down-svgrepo-com.svg`
];

// ===== Instalación =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ===== Estrategia de caché =====
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});

// ===== Limpieza de caché antigua =====
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null)
    ).then(() => self.clients.claim())
  )
  );
});
