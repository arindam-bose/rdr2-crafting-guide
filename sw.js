// ============================================================
// Offline cache.
//
// Two strategies, because the files divide cleanly in two:
//
//   The wasm runtime (650 KB) and the database (210 KB) are
//   immutable — a rebuild is a new CACHE — so they are served
//   from the cache and only fetched once.
//
//   Everything else is app code, served network-first and
//   falling back to the cache when there is no signal.  That
//   costs a conditional request on a warm start and buys you
//   edits showing up without a cache bump, which matters far
//   more while this is still being written.
// ============================================================

const CACHE = 'rdr2-crafting-v3';

// Fetched once and kept: big, and only ever replaced wholesale.
const IMMUTABLE = [
  'vendor/sql-wasm.js',
  'vendor/sql-wasm.wasm',
  'data/rdr2.db',
];

const SHELL = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'icon.svg',
  'database/personal_schema.sql',
  'js/main.js',
  'js/db.js',
  'js/store.js',
  'js/queries.js',
  'js/render.js',
  'js/toast.js',
  'js/views/materials.js',
  'js/views/inventory.js',
  'js/views/recipes.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...IMMUTABLE, ...SHELL]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();

    for (const client of await self.clients.matchAll()) {
      client.postMessage({ type: 'offline-ready' });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname.replace(/^\//, '');
  const immutable = IMMUTABLE.some((file) => path.endsWith(file));

  event.respondWith(immutable ? cacheFirst(request) : networkFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch (err) {
    // Offline.  A navigation can always fall back to the shell,
    // since routing happens in the hash.
    const cached = await caches.match(request)
      ?? (request.mode === 'navigate' ? await caches.match('index.html') : null);
    if (cached) return cached;
    throw err;
  }
}
