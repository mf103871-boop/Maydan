import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { startCall, joinCall, listCalls, sweepCalls, callAction } from '../server/lamma/calls.mjs';
import { drainJobs } from '../server/lamma/jobs.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Call response waited for expired-room transport')), 1000); })]); }
  finally { clearTimeout(timer); }
}
async function fixture(t) {
  const DB = createLocalD1(), pending = [];
  t.after(() => DB.close());
  const env = { DB, LIVEKIT_URL: 'wss://test.livekit.cloud', LIVEKIT_API_KEY: 'fixture-key', LIVEKIT_API_SECRET: 'fixture-secret' };
  const query = (sql, ...args) => DB.prepare(sql).bind(...args);
  const user = () => createUser(env, { name: 'فحص الاتصال', email: `${crypto.randomUUID()}@example.test` });
  async function friends(a, b) {
    const [low, high] = [a.id, b.id].sort(), now = Date.now(), id = crypto.randomUUID();
    await query("INSERT INTO social_friendships(id,user_low,user_high,requester_id,status,created_at,accepted_at) VALUES(?,?,?,?,'accepted',?,?)", crypto.randomUUID(), low, high, a.id, now, now).run();
    await query('INSERT INTO social_conversations(id,user_low,user_high,created_at) VALUES(?,?,?,?)', id, low, high, now).run();
    return id;
  }
  async function seed(a, b, conversation, { expired = false } = {}) {
    const id = crypto.randomUUID(), now = Date.now();
    await query("INSERT INTO social_calls(id,scope,conversation_id,initiator_id,client_id,status,created_at,ring_until,expires_at,room_name) VALUES(?,'direct',?,?,?,'ringing',?,?,?,?)", id, conversation, a.id, crypto.randomUUID(), now - 50000, expired ? now - 1000 : now + 45000, expired ? now - 1000 : now + 45000, `lamma-${id}`).run();
    await query("INSERT INTO social_call_participants(call_id,user_id,state,device_id,joined_at) VALUES(?,?,'active','caller-device',?)", id, a.id, now - 50000).run();
    await query("INSERT INTO social_call_participants(call_id,user_id,state) VALUES(?,?,'invited')", id, b.id).run();
    return id;
  }
  return { env, DB, pending, query, user, friends, seed, context: { waitUntil: task => pending.push(task) } };
}

test('call start, join and list do not wait for expired rooms; revocations and retry jobs are durable before returning', async t => {
  for (const operation of ['start', 'join', 'list']) await t.test(operation, async t => {
    const h = await fixture(t), a = await h.user(), b = await h.user(), c = await h.user(), d = await h.user();
    const conversation = await h.friends(a, b), other = await h.friends(c, d);
    // Starting again also clears the caller's stale active seat before admitting
    // a new call; joining/listing use unrelated stale rooms to catch head-of-line blocking.
    const expired = await h.seed(operation === 'start' ? a : c, operation === 'start' ? b : d, operation === 'start' ? conversation : other, { expired: true });
    const current = operation === 'start' ? null : await h.seed(a, b, conversation);
    const gate = deferred(), reached = deferred(), requests = []; let settled = false;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const method = new URL(url).pathname.split('/').at(-1), body = JSON.parse(options.body);
      requests.push({ method, room: body.room || body.name });
      if (method !== 'CreateRoom') { reached.resolve(); await gate.promise; }
      return Response.json({});
    });
    try {
      const response = await bounded(operation === 'start' ? startCall(h.env, a.id, { scope: 'direct', conversationId: conversation, clientId: crypto.randomUUID(), deviceId: 'caller-device' }, h.context) :
        operation === 'join' ? joinCall(h.env, b.id, current, { deviceId: 'callee-device' }, h.context) : listCalls(h.env, a.id, h.context));
      settled = true;
      if (operation === 'list') assert.deepEqual(response.calls.map(call => call.id), [current]);
      else assert.ok(response.connection.token);
      assert.equal((await h.query('SELECT status FROM social_calls WHERE id=?', expired).first()).status, 'missed');
      assert.equal((await h.query("SELECT COUNT(*) AS n FROM social_call_participants WHERE call_id=? AND state IN ('active','invited')", expired).first()).n, 0);
      assert.equal((await h.query("SELECT COUNT(*) AS n FROM social_jobs WHERE kind IN ('lk_remove','lk_delete') AND json_extract(payload,'$.room')=?", `lamma-${expired}`).first()).n, 3);
      await bounded(reached.promise);
      assert.ok(h.pending.length);
    } finally { gate.resolve(); await Promise.all(h.pending); }
    assert.equal(settled, true);
    assert.equal((await h.query("SELECT COUNT(*) AS n FROM social_jobs WHERE kind IN ('lk_remove','lk_delete') AND json_extract(payload,'$.room')=?", `lamma-${expired}`).first()).n, 0);
    assert.deepEqual(requests.filter(r => r.room === `lamma-${expired}`).map(r => r.method), ['RemoveParticipant', 'RemoveParticipant', 'DeleteRoom']);
  });
});

test('a delayed expiry sweep cannot terminate a call renewed after its initial read', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(), conversation = await h.friends(a, b), id = await h.seed(a, b, conversation, { expired: true });
  let renewed = false, provider = 0;
  t.mock.method(globalThis, 'fetch', async () => { provider++; return Response.json({}); });
  h.env.DB = { batch: h.DB.batch.bind(h.DB), prepare(sql) {
    const statement = h.DB.prepare(sql);
    if (sql.startsWith("SELECT * FROM social_calls WHERE status IN")) {
      const bind = statement.bind.bind(statement);
      statement.bind = (...args) => {
        const bound = bind(...args), all = bound.all.bind(bound);
        bound.all = async () => {
          const old = await all();
          await h.query("UPDATE social_calls SET status='active',expires_at=? WHERE id=?", Date.now() + 3600000, id).run();
          await h.query("UPDATE social_call_participants SET state='active' WHERE call_id=?", id).run();
          renewed = true; return old;
        };
        return bound;
      };
    }
    return statement;
  } };
  await sweepCalls(h.env, Date.now(), h.context); await Promise.all(h.pending);
  assert.equal(renewed, true); assert.equal(provider, 0);
  assert.equal((await h.query('SELECT status FROM social_calls WHERE id=?', id).first()).status, 'active');
  assert.equal((await h.query("SELECT COUNT(*) AS n FROM social_call_participants WHERE call_id=? AND state='active'", id).first()).n, 2);
  assert.equal((await h.query('SELECT COUNT(*) AS n FROM social_jobs').first()).n, 0);
});

test('failed asynchronous cleanup remains queued and explicit leave still awaits provider revocation', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(), conversation = await h.friends(a, b), id = await h.seed(a, b, conversation, { expired: true });
  t.mock.method(globalThis, 'fetch', async () => { throw Error('synthetic provider failure'); });
  await sweepCalls(h.env, Date.now(), h.context); await Promise.all(h.pending);
  const jobs = await h.query("SELECT attempts,lease_until FROM social_jobs WHERE kind IN ('lk_remove','lk_delete')").all();
  assert.equal(jobs.results.length, 3); assert.ok(jobs.results.every(job => job.attempts === 1 && job.lease_until === 0));
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  await drainJobs(h.env, Date.now() + 60000);
  assert.equal((await h.query('SELECT COUNT(*) AS n FROM social_jobs').first()).n, 0);
  const next = await h.seed(a, b, conversation), gate = deferred(), reached = deferred(); let completed = false;
  t.mock.method(globalThis, 'fetch', async () => { reached.resolve(); await gate.promise; return Response.json({}); });
  const leaving = callAction(h.env, a.id, next, 'leave', { deviceId: 'caller-device' }).then(() => { completed = true; });
  try { await bounded(reached.promise); assert.equal(completed, false); }
  finally { gate.resolve(); await leaving; }
  assert.equal(completed, true);
  assert.equal((await h.query('SELECT status FROM social_calls WHERE id=?', id).first()).status, 'missed');
});
