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
test('voice uploads retain their identity across retries and use a compatible typed direct message', async t => {
  const uploads = [], sent = []; let fail = true;
  const c = client(t, async (path, options) => {
    if (path.endsWith('/attachments')) { uploads.push(options.body); return { attachment: { id: 'audio' } }; }
    sent.push(options.body); if (fail) { fail = false; throw { code: 'NETWORK' }; } return { message: { seq: 4 } };
  });
  const clip = { targetType: 'direct', targetId: 'conversation', blob: new Blob(['audio'], { type: 'audio/mp4' }), durationMs: 1200 };
  await assert.rejects(c.sendVoiceNote(clip)); await c.sendVoiceNote(clip);
  assert.equal(uploads[0].clientId, uploads[1].clientId); assert.equal(sent[0].clientId, sent[1].clientId);
  assert.equal(sent[1].kind, 'voice'); assert.equal(uploads[0].scope, 'direct'); assert.equal(uploads[0].dataBase64, 'YXVkaW8=');
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
