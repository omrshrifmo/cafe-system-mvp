const CACHE_NAME = 'cafe-os-v3.3';
const STATIC_ASSETS = [
  '/',
  '/login.html',
  '/portal.html',
  '/pos.html',
  '/kds.html',
  '/kitchen.html',
  '/shisha.html',
  '/tables.html',
  '/inventory.html',
  '/eod.html',
  '/hr.html',
  '/reservations.html',
  '/menu-manager.html',
  '/settings.html',
  '/manual.html',
  '/setup.html',
  '/qr-menu.html',
  '/nav.js',
  '/modules/ui-state.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Service worker precaching warning:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
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

  // NEVER cache API, authentication, WebSocket or dynamic mutations
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || event.request.method !== 'GET') {
    return;
  }

  // Network-First with Cache Fallback for HTML documents & static assets
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('/portal.html') || caches.match('/login.html');
          }
        });
      })
  );
});
