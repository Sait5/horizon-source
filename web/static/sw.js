// Офлайн-оболочка: страницы и картинки сайта открываются сразу, поиск всегда свежий из сети.
const CACHE = 'horizon-web-v1';
const SHELL = ['/', '/index.html', '/start.css', '/start.js', '/web-shim.js', '/mobile.css', '/site-icons.js', '/default-state.json', '/builtin/sunrise.jpg', '/search/', '/search/index.html', '/search/search.css', '/search/search.js', '/search/viewer.js', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.endsWith('.mp4')) return;
  // Сначала сеть (свежая версия), без сети — из кеша
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(event.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
