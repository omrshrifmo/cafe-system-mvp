const CACHE_NAME = 'cafe-os-v2';
const STATIC_ASSETS = [
  '/',
  '/pos.html',
  '/portal.html',
  '/kds.html',
  '/kitchen.html',
  '/shisha.html',
  '/runner.html',
  '/tables.html',
  '/inventory.html',
  '/purchasing.html',
  '/menu-manager.html',
  '/admin-menu.html',
  '/crm.html',
  '/reservations.html',
  '/suppliers.html',
  '/hr.html',
  '/eod.html',
  '/bi.html',
  '/shareholders.html',
  '/qa.html',
  '/settings.html',
  '/nav.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('⚡ [ServiceWorker] Pre-caching offline shell assets v2');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('⚠️ [ServiceWorker] Non-critical precache skip:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('🧹 [ServiceWorker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API routes, WebSockets, or dynamic mutations
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || event.request.method !== 'GET') {
    return;
  }

  // Network-first strategy with cache fallback
  event.respondWith(
    // Force network fetch to bypass browser cache for HTML requests if needed
    fetch(event.request, {
      cache: event.request.headers.get('accept')?.includes('text/html') ? 'no-cache' : 'default'
    })
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/portal.html');
          }
        });
      })
  );
});
