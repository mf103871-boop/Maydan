import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession, ROTATE_AFTER } from '../server/accounts/session.mjs';
import { routeSocial, deleteSocialUser } from '../server/social/router.mjs';
import { errorResponse } from '../server/protocol.mjs';
import * as social from '../server/social/db.mjs';
import { ONLINE_WINDOW } from '../server/social/model.mjs';

async function setup(t) {
  const env = { DB: createLocalD1() };
  t.after(() => env.DB.close());
  const notifications = [];
  env.SOCIAL_HUB = { idFromName: (id) => id, get: (id) => ({ fetch: async (request) => {
    notifications.push({ id, ...await request.json() });
    return new Response('{}');
  } }) };
  async function user(name, email = `${crypto.randomUUID()}@private.example`) {
    const record = await createUser(env, { name, email });
    const session = await issueSession(env, record.id);
    const profile = await social.ensureProfile(env, record.id);
    return { ...record, token: session.token, code: profile.code };
  }
  async function call(actor, path, method = 'GET', body) {
    const headers = { ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
    const request = new Request(`https://maydan.test/api/social${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let response;
    try { response = await routeSocial(request, env); } catch (error) { response = errorResponse(error); }
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function connect(a, b) {
    const requested = await call(a, '/requests', 'POST', { userId: b.id });
    assert.equal(requested.status, 200, JSON.stringify(requested.body));
    const accepted = await call(b, `/requests/${requested.body.request.id}/accept`, 'POST');
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    return accepted.body.conversationId;
  }
  const send = (actor, conversation, text, clientId = crypto.randomUUID()) => call(actor, `/conversations/${conversation}/messages`, 'POST', { text, clientId });
  return { env, call, user, connect, send, notifications };
}

test('social API requires current account sessions, rotates them, and never exposes email', async (t) => {
  const { env, user, call } = await setup(t);
  assert.equal((await call(null, '/me')).status, 401);
  const a = await user('ليلى', 'secret@example.test');
  const me = await call(a, '/me');
  assert.deepEqual(Object.keys(me.body.user).sort(), ['code', 'id', 'name']);
  assert.match(me.body.user.code, /^MDN-[A-F0-9]{10}$/);
  assert.equal(JSON.stringify(me.body).includes('secret'), false);
  const emailName = await user('private@example.test');
  assert.equal((await call(emailName, '/me')).body.user.name, 'لاعب ميدان');
  const old = await issueSession(env, a.id, 'web', Date.now() - ROTATE_AFTER - 1000);
  const rotated = await call({ token: old.token }, '/me');
  assert.equal(rotated.status, 200);
  assert.match(rotated.headers.get('x-maydan-session'), /^mdn1\./);
});

test('search is limited, literal, and excludes both block directions and private names', async (t) => {
  const { user, call } = await setup(t);
  const a = await user('المراقب');
  const b = await user('صديق ليلى');
  for (let n = 0; n < 22; n++) await user(`صديق ${n}`);
  assert.equal((await call(a, '/search?q=ص')).status, 400);
  assert.equal((await call(a, '/search?q=صديق')).body.users.length, 20);
  assert.deepEqual((await call(a, '/search?q=%25_')).body.users, []);
  const exact = await call(a, `/search?q=${b.code.toLowerCase()}`);
  assert.equal(exact.body.users[0].id, b.id);
  assert.equal(exact.body.users[0].relationship, 'none');
  assert.deepEqual(Object.keys(exact.body.users[0]).sort(), ['code', 'id', 'name', 'relationship']);
  await call(a, '/blocks', 'POST', { userId: b.id });
  assert.deepEqual((await call(a, `/search?q=${b.code}`)).body.users, []);
  assert.deepEqual((await call(b, `/search?q=${a.code}`)).body.users, []);
});

test('only the recipient can accept/reject and only the requester can cancel', async (t) => {
  const { user, call, env } = await setup(t);
  const a = await user('ألف'); const b = await user('باء'); const outsider = await user('جيم');
  assert.equal((await call(a, '/requests', 'POST', { userId: a.id })).status, 400);
  const requested = await call(a, '/requests', 'POST', { userId: b.id });
  const id = requested.body.request.id;
  assert.equal((await call(a, '/requests', 'POST', { userId: b.id })).body.request.id, id);
  assert.equal((await call(b, '/requests', 'POST', { userId: a.id })).status, 409);
  assert.equal((await call(a, `/requests/${id}/accept`, 'POST')).status, 404);
  assert.equal((await call(outsider, `/requests/${id}/accept`, 'POST')).status, 404);
  assert.equal((await call(b, `/requests/${id}`, 'DELETE')).status, 404);
  assert.equal((await call(a, `/requests/${id}/reject`, 'POST')).status, 404);
  assert.equal((await call(b, '/requests')).body.incoming[0].user.id, a.id);
  assert.equal((await call(a, '/requests')).body.outgoing[0].user.id, b.id);
  assert.equal((await call(b, `/requests/${id}/accept`, 'POST')).status, 200);
  assert.equal(await social.areFriends(env, a.id, b.id), true);
  const firstConversation = (await call(a, '/friends')).body.friends[0].conversationId;
  assert.equal((await call(b, `/requests/${id}/accept`, 'POST')).body.conversationId, firstConversation);
  await call(a, `/friends/${b.id}`, 'DELETE');
  assert.equal(await social.areFriends(env, a.id, b.id), false);
  const next = (await call(a, '/requests', 'POST', { userId: b.id })).body.request.id;
  await call(b, `/requests/${next}/reject`, 'POST');
  assert.deepEqual((await call(a, '/requests')).body.outgoing, []);
  const cancel = (await call(a, '/requests', 'POST', { userId: b.id })).body.request.id;
  await call(a, `/requests/${cancel}`, 'DELETE');
  assert.equal((await call(b, `/requests/${cancel}/accept`, 'POST')).status, 404);
});

test('message access, mutation, read cursors, and typing friendship boundary resist ID substitution', async (t) => {
  const { user, call, connect, send, env } = await setup(t);
  const a = await user('ألف'); const b = await user('باء'); const outsider = await user('جيم');
  const conversation = await connect(a, b);
  const sent = await send(a, conversation, 'رسالة خاصة');
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const seq = sent.body.message.seq;
  for (const [path, method, body] of [
    [`/conversations/${conversation}/messages`, 'GET'],
    [`/conversations/${conversation}/messages`, 'POST', { text: 'اختراق', clientId: crypto.randomUUID() }],
    [`/messages/${seq}`, 'GET'], [`/messages/${seq}`, 'PATCH', { text: 'تعديل' }],
    [`/messages/${seq}`, 'DELETE'], [`/conversations/${conversation}/read`, 'POST', { seq }],
  ]) assert.equal((await call(outsider, path, method, body)).status, 404, `${method} ${path}`);
  assert.equal((await call(b, `/messages/${seq}`, 'PATCH', { text: 'تعديل' })).status, 404);
  assert.equal((await call(b, `/messages/${seq}`, 'DELETE')).status, 404);
  assert.equal(await social.areFriends(env, outsider.id, a.id), false);
  const badRead = await call(b, `/conversations/${conversation}/read`, 'POST', { seq: 99999999 });
  assert.equal(badRead.status, 400);
  assert.equal((await call(b, '/conversations')).body.conversations[0].unreadCount, 1);
  assert.equal((await call(b, `/conversations/${conversation}/read`, 'POST', { seq })).body.readSeq, seq);
  assert.equal((await call(b, '/conversations')).body.conversations[0].unreadCount, 0);
  assert.equal((await call(a, '/conversations')).body.conversations[0].peerReadSeq, seq);
  const second = (await send(a, conversation, 'ثانية')).body.message.seq;
  await call(b, `/conversations/${conversation}/read`, 'POST', { seq: second });
  assert.equal((await call(b, `/conversations/${conversation}/read`, 'POST', { seq })).body.readSeq, second);
  const otherConversation = await connect(a, outsider);
  const foreignSeq = (await send(outsider, otherConversation, 'خارج المحادثة')).body.message.seq;
  assert.equal((await call(b, `/conversations/${conversation}/read`, 'POST', { seq: foreignSeq })).status, 400);
});

test('send retries preserve one sequence; editing/deleting preserves idempotency and redacts tombstones', async (t) => {
  const { user, call, connect, send, notifications } = await setup(t);
  const a = await user('ألف'); const b = await user('باء');
  const conversation = await connect(a, b);
  const clientId = crypto.randomUUID();
  const one = (await send(a, conversation, 'النص الأول', clientId)).body.message;
  const retry = (await send(a, conversation, 'النص الأول', clientId)).body.message;
  assert.equal(retry.seq, one.seq);
  assert.equal((await send(a, conversation, 'حمولة مختلفة', clientId)).status, 409);
  assert.equal((await call(a, `/messages/${one.seq}`, 'PATCH', { text: 'النص المعدل' })).body.message.text, 'النص المعدل');
  assert.equal((await send(a, conversation, 'النص الأول', clientId)).body.message.text, 'النص المعدل');
  const deleted = await call(a, `/messages/${one.seq}`, 'DELETE');
  assert.equal(deleted.body.message.text, '');
  assert.ok(deleted.body.message.deletedAt);
  assert.equal((await call(a, `/messages/${one.seq}`, 'DELETE')).status, 200);
  assert.equal((await call(a, `/messages/${one.seq}`, 'PATCH', { text: 'إحياء' })).status, 404);
  assert.equal((await send(a, conversation, 'النص الأول', clientId)).body.message.text, '');
  const page = (await call(b, `/conversations/${conversation}/messages`)).body;
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].seq, one.seq);
  assert.equal(page.messages[0].text, '');
  assert.ok(notifications.some((n) => n.event.type === 'message' && n.event.messageSeq === one.seq));
  assert.equal(notifications.some((n) => JSON.stringify(n).includes('النص')), false);
});

test('cursor pagination uses sequences, keeps ordering across timestamp ties, and never misses a page', async (t) => {
  const { user, call, connect, send } = await setup(t);
  const a = await user('ألف'); const b = await user('باء');
  const conversation = await connect(a, b);
  const seqs = [];
  for (let i = 0; i < 57; i++) seqs.push((await send(a, conversation, `رسالة ${i}`)).body.message.seq);
  const newest = (await call(b, `/conversations/${conversation}/messages`)).body;
  assert.deepEqual(newest.messages.map((m) => m.seq), seqs.slice(7));
  assert.equal(newest.hasMore, true);
  const oldest = (await call(b, `/conversations/${conversation}/messages?before=${newest.nextBefore}`)).body;
  assert.deepEqual(oldest.messages.map((m) => m.seq), seqs.slice(0, 7));
  assert.equal(oldest.hasMore, false);
  const forward = (await call(b, `/conversations/${conversation}/messages?after=0&limit=20`)).body;
  assert.deepEqual(forward.messages.map((m) => m.seq), seqs.slice(0, 20));
  const more = (await call(b, `/conversations/${conversation}/messages?after=${forward.nextAfter}&limit=20`)).body;
  assert.deepEqual(more.messages.map((m) => m.seq), seqs.slice(20, 40));
  const empty = (await call(b, `/conversations/${conversation}/messages?after=${seqs.at(-1)}`)).body;
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.nextAfter, seqs.at(-1));
  for (const query of ['before=1&after=0', 'after=-1', 'after=1.5', 'after=9007199254740992', 'limit=101'])
    assert.equal((await call(b, `/conversations/${conversation}/messages?${query}`)).status, 400);
});

test('blocking is bilateral for requests and all message paths; unblocking never restores friendship', async (t) => {
  const { user, call, connect, send, env } = await setup(t);
  const a = await user('ألف'); const b = await user('باء');
  const conversation = await connect(a, b);
  const seq = (await send(a, conversation, 'قبل الحظر')).body.message.seq;
  await call(b, '/blocks', 'POST', { userId: a.id });
  assert.equal(await social.areFriends(env, a.id, b.id), false);
  assert.deepEqual(await social.friendIds(env, b.id), []);
  for (const actor of [a, b]) {
    assert.deepEqual((await call(actor, '/friends')).body.friends, []);
    assert.deepEqual((await call(actor, '/conversations')).body.conversations, []);
    assert.equal((await call(actor, `/messages/${seq}`)).status, 404);
    assert.equal((await call(actor, `/conversations/${conversation}/messages`)).status, 404);
    assert.equal((await send(actor, conversation, 'بعد الحظر')).status, 404);
    assert.equal((await call(actor, `/conversations/${conversation}/read`, 'POST', { seq })).status, 404);
  }
  assert.equal((await call(a, `/messages/${seq}`, 'PATCH', { text: 'تغيير' })).status, 404);
  assert.equal((await call(a, `/messages/${seq}`, 'DELETE')).status, 404);
  assert.equal((await call(a, '/requests', 'POST', { userId: b.id })).status, 404);
  assert.equal((await call(b, '/requests', 'POST', { userId: a.id })).status, 404);
  assert.equal((await call(b, '/blocks')).body.users[0].id, a.id);
  await call(a, `/blocks/${b.id}`, 'DELETE');
  assert.equal(await social.areFriends(env, a.id, b.id), false);
  await call(b, `/blocks/${a.id}`, 'DELETE');
  assert.equal((await send(a, conversation, 'لا عودة تلقائية')).status, 404);
  assert.equal(await connect(a, b), conversation);
});

test('reporting retains received evidence after a block without exposing reports or allowing outsiders to select evidence', async (t) => {
  const { user, call, connect, send, env } = await setup(t);
  const a = await user('ألف'); const b = await user('باء'); const c = await user('جيم');
  const conversation = await connect(a, b);
  const seq = (await send(a, conversation, 'نص البلاغ')).body.message.seq;
  await call(b, '/blocks', 'POST', { userId: a.id });
  assert.equal((await call(b, '/reports', 'POST', { userId: a.id, messageSeq: seq, reason: 'إساءة' })).status, 200);
  const row = await env.DB.prepare('SELECT * FROM social_reports').first();
  assert.equal(row.reporter_id, b.id);
  assert.equal(row.message_text, 'نص البلاغ');
  assert.equal((await call(c, '/reports', 'POST', { userId: a.id, messageSeq: seq, reason: 'تزوير' })).status, 404);
  assert.equal((await call(b, '/reports')).status, 404);
  assert.equal((await call(a, '/reports')).status, 404);
});

test('text limit counts Unicode characters and notification failure cannot lose committed data', async (t) => {
  const { user, call, connect, send, env } = await setup(t);
  const a = await user('ألف'); const b = await user('باء');
  const conversation = await connect(a, b);
  env.SOCIAL_HUB.get = () => ({ fetch() { throw new Error('offline'); } });
  const unicode = await send(a, conversation, '😀'.repeat(2000));
  assert.equal(unicode.status, 200);
  assert.equal((await send(a, conversation, '😀'.repeat(2001))).status, 400);
  assert.equal((await send(a, conversation, '   ')).status, 400);
  assert.equal((await send(a, conversation, '\u0000')).status, 400);
  assert.equal((await send(a, conversation, 'نص', '')).status, 400);
  assert.equal((await call(b, `/messages/${unicode.body.message.seq}`)).body.message.text, '😀'.repeat(2000));
});

test('presence expires, closing preserves last activity, and deleting user removes related social data', async (t) => {
  const { user, call, connect, send, env } = await setup(t);
  const a = await user('ألف'); const b = await user('باء');
  const conversation = await connect(a, b);
  const seq = (await send(a, conversation, 'للحذف')).body.message.seq;
  await call(b, `/conversations/${conversation}/read`, 'POST', { seq });
  const now = Date.now();
  await social.touchPresence(env, a.id, now, now + ONLINE_WINDOW);
  assert.equal((await call(b, '/friends')).body.friends[0].online, true);
  await social.touchPresence(env, a.id, now, 0);
  const offline = (await call(b, '/friends')).body.friends[0];
  assert.equal(offline.online, false);
  assert.equal(offline.lastActiveAt, now);
  await call(b, '/reports', 'POST', { userId: a.id, reason: 'اختبار تنظيف' });
  await deleteSocialUser(env, a.id);
  for (const table of ['social_messages', 'social_reads', 'social_friendships', 'social_conversations', 'social_reports'])
    assert.equal((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 0, table);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM social_profiles WHERE user_id=?').bind(a.id).first()).n, 0);
  assert.equal((await call(b, '/conversations')).body.conversations.length, 0);
});

test('friend request quota survives cancellations and message retries do not allocate a new quota slot', async (t) => {
  const { user, call, connect, send, env } = await setup(t);
  const a = await user('ألف'); const b = await user('باء');
  for (let i = 0; i < 10; i++) {
    const requested = await call(a, '/requests', 'POST', { userId: b.id });
    assert.equal(requested.status, 200);
    await call(a, `/requests/${requested.body.request.id}`, 'DELETE');
  }
  assert.equal((await call(a, '/requests', 'POST', { userId: b.id })).status, 429);
  const c = await user('جيم'); const d = await user('دال');
  const conversation = await connect(c, d);
  const clientId = crypto.randomUUID();
  const first = await send(c, conversation, 'قابل للإعادة', clientId);
  for (let i = 1; i < 60; i++) assert.equal((await send(c, conversation, `اختبار حد ${i}`)).status, 200);
  assert.equal((await send(c, conversation, 'فوق الحد')).status, 429);
  assert.equal((await send(c, conversation, 'قابل للإعادة', clientId)).body.message.seq, first.body.message.seq);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM social_messages WHERE sender_id=?').bind(c.id).first()).n, 60);
});

test('social cleanup can join the account transaction and a later failure restores all social rows', async (t) => {
  const { user, connect, send, env } = await setup(t);
  const a = await user('ألف'); const b = await user('باء');
  const conversation = await connect(a, b);
  const message = (await send(a, conversation, 'يجب أن يبقى عند فشل المعاملة')).body.message;
  await assert.rejects(env.DB.batch([...social.socialDeleteStatements(env, a.id), env.DB.prepare('DELETE FROM nonexistent_table')]));
  assert.equal((await social.messageForUser(env, b.id, message.seq)).text, message.text);
  assert.equal(await social.areFriends(env, a.id, b.id), true);
  await env.DB.batch([...social.socialDeleteStatements(env, a.id), env.DB.prepare('DELETE FROM users WHERE id=?').bind(a.id)]);
  assert.equal(await social.messageForUser(env, b.id, message.seq), null);
  assert.equal(await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(a.id).first(), null);
});
