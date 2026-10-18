import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WebSocket } from 'ws';
import { RoomClient, newCredentials } from '../src/online/client.js';
import { startLocalServer } from '../server/local.mjs';
import { migrationSql } from '../server/local-d1.mjs';
import { deleteUser } from '../server/accounts/db.mjs';
import { cleanup } from '../server/accounts/cleanup.mjs';
import { errorText } from '../src/online/shared.js';
import questions from '../src/data/games/fabraka/questions.json' with { type: 'json' };

const ORIGIN = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
async function until(fn, label = 'condition') {
  const limit = Date.now() + 6000;
  while (Date.now() < limit) { if (fn()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail(`Timed out: ${label}`);
}
function transport(server, token = null) {
  return async (endpoint, data) => {
    const result = await fetch(server + endpoint, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
    return { status: result.status, body: await result.json() };
  };
}
async function joinedPair(server, api, clients, body = {}) {
  const profiles = Array.from({ length: 2 }, (_, n) => ({ ...newCredentials(), name: `هاتف ${n}`, avatar: n }));
  const payload = { ...profiles[0], game: 'fabraka', settings: { rounds: 3, mode: 'classic', writeSeconds: 0, discussionSeconds: 0 }, ...body };
  const created = await api('/api/rooms', payload);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const retry = await api('/api/rooms', payload); assert.equal(retry.body.code, created.body.code, 'same credentials recover a created room');
  const guest = transport(server);
  assert.equal((await guest(`/api/rooms/${created.body.code}/join`, profiles[1])).status, 200);
  const pair = profiles.map((session) => new RoomClient({ server, code: created.body.code, session, WebSocketImpl: BrowserSocket }));
  for (const client of pair) { clients.push(client); client.start(); }
  await until(() => pair.every((c) => c.state?.members.filter((m) => m.connected).length === 2), 'pair connected');
  return { pair, profiles, code: created.body.code };
}

test('workerd starts exactly one pre-created free room, supports two-player play, and never exposes trial identities', { timeout: 40_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maydan-start-trial-'));
  let mf; const clients = [];
  try {
    const scriptPath = path.join(dir, 'worker.mjs');
    await build({ entryPoints: ['server/worker.mjs'], outfile: scriptPath, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
    mf = new Miniflare(convertV4MiniflareOptions({ rootPath: dir, name: 'maydan-start-trial', modules: true, scriptPath,
      compatibilityDate: '2026-09-01', durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true } },
      d1Databases: { DB: 'trial-db' }, bindings: { ALLOWED_ORIGINS: ORIGIN, APP_ORIGIN: ORIGIN, AUTH_DEV_FAKE: '1', SESSION_SECRET: 'trial-test-secret' }, port: 0, host: '127.0.0.1', cf: false }));
    const server = (await mf.ready).origin, DB = await mf.getD1Database('DB'); await DB.exec(migrationSql());
    const publicApi = transport(server);
    const signed = await publicApi('/api/auth/dev', { subject: 'trial-owner', name: 'المضيف' });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    const ownerId = signed.body.me.user.id, api = transport(server, signed.body.session.token), deviceId = 'd'.repeat(32);
    const first = await joinedPair(server, api, clients, { deviceId, roomTrialGate: { premium: true }, accountUserId: 'forged' });
    const second = await joinedPair(server, api, clients, { deviceId });
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM trials').first()).n, 0, 'creating and retrying waiting rooms costs nothing');
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM online_room_trial_claims').first()).n, 0);
    await assert.rejects(first.pair[0].command('start'), (e) => e.code === 'NOT_READY_DUO');
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM trials').first()).n, 0, 'an invalid start cannot consume');
    for (const room of [first, second]) await room.pair[1].command('ready', { ready: true });
    const result = await Promise.allSettled([first.pair[0].command('start'), second.pair[0].command('start')]);
    assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(result.find((r) => r.status === 'rejected').reason.code, 'PLUS_REQUIRED');
    const winning = result[0].status === 'fulfilled' ? first : second;
    await until(() => winning.pair.every((c) => c.state?.phase === 'write'));
    assert.deepEqual((await DB.prepare('SELECT user_id,game FROM trials ORDER BY user_id').all()).results,
      [{ user_id: `device:${deviceId}`, game: 'fabraka' }, { user_id: ownerId, game: 'fabraka' }].sort((a, b) => a.user_id.localeCompare(b.user_id)));
    const view = JSON.stringify(winning.pair[1].state);
    for (const secret of [deviceId, ownerId, 'roomTrialGate', 'roomTrialClaim']) assert.equal(view.includes(secret), false);
    assert.equal(winning.pair[0].state.trialOwnerId, winning.profiles[0].id);
    assert.equal(winning.pair[0].state.trialStarted, true);
    assert.equal((await api('/api/rooms', { ...newCredentials(), name: 'المضيف', avatar: 0, game: 'fabraka', deviceId })).body.error, 'PLUS_REQUIRED');
    const [host, guest] = winning.pair;
    for (let round = 1; round <= 3; round++) {
      const q = questions.find((q) => q.text === host.state.question.text); assert.ok(q);
      await host.command('lie', { text: 'خدعة المضيف' });
      assert.equal(JSON.stringify(guest.state).includes('خدعة المضيف'), false);
      await guest.command('lie', { text: 'خدعة الضيف' });
      await until(() => winning.pair.every((c) => c.state.phase === 'vote'));
      const truth = host.state.options.find((o) => o.text === q.answer).id;
      assert.equal(host.state.options.filter((o) => !o.mine).length, 3);
      await assert.rejects(host.command('vote', { optionId: host.state.options.find((o) => o.mine).id }), (e) => e.code === 'OWN_ANSWER');
      await host.command('vote', { optionId: truth }); await guest.command('vote', { optionId: truth });
      while (host.state.phase === 'reveal') await host.command(host.state.reveal.shown ? 'next_reveal' : 'reveal');
      assert.equal(host.state.phase, 'result'); await host.command('next');
    }
    assert.equal(host.state.phase, 'over'); assert.deepEqual(host.state.members.map((m) => m.score), [3000, 3000]);
    await host.command('restart'); await guest.command('ready', { ready: true }); await host.command('start');
    assert.equal(host.state.phase, 'write', 'rematch in the already-started room preserves existing allowance');
    await deleteUser({ DB }, ownerId);
    assert.equal(await DB.prepare('SELECT 1 FROM online_room_trial_claims WHERE user_id=?').bind(ownerId).first(), null);
    assert.ok(await DB.prepare('SELECT 1 FROM trials WHERE user_id=?').bind(`device:${deviceId}`).first(), 'existing device trial policy remains');
    await DB.prepare('UPDATE online_room_trial_claims SET created_at=?').bind(Date.now() - 2 * 86400000).run();
    await cleanup({ DB });
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM online_room_trial_claims').first()).n, 0);
    assert.ok(await DB.prepare('SELECT 1 FROM trials WHERE user_id=?').bind(`device:${deviceId}`).first(), 'claim cleanup never restores a spent trial');
  } finally { clients.forEach((c) => c.stop()); if (mf) await mf.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('a consumed start retries after a Durable Object storage failure and full Fabraka invitations stop at eight seats', { timeout: 20_000 }, async (t) => {
  const app = await startLocalServer({ port: 0, vars: {} }); t.after(() => app.close());
  const api = transport(app.url), clients = []; t.after(() => clients.forEach((c) => c.stop()));
  const joined = await joinedPair(app.url, api, clients, { deviceId: 'e'.repeat(32) });
  await joined.pair[1].command('ready', { ready: true });
  const item = app.rooms.get(joined.code), transaction = item.storage.transaction.bind(item.storage);
  let fail = true;
  item.storage.transaction = async (fn) => { if (fail) { fail = false; throw new Error('test storage failure'); } return transaction(fn); };
  await assert.rejects(joined.pair[0].command('start'), (e) => e.code === 'INTERNAL');
  assert.equal(joined.pair[0].state.phase, 'lobby');
  assert.equal((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM trials').first()).n, 1);
  await joined.pair[0].command('start'); assert.equal(joined.pair[0].state.phase, 'write');
  const full = await api('/api/rooms', { ...newCredentials(), name: 'مدير', avatar: 0, game: 'fabraka' });
  const record = app.rooms.get(full.body.code); await record.instance.ready;
  record.instance.room.members[0].accountUserId = 'account-inviter';
  for (let n = 1; n < 8; n++) assert.equal((await api(`/api/rooms/${full.body.code}/join`, { ...newCredentials(), name: `عضو ${n}`, avatar: n % 4 })).status, 200);
  const status = await app.env.ROOMS.get(full.body.code).fetch(new Request('https://room.internal/social-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountUserId: 'account-inviter' }) }));
  assert.equal(status.status, 409); assert.equal((await status.json()).error, 'FULL_FABRAKA');
});

test('host transfer cannot spend a departed creator free trial, but the creator active subscription still supports the room', { timeout: 20_000 }, async (t) => {
  const app = await startLocalServer({ port: 0, vars: { AUTH_DEV_FAKE: '1', SESSION_SECRET: 'transfer-test-key' } }); t.after(() => app.close());
  const publicApi = transport(app.url), clients = []; t.after(() => clients.forEach((c) => c.stop()));
  const signed = await publicApi('/api/auth/dev', { subject: 'transfer-owner', name: 'منشئ الغرفة' });
  const ownerApi = transport(app.url, signed.body.session.token), ownerId = signed.body.me.user.id;
  async function transferred(body = {}) {
    const group = await joinedPair(app.url, ownerApi, clients, body);
    const third = { ...newCredentials(), name: 'صديق ثالث', avatar: 2 };
    assert.equal((await publicApi(`/api/rooms/${group.code}/join`, third)).status, 200);
    const client = new RoomClient({ server: app.url, code: group.code, session: third, WebSocketImpl: BrowserSocket }); clients.push(client); client.start();
    await until(() => client.connectionStatus === 'connected' && group.pair[1].state?.members.length === 3);
    await group.pair[1].command('ready', { ready: true }); await client.command('ready', { ready: true });
    assert.equal((await publicApi(`/api/rooms/${group.code}/leave`, group.profiles[0])).status, 200);
    await until(() => group.pair[1].state.hostId === group.profiles[1].id);
    return group;
  }
  const free = await transferred({ deviceId: 'f'.repeat(32) });
  await assert.rejects(free.pair[1].command('start'), (error) => error.code === 'TRIAL_OWNER_LEFT');
  assert.equal(free.pair[1].state.phase, 'lobby');
  assert.equal((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM trials').first()).n, 0);
  assert.equal((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM online_room_trial_claims').first()).n, 0);
  assert.match(errorText('TRIAL_OWNER_LEFT'), /منشئ الغرفة غادر/);
  assert.equal((await ownerApi('/api/dev/grant', { until: Date.now() + 86400000 })).status, 200);
  const premium = await transferred({ deviceId: 'f'.repeat(32) });
  await premium.pair[1].command('start'); assert.equal(premium.pair[1].state.phase, 'write');
  assert.ok(await app.env.DB.prepare('SELECT 1 FROM trials WHERE user_id=?').bind(ownerId).first());
});
