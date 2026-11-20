import { parsePack } from './pack-format.js';

const selector = 'meta[name="maydan-game-pack"]';
export const hasWebPack = () => Boolean(document.querySelector(selector));
const failure = (code, message) => Object.assign(new Error(message), { code });
const abortError = () => new DOMException('Cancelled', 'AbortError');
const checkSignal = signal => { if (signal?.aborted) throw abortError(); };
const hex = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');

async function body(response) {
  if (!response || response.status !== 200) return null;
  try { return new Uint8Array(await response.arrayBuffer()); } catch { return null; }
}
async function matches(bytes, item) {
  return bytes && bytes.byteLength === item.bytes &&
    hex(await crypto.subtle.digest('SHA-256', bytes)) === item.sha256;
}
const chunkKey = (base, chunk) => new URL('game-pack/chunks/' + chunk.sha256, base).href;

// Only a cold or damaged chunk needs individual files. Migrate already
// installed shell/media resources and reuse matching slices of older releases.
async function existingSources(base, pack, index, current) {
  const resources = new Map();
  for (const name of await caches.keys()) {
    if (name !== 'maydan-media-v1' && !name.startsWith('maydan-platform-')) continue;
    const cache = await caches.open(name);
    for (const key of await cache.keys()) resources.set(key.url, cache);
  }
  const previous = new Map(), blobs = new Map();
  for (const key of await index.keys()) {
    if (key.url === current || !/\/game-pack\/[a-f\d]{64}\.json$/.test(key.url)) continue;
    const old = await (await index.match(key)).json().catch(() => null);
    for (const chunk of old?.chunks || []) {
      let offset = 0;
      for (const item of old.files.slice(chunk.first, chunk.first + chunk.count)) {
        previous.set(item.sha256, { key: chunkKey(base, chunk), offset });
        offset += item.bytes;
      }
    }
  }
  return async (item, url, versioned) => {
    const slice = previous.get(item.sha256);
    if (slice) {
      if (!blobs.has(slice.key)) {
        if (blobs.size >= 4) blobs.delete(blobs.keys().next().value);
        blobs.set(slice.key, pack.match(slice.key).then(r => r?.blob()));
      }
      const blob = await blobs.get(slice.key);
      if (blob) {
        const bytes = new Uint8Array(await blob.slice(slice.offset, slice.offset + item.bytes).arrayBuffer());
        if (await matches(bytes, item)) return bytes;
      }
    }
    const key = resources.has(versioned) ? versioned : url;
    if (!resources.has(key)) return null;
    const bytes = await body(await resources.get(key).match(key, {ignoreVary:true}));
    return await matches(bytes, item) ? bytes : null;
  };
}

async function readNetwork(url, signal, consume, allowMissing = false) {
  checkSignal(signal);
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, 120000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store',
      redirect: new URL(url).pathname.endsWith('/index.html') ? 'follow' : 'error',
      headers: { 'X-Maydan-Pack-Read': '1' } });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok || new URL(response.url).origin !== new URL(url).origin) throw failure('network', 'Game resource unavailable');
    return await consume(response);
  } catch (error) {
    checkSignal(signal);
    throw error.code && typeof error.code === 'string' ? error : failure('network', 'Could not read game resource');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

// A successful download alone cannot make a cold installation playable
// offline. Wait for a controlling worker that understands this exact client.
async function connectWorker(base, manifest, signal) {
  const sw = navigator.serviceWorker;
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    let registration;
    let candidate;
    let settled = false;
    let retryTimer;
    let retryDelay = 1000;
    const ports = new Set();
    const done = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(retryTimer);
      for (const port of ports) port.close();
      sw.removeEventListener('controllerchange', contact);
      registration?.removeEventListener('updatefound', examine);
      candidate?.removeEventListener('statechange', examine);
      signal.removeEventListener('abort', cancel);
      error ? reject(error) : resolve();
    };
    const cancel = () => done(abortError());
    const contact = () => {
      if (settled) return;
      clearTimeout(retryTimer);
      const worker = sw.controller;
      try {
        if (worker) {
          const channel = new MessageChannel();
          ports.add(channel.port1);
          channel.port1.onmessage = event => {
            if (sw.controller === worker && event.data === manifest) done();
          };
          worker.postMessage({ type: 'maydan-pack-client', manifest }, [channel.port2]);
        } else if (registration?.active) {
          registration.active.postMessage({ type: 'maydan-pack-claim' });
        }
      } catch {
        // A worker can become redundant between reading controller and posting.
      }
      retryTimer = setTimeout(contact, retryDelay);
      retryDelay = Math.min(5000, retryDelay * 2);
    };
    const examine = () => {
      const current = registration.installing || registration.waiting;
      if (current && candidate !== current) {
        candidate?.removeEventListener('statechange', examine);
        candidate = current;
        candidate.addEventListener('statechange', examine);
      }
      if (candidate?.state === 'redundant' && !registration.active) done(failure('network', 'Offline game installation failed'));
    };
    const timer = setTimeout(() => done(failure('network', 'Offline game worker unavailable')), 120000);
    signal.addEventListener('abort', cancel, { once: true });
    sw.addEventListener('controllerchange', contact);
    // Reopened tabs can already have a controller while registration is waiting
    // for an update check. Only a reply from our current controller unlocks verification.
    sw.register(new URL('sw.js', base), { scope: base.href }).then(result => {
      if (settled) return;
      registration = result;
      registration.addEventListener('updatefound', examine);
      examine();
      if (!sw.controller) contact();
    }).catch(() => { if (!sw.controller) done(failure('network', 'Offline game registration failed')); });
    contact();
  });
}

export async function prepareWebPack({ onProgress = () => {}, signal } = {}) {
  checkSignal(signal);
  const ref = document.querySelector(selector)?.content || '';
  const id = /^\.\/game-pack\/([a-f\d]{64})\.json$/.exec(ref)?.[1];
  if (!id) throw failure('integrity', 'Invalid game pack reference');
  if (!globalThis.isSecureContext || !globalThis.caches || !globalThis.crypto?.subtle || !navigator.serviceWorker)
    throw failure('unsupported', 'Offline game storage unavailable');
  const base = new URL('./', document.baseURI);
  const manifest = new URL(ref, base).href;
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const active = controller.signal;
  let completedFiles = 0, completedBytes = 0, cachedBytes = 0, totalFiles = 0, totalBytes = 0;
  const notify = phase => onProgress({ phase, completedFiles, completedBytes, cachedBytes, totalFiles, totalBytes });
  notify('checking');
  try {
    const pack = await caches.open('maydan-game-files:' + base.href);
    const index = await caches.open('maydan-game-index:' + base.href);
    const readManifest = async response => {
      try { return parsePack(await response.json(), id); }
      catch { throw failure('integrity', 'Invalid game inventory'); }
    };
    const saved = await index.match(manifest);
    let data;
    if (saved) {
      try { data = await readManifest(saved); } catch { /* Repair the metadata online. */ }
    }
    if (!data) {
      data = await readNetwork(manifest, active, readManifest);
      await index.put(manifest, new Response(JSON.stringify(data), { headers: {
        'content-type': 'application/json', 'x-maydan-saved-at': String(Date.now()) } }));
    }
    ({ totalBytes, totalFiles } = data);
    notify('checking');
    // Let the established installer stage its required shell first. Reuse that
    // cache and media downloaded by an older version after checking their hash.
    await connectWorker(base, ref, active);
    const present = new Set((await pack.keys()).map(request => request.url));
    const hasOlderRelease = (await index.keys()).some(key =>
      key.url !== manifest && /\/game-pack\/[a-f\d]{64}\.json$/.test(key.url));
    const downloadPublishedChunks = data.transport === 'chunks-v1' && !hasOlderRelease;
    let cursor = 0, sources;
    async function repair(chunk, key, savedBytes) {
      const partial = key + '?partial';
      if (present.has(partial)) {
        const pending = await body(await pack.match(partial));
        if (pending && (!savedBytes || pending.length > savedBytes.length)) savedBytes = pending;
      }
      const output = new Uint8Array(chunk.bytes);
      let offset = 0, reused = 0;
      try {
        for (let n = 0; n < chunk.count; n++) {
          checkSignal(active);
          const item = data.files[chunk.first + n];
          const url = new URL(item.file, base).href;
          const versioned = url + '?v=' + item.sha256.slice(0, 6);
          let bytes = savedBytes?.subarray(offset, offset + item.bytes);
          if (!await matches(bytes, item)) {
            if (!sources) sources = existingSources(base, pack, index, manifest);
            bytes = await (await sources)(item, url, versioned);
          }
          if (bytes) reused += item.bytes;
          else {
            bytes = await readNetwork(item.file.startsWith('media/') ? versioned : url, active, body);
            if (!await matches(bytes, item)) throw failure('integrity', 'Game resource differs from this release: ' + item.file);
          }
          output.set(bytes, offset);
          offset += item.bytes;
        }
        if (!await matches(output, chunk)) throw failure('integrity', 'Incomplete game chunk');
        checkSignal(active);
        await pack.put(key, new Response(output));
        if (present.has(partial)) await pack.delete(partial);
        return reused;
      } catch (error) {
        // Preserve the verified prefix on interruption, without overwriting a
        // complete copy another tab may have installed concurrently.
        if (offset && offset < chunk.bytes) {
          await pack.put(partial, new Response(output.subarray(0, offset))).catch(() => {});
        }
        throw error;
      }
    }
    async function download() {
      while (cursor < data.chunks.length) {
        checkSignal(active);
        const chunk = data.chunks[cursor++];
        const key = chunkKey(base, chunk);
        const bytes = present.has(key) ? await body(await pack.match(key)) : null;
        let reused = chunk.bytes;
        if (!await matches(bytes, chunk)) {
          // A fresh install can transfer the exact bytes as one response.
          // Updates, interruptions in the per-file path, and damaged cached
          // groups still preserve or repair individual verified resources.
          const first = data.files[chunk.first].file;
          const published = downloadPublishedChunks && !bytes && !present.has(key + '?partial') &&
            first !== 'index.html' && first !== 'sw.js'
            ? await readNetwork(new URL('game-pack/download/' + chunk.sha256 + '.bin', base).href, active, body, true)
            : null;
          if (published) {
            if (!await matches(published, chunk)) throw failure('integrity', 'Published game chunk differs from this release');
            checkSignal(active);
            await pack.put(key, new Response(published));
            reused = 0;
          } else {
            reused = await repair(chunk, key, bytes);
          }
        }
        cachedBytes += reused;
        checkSignal(active);
        completedBytes += chunk.bytes;
        completedFiles += chunk.count;
        notify('loading');
      }
    }
    const workers = Array.from({ length: Math.min(6, data.chunks.length) }, download);
    try { await Promise.all(workers); }
    catch (error) { stop(); await Promise.allSettled(workers); throw error; }
    checkSignal(active);
    navigator.serviceWorker.controller?.postMessage({type: 'maydan-pack-ready', manifest: ref});
    notify('ready');
    return { completedBytes, completedFiles, cachedBytes, totalBytes, totalFiles };
  } catch (error) {
    checkSignal(signal);
    if (error.code && typeof error.code === 'string') throw error;
    throw failure(error.name === 'QuotaExceededError' || error.name === 'SecurityError' ? 'storage' : 'network', error.message);
  } finally {
    stop();
    signal?.removeEventListener('abort', stop);
  }
}
