import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareImage, prepareVisuals, settleWithin } from '../src/shared/fx/readiness.js';

test('readiness counts completed assets and fonts, waiting for decode, without a display delay', async (t) => {
  const oldImage = globalThis.Image, oldDocument = globalThis.document;
  const images = [], fonts = [];
  let decode;
  globalThis.Image = class { constructor() { images.push(this); } decode() { return new Promise((resolve) => { decode = resolve; }); } };
  globalThis.document = { fonts: { load(face, sample) { fonts.push([face, sample]); return Promise.resolve([]); } } };
  t.after(() => { globalThis.Image = oldImage; globalThis.document = oldDocument; });
  const progress = [];
  let ready = false;
  const done = prepareVisuals({ images: ['ready-test.webp'], onProgress: (value) => progress.push(value) }).then((value) => { ready = true; return value; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(ready, false);
  assert.equal(fonts.length, 2);
  images[0].onload();
  await Promise.resolve(); assert.equal(ready, false, 'load alone is not decoded readiness');
  decode(); assert.deepEqual(await done, { ready: true, degraded: false });
  assert.deepEqual(progress[0], { complete: 0, total: 2 });
  assert.deepEqual(progress.at(-1), { complete: 2, total: 2 });
  await prepareImage('ready-test.webp'); assert.equal(images.length, 1, 'decoded images are reused');
});

test('failed decorative images do not block launch and can be retried later', async (t) => {
  const oldImage = globalThis.Image;
  const images = [];
  globalThis.Image = class { constructor() { images.push(this); } };
  t.after(() => { globalThis.Image = oldImage; });
  const pending = prepareVisuals({ images: ['failed-test.webp'], fonts: false });
  images[0].onerror(new Error('decode failed'));
  assert.deepEqual(await pending, { ready: true, degraded: true });
  const retry = prepareImage('failed-test.webp'); assert.equal(images.length, 2);
  images[1].onload(); assert.equal(await retry, true);
});

test('a stalled asset has a deadline while successful assets resolve immediately', async () => {
  assert.equal(await settleWithin(new Promise(() => {}), 10), false);
  assert.equal(await settleWithin(Promise.resolve(), 5000), true);
  assert.equal(await settleWithin(Promise.reject(new Error('offline')), 5000), false);
});
