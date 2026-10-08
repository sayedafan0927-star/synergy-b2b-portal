const CACHE_NAME = 'synergy-b2b-v22';
const STATIC_ASSETS = [
  '/favicon.svg',
  '/manifest.json',
  '/Вектор_Синэнергия.png',
];

// Allow clients to trigger skipWaiting immediately
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

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

  // CRITICAL: Bypass video/audio media and Range requests from Service Worker interception!
  // Browsers require native 206 Partial Content range streaming for hardware video decoding.
  if (
    request.headers.has('range') ||
    request.destination === 'video' ||
    request.destination === 'audio' ||
    /\.(mp4|webm|mov|ogg)$/i.test(url.pathname)
  ) {
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

  // CRITICAL: Bypass all other API routes completely - never intercept serverless functions with App Shell fallback
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Handle HTML Documents & SPA Navigation routes (Network-First with index.html Fallback)
  const isHtmlRoute =
    request.mode === 'navigate' ||
    request.destination === 'document' ||
    (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) ||
    (!url.pathname.includes('.') && !url.pathname.startsWith('/api/'));

  if (isHtmlRoute) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request, { cache: 'no-cache' });
        } catch {
          const cached =
            (await caches.match(request)) ||
            (await caches.match('/index.html')) ||
            (await caches.match('/'));
          if (cached) return cached;
          return new Response('<h1>Офлайн-режим</h1><p>Проверьте подключение к сети.</p>', {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
      })()
    );
    return;
  }

  // Handle Static Asset requests (.js, .css, images, fonts): Network-First with Cache Fallback
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        const contentType = response.headers.get('content-type') || '';
        const isStaticAsset =
          url.pathname.startsWith('/assets/') ||
          /\.(js|css|mjs|png|jpe?g|webp|svg|ico|woff2?)$/i.test(url.pathname);

        // Anti-Stale Invariant: never return HTML for CSS/JS/static assets (prevents MIME type errors)
        if (isStaticAsset && contentType.includes('text/html')) {
          console.warn('[SW] Stale asset returned text/html, serving 404:', url.pathname);
          return new Response('Stale asset not found', {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'text/plain' }
          });
        }
        if (response && response.status === 200 && response.type === 'basic' && !contentType.includes('text/html')) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('Resource unavailable offline', { status: 503, statusText: 'Service Unavailable' });
      }
    })()
  );
});
