import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import path from 'node:path';
import { build } from 'esbuild';
import { esbuildOptions } from '../scripts/lib.mjs';
import { localRequestAllowed, localAssetPath, startUIReview } from '../scripts/ui-preview.mjs';

test('local review rejects foreign origins and DNS-rebinding Host headers', () => {
  for (const host of ['127.0.0.1:4178', 'localhost:4178', '[::1]:4178']) {
    assert.equal(localRequestAllowed({ headers: { host } }, 4178), true);
    assert.equal(localRequestAllowed({ headers: { host, origin: `http://${host}` } }, 4178), true);
  }
  for (const headers of [
    { host: 'attacker.example:4178' }, { host: '127.0.0.1:4179' },
    { host: '127.0.0.1:4178', origin: 'https://attacker.example' },
    { host: '127.0.0.1:4178', origin: 'null' },
    { host: '127.0.0.1:4178', origin: 'http://127.0.0.1:8789' },
  ]) assert.equal(localRequestAllowed({ headers }, 4178), false);
});

test('review assets cannot escape the generated bundle directory', () => {
  const root = path.resolve('.cache/local-review-boundary');
  assert.equal(localAssetPath(root, '/art/home/home-header-v1.webp'), path.join(root, 'art/home/home-header-v1.webp'));
  for (const file of ['/../../private', '/%2e%2e/%2e%2e/private', '/%2e%2e%5cprivate']) assert.throws(() => localAssetPath(root, file));
});

test('normal compiled game excludes the local review module, with an enabled-build positive control', async () => {
  const previous = process.env.MAYDAN_UI_PREVIEW;
  try {
    for (const enabled of [false, true]) {
      process.env.MAYDAN_UI_PREVIEW = enabled ? '1' : '0';
      const result = await build(esbuildOptions({ minify: true, version: 'local-isolation-test' }));
      const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
      assert.equal(js.includes('local-review-scene'), enabled);
      assert.equal(js.includes('maydan-local-preview-replay'), enabled);
    }
  } finally { if (previous === undefined) delete process.env.MAYDAN_UI_PREVIEW; else process.env.MAYDAN_UI_PREVIEW = previous; }
});

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('actual local review is loopback-only and synthetic accounts are isolated and reusable', { timeout: 20000 }, async () => {
  const port = await freePort(); let apiPort = await freePort();
  while (port === apiPort) apiPort = await freePort();
  const app = await startUIReview({ port, apiPort, build: false, watchSource: false });
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal(app.server.address().address, '127.0.0.1');
    const denied = await fetch(base + '/__preview__/login', { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: JSON.stringify({ index: 0 }) });
    assert.equal(denied.status, 403);
    const meta = await (await fetch(base + '/__preview__/meta')).json();
    assert.equal(meta.localOnly, true); assert.equal(meta.phoneAccessible, false); assert.equal(meta.providerVoice, false);
    const login = async index => (await fetch(base + '/__preview__/login', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ index }) })).json();
    const first = await login(0), again = await login(0), second = await login(1);
    assert.ok(first.session.token === again.session.token, 'same local persona preserves its session');
    assert.ok(first.session.token !== second.session.token, 'different personas have independent sessions');
    assert.ok(first.me.user.id !== second.me.user.id, 'different accounts do not share identity');
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => login(2)));
    assert.equal(new Set(concurrent.map(result => result.me.user.id)).size, 1, 'concurrent tabs cannot create multiple accounts for one persona');
    assert.equal(new Set(concurrent.map(result => result.session.token)).size, 1, 'concurrent tabs reclaim the same local session');
    assert.equal(first.localOnly, true);
    assert.equal((await login(100)).error, 'LOCAL_PREVIEW_ERROR');
    assert.equal(app.backend.env.LIVEKIT_API_SECRET, undefined);
    assert.equal(app.backend.env.GOOGLE_CLIENT_SECRET, undefined);
    assert.equal(app.backend.env.IOS_UPDATE_POLICY_ENABLED, '0');
    const worker = await (await fetch(base + '/sw.js')).text();
    assert.ok(worker.includes('registration.unregister()'), 'review retires only the loopback service worker');
    assert.ok(!worker.includes('caches.open'), 'review navigation cannot be replaced by an installed game document');
    const control = async (route, body) => {
      const response = await fetch(base + route, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 200); return response.json();
    };
    const seed = await control('/__preview__/seed', {});
    assert.equal(seed.rooms.length, 6);
    const mafia = seed.rooms.find(room => room.game === 'mafia');
    await control('/__preview__/room-action', { code: mafia.code, action: 'ready' });
    await control('/__preview__/room-action', { code: mafia.code, action: 'start' });
    const listing = await (await fetch(base + '/api/rooms/public', { headers: { origin: base, authorization: 'Bearer ' + first.session.token } })).json();
    assert.equal(listing.rooms.find(room => room.code === mafia.code)?.status, 'playing', 'review controls receive real server acknowledgements');
  } finally { await app.close(); }
});
