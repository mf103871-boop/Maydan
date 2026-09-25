import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WebSocket } from 'ws';
import { migrationSql } from '../server/local-d1.mjs';
import { notifyUsers, routeSocialLive, forgetSocialUser } from '../server/social/realtime.mjs';

async function until(check, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out: ${label}`);
}

test('social live is optional and notification delivery cannot fail a saved mutation', async () => {
  const url = new URL('https://example.test/api/me');
  assert.equal(await routeSocialLive(new Request(url), {}, url), null);
  const ticket = new URL('https://example.test/api/social/live-ticket');
  const response = await routeSocialLive(new Request(ticket, { method: 'POST' }), {}, ticket);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'SOCIAL_UNAVAILABLE' });
  await notifyUsers({}, ['user-a'], { type: 'refresh' });
  await notifyUsers({ SOCIAL_HUB: { idFromName() { throw new Error('offline'); } } }, ['user-a'], { type: 'refresh' });
  await notifyUsers({ SOCIAL_HUB: { idFromName: (id) => id, get: () => ({ fetch: async () => { throw new Error('offline'); } }) } }, ['user-a'], { type: 'refresh' });
  await forgetSocialUser({}, 'user-a');
  await forgetSocialUser({ SOCIAL_HUB: { idFromName() { throw new Error('offline'); } } }, 'user-a');
});

test('workerd social tickets, presence, hibernation, typing authorization and revocation', { timeout: 60_000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maydan-social-realtime-'));
  const scriptPath = path.join(dir, 'worker.mjs');
  const sockets = [];
  let mf;
  try {
    // Only the test subclass has clock controls. The real DO handlers, storage,
    // D1 queries and hibernation transport execute unchanged inside workerd.
    await build({ stdin: { resolveDir: process.cwd(), sourcefile: 'social-realtime-harness.mjs', contents: `
      import { SocialHub, routeSocialLive, notifyUsers, forgetSocialUser } from './server/social/realtime.mjs';
      import { json, errorResponse } from './server/protocol.mjs';
      export class TestSocialHub extends SocialHub {
        constructor(ctx,env) { super(ctx,env); this.ready = this.ready.then(async()=>{ this.offset = await ctx.storage.get('__testClock') || 0; }); }
        now() { return Date.now() + (this.offset || 0); }
        async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === '/__test/advance') {
            await this.serial(async () => {
              this.offset = (this.offset || 0) + Number(url.searchParams.get('ms'));
              await this.ctx.storage.put('__testClock',this.offset);
              await this.ctx.storage.setAlarm(Date.now()+1);
            });
            return json({ ok: true });
          }
          if (url.pathname === '/__test/state') return this.serial(async () => json({
            tickets: Object.keys(this.state.tickets).length,
            owner: this.state.userId,
            stored: !!(await this.ctx.storage.get('social')),
            connections: this.ctx.getWebSockets().map(ws => ({ readyState: ws.readyState, closed: !!this.attachment(ws).closed, sessionId: this.attachment(ws).sessionId || null }))
          }));
          if (url.pathname === '/__test/late-close') {
            for (const ws of this.ctx.getWebSockets()) await this.webSocketClose(ws);
            return json({ ok: true });
          }
          return super.fetch(request);
        }
      }
      export default { async fetch(request, env) {
        const url = new URL(request.url);
        try {
          if (url.pathname === '/__test/notify') { const b = await request.json(); await notifyUsers(env, b.users, b.event); return json({ ok: true }); }
          if (url.pathname === '/__test/forget') { const b = await request.json(); await forgetSocialUser(env, b.userId); return json({ ok: true }); }
          return await routeSocialLive(request, env, url) || json({ error: 'NOT_FOUND' }, 404);
        } catch (error) { return errorResponse(error); }
      }};
    ` }, bundle: true, format: 'esm', platform: 'browser', outfile: scriptPath, logLevel: 'silent' });
    mf = new Miniflare(convertV4MiniflareOptions({ rootPath: dir, name: 'social-realtime-test', modules: true, scriptPath,
      compatibilityDate: '2026-09-01', durableObjects: { SOCIAL_HUB: { className: 'TestSocialHub', useSQLite: true } },
      d1Databases: { DB: 'social-realtime-db' }, port: 0, host: '127.0.0.1', cf: false }));
    const origin = (await mf.ready).origin;
    const db = await mf.getD1Database('DB');
    await db.exec(migrationSql());
    const namespace = await mf.getDurableObjectNamespace('SOCIAL_HUB');
    const fetch = (pathname, init) => mf.dispatchFetch('http://example.test' + pathname, init);
    const query = (sql, ...args) => db.prepare(sql).bind(...args);
    const profile = (id) => query('SELECT * FROM social_profiles WHERE user_id=?', id).first();
    async function session(id = randomUUID(), { stale = false, existing = false } = {}) {
      const now = Date.now();
      if (!existing) await query('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)', id, id, now, now).run();
      const sid = randomBytes(8).toString('hex');
      const secret = randomBytes(32).toString('base64url');
      await query('INSERT INTO sessions(id,user_id,secret_hash,client,created_at,last_seen,expires_at) VALUES(?,?,?,?,?,?,?)',
        sid, id, createHash('sha256').update(secret).digest('hex'), 'web', now - (stale ? 90_000_000 : 0), now - (stale ? 90_000_000 : 0), now + 86400_000).run();
      return { id, sid, token: `mdn1.${sid}.${secret}` };
    }
    async function ticket(s) {
      const response = await fetch('/api/social/live-ticket', { method: 'POST', headers: { authorization: 'Bearer ' + s.token } });
      const value = await response.json();
      assert.equal(response.status, 200, JSON.stringify(value));
      return { ...value, rotated: response.headers.get('x-maydan-session') };
    }
    const connectResponse = (value, userId = value.userId) => fetch(`/api/social/socket?userId=${encodeURIComponent(userId)}&ticket=${encodeURIComponent(value.ticket)}`, { headers: { upgrade: 'websocket' } });
    async function watch(response) {
      assert.equal(response.status, 101, response.status === 101 ? '' : await response.text());
      const ws = response.webSocket;
      const client = { ws, messages: [], closed: false, closeCode: null };
      ws.addEventListener('message', ({ data }) => { try { client.messages.push(JSON.parse(data)); } catch { client.messages.push(data); } });
      ws.addEventListener('close', ({ code }) => { client.closed = true; client.closeCode = code; });
      ws.accept();
      sockets.push(client);
      await until(() => client.messages.some((m) => m.type === 'ready'), 'socket ready');
      return client;
    }
    const open = async (s) => watch(await connectResponse(await ticket(s)));
    async function openNetwork(s) {
      const value = await ticket(s);
      const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/api/social/socket?userId=${value.userId}&ticket=${value.ticket}`);
      const client = { ws, messages: [], closed: false, closeCode: null };
      ws.on('message', (data) => { try { client.messages.push(JSON.parse(data)); } catch { client.messages.push(String(data)); } });
      ws.on('close', (code) => { client.closed = true; client.closeCode = code; });
      sockets.push(client);
      await until(() => client.messages.some((m) => m.type === 'ready'), 'network socket ready');
      return client;
    }
    const control = (id, ms) => namespace.get(namespace.idFromName(id)).fetch(`https://social.internal/__test/advance?ms=${ms}`);
    const typing = (c, peerId, active = true, extra = {}) => c.ws.send(JSON.stringify({ type: 'typing', peerId, active, ...extra }));
    async function friend(a, b, status = 'accepted') {
      const [low, high] = [a.id, b.id].sort();
      await query('INSERT INTO social_friendships(id,user_low,user_high,requester_id,status,created_at,accepted_at) VALUES(?,?,?,?,?,?,?)',
        randomUUID(), low, high, a.id, status, Date.now(), status === 'accepted' ? Date.now() : null).run();
    }
    const notify = (users, event) => fetch('/__test/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ users, event }) });

    await t.test('ticket requires auth, is user-bound, is single-use even under concurrency, and carries no session secret', async () => {
      assert.equal((await fetch('/api/social/live-ticket', { method: 'POST' })).status, 401);
      const a = await session(); const b = await session();
      const start = Date.now(); const value = await ticket(a);
      assert.match(value.ticket, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(value.userId, a.id);
      // workerd caches request time; its clock and Node's wall clock can differ
      // slightly. The separate expiry test exercises the exact 60-second limit.
      assert.ok(value.expiresAt >= start + 59_000 && value.expiresAt <= Date.now() + 61_000);
      assert.equal(JSON.stringify(value).includes(a.token), false);
      assert.equal(JSON.stringify(value).includes(a.sid), false);
      assert.equal((await connectResponse(value, b.id)).status, 401);
      const responses = await Promise.all([connectResponse(value), connectResponse(value)]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [101, 401]);
      const client = await watch(responses.find((r) => r.status === 101));
      assert.equal((await connectResponse(value)).status, 401);
      assert.equal((await fetch(`/api/social/socket?userId=${a.id}&ticket=${a.token}`, { headers: { upgrade: 'websocket' } })).status, 401);
      client.ws.close();
    });

    await t.test('expired tickets are pruned, unopened tickets never imply presence, and pending tickets are bounded', async () => {
      const a = await session(); const value = await ticket(a);
      assert.equal(await profile(a.id), null);
      for (let i = 1; i < 8; i++) await ticket(a);
      assert.equal((await fetch('/api/social/live-ticket', { method: 'POST', headers: { authorization: 'Bearer ' + a.token } })).status, 429);
      await control(a.id, 60_001);
      assert.equal((await connectResponse(value)).status, 401);
      const state = await namespace.get(namespace.idFromName(a.id)).fetch('https://social.internal/__test/state');
      assert.equal((await state.json()).tickets, 0);
      assert.equal(await profile(a.id), null);
    });

    await t.test('multiple tabs and devices, heartbeat, close, 45-second silence and hibernation preserve presence correctly', async () => {
      const a = await session(); const device = await session(a.id, { existing: true });
      const first = await openNetwork(a); const second = await openNetwork(device);
      const initial = await profile(a.id);
      assert.ok(initial.online_until > Date.now());
      first.ws.close();
      await until(() => first.closed, 'first tab closed');
      assert.ok((await profile(a.id)).online_until > Date.now());
      await mf.unsafeEvictDurableObject('social-realtime-test', 'TestSocialHub', { name: a.id, webSockets: 'hibernate' });
      second.ws.send('ping');
      await until(() => second.messages.includes('pong'), 'heartbeat after hibernation');
      assert.ok((await profile(a.id)).last_active_at >= initial.last_active_at);
      second.ws.close();
      await until(async () => (await profile(a.id)).online_until === 0, 'last tab immediately offline');
      assert.ok((await profile(a.id)).last_active_at >= initial.last_active_at);
      const silent = await openNetwork(a);
      const lastSeen = (await profile(a.id)).last_active_at;
      await control(a.id, 45_001);
      await until(async () => (await profile(a.id)).online_until === 0, 'alarm clears silent presence');
      const state = await namespace.get(namespace.idFromName(a.id)).fetch('https://social.internal/__test/state');
      // An unreachable client may not complete the close handshake. It must
      // already be excluded from presence and unable to revive its connection.
      assert.ok((await state.json()).connections.every((c) => c.closed && c.readyState !== 1));
      assert.equal((await profile(a.id)).online_until, 0);
      assert.equal((await profile(a.id)).last_active_at, lastSeen);
      silent.ws.close();
    });

    await t.test('presence refresh reaches friends; typing ignores forged identity, rejects pending/nonfriends and blocks in both directions', async () => {
      const a = await session(); const b = await session(); const c = await session(); const pending = await session();
      await friend(a, b); await friend(a, pending, 'pending');
      const bob = await open(b); const carol = await open(c); const alice = await open(a);
      await until(() => bob.messages.some((m) => m.type === 'refresh' && m.reason === 'presence' && m.userId === a.id), 'friend presence');
      const presenceCount = bob.messages.filter((m) => m.reason === 'presence' && m.userId === a.id).length;
      alice.ws.send('ping');
      await until(() => alice.messages.includes('pong'), 'heartbeat persists without another presence broadcast');
      // Drain the receiver's queue after the sender has completed the heartbeat.
      await notify([b.id], { type: 'refresh', reason: 'test-barrier' });
      assert.equal(bob.messages.filter((m) => m.reason === 'presence' && m.userId === a.id).length, presenceCount);
      typing(alice, b.id, true, { userId: c.id });
      await until(() => bob.messages.some((m) => m.type === 'typing'), 'friend typing');
      assert.deepEqual(bob.messages.find((m) => m.type === 'typing'), { type: 'typing', userId: a.id, active: true });
      typing(alice, c.id);
      await until(() => alice.messages.some((m) => m.error === 'SOCIAL_FORBIDDEN'), 'nonfriend rejected');
      assert.equal(carol.messages.some((m) => m.type === 'typing'), false);
      alice.messages.length = 0;
      typing(alice, pending.id);
      await until(() => alice.messages.some((m) => m.error === 'SOCIAL_FORBIDDEN'), 'pending friendship rejected');
      const delivered = bob.messages.filter((m) => m.type === 'typing').length;
      for (const [blocker, blocked] of [[a, b], [b, a]]) {
        await control(a.id, 1100);
        await query('INSERT INTO social_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)', blocker.id, blocked.id, Date.now()).run();
        alice.messages.length = 0; typing(alice, b.id);
        await until(() => alice.messages.some((m) => m.error === 'SOCIAL_FORBIDDEN'), 'blocked typing rejected');
        assert.equal(bob.messages.filter((m) => m.type === 'typing').length, delivered);
        // A queued typing notification is rechecked on the receiving object too.
        await notify([b.id], { type: 'typing', userId: a.id, active: true });
        assert.equal(bob.messages.filter((m) => m.type === 'typing').length, delivered);
        await query('DELETE FROM social_blocks WHERE blocker_id=? AND blocked_id=?', blocker.id, blocked.id).run();
      }
      await control(a.id, 1100);
      alice.messages.length = 0;
      for (const active of [true, false, true, false]) typing(alice, b.id, active);
      await until(() => bob.messages.filter((m) => m.type === 'typing').length === delivered + 4, 'rapid compose and stop cycles reach peer');
      assert.equal(bob.messages.filter((m) => m.type === 'typing').at(-1).active, false);
      assert.equal(alice.messages.some((m) => m.error === 'RATE_LIMIT'), false);
      await control(a.id, 1100);
      alice.messages.length = 0;
      for (let i = 0; i < 4; i++) typing(alice, b.id, true);
      await until(() => alice.messages.some((m) => m.error === 'RATE_LIMIT'), 'typing rate bounded');
      await until(() => bob.messages.filter((m) => m.type === 'typing').length === delivered + 7, 'only allowed typing starts delivered');
      typing(alice, b.id, false);
      await until(() => bob.messages.filter((m) => m.type === 'typing').length === delivered + 8, 'stop still delivered after start rate limit');
      assert.equal(bob.messages.filter((m) => m.type === 'typing').at(-1).active, false);
      alice.ws.close(); bob.ws.close(); carol.ws.close();
    });

    await t.test('revocation is checked at upgrade, heartbeat and outbound delivery; another device remains valid', async () => {
      const pre = await session(); const unused = await ticket(pre);
      await query('UPDATE sessions SET revoked_at=? WHERE id=?', Date.now() - 1, pre.sid).run();
      assert.equal((await connectResponse(unused)).status, 401);
      const a = await session(); const other = await session(a.id, { existing: true });
      const revoked = await open(a); const active = await open(other);
      await query('UPDATE sessions SET revoked_at=? WHERE id=?', Date.now() - 1, a.sid).run();
      revoked.ws.send('ping');
      await until(() => revoked.closed, 'revoked session closes on heartbeat');
      assert.equal(revoked.closeCode, 4401);
      active.ws.send(JSON.stringify({ type: 'ping' }));
      await until(() => active.messages.some((m) => m.type === 'pong'), 'other device remains authenticated');
      assert.ok((await profile(a.id)).online_until > Date.now());
      await query('UPDATE sessions SET revoked_at=? WHERE id=?', Date.now() - 1, other.sid).run();
      await notify([a.id], { type: 'refresh', reason: 'messages', marker: 'must-not-deliver' });
      await until(() => active.closed, 'revocation closes before outbound event');
      assert.equal(active.messages.some((m) => m.marker === 'must-not-deliver'), false);
      await until(async () => (await profile(a.id)).online_until === 0, 'revoked devices offline');
    });

    await t.test('rotation binds ticket to new session and deleting account stops live delivery', async () => {
      const a = await session(undefined, { stale: true }); const value = await ticket(a);
      assert.ok(value.rotated);
      const nextId = value.rotated.split('.')[1];
      assert.notEqual(nextId, a.sid);
      await query('UPDATE sessions SET revoked_at=? WHERE id=?', Date.now() - 1, a.sid).run();
      const client = await watch(await connectResponse(value));
      client.ws.send('ping');
      await until(() => client.messages.includes('pong'), 'new session remains live');
      await query('INSERT INTO account_deletions(user_id,attempt_id,created_at) VALUES(?,?,?)', a.id, randomUUID(), Date.now()).run();
      client.ws.send('ping');
      await until(() => client.closed, 'deleting account loses socket auth');
      assert.equal(client.closeCode, 4401);
    });

    await t.test('account deletion forgets tickets and metadata; late close events cannot restore them', async () => {
      const a = await session(); const client = await open(a); const unused = await ticket(a);
      const object = namespace.get(namespace.idFromName(a.id));
      const forget = () => object.fetch('https://social.internal/forget', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: a.id }) });
      assert.equal((await forget()).status, 409, 'an existing account cannot be forgotten without a deletion reservation');
      assert.equal((await (await object.fetch('https://social.internal/__test/state')).json()).tickets, 1);
      await query('INSERT INTO account_deletions(user_id,attempt_id,created_at) VALUES(?,?,?)', a.id, randomUUID(), Date.now()).run();
      assert.equal((await forget()).status, 200);
      const closedState = await (await object.fetch('https://social.internal/__test/state')).json();
      assert.ok(closedState.connections.every((c) => c.closed && c.readyState !== 1 && c.sessionId === null));
      client.ws.close();
      // Deliver a late close callback explicitly; the transport's own closing
      // handshake may complete later, after the account state is already gone.
      await object.fetch('https://social.internal/__test/late-close');
      assert.equal((await connectResponse(unused)).status, 401);
      let state = await (await object.fetch('https://social.internal/__test/state')).json();
      assert.equal(state.owner, null); assert.equal(state.stored, false); assert.equal(state.tickets, 0);
      assert.ok(state.connections.every((c) => c.closed && c.readyState !== 1));
      // Even a later broadcast/close or a rejected ticket cannot save the old ID.
      await notify([a.id], { type: 'refresh', marker: 'after-deletion' });
      assert.equal((await fetch('/api/social/live-ticket', { method: 'POST', headers: { authorization: 'Bearer ' + a.token } })).status, 401);
      state = await (await object.fetch('https://social.internal/__test/state')).json();
      assert.equal(state.owner, null); assert.equal(state.stored, false);
      assert.equal(client.messages.some((m) => m.marker === 'after-deletion'), false);
    });

    await t.test('maintenance alarm removes idle metadata if account deletion notification was lost', async () => {
      const a = await session(); const client = await open(a);
      const object = namespace.get(namespace.idFromName(a.id));
      client.ws.close();
      await until(async () => (await profile(a.id)).online_until === 0, 'idle account disconnected');
      assert.equal((await (await object.fetch('https://social.internal/__test/state')).json()).stored, true);
      await query('DELETE FROM users WHERE id=?', a.id).run();
      // Simulate the maintenance deadline; no explicit forget notification arrives.
      await control(a.id, 86_400_001);
      await until(async () => !(await (await object.fetch('https://social.internal/__test/state')).json()).stored, 'maintenance clears deleted account');
      const state = await (await object.fetch('https://social.internal/__test/state')).json();
      assert.equal(state.owner, null); assert.equal(state.tickets, 0);
      await fetch('/__test/forget', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: a.id }) });
      assert.equal((await (await object.fetch('https://social.internal/__test/state')).json()).stored, false);
    });
  } finally {
    for (const c of sockets) { try { c.ws.close(); } catch { /* already closed */ } }
    if (mf) await mf.dispose();
    const resolved = path.resolve(dir);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('maydan-social-realtime-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
