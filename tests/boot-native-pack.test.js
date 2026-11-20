import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeInstalledPack } from '../scripts/native/installed-pack.mjs';
import { isBundledNative, prepareNativePack } from '../src/boot/native-pack.js';

test('inventory is deterministic, includes platform additions and hashes only final installed files', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'maydan-installed-pack-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(writeInstalledPack(dir), /entry is missing/);
  await writeFile(path.join(dir, 'index.html'), 'hello');
  await writeFile(path.join(dir, 'native-config.json'), '{}');
  for (let i = 0; i < 40; i++) await writeFile(path.join(dir, i + '.bin'), String(i));
  const inventory = await writeInstalledPack(dir);
  assert.deepEqual(await writeInstalledPack(dir), inventory);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'native-game-pack.json'))), inventory);
  assert.equal(inventory.totalFiles, 42);
  assert.deepEqual(inventory.groups.map(group => group.length), [40, 2]);
  let bytes = 0;
  for (const entry of inventory.groups.flat()) {
    const buffer = await readFile(path.join(dir, entry.file));
    assert.equal(entry.sha256, createHash('sha256').update(buffer).digest('hex'));
    assert.equal(entry.bytes, buffer.length);
    bytes += buffer.length;
  }
  assert.equal(inventory.totalBytes, bytes);
  const ios = await writeInstalledPack(dir, { ios: true });
  assert.deepEqual(ios.groups, [inventory.groups.flat()]);
  assert.equal(ios.totalBytes, inventory.totalBytes);
});

test('only the installed game origins select native preparation', () => {
  for (const url of ['https://appassets.androidplatform.net/game/index.html', 'maydan://app/index.html']) {
    assert.equal(isBundledNative(new URL(url)), true);
  }
  for (const url of ['file:///tmp/migrate.html', 'https://appassets.androidplatform.net/other/', 'maydan://other/',
    'https://appassets.androidplatform.net:81/game/', 'https://test.example/game/']) {
    assert.equal(isBundledNative(new URL(url)), false);
  }
});

const fixture = index => ({ batch: index, batches: 2, bytes: 8, files: 1, totalBytes: 16, totalFiles: 2 });
function setGameURL(t, url) {
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(url) });
  t.after(() => { delete globalThis.location; });
}
function ios(t, postMessage) {
  setGameURL(t, 'maydan://app/index.html');
  globalThis.webkit = { messageHandlers: { maydanInstalledPack: { postMessage } } };
  t.after(() => { delete globalThis.webkit; });
}

test('iOS bridge reports only fully verified batches and propagates missing or inconsistent assets', async t => {
  const events = [];
  ios(t, index => fixture(index));
  await prepareNativePack({ onProgress: value => events.push(value) });
  assert.deepEqual(events.map(x => [x.phase, x.completedBytes, x.completedFiles]), [['verify', 8, 1], ['ready', 16, 2]]);
  globalThis.webkit.messageHandlers.maydanInstalledPack.postMessage = index => ({ ...fixture(index), bytes: 7 });
  await assert.rejects(prepareNativePack(), /NATIVE_PACK_INVALID/);
  globalThis.webkit.messageHandlers.maydanInstalledPack.postMessage = () => Promise.reject(Error('corrupt'));
  await assert.rejects(prepareNativePack(), /corrupt/);
});

test('cancelling an outstanding native reply cannot complete launch', async t => {
  let finish;
  ios(t, () => new Promise(resolve => { finish = resolve; }));
  const stopped = new AbortController();
  const received = [];
  const pending = prepareNativePack({ signal: stopped.signal, onProgress: entry => received.push(entry) });
  await Promise.resolve();
  stopped.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  finish(fixture(0));
  assert.equal(received.length, 0);
});

test('Android uses same-origin installed checks and never downgrades an integrity error', async t => {
  setGameURL(t, 'https://appassets.androidplatform.net/game/index.html');
  const requests = [];
  const read = t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url.href);
    return Response.json(fixture(Number(url.pathname.split('/').at(-1))));
  });
  await prepareNativePack();
  assert.deepEqual(requests, [0,1].map(index => 'https://appassets.androidplatform.net/game/__installed_pack__/' + index));
  read.mock.mockImplementation(() => new Response(null, { status: 422 }));
  await assert.rejects(prepareNativePack(), /NATIVE_PACK_INVALID/);
  assert.equal(read.mock.callCount(), 3);
});

test('older shells read local assets and reject corrupt bytes and external inventory paths', async t => {
  setGameURL(t, 'https://appassets.androidplatform.net/game/index.html');
  const entry = { file: 'index.html', bytes: 2, sha256: createHash('sha256').update('ok').digest('hex') };
  let payload = 'ok';
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url.origin, 'https://appassets.androidplatform.net');
    if (url.pathname.includes('__installed_pack__')) return new Response(null, { status: 404 });
    if (url.pathname.endsWith('native-game-pack.json')) return Response.json({ schema: 1, totalFiles: 1, totalBytes: 2, groups: [[entry]] });
    return new Response(payload);
  });
  assert.equal((await prepareNativePack()).completedBytes, 2);
  payload = 'no';
  await assert.rejects(prepareNativePack(), /NATIVE_PACK_INVALID/);
  entry.file = '../other';
  await assert.rejects(prepareNativePack(), /NATIVE_PACK_INVALID/);
});

test('a receipt identifies a previously verified installation, while unknown legacy crypto cannot grant readiness', async t => {
  ios(t, () => ({ ...fixture(0), bytes: 16, files: 2, batches: 1, receipt: 1 }));
  assert.equal((await prepareNativePack()).source, 'installed-receipt');
  delete globalThis.webkit.messageHandlers.maydanInstalledPack;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  t.after(() => Object.defineProperty(globalThis, 'crypto', original));
  await assert.rejects(prepareNativePack(), /NATIVE_PACK_UNAVAILABLE/);
});
