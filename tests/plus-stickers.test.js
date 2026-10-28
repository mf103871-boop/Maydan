import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createLocalD1, LocalD1, MIGRATIONS_DIR } from '../server/local-d1.mjs';
import { createUser, upsertSubscription, deleteUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeSocial } from '../server/social/router.mjs';
import { errorResponse } from '../server/protocol.mjs';
import { SocialClient } from '../src/social/client.js';
import { LammaClient } from '../src/social/lamma-client.js';

async function fixture(t) {
  const env = { DB: createLocalD1() }; t.after(() => env.DB.close());
  const sql = (text, ...args) => env.DB.prepare(text).bind(...args);
  const user = async () => {
    const u = await createUser(env, { name: 'لاعب اختبار', email: `${crypto.randomUUID()}@example.test` });
    const session = await issueSession(env, u.id); return { ...u, token: session.token };
  };
  const api = async (u, path, method = 'GET', body) => {
    let response;
    try { response = await routeSocial(new Request(`https://test.local/api/social${path}`, { method,
      headers: { authorization: `Bearer ${u.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }), env); }
    catch (error) { response = errorResponse(error); }
    return { status: response.status, body: await response.json() };
  };
  const friends = async (a, b) => {
    const request = await api(a, '/requests', 'POST', { userId: b.id }); assert.equal(request.status, 200);
    const accepted = await api(b, `/requests/${request.body.request.id}/accept`, 'POST'); assert.equal(accepted.status, 200);
    return accepted.body.conversationId;
  };
  const plus = async u => upsertSubscription(env, { source: 'apple', external_id: u.id, user_id: u.id,
    status: 'active', until: Date.now() + 86400000, environment: 'sandbox', product: 'plus.monthly' });
  return { env, sql, user, api, friends, plus };
}
const stickerBody = () => ({ kind: 'sticker', stickerId: 'sahra.sticker.1', clientId: crypto.randomUUID() });

test('stickers require Plus for new sends but retain historical display, fallback text, and retry identity after expiry', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(), c = await h.friends(a, b);
  const path = `/conversations/${c}/messages`, body = stickerBody();
  assert.equal((await h.api(a, path, 'POST', body)).status, 403);
  assert.equal((await h.api(a, path, 'POST', { text: 'مجاني', clientId: crypto.randomUUID() })).status, 200);
  await h.plus(a);
  assert.equal((await h.api(a, path, 'POST', { ...body, assetUrl: 'https://attacker.invalid/x' })).status, 400);
  assert.equal((await h.api(a, path, 'POST', { ...body, stickerId: 'not-in-catalog' })).status, 400);
  const sent = await h.api(a, path, 'POST', body); assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const message = sent.body.message;
  assert.equal(message.stickerId, body.stickerId); assert.equal(message.stickerVersion, 1);
  assert.match(message.text, /ملصق: كفو/); assert.match(message.sticker.assetUrl, /^\/assets\/plus\//);
  assert.equal((await h.api(a, path, 'POST', { ...body, stickerId: 'artist.sticker.1' })).status, 409);
  await h.sql("UPDATE subscriptions SET status='expired',until=1 WHERE user_id=?", a.id).run();
  await h.sql('DELETE FROM social_jobs WHERE id LIKE ?', `%${body.clientId}%`).run();
  const retried = await h.api(a, path, 'POST', body); assert.equal(retried.status, 200); assert.equal(retried.body.message.seq, message.seq);
  assert.equal((await h.sql('SELECT COUNT(*) AS n FROM social_jobs WHERE id LIKE ?', `%${body.clientId}%`).first()).n, 0);
  assert.equal((await h.api(a, path, 'POST', stickerBody())).status, 403);
  const history = await h.api(b, path); assert.equal(history.status, 200);
  assert.equal(history.body.messages.at(-1).sticker.id, body.stickerId);
  assert.equal((await h.api(a, `/messages/${message.seq}`, 'PATCH', { text: 'غير مسموح' })).status, 400);
  const report = await h.api(b, '/reports', 'POST', { userId: a.id, messageSeq: message.seq, reason: 'فحص دليل الملصق' });
  assert.equal(report.status, 200); const evidence = await h.sql('SELECT * FROM social_reports WHERE message_seq=?', message.seq).first();
  assert.equal(evidence.sticker_id, body.stickerId); assert.equal(evidence.sticker_version, 1);
  await h.api(a, `/messages/${message.seq}`, 'DELETE');
  const deleted = await h.api(b, `/messages/${message.seq}`); assert.equal(deleted.body.message.stickerId, null); assert.equal(deleted.body.message.sticker, undefined);
  assert.equal((await h.api(a, path, 'POST', body)).status, 200);
  assert.equal((await h.sql('SELECT COUNT(*) AS n FROM social_messages WHERE sender_id=? AND client_id=?', a.id, body.clientId).first()).n, 1);
});

test('group stickers preserve join history, blocks, reports, removal and account deletion', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(); await h.friends(a, b); await h.plus(a);
  const made = await h.api(a, '/groups', 'POST', { name: 'لمة اختبار' }), g = made.body.group.id, path = `/groups/${g}/messages`;
  const old = await h.api(a, path, 'POST', stickerBody()); assert.equal(old.status, 200, JSON.stringify(old.body));
  const invited = await h.api(a, `/groups/${g}/invites`, 'POST', { userId: b.id });
  assert.equal((await h.api(b, `/groups/${g}/invites/${invited.body.invitation.id}/accept`, 'POST')).status, 200);
  assert.deepEqual((await h.api(b, path)).body.messages, []);
  const body = stickerBody(), sent = await h.api(a, path, 'POST', body); assert.equal(sent.status, 200);
  await h.sql("UPDATE subscriptions SET status='revoked' WHERE user_id=?", a.id).run();
  await h.sql('DELETE FROM social_jobs WHERE id LIKE ?', `%${body.clientId}%`).run();
  assert.equal((await h.api(a, path, 'POST', body)).body.message.seq, sent.body.message.seq);
  assert.equal((await h.sql('SELECT COUNT(*) AS n FROM social_jobs WHERE id LIKE ?', `%${body.clientId}%`).first()).n, 0);
  assert.equal((await h.api(a, path, 'POST', stickerBody())).status, 403);
  const report = await h.api(b, `/groups/${g}/reports`, 'POST', { messageSeq: sent.body.message.seq, reason: 'دليل' }); assert.equal(report.status, 200, JSON.stringify(report.body));
  assert.equal((await h.sql('SELECT sticker_id FROM social_reports WHERE message_seq=?', sent.body.message.seq).first()).sticker_id, body.stickerId);
  await h.api(b, '/blocks', 'POST', { userId: a.id }); assert.deepEqual((await h.api(b, path)).body.messages, []);
  await h.api(b, `/blocks/${a.id}`, 'DELETE');
  await h.api(b, `/groups/${g}/leave`, 'POST'); assert.equal((await h.api(b, path)).status, 404);
  await deleteUser(h.env, a.id);
  assert.equal((await h.sql('SELECT COUNT(*) AS n FROM social_group_messages WHERE sticker_id IS NOT NULL').first()).n, 0);
});

test('revocation committed after preflight cannot insert a new sticker or queue its notification', async t => {
  const h = await fixture(t), a = await h.user(), b = await h.user(), c = await h.friends(a, b); await h.plus(a);
  const batch = h.env.DB.batch.bind(h.env.DB); let revoked = false;
  h.env.DB.batch = async statements => {
    if (!revoked && statements.some(statement => statement.sql.includes('INSERT OR IGNORE INTO social_messages'))) {
      revoked = true; await h.sql("UPDATE subscriptions SET status='revoked' WHERE user_id=?", a.id).run();
    }
    return batch(statements);
  };
  const body = stickerBody(), result = await h.api(a, `/conversations/${c}/messages`, 'POST', body);
  assert.equal(result.status, 403, JSON.stringify(result.body));
  assert.equal((await h.sql('SELECT COUNT(*) AS n FROM social_messages WHERE client_id=?', body.clientId).first()).n, 0);
  assert.equal((await h.sql("SELECT COUNT(*) AS n FROM social_jobs WHERE id LIKE ?", `%${body.clientId}%`).first()).n, 0);
});

test('0016 preserves group sequence high-water mark, existing rows, indexes and idempotency constraints', async t => {
  const db = new LocalD1(); t.after(() => db.close());
  for (const name of readdirSync(MIGRATIONS_DIR).filter(name => name.endsWith('.sql') && name < '0016').sort()) db.database.exec(readFileSync(`${MIGRATIONS_DIR}/${name}`, 'utf8'));
  const insert = db.database.prepare("INSERT INTO social_group_messages(seq,group_id,sender_id,client_id,kind,text,original_hash,created_at,deleted_at) VALUES(?,'group','sender',?,'text',?,'hash',123,?)");
  insert.run(7, 'existing-key', 'original', null); insert.run(18, 'tombstone-key', '', 999); insert.run(90, 'removed-key', 'removed', null);
  db.database.exec('DELETE FROM social_group_messages WHERE seq=90');
  db.database.exec(readFileSync(`${MIGRATIONS_DIR}/0016_plus_stickers.sql`, 'utf8'));
  assert.deepEqual(db.database.prepare('SELECT seq,text,deleted_at FROM social_group_messages ORDER BY seq').all().map(row => ({ ...row })), [{ seq: 7, text: 'original', deleted_at: null }, { seq: 18, text: '', deleted_at: 999 }]);
  const next = db.database.prepare("INSERT INTO social_group_messages(group_id,sender_id,client_id,kind,text,original_hash,created_at,sticker_id,sticker_version) VALUES('group','sender','new-key','sticker','ملصق','hash',125,'sahra.sticker.1',1)").run();
  assert.equal(Number(next.lastInsertRowid), 91);
  assert.ok(db.database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='social_group_messages_group'").get());
  assert.throws(() => db.database.prepare("INSERT INTO social_group_messages(group_id,sender_id,client_id,kind,text,original_hash,created_at) VALUES('group','sender','existing-key','text','x','hash',1)").run(), /UNIQUE/);
  assert.throws(() => db.database.prepare("INSERT INTO social_group_messages(group_id,sender_id,client_id,kind,text,original_hash,created_at) VALUES('group','sender','bad-kind','html','x','hash',1)").run(), /CHECK/);
});

test('direct sticker delivery retries one immutable request and never resurrects another account', async t => {
  const requests = []; let rejectFirst = true;
  const c = new SocialClient({ server: () => '', request: async (path, options) => {
    requests.push(options.body); if (rejectFirst) { rejectFirst = false; throw { code: 'NETWORK' }; }
    return { message: { ...options.body, stickerVersion: 1, seq: 5, senderId: 'alice', conversationId: 'conversation', text: 'ملصق: كفو' } };
  } }); t.after(() => c.stop()); c.userId = 'alice'; c.state.friends = [{ id: 'bob', conversationId: 'conversation' }]; c.scheduleRefresh = () => {};
  await assert.rejects(c.sendSticker('bob', 'sahra.sticker.1'), { code: 'NETWORK' });
  const pending = c.state.conversations.bob.messages[0]; assert.equal(pending.status, 'failed');
  await c.retryMessage('bob', pending.clientId); assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(Object.keys(requests[0]).sort(), ['clientId', 'kind', 'stickerId']);
  assert.equal(c.state.conversations.bob.messages.length, 1); assert.equal(c.state.conversations.bob.messages[0].seq, 5);
  let done; c.request = async () => new Promise(resolve => { done = resolve; });
  const late = c.sendSticker('bob', 'artist.sticker.1'); c.stop(); c.userId = 'another';
  done({ message: { seq: 6, conversationId: 'conversation' } }); await late.catch(() => {});
  assert.deepEqual(c.state.conversations, {});
});

test('group sticker retries retain kind and client identity and account switch fences responses', async t => {
  const requests = []; let first = true;
  const c = new LammaClient({ request: async (path, options) => {
    requests.push(options.body); if (first) { first = false; throw { code: 'NETWORK' }; }
    return { message: { ...options.body, seq: 11, senderId: 'alice', groupId: 'group', conversationId: 'group' } };
  } }); t.after(() => c.stop()); c.userId = 'alice'; c.refresh = async () => {};
  await assert.rejects(c.sendGroupSticker('group', 'sahra.sticker.1'), { code: 'NETWORK' });
  const pending = c.state.groupConversations.group.messages[0]; assert.equal(pending.kind, 'sticker');
  await c.retryGroupMessage('group', pending.clientId); assert.deepEqual(requests[0], requests[1]);
  assert.equal(c.state.groupConversations.group.messages.length, 1); assert.equal(c.pendingText.size, 0);
  let done; c.request = async () => new Promise(resolve => { done = resolve; });
  const late = c.sendGroupSticker('group', 'artist.sticker.1'); c.stop(); c.userId = 'another';
  done({ message: { seq: 12, groupId: 'group', conversationId: 'group' } }); await assert.rejects(late, { code: 'STALE' });
  assert.deepEqual(c.state.groupConversations, {});
});
