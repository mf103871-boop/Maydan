import test from 'node:test';
import assert from 'node:assert/strict';
import { LammaClient } from '../src/social/lamma-client.js';
import { createLocalD1, LocalD1, migrationStatements } from '../server/local-d1.mjs';
import { createUser, deleteUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeSocial } from '../server/social/router.mjs';
import { first, run } from '../server/lamma/common.mjs';
import { revokeInvalidCalls } from '../server/lamma/calls.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const rows = (from, to, senderId = 'peer') => Array.from({ length: to - from + 1 }, (_, i) => ({ seq: from + i, clientId: 'message-' + (from + i), senderId, text: 'Message ' + (from + i) }));
function historyClient(t, request) { const c = new LammaClient({ request }); c.userId = 'alice'; t.after(() => c.stop()); return c; }

test('quiet group refresh reauthorizes every loaded page and retains the oldest pagination cursor', async t => {
  let changed = false;
  const requests = [];
  const c = historyClient(t, async path => {
    requests.push(path);
    if (!path.includes('/messages')) return { group: { id: 'g' }, members: [] };
    if (path.includes('?before=51')) return { messages: rows(1, 50).filter(m => !changed || m.seq !== 5).map(m => m.seq === 6 && changed ? { ...m, deletedAt: 1, text: '' } : m), hasMore: false, nextBefore: null };
    return { messages: rows(51, changed ? 101 : 100), hasMore: true, nextBefore: 51 };
  });
  await c.loadGroup('g'); await c.loadOlderGroup('g'); assert.equal(c.state.groupConversations.g.messages.length, 100);
  changed = true; requests.length = 0; await c.loadGroup('g', { quiet: true });
  const chat = c.state.groupConversations.g;
  assert.equal(chat.messages.length, 100); assert.equal(chat.messages[0].seq, 1);
  assert.equal(chat.messages.at(-1).seq, 101); assert.equal(chat.messages.some(m => m.seq === 5), false);
  assert.equal(chat.messages.find(m => m.seq === 6).text, ''); assert.equal(chat.hasMore, false); assert.equal(chat.nextBefore, null);
  assert.ok(requests.includes('/api/social/groups/g/messages?before=51'));
});

test('revalidation traverses new pages after a long offline gap without dropping the reading window', async t => {
  const all = rows(1, 230);
  const c = historyClient(t, async path => {
    if (!path.includes('/messages')) return { group: { id: 'g' } };
    const before = Number(new URL('https://local.test' + path).searchParams.get('before') || 231);
    const messages = all.filter(m => m.seq < before).slice(-50);
    return { messages, hasMore: messages[0].seq > 1, nextBefore: messages[0].seq > 1 ? messages[0].seq : null };
  });
  c.group('g', { messages: rows(40, 90) }); await c.loadGroup('g', { quiet: true });
  assert.ok(c.state.groupConversations.g.messages[0].seq <= 40);
  assert.equal(c.state.groupConversations.g.messages.at(-1).seq, 230);
  assert.equal(c.state.groupConversations.g.messages.some(m => m.seq === 40), true);
});

test('revocation during older-page revalidation cannot publish a stale group snapshot', async t => {
  const wait = deferred(); let started;
  const reached = new Promise(resolve => { started = resolve; });
  const c = historyClient(t, async path => {
    if (path.includes('?before=')) { started(); return wait.promise; }
    if (path.includes('/messages')) return { messages: rows(51, 100), hasMore: true, nextBefore: 51 };
    return { group: { id: 'g' } };
  });
  c.group('g', { messages: rows(1, 100) });
  const refresh = c.loadGroup('g', { quiet: true }); await reached;
  c.invalidateAudio(); c.group('g', { messages: [], members: [] });
  wait.resolve({ messages: rows(1, 50), hasMore: false });
  await assert.rejects(refresh, { code: 'STALE' }); assert.deepEqual(c.state.groupConversations.g.messages, []);
});

test('a failed old-history refresh keeps the last window and never installs a partial page', async t => {
  const c = historyClient(t, async path => {
    if (path.includes('?before=')) throw { code: 'NETWORK' };
    if (path.includes('/messages')) return { messages: rows(51, 100), hasMore: true, nextBefore: 51 };
    return { group: { id: 'g' } };
  });
  c.group('g', { messages: rows(1, 100) });
  await assert.rejects(c.loadGroup('g', { quiet: true }), { code: 'NETWORK' });
  assert.equal(c.state.groupConversations.g.messages.length, 100);
});

async function fixture(t) {
  const env = { DB: createLocalD1() }; t.after(() => env.DB.close());
  const user = async () => { const u = await createUser(env, { name: 'Local test', email: crypto.randomUUID() + '@example.test' }); const s = await issueSession(env, u.id); return { ...u, token: s.token }; };
  const api = async (u, path, method = 'GET', body) => {
    const r = await routeSocial(new Request('https://local.test/api/social' + path, { method, headers: { authorization: 'Bearer ' + u.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
    return { status: r.status, body: await r.json() };
  };
  const client = u => { const c = new LammaClient({ request: async (path, options = {}) => { const r = await api(u, path.replace('/api/social', ''), options.method || 'GET', options.body); if (r.status >= 400) throw { code: r.body.error }; return r.body; } }); c.userId = u.id; return c; };
  const friends = async (a, b) => { const r = await api(a, '/requests', 'POST', { userId: b.id }); const x = await api(b, `/requests/${r.body.request.id}/accept`, 'POST'); assert.equal(x.status, 200); return x.body.conversationId; };
  const add = async (owner, other, g) => { const r = await api(owner, `/groups/${g}/invites`, 'POST', { userId: other.id }); const x = await api(other, `/groups/${g}/invites/${r.body.invitation.id}/accept`, 'POST'); assert.equal(x.status, 200); };
  return { env, user, api, client, friends, add };
}

test('acknowledged group creation succeeds even if every follow-up read fails', async t => {
  const h = await fixture(t), a = await h.user(), c = h.client(a), base = c.request;
  c.request = (path, options) => options?.method === 'POST' ? base(path, options) : Promise.reject({ code: 'NETWORK' });
  const group = await c.createGroup({ name: 'Creation success' });
  await c.refreshing?.catch(() => {});
  assert.ok(group.id); assert.equal(c.state.groups[0].id, group.id);
  assert.equal((await first(h.env, 'SELECT COUNT(*) AS n FROM social_groups')).n, 1); c.stop();
});

test('a pre-creation list response cannot erase an acknowledged new group', async t => {
  const wait = deferred(); let listReads = 0, created = false;
  const c = historyClient(t, async (path, options) => {
    if (path.endsWith('/groups') && options?.method === 'POST') { created = true; return { group: { id: 'new-group', name: 'New' } }; }
    if (path.endsWith('/groups')) { if (++listReads === 1) return wait.promise; return { groups: created ? [{ id: 'new-group' }] : [], incoming: [] }; }
    if (path.endsWith('/calls')) return { calls: [] }; return {};
  });
  const oldRefresh = c.refresh(); await c.createGroup({ name: 'New' });
  const observations = []; c.subscribe(() => observations.push(c.state.groups.map(g => g.id)));
  wait.resolve({ groups: [], incoming: [] }); await assert.rejects(oldRefresh, { code: 'STALE' });
  await new Promise(resolve => setImmediate(resolve)); await c.refreshing;
  assert.ok(observations.every(ids => ids.includes('new-group'))); assert.equal(c.state.groups[0].id, 'new-group');
});

test('lost group POST response and concurrent retry create exactly one group with one invitation', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(); await h.friends(a, b);
  const c = h.client(a), base = c.request, ids = []; let lost = true;
  c.request = async (path, options) => { const result = await base(path, options); if (path === '/api/social/groups' && options?.method === 'POST') { ids.push(options.body.clientId); if (lost) { lost = false; throw { code: 'NETWORK' }; } } return result; };
  const input = { name: 'Same group', memberIds: [b.id] };
  await assert.rejects(c.createGroup(input), { code: 'NETWORK' });
  const [one, two] = await Promise.all([c.createGroup(input), c.createGroup(input)]); await c.refreshing?.catch(() => {});
  assert.equal(one.id, two.id); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  assert.equal((await first(h.env, 'SELECT COUNT(*) AS n FROM social_groups')).n, 1);
  assert.equal((await first(h.env, 'SELECT COUNT(*) AS n FROM social_group_invites')).n, 1); c.stop();
});

test('creation identity is owner scoped, survives rename and transfer, rejects changed payload and cannot rejoin a left group', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(); await h.friends(a, b);
  const body = { name: 'Original', clientId: 'same-create-key' }, created = await h.api(a, '/groups', 'POST', body), g = created.body.group.id;
  assert.equal(created.status, 200); await h.add(a, b, g);
  await h.api(a, `/groups/${g}`, 'PATCH', { name: 'Renamed' }); await h.api(a, `/groups/${g}/ownership`, 'POST', { userId: b.id });
  assert.equal((await h.api(a, '/groups', 'POST', body)).body.group.id, g);
  assert.equal((await h.api(a, '/groups', 'POST', { ...body, name: 'Changed' })).status, 409);
  const other = await h.api(b, '/groups', 'POST', body); assert.equal(other.status, 200); assert.notEqual(other.body.group.id, g);
  await h.api(a, `/groups/${g}/leave`, 'POST');
  assert.equal((await h.api(a, '/groups', 'POST', body)).status, 404);
  assert.equal((await first(h.env, 'SELECT COUNT(*) AS n FROM social_groups')).n, 2);
  await deleteUser(h.env, a.id); assert.equal((await first(h.env, 'SELECT creator_id FROM social_groups WHERE id=?', g)).creator_id, null);
});

test('0013 upgrades existing groups without changing IDs, history or old-client creation', async t => {
  const db = new LocalD1(); t.after(() => db.close());
  const migration = statement => /ALTER TABLE social_groups ADD COLUMN (creator_id|creation_client_id|creation_hash)|CREATE UNIQUE INDEX IF NOT EXISTS social_groups_creation/.test(statement);
  const statements = migrationStatements(); for (const sql of statements.filter(sql => !migration(sql))) await db.exec(sql);
  const env = { DB: db }, a = await createUser(env, { name: 'Old account' });
  await run(env, 'INSERT INTO social_groups(id,name,owner_id,created_at,updated_at) VALUES(?,?,?,?,?)', 'old-group', 'Old group', a.id, 1, 1);
  await run(env, "INSERT INTO social_group_members(group_id,user_id,role,joined_at) VALUES(?,?,'owner',1)", 'old-group', a.id);
  for (const sql of statements.filter(migration)) await db.exec(sql);
  const group = await first(env, 'SELECT * FROM social_groups WHERE id=?', 'old-group');
  assert.equal(group.owner_id, a.id); assert.equal(group.name, 'Old group'); assert.equal(group.creator_id, null);
  const { createGroup } = await import('../server/lamma/groups.mjs');
  const legacy = await createGroup(env, a.id, { name: 'Old client request' }); assert.ok(legacy.group.id);
});

test('a lost call response is reconciled by the same client identity without duplicate ringing', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(), conversationId = await h.friends(a, b);
  Object.assign(h.env, { LIVEKIT_URL: 'wss://test.livekit.cloud', LIVEKIT_API_KEY: 'local-key', LIVEKIT_API_SECRET: 'local-secret' });
  let creates = 0; t.mock.method(globalThis, 'fetch', async url => { assert.equal(new URL(url).hostname, 'test.livekit.cloud'); if (String(url).endsWith('/CreateRoom')) creates++; return Response.json({}); });
  const c = h.client(a), base = c.request, ids = []; let lost = true;
  c.request = async (path, options) => { const result = await base(path, options); ids.push(options.body.clientId); if (lost) { lost = false; throw { code: 'NETWORK' }; } return result; };
  const input = { targetType: 'direct', targetId: conversationId, deviceId: 'device-one' };
  await assert.rejects(c.startCall(input), { code: 'NETWORK' });
  const [one, two] = await Promise.all([c.startCall(input), c.startCall(input)]);
  assert.equal(one.call.id, two.call.id); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]); assert.equal(creates, 1);
  assert.equal((await first(h.env, 'SELECT COUNT(*) AS n FROM social_calls')).n, 1); c.stop();
});

test('uncertain call and creation state cannot cross an account switch', async t => {
  const wait = deferred(), c = historyClient(t, () => wait.promise);
  const creation = c.createGroup({ name: 'Private group' }), call = c.startCall({ targetType: 'direct', targetId: 'peer', deviceId: 'device' });
  c.stop(); c.userId = 'bob'; wait.resolve({ group: { id: 'old' }, call: { id: 'old-call' } });
  await assert.rejects(creation, { code: 'STALE' }); await assert.rejects(call, { code: 'STALE' });
  assert.equal(c.pendingGroupCreates.size, 0); assert.equal(c.pendingCalls.size, 0); assert.deepEqual(c.state.groups, []);
});

test('a terminal creation rejection releases its key; provider reconnecting retains a pending call key', async t => {
  const createIds = [], callIds = [];
  const c = historyClient(t, async (path, options) => {
    if (path.endsWith('/groups')) { createIds.push(options.body.clientId); throw { code: 'NOT_FOUND' }; }
    callIds.push(options.body.clientId); throw { code: 'CALL_RECONNECTING' };
  });
  for (let i = 0; i < 2; i++) await assert.rejects(c.createGroup({ name: 'Closed creation' }), { code: 'NOT_FOUND' });
  for (let i = 0; i < 2; i++) await assert.rejects(c.startCall({ targetType: 'group', targetId: 'g', deviceId: 'device' }), { code: 'CALL_RECONNECTING' });
  assert.notEqual(createIds[0], createIds[1]); assert.equal(callIds[0], callIds[1]);
});

test('group leave revokes only the affected participant; unscoped cleanup remains maintenance-only', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(), unrelated = await h.user(); await h.friends(a, b);
  const g = (await h.api(a, '/groups', 'POST', { name: 'Target group' })).body.group.id; await h.add(a, b, g);
  for (const [id, groupId, u] of [['affected-call', g, b.id], ['unrelated-call', 'no-longer-existing-group', unrelated.id]]) {
    await run(h.env, "INSERT INTO social_calls(id,scope,conversation_id,initiator_id,client_id,status,created_at,ring_until,expires_at,room_name) VALUES(?,'group',?,?,?,'active',?,?,?,?)", id, groupId, u, 'create-' + id, Date.now(), Date.now() + 45000, Date.now() + 3600000, id);
    await run(h.env, "INSERT INTO social_call_participants(call_id,user_id,state,device_id,joined_at) VALUES(?,?,'active','device',?)", id, u, Date.now());
  }
  // A misconfigured/unavailable provider does not bypass the committed revocation.
  assert.equal((await h.api(b, `/groups/${g}/leave`, 'POST')).status, 200);
  assert.equal((await first(h.env, 'SELECT state FROM social_call_participants WHERE call_id=?', 'affected-call')).state, 'left');
  assert.equal((await first(h.env, 'SELECT state FROM social_call_participants WHERE call_id=?', 'unrelated-call')).state, 'active');
  await revokeInvalidCalls(h.env);
  assert.equal((await first(h.env, 'SELECT state FROM social_call_participants WHERE call_id=?', 'unrelated-call')).state, 'left');
});
