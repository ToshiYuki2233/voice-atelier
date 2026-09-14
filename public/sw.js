const CACHE_PREFIX = 'voice-atelier-';
const CACHE_NAME = CACHE_PREFIX + 'v9';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './analysis.js', './spectrum.js', './expression-model.js',
  './audio-session.js', './manifest.webmanifest', './icons/icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];
const assetURLs = ASSETS.map(path => new URL(path, self.registration.scope).href);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(assetURLs.map(url => new Request(url, { cache: 'reload' })));
    // Updates wait until all old app windows close; never mix app versions mid-session.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !assetURLs.includes(request.url)) {
    event.respondWith(Promise.resolve(new Response('Not available', { status: 403 })));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone());
      return response;
    } catch {
      return new Response('Offline asset unavailable. Reconnect and reload.', { status: 503 });
    }
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_OFFLINE' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const entries = await Promise.all(assetURLs.map(url => cache.match(url)));
    event.ports[0].postMessage({ ready: entries.every(response => response?.ok), version: CACHE_NAME });
  })());
});
