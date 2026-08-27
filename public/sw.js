const CACHE_NAME = 'cafe-os-v3.2-prod';
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
  '/qr-menu.html',
  '/nav.js',
  '/manifest.json',
  '/modules/ui-state.js',
  '/modules/api.js',
  '/modules/auth.js',
  '/modules/db.js',
  '/modules/sync.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('⚡ [ServiceWorker v3.1] Pre-caching offline shell assets');
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

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API routes, WebSockets, or dynamic mutations
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || event.request.method !== 'GET') {
    return;
  }

  // Network-first strategy with cache fallback for static app shells
  event.respondWith(
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
