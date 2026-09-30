const CACHE_NAME = 'synergy-b2b-v17';
const STATIC_ASSETS = [
  '/favicon.svg',
  '/manifest.json',
  '/Вектор_Синэнергия.png',
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache warning:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up all old caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => {
          console.log('[SW] Deleting stale cache:', key);
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Stale-While-Revalidate for catalog queries, Network-First for navigation & app shell
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests (e.g. POST orders)
  if (request.method !== 'GET') {
    return;
  }

  // Handle URL parsing safely
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Ignore non-http schemes (e.g. chrome-extension://, data:)
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Only intercept same-origin requests to prevent interference with cross-origin APIs or extensions
  if (url.origin !== self.location.origin) {
    return;
  }

  // Handle Catalog API caching (Stale-While-Revalidate)
  if (url.pathname.includes('/api/erp') && (url.search.includes('action=catalog') || url.search.includes('action=product'))) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(request);
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => null);

        if (cachedResponse) {
          return cachedResponse;
        }

        const networkRes = await fetchPromise;
        if (networkRes) {
          return networkRes;
        }

        return new Response(JSON.stringify({ error: 'Offline', items: [] }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })()
    );
    return;
  }

  // Handle Navigation (HTML Documents): Strictly Network-First to guarantee fresh index.html
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          return networkResponse;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const indexCached = await caches.match('/index.html');
          if (indexCached) return indexCached;
          return new Response('<h1>Офлайн-режим</h1><p>Проверьте подключение к сети.</p>', {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
      })()
    );
    return;
  }

  // Handle Static & App Shell requests: Network-First with Cache Fallback
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        const contentType = response.headers.get('content-type') || '';
        // Защита от MIME text/html для .js чанков при 404 rewrite
        if (url.pathname.endsWith('.js') && contentType.includes('text/html')) {
          return new Response('Stale module chunk not found', { status: 404, statusText: 'Not Found' });
        }
        if (response && response.status === 200 && response.type === 'basic' && !contentType.includes('text/html')) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('Resource unavailable', { status: 504, statusText: 'Gateway Timeout' });
      }
    })()
  );
});
