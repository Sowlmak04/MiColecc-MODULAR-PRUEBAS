// sw.js
const CACHE_NAME = 'mi-coleccion-v34-r2-covers-2-13-0'; // Sube a v3, v4... cuando publiques cambios importantes
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/core.js',
  './js/app.js',
  './js/io.js',
  './js/sw-register.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  // Activación automática validada en iOS para aplicar nuevas versiones sin reinstalar la PWA.
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // La API nunca debe pasar por la caché del Service Worker.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // v2.11.0: red primero para HTML/JS/CSS y navegación. Así un despliegue nuevo
  // no sigue ejecutando JavaScript antiguo en Chrome/PWA. La caché queda como
  // respaldo offline.
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && url.origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
