const CACHE = 'gorogoro-shogi-v2';
const CACHE_PREFIX = 'gorogoro-shogi-';
const FILES = [
  './', './index.html',
  './base.css', './base.css?v=2', './design.css', './design.css?v=2',
  './app.js', './app.js?v=2', './engine.js', './ai.js', './ai-worker.js',
  './session.js', './notation.js', './record-export.js', './record-import.js',
  './rules-pages.js', './manifest.webmanifest',
  './assets/lion.svg', './assets/dog.svg', './assets/cat.svg',
  './assets/chick.svg', './assets/hen.svg', './assets/super-cat.svg',
  './assets/board-scene.svg', './assets/icon.svg',
  './assets/icon-192.png', './assets/icon-512.png'
];
const URLS = FILES.map(path => new URL(path, self.registration.scope).href);
const INDEX_URL = new URL('./index.html', self.registration.scope).href;

function validResponse(response, url) {
  if (!response?.ok || response.redirected) return false;
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const path = new URL(url).pathname;
  if (path.endsWith('.js')) return /^(text|application)\/(javascript|ecmascript)$/.test(type);
  if (path.endsWith('.css')) return type === 'text/css';
  if (path.endsWith('.svg')) return type === 'image/svg+xml';
  if (path.endsWith('.png')) return type === 'image/png';
  if (path.endsWith('.webmanifest')) return ['application/manifest+json', 'application/json', 'text/json'].includes(type);
  return type === 'text/html';
}

async function precache() {
  // Validate the entire release before writing any of it. A hosting error page
  // with status 200 must never become an offline script or image.
  const responses = await Promise.all(URLS.map(async url => {
    const response = await fetch(new Request(url, { cache: 'reload' }));
    if (!validResponse(response, url)) throw new Error('Invalid offline file: ' + url);
    return response;
  }));
  const cache = await caches.open(CACHE);
  const writes = await Promise.allSettled(URLS.map((url, index) => cache.put(url, responses[index])));
  if (writes.some(result => result.status === 'rejected')) {
    // Wait for every write before deleting, so failed installs leave no partial
    // release behind and can be retried. Other versions remain available.
    await caches.delete(CACHE);
    throw new Error('Could not store complete offline release');
  }
  await self.skipWaiting();
}

self.addEventListener('install', event => event.waitUntil(precache()));

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (validResponse(response, INDEX_URL)) return response;
        return (await cache.match(INDEX_URL)) || response;
      } catch {
        return (await cache.match(INDEX_URL)) || Response.error();
      }
    })());
    return;
  }
  if (URLS.includes(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(request)) || fetch(request);
    })());
  }
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_STATUS') return;
  event.waitUntil((async () => {
    let ready = false;
    try {
      const cache = await caches.open(CACHE);
      const entries = await Promise.all(URLS.map(url => cache.match(url)));
      ready = entries.every((response, index) => validResponse(response, URLS[index]));
    } catch { /* An unavailable cache is not offline-ready. */ }
    event.ports[0]?.postMessage({ type: 'CACHE_STATUS', ready, version: CACHE });
  })());
});
