const CACHE = "wagewiseuk-v1.5.1-locked-stable";
const ASSETS = [
  './',
  './index.html',
  './about.html',
  './privacy.html',
  './disclaimer.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './pwa-192-v2.png',
  './pwa-512-v2.png',
  './icon-v2.png',
  './apple-touch-v2.png',
  './favicon-v2.png',
  './icon-192-maskable-v2.png',
  './icon-512-maskable-v2.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Stale-while-revalidate for same-origin GET requests:
  // - Serve cached response instantly (offline-friendly)
  // - Update cache in the background so the next load gets the latest assets
  if(event.request.method !== 'GET') return;

  const reqUrl = new URL(event.request.url);
  const sameOrigin = reqUrl.origin === self.location.origin;

  if(!sameOrigin){
    // For cross-origin, just fall back to network (don’t cache).
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);

    const fetchPromise = fetch(event.request).then((resp) => {
      // Only cache successful basic responses
      if(resp && resp.ok && resp.type === 'basic'){
        cache.put(event.request, resp.clone());
      }
      return resp;
    }).catch(() => null);

    // If we have something cached, return it immediately; otherwise wait for network.
    return cached || (await fetchPromise) || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
