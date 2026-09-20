// ============================================================
// Offline cache.
//
// The wasm runtime is about 650 KB and the database another
// 210 KB: slow once over mobile data, then never fetched again.
// Everything the app needs is precached on install, so a cold
// start out of signal range works the same as a warm one.
//
// Bump CACHE whenever data/rdr2.db is rebuilt or the app code
// changes; the old cache is dropped on activate.
// ============================================================

const CACHE = 'rdr2-crafting-v1';

const SHELL = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'icon.svg',
  'vendor/sql-wasm.js',
  'vendor/sql-wasm.wasm',
  'data/rdr2.db',
  'database/personal_schema.sql',
  'js/main.js',
  'js/db.js',
  'js/store.js',
  'js/queries.js',
  'js/render.js',
  'js/toast.js',
  'js/views/materials.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();

    // Tell the page it can be closed and reopened without a network.
    for (const client of await self.clients.matchAll()) {
      client.postMessage({ type: 'offline-ready' });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      (await caches.open(CACHE)).put(request, response.clone());
    }
    return response;
  })());
});
