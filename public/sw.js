const CACHE_NAME = 'cafe-os-v1';
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
      console.log('⚡ [ServiceWorker] Pre-caching offline shell assets');
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

  event.respondWith(
    fetch(event.request)
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
            return caches.match('/pos.html') || caches.match('/portal.html');
          }
        });
      })
  );
});
