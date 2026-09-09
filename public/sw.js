// Maydan platform cache.
//
// Two caches, because the two halves age differently. The app shell is one
// document plus its icons: small, precached on install, replaced wholesale on
// every release. Pack media is large, arrives over time, and must survive an
// app update — re-downloading a hundred megabytes because the code changed
// would be indefensible on a phone plan. So media lives in its own cache that
// activation never clears, filled on demand as packs are played and on request
// when a player asks to have a pack ready offline.
//
// CACHE is stamped by the build (version + a hash of index.html), so any change
// to the document produces a new cache name and installed players get it on
// their next launch; a frozen literal here once kept them on an old build.
const CACHE = 'maydan-platform-__BUILD_ID__';
const MEDIA_CACHE = 'maydan-media-v1';
const MEDIA_PATH = /\/media\//;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
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
        const stale = keys.filter((k) => k !== CACHE && k !== MEDIA_CACHE);
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

  // الوسائط: من المخزن أولًا فهي لا تتغيّر، وما يُجلب يُخزَّن للمرة القادمة.
  if (MEDIA_PATH.test(new URL(request.url).pathname)) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then((cache) => cache.match(request).then((hit) => hit || fetch(request).then((response) => {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      })))
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

// «نزّل الحزمة» من الصفحة: تُخزَّن الملفات دفعة واحدة مع تقرير تقدّم، فيستطيع
// اللاعب تجهيز الجولة قبل سفر أو مكان بلا تغطية.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'cache-media' || !Array.isArray(data.urls)) return;
  const port = event.ports && event.ports[0];
  const urls = [...new Set(data.urls)];
  const post = (message) => { if (port) port.postMessage(message); };
  event.waitUntil(
    caches.open(MEDIA_CACHE).then(async (cache) => {
      let ok = 0;
      let done = 0;
      for (const url of urls) {
        try {
          const hit = await cache.match(url);
          if (!hit) await cache.add(url);
          ok += 1;
        } catch (error) {
          // ملف واحد يسقط لا يوقف البقية
        }
        done += 1;
        post({ type: 'progress', done, total: urls.length, ok });
      }
      post({ type: 'done', total: urls.length, ok, failed: urls.length - ok });
    })
  );
});
