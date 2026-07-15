/* Offline shell for WebInk. Never serve JS for document navigations. */

const CACHE = 'crossink-web-v24-st';

const PRECACHE = [
  './index.html',
  './app.js',
  './manifest.json',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
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
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isNavigation(req) {
  return req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML navigations: network first, HTML only as fallback (never app.js).
  if (isNavigation(req)) {
    event.respondWith(
      (async () => {
        try {
          const net = await fetch(req, { cache: 'no-store' });
          if (net.ok) {
            const cache = await caches.open(CACHE);
            try {
              await cache.put('./index.html', net.clone());
            } catch {
              /* ignore */
            }
          }
          return net;
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            new Response('<!DOCTYPE html><title>Offline</title><p>WebInk offline</p>', {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
      })(),
    );
    return;
  }

  // Static assets: network first, cache fallback.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const net = await fetch(req);
        if (net.ok) {
          try {
            // Normalize app.js?* to app.js for offline
            if (url.pathname.endsWith('/app.js')) {
              await cache.put('./app.js', net.clone());
            } else {
              await cache.put(req, net.clone());
            }
          } catch {
            /* ignore */
          }
        }
        return net;
      } catch {
        if (url.pathname.endsWith('/app.js')) {
          const hit = await cache.match('./app.js');
          if (hit) return hit;
        }
        const hit = await cache.match(req);
        if (hit) return hit;
        return Response.error();
      }
    })(),
  );
});
