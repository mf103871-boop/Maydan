import test from 'node:test';
import assert from 'node:assert/strict';
import { CallMedia, createVoiceRecorder, activeAudioOwners } from '../src/social/media.js';
import { emitNativeEvent, resolveNative, resetNativeForTests } from '../src/shared/account/native.js';
import { socialInterruption } from '../src/social/interruption.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const connection = id => ({ call: { id, scope: 'direct', conversationId: 'conversation' }, connection: { url: 'wss://test.livekit.cloud', token: 'fixture' } });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(native = false, handler = () => ({})) {
  resetNativeForTests();
  const previous = { window: globalThis.window, document: globalThis.document, location: globalThis.location, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), MediaRecorder: globalThis.MediaRecorder };
  const commands = [];
  globalThis.window = new EventTarget(); globalThis.document = Object.assign(new EventTarget(), { hidden: false, body: { append() {} } });
  globalThis.location = { protocol: native ? 'maydan:' : 'https:' };
  if (native) window.webkit = { messageHandlers: { maydan: { postMessage(command) { commands.push(command); const result = handler(command); if (result !== undefined) queueMicrotask(() => resolveNative(command.id, { ok: true, result })); } } } };
  return { commands, close() { resetNativeForTests(); globalThis.window = previous.window; globalThis.document = previous.document; globalThis.location = previous.location; globalThis.MediaRecorder = previous.MediaRecorder; if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator); else delete globalThis.navigator; } };
}
function webSDK({ startAudio = async () => {} } = {}) {
  const rooms = [], mic = [];
  const RoomEvent = Object.fromEntries(['ParticipantConnected', 'ParticipantDisconnected', 'ActiveSpeakersChanged', 'TrackMuted', 'TrackUnmuted', 'LocalTrackPublished', 'LocalTrackUnpublished', 'TrackSubscribed', 'TrackUnsubscribed', 'Reconnecting', 'Reconnected', 'Disconnected'].map(x => [x, x]));
  class Room {
    constructor() { rooms.push(this); this.handlers = new Map(); this.remoteParticipants = new Map(); this.localParticipant = { identity: 'alice', isMicrophoneEnabled: false, async setMicrophoneEnabled(enabled) { mic.push(enabled); this.isMicrophoneEnabled = enabled; } }; this.startAudioCalls = 0; }
    on(type, handler) { this.handlers.set(type, handler); }
    async connect() {} async disconnect() {}
    startAudio() { this.startAudioCalls++; return startAudio(this); }
    track(element) { this.handlers.get(RoomEvent.TrackSubscribed)({ kind: 'audio', attach: () => element }); }
  }
  return { sdk: { Room, RoomEvent, Track: { Kind: { Audio: 'audio' } } }, rooms, mic };
}

test('foreground and page restore retry remote playback only; hidden/refused interruptions never unmute', async () => {
  const h = fixture(), f = webSDK(), engine = new CallMedia(() => {}, { loadSDK: async () => f.sdk }); engine.setAccount('alice');
  let plays = 0; const element = { dataset: {}, play: async () => { plays++; }, pause() {}, remove() {} };
  try {
    await engine.connect(connection('one'), { muted: true }); f.rooms[0].track(element); await flush();
    assert.deepEqual(f.mic, [false]); assert.equal(plays, 1);
    window.dispatchEvent(new CustomEvent('maydan-audio-lifecycle', { detail: { state: 'background', shouldResume: false } }));
    assert.equal(engine.playbackHeld, false, 'background is not an explicit no-resume privacy hold');
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); await flush(); assert.equal(f.rooms[0].startAudioCalls, 0);
    document.hidden = false; document.dispatchEvent(new Event('visibilitychange')); await flush();
    assert.equal(f.rooms[0].startAudioCalls, 1); assert.equal(plays, 2);
    window.dispatchEvent(new Event('pageshow')); await flush(); assert.equal(plays, 3);
    window.dispatchEvent(new CustomEvent('maydan-audio-lifecycle', { detail: { state: 'interruption-ended', shouldResume: false } })); await flush(); assert.equal(plays, 3);
    const release = socialInterruption.private('recovery-test');
    try { window.dispatchEvent(new CustomEvent('maydan-audio-lifecycle', { detail: { state: 'session-restored' } })); window.dispatchEvent(new Event('pageshow')); await flush(); assert.equal(plays, 3, 'OS no-resume hold survives later foreground events'); await engine.resumeAudio(); assert.equal(plays, 4); assert.deepEqual(f.mic, [false]); assert.equal(engine.state.muted, true); }
    finally { release(); }
    await engine.dispose(); window.dispatchEvent(new Event('pageshow')); await flush(); assert.equal(plays, 4);
  } finally { await engine.dispose(); h.close(); }
});

test('late resume rejection and old track failure cannot paint a replacement call', async () => {
  const h = fixture(), resume = deferred(), firstPlay = deferred(), f = webSDK({ startAudio: () => resume.promise }), engine = new CallMedia(() => {}, { loadSDK: async () => f.sdk });
  engine.setAccount('alice');
  try {
    await engine.connect(connection('one')); f.rooms[0].track({ dataset: {}, play: () => firstPlay.promise, remove() {} });
    const pending = engine.resumeAudio(); const duplicate = engine.resumeAudio({ automatic: true }); assert.equal(f.rooms[0].startAudioCalls, 1);
    await engine.disconnect(); await engine.connect(connection('two'), { muted: true });
    engine.update({ error: 'replacement-status' }); firstPlay.reject(new Error('old audio rejected')); resume.reject(new Error('old session rejected'));
    await Promise.all([pending, duplicate]); await flush();
    assert.equal(engine.state.callId, 'two'); assert.equal(engine.state.error, 'replacement-status'); assert.equal(engine.state.muted, true);
  } finally { await engine.dispose(); h.close(); }
});

test('a second foreground intent retries a pending play aborted by a rapid pause', async () => {
  const h = fixture(), f = webSDK(), engine = new CallMedia(() => {}, { loadSDK: async () => f.sdk }), interruptedPlay = deferred(); engine.setAccount('alice');
  let plays = 0;
  try {
    await engine.connect(connection('one'), { muted: true });
    f.rooms[0].track({ dataset: {}, play: () => { plays++; return plays === 2 ? interruptedPlay.promise : Promise.resolve(); }, pause() {}, remove() {} }); await flush();
    const first = engine.resumeAudio(); await flush(); assert.equal(plays, 2);
    window.dispatchEvent(new Event('pageshow')); interruptedPlay.reject(new Error('pause aborted pending play')); await first;
    assert.equal(plays, 3); assert.equal(f.rooms[0].startAudioCalls, 2); assert.equal(engine.state.error, ''); assert.deepEqual(f.mic, [false]);
    window.dispatchEvent(new CustomEvent('maydan-audio-lifecycle', { detail: { state: 'interruption-began' } }));
    window.dispatchEvent(new CustomEvent('maydan-audio-lifecycle', { detail: { state: 'media-reset', shouldResume: true } })); await flush();
    assert.equal(plays, 4, 'media reset can finish interruption without a separate ended event');
  } finally { await engine.dispose(); h.close(); }
});

test('a synchronous playback failure is retryable and successful recovery clears only current error', async () => {
  const h = fixture(); let fail = true; const f = webSDK({ startAudio: () => { if (fail) throw new Error('interrupted'); } });
  const engine = new CallMedia(() => {}, { loadSDK: async () => f.sdk }); engine.setAccount('alice');
  try { await engine.connect(connection('one'), { muted: true }); await assert.rejects(engine.resumeAudio()); assert.ok(engine.state.error); fail = false; await engine.resumeAudio(); assert.equal(engine.state.error, ''); assert.deepEqual(f.mic, [false]); }
  finally { await engine.dispose(); h.close(); }
});

test('native resume uses current call ID without microphone commands and fences an old completion', async () => {
  const h = fixture(true, command => command.type === 'socialCallResumeAudio' ? undefined : {}), engine = new CallMedia(); engine.setAccount('alice');
  const snapshot = id => ({ userId: 'alice', callId: id, state: 'connected', muted: true });
  try {
    emitNativeEvent('socialCall', snapshot('one')); const pending = engine.resumeAudio(); const command = h.commands.find(c => c.type === 'socialCallResumeAudio'); assert.equal(command.callId, 'one'); assert.equal(command.userInitiated, true);
    await engine.disconnect(); emitNativeEvent('socialCall', snapshot('two')); engine.update({ error: 'new-status' }); resolveNative(command.id, { ok: true, result: {} }); await pending;
    assert.equal(engine.state.error, 'new-status'); assert.equal(engine.state.muted, true); assert.ok(!h.commands.some(c => c.type === 'socialCallMute'));
    window.dispatchEvent(new Event('pageshow')); await flush(); const automatic = h.commands.filter(c=>c.type==='socialCallResumeAudio').at(-1); assert.equal(automatic.callId, 'two'); assert.equal(automatic.userInitiated, false); resolveNative(automatic.id, { ok: true, result: {} }); await flush();
  } finally { await engine.dispose(); h.close(); }
});

test('native automatic completion during pending start cannot reactivate ducking', async () => {
  const h = fixture(true, command => command.type === 'socialVoiceStart' ? undefined : {}), recorder = createVoiceRecorder();
  try {
    const pending = recorder.start(), start = h.commands.find(c => c.type === 'socialVoiceStart');
    emitNativeEvent('socialVoice', { recordingId: start.recordingId, state: 'ready', base64: btoa('fixture'), mimeType: 'audio/mp4', durationMs: 120000 });
    resolveNative(start.id, { ok: true, result: {} }); await pending;
    assert.deepEqual(activeAudioOwners(), []); assert.equal((await recorder.stop()).durationMs, 120000);
  } finally { recorder.cancel(); await flush(); h.close(); }
});

test('late web stop from a cancelled recording cannot stop its replacement or release its duck owner', async () => {
  const h = fixture(), recorders = [], tracks = [];
  class Recorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); recorders.push(this); this.mimeType = 'audio/webm'; this.state = 'inactive'; }
    start() { this.state = 'recording'; } stop() { this.state = 'inactive'; }
  }
  globalThis.MediaRecorder = Recorder;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => { const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return { getTracks: () => [track] }; } } } });
  const recorder = createVoiceRecorder();
  try {
    await recorder.start(); recorder.cancel(); await recorder.start(); const owners = activeAudioOwners(); assert.equal(owners.length, 1);
    recorders[0].dispatchEvent(new Event('stop')); await flush(); assert.equal(tracks[1].stopped, false); assert.deepEqual(activeAudioOwners(), owners);
    const stop = recorder.stop(); recorders[1].dispatchEvent(new Event('stop')); await stop; assert.deepEqual(activeAudioOwners(), []); assert.equal(tracks[1].stopped, true);
  } finally { recorder.cancel(); h.close(); }
});
