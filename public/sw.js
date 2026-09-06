// Maydan platform offline cache.
//
// The game is a single self-contained document — no API, no external asset — so
// "works offline" reduces to holding that one file plus its icons. Everything is
// precached on install; the network is only ever consulted to find a newer copy.
//
// Bump CACHE when index.html changes, or installed players keep the old build.
const CACHE = 'maydan-platform-1.0.0';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Individually, so one missing icon cannot fail the whole install and
      // leave the game with no offline copy at all.
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        const stale = keys.filter((k) => k !== CACHE);
        return Promise.all(stale.map((k) => caches.delete(k))).then(() => stale.length > 0);
      })
      .then((wasUpgrade) => self.clients.claim().then(() => wasUpgrade))
      .then((wasUpgrade) => {
        // An upgrade means the open page was served from the previous version's
        // cache before this worker took over, so it is showing the old release.
        // The page cannot fix that itself — the code that would is in the new
        // document it has not received — so the worker reloads it from here.
        // Only on an upgrade: on a first install nothing on screen is stale.
        if (!wasUpgrade) return undefined;
        return self.clients.matchAll({ type: 'window' }).then((clients) => {
          for (const client of clients) {
            if (typeof client.navigate === 'function') client.navigate(client.url).catch(() => {});
          }
        });
      })
      .catch(() => {})
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigations: serve the cached document immediately (a launch from the home
  // screen must not wait on the network, or on there being one), then refresh
  // the copy in the background for the next launch.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const fresh = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
