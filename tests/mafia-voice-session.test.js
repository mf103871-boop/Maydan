import test from 'node:test';
import assert from 'node:assert/strict';
import { MafiaVoiceSession, mafiaCommunicationLocked } from '../src/social/mafia-voice-session.js';

const room = (epoch = 2, extra = {}) => ({ game: 'mafia', code: '123456', phase: 'night', you: { id: 'seat', roleId: 'mafia' },
  members: [{ id: 'seat', alive: true }], mafiaVoice: { callId: 'call', mediaEpoch: epoch, canPublish: true }, ...extra });
const response = (epoch = 2, extra = {}) => ({ call: { id: 'call', scope: 'mafia' }, mediaEpoch: epoch, canPublish: true, quiet: false,
  connection: { url: 'wss://example.livekit.cloud', token: 'server-issued' }, ...extra });
function fixture(request = async () => response()) {
  const transitions = [], disconnects = [], requests = [], calls = [];
  let paused = 0;
  const media = { state: { muted: true }, prepare: async () => {},
    transitionGame: async (value, options) => { transitions.push({ value, options }); media.state.muted = options.muted; },
    pauseGame: async () => { paused++; }, disconnect: async value => disconnects.push(value), mute: async muted => { media.state.muted = muted; } };
  const session = new MafiaVoiceSession({ request: async (code, body) => { requests.push({ code, body }); const result = await request(code, body); return { ...result, voiceSessionId: result?.voiceSessionId || body.voiceSessionId,
    ...(result?.call ? { call: { ...result.call, voiceSessionId: result.voiceSessionId || body.voiceSessionId } } : {}) }; },
    deviceId: async () => 'device', media, setCall: call => calls.push(call) });
  session.configure(room());
  return { session, media, transitions, disconnects, requests, calls, get paused() { return paused; } };
}
test('game voice starts in listen-only mode without requesting a microphone', async () => {
  const f = fixture(); await f.session.start();
  assert.equal(f.session.state.status, 'connected'); assert.equal(f.transitions[0].options.muted, true);
  assert.deepEqual(f.requests[0].body, { deviceId: 'device', operation: 'join', knownEpoch: -1, voiceSessionId: f.session.voiceSessionId });
  assert.equal(f.calls[0].name, 'مافيا ميدان');
});
test('same authorized epoch does not reconnect media; new audience clears participants', async () => {
  let result = response(); const f = fixture(async () => result); await f.session.start();
  f.session.mediaChanged({ callId: 'call', mediaEpoch: 2, participants: [{ id: 'other' }], connected: true });
  result = response(2, { unchanged: true }); await f.session.sync(); assert.equal(f.transitions.length, 1);
  result = response(3, { quiet: true, canPublish: false, connection: null }); f.session.room = room(3); await f.session.sync();
  assert.equal(f.transitions.length, 2); assert.deepEqual(f.session.state.participants, []); assert.equal(f.session.state.status, 'silent');
  await assert.rejects(f.session.mute(false), /مغلق/);
});
test('a voice response arriving after logout cannot connect or restore the call', async () => {
  let finish; const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const start = f.session.start(); await new Promise(resolve => setImmediate(resolve));
  f.session.clear(); finish(response()); await start;
  assert.equal(f.transitions.length, 0); assert.equal(f.session.state.requested, false); assert.deepEqual(f.session.state.participants, []);
});
test('a response for an earlier phase is discarded before touching media', async () => {
  let count = 0; const f = fixture(async () => response(++count === 1 ? 1 : 2)); await f.session.start();
  assert.equal(f.requests.length, 2); assert.equal(f.transitions.length, 1); assert.equal(f.transitions[0].value.mediaEpoch, 2);
});
test('persistently stale server replies stop with bounded attempts and silent media', async () => {
  const f = fixture(async () => response(0)); await assert.rejects(f.session.start(), /تغيّرت/);
  assert.equal(f.requests.length, 3); assert.equal(f.transitions.length, 0); assert.equal(f.paused, 1);
});
test('failed authorization immediately suspends audible media even on healthy transport', async () => {
  let fail = false; const f = fixture(async () => { if (fail) throw new Error('network'); return response(); }); await f.session.start();
  fail = true; await assert.rejects(f.session.sync(), /network/);
  assert.equal(f.paused, 1); assert.equal(f.session.epoch, -1); assert.equal(f.session.state.status, 'reconnecting');
});
test('delayed leave identifies its original match call and cannot name a replacement', async () => {
  const f = fixture(); await f.session.start(); await f.session.stop();
  assert.equal(f.requests.at(-1).body.callId, 'call'); assert.equal(f.requests.at(-1).body.operation, 'leave');
  assert.equal(f.disconnects[0].expectedMediaEpoch, 2);
});
test('side communication is locked only for living active participants', () => {
  assert.equal(mafiaCommunicationLocked(room()), true);
  for (const phase of ['lobby', 'over', 'closed']) assert.equal(mafiaCommunicationLocked(room(1, { phase })), false);
  assert.equal(mafiaCommunicationLocked(room(1, { you: null })), false);
  assert.equal(mafiaCommunicationLocked(room(1, { members: [{ id: 'seat', alive: false }] })), false);
});
test('rejoining waits for an earlier leave of the same match to finish', async () => {
  let finishLeave;
  const f = fixture(async (_code, body) => body.operation === 'leave' ? new Promise(resolve => { finishLeave = resolve; }) : response());
  await f.session.start(); const stopping = f.session.stop();
  await new Promise(resolve => setImmediate(resolve));
  const rejoining = f.session.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.filter(item => item.body.operation === 'join').length, 1);
  finishLeave({}); await stopping; await rejoining;
  assert.equal(f.requests.filter(item => item.body.operation === 'join').length, 2);
  assert.equal(f.session.state.status, 'connected');
});

test('the result screen leaves voice and preserves the explicit return-to-social action', async () => {
  const f = fixture(); f.session.beforeJoin = async () => ({ scope: 'group', conversationId: 'friends' });
  await f.session.start(); f.session.configure(room(8, { phase: 'over' })); await f.session.stopping;
  assert.equal(f.session.state.requested, false); assert.equal(f.session.room, null);
  assert.equal(f.session.state.previousCall.conversationId, 'friends'); assert.equal(f.requests.at(-1).body.operation, 'leave');
  await assert.rejects(f.session.start(), /متاح بعد/);
});

test('an uncertain leave is fenced by a new session nonce on rejoin', async () => {
  const f = fixture(async (_code, body) => { if (body.operation === 'leave') throw new Error('lost response'); return response(); });
  await f.session.start(); const old = f.session.voiceSessionId; await f.session.stop(); await f.session.start();
  assert.notEqual(f.session.voiceSessionId, old);
  assert.equal(f.requests.find(item => item.body.operation === 'leave').body.voiceSessionId, old);
  assert.equal(f.requests.at(-1).body.operation, 'join');
});

test('native continuity restores only the authorized active match and retains its session nonce', async () => {
  const f = fixture(); f.session.native = true;
  const snapshot = { callId: 'call', scope: 'mafia', conversationId: '123456', mediaEpoch: 2, voiceSessionId: crypto.randomUUID(), connected: true, muted: true, participants: [] };
  f.session.mediaChanged(snapshot); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.session.state.requested, true); assert.equal(f.requests[0].body.operation, 'sync');
  assert.equal(f.requests[0].body.voiceSessionId, snapshot.voiceSessionId);
  await f.session.stop(); f.session.configure(room(3, { phase: 'over' })); f.session.mediaChanged(snapshot);
  assert.equal(f.session.state.requested, false);
});
