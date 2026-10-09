// Service worker: keeps a copy of the app on the device so it opens with no internet.
// Your card data is NOT stored here. It lives in the app's local storage and in Supabase.
// Bump VERSION whenever you change any file below, so devices pick up the new version.
const VERSION = 'cw-v4';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/calc.js',
  'js/config.js',
  'vendor/supabase.js',
  'fonts/archivo-variable.woff2',
  'manifest.webmanifest',
  'icons/mark.png',
  'icons/mark-dark.png',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'icons/favicon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App files: try the network first (so updates show up). If the network fails, or takes more than
// 3 seconds (weak signal at a show), use the saved copy. Supabase requests are left alone.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const cached = () => caches.match(e.request, { ignoreSearch: true })
    .then(hit => hit || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined));
  // 'no-cache' asks GitHub Pages for the latest file instead of a copy the browser saved earlier
  const network = fetch(e.request, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  });
  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => cached().then(finish), 3000);
    network
      .then(res => { clearTimeout(timer); finish(res); })
      .catch(() => { clearTimeout(timer); cached().then(r => r ? finish(r) : finish(Response.error())); });
  }));
});
