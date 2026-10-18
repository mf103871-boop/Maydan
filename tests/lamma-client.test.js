import test from 'node:test';
import assert from 'node:assert/strict';
import { LammaClient, blobBase64 } from '../src/social/lamma-client.js';
import { createSocialInterruption } from '../src/social/interruption.js';
import { LIVEKIT_VERSION } from '../src/social/media-version.js';
import { readFile } from 'node:fs/promises';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const client = (t, request, extra = {}) => { const c = new LammaClient({ request, ...extra }); c.userId = 'alice'; t.after(() => c.stop()); return c; };
test('group responses cannot restore a previous account after switching', async t => {
  const wait = deferred(); const c = client(t, () => wait.promise);
  const task = c.loadGroup('group'); c.stop(); c.userId = 'bob';
  wait.resolve({ group: { id: 'group' }, members: [{ id: 'alice' }], messages: [{ seq: 1, text: 'private' }] });
  await assert.rejects(task, { code: 'STALE' }); assert.deepEqual(c.state.groupConversations, {});
});
test('group refresh removes a revoked group and replaces blocked history instead of merging it back', async t => {
  let allowed = true;
  const c = client(t, async path => {
    if (path.endsWith('/groups')) return { groups: allowed ? [{ id: 'g' }] : [], incoming: [] };
    if (path.endsWith('/preferences')) return {};
    if (path.endsWith('/capabilities')) return { voiceMessages: false };
    if (path.endsWith('/calls')) return { calls: [] };
    if (path.endsWith('/messages')) return { messages: [{ seq: 2, text: 'allowed' }] };
    return { group: { id: 'g' }, members: [] };
  });
  c.group('g', { messages: [{ seq: 1, text: 'blocked' }] }); c.selectGroup('g'); await c.refresh();
  assert.deepEqual(c.state.groupConversations.g.messages.map(m => m.text), ['allowed']);
  allowed = false; await c.refresh(); assert.deepEqual(c.state.groupConversations, {});
});

test('switching accounts between the HTTP continuation and the send continuation cannot copy a message', async t => {
  const c = client(t, async () => ({ message: { seq: 1, text: 'ALICE PRIVATE' } }));
  c.refresh = async () => {};
  const baseCall = c.call.bind(c);
  c.call = (...args) => {
    const result = baseCall(...args);
    result.then(() => { c.stop(); c.userId = 'bob'; });
    return result;
  };
  await assert.rejects(c.sendGroupMessage('g', 'ALICE PRIVATE'), { code: 'STALE' });
  assert.deepEqual(c.state.groupConversations, {});
});

test('old pagination cannot restore blocked messages after a new visibility refresh', async t => {
  const pending = deferred();
  const c = client(t, async path => path.includes('?before=') ? pending.promise : path.endsWith('/messages')
    ? { messages: [{ seq: 5, text: 'allowed' }], hasMore: false }
    : { group: { id: 'g' }, members: [] });
  c.group('g', { messages: [{ seq: 5, text: 'allowed' }], hasMore: true, nextBefore: 5 });
  const older = c.loadOlderGroup('g');
  await c.loadGroup('g', { quiet: true });
  pending.resolve({ messages: [{ seq: 1, text: 'BLOCKED HISTORY' }] });
  await assert.rejects(older, { code: 'STALE' });
  assert.deepEqual(c.state.groupConversations.g.messages.map(m => m.text), ['allowed']);
  assert.equal(c.state.groupConversations.g.loadingOlder, false);
});

test('relationship revocation invalidates an already in-flight group snapshot', async t => {
  const pending = deferred(); const c = client(t, () => pending.promise);
  const loading = c.loadGroup('g'); c.invalidateAudio();
  pending.resolve({ messages: [{ seq: 1, text: 'PRIVATE' }], members: [{ id: 'alice' }] });
  await assert.rejects(loading, { code: 'STALE' });
  assert.deepEqual(c.state.groupConversations.g.messages, []);
});
test('retrying group text after a lost response reuses the message identity', async t => {
  const sent = [];
  const c = client(t, async (_path, options) => {
    sent.push(options.body); if (sent.length === 1) throw { code: 'NETWORK' };
    return { message: { seq: 1, ...options.body, senderId: 'alice' } };
  });
  c.refresh = async () => {};
  await assert.rejects(c.sendGroupMessage('g', 'مرحبا')); await c.sendGroupMessage('g', 'مرحبا');
  assert.equal(sent[0].clientId, sent[1].clientId); assert.equal(c.state.groupConversations.g.messages.length, 1);
  await c.sendGroupMessage('g', 'مرحبا'); assert.notEqual(sent[1].clientId, sent[2].clientId);
});

test('group outbox keeps failed text visible and retries one message without duplicates', async t => {
  const wait = deferred(), sent = []; let fail = true;
  const c = client(t, async (_path, options) => {
    sent.push(options.body);
    if (fail) { fail = false; await wait.promise; throw { code: 'NETWORK' }; }
    return { message: { seq: 1, ...options.body, senderId: 'alice' } };
  });
  c.refresh = async () => {};
  const first = c.sendGroupMessage('g', 'لا تضيع رسالتي');
  const pending = c.state.groupConversations.g.messages[0];
  assert.equal(pending.status, 'pending'); assert.equal(pending.text, 'لا تضيع رسالتي');
  wait.resolve(); await assert.rejects(first);
  assert.equal(c.state.groupConversations.g.messages[0].status, 'failed');
  await Promise.all([c.retryGroupMessage('g', pending.clientId), c.retryGroupMessage('g', pending.clientId)]);
  assert.equal(sent.length, 2); assert.equal(sent[0].clientId, sent[1].clientId);
  assert.equal(c.state.groupConversations.g.messages.length, 1);
  assert.equal(c.state.groupConversations.g.messages[0].status, 'sent');
});

test('authorized group refresh preserves our failed outbox while removing old blocked history', async t => {
  const c = client(t, async path => {
    if (path.endsWith('/messages')) return { messages: [{ seq: 3, senderId: 'friend', text: 'visible' }] };
    return { group: { id: 'g' }, members: [{ id: 'alice' }] };
  });
  const failed = { clientId: 'retry', senderId: 'alice', text: 'unsent', status: 'failed' };
  c.group('g', { messages: [{ seq: 1, senderId: 'blocked', text: 'HIDDEN' }, failed] });
  await c.loadGroup('g', { quiet: true });
  assert.deepEqual(c.state.groupConversations.g.messages.map(m => m.text), ['visible', 'unsent']);
  assert.equal(c.state.groupConversations.g.messages[1].status, 'failed');
});

test('history acknowledges an uncertain group send once without duplicating its retained outbox', async t => {
  let sent;
  const c = client(t, async (path, options) => {
    if (options?.method === 'POST') { sent = options.body; throw { code: 'NETWORK' }; }
    if (path.endsWith('/messages')) return { messages: [{ seq: 4, ...sent, senderId: 'alice' }] };
    return { group: { id: 'g' }, members: [] };
  });
  c.refresh = async () => {};
  await assert.rejects(c.sendGroupMessage('g', 'وصلت رغم فقدان الرد'));
  await c.loadGroup('g');
  assert.equal(c.state.groupConversations.g.messages.length, 1);
  assert.equal(c.state.groupConversations.g.messages[0].status, 'sent');
  assert.equal(c.pendingText.size, 0);
});

test('older group snapshots cannot erase a newly acknowledged message', async t => {
  const wait = deferred();
  const c = client(t, async (path, options) => {
    if (options?.method === 'POST') return { message: { seq: 7, senderId: 'alice', ...options.body } };
    return path.endsWith('/messages') ? wait.promise : { group: { id: 'g' }, members: [] };
  });
  c.refresh = async () => {};
  const history = c.loadGroup('g');
  await c.sendGroupMessage('g', 'new');
  wait.resolve({ messages: [] }); await assert.rejects(history, { code: 'STALE' });
  assert.equal(c.state.groupConversations.g.messages[0].text, 'new');
  assert.equal(c.state.groupConversations.g.loading, false);
});

test('losing group membership clears outbox and fences an already in-flight send', async t => {
  const wait = deferred();
  const c = client(t, async (_path, options) => {
    if (options?.method === 'POST') return wait.promise;
    return {};
  });
  const send = c.sendGroupMessage('g', 'PRIVATE'); await c.refresh();
  assert.deepEqual(c.state.groupConversations, {}); assert.equal(c.pendingText.size, 0);
  wait.resolve({ message: { seq: 7, senderId: 'alice', text: 'PRIVATE' } });
  await assert.rejects(send, { code: 'STALE' }); assert.deepEqual(c.state.groupConversations, {});
});

test('access changes during group sending leave our unsent text retryable without publishing stale history', async t => {
  const wait = deferred();
  const c = client(t, async (_path, options) => wait.promise);
  const sending = c.sendGroupMessage('g', 'نصي أنا');
  c.invalidateAudio(); wait.resolve({ message: { seq: 7, senderId: 'alice', text: 'نصي أنا' } });
  await assert.rejects(sending, { code: 'STALE' });
  assert.equal(c.state.groupConversations.g.messages[0].status, 'failed');
  assert.equal(c.state.groupConversations.g.messages[0].seq, undefined);
});
test('voice uploads retain their identity across retries and use a compatible typed direct message', async t => {
  const uploads = [], sent = []; let fail = true;
  const c = client(t, async (path, options) => {
    if (path.endsWith('/attachments')) { uploads.push(options.body); return { attachment: { id: 'audio' } }; }
    sent.push(options.body); if (fail) { fail = false; throw { code: 'NETWORK' }; } return { message: { seq: 4 } };
  });
  const clip = { targetType: 'direct', targetId: 'conversation', blob: new Blob(['audio'], { type: 'audio/mp4' }), durationMs: 1200 };
  await assert.rejects(c.sendVoiceNote(clip)); await c.sendVoiceNote(clip);
  assert.equal(uploads.length, 1, 'a successful upload is not repeated after a lost message response'); assert.equal(uploads[0].clientId, sent[1].clientId); assert.equal(sent[0].clientId, sent[1].clientId);
  assert.equal(sent[1].kind, 'voice'); assert.equal(uploads[0].scope, 'direct'); assert.equal(uploads[0].dataBase64, 'YXVkaW8=');
});

test('group voice send publishes the canonical message and finishes before background history refresh', async t => {
  const wait = deferred(), requests = [];
  const c = client(t, async (path, options) => {
    requests.push(path);
    return path.endsWith('/attachments') ? { attachment: { id: 'audio' } }
      : { message: { seq: 9, clientId: options.body.clientId, senderId: 'alice', kind: 'voice', attachment: { id: 'audio' } } };
  });
  let refreshed = false; c.refresh = () => { refreshed = true; return wait.promise; };
  const message = await c.sendVoiceNote({ targetType: 'group', targetId: 'g', blob: new Blob(['audio'], { type: 'audio/mp4' }), durationMs: 900 });
  assert.equal(message.seq, 9); assert.equal(refreshed, true);
  assert.deepEqual(requests, ['/api/social/attachments', '/api/social/groups/g/messages']);
  assert.equal(c.state.groupConversations.g.messages[0].attachment.id, 'audio');
  wait.resolve();
});

test('direct voice confirmation is not delayed by conversation refresh and concurrent sends share upload', async t => {
  const upload = deferred(), refresh = deferred(), requests = [], changes = [];
  const c = client(t, async (path, options) => {
    requests.push(path);
    return path.endsWith('/attachments') ? upload.promise : { message: { seq: 10, ...options.body } };
  }, { onDirectChange: (message, id) => { changes.push({ message, id }); return refresh.promise; } });
  const clip = { targetType: 'direct', targetId: 'dm', blob: new Blob(['audio'], { type: 'audio/mp4' }), durationMs: 800 };
  const a = c.sendVoiceNote(clip), b = c.sendVoiceNote(clip);
  upload.resolve({ attachment: { id: 'audio' } });
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first.seq, 10); assert.equal(second.seq, 10);
  assert.deepEqual(requests, ['/api/social/attachments', '/api/social/conversations/dm/messages']);
  assert.equal(changes.length, 1); assert.equal(changes[0].id, 'dm'); assert.equal(changes[0].message.seq, 10);
  refresh.resolve();
});

test('voice upload cannot publish or refresh another account after switching while uploading', async t => {
  const upload = deferred(), requests = [];
  const c = client(t, async path => { requests.push(path); return upload.promise; });
  const task = c.sendVoiceNote({ targetType: 'group', targetId: 'g', blob: new Blob(['audio']), durationMs: 700 });
  await new Promise(resolve => setImmediate(resolve)); c.stop(); c.userId = 'bob';
  upload.resolve({ attachment: { id: 'PRIVATE' } });
  await assert.rejects(task, { code: 'STALE' });
  assert.deepEqual(requests, ['/api/social/attachments']); assert.deepEqual(c.state.groupConversations, {});
});

test('a late voice acknowledgement cannot recreate a revoked group', async t => {
  const sent = deferred(); let posted = false;
  const c = client(t, async (path, options) => {
    if (path.endsWith('/attachments')) return { attachment: { id: 'audio' } };
    if (options?.method === 'POST') { posted = true; return sent.promise; }
    return {};
  });
  const task = c.sendVoiceNote({ targetType: 'group', targetId: 'g', blob: new Blob(['audio']), durationMs: 700 });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(posted, true);
  await c.refresh(); assert.deepEqual(c.state.groupConversations, {});
  sent.resolve({ message: { seq: 8, senderId: 'alice', kind: 'voice' } });
  await assert.rejects(task, { code: 'STALE' }); assert.deepEqual(c.state.groupConversations, {});
});
test('unauthorized or overlong recordings are rejected before upload', async t => {
  let count = 0; const c = client(t, async () => { count++; });
  await assert.rejects(c.sendVoiceNote({ blob: new Blob(['x']), durationMs: 120001 })); assert.equal(count, 0);
  c.stop(); await assert.rejects(c.sendVoiceNote({ blob: new Blob(['x']), durationMs: 1000 }), { code: 'STALE' }); assert.equal(count, 0);
});
test('playback reauthorizes each time and a revocation while downloading discards the audio', async t => {
  let count = 0; const urls = [], wait = deferred();
  const c = client(t, async () => { count++; return { blob: () => count === 3 ? wait.promise : Promise.resolve(new Blob(['audio'])) }; },
    { makeURL: () => 'blob:' + count, revokeURL: value => urls.push(value) });
  assert.equal(await c.getVoiceUrl('audio'), 'blob:1'); assert.equal(await c.getVoiceUrl('audio'), 'blob:2');
  assert.deepEqual(urls, ['blob:1']);
  const pending = c.getVoiceUrl('audio'); await Promise.resolve(); c.invalidateAudio(); wait.resolve(new Blob(['private']));
  await assert.rejects(pending, { code: 'STALE' }); assert.equal(count, 3); assert.deepEqual(urls, ['blob:1', 'blob:2']);
});
test('notification switch affects all categories and conversation mute preserves unrelated entries', async t => {
  const updates = []; const c = client(t, async (_path, options) => { updates.push(options.body); return {}; });
  await c.setNotificationPreferences({ enabled: false });
  assert.deepEqual(updates[0], { messages: false, calls: false, groupInvites: false, friendRequests: false });
  await c.setConversationMuted({ targetType: 'direct', targetId: 'a', muted: true });
  await c.setConversationMuted({ targetType: 'group', targetId: 'b', muted: true });
  await c.setConversationMuted({ targetType: 'direct', targetId: 'a', muted: false });
  assert.deepEqual(c.state.preferences.mutedConversations, [{ scope: 'group', conversationId: 'b' }]);
});

test('game invitation retry after an uncertain response does not duplicate the card', async t => {
  const sent = []; const c = client(t, async (_path, options) => {
    sent.push(options.body); if (sent.length === 1) throw { code: 'NETWORK' };
    return { invitation: { id: 'invite' } };
  });
  const invite = { targetType: 'direct', targetId: 'conversation', roomCode: 'ABCD' };
  await assert.rejects(c.sendGameInvite(invite)); await c.sendGameInvite(invite);
  assert.equal(sent[0].clientId, sent[1].clientId);
  await c.sendGameInvite(invite); assert.notEqual(sent[1].clientId, sent[2].clientId);
});

test('confirmed game invitations publish without waiting for a second history download', async t => {
  const refresh = deferred(), changes = [];
  const c = client(t, async (_path, options) => ({ message: { seq: 17, senderId: 'alice', clientId: options.body.clientId, kind: 'room_invite' }, invitation: { id: 'invite' } }), {
    onDirectChange: (message, id) => { changes.push({ message, id }); return refresh.promise; },
  });
  c.refresh = () => refresh.promise;
  c.group('g', { group: { id: 'g' }, messages: [] });
  const group = await c.sendGameInvite({ targetType: 'group', targetId: 'g', roomCode: '234567' });
  assert.equal(group.invitation.id, 'invite'); assert.equal(c.state.groupConversations.g.messages[0].seq, 17);
  await c.sendGameInvite({ targetType: 'direct', targetId: 'dm', roomCode: '234567' });
  assert.equal(changes.length, 1); assert.equal(changes[0].id, 'dm'); assert.equal(changes[0].message.seq, 17);
  refresh.resolve();
});
test('local social interruption requires an explicit safe resume; online clocks are unaffected', () => {
  const state = createSocialInterruption(); state.setContext({ local: true }); state.open();
  assert.equal(state.getSnapshot().paused, true); state.resume(); assert.equal(state.getSnapshot().paused, true);
  state.close(); assert.equal(state.getSnapshot().paused, true); state.resume(); assert.equal(state.getSnapshot().paused, false);
  state.setContext({ local: false, online: true, turnDeadline: 1234 }); state.open();
  assert.equal(state.getSnapshot().paused, false); assert.equal(state.getSnapshot().turnDeadline, 1234);
});
test('overlapping private views cannot clear another view privacy ownership', () => {
  const state = createSocialInterruption(); const first = state.private('one'), second = state.private('two');
  first(); assert.equal(state.getSnapshot().privateTurn, true); second(); assert.equal(state.getSnapshot().privateTurn, false);
});
test('binary audio encoding preserves bytes and vendor asset versions follow the lock', async () => {
  assert.equal(await blobBase64(new Blob([Uint8Array.from([0, 127, 128, 255])])), 'AH+A/w==');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies['livekit-client'], LIVEKIT_VERSION);
});
