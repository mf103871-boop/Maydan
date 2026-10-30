import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheStartupImages } from '../src/shared/media/startup-cache.js';

function storage(t, cache) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: async name => {
    assert.equal(name, 'maydan-media-v1'); return cache;
  } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'caches', previous); else delete globalThis.caches; });
}

test('startup cache preserves exact decoded image bytes and headers without a document-backed Blob', async t => {
  const bytes = Uint8Array.from([0, 255, 13, 10, 128, 42]), written = [];
  storage(t, { match: async () => undefined, put: async (url, response) => {
    written.push({ url, bytes: [...new Uint8Array(await response.arrayBuffer())], headers: Object.fromEntries(response.headers) });
  } });
  const blob = t.mock.method(Response.prototype, 'blob', () => { throw new Error('Document-backed Blob must not reach CacheStorage'); });
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes, {
    headers: { 'content-type': 'image/webp', 'content-encoding': 'gzip', 'content-length': '999', 'x-image-proof': 'retained' },
  }));
  assert.deepEqual(await cacheStartupImages(['media/example.webp?v=exact']), { total: 1, ok: 1, failed: 0, persistent: true });
  assert.equal(blob.mock.callCount(), 0);
  assert.deepEqual(written, [{ url: 'media/example.webp?v=exact', bytes: [...bytes], headers: {
    'content-length': String(bytes.length), 'content-type': 'image/webp', 'x-image-proof': 'retained',
  } }]);
});

test('legacy cached image bodies without a content length remain readable offline without Blob conversion', async t => {
  const bytes = Uint8Array.from([82, 73, 70, 70, 0, 255, 128]), cached = new Response(bytes, { headers: { 'content-type': 'image/webp' } });
  storage(t, { match: async () => cached.clone(), delete: async () => assert.fail('valid legacy image must not be evicted'), put: async () => assert.fail('valid offline hit must not be rewritten') });
  const blob = t.mock.method(Response.prototype, 'blob', () => { throw new Error('Legacy cache read must not depend on a document Blob URL'); });
  const fetch = t.mock.method(globalThis, 'fetch', async () => assert.fail('offline legacy hit must not fetch'));
  assert.deepEqual(await cacheStartupImages(['media/legacy.webp?v=stable']), { total: 1, ok: 1, failed: 0, persistent: true });
  assert.equal(blob.mock.callCount(), 0); assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual([...new Uint8Array(await cached.arrayBuffer())], [...bytes]);
});
