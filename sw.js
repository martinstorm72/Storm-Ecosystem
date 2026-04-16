/* ================================================================
   Storm OS — Service Worker
   Caches all app pages for offline use & fast load
   ================================================================ */

const CACHE_NAME = 'storm-os-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/login.html',
  '/signup.html',
  '/products.html',
  '/services.html',
  '/policy.html',
  '/productLockIn.html',
  '/Profile.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

/* ── Install: pre-cache all app shells ── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Storm OS SW] Pre-caching app shell');
      // Use individual adds to avoid failing entire cache on missing assets
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) => cache.add(url).catch(() => {}))
      );
    })
  );
  self.skipWaiting();
});

/* ── Activate: clean up old caches ── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) =>
      Promise.all(
        keyList
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* ── Fetch: Network-first with cache fallback ── */
self.addEventListener('fetch', (event) => {
  // Skip non-GET and non-http(s) requests
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  // For HTML pages: network-first (always fresh content when online)
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For everything else: cache-first (fonts, scripts, styles)
  event.respondWith(
    caches.match(event.request).then(
      (cached) => cached || fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
    )
  );
});
