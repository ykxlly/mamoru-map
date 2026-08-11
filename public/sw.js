const CACHE_NAME = 'mamoru-map-shell-v6';
const SHELL_ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js', '/plateau-3d.js', '/plateau-location.js', '/manifest.json',
  '/favicon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'
];

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

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
