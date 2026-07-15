/* Offline cache only — single-threaded Wasm no longer needs COOP/COEP. */

const CACHE = 'crossink-web-v4-st';
const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './crossink.js',
  './crossink.wasm',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(url);
          } catch {
            /* optional */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const net = await fetch(req);
        if (net.ok) {
          try {
            cache.put(req, net.clone());
          } catch {
            /* ignore */
          }
        }
        return net;
      } catch {
        const hit = await cache.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const index = await cache.match('./index.html');
          if (index) return index;
        }
        return Response.error();
      }
    })()
  );
});
