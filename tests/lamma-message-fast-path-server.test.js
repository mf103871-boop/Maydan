import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeSocial } from '../server/social/router.mjs';
import { errorResponse } from '../server/protocol.mjs';
import { LammaClient } from '../src/social/lamma-client.js';

// Real router, SQL, auth, membership and message visibility; no remote backend,
// provider connection or synthetic timing is represented as edge performance.
async function fixture(t) {
  const env = { DB: createLocalD1() }; t.after(() => env.DB.close());
  const user = async name => { const actor = await createUser(env, { name }); const session = await issueSession(env, actor.id); return { ...actor, token: session.token }; };
  const request = async (actor, path, options = {}) => {
    const req = new Request(`https://local.test/api/social${path}`, { method: options.method || 'GET', headers: {
      authorization: `Bearer ${actor.token}`, ...(options.body ? { 'content-type': 'application/json' } : {}),
    }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
    let response; try { response = await routeSocial(req, env); } catch (error) { response = errorResponse(error); }
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error), { code: result.error, status: response.status });
    return result;
  };
  const post = (actor, path, body = {}) => request(actor, path, { method: 'POST', body });
  const friends = async (a, b) => { const sent = await post(a, '/requests', { userId: b.id }); await post(b, `/requests/${sent.request.id}/accept`); };
  const join = async (a, b, id) => { const sent = await post(a, `/groups/${id}/invites`, { userId: b.id }); await post(b, `/groups/${id}/invites/${sent.invitation.id}/accept`); };
  const send = async (actor, id, text) => (await post(actor, `/groups/${id}/messages`, { clientId: crypto.randomUUID(), text })).message;
  const client = async (actor, id) => {
    const paths = [], value = new LammaClient({ request: (path, options) => { paths.push(path); return request(actor, path.slice('/api/social'.length), options); } });
    value.userId = actor.id; await value.refresh(); value.selectGroup(id); paths.length = 0;
    t.after(() => value.stop()); return { client: value, paths };
  };
  return { env, user, request, post, friends, join, send, client };
}

test('two real authenticated GETs give the active group the same unread total as the full list', async t => {
  const h = await fixture(t), a = await h.user('owner'), b = await h.user('reader'), c = await h.user('third');
  await h.friends(a, b); await h.friends(a, c);
  const id = (await h.post(a, '/groups', { name: 'Connection test' })).group.id;
  await h.send(a, id, 'BEFORE JOIN'); await h.join(a, b, id); await h.join(a, c, id);
  const first = await h.send(a, id, 'VISIBLE');
  await h.send(b, id, 'OWN'); const removed = await h.send(a, id, 'DELETE ME');
  await h.send(c, id, 'BLOCKED TEXT');
  await h.request(a, `/groups/${id}/messages/${removed.seq}`, { method: 'DELETE' });
  await h.post(b, '/blocks', { userId: c.id });
  const { client, paths } = await h.client(b, id);
  await client.refreshGroupMessage(id);
  assert.deepEqual(paths, [`/api/social/groups/${id}`, `/api/social/groups/${id}/messages`]);
  const listing = (await h.request(b, '/groups')).groups.find(group => group.id === id);
  assert.equal(listing.unreadCount, 1);
  assert.equal(client.state.groups[0].unreadCount, listing.unreadCount);
  assert.equal(client.state.groups[0].lastMessage.seq, listing.lastMessage.seq);
  const texts = client.state.groupConversations[id].messages.map(message => message.text);
  assert.equal(texts.includes('BEFORE JOIN'), false); assert.equal(texts.includes('BLOCKED TEXT'), false); assert.equal(texts.includes('DELETE ME'), false);
  assert.equal(texts.includes('VISIBLE'), true); assert.equal(texts.includes('OWN'), true);
  await client.markGroupRead(id, removed.seq); paths.length = 0;
  await client.refreshGroupMessage(id);
  assert.equal(client.state.groups[0].unreadCount, 0);
  assert.equal(client.state.groups[0].readSeq, removed.seq);
  assert.equal(client.state.groupConversations[id].messages.some(message => message.seq === first.seq), true);
});

test('real leave/rejoin boundary reauthorizes old loaded pages and excludes both pre-join and absent-period messages', async t => {
  const h = await fixture(t), a = await h.user('owner'), b = await h.user('reader'); await h.friends(a, b);
  const id = (await h.post(a, '/groups', { name: 'Join boundary' })).group.id;
  await h.join(a, b, id); await h.send(a, id, 'OLD MEMBERSHIP');
  const { client, paths } = await h.client(b, id); await client.loadGroup(id);
  assert.equal(client.state.groupConversations[id].messages[0].text, 'OLD MEMBERSHIP');
  await h.post(b, `/groups/${id}/leave`); await h.send(a, id, 'WHILE ABSENT');
  await h.join(a, b, id); await h.send(a, id, 'NEW MEMBERSHIP');
  client.invalidateAudio(); paths.length = 0;
  await client.refreshGroupMessage(id);
  assert.deepEqual(client.state.groupConversations[id].messages.map(message => message.text), ['NEW MEMBERSHIP']);
  assert.equal(client.state.groups[0].unreadCount, 1);
  assert.equal(paths.some(path => path.endsWith('/calls')), false);
});

test('fresh group detail unread count follows blocking, deletion, read markers and membership denial', async t => {
  const h = await fixture(t), a = await h.user('owner'), b = await h.user('reader'); await h.friends(a, b);
  const id = (await h.post(a, '/groups', { name: 'Counts' })).group.id;
  await h.join(a, b, id); const one = await h.send(a, id, 'one'), two = await h.send(a, id, 'two');
  assert.equal((await h.request(b, `/groups/${id}`)).group.unreadCount, 2);
  await h.request(a, `/groups/${id}/messages/${two.seq}`, { method: 'DELETE' });
  assert.equal((await h.request(b, `/groups/${id}`)).group.unreadCount, 1);
  await h.post(b, `/groups/${id}/read`, { seq: one.seq });
  assert.equal((await h.request(b, `/groups/${id}`)).group.unreadCount, 0);
  await h.send(a, id, 'three'); await h.post(b, '/blocks', { userId: a.id });
  assert.equal((await h.request(b, `/groups/${id}`)).group.unreadCount, 0);
  await h.post(b, `/groups/${id}/leave`);
  await assert.rejects(h.request(b, `/groups/${id}`), { code: 'NOT_FOUND' });
});
