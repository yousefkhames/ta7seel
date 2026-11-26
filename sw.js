/* ta7seel service worker: shell and fonts precached, network-first for the rest. */
const CACHE = 'ta7seel-v1';
const ASSETS = [
  './',
  'assets/logo.svg',
  'css/styles.css',
  'fonts/Cairo-arabic-400.woff2',
  'fonts/Cairo-arabic-500.woff2',
  'fonts/Cairo-arabic-600.woff2',
  'fonts/Cairo-arabic-700.woff2',
  'fonts/Cairo-arabic-800.woff2',
  'fonts/Cairo-arabic-900.woff2',
  'fonts/Cairo-latin-400.woff2',
  'fonts/Cairo-latin-500.woff2',
  'fonts/Cairo-latin-600.woff2',
  'fonts/Cairo-latin-700.woff2',
  'fonts/Cairo-latin-800.woff2',
  'fonts/Cairo-latin-900.woff2',
  'fonts/fonts.css',
  'index.html',
  'js/app.js',
  'js/core.js',
  'js/i18n.js'
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return res; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then((h) => h || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
