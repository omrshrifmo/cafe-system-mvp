// ─── Cafe System Service Worker ────────────────────────────────────────────
// RELEASE_TAG is replaced at build-time or updated here for each deploy.
// Change this value on EVERY deployment to bust stale caches.
const RELEASE_TAG = 'cafe-os-v3.3-' + (self.registration ? self.registration.scope : Date.now());
const CACHE_NAME = 'cafe-os-v3.3';          // bump on every release
const CACHE_VERSION = '3.3.0';

// ─── Never cache these — always network-first with NO fallback ──────────────
// These paths must ALWAYS be fresh from the server.
const NEVER_CACHE = new Set([
  '/api/build-info',
  '/api/auth/me',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/setup/status',
  '/api/setup/readiness',
]);

// ─── Always network-first (cache only as offline fallback) ─────────────────
const NETWORK_FIRST = new Set([
  '/',
  '/index.html',
  '/setup.html',
  '/manual.html',
  '/health.html',
  '/modules/auth.js',
  '/sw.js',
]);

// ─── Pre-cache list (cache-first after install) ────────────────────────────
const STATIC_ASSETS = [
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
  '/modules/db.js',
  '/modules/sync.js',
];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log(`[SW ${CACHE_VERSION}] Installing cache: ${CACHE_NAME}`);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Non-critical precache skip:', err.message);
      });
    })
  );
  // Skip waiting so new SW activates immediately
  self.skipWaiting();
});

// ─── Activate ───────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log(`[SW ${CACHE_VERSION}] Activating, clearing old caches`);
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting obsolete cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      // Claim all clients immediately so navigation uses new SW
      return self.clients.claim();
    }).then(() => {
      // Notify all open tabs that the SW updated
      return self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
      });
    })
  );
});

// ─── Message ─────────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // ── Bypass cache entirely in development mode ──
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    event.respondWith(fetch(event.request));
    return;
  }

  // ── NEVER cache: pass through entirely ──
  if (url.pathname.startsWith('/ws') || isNeverCache(url.pathname)) {
    event.respondWith(
      fetch(event.request, { credentials: 'include' })
    );
    return;
  }

  // ── All /api/ routes: network-only, no cache ──
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(event.request));
    return;
  }

  // ── Critical HTML / auth.js: network-first, cache as fallback ──
  if (NETWORK_FIRST.has(url.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // ── Everything else: cache-first with network update ──
  event.respondWith(cacheFirst(event.request));
});

// ─── Strategy helpers ─────────────────────────────────────────────────────────

function isNeverCache(pathname) {
  if (NEVER_CACHE.has(pathname)) return true;
  // Also never cache any auth or session API
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname.startsWith('/api/setup/')) return true;
  return false;
}

async function networkOnly(request) {
  try {
    return await fetch(request, { credentials: 'include' });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'offline', success: false }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request, {
      credentials: 'include',
      cache: 'no-cache',
    });
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      // Only cache non-auth HTML as offline fallback
      const url = new URL(request.url);
      if (!isNeverCache(url.pathname)) {
        cache.put(request, networkResponse.clone());
      }
    }
    return networkResponse;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Hard fallback for HTML requests
    if (request.headers.get('accept')?.includes('text/html')) {
      return caches.match('/index.html');
    }
    return new Response('Offline', { status: 503 });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Revalidate in background
    fetch(request, { credentials: 'include' }).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
      }
    }).catch(() => {});
    return cached;
  }
  // Not in cache — go to network
  try {
    const networkResponse = await fetch(request, { credentials: 'include' });
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (e) {
    return new Response('Offline', { status: 503 });
  }
}
