import test from 'node:test';
import assert from 'node:assert/strict';
import { activeAudioOwners, audioActivity, bindSocialAudio, createSocialNotificationAudio, createVoiceRecorder } from '../src/social/media.js';
import { resetNativeForTests, resolveNative } from '../src/shared/account/native.js';

function environment(t, native = false) {
  resetNativeForTests();
  const saved = Object.fromEntries(['window', 'location', 'navigator', 'MediaRecorder'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const commands = [], window = new EventTarget();
  globalThis.window = window;
  globalThis.location = { protocol: native ? 'maydan:' : 'https:' };
  if (native) window.webkit = { messageHandlers: { maydan: { postMessage(command) {
    commands.push(command);
    if (command.type !== 'socialVoiceStart') queueMicrotask(() => resolveNative(command.id, { result: {} }));
  } } } };
  t.after(() => {
    for (const owner of activeAudioOwners()) audioActivity(owner, false);
    resetNativeForTests();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { window, commands };
}

function soundFixture() {
  const effects = new Set(), music = new Set(), ducking = new Set();
  const update = (set, active, owner) => active ? set.add(owner) : set.delete(owner);
  return { effects, music, ducking,
    sound: { setSuppressed: (active, owner) => update(effects, active, owner),
      setDucking: (active, owner) => update(ducking, active, owner),
      music: { setSuppressed: (active, owner) => update(music, active, owner) } },
  };
}

test('native recording reserves silence before permission/capture and cannot resurrect a cancelled start', async t => {
  const { commands } = environment(t, true), fixture = soundFixture(), cleanup = bindSocialAudio(fixture.sound);
  const recorder = createVoiceRecorder();
  t.after(() => { recorder.cancel(); cleanup(); });
  const pending = recorder.start();
  assert.equal(fixture.effects.size, 1); assert.equal(fixture.music.size, 1);
  const first = commands.find(command => command.type === 'socialVoiceStart');
  assert.ok(first); assert.ok(activeAudioOwners().some(owner => owner.startsWith('recorder-')));
  recorder.cancel();
  assert.equal(fixture.effects.size, 0); assert.equal(fixture.music.size, 0);
  resolveNative(first.id, { result: { state: 'recording', recordingId: first.recordingId } });
  await pending;
  assert.equal(activeAudioOwners().length, 0);
  assert.ok(commands.filter(command => command.type === 'socialVoiceCancel').every(command => command.recordingId === first.recordingId));
});

test('a denied native recording releases both its microphone claim and suppression lease', async t => {
  const { commands } = environment(t, true), fixture = soundFixture(), cleanup = bindSocialAudio(fixture.sound);
  const recorder = createVoiceRecorder();
  t.after(() => { recorder.cancel(); cleanup(); });
  const pending = recorder.start(), first = commands.at(-1);
  resolveNative(first.id, { ok: false, error: 'MICROPHONE_DENIED' });
  await assert.rejects(pending);
  assert.equal(fixture.effects.size, 0); assert.equal(fixture.music.size, 0); assert.equal(activeAudioOwners().length, 0);
  const replacement = createVoiceRecorder(), next = replacement.start();
  const second = commands.at(-1);
  assert.equal(second.type, 'socialVoiceStart', 'permission failure did not retain the microphone claim');
  replacement.cancel(); resolveNative(second.id, { result: {} }); await next;
});

test('cancel while web microphone permission is pending stops the late stream without restoring recording ownership', async t => {
  environment(t);
  const captures = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => captures.push(resolve)) } } });
  globalThis.MediaRecorder = class {};
  const fixture = soundFixture(), cleanup = bindSocialAudio(fixture.sound), recorder = createVoiceRecorder();
  t.after(() => { recorder.cancel(); cleanup(); });
  let stopped = 0;
  const pending = recorder.start();
  assert.equal(fixture.effects.size, 1);
  recorder.cancel();
  captures[0]({ getTracks: () => [{ stop() { stopped++; } }] });
  await pending;
  assert.equal(stopped, 1); assert.equal(activeAudioOwners().length, 0); assert.equal(fixture.effects.size, 0);
});

test('overlapping voice/recording leases survive another provider cleanup and preserve unrelated question suppression', t => {
  environment(t);
  const fixture = soundFixture(), question = Symbol('question');
  fixture.sound.setSuppressed(true, question); fixture.sound.music.setSuppressed(true, question);
  audioActivity('voice-preview-test', true);
  const first = bindSocialAudio(fixture.sound), second = bindSocialAudio(fixture.sound);
  t.after(() => { first(); second(); });
  assert.equal(fixture.effects.size, 3);
  first(); assert.equal(fixture.effects.size, 2, 'old binding cannot release a replacement binding');
  audioActivity('recorder-test', true); audioActivity('voice-preview-test', false);
  assert.equal(fixture.effects.size, 2);
  audioActivity('recorder-test', false);
  assert.deepEqual([...fixture.effects], [question]); assert.deepEqual([...fixture.music], [question]);
  audioActivity('live-call-test', true);
  assert.equal(fixture.ducking.size, 1); assert.equal(fixture.effects.size, 1, 'a live call ducks but is not a recording');
});

const notification = (id, messageId, userId = 'alice') => ({ id, userId, type: 'message', friend: { conversationId: 'conversation', lastMessage: { id: messageId } } });

test('notification sound consumes muted messages and deduplicates stable message IDs across renders and game scope resets', () => {
  const emitted = [], audio = createSocialNotificationAudio({ emit: (type, options) => { emitted.push({ type, ...options }); return true; } });
  audio.emit(notification(1, 'one'), { owner: 'alice', muted: true });
  audio.emit(notification(1, 'one'), { owner: 'alice', muted: false });
  audio.emit(notification(2, 'one'), { owner: 'alice' });
  assert.equal(emitted.length, 1); assert.equal(emitted[0].muted, true);
  audio.emit(notification(3, 'two'), { owner: 'alice' });
  assert.equal(emitted.length, 2); assert.equal(emitted[1].type, 'social.message');
});

test('account switch fences pending notifications and rejects stale account data, with separate direct/group IDs', () => {
  const emitted = [], audio = createSocialNotificationAudio({ emit: (type, options) => { emitted.push({ type, ...options }); return true; } });
  audio.emit(notification(1, 'one'), { owner: 'alice' });
  assert.equal(emitted[0].guard(), true);
  audio.setIdentity('bob'); assert.equal(emitted[0].guard(), false);
  audio.emit(notification(2, 'two'), { owner: 'bob' }); assert.equal(emitted.length, 1, 'ignore alice projection');
  audio.emit(notification(3, 'one', 'bob'), { owner: 'bob' });
  audio.emit({ id: 4, userId: 'bob', messageId: 'one', groupId: 'group' }, { owner: 'bob', scope: 'group' });
  assert.equal(emitted.length, 3);
  assert.equal(new Set(emitted.map(event => event.id)).size, 3);
});

test('privacy/call changes invalidate queued notifications without replaying them later', () => {
  let allowed = true;
  const emitted = [], audio = createSocialNotificationAudio({ emit: (type, options) => { emitted.push({ type, ...options }); return true; } });
  audio.emit(notification(1, 'one'), { owner: 'alice', guard: () => allowed });
  allowed = false; assert.equal(emitted[0].guard(), false);
  allowed = true; audio.emit(notification(2, 'one'), { owner: 'alice', guard: () => allowed });
  assert.equal(emitted.length, 1);
});
