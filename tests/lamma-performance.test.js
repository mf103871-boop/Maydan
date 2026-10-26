import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { MemoryStorage } from '../server/local.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeRequest, RequestLimiter, LIMITS } from '../server/worker.mjs';
import { routeSocial } from '../server/social/router.mjs';
import { notifyCall } from '../server/lamma/calls.mjs';
import { SocialHub, allowsRealtimeContent } from '../server/social/realtime.mjs';
import { lammaPollDue, refreshesLamma, rechecksCall } from '../src/social/sync-policy.js';

const origin = 'https://maydan.test';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('response waited for blocked notification transport')), 2000); })]); }
  finally { clearTimeout(timer); }
}
async function fixture(t) {
  const DB = createLocalD1(), stores = new Map();
  const env = { DB, ALLOWED_ORIGINS: origin, LIMITERS: { idFromName: id => id, get: id => {
    if (!stores.has(id)) {
      const storage = new MemoryStorage();
      stores.set(id, { storage, limiter: new RequestLimiter({ storage }) });
    }
    return { fetch: request => stores.get(id).limiter.fetch(request) };
  } } };
  t.after(() => { DB.close(); for (const { storage } of stores.values()) storage.dispose(); });
  const user = async () => {
    const value = await createUser(env, { name: 'اختبار لمة', email: `${crypto.randomUUID()}@example.test` });
    const session = await issueSession(env, value.id);
    return { ...value, token: session.token, sid: session.id };
  };
  const request = (u, path, method = 'GET', body, ip = '192.0.2.10') => new Request(`${origin}/api/social${path}`, {
    method, headers: { origin, 'cf-connecting-ip': ip, authorization: `Bearer ${u.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const api = (u, path, method, body, context) => { const req = request(u, path, method, body); return routeSocial(req, env, new URL(req.url), undefined, context); };
  const query = (sql, ...args) => DB.prepare(sql).bind(...args);
  const friends = async (a, b) => {
    const [low, high] = [a.id, b.id].sort(), now = Date.now(), conversation = crypto.randomUUID();
    await query("INSERT INTO social_friendships(id,user_low,user_high,requester_id,status,created_at,accepted_at) VALUES(?,?,?,?,'accepted',?,?)", crypto.randomUUID(), low, high, a.id, now, now).run();
    await query('INSERT INTO social_conversations(id,user_low,user_high,created_at) VALUES(?,?,?,?)', conversation, low, high, now).run();
    return conversation;
  };
  const group = async (owner, members) => {
    const response = await api(owner, '/groups', 'POST', { name: 'شلّة الفحص' });
    const id = (await response.json()).group.id;
    for (const member of members) await query("INSERT INTO social_group_members(group_id,user_id,role,joined_at) VALUES(?,?,'member',?)", id, member.id, Date.now()).run();
    return id;
  };
  return { env, DB, stores, user, request, api, query, friends, group };
}

test('twelve accounts sharing Wi-Fi retain separate read quotas; changing IP/session cannot reset an account quota', async t => {
  const h = await fixture(t), users = [];
  for (let i = 0; i < 12; i++) users.push(await h.user());
  // The old foreground iPhone flow generated forty reads/minute before a
  // message was sent. Exercise the real routed quota with that worst case.
  for (let tick = 0; tick < 40; tick++) {
    const responses = await Promise.all(users.map(u => routeRequest(h.request(u, '/capabilities'), h.env)));
    assert.ok(responses.every(response => response.status === 200));
  }
  const records = await Promise.all([...h.stores.values()].map(async ({ storage }) => ({ read: await storage.get('socialRead'), ip: await storage.get('socialReadIP') })));
  assert.deepEqual(records.filter(r => r.read).map(r => r.read.count), Array(12).fill(40));
  assert.equal(records.find(r => r.ip).ip.count, 480);
  const alice = users[0];
  for (let i = 40; i < LIMITS.socialRead; i++) assert.equal((await routeRequest(h.request(alice, '/capabilities'), h.env)).status, 200);
  assert.equal((await routeRequest(h.request(alice, '/capabilities'), h.env)).status, 429);
  const newSession = await issueSession(h.env, alice.id);
  assert.equal((await routeRequest(h.request({ ...alice, token: newSession.token }, '/capabilities', 'GET', undefined, '198.51.100.42'), h.env)).status, 429);
  assert.equal((await routeRequest(h.request(users[1], '/capabilities'), h.env)).status, 200);
  const buckets = h.stores.size;
  const forged = { token: `mdn1.${'a'.repeat(16)}.${'b'.repeat(43)}` };
  assert.equal((await routeRequest(h.request(forged, '/capabilities'), h.env)).status, 401);
  assert.equal(h.stores.size, buckets, 'unverified bearer must not select a new account bucket');
});

test('shared-WiFi writes remain usable for a party while preserving account and network flood guards', async t => {
  // Account quotas use fixed minute windows. Keep this burst in one window;
  // wall-clock rollover during CI must not be mistaken for a missing limit.
  let now = Math.floor(Date.now() / 60_000) * 60_000 + 1000;
  t.mock.method(Date, 'now', () => now);
  const h = await fixture(t), users = [];
  for (let i = 0; i < 12; i++) users.push(await h.user());
  for (let i = 0; i < 6; i++) {
    const responses = await Promise.all(users.map(u => routeRequest(h.request(u, '/preferences', 'PUT', { previews: false }), h.env)));
    assert.ok(responses.every(response => response.status === 200), 'seventy-two legitimate writes must not exhaust one shared IP');
  }
  for (let i = 6; i < 120; i++) assert.equal((await routeRequest(h.request(users[0], '/preferences', 'PUT', { previews: false }), h.env)).status, 200);
  assert.equal((await routeRequest(h.request(users[0], '/preferences', 'PUT', { previews: false }), h.env)).status, 429);
  now += 60_000;
  assert.equal((await routeRequest(h.request(users[0], '/preferences', 'PUT', { previews: false }), h.env)).status, 200, 'the next minute resets the account quota');
  const storage = new MemoryStorage(); t.after(() => storage.dispose());
  const limiter = new RequestLimiter({ storage });
  for (let i = 0; i < LIMITS.socialReadIP; i++) assert.equal((await limiter.fetch(new Request('https://internal', { method: 'POST', body: JSON.stringify({ kind: 'socialReadIP' }) }))).status, 200);
  assert.equal((await limiter.fetch(new Request('https://internal', { method: 'POST', body: JSON.stringify({ kind: 'socialReadIP' }) }))).status, 429);
});

test('message acknowledgement does not wait for held fanout or push wake; canonical messages and jobs are durable first', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user();
  const direct = await h.friends(a, b), group = await h.group(a, [b]);
  const gate = deferred(), pending = [], requests = [];
  h.env.SOCIAL_HUB = { idFromName: id => id, get: id => ({ fetch: async request => { requests.push({ id, ...await request.json() }); await gate.promise; return Response.json({}); } }) };
  h.env.SOCIAL_JOBS = { idFromName: id => id, get: () => ({ fetch: async () => { await gate.promise; return Response.json({}); } }) };
  const context = { waitUntil: task => pending.push(task) };
  try {
    for (const [scope, id] of [['direct', direct], ['group', group]]) {
      const path = scope === 'group' ? `/groups/${id}/messages` : `/conversations/${id}/messages`;
      const response = await bounded(h.api(a, path, 'POST', { text: `رسالة ${scope}`, clientId: crypto.randomUUID() }, context));
      assert.equal(response.status, 200);
      const { message } = await response.json();
      assert.ok(Number.isSafeInteger(message.seq));
      assert.equal(message.senderId, a.id);
      const table = scope === 'group' ? 'social_group_messages' : 'social_messages';
      assert.equal((await h.query(`SELECT text FROM ${table} WHERE seq=?`, message.seq).first()).text, `رسالة ${scope}`);
    }
    assert.equal(pending.length, 2);
    assert.equal((await h.query("SELECT COUNT(*) AS n FROM social_jobs WHERE kind='push'").first()).n, 2);
  } finally { gate.resolve(); await Promise.all(pending); }
  assert.equal(requests.length, 4);
});

test('local delivery without a Worker execution context remains awaited and a blocked recipient receives no call metadata', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(), conversation = await h.friends(a, b);
  const gate = deferred(), entered = deferred(); let complete = false;
  h.env.SOCIAL_HUB = { idFromName: id => id, get: () => ({ fetch: async () => { entered.resolve(); await gate.promise; return Response.json({}); } }) };
  const sending = h.api(a, `/conversations/${conversation}/messages`, 'POST', { text: 'تسليم محلي', clientId: crypto.randomUUID() }).then(response => { complete = true; return response; });
  try { await bounded(entered.promise); assert.equal(complete, false); }
  finally { gate.resolve(); }
  assert.equal((await sending).status, 200);
  const group = await h.group(a, [b]), callId = crypto.randomUUID(), now = Date.now();
  await h.query("INSERT INTO social_calls(id,scope,conversation_id,initiator_id,client_id,status,created_at,ring_until,expires_at,room_name) VALUES(?,'group',?,?,?,'active',?,?,?,?)", callId, group, a.id, crypto.randomUUID(), now, now + 45000, now + 60000, `lamma-${callId}`).run();
  for (const u of [a, b]) await h.query("INSERT INTO social_call_participants(call_id,user_id,state,device_id,joined_at) VALUES(?,?,'active',?,?)", callId, u.id, `device-${u.id}`, now).run();
  await h.query('INSERT INTO social_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)', b.id, a.id, now).run();
  const notified = [];
  h.env.SOCIAL_HUB.get = id => ({ fetch: async () => { notified.push(id); return Response.json({}); } });
  await notifyCall(h.env, callId, 'accepted');
  assert.deepEqual(notified, []);
});

test('call credentials return before slow recipient fanout and push wake; the cold-answer path still authenticates', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(), conversation = await h.friends(a, b);
  Object.assign(h.env, { LIVEKIT_URL: 'wss://test.livekit.cloud', LIVEKIT_API_KEY: 'test-key', LIVEKIT_API_SECRET: 'test-secret' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const gate = deferred(), pending = [];
  h.env.SOCIAL_HUB = { idFromName: id => id, get: () => ({ fetch: async () => { await gate.promise; return Response.json({}); } }) };
  h.env.SOCIAL_JOBS = { idFromName: id => id, get: () => ({ fetch: async () => { await gate.promise; return Response.json({}); } }) };
  const context = { waitUntil: task => pending.push(task) };
  try {
    const created = await bounded(h.api(a, '/calls', 'POST', { scope: 'direct', conversationId: conversation, clientId: crypto.randomUUID(), deviceId: 'device-alpha' }, context));
    assert.equal(created.status, 200); const start = await created.json();
    assert.equal(start.connection.url, h.env.LIVEKIT_URL);
    assert.equal((await h.query("SELECT COUNT(*) AS n FROM social_jobs WHERE kind IN ('push','call_expire')").first()).n, 2);
    const answer = await bounded(h.api(b, `/calls/${start.call.id}/accept`, 'POST', { deviceId: 'device-beta' }, context));
    assert.equal(answer.status, 200); assert.ok((await answer.json()).connection.token);
    assert.equal(pending.length, 2);
    assert.equal((await h.query('SELECT status FROM social_calls WHERE id=?', start.call.id).first()).status, 'active');
  } finally { gate.resolve(); await Promise.all(pending); }
});

test('room invitations return the committed card without waiting for socket or push delivery', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(), conversation = await h.friends(a, b);
  const group = await h.group(a, [b]);
  h.env.ROOMS = { idFromName: id => id, get: () => ({ fetch: async () => Response.json({ game: 'fabraka', expiresAt: Date.now() + 600000 }) }) };
  const gate = deferred(), pending = [];
  h.env.SOCIAL_HUB = { idFromName: id => id, get: () => ({ fetch: async () => { await gate.promise; return Response.json({}); } }) };
  h.env.SOCIAL_JOBS = { idFromName: id => id, get: () => ({ fetch: async () => { await gate.promise; return Response.json({}); } }) };
  const context = { waitUntil: task => pending.push(task) };
  try {
    for (const [scope, conversationId] of [['direct', conversation], ['group', group]]) {
      const response = await bounded(h.api(a, '/room-invitations', 'POST', { scope, conversationId, roomCode: '234567', clientId: crypto.randomUUID() }, context));
      assert.equal(response.status, 200); const result = await response.json();
      assert.equal(result.message.roomInvitation.roomCode, '234567');
      const table = scope === 'direct' ? 'social_messages' : 'social_group_messages';
      assert.equal((await h.query(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 1);
    }
    assert.equal((await h.query("SELECT COUNT(*) AS n FROM social_jobs WHERE kind='push'").first()).n, 2);
  } finally { gate.resolve(); await Promise.all(pending); }
});

test('twelve call recipients are authorized concurrently without omitting an individual visibility check', async t => {
  const h = await fixture(t), users = [];
  for (let i = 0; i < 12; i++) users.push(await h.user());
  const group = await h.group(users[0], users.slice(1)), callId = crypto.randomUUID(), now = Date.now();
  await h.query("INSERT INTO social_calls(id,scope,conversation_id,initiator_id,client_id,status,created_at,ring_until,expires_at,room_name) VALUES(?,'group',?,?,?,'active',?,?,?,?)", callId, group, users[0].id, crypto.randomUUID(), now, now + 45000, now + 60000, `lamma-${callId}`).run();
  for (const u of users) await h.query("INSERT INTO social_call_participants(call_id,user_id,state,device_id,joined_at) VALUES(?,?,'active',?,?)", callId, u.id, `device-${u.id}`, now).run();
  const gate = deferred(), allEntered = deferred(), notified = []; let entered = 0;
  h.env.SOCIAL_HUB = { idFromName: id => id, get: id => ({ fetch: async () => { notified.push(id); return Response.json({}); } }) };
  h.env.DB = { batch: h.DB.batch.bind(h.DB), prepare(sql) {
    const statement = h.DB.prepare(sql);
    if (sql === 'SELECT * FROM social_calls WHERE id=?') {
      const bind = statement.bind.bind(statement);
      statement.bind = (...args) => {
        const bound = bind(...args), first = bound.first.bind(bound);
        bound.first = async () => { if (++entered === 12) allEntered.resolve(); await gate.promise; return first(); };
        return bound;
      };
    }
    return statement;
  } };
  const notification = notifyCall(h.env, callId, 'accepted');
  try { await bounded(allEntered.promise); assert.equal(entered, 12); assert.deepEqual(notified, []); }
  finally { gate.resolve(); await notification; }
  assert.deepEqual(notified.sort(), users.map(u => u.id).sort());
});

test('live sockets reduce safety reads and unrelated typing/messages never trigger extra group or authorization reads', () => {
  let liveReads = 0, fallbackReads = 0, liveAt = 0, fallbackAt = 0;
  for (let now = 15000; now <= 60000; now += 15000) {
    if (lammaPollDue(liveAt, now, true)) { liveReads++; liveAt = now; }
    if (lammaPollDue(fallbackAt, now, false)) { fallbackReads++; fallbackAt = now; }
  }
  assert.equal(liveReads, 1); assert.equal(fallbackReads, 4);
  for (const event of [{ type: 'typing' }, { type: 'pong' }, { type: 'refresh', reason: 'presence' }, { type: 'message', reason: 'message' }]) {
    assert.equal(refreshesLamma(event), false); assert.equal(rechecksCall(event, 'active'), false);
  }
  assert.equal(refreshesLamma({ type: 'group', reason: 'message' }), true);
  assert.equal(rechecksCall({ type: 'group', reason: 'membership' }, 'active'), true);
  assert.equal(rechecksCall({ type: 'refresh', reason: 'blocked' }, 'active'), true);
  assert.equal(rechecksCall({ type: 'call', callId: 'old' }, 'active'), false);
  assert.equal(rechecksCall({ type: 'call', callId: 'active' }, 'active'), true);
});

test('queued receiving-hub delivery rechecks late blocks/removal for message and call metadata while preserving invalidation', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(), direct = await h.friends(a, b), group = await h.group(a, [b]);
  const dm = (await (await h.api(a, `/conversations/${direct}/messages`, 'POST', { text: 'رسالة محمية', clientId: crypto.randomUUID() })).json()).message;
  const gm = (await (await h.api(a, `/groups/${group}/messages`, 'POST', { text: 'رسالة الشلة المحمية', clientId: crypto.randomUUID() })).json()).message;
  const callId = crypto.randomUUID(), now = Date.now();
  await h.query("INSERT INTO social_calls(id,scope,conversation_id,initiator_id,client_id,status,created_at,ring_until,expires_at,room_name) VALUES(?,'group',?,?,?,'active',?,?,?,?)", callId, group, a.id, crypto.randomUUID(), now, now + 45000, now + 60000, `lamma-${callId}`).run();
  for (const u of [a, b]) await h.query("INSERT INTO social_call_participants(call_id,user_id,state,device_id,joined_at) VALUES(?,?,'active',?,?)", callId, u.id, `device-${u.id}`, now).run();
  const events = [
    { type: 'message', reason: 'message', conversationId: direct, messageSeq: dm.seq },
    { type: 'group', reason: 'message', groupId: group, messageSeq: gm.seq },
    { type: 'call', reason: 'accepted', callId },
  ];
  for (const event of events) assert.equal(await allowsRealtimeContent(h.env, b.id, event), true);
  const queued = async (event, mutation) => {
    const storage = new MemoryStorage(), gate = deferred(), entered = deferred(), received = [];
    t.after(() => storage.dispose());
    await storage.put('social', { userId: b.id, lastActiveAt: now, tickets: {}, typingAt: 0, typingCount: 0, onlineBroadcast: true, presenceWrittenAt: now });
    let attachment = { sessionId: b.sid, seenAt: Date.now(), validUntil: Date.now() + 60000 };
    const socket = { readyState: 1, deserializeAttachment: () => attachment, serializeAttachment: value => { attachment = value; }, send: value => received.push(JSON.parse(value)), close() {} };
    const hub = new SocialHub({ storage, blockConcurrencyWhile: fn => fn(), getWebSockets: () => [socket], waitUntil() {} }, h.env);
    const sweep = hub.sweep.bind(hub);
    hub.sweep = async (time, auth) => { if (auth) { entered.resolve(); await gate.promise; } return sweep(time, auth); };
    const delivery = hub.fetch(new Request('https://social.internal/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: b.id, event }) }));
    try { await bounded(entered.promise); await mutation(); }
    finally { gate.resolve(); }
    assert.equal((await delivery).status, 200);
    return received;
  };
  for (const event of events) {
    await h.query('DELETE FROM social_blocks').run();
    assert.deepEqual(await queued(event, () => h.query('INSERT INTO social_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)', b.id, a.id, now).run()), []);
  }
  await h.query('DELETE FROM social_blocks').run();
  for (const event of events.slice(1)) {
    await h.query('UPDATE social_group_members SET left_at=NULL WHERE group_id=? AND user_id=?', group, b.id).run();
    assert.deepEqual(await queued(event, () => h.query('UPDATE social_group_members SET left_at=? WHERE group_id=? AND user_id=?', now, group, b.id).run()), []);
  }
  for (const event of [{ type: 'group', reason: 'removed', groupId: group }, { type: 'group', reason: 'closed', groupId: group },
    { type: 'message', reason: 'deleted', conversationId: direct, messageSeq: dm.seq }, { type: 'group', reason: 'deleted', groupId: group, messageSeq: gm.seq }]) {
    assert.deepEqual(await queued(event, async () => {}), [event], 'revocation/deletion still clears stale UI');
  }
});
