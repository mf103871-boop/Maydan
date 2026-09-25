import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheStartupImages } from '../src/shared/media/startup-cache.js';

const image = (body = 'complete image', options = {}) => new Response(body, {
  headers: { 'content-type': 'image/webp' }, ...options,
});

function fakeCache(initial = []) {
  const entries = new Map(initial);
  const writes = [];
  const deletes = [];
  return {
    entries, writes, deletes,
    async match(url) { return entries.get(url)?.clone(); },
    async delete(url) { deletes.push(url); return entries.delete(url); },
    async put(url, response) {
      const body = await response.arrayBuffer();
      writes.push({ url, size: body.byteLength });
      entries.set(url, new Response(body, { status: response.status, headers: response.headers }));
    },
  };
}

function storage(t, cache) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: cache && { open: async (name) => {
      assert.equal(name, 'maydan-media-v1');
      return cache;
    } },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'caches', descriptor);
    else delete globalThis.caches;
  });
}

test('startup cache: a later offline launch reads exact versioned images without fetching', async (t) => {
  const urls = ['media/test/a.webp?v=old', 'media/test/a.webp?v=new'];
  const cache = fakeCache(urls.map((url) => [url, image()]));
  storage(t, cache);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Offline'); });
  const progress = [];
  const result = await cacheStartupImages([...urls, urls[0]], { onProgress: (value) => progress.push(value) });
  assert.deepEqual(result, { total: 2, ok: 2, failed: 0, persistent: true });
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(cache.writes.length, 0);
  assert.deepEqual(progress[0], { done: 0, total: 2, ok: 0, failed: 0 });
  assert.deepEqual(progress.at(-1), { done: 2, total: 2, ok: 2, failed: 0 });
});

test('startup cache: failures are reported and retry fetches only the missing images', async (t) => {
  const cache = fakeCache();
  storage(t, cache);
  const urls = ['media/a.webp?v=2', 'media/b.webp?v=2', 'media/c.webp?v=2'];
  let retry = false;
  const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
    if (retry || url === urls[0]) return image();
    if (url === urls[1]) return new Response('Unavailable', { status: 503 });
    throw new TypeError('Network unavailable');
  });
  assert.deepEqual(await cacheStartupImages(urls), { total: 3, ok: 1, failed: 2, persistent: true });
  retry = true;
  assert.deepEqual(await cacheStartupImages(urls), { total: 3, ok: 3, failed: 0, persistent: true });
  assert.deepEqual(fetch.mock.calls.map((call) => call.arguments[0]), [...urls, ...urls.slice(1)]);
  assert.deepEqual([...cache.entries.keys()], urls);
});

test('startup cache: corrupt cache entries are repaired and HTML fallbacks never count as images', async (t) => {
  const urls = ['media/html.webp', 'media/error.webp', 'media/empty.webp', 'media/missing.webp'];
  const cache = fakeCache([
    [urls[0], new Response('<html>game</html>', { headers: { 'content-type': 'text/html' } })],
    [urls[1], image('error', { status: 404, headers: { 'content-type': 'image/webp' } })],
    [urls[2], image('')],
  ]);
  storage(t, cache);
  t.mock.method(globalThis, 'fetch', async (url) => url === urls[3]
    ? new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } })
    : image());
  assert.deepEqual(await cacheStartupImages(urls), { total: 4, ok: 3, failed: 1, persistent: true });
  assert.deepEqual(new Set(cache.deletes), new Set(urls.slice(0, 3)));
  assert.equal(cache.entries.has(urls[3]), false);
  assert.equal(cache.writes.length, 3);
});

test('startup cache: bounded workers finish image bodies before recording success or caching', async (t) => {
  const cache = fakeCache();
  storage(t, cache);
  const urls = Array.from({ length: 7 }, (_, i) => `media/${i}.webp`);
  let active = 0;
  let peak = 0;
  let completed = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    active += 1;
    peak = Math.max(peak, active);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        setTimeout(() => {
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
          completed += 1;
          active -= 1;
        }, 5);
      },
    });
    return image(stream);
  });
  const result = await cacheStartupImages(urls, {
    concurrency: 2,
    onProgress: ({ ok }) => assert.ok(ok <= completed, 'headers alone cannot count as a complete image'),
  });
  assert.equal(peak, 2);
  assert.deepEqual(result, { total: 7, ok: 7, failed: 0, persistent: true });
  assert.equal(cache.writes.length, 7);
  assert.ok(cache.writes.every(({ size }) => size === 4));
});

test('startup cache: stalled headers and stalled bodies both settle at the deadline', async (t) => {
  const cache = fakeCache();
  storage(t, cache);
  const signals = [];
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    signals.push(signal);
    if (url.endsWith('headers.webp')) return new Promise(() => {});
    return image(new ReadableStream({ start() {} }));
  });
  const result = await cacheStartupImages(['media/headers.webp', 'media/body.webp'], { timeoutMs: 15 });
  assert.deepEqual(result, { total: 2, ok: 0, failed: 2, persistent: true });
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(cache.writes.length, 0);
});

test('startup cache: abort stops pending downloads and never starts the remaining queue', async (t) => {
  storage(t, fakeCache());
  const controller = new AbortController();
  let started;
  const pending = new Promise((resolve) => { started = resolve; });
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    started();
    return new Promise(() => {});
  });
  const resultPromise = cacheStartupImages(['media/1.webp', 'media/2.webp', 'media/3.webp'], {
    signal: controller.signal, concurrency: 1,
  });
  await pending;
  controller.abort();
  assert.deepEqual(await resultPromise, { total: 3, ok: 0, failed: 3, persistent: false, aborted: true });
  assert.equal(fetch.mock.callCount(), 1);
});

test('startup cache: missing storage warms complete bodies but never promises persistence', async (t) => {
  storage(t, undefined);
  t.mock.method(globalThis, 'fetch', async (url) => url.endsWith('empty.webp') ? image('') : image());
  const result = await cacheStartupImages(['media/ready.webp', 'media/empty.webp']);
  assert.deepEqual(result, { total: 2, ok: 1, failed: 1, persistent: false });
});

test('startup cache: quota failures retain downloaded success without claiming offline availability', async (t) => {
  const cache = fakeCache();
  cache.put = async () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
  storage(t, cache);
  t.mock.method(globalThis, 'fetch', async () => image());
  const result = await cacheStartupImages(['media/ready.webp']);
  assert.deepEqual(result, { total: 1, ok: 1, failed: 0, persistent: false });
});

test('startup cache: stalled storage falls back to a complete network download', async (t) => {
  storage(t, fakeCache());
  globalThis.caches.open = async () => new Promise(() => {});
  t.mock.method(globalThis, 'fetch', async () => image());
  const result = await cacheStartupImages(['media/ready.webp'], { timeoutMs: 15 });
  assert.deepEqual(result, { total: 1, ok: 1, failed: 0, persistent: false });
});

test('startup cache: a broken image body is never persisted despite successful headers', async (t) => {
  const cache = fakeCache();
  storage(t, cache);
  t.mock.method(globalThis, 'fetch', async () => image(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.error(new TypeError('Connection lost during body download'));
    },
  })));
  assert.deepEqual(await cacheStartupImages(['media/broken.webp']), { total: 1, ok: 0, failed: 1, persistent: true });
  assert.equal(cache.writes.length, 0);
});

test('startup cache: an already cancelled launch does no network work', async (t) => {
  storage(t, fakeCache());
  const fetch = t.mock.method(globalThis, 'fetch', async () => image());
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await cacheStartupImages(['media/ready.webp'], { signal: controller.signal }), {
    total: 1, ok: 0, failed: 1, persistent: false, aborted: true,
  });
  assert.equal(fetch.mock.callCount(), 0);
});
