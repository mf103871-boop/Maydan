import test from 'node:test';
import assert from 'node:assert/strict';
import { CallMedia, createVoiceRecorder } from '../src/social/media.js';
import { emitNativeEvent, resolveNative, resetNativeForTests } from '../src/shared/account/native.js';
import { socialInterruption } from '../src/social/interruption.js';

function nativeFixture(handler = () => ({})) {
  resetNativeForTests();
  const previous = { window: globalThis.window, location: globalThis.location };
  const commands = [];
  globalThis.location = { protocol: 'maydan:' };
  globalThis.window = Object.assign(new EventTarget(), { webkit: { messageHandlers: { maydan: { postMessage(command) {
    commands.push(command);
    const result = handler(command);
    if (result !== undefined) queueMicrotask(() => resolveNative(command.id, { ok: true, result }));
  } } } } });
  return { commands, close() { resetNativeForTests(); globalThis.window = previous.window; globalThis.location = previous.location; } };
}
const connection = id => ({ call: { id, scope: 'direct', conversationId: 'conversation' }, connection: { url: 'wss://test.livekit.cloud', token: 'test-token' } });
const callEvent = (userId, callId, state = 'connected') => ({ userId, callId, state, scope: 'direct', conversationId: 'conversation', participants: [], muted: false });
const clip = recordingId => ({ recordingId, base64: btoa('AAC fixture'), mimeType: 'audio/mp4', durationMs: 120000 });

test('native media events cannot paint another account or overwrite a newer call', async () => {
  const fixture = nativeFixture(); const engine = new CallMedia();
  try {
    engine.setAccount('alice'); emitNativeEvent('socialCall', callEvent('alice', 'one'));
    assert.equal(engine.state.callId, 'one');
    engine.setAccount('bob');
    emitNativeEvent('socialCall', callEvent('alice', 'one'));
    assert.equal(engine.state.callId, null);
    emitNativeEvent('socialCall', callEvent('bob', 'two'));
    emitNativeEvent('socialCall', callEvent('alice', 'one', 'ended'));
    await Promise.resolve();
    assert.equal(engine.state.callId, 'two'); assert.equal(engine.state.connected, true);
    assert.equal(fixture.commands.find(command => command.type === 'socialCallEnd').callId, 'one');
  } finally { await engine.dispose(); fixture.close(); }
});

test('late native connect and disconnect completions cannot end a replacement call', async () => {
  const fixture = nativeFixture(command => command.type === 'socialCallConnect' ? undefined : {});
  const engine = new CallMedia(); engine.setAccount('alice');
  try {
    const first = engine.connect(connection('one'));
    const firstCommand = fixture.commands.find(command => command.type === 'socialCallConnect');
    await engine.disconnect();
    const second = engine.connect(connection('two'));
    const secondCommand = fixture.commands.filter(command => command.type === 'socialCallConnect')[1];
    emitNativeEvent('socialCall', callEvent('alice', 'two'));
    resolveNative(secondCommand.id, { ok: true, result: {} }); await second;
    resolveNative(firstCommand.id, { ok: true, result: {} }); await first;
    assert.equal(engine.state.callId, 'two'); assert.equal(engine.state.connected, true);
    assert.deepEqual(fixture.commands.filter(command => command.type === 'socialCallEnd').map(command => command.callId), ['one', 'one']);
  } finally { await engine.dispose(); fixture.close(); }
});

test('cleanup of an ended call leaves a newly arriving call untouched', async () => {
  const fixture = nativeFixture(), engine = new CallMedia(); engine.setAccount('alice');
  try {
    emitNativeEvent('socialCall', callEvent('alice', 'one'));
    emitNativeEvent('socialCall', callEvent('alice', 'one', 'ended'));
    emitNativeEvent('socialCall', callEvent('alice', 'two', 'ringing'));
    await engine.disconnect({ callId: 'one' });
    assert.equal(engine.state.callId, 'two'); assert.equal(engine.state.connecting, true);
    assert.equal(fixture.commands.find(command => command.type === 'socialCallEnd').callId, 'one');
  } finally { await engine.dispose(); fixture.close(); }
});

test('ownership loss ends only local native media and preserves its reason across the bridge', async () => {
  const fixture = nativeFixture(), engine = new CallMedia(); engine.setAccount('alice');
  try {
    emitNativeEvent('socialCall', callEvent('alice', 'one'));
    await engine.disconnect({ localOnly: true, endReason: 'ownership-lost' });
    const command = fixture.commands.find(command => command.type === 'socialCallEnd');
    assert.equal(command.localOnly, true); assert.equal(command.endReason, 'ownership-lost');
    assert.equal(engine.state.localOnly, true); assert.equal(engine.state.endReason, 'ownership-lost');
    assert.equal(engine.state.muted, true); assert.equal(engine.state.ended, true);
    emitNativeEvent('socialCall', { ...callEvent('alice', 'one', 'ended'), localOnly: true, endReason: 'ownership-lost' });
    assert.equal(engine.state.localOnly, true);
  } finally { await engine.dispose(); fixture.close(); }
});

test('privacy or a mute pressed during web connection cannot reopen the microphone', async () => {
  const fixture = nativeFixture(); delete globalThis.window.webkit; globalThis.location.protocol = 'https:';
  let finishConnect, createdRoom; const mic = [];
  class FakeRoom {
    constructor() {
      createdRoom = this; this.remoteParticipants = new Map();
      this.localParticipant = { identity: 'alice', isMicrophoneEnabled: false, async setMicrophoneEnabled(enabled) {
        mic.push(enabled); this.isMicrophoneEnabled = enabled;
      } };
    }
    on() {}
    connect() { return new Promise(resolve => { finishConnect = resolve; }); }
    async disconnect() {}
  }
  const engine = new CallMedia(() => {}, { loadSDK: async () => ({ Room: FakeRoom, RoomEvent: {}, Track: { Kind: { Audio: 'audio' } } }) });
  engine.setAccount('alice'); let clearPrivacy;
  try {
    const pending = engine.connect(connection('one'), { muted: false });
    await Promise.resolve(); assert.ok(createdRoom);
    clearPrivacy = socialInterruption.private('private-role-test');
    await engine.mute(true);
    finishConnect(); await pending;
    assert.deepEqual(mic, [false, false]); assert.equal(engine.state.muted, true);
    await assert.rejects(engine.mute(false), error => error.code === 'AUDIO_PRIVATE');
    clearPrivacy(); clearPrivacy = null;
    assert.equal(engine.state.muted, true, 'concealing the role must not automatically unmute');
    await engine.mute(false); assert.equal(engine.state.muted, false);
  } finally { clearPrivacy?.(); await engine.dispose(); fixture.close(); }
});

test('voice stop is shared and an automatic 120-second completion stays previewable', async () => {
  const fixture = nativeFixture(command => command.type === 'socialVoiceStop' ? undefined : {});
  const recorder = createVoiceRecorder();
  try {
    await recorder.start();
    const start = fixture.commands.find(command => command.type === 'socialVoiceStart');
    const first = recorder.stop(), second = recorder.stop();
    const stops = fixture.commands.filter(command => command.type === 'socialVoiceStop');
    assert.equal(stops.length, 1);
    emitNativeEvent('socialVoice', { state: 'ready', ...clip(start.recordingId) });
    resolveNative(stops[0].id, { ok: true, result: clip(start.recordingId) });
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.blob, b.blob); assert.equal(a.durationMs, 120000);
    assert.equal((await recorder.stop()).blob, a.blob);
  } finally { recorder.cancel(); await Promise.resolve(); fixture.close(); }
});

test('stale recorder events cannot become the next recording or retain microphone ownership', async () => {
  const fixture = nativeFixture(command => command.type === 'socialVoiceStop' ? clip(command.recordingId) : {});
  const first = createVoiceRecorder(), second = createVoiceRecorder();
  try {
    await first.start(); const oldId = fixture.commands[0].recordingId; first.cancel();
    await second.start();
    emitNativeEvent('socialVoice', { state: 'ready', ...clip(oldId) });
    await second.stop();
    assert.equal(fixture.commands.filter(command => command.type === 'socialVoiceStop').length, 1);
    second.cancel();
    const engine = new CallMedia(); engine.setAccount('alice');
    await engine.connect(connection('three')); await engine.dispose();
  } finally { first.cancel(); second.cancel(); await Promise.resolve(); fixture.close(); }
});

test('preparing a web call overlaps SDK loading without opening media and reuses the same load; native skips it', async () => {
  const fixture = nativeFixture();
  let loads = 0;
  const nativeEngine = new CallMedia(() => {}, { loadSDK: async () => { loads++; } });
  try {
    await nativeEngine.prepare(); assert.equal(loads, 0); assert.equal(fixture.commands.length, 0);
    delete globalThis.window.webkit; globalThis.location.protocol = 'https:';
    let finishSDK, rooms = 0; const mic = [];
    class FakeRoom {
      constructor() { rooms++; this.remoteParticipants = new Map(); this.localParticipant = {
        identity: 'alice', isMicrophoneEnabled: false,
        async setMicrophoneEnabled(enabled) { mic.push(enabled); this.isMicrophoneEnabled = enabled; },
      }; }
      on() {} async connect() {} async disconnect() {}
    }
    const engine = new CallMedia(() => {}, { loadSDK: () => { loads++; return new Promise(resolve => { finishSDK = resolve; }); } });
    engine.setAccount('alice');
    try {
      const preparation = engine.prepare();
      assert.equal(engine.prepare(), preparation); assert.equal(loads, 1); assert.equal(rooms, 0); assert.deepEqual(mic, []);
      const connecting = engine.connect(connection('one'));
      assert.equal(loads, 1); assert.equal(rooms, 0);
      finishSDK({ Room: FakeRoom, RoomEvent: {}, Track: { Kind: { Audio: 'audio' } } });
      await preparation; await connecting;
      assert.equal(rooms, 1); assert.deepEqual(mic, [true]); assert.equal(engine.state.connected, true);
    } finally { await engine.dispose(); }
  } finally { await nativeEngine.dispose(); fixture.close(); }
});

test('a failed web SDK preparation can be retried without caching the failure or claiming the microphone', async () => {
  const fixture = nativeFixture(); delete globalThis.window.webkit; globalThis.location.protocol = 'https:';
  let loads = 0;
  const engine = new CallMedia(() => {}, { loadSDK: async () => { loads++; if (loads === 1) throw new Error('offline'); return { ready: true }; } });
  try {
    await assert.rejects(engine.prepare(), /offline/);
    assert.deepEqual(await engine.prepare(), { ready: true }); assert.equal(loads, 2); assert.equal(engine.state.connecting, false);
  } finally { await engine.dispose(); fixture.close(); }
});
