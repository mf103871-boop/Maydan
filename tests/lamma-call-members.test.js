import test from 'node:test';
import assert from 'node:assert/strict';
import { LammaClient } from '../src/social/lamma-client.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const call = (id = 'call', conversationId = 'g') => ({ id, scope: 'group', conversationId });
const member = (id, extra = {}) => ({ id, userId: id, name: id, ...extra });
const fixture = (t, request) => {
  const client = new LammaClient({ request }); client.userId = 'alice'; client.setCallContext(call());
  t.after(() => client.stop()); return client;
};
const refreshRoute = (path, groups) => {
  if (path.endsWith('/groups')) return { groups };
  if (path.endsWith('/calls')) return { calls: [] };
  if (path.endsWith('/preferences')) return {};
  if (path.endsWith('/capabilities')) return {};
  throw new Error(`Unexpected request: ${path}`);
};

test('restoring a group call loads normalized profiles without opening or reading its conversation', async t => {
  const paths = [];
  const client = fixture(t, async path => {
    paths.push(path);
    return { group: { id: 'g' }, members: [member('alice', { avatarPreset: 'spark' }),
      { userId: 'bob', profile: { id: 'bob', name: 'باسم', avatarUrl: '/api/profiles/bob/avatar?v=2', theme: 'teal' }, role: 'member' },
      member('alice'), {}, null] };
  });
  const members = await client.loadCallMembers('g');
  assert.deepEqual(paths, ['/api/social/groups/g']);
  assert.deepEqual(members.map(value => value.id), ['alice', 'bob']);
  assert.equal(members[1].userId, 'bob'); assert.equal(members[1].name, 'باسم');
  assert.equal(members[1].avatarUrl, '/api/profiles/bob/avatar?v=2');
  assert.equal(client.state.callMembers.g, members);
  assert.deepEqual(client.state.groupConversations, {}); assert.equal(client.activeGroup, undefined);
});

test('call roster requires the matching active group call and deduplicates concurrent and cached reads', async t => {
  const pending = deferred(); let requests = 0;
  const client = fixture(t, () => { requests++; return pending.promise; });
  await assert.rejects(client.loadCallMembers('another'), { code: 'STALE' });
  client.setCallContext({ id: 'direct', scope: 'direct', conversationId: 'g' });
  await assert.rejects(client.loadCallMembers('g'), { code: 'STALE' });
  assert.equal(requests, 0);
  client.setCallContext(call());
  const first = client.loadCallMembers('g'), second = client.loadCallMembers('g');
  assert.equal(requests, 1); pending.resolve({ members: [member('alice')] });
  assert.equal(await first, await second);
  assert.equal(await client.loadCallMembers('g'), client.state.callMembers.g); assert.equal(requests, 1);
});

test('an old account roster cannot populate the next account or clear its newer request', async t => {
  const first = deferred(), second = deferred(); let requests = 0;
  const client = fixture(t, () => ++requests === 1 ? first.promise : second.promise);
  const old = client.loadCallMembers('g'); client.stop(); client.userId = 'bob'; client.setCallContext(call());
  const current = client.loadCallMembers('g');
  first.resolve({ members: [member('alice', { name: 'ALICE PRIVATE' })] });
  await assert.rejects(old, { code: 'STALE' });
  const deduplicated = client.loadCallMembers('g'); assert.equal(requests, 2);
  second.resolve({ members: [member('bob')] });
  assert.equal(await current, await deduplicated);
  assert.deepEqual(client.state.callMembers.g.map(value => value.id), ['bob']);
});

for (const change of ['end', 'replace', 'block']) test(`${change} invalidates both visible and in-flight call profiles`, async t => {
  const pending = deferred(); let reads = 0;
  const client = fixture(t, () => ++reads === 1 ? { members: [member('alice')] } : pending.promise);
  await client.loadCallMembers('g');
  client.invalidateAudio();
  const loading = client.loadCallMembers('g');
  if (change === 'block') client.invalidateAudio();
  else client.setCallContext(change === 'end' ? null : call('replacement'));
  assert.deepEqual(client.state.callMembers, {});
  pending.resolve({ members: [member('alice', { name: 'OLD CALL PRIVATE' })] });
  await assert.rejects(loading, { code: 'STALE' }); assert.deepEqual(client.state.callMembers, {});
});

test('a membership refresh removes revoked profiles and fences a detail request already in flight', async t => {
  const pending = deferred(); let allowed = true;
  const client = fixture(t, path => path === '/api/social/groups/g' ? pending.promise : refreshRoute(path, allowed ? [{ id: 'g', memberCount: 2 }] : []));
  await client.refresh(); const loading = client.loadCallMembers('g');
  allowed = false; await client.refresh();
  pending.resolve({ members: [member('alice'), member('bob')] });
  await assert.rejects(loading, { code: 'STALE' });
  assert.deepEqual(client.state.callMembers, {});
  await assert.rejects(client.loadCallMembers('g'), { code: 'FORBIDDEN' });
});

test('membership changes invalidate the call cache while unrelated list refreshes preserve it', async t => {
  let memberCount = 2, rosterReads = 0;
  const client = fixture(t, path => path === '/api/social/groups/g' ? (++rosterReads, { members: [member('alice')] }) : refreshRoute(path, [{ id: 'g', memberCount, role: 'member', joinedAt: 10 }]));
  await client.refresh(); await client.loadCallMembers('g'); await client.refresh(); await client.loadCallMembers('g');
  assert.equal(rosterReads, 1);
  memberCount = 3; await client.refresh(); assert.deepEqual(client.state.callMembers, {});
  await client.loadCallMembers('g'); assert.equal(rosterReads, 2);
});

test('network failure is retryable, whereas denied profiles stay absent until membership is authorized again', async t => {
  let failure = 'NETWORK', detailReads = 0;
  const client = fixture(t, path => {
    if (path !== '/api/social/groups/g') return refreshRoute(path, [{ id: 'g' }]);
    detailReads++; if (failure) throw { code: failure }; return { members: [member('alice')] };
  });
  await assert.rejects(client.loadCallMembers('g'), { code: 'NETWORK' });
  failure = 'FORBIDDEN'; await assert.rejects(client.loadCallMembers('g'), { code: 'FORBIDDEN' });
  failure = null; await assert.rejects(client.loadCallMembers('g'), { code: 'FORBIDDEN' }); assert.equal(detailReads, 2);
  assert.deepEqual(client.state.callMembers, {});
  await client.refresh(); await client.loadCallMembers('g'); assert.equal(detailReads, 3);
});

test('a denied roster publishes one invalidation and subsequent loader retries cannot cause a render loop', async t => {
  let requests = 0, publications = 0;
  const client = fixture(t, () => { requests++; throw { code: 'FORBIDDEN' }; });
  const unsubscribe = client.subscribe(() => publications++); t.after(unsubscribe);
  await assert.rejects(client.loadCallMembers('g'), { code: 'FORBIDDEN' });
  const invalidated = client.state.callMembers;
  for (let i = 0; i < 5; i++) await assert.rejects(client.loadCallMembers('g'), { code: 'FORBIDDEN' });
  assert.equal(requests, 1); assert.equal(publications, 1);
  assert.equal(client.state.callMembers, invalidated);
});

for (const mode of ['detail', 'quiet detail', 'older history']) test(`revoked membership fences an in-flight ${mode} from restoring fallback members or messages`, async t => {
  const pending = deferred();
  const client = fixture(t, path => path === '/api/social/groups/g' || path.includes('/groups/g/messages')
    ? pending.promise : refreshRoute(path, []));
  if (mode !== 'quiet detail') client.group('g', { members: [member('bob')], messages: [{ seq: 10, text: 'old' }], hasMore: true, nextBefore: 10 });
  const loading = mode === 'older history' ? client.loadOlderGroup('g') : client.loadGroup('g', { quiet: mode === 'quiet detail' });
  await client.refresh(); assert.deepEqual(client.state.groupConversations, {});
  pending.resolve({ group: { id: 'g' }, members: [member('bob', { name: 'PRIVATE PROFILE' })], messages: [{ seq: 1, text: 'PRIVATE HISTORY' }] });
  await assert.rejects(loading, { code: 'STALE' });
  assert.deepEqual(client.state.groupConversations, {}); assert.deepEqual(client.state.callMembers, {});
});

test('normal conversation detail loads can update call profiles without losing messages or the separate roster', async t => {
  const client = fixture(t, path => path.endsWith('/messages') ? { messages: [{ seq: 1, text: 'existing conversation' }], hasMore: true }
    : { group: { id: 'g' }, members: [member('alice', { avatarPreset: 'spark' }), member('bob', { avatarPreset: 'moon' })] });
  await client.loadCallMembers('g'); await client.loadGroup('g');
  assert.equal(client.state.groupConversations.g.messages[0].text, 'existing conversation');
  assert.equal(client.state.groupConversations.g.hasMore, true);
  assert.deepEqual(client.state.callMembers.g.map(value => value.avatarPreset), ['spark', 'moon']);
  client.group('g', { loadingOlder: true });
  assert.deepEqual((await client.loadCallMembers('g')).map(value => value.id), ['alice', 'bob']);
});
