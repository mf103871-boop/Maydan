import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheStartupImages } from '../src/shared/media/startup-cache.js';
import { createBackgroundDownloadGate, shouldPauseStartupImages } from '../src/shared/media/background-gate.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { for (let i = 0; i < 1000; i++) { if (predicate()) return; await delay(1); } assert.fail('Fixture did not settle'); }
const image = body => new Response(body || 'image', { headers: { 'content-type': 'image/webp' } });
function setup(t) {
  const entries = new Map();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: async () => ({ match: async url => entries.get(url)?.clone(), delete: async url => entries.delete(url),
    put: async (url, response) => { entries.set(url, new Response(await response.arrayBuffer(), { headers: response.headers })); } }) } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'caches', descriptor); else delete globalThis.caches; });
  return entries;
}

test('startup priority pauses for online/local play, every call setup phase, audio and hidden pages', () => {
  for (const route of ['play', 'online', 'room']) assert.equal(shouldPauseStartupImages({ route }), true);
  for (const reason of ['call', 'connecting', 'mafiaVoice', 'audio', 'hidden']) assert.equal(shouldPauseStartupImages({ route: 'home', [reason]: true }), true);
  for (const route of ['home', 'settings', 'friends', 'game', 'store']) assert.equal(shouldPauseStartupImages({ route }), false);
  assert.equal(shouldPauseStartupImages({ call: false, hidden: true }), true, 'ending a call cannot resume a hidden page');
});

test('startup priority waits outside request deadlines and resumes all exact versioned keys once', async t => {
  const entries = setup(t), gate = createBackgroundDownloadGate(); gate.setPaused(true);
  const fetched = [], progress = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { fetched.push(url); assert.equal(options.priority, 'low'); return image(); });
  const urls = ['media/a.webp?v=first', 'media/a.webp?v=second', 'media/b.webp?v=third'];
  const pending = cacheStartupImages(urls, { waitUntilReady: gate.wait, timeoutMs: 20, onProgress: value => progress.push(value) });
  await delay(55);
  assert.deepEqual(fetched, []); assert.deepEqual(progress, [{ done: 0, total: 3, ok: 0, failed: 0 }]);
  gate.setPaused(false);
  assert.deepEqual(await pending, { total: 3, ok: 3, failed: 0, persistent: true });
  assert.deepEqual(fetched, urls); assert.deepEqual([...entries.keys()], urls);
  assert.equal((await cacheStartupImages(urls, { waitUntilReady: gate.wait })).ok, 3);
  assert.deepEqual(fetched, urls, 'a resumed queue keeps exact offline entries for later launches');
});

test('startup priority drains in-flight bodies without aborting or restarting the queue', async t => {
  const entries = setup(t), gate = createBackgroundDownloadGate(), fetched = [], signals = [], finish = [], progress = [];
  const urls = Array.from({ length: 9 }, (_, index) => `media/${index}.webp?v=stable`);
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    fetched.push(url); signals.push(signal);
    if (fetched.length <= 3) return image(new ReadableStream({ start(controller) { finish.push(() => { controller.enqueue(new Uint8Array([1, 2])); controller.close(); }); } }));
    return image();
  });
  const pending = cacheStartupImages(urls, { waitUntilReady: gate.wait, concurrency: 3, timeoutMs: 1000, onProgress: value => progress.push(value) });
  await until(() => finish.length === 3);
  gate.setPaused(true); finish.forEach(resolve => resolve());
  await until(() => entries.size === 3 && progress.at(-1).done === 3);
  await delay(25);
  assert.equal(fetched.length, 3); assert.ok(signals.every(signal => !signal.aborted));
  assert.deepEqual(progress.at(-1), { done: 3, total: 9, ok: 3, failed: 0 });
  gate.setPaused(false);
  assert.deepEqual(await pending, { total: 9, ok: 9, failed: 0, persistent: true });
  assert.deepEqual(fetched, urls); assert.equal(entries.size, 9);
});

test('startup priority abort wakes every paused worker without starting queued requests', async t => {
  const entries = setup(t), gate = createBackgroundDownloadGate(), controller = new AbortController(); gate.setPaused(true);
  entries.set('previous.webp?v=1', image());
  const fetch = t.mock.method(globalThis, 'fetch', async () => assert.fail('cancelled queue fetched'));
  const pending = cacheStartupImages(['media/a.webp', 'media/b.webp'], { waitUntilReady: gate.wait, signal: controller.signal });
  await delay(5); controller.abort();
  assert.deepEqual(await pending, { total: 2, ok: 0, failed: 2, persistent: false, aborted: true });
  gate.setPaused(false); await delay(5);
  assert.equal(fetch.mock.callCount(), 0); assert.equal(entries.size, 1);
});

test('startup priority rechecks a renewed pause after waking, before fetching', async t => {
  setup(t); const gate = createBackgroundDownloadGate(); gate.setPaused(true);
  const fetch = t.mock.method(globalThis, 'fetch', async () => image());
  const pending = cacheStartupImages(['media/a.webp'], { waitUntilReady: gate.wait });
  await delay(5); gate.setPaused(false); gate.setPaused(true); await delay(5);
  assert.equal(fetch.mock.callCount(), 0);
  gate.setPaused(false); assert.equal((await pending).ok, 1);
});
