import test from 'node:test';
import assert from 'node:assert/strict';
import { CallMedia, activeAudioOwners } from '../src/social/media.js';
import { MafiaVoiceSession } from '../src/social/mafia-voice-session.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const call = (id = 'call', scope = 'direct') => ({ call: { id, scope, conversationId: 'conversation', voiceSessionId: scope === 'mafia' ? 'voice-session' : undefined }, connection: { url: 'wss://fixture.invalid', token: 'fixture-only' } });

function fixture(t, { holdDisconnect = false, holdConnect = false } = {}) {
  const previous = { window: globalThis.window, document: globalThis.document, location: globalThis.location };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false, body: { append() {} } });
  globalThis.location = { protocol: 'https:' };
  const rooms = [], shutdown = deferred(), connected = deferred();
  const RoomEvent = Object.fromEntries(['ParticipantConnected', 'ParticipantDisconnected', 'ActiveSpeakersChanged', 'TrackMuted', 'TrackUnmuted', 'LocalTrackPublished', 'LocalTrackUnpublished', 'TrackSubscribed', 'TrackUnsubscribed', 'Reconnecting', 'Reconnected', 'Disconnected'].map(name => [name, name]));
  class Room {
    constructor() {
      rooms.push(this); this.handlers = new Map(); this.remoteParticipants = new Map(); this.startAudioCalls = 0;
      this.localParticipant = { identity: 'alice', isMicrophoneEnabled: false, async setMicrophoneEnabled(enabled) { this.isMicrophoneEnabled = enabled; } };
    }
    on(event, listener) { this.handlers.set(event, listener); }
    emit(event, ...args) { this.handlers.get(event)?.(...args); }
    async connect() { if (holdConnect) await connected.promise; }
    async disconnect() { if (holdDisconnect) await shutdown.promise; this.emit(RoomEvent.Disconnected); }
    async startAudio() { this.startAudioCalls++; }
    subscribe(element) { const track = { kind: 'audio', attach: () => { element.attachments = (element.attachments || 0) + 1; return element; }, detach: () => [] }; this.emit(RoomEvent.TrackSubscribed, track); return track; }
  }
  const media = new CallMedia(() => {}, { loadSDK: async () => ({ Room, RoomEvent, Track: { Kind: { Audio: 'audio' } } }) });
  media.setAccount('alice');
  t.after(async () => {
    connected.resolve(); shutdown.resolve(); await media.dispose();
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.location = previous.location;
  });
  const lifecycle = (state, shouldResume) => window.dispatchEvent(new CustomEvent('maydan-audio-lifecycle', { detail: { state, shouldResume } }));
  const element = () => ({ dataset: {}, paused: true, srcObject: { source: 'fixture' }, removed: false, plays: 0,
    async play() { this.plays++; this.paused = false; }, pause() { this.paused = true; }, remove() { this.removed = true; } });
  return { media, rooms, shutdown, connected, lifecycle, element };
}

for (const action of ['disconnect', 'pause-game', 'change-account']) test(`old audio stops synchronously before delayed ${action} transport cleanup`, async t => {
  const f = fixture(t, { holdDisconnect: true });
  await f.media.connect({ ...call('old', action === 'pause-game' ? 'mafia' : 'direct'), mediaEpoch: 3 }, { muted: true });
  const element = f.element(); f.rooms[0].subscribe(element); await flush();
  assert.equal(element.paused, false);
  let pending;
  if (action === 'disconnect') pending = f.media.disconnect();
  else if (action === 'pause-game') pending = f.media.pauseGame();
  else f.media.setAccount('bob');
  assert.equal(element.paused, true, 'retiring the UI must stop output while the old SDK disconnect is pending');
  assert.equal(element.srcObject, null, 'retired playback must release the previous audience stream');
  assert.equal(element.removed, true);
  f.shutdown.resolve(); await pending;
  if (action !== 'pause-game') assert.equal(activeAudioOwners().includes(f.media.owner), false);
});

test('a remote track arriving during an explicit no-resume hold waits for the actual playback action', async t => {
  const f = fixture(t); await f.media.connect(call(), { muted: true });
  const first = f.element(); f.rooms[0].subscribe(first); await flush();
  f.lifecycle('session-restored', false);
  const joined = f.element(); f.rooms[0].subscribe(joined); await flush();
  assert.equal(first.paused, true);
  assert.equal(joined.plays, 0, 'a new participant does not bypass the existing playback hold');
  assert.equal(joined.attachments || 0, 0, 'SDK attach itself can autoplay, so the attachment must also wait');
  assert.equal(joined.paused, true);
  await f.media.resumeAudio();
  assert.equal(joined.plays, 1); assert.equal(first.paused, false); assert.equal(joined.paused, false);
  assert.equal(f.media.state.muted, true, 'playback recovery never unmutes input');
  assert.equal(f.media.state.error, '');
});

test('a remote track arriving during an audio interruption waits until restoration', async t => {
  const f = fixture(t); await f.media.connect(call(), { muted: true });
  f.lifecycle('interruption-began', false);
  const joined = f.element(); f.rooms[0].subscribe(joined); await flush();
  assert.equal(joined.plays, 0);
  assert.equal(joined.paused, true);
  f.lifecycle('interruption-ended', true); await flush();
  assert.equal(joined.plays, 1); assert.equal(joined.paused, false);
  assert.equal(f.media.state.muted, true);
});

test('SDK reconnection preserves the no-resume action and cannot silently resume a held call', async t => {
  const f = fixture(t); await f.media.connect(call(), { muted: true });
  const element = f.element(); f.rooms[0].subscribe(element); await flush();
  f.lifecycle('session-restored', false);
  const prompt = f.media.state.error;
  f.rooms[0].emit('Reconnecting'); f.rooms[0].emit('Reconnected'); await flush();
  assert.equal(f.media.playbackHeld, true); assert.equal(element.paused, true);
  assert.equal(f.media.state.error, prompt, 'the visible playback action remains available after a transport recovery');
  assert.equal(f.rooms[0].startAudioCalls, 0);
  await f.media.resumeAudio(); assert.equal(element.paused, false); assert.equal(f.media.state.muted, true);
});

test('a playback hold arriving during asynchronous connect remains visible when transport finishes', async t => {
  const f = fixture(t, { holdConnect: true });
  const pending = f.media.connect(call(), { muted: true }); await flush();
  f.lifecycle('session-restored', false);
  f.connected.resolve(); await pending;
  assert.equal(f.media.playbackHeld, true);
  assert.match(f.media.state.error, /تشغيل الصوت/);
  assert.equal(f.media.state.muted, true);
});

test('Mafia audience pause immediately mutes a still-healthy transport before its shutdown resolves', async t => {
  const f = fixture(t, { holdDisconnect: true });
  await f.media.connect({ ...call('call', 'mafia'), mediaEpoch: 1 }, { muted: false });
  assert.equal(f.rooms[0].localParticipant.isMicrophoneEnabled, true);
  const pausing = f.media.pauseGame();
  assert.equal(f.rooms[0].localParticipant.isMicrophoneEnabled, false);
  f.shutdown.resolve(); await pausing;
});

function mafia(f, t) {
  let epoch = 1, quiet = false;
  const session = new MafiaVoiceSession({ media: f.media, deviceId: async () => 'device', request: async (_code, body) => ({
    call: { id: 'mafia-call', scope: 'mafia', voiceSessionId: body.voiceSessionId }, voiceSessionId: body.voiceSessionId,
    mediaEpoch: epoch, canPublish: !quiet, quiet, unchanged: body.knownEpoch === epoch,
    ...(body.knownEpoch === epoch ? {} : { connection: quiet ? null : { url: 'wss://fixture.invalid', token: 'new-audience-fixture' } }),
  }) });
  f.media.onChange = state => session.mediaChanged(state);
  const configure = () => session.configure({ game: 'mafia', code: '123456', phase: 'discussion', you: { id: 'seat', roleId: 'citizen' },
    members: [{ id: 'seat', alive: true }], mafiaVoice: { callId: 'mafia-call', mediaEpoch: epoch, canPublish: !quiet } });
  configure();
  t.after(() => session.stop({ notify: false }));
  return { session, async nextAudience({ silent = false } = {}) { epoch++; quiet = silent; configure(); await session.pending; } };
}

test('same logical Mafia call preserves a no-resume hold and its visible prompt through an authorized audience transition', async t => {
  const f = fixture(t), m = mafia(f, t); await m.session.start();
  f.lifecycle('session-restored', false);
  await m.nextAudience();
  assert.equal(f.media.state.mediaEpoch, 2);
  assert.equal(f.media.playbackHeld, true);
  assert.match(f.media.state.error, /تشغيل الصوت/);
  assert.equal(m.session.state.error, f.media.state.error);
  assert.equal(f.rooms[1].startAudioCalls, 0);
});

test('Mafia voice exposes the current media prompt and clears it after successful explicit playback', async t => {
  const f = fixture(t), m = mafia(f, t); await m.session.start();
  f.lifecycle('session-restored', false); assert.match(m.session.state.error, /تشغيل الصوت/);
  await m.session.sync();
  assert.equal(m.session.state.error, f.media.state.error, 'unchanged authorization must not hide the playback action');
  await f.media.resumeAudio();
  assert.equal(f.media.state.error, ''); assert.equal(m.session.state.error, '');
});

test('an explicit new call after leaving starts without the previous call playback hold', async t => {
  const f = fixture(t); await f.media.connect(call('old'), { muted: true });
  f.lifecycle('session-restored', false); await f.media.disconnect();
  await f.media.connect(call('new'), { muted: true });
  assert.equal(f.media.playbackHeld, false); assert.equal(f.media.state.error, '');
});

test('quiet Mafia phases retain the hold internally and restore its action only when an audible audience returns', async t => {
  const f = fixture(t), m = mafia(f, t); await m.session.start();
  f.lifecycle('session-restored', false); await m.nextAudience({ silent: true });
  assert.equal(f.media.playbackHeld, true); assert.equal(f.media.state.connected, false);
  assert.equal(f.media.state.error, ''); assert.equal(m.session.state.error, '');
  await m.nextAudience();
  assert.equal(f.media.playbackHeld, true); assert.match(m.session.state.error, /تشغيل الصوت/);
});

test('a terminal SDK disconnect fences later reconnect/track callbacks without reopening the ended call', async t => {
  const f = fixture(t); await f.media.connect(call(), { muted: true });
  f.rooms[0].emit('Disconnected'); const ended = f.media.state;
  assert.equal(ended.ended, true);
  f.rooms[0].emit('Reconnected'); const element = f.element(); f.rooms[0].subscribe(element); await flush();
  assert.equal(f.media.state, ended); assert.equal(element.attachments || 0, 0);
  assert.equal(activeAudioOwners().includes(f.media.owner), false);
});

test('an unsubscribed held track is not attached by a later playback action', async t => {
  const f = fixture(t); await f.media.connect(call(), { muted: true });
  f.lifecycle('session-restored', false); const element = f.element(), track = f.rooms[0].subscribe(element);
  f.rooms[0].emit('TrackUnsubscribed', track); await f.media.resumeAudio();
  assert.equal(element.attachments || 0, 0); assert.equal(f.media.pendingTracks.size, 0);
});

test('leaving clears deferred tracks so the next call cannot play the old audience', async t => {
  const f = fixture(t); await f.media.connect(call('old'), { muted: true });
  f.lifecycle('session-restored', false); const element = f.element(); f.rooms[0].subscribe(element);
  await f.media.disconnect(); await f.media.connect(call('new'), { muted: true }); await f.media.resumeAudio();
  assert.equal(element.attachments || 0, 0); assert.equal(f.media.pendingTracks.size, 0);
});
