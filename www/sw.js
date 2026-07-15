/* Service worker: offline shell + COOP/COEP for SharedArrayBuffer (pthreads). */

const CACHE = 'crossink-web-v1';
const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Wasm artifacts (added after first successful fetch)
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
            /* optional until built */
          }
        })
      );
      self.skipWaiting();
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

function withIsolation(response) {
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  // Allow workers/wasm same-origin
  if (!headers.has('Cross-Origin-Resource-Policy')) {
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const net = await fetch(req);
        if (net.ok) {
          cache.put(req, net.clone());
        }
        return withIsolation(net);
      } catch {
        const hit = await cache.match(req);
        if (hit) return withIsolation(hit);
        // SPA-style fallback
        const index = await cache.match('./index.html');
        if (index) return withIsolation(index);
        return Response.error();
      }
    })()
  );
});
