// ScanMe SW — 离线壳。CACHE 占位构建时替换为带 ts 的版本串。
// URL fragment 不参与 HTTP，天然不影响缓存键。
const CACHE = 'scanme-0.1.0-1777215309662';

// 入口 HTML + manifest + 图标。assets/* 由 Vite 带 hash，运行时 SWR 收。
const PRECACHE = [
  '/',
  '/v',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 逐个 add，失败不阻断（/v 在某些部署下需要回退到 /viewer.html）
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(url);
          } catch {
            if (url === '/v') {
              try { await cache.add('/viewer.html'); } catch { /* ignore */ }
            }
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML 导航：network-first，失败回退缓存
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }
  // 静态资源：stale-while-revalidate
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    // 扫码保命门：SW 返回 redirected=true 时浏览器会 re-navigate 到 response.url
    // 并丢弃原 URL 的 #fragment（GH Pages /v → /v/ 的 301 会触发）。
    // 对 navigate 请求清洗成非 redirect Response；Cache API 也不允许 put redirected。
    const stored =
      req.mode === 'navigate' && fresh.redirected ? await cleanRedirected(fresh) : fresh;
    cache.put(req, stored.clone()).catch(() => {});
    return stored;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    const fallback = await cache.match('/');
    if (fallback) return fallback;
    throw new Error('offline, no cache');
  }
}

async function cleanRedirected(res) {
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => cached);
  return cached || networkPromise;
}
