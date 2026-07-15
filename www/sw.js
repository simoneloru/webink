/* Cross-origin isolation + offline cache for pthread SharedArrayBuffer on GitHub Pages.
 *
 * GH Pages cannot set COOP/COEP. This SW rewrites every same-origin response so the
 * document becomes crossOriginIsolated after the first controlled load.
 */

const CACHE = 'crossink-web-v3';
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
            /* may not exist yet during local dev */
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

function withIsolationHeaders(response) {
  // Clone headers; strip COOP/COEP/CORP if present then set ours.
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // credentialless is more forgiving than require-corp on static hosts
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Only isolate same-origin navigations and assets for this app.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const net = await fetch(req);
        // Cache successful GETs of our static files
        if (net.ok && (req.mode === 'navigate' || url.pathname.includes('/webink') || true)) {
          try {
            cache.put(req, net.clone());
          } catch {
            /* ignore quota / opaque */
          }
        }
        return withIsolationHeaders(net);
      } catch {
        const hit = await cache.match(req);
        if (hit) return withIsolationHeaders(hit);
        if (req.mode === 'navigate') {
          const index = await cache.match('./index.html');
          if (index) return withIsolationHeaders(index);
        }
        return Response.error();
      }
    })()
  );
});
