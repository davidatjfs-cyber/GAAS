const CACHE_NAME = 'hrms-pwa-20260704a';
const PRECACHE_URLS = [
  '/manifest.json',
  '/pwa-icon.svg'
];

function isHtmlDocument(url) {
  const p = url.pathname || '';
  return p === '/' || p.endsWith('.html') || p.includes('working-fixed');
}

function isHashedAsset(url) {
  return /^\/app\.[0-9a-f]+\.(js|css)$/.test(url.pathname || '');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        await cache.addAll(PRECACHE_URLS);
      } catch (e) {
        for (const u of PRECACHE_URLS) {
          try { await cache.add(u); } catch (e2) {}
        }
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      self.clients.claim();
    })()
  );
});

function isApiRequest(url) {
  try {
    return url.pathname.startsWith('/api/');
  } catch (e) {
    return false;
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req) return;
  if (req.method !== 'GET') return;
  if (req.headers && req.headers.has('range')) return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return;
  if (url.pathname.startsWith('/agents-admin/')) return;
  if (url.pathname.startsWith('/platform-admin/')) return;

  // HTML 壳页永不进 SW 缓存，避免用户长期停留在旧版整页 JS。
  if (req.mode === 'navigate' || isHtmlDocument(url)) {
    event.respondWith(fetch(req));
    return;
  }

  // 内容哈希外链：网络优先，离线才读缓存。
  if (isHashedAsset(url)) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch (e) {
          const cached = await caches.match(req);
          return cached || new Response('', { status: 504 });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        try { await cache.put(req, fresh.clone()); } catch (e) {}
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || new Response('', { status: 504 });
      }
    })()
  );
});
