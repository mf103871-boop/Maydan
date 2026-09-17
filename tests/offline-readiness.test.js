import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { preloadMedia, cacheForOffline, isLoaded, resetMediaState } from '../src/shared/media/preload.js';

async function worker({ entries = {}, fetcher = async () => new Response('asset'), failDocument = false } = {}) {
  const listeners = new Map();
  const cachesByName = new Map(Object.entries(entries));
  const deleted = [];
  let skipped = false;
  let navigated = false;
  const key = (value) => typeof value === 'string' ? value : value.url;
  const makeCache = (map = new Map()) => ({
    async add(url) { if (failDocument && url === './index.html') throw new Error('offline'); map.set(key(url), new Response('asset')); },
    async put(url, response) { map.set(key(url), response.clone()); },
    async match(url) { return map.get(key(url))?.clone(); },
    async delete(url) { return map.delete(key(url)); },
  });
  const caches = {
    async open(name) { if (!cachesByName.has(name)) cachesByName.set(name, makeCache()); return cachesByName.get(name); },
    async keys() { return [...cachesByName.keys()]; },
    async delete(name) { deleted.push(name); return cachesByName.delete(name); },
    async match(url) { for (const c of cachesByName.values()) { const hit = await c.match(url); if (hit) return hit; } },
  };
  const self = {
    location: new URL('https://maydan.example/sw.js'),
    addEventListener(type, handler) { listeners.set(type, handler); },
    async skipWaiting() { skipped = true; },
    clients: { async claim() {}, async matchAll() { return [{ postMessage() {}, navigate() { navigated = true; } }]; } },
  };
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, caches, fetch: fetcher, URL, Response, Headers, AbortController, setTimeout, clearTimeout });
  async function dispatch(type, extras = {}) {
    let response;
    const tasks = [];
    listeners.get(type)({ ...extras, waitUntil(task) { tasks.push(task); }, respondWith(task) { response = task; } });
    if (response) response = await response;
    await Promise.all(tasks);
    return response;
  }
  return { dispatch, caches, deleted, skipped: () => skipped, navigated: () => navigated, makeCache };
}

test('failed shell download cannot activate an incomplete offline release', async () => {
  const w = await worker({ failDocument: true });
  await assert.rejects(w.dispatch('install'), /offline/);
  assert.equal(w.skipped(), false);
});

test('upgrade preserves other applications and never reloads an active round', async () => {
  const w = await worker();
  await w.caches.open('maydan-platform-old');
  await w.caches.open('maydan-media-v1');
  await w.caches.open('another-app-v1');
  await w.dispatch('activate');
  assert.deepEqual(w.deleted, ['maydan-platform-old']);
  assert.equal(w.navigated(), false);
});

test('cached clips support Safari range requests without a network', async () => {
  const w = await worker({ fetcher: async () => { throw new Error('offline'); } });
  const url = 'https://maydan.example/media/sound/test.mp3';
  await (await w.caches.open('maydan-media-v1')).put(url, new Response('0123456789', { headers: { 'content-type': 'audio/mpeg' } }));
  for (const [range, expected] of [['bytes=2-5', '2345'], ['bytes=-3', '789']]) {
    const response = await w.dispatch('fetch', { request: new Request(url, { headers: { Range: range } }) });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), expected);
    assert.equal(response.headers.get('content-length'), String(expected.length));
  }
  const invalid = await w.dispatch('fetch', { request: new Request(url, { headers: { Range: 'bytes=999-' } }) });
  assert.equal(invalid.status, 416);
});

test('offline downloads reject external URLs and SPA fallback HTML instead of announcing success', async () => {
  const w = await worker({ fetcher: async () => new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } }) });
  const messages = [];
  await w.dispatch('message', { data: { type: 'cache-media', urls: ['https://other.example/x.mp3', '/media/missing.mp3'] }, ports: [{ postMessage(data) { messages.push(data); } }] });
  assert.equal(messages.at(-1).failed, 2);
  assert.equal(messages.at(-1).ok, 0);
});

test('preloader waits for the body and a cancellation settles a stalled fetch', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  globalThis.document = {};
  resetMediaState();
  let finishBody;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: () => new Promise((resolve) => { finishBody = resolve; }) });
  try {
    const request = preloadMedia(['/clip.mp3'], { timeoutMs: 1000 });
    await new Promise((r) => setImmediate(r));
    assert.equal(isLoaded('/clip.mp3'), false);
    finishBody(new ArrayBuffer(1));
    assert.equal((await request).ok, 1);
    const controller = new AbortController();
    globalThis.fetch = () => new Promise(() => {});
    const stalled = preloadMedia(['/stalled.mp3'], { signal: controller.signal });
    controller.abort();
    assert.equal((await stalled).aborted, true);
  } finally { globalThis.fetch = originalFetch; globalThis.document = originalDocument; resetMediaState(); }
});

test('a download without a service worker does not promise offline readiness', async () => {
  const result = await cacheForOffline([]);
  assert.equal(result.offlineReady, false);
  assert.equal(result.unsupported, true);
});

test('normal media fetch does not cache an HTML fallback', async () => {
  const w = await worker({ fetcher: async () => new Response('<html>missing</html>', { headers: { 'content-type': 'text/html' } }) });
  const request = new Request('https://maydan.example/media/sound/missing.mp3');
  await w.dispatch('fetch', { request });
  assert.equal(await (await w.caches.open('maydan-media-v1')).match(request), undefined);
});

test('media fetch repairs an HTML fallback cached by an earlier release', async () => {
  const w = await worker({ fetcher: async () => new Response('repaired clip', { headers: { 'content-type': 'audio/mpeg' } }) });
  const request = new Request('https://maydan.example/media/sound/old.mp3');
  const cache = await w.caches.open('maydan-media-v1');
  await cache.put(request, new Response('<html>missing</html>', { headers: { 'content-type': 'text/html' } }));
  const response = await w.dispatch('fetch', { request });
  assert.equal(await response.text(), 'repaired clip');
  assert.equal((await cache.match(request)).headers.get('content-type'), 'audio/mpeg');
});

test('HTML media fallback stays retryable after the server is repaired', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  globalThis.document = {};
  resetMediaState();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(calls === 1 ? '<html>missing</html>' : 'clip', { headers: { 'content-type': calls === 1 ? 'text/html' : 'audio/mpeg' } });
  };
  try {
    assert.equal((await preloadMedia(['/retry.mp3'])).failed, 1);
    assert.equal(isLoaded('/retry.mp3'), false);
    assert.equal((await preloadMedia(['/retry.mp3'])).ok, 1);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; globalThis.document = originalDocument; resetMediaState(); }
});
