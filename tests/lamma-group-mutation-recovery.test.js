import test from 'node:test';
import assert from 'node:assert/strict';
import { LammaClient } from '../src/social/lamma-client.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const group = { id: 'g', name: 'لمّة الاختبار', role: 'member', joinedAt: 20 };
const invitation = { id: 'invite', groupId: 'g' };
function fixture(t, request) {
  const client = new LammaClient({ request }); client.userId = 'alice';
  client.update({ groupInvites: [invitation] }); t.after(() => client.stop()); return client;
}
const otherRead = path => path.endsWith('/calls') ? { calls: [] } : {};

test('accepted invitation replaces a pre-commit list read without resurrecting the invitation or repeating POST', async t => {
  const oldList = deferred(); let reads = 0, posts = 0;
  const client = fixture(t, async (path, options) => {
    if (options?.method === 'POST') { posts++; return { group, members: [{ id: 'alice' }] }; }
    if (path === '/api/social/groups') return ++reads === 1 ? oldList.promise : { groups: [group], incoming: [] };
    return otherRead(path);
  });
  const old = client.refresh().then(value => ({ value }), error => ({ error }));
  const joined = client.acceptGroupInvite('g', 'invite').then(value => ({ value }), error => ({ error }));
  await turn();
  const acknowledged = { groups: client.state.groups, invites: client.state.groupInvites };
  oldList.resolve({ groups: [], incoming: [invitation] });
  const outcome = await joined;
  assert.equal(outcome.error, undefined, 'a committed acceptance must not fail because its older GET becomes stale');
  assert.equal((await old).error?.code, 'STALE');
  assert.equal(reads, 2, 'a new authorized read must replace the pre-mutation read');
  assert.equal(posts, 1);
  assert.deepEqual(acknowledged.groups.map(value => value.id), ['g']);
  assert.deepEqual(acknowledged.invites, []);
  assert.deepEqual(client.state.groups.map(value => value.id), ['g']);
  assert.deepEqual(client.state.groupInvites, []);
});

test('acknowledged membership survives a failed follow-up GET and retrying reads never repeats the mutation', async t => {
  let posts = 0;
  const client = fixture(t, async (path, options) => {
    if (options?.method === 'POST') { posts++; return { group }; }
    if (path === '/api/social/groups') throw { code: 'NETWORK' };
    return otherRead(path);
  });
  const result = await client.acceptGroupInvite('g', 'invite');
  assert.equal(result.group.id, 'g');
  assert.deepEqual(client.state.groups.map(value => value.id), ['g']);
  assert.deepEqual(client.state.groupInvites, []);
  assert.equal(client.state.offline, true, 'read availability remains visible separately from the committed action');
  await assert.rejects(client.refresh({ quiet: true }), { code: 'NETWORK' });
  assert.equal(posts, 1);
});

test('rejection removes only the acknowledged invitation even when list reconciliation fails', async t => {
  const client = fixture(t, async (_path, options) => {
    if (options?.method === 'POST') return { ok: true };
    throw { code: 'NETWORK' };
  });
  client.update({ groupInvites: [invitation, { id: 'another', groupId: 'g' }] });
  assert.deepEqual(await client.rejectGroupInvite('g', 'invite'), { ok: true });
  assert.deepEqual(client.state.groupInvites.map(value => value.id), ['another']);
});

test('an account replacement during the POST cannot publish membership or start its reconciliation', async t => {
  const pending = deferred(); let reads = 0;
  const client = fixture(t, (_path, options) => { if (options?.method === 'POST') return pending.promise; reads++; return {}; });
  const joining = client.acceptGroupInvite('g', 'invite');
  client.stop(); client.userId = 'bob'; pending.resolve({ group });
  await assert.rejects(joining, { code: 'STALE' });
  assert.deepEqual(client.state.groups, []); assert.deepEqual(client.state.groupInvites, []); assert.equal(reads, 0);
});

test('a scheduled post-commit replacement read cannot run under the next account', async t => {
  const oldList = deferred(); let reads = 0;
  const client = fixture(t, (path, options) => options?.method === 'POST' ? { group } : path === '/api/social/groups' ? (++reads, oldList.promise) : otherRead(path));
  const old = client.refresh().catch(() => {}), joining = client.acceptGroupInvite('g', 'invite');
  const joined = joining.then(value => ({ value }), error => ({ error })); await turn();
  client.stop(); client.userId = 'bob'; oldList.resolve({ groups: [], incoming: [invitation] });
  await old; assert.equal((await joined).error?.code, 'STALE'); await turn();
  assert.equal(reads, 1); assert.deepEqual(client.state.groups, []); assert.deepEqual(client.state.groupInvites, []);
});

test('authorization changed during the POST prevents its summary from repopulating revoked membership', async t => {
  const pending = deferred();
  const client = fixture(t, (_path, options) => options?.method === 'POST' ? pending.promise : Promise.reject({ code: 'NETWORK' }));
  const joining = client.acceptGroupInvite('g', 'invite');
  client.invalidateAudio(); client.update({ groups: [], groupConversations: {} });
  pending.resolve({ group, members: [{ id: 'alice', name: 'Old private profile' }] });
  assert.equal((await joining).group.id, 'g');
  assert.deepEqual(client.state.groups, []); assert.deepEqual(client.state.groupConversations, {}); assert.deepEqual(client.state.callMembers, {});
});

test('a confirmed leave purges private group state before old reads settle and cannot be undone by those reads', async t => {
  const oldList = deferred(), detail = deferred(); const revoked = []; let lists = 0;
  const client = fixture(t, (path, options) => {
    if (options?.method === 'POST') return { ok: true };
    if (path === '/api/social/groups') { if (++lists === 1) return oldList.promise; throw { code: 'NETWORK' }; }
    if (path === '/api/social/groups/g') return detail.promise;
    if (path.endsWith('/messages')) return { messages: [{ seq: 4, text: 'Private history' }] };
    return otherRead(path);
  });
  client.revokeURL = value => revoked.push(value); client.urls.set('voice', 'blob:private');
  client.update({ groups: [group], callMembers: { g: [{ id: 'alice' }] } });
  client.group('g', { messages: [{ seq: 1, text: 'Private history' }], members: [{ id: 'alice' }] });
  client.selectGroup('g'); client.setCallContext({ id: 'call', scope: 'group', conversationId: 'g' });
  const loading = client.loadGroup('g').then(value => ({ value }), error => ({ error }));
  const old = client.refresh().catch(() => {}), leaving = client.leaveGroup('g').then(value => ({ value }), error => ({ error }));
  await turn();
  const immediate = { groups: client.state.groups, history: client.state.groupConversations, active: client.activeGroup, revoked: client.revokedCallGroups.has('g') };
  detail.resolve({ group, members: [{ id: 'alice' }] }); oldList.resolve({ groups: [group], incoming: [] });
  await old;
  assert.equal((await leaving).error, undefined);
  assert.equal((await loading).error?.code, 'STALE');
  assert.deepEqual(immediate.groups, []); assert.deepEqual(immediate.history, {}); assert.equal(immediate.active, null); assert.equal(immediate.revoked, true);
  assert.deepEqual(client.state.groupConversations, {}); assert.deepEqual(client.state.callMembers, {}); assert.deepEqual(revoked, ['blob:private']);
});
