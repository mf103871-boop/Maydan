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
const GAME_PACK = /*__GAME_PACK__*/null;

// Each open tab keeps its release across a worker update. The binding is
// durable because mobile browsers routinely stop an idle service worker.
const clientPacks = new Map();
const inventories = new Map();
const chunkBlobs = new Map();
const scopeUrl = () => self.registration.scope;
const packCache = () => caches.open('maydan-game-files:' + scopeUrl());
const packIndex = () => caches.open('maydan-game-index:' + scopeUrl());
const bindingKey = id => new URL('./game-pack/client/' + encodeURIComponent(id), scopeUrl()).href;
const manifestPath = path => /^\.\/game-pack\/[a-f\d]{64}\.json$/.test(path);
const chunkAddress = digest => new URL('game-pack/chunks/' + digest, scopeUrl()).href;
const packTypes = { css:'text/css', js:'text/javascript', json:'application/json', webmanifest:'application/manifest+json',
  woff:'font/woff', woff2:'font/woff2', svg:'image/svg+xml', jpg:'image/jpeg', jpeg:'image/jpeg',
  webp:'image/webp', png:'image/png', gif:'image/gif', avif:'image/avif', ico:'image/x-icon',
  m4a:'audio/mp4', wav:'audio/wav', mp3:'audio/mpeg', ogg:'audio/ogg', mp4:'video/mp4', webm:'video/webm' };

async function packedResponse(request, clientId) {
  const cache = await packCache();
  let manifest = clientPacks.get(clientId);
  if (!manifest && clientId) {
    const binding = await (await packIndex()).match(bindingKey(clientId));
    manifest = binding && await binding.text();
    if (manifestPath(manifest)) clientPacks.set(clientId, manifest);
  }
  if (!manifestPath(manifest)) manifest = GAME_PACK;
  let files = inventories.get(manifest);
  if (!files) {
    const response = await (await packIndex()).match(new URL(manifest, scopeUrl()).href);
    if (!response) return undefined;
    const data = await response.json();
    if (data.id !== manifest.slice(12, -5) || !Array.isArray(data.files)) return undefined;
    files = new Map();
    if (data.chunks) {
      for (const chunk of data.chunks) {
        let offset = 0;
        for (const item of data.files.slice(chunk.first, chunk.first + chunk.count)) {
          files.set(new URL(item.file, scopeUrl()).pathname, {...item, offset, key:chunkAddress(chunk.sha256)});
          offset += item.bytes;
        }
      }
    } else {
      for (const item of data.files) files.set(new URL(item.file, scopeUrl()).pathname, item);
    }
    inventories.set(manifest, files);
  }
  const url = new URL(request.url);
  const entry = files.get(url.pathname);
  const digest = entry?.sha256;
  if (!digest || !/^[a-f\d]{64}$/.test(digest)) return undefined;
  // Preserve explicit version/retry semantics, and leave arbitrary query
  // parameters to the original fetch handler.
  let retry = false;
  for (const [key, value] of url.searchParams) {
    if (key === 'fabRetry' && /\/media\/fabraka-v3\/fab3-\d{3}\.webp$/.test(url.pathname) && /^\d+$/.test(value)) { retry = true; continue; }
    if (key !== 'v' || value !== digest.slice(0, 6)) return undefined;
  }
  if (retry) return null;
  if (entry.key) {
    if (!chunkBlobs.has(entry.key)) {
      // Keep a handful of adjacent slices available without rereading a whole
      // chunk for every image. This memory belongs only to the running worker.
      if (chunkBlobs.size >= 4) chunkBlobs.delete(chunkBlobs.keys().next().value);
      chunkBlobs.set(entry.key, cache.match(entry.key).then(r => r?.blob()));
    }
    const blob = await chunkBlobs.get(entry.key);
    if (!blob) { chunkBlobs.delete(entry.key); return null; }
    const type = packTypes[entry.file.split('.').pop().toLowerCase()] || 'application/octet-stream';
    const piece = blob.slice(entry.offset, entry.offset + entry.bytes, type);
    return rangedResponse(request, new Response(piece, { headers:{
      'content-type':type, 'content-length':String(piece.size), 'accept-ranges':'bytes' } }));
  }
  url.search = '?maydanSha=' + digest;
  const hit = await cache.match(url.href);
  return hit ? rangedResponse(request, hit) : null;
}

async function pruneRetiredPacks() {
  const index = await packIndex();
  const live = new Set((await self.clients.matchAll({type:'window', includeUncontrolled:true})).map(client => client.id));
  const keep = new Set([new URL(GAME_PACK, scopeUrl()).href]);
  const manifests = [];
  for (const request of await index.keys()) {
    const file = './' + request.url.slice(scopeUrl().length);
    if (manifestPath(file)) manifests.push(request);
    else if (file.startsWith('./game-pack/client/')) {
      const client = decodeURIComponent(file.slice('./game-pack/client/'.length));
      if (live.has(client)) {
        const manifest = await (await index.match(request)).text();
        if (manifestPath(manifest)) keep.add(new URL(manifest, scopeUrl()).href);
      } else {
        clientPacks.delete(client);
        await index.delete(request);
      }
    }
  }
  if (manifests.every(request => keep.has(request.url))) return;
  const keptKeys = new Set(), retiredKeys = new Set(), retired = [];
  for (const request of manifests) {
    const response = await index.match(request);
    if (!response) continue;
    // Another tab can be between writing its inventory and binding its client.
    const recent = Number(response.headers.get('x-maydan-saved-at')) > Date.now() - 86400000;
    const keys = keep.has(request.url) || recent ? keptKeys : retiredKeys;
    if (keys === retiredKeys) retired.push(request);
    const data = await response.json();
    if (data.chunks) {
      for (const chunk of data.chunks) {
        keys.add(chunkAddress(chunk.sha256));
        keys.add(chunkAddress(chunk.sha256) + '?partial');
      }
    } else {
      for (const item of data.files) keys.add(new URL(item.file, scopeUrl()).href + '?maydanSha=' + item.sha256);
    }
  }
  if (!retired.length) return;
  const cache = await packCache();
  for (const key of retiredKeys) if (!keptKeys.has(key)) await cache.delete(key);
  for (const request of retired) {
    inventories.delete('./' + request.url.slice(scopeUrl().length));
    await index.delete(request);
  }
}
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
  './opening/studio.css',
  './opening/maydan-bulb.webp',
  // Small, versioned entry artwork is part of the offline shell, not pack media.
  './media/game-entry/match-ticket-v1.webp',
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
        if (GAME_PACK && !(await document.clone().text()).includes('content="' + GAME_PACK + '"'))
          throw new Error('Offline release changed during installation');
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
  const absolutePath = new URL(request.url).pathname;
  const scope = self.registration?.scope && new URL(self.registration.scope).pathname;
  const pathname = scope && absolutePath.startsWith(scope) ? '/' + absolutePath.slice(scope.length) : absolutePath;
  if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/health') return;
  // Paddle's default payment page must stay live and must never replace the
  // cached game document. Workers assets may redirect pay.html to /pay.
  if (pathname === '/pay' || pathname === '/pay/' || pathname === '/pay.html') return;
  // Public commerce documents must never be served as (or overwrite) the game.
  // Keep policies and prices live, including their stylesheet and HTML aliases.
  if (/^\/(?:pricing|refunds)(?:\/|\.html)?$/.test(pathname)
      || /^\/(?:pricing|refunds)\/index\.html$/.test(pathname)
      || pathname === '/pricing/policy.js' || pathname === '/commerce.css') return;
  // The Worker redirects /studio to the owner-only editor under /api/studio/. Answering
  // that navigation with the cached game document opened the game instead.
  if (pathname === '/studio' || pathname.startsWith('/studio/')) return;
  if (GAME_PACK && (request.headers?.has('X-Maydan-Pack-Read') || request.headers?.has('authorization') || pathname.startsWith('/game-pack/'))) return;

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

  // Only built game resources can come from the full pack. All other routes
  // stay on the network; never persist account or arbitrary same-origin data.
  const isGameStatic = /^\/(?:opening|art|assets|audio|icons|media|screenshots)\//.test(pathname)
    || /^\/manifest(?:\.en)?\.webmanifest$/.test(pathname);
  if (GAME_PACK && !isGameStatic) return;
  const respond = fallback => event.respondWith(GAME_PACK
    ? packedResponse(request, event.clientId).catch(() => undefined).then(async hit => {
      if (hit !== undefined) return hit || fallback();
      // Unlisted paths and queries must never write into an offline cache.
      return (await (await caches.open(CACHE)).match(request)) || fetch(request);
    })
    : fallback());

  // الوسائط: من المخزن أولًا فهي لا تتغيّر، وما يُجلب يُخزَّن للمرة القادمة.
  // Optional English packs are content-hashed public assets. Cache only a
  // successful JSON response on first use; never turn a missing pack into HTML.
  if (/\/assets\/brand\/locale-en-[a-z]+-[A-Z0-9]+\.json$/i.test(pathname)) {
    respond(() => caches.open(MEDIA_CACHE).then(async cache => {
      const hit = await cache.match(request);
      if (hit && /application\/json/i.test(hit.headers.get('content-type') || '')) return hit;
      const response = await fetch(request);
      if (response.ok && /application\/json/i.test(response.headers.get('content-type') || '')) event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      return response;
    }));
    return;
  }
  if (MEDIA_PATH.test(new URL(request.url).pathname)) {
    respond(() =>
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const url = new URL(request.url);
        const retry = /\/media\/fabraka-v3\/fab3-\d{3}\.webp$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('fabRetry') || '');
        if (retry) url.searchParams.delete('fabRetry');
        const cacheKey = retry ? url.href : request;
        // Small release artwork can live under /media/ while being precached
        // with the shell. Use only this worker's release, never a staged shell.
        const shellHit = !retry && await (await caches.open(CACHE)).match(cacheKey);
        if (shellHit && !/text\/html/i.test(shellHit.headers.get('content-type') || '')) return rangedResponse(request, shellHit);
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

  respond(() =>
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
  if (GAME_PACK && data.type === 'maydan-pack-claim' && event.source?.type === 'window') {
    event.waitUntil(self.clients.claim());
    return;
  }
  if (GAME_PACK && data.type === 'maydan-pack-client' && manifestPath(data.manifest) && event.source?.id) {
    const clientId = event.source.id;
    event.waitUntil(packIndex().then(async cache => {
      if (!await cache.match(new URL(data.manifest, scopeUrl()).href)) return;
      await cache.put(bindingKey(clientId), new Response(data.manifest));
      clientPacks.set(clientId, data.manifest);
      event.ports[0]?.postMessage(data.manifest);
    }));
    return;
  }
  if (GAME_PACK && data.type === 'maydan-pack-ready' && data.manifest === GAME_PACK) {
    chunkBlobs.clear();
    event.waitUntil(pruneRetiredPacks().catch(() => {}));
    return;
  }
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
