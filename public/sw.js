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
// These small game assets replace formerly embedded drawings. Every picture is
// installed before activation, so a new offline game can draw an unseen card.
// The build inserts versioned local URLs after verifying every file exists.
const FABRAKA_IMAGES = /*__FABRAKA_IMAGES__*/[];
// The brand art and the two fonts used to be data: URLs inside the document. They
// are now content-hashed files (assets/brand/<name>-<hash>.ext) the first frame
// needs, so they are required for activation exactly like the document itself.
const BRAND_ASSETS = /*__BRAND_ASSETS__*/[];

// './' and './index.html' are the same 6.9 MB document. Precaching both fetched
// it twice on install (on top of the page's own load) and stored it twice, and
// the './' copy was never read back: the navigation handler below looks up
// './index.html'. One entry, one download, one copy.
const ASSETS = [
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  // The sound cues (~340 KB together) travel with the shell so the first gesture can
  // play offline. The build injects their content-hashed file names from
  // src/shared/fx/sample-bank.js, so a changed cue is a new URL, never a stale hit.
  // Music is not precached: it is fetched on first play.
  ...(/*__AUDIO_CUES__*/[])
];

// Static hosts may redirect index.html to the directory URL. Navigation
// requests use redirect:manual, which cannot receive a Response that already
// followed a redirect. A fresh Response keeps the document/headers without its
// redirect URL list. clone() alone retains that list and makes reload fail.
function navigationResponse(response) {
  if (!response || !response.redirected) return response;
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers: response.headers
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Never replace a working offline release unless the new document exists.
      .then(async (cache) => {
        const document = await fetch('./index.html');
        if (!document.ok) throw new Error('Offline document unavailable');
        await cache.put('./index.html', navigationResponse(document));
        const images = await caches.open(MEDIA_CACHE);
        // These remain required for offline activation, but a cold installation
        // must not launch all 32 images alongside an active game's connection.
        let imageIndex = 0;
        await Promise.all(Array.from({ length: Math.min(3, FABRAKA_IMAGES.length) }, async () => {
          while (imageIndex < FABRAKA_IMAGES.length) {
            const url = FABRAKA_IMAGES[imageIndex++];
            const cached = await images.match(url);
            if (cached && /^image\//i.test(cached.headers.get('content-type') || '')) continue;
            const response = await fetch(url, { priority: 'low' });
            if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) throw new Error('Fabraka image unavailable');
            await images.put(url, response);
          }
        }));
        // A hashed name never changes content: a copy kept by the previous release is
        // reused instead of downloading the same art again with every update.
        await Promise.all(BRAND_ASSETS.map(async (url) => {
          const kept = await caches.match(url);
          if (kept && kept.ok) { await cache.put(url, kept); return; }
          const response = await fetch(url);
          if (!response.ok) throw new Error('Brand asset unavailable');
          await cache.put(url, response);
        }));
        await Promise.all(ASSETS.slice(1).map((url) => cache.add(url).catch(() => {})));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        const stale = keys.filter((k) => k.startsWith('maydan-platform-') && k !== CACHE);
        return Promise.all(stale.map((k) => caches.delete(k))).then(() => stale.length > 0);
      })
      .then((wasUpgrade) => self.clients.claim().then(() => wasUpgrade))
      .then((wasUpgrade) => {
        // Never navigate an open game: doing so loses unsaved turns and timers.
        // The next normal launch uses the new cached document.
        if (!wasUpgrade) return undefined;
        return self.clients.matchAll({ type: 'window' }).then((clients) => {
          for (const client of clients) {
            client.postMessage({ type: 'maydan-update-ready' });
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
  // Room endpoints must stay live even when the game and API share a host.
  const pathname = new URL(request.url).pathname;
  if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/health') return;
  // Paddle's default payment page must stay live and must never replace the
  // cached game document. Workers assets may redirect pay.html to /pay.
  if (pathname === '/pay' || pathname === '/pay/' || pathname === '/pay.html') return;
  // Public commerce documents must never be served as (or overwrite) the game.
  // Keep policies and prices live, including their stylesheet and HTML aliases.
  if (/^\/(?:pricing|refunds)(?:\/|\.html)?$/.test(pathname)
      || /^\/(?:pricing|refunds)\/index\.html$/.test(pathname)
      || pathname === '/commerce.css') return;
  // The Worker redirects /studio to the owner-only editor under /api/studio/. Answering
  // that navigation with the cached game document opened the game instead.
  if (pathname === '/studio' || pathname.startsWith('/studio/')) return;

  // The document and its hashed dependencies form one installed release. Never
  // refresh only its HTML: a newer worker may fail to install a required font
  // or image, leaving that new document unusable offline. The installer is the
  // only release writer; activation replaces this cache after dependencies pass.
  // Scope the lookup to this worker too, not a partially staged newer cache.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        let cached = await cache.match('./index.html');
        // Repair a shell saved by an older worker too. A worker-only update can
        // retain the same document hash/cache name, and recovery must work offline.
        if (cached && cached.redirected) {
          cached = navigationResponse(cached);
          const copy = cached.clone();
          event.waitUntil(cache.put('./index.html', copy).catch(() => {}));
        }
        if (cached) return cached;
        // Storage eviction can remove a working shell. Permit network recovery
        // without stamping an unverified newer document into this release cache.
        return navigationResponse(await fetch(request));
      })
    );
    return;
  }

  // الوسائط: من المخزن أولًا فهي لا تتغيّر، وما يُجلب يُخزَّن للمرة القادمة.
  if (MEDIA_PATH.test(new URL(request.url).pathname)) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const url = new URL(request.url);
        const retry = /\/media\/fabraka-v3\/fab3-\d{3}\.webp$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('fabRetry') || '');
        if (retry) url.searchParams.delete('fabRetry');
        const cacheKey = retry ? url.href : request;
        const hit = await cache.match(cacheKey);
        if (!retry && hit && !/text\/html/i.test(hit.headers.get('content-type') || '')) return rangedResponse(request, hit);
        if (hit && /text\/html/i.test(hit.headers.get('content-type') || '')) await cache.delete(cacheKey); // Repair an older fallback.
        const response = await fetch(request);
        if (response && response.status === 200 && !/text\/html/i.test(response.headers.get('content-type') || '')) event.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
        return response;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {}));
      }
      return response;
    }))
  );
});

// Safari requests byte ranges for audio/video, including when fully cached offline.
async function rangedResponse(request, response) {
  const range = request.headers.get('range');
  if (!range || response.status !== 200) return response;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2])) return response;
  const body = await response.blob();
  const size = body.size;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.delete('Content-Encoding');
  if (start > end || start >= size) {
    headers.set('Content-Range', `bytes */${size}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}

// «نزّل الحزمة» من الصفحة: تُخزَّن الملفات دفعة واحدة مع تقرير تقدّم، فيستطيع
// اللاعب تجهيز الجولة قبل سفر أو مكان بلا تغطية.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'prune-media' && Array.isArray(data.urls)) { pruneMedia(event, data.urls); return; }
  if (data.type !== 'cache-media' || !Array.isArray(data.urls)) return;
  const port = event.ports && event.ports[0];
  const urls = [...new Set(data.urls)];
  const mediaBase = new URL('./media/', self.location.href);
  const post = (message) => { if (port) port.postMessage(message); };
  event.waitUntil(
    caches.open(MEDIA_CACHE).then(async (cache) => {
      let ok = 0;
      let done = 0;
      let index = 0;
      async function download() {
      while (index < urls.length) {
        const url = urls[index++];
        try {
          const address = new URL(url, self.location.href);
          if (address.origin !== mediaBase.origin || !address.pathname.startsWith(mediaBase.pathname)) throw new Error('Not local media');
          let hit = await cache.match(address.href);
          if (hit && /text\/html/i.test(hit.headers.get('content-type') || '')) {
            await cache.delete(address.href);
            hit = null;
          }
          if (!hit) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20000);
            try {
              const response = await fetch(address.href, { signal: controller.signal });
              if (!response.ok || response.status !== 200 || /text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('Missing media');
              await cache.put(address.href, response);
            } finally { clearTimeout(timer); }
          }
          ok += 1;
        } catch (error) {
          // ملف واحد يسقط لا يوقف البقية
        }
        done += 1;
        post({ type: 'progress', done, total: urls.length, ok });
      }
      }
      await Promise.all(Array.from({ length: Math.min(4, urls.length) }, download));
      post({ type: 'done', total: urls.length, ok, failed: urls.length - ok });
    }).catch(() => post({ type: 'done', total: urls.length, ok: 0, failed: urls.length }))
  );
});

// Media URLs carry a per-file version (?v=). The page sends the list it currently
// uses after its startup preload; anything cached under /media/ with another
// version, or for a file no active question references, is deleted. Without this
// the media cache grew by a full copy at every content correction and browsers
// eventually evicted the whole origin under storage pressure.
function pruneMedia(event, urls) {
  const mediaBase = new URL('./media/', self.location.href);
  const current = new Map();
  for (const url of urls) {
    try {
      const address = new URL(url, self.location.href);
      if (address.origin !== mediaBase.origin || !address.pathname.startsWith(mediaBase.pathname)) continue;
      if (!current.has(address.pathname)) current.set(address.pathname, new Set());
      current.get(address.pathname).add(address.searchParams.get('v') || '');
    } catch (error) { /* not a URL */ }
  }
  if (!current.size) return;
  event.waitUntil(
    caches.open(MEDIA_CACHE).then(async (cache) => {
      let removed = 0;
      for (const request of await cache.keys()) {
        const address = new URL(request.url);
        if (!address.pathname.startsWith(mediaBase.pathname)) continue;
        const versions = current.get(address.pathname);
        if (versions && versions.has(address.searchParams.get('v') || '')) continue;
        if (await cache.delete(request)) removed += 1;
      }
      const port = event.ports && event.ports[0];
      if (port) port.postMessage({ type: 'pruned', removed });
    }).catch(() => {})
  );
}
