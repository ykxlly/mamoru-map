const CACHE_NAME = 'mamoru-map-shell-v6';
const SHELL_ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/plateau-3d.js', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// network-first: 災害情報アプリのため常に最新を取得し、オフライン時のみキャッシュへフォールバックする。
// 以前の cache-first では更新が次回訪問まで届かず、古い画面が表示され続ける問題があった。
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  const cacheable = request.mode !== 'navigate' && /\.(?:js|css|json|png|webp|svg)$/i.test(url.pathname);
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (cacheable && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(async () => {
        if (request.mode === 'navigate') return (await caches.match('/')) || Response.error();
        return (await caches.match(request)) || Response.error();
      })
  );
});
