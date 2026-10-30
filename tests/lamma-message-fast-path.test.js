import test from 'node:test';
import assert from 'node:assert/strict';
import { LammaClient } from '../src/social/lamma-client.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const group = { id: 'g', name: 'Our group', joinedAt: 10, role: 'member', unreadCount: 0, memberCount: 2 };
const message = (seq, text = `message-${seq}`, senderId = 'bob') => ({ seq, text, senderId, groupId: 'g', conversationId: 'g' });
const detail = (patch = {}) => ({ group: { ...group, ...patch }, members: [{ id: 'alice' }, { id: 'bob' }] });
function fixture(t, request) {
  const client = new LammaClient({ request }); client.userId = 'alice';
  client.update({ groups: [group], calls: [{ id: 'existing-call' }], preferences: { sound: false }, capabilities: { liveCalls: true, groupMessageSummary: true } });
  client.selectGroup('g'); t.after(() => client.stop()); return client;
}
function router(paths, { history = () => ({ messages: [message(2)], hasMore: false }), info = () => detail({ unreadCount: 1 }), list = () => [group], calls = () => ({ calls: [] }) } = {}) {
  return async path => {
    paths.push(path);
    if (path === '/api/social/groups/g') return info();
    if (path.startsWith('/api/social/groups/g/messages')) return history(path);
    if (path === '/api/social/groups') return { groups: await list(), incoming: [] };
    if (path === '/api/social/calls') return calls();
    if (path === '/api/social/preferences') return { sound: false };
    if (path === '/api/social/capabilities') return { liveCalls: true, groupMessageSummary: true };
    throw Error(`Unexpected request ${path}`);
  };
}

test('an active group message renders through two authorized GETs without waiting for call-list I/O', async t => {
  const paths = [], client = fixture(t, router(paths, { calls: () => new Promise(() => {}) }));
  await client.refreshGroupMessage('g');
  assert.deepEqual(paths, ['/api/social/groups/g', '/api/social/groups/g/messages']);
  assert.deepEqual(client.state.groupConversations.g.messages.map(m => m.seq), [2]);
  assert.equal(client.state.groups[0].unreadCount, 1);
  assert.equal(client.state.groups[0].lastMessage.seq, 2);
  assert.equal(client.state.calls[0].id, 'existing-call');
  assert.equal(client.state.preferences.sound, false);
  assert.equal(client.state.capabilities.liveCalls, true);
});

test('the unchanged full recovery remains six GETs and replaces revoked history', async t => {
  const paths = [], client = fixture(t, router(paths));
  client.group('g', { messages: [message(1, 'BLOCKED OLD TEXT')] });
  await client.refresh({ quiet: true });
  assert.equal(paths.length, 6);
  assert.deepEqual(client.state.groupConversations.g.messages.map(m => m.text), ['message-2']);
});

test('fast delivery reauthorizes every loaded older page and removes blocked and deleted cached rows', async t => {
  const paths = [], client = fixture(t, router(paths, { history: path => path.includes('before=')
    ? { messages: [message(1, 'allowed-old'), message(4, 'allowed-middle')], hasMore: false }
    : { messages: [message(8, 'new')], hasMore: true, nextBefore: 8 } }));
  const failed = { senderId: 'alice', clientId: 'retry', text: 'MY UNSENT', status: 'failed' };
  client.group('g', { messages: [message(1), message(2, 'BLOCKED'), message(3, 'DELETED'), failed] });
  await client.refreshGroupMessage('g');
  assert.deepEqual(paths, ['/api/social/groups/g', '/api/social/groups/g/messages', '/api/social/groups/g/messages?before=8']);
  assert.deepEqual(client.state.groupConversations.g.messages.map(m => m.text), ['allowed-old', 'allowed-middle', 'new', 'MY UNSENT']);
  assert.equal(client.state.groups[0].lastMessage.seq, 8, 'the failed outbox is never a server last-message preview');
});

test('overlapping notices share the in-flight read and run one fresh follow-up for the burst', async t => {
  const paths = [], wait = deferred(); let histories = 0;
  const client = fixture(t, router(paths, { history: () => ++histories === 1 ? wait.promise : { messages: [message(3)], hasMore: false } }));
  const first = client.refreshGroupMessage('g');
  const next = client.refreshGroupMessage('g'), third = client.refreshGroupMessage('g');
  assert.equal(paths.length, 2);
  wait.resolve({ messages: [message(2)], hasMore: false }); await Promise.all([first, next, third]);
  assert.equal(paths.length, 4, 'the burst is two passes, not three simultaneous loads or six-GET refreshes');
  assert.deepEqual(client.state.groupConversations.g.messages.map(m => m.seq), [3]);
});

test('a message arriving while a stale history is invalidated by our ACK is not lost', async t => {
  const wait = deferred(); let histories = 0;
  const client = fixture(t, router([], { history: () => ++histories === 1 ? wait.promise : { messages: [message(2), message(3, 'own', 'alice')], hasMore: false } }));
  const first = client.refreshGroupMessage('g');
  client.publishGroupMessage('g', message(3, 'own', 'alice'));
  const next = client.refreshGroupMessage('g');
  wait.resolve({ messages: [message(1)], hasMore: false });
  await Promise.all([first, next]);
  assert.deepEqual(client.state.groupConversations.g.messages.map(m => m.seq), [2, 3]);
});

test('an old account response and finally cannot populate or clear the new account fast-read owner', async t => {
  const a = deferred(), b = deferred(); let histories = 0;
  const client = fixture(t, router([], { history: () => ++histories === 1 ? a.promise : histories === 2 ? b.promise : { messages: [message(9, 'B NEW')], hasMore: false } }));
  const old = client.refreshGroupMessage('g').catch(error => error);
  client.stop(); client.userId = 'other-account'; client.update({ groups: [group], capabilities: { groupMessageSummary: true } }); client.selectGroup('g');
  const current = client.refreshGroupMessage('g');
  a.resolve({ messages: [message(1, 'A PRIVATE')], hasMore: false });
  assert.equal((await old).code, 'STALE');
  const next = client.refreshGroupMessage('g'); assert.equal(histories, 2);
  b.resolve({ messages: [message(8, 'B')], hasMore: false });
  await Promise.all([current, next]);
  assert.equal(histories, 3);
  assert.deepEqual(client.state.groupConversations.g.messages.map(m => m.text), ['B NEW']);
});

test('block/membership invalidation fences an old fast read and its queued follow-up', async t => {
  const wait = deferred(); let histories = 0;
  const client = fixture(t, router([], { history: () => { histories++; return wait.promise; } }));
  const old = client.refreshGroupMessage('g').catch(error => error);
  const queued = client.refreshGroupMessage('g').catch(error => error);
  client.invalidateAudio();
  wait.resolve({ messages: [message(2, 'REVOKED')], hasMore: false });
  assert.equal((await old).code, 'STALE'); assert.equal((await queued).code, 'STALE');
  assert.equal(histories, 1); assert.equal(client.state.groupConversations.g, undefined);
});

test('denial during a fast read immediately revokes cached audio, content, list entry and pending list authority', async t => {
  const oldList = deferred(), revoked = []; let lists = 0;
  const paths = [], client = fixture(t, router(paths, { list: () => { lists++; return oldList.promise; }, info: () => { throw { code: 'NOT_FOUND' }; } }));
  // A full read already in flight must not resurrect this denied membership.
  const old = client.refresh({ quiet: true }).catch(error => error);
  client.urls.set('private', 'blob:private'); client.revokeURL = value => revoked.push(value);
  client.group('g', { group: { ...group, name: 'PRIVATE TITLE' }, messages: [message(1, 'PRIVATE')], members: [{ id: 'alice' }], invitations: [{ id: 'PRIVATE INVITE' }] });
  await assert.rejects(client.refreshGroupMessage('g'), { code: 'NOT_FOUND' });
  assert.deepEqual(revoked, ['blob:private']); assert.deepEqual(client.state.groups, []);
  assert.equal(client.state.groupConversations.g, undefined);
  oldList.resolve([group]); assert.equal((await old).code, 'STALE');
  assert.deepEqual(client.state.groups, []); assert.equal(lists, 1);
});

test('switching away does not run queued reads for a conversation no longer active', async t => {
  const wait = deferred(); let histories = 0;
  const client = fixture(t, router([], { history: () => { histories++; return wait.promise; } }));
  const first = client.refreshGroupMessage('g'), next = client.refreshGroupMessage('g');
  client.selectGroup(null); wait.resolve({ messages: [message(2)], hasMore: false });
  await Promise.all([first, next]); assert.equal(histories, 1);
});

test('a later retry succeeds after network error without retaining a rejected in-flight owner', async t => {
  let broken = true;
  const client = fixture(t, router([], { history: () => { if (broken) throw { code: 'NETWORK' }; return { messages: [message(5)], hasMore: false }; } }));
  await assert.rejects(client.refreshGroupMessage('g'), { code: 'NETWORK' });
  broken = false; await client.refreshGroupMessage('g');
  assert.equal(client.state.groupConversations.g.messages[0].seq, 5);
});

test('message notices for an inactive group retain full authoritative list recovery', async t => {
  const paths = [], client = fixture(t, router(paths)); client.selectGroup(null);
  await client.refreshGroupMessage('g');
  assert.deepEqual(paths.sort(), ['/api/social/groups', '/api/social/preferences', '/api/social/capabilities', '/api/social/calls'].sort());
});

test('a full membership refresh still clears a previously active conversation', async t => {
  const paths = [], client = fixture(t, router(paths, { list: () => [] }));
  client.group('g', { messages: [message(1)] });
  await client.refresh({ quiet: true });
  assert.deepEqual(client.state.groups, []); assert.deepEqual(client.state.groupConversations, {});
  await turn();
});

test('old or malformed capabilities retain six-GET recovery and never apply a placeholder detail unread count', async t => {
  for (const flag of [undefined, false, 1, 'true']) {
    const paths = [], client = fixture(t, router(paths, { list: () => [{ ...group, unreadCount: 3 }], info: () => detail({ unreadCount: 0 }) }));
    client.state.capabilities = { groupMessageSummary: flag };
    const original = client.request;
    client.request = (path, options) => path.endsWith('/capabilities') ? (paths.push(path), { groupMessageSummary: flag }) : original(path, options);
    await client.refreshGroupMessage('g');
    assert.equal(paths.length, 6); assert.equal(client.state.groups[0].unreadCount, 3);
  }
});

test('the refreshed group keeps the existing updatedAt descending and id tie-break list order', async t => {
  const client = fixture(t, router([], { info: () => detail({ updatedAt: 30 }) }));
  client.update({ groups: [{ id: 'older', updatedAt: 20 }, { ...group, updatedAt: 10 }, { id: 'a', updatedAt: 30 }] });
  await client.refreshGroupMessage('g');
  assert.deepEqual(client.state.groups.map(value => value.id), ['a', 'g', 'older']);
});
