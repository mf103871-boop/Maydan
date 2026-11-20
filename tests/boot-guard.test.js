import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { renderHtml } from '../scripts/lib.mjs';
import { environmentStorageKey, PRODUCTION_API_ORIGIN } from '../src/shared/lib/environment.js';
import { fakeStorage } from './helpers.js';

async function openGuard(roomsUrl, pageOrigin, storage) {
  const html = await renderHtml('throw new Error("main fixture")', { version: '1.9', roomsUrl });
  const guard = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const buttons = new Map();
  let reloads = 0;
  const location = { origin: pageOrigin, hash: '#/game', reload() { reloads++; } };
  const document = { getElementById(id) {
    return { addEventListener(event, handler) { assert.equal(event, 'click'); buttons.set(id, handler); } };
  } };
  runInNewContext(guard, { window: {}, document, location, URL, get localStorage() { return storage(); } });
  return { press(id) { buttons.get(id)(); assert.equal(reloads, 1); }, location };
}

test('early recovery follows the packaged API origin and preserves account and other server data', async () => {
  const host = 'https://review.example';
  for (const [roomsUrl, pageOrigin, owner] of [
    ['same-origin', PRODUCTION_API_ORIGIN, PRODUCTION_API_ORIGIN],
    ['same-origin', host, host],
    [host + ':443/', 'null', host + ':443/'],
    ['', 'null', ''],
  ]) {
    const server = owner && new URL(owner).origin;
    const foreign = (server || host) + ':8443';
    const room = (origin) => 'maydan:online:' + origin + ':roomOwner:123456';
    const receipt = (origin) => 'maydan:legal:receipt:' + encodeURIComponent(origin) + ':1:en:fixture';
    const kept = {
      'maydan:account:session': 'legacy', 'maydan:online:device': 'shared-device', unrelated: 'value',
      [environmentStorageKey('maydan:account:me', owner)]: 'cached account',
      [environmentStorageKey('maydan:account:trials', foreign)]: 'foreign trials',
      [room(foreign)]: 'other seat', [receipt(foreign)]: 'other consent',
    };
    const local = { [environmentStorageKey('maydan:beep:state', owner)]: 'recoverable match' };
    if (server) {
      local[room(server)] = 'current seat'; local[receipt(server)] = 'current consent';
    }
    const storage = fakeStorage({ ...kept, ...local });
    const guard = await openGuard(roomsUrl, pageOrigin, () => storage);
    guard.press('fatal-clear');
    assert.equal(guard.location.hash, '#/');
    assert.deepEqual(storage.dump(), kept);
  }
});

test('unresolved same-origin leaves legacy storage intact and blocked storage still allows recovery', async () => {
  const data = { 'maydan:beep:state': 'legacy', 'maydan:account:session': 'session' };
  const storage = fakeStorage(data);
  const opaque = await openGuard('same-origin', 'null', () => storage);
  opaque.press('fatal-clear');
  assert.deepEqual(storage.dump(), data);
  for (const id of ['fatal-clear', 'fatal-home', 'fatal-reload']) {
    const guard = await openGuard('same-origin', PRODUCTION_API_ORIGIN, () => { throw new Error('storage denied'); });
    guard.press(id);
    assert.equal(guard.location.hash, id === 'fatal-reload' ? '#/game' : '#/');
  }
});
