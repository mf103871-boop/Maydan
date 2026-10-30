import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { listCalls, getCall } from '../server/lamma/calls.mjs';

async function fixture(t) {
  const DB = createLocalD1(), env = { DB };
  t.after(() => DB.close());
  const sql = (query, ...args) => DB.prepare(query).bind(...args);
  const user = () => createUser(env, { name: 'لاعب اختبار', email: `${crypto.randomUUID()}@example.test` });
  async function direct(viewer, initiator, time = Date.now()) {
    const [low, high] = [viewer.id, initiator.id].sort(), conversation = crypto.randomUUID(), id = crypto.randomUUID();
    await sql("INSERT INTO social_friendships(id,user_low,user_high,requester_id,status,created_at,accepted_at) VALUES(?,?,?,?,'accepted',?,?)", crypto.randomUUID(), low, high, initiator.id, time, time).run();
    await sql('INSERT INTO social_conversations(id,user_low,user_high,created_at) VALUES(?,?,?,?)', conversation, low, high, time).run();
    await seedCall(id, 'direct', conversation, initiator, time);
    await sql("INSERT INTO social_call_participants(call_id,user_id,state) VALUES(?,?,'invited')", id, viewer.id).run();
    return id;
  }
  async function seedCall(id, scope, conversation, initiator, time) {
    await sql("INSERT INTO social_calls(id,scope,conversation_id,initiator_id,client_id,status,created_at,ring_until,expires_at,room_name) VALUES(?,?,?,?,?,'ringing',?,?,?,?)", id, scope, conversation, initiator.id, crypto.randomUUID(), time, Date.now() + 45000, Date.now() + 45000, `lamma-${id}`).run();
    await sql("INSERT INTO social_call_participants(call_id,user_id,state,device_id,joined_at) VALUES(?,?,'active','private-host-device',?)", id, initiator.id, time).run();
  }
  async function group(viewer, initiator, extra) {
    const id = crypto.randomUUID(), call = crypto.randomUUID(), now = Date.now();
    await sql('INSERT INTO social_groups(id,name,owner_id,created_at,updated_at) VALUES(?,?,?,?,?)', id, 'مجلس الاختبار', initiator.id, now, now).run();
    for (const u of [viewer, initiator, ...(extra ? [extra] : [])]) await sql("INSERT INTO social_group_members(group_id,user_id,role,joined_at) VALUES(?,?,'member',?)", id, u.id, now).run();
    await seedCall(call, 'group', id, initiator, now);
    if (extra) await sql("INSERT INTO social_call_participants(call_id,user_id,state,device_id,joined_at) VALUES(?,?,'active','private-extra-device',?)", call, extra.id, now).run();
    return { id, call };
  }
  return { DB, env, sql, user, direct, group };
}

test('thirty call summaries require one bounded joined read, preserving the established detail view and private devices', async t => {
  const h = await fixture(t), viewer = await h.user(), ids = [];
  for (let i = 0; i < 32; i++) ids.push(await h.direct(viewer, await h.user(), Date.now() - i * 100));
  const queries = [], prepare = h.DB.prepare.bind(h.DB);
  t.mock.method(h.DB, 'prepare', query => { queries.push(query); return prepare(query); });
  const { calls } = await listCalls(h.env, viewer.id);
  assert.equal(calls.length, 30);
  assert.equal(queries.length, 2, 'one expiry sweep and one complete visibility/participant read, independent of the number of calls');
  assert.deepEqual(calls.map(c => c.id), ids.slice(0, 30));
  for (const actual of calls) {
    const expected = await getCall(h.env, viewer.id, actual.id);
    const byId = value => ({ ...value, participants: [...value.participants].sort((a, b) => a.userId.localeCompare(b.userId)) });
    assert.deepEqual(byId(actual), byId(expected));
    assert.equal(actual.participants.some(p => p.userId !== viewer.id && Object.hasOwn(p, 'deviceId')), false);
  }
});

test('the joined call list respects direct friendship, group membership, active block conflicts and suspension', async t => {
  const h = await fixture(t), viewer = await h.user(), host = await h.user(), extra = await h.user(), outsider = await h.user();
  const g = await h.group(viewer, host, extra);
  assert.equal((await listCalls(h.env, viewer.id)).calls.length, 1);
  assert.equal((await listCalls(h.env, outsider.id)).calls.length, 0);
  await h.sql('INSERT INTO social_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)', extra.id, viewer.id, Date.now()).run();
  assert.equal((await listCalls(h.env, viewer.id)).calls.length, 0, 'a blocked active participant excludes the whole call');
  await h.sql("UPDATE social_call_participants SET state='left' WHERE call_id=? AND user_id=?", g.call, extra.id).run();
  const visible = (await listCalls(h.env, viewer.id)).calls;
  assert.equal(visible.length, 1);
  assert.equal(visible[0].participants.some(p => p.userId === extra.id), false, 'a blocked departed participant remains hidden');
  await h.sql('UPDATE social_group_members SET left_at=? WHERE group_id=? AND user_id=?', Date.now(), g.id, viewer.id).run();
  assert.equal((await listCalls(h.env, viewer.id)).calls.length, 0);
  const direct = await h.direct(viewer, await h.user());
  assert.equal((await listCalls(h.env, viewer.id)).calls.length, 1);
  await h.sql('DELETE FROM social_friendships WHERE user_low=? OR user_high=?', viewer.id, viewer.id).run();
  assert.equal((await listCalls(h.env, viewer.id)).calls.length, 0);
  await h.sql('UPDATE social_group_members SET left_at=NULL WHERE group_id=? AND user_id=?', g.id, viewer.id).run();
  await h.sql('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at) VALUES(?,?,?,?,?)', viewer.id, host.id, 'اختبار', Date.now(), Date.now()).run();
  assert.equal((await listCalls(h.env, viewer.id)).calls.length, 0);
  assert.ok(direct);
});
