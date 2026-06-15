const CACHE_NAME = 'hrms-pwa-20260615-swr';
const PRECACHE_URLS = [
  '/manifest.json',
  '/pwa-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        await cache.addAll(PRECACHE_URLS);
      } catch (e) {
        for (const u of PRECACHE_URLS) {
          try {
            await cache.add(u);
          } catch (e2) {}
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
      await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
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

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // 走 HTTP 缓存校验（ETag/Last-Modified）：内容未变服务端回 304，浏览器复用已缓存 HTML，
          // 避免每次导航都重下整页；变了才回 200 全量。比 no-store 快很多且不会读到过期内容。
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          try {
            await cache.put(req, fresh.clone());
          } catch (e) {}
          return fresh;
        } catch (e) {
          const cached = await caches.match(req);
          if (cached) return cached;
          const cachedRoot = await caches.match('/');
          if (cachedRoot) return cachedRoot;
          return new Response('离线：无法加载页面', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        try {
          await cache.put(req, fresh.clone());
        } catch (e) {}
        return fresh;
      } catch (e) {
        return cached || new Response('', { status: 504 });
      }
    })()
  );
});
