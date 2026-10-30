import test from 'node:test';
import assert from 'node:assert/strict';
import { SocialHub, allowsRealtimeContent } from '../server/social/realtime.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';

const NOW = Date.now();
function environment(locked = ['player']) {
  return { MAFIA_ENABLED: '1', DB: { prepare(sql) { return { bind(...args) { return { async first() {
    assert.match(sql, /mafia_media_leases/, 'locked communications must stop before fetching content');
    return locked.includes(args[0]) ? { user_id: args[0], room_key: 'game', expires_at: NOW + 60_000 } : null;
  } }; } }; } } };
}
async function harness(t) {
  // Execute the final joined session/content ACL against the real schema, not
  // a .first-only stub that can neither batch nor prove recipient permissions.
  const DB = createLocalD1(); t.after(() => DB.close());
  for (const id of ['player','peer']) await DB.prepare('INSERT INTO users(id,created_at,updated_at)VALUES(?,?,?)').bind(id,NOW,NOW).run();
  await DB.prepare('INSERT INTO sessions(id,user_id,secret_hash,created_at,last_seen,expires_at)VALUES(?,?,?,?,?,?)').bind('session','player','fixture-hash',NOW,NOW,NOW+60000).run();
  await DB.prepare('INSERT INTO mafia_match_leases(user_id,room_key,match_id,expires_at,updated_at)VALUES(?,?,?,?,?)').bind('player','game','match',NOW+60000,NOW).run();
  const messages = [], outgoing = [], sockets = [], data = { userId: 'player', tickets: {}, typingAt: 0, typingCount: 0,onlineBroadcast:true,presenceWrittenAt:NOW,lastActiveAt:NOW };
  const ctx = {
    storage: { async get() { return structuredClone(data); }, async put() {}, async setAlarm() {}, async deleteAlarm() {} },
    getWebSockets: () => sockets, blockConcurrencyWhile: task => task(), waitUntil: task => outgoing.push(task),
  };
  const hub = new SocialHub(ctx, {DB,MAFIA_ENABLED:'1'}); await hub.ready;
  hub.now = () => NOW;
  hub.schedule = async () => {}; hub.presence = async () => {};
  const ws = { readyState: 1, attachment: { sessionId: 'session', validUntil: NOW + 60_000, seenAt: NOW, windowAt: NOW, count: 0 },
    serializeAttachment(value) { this.attachment = value; }, deserializeAttachment() { return this.attachment; },
    send(value) { messages.push(JSON.parse(value)); }, close(code) { this.readyState = 3; this.closedCode = code; } };
  sockets.push(ws);
  const notify = event => hub.fetch(new Request('https://social.internal/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'player', event }) }));
  return { hub, ws, messages, outgoing, notify };
}

test('Mafia live lease suppresses messages, group content, calls and typing even on pre-existing SocialHub sockets', async t => {
  const h = await harness(t);
  for (const event of [
    { type: 'message', messageSeq: 10, conversationId: 'peer', text: 'private' },
    { type: 'group', reason: 'message', messageSeq: 10, groupId: 'friends', text: 'private' },
    { type: 'group', reason: 'edited', messageSeq: 10, groupId: 'friends', text: 'private' },
    { type: 'call', callId: 'outside-call', reason: 'ringing' },
    { type: 'typing', userId: 'peer', active: true },
  ]) assert.equal((await h.notify(event)).status, 200);
  assert.deepEqual(h.messages, []); assert.equal(h.ws.readyState, 1);
  await h.hub.webSocketMessage(h.ws, JSON.stringify({ type: 'typing', peerId: 'peer', active: true }));
  assert.deepEqual(h.messages, [{ type: 'error', error: 'MAFIA_SOCIAL_LOCKED' }]);
  assert.deepEqual(h.outgoing, []);
});

test('Mafia locks preserve deletion invalidation and immediate sign-out of the existing socket', async t => {
  const h = await harness(t);
  const deletion = { type: 'group', reason: 'deleted', groupId: 'friends' };
  assert.equal((await h.notify(deletion)).status, 200);
  assert.deepEqual(h.messages, [deletion]);
  await h.notify({ type: 'session_revoked', sessionId: 'session' });
  assert.equal(h.ws.readyState, 3); assert.equal(h.ws.closedCode, 4401);
});

test('a queued typing event from an account that entered Mafia is also suppressed at the free recipient', async () => {
  assert.equal(await allowsRealtimeContent(environment(['sender']), 'recipient', { type: 'typing', userId: 'sender', active: true }), false);
  assert.equal(await allowsRealtimeContent(environment([]), 'recipient', { type: 'typing', userId: 'sender', active: true }), true);
  assert.equal(await allowsRealtimeContent(environment(), 'player', { type: 'refresh', reason: 'safety' }), true);
});
