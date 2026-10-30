import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioEvents } from '../src/shared/fx/audio-events.js';
import { resolveAudioScene, createSceneLeases } from '../src/shared/fx/audio-scenes.js';
import { createMafiaPublicAudio } from '../src/games/mafia/audio.js';

function harness() {
  let clock = 1000; const calls = [];
  const bus = createAudioEvents((cue, options) => { calls.push({ cue, options }); return true; }, { now: () => clock });
  return { bus, calls, advance(ms = 2000) { clock += ms; } };
}
test('semantic events consume muted, initial and duplicate events without playback', () => {
  const { bus, calls, advance } = harness();
  bus.emit('game.correct', { id: 1, initial: true }); advance(); bus.emit('game.correct', { id: 1 });
  bus.emit('game.correct', { id: 2, muted: true }); advance(); bus.emit('game.correct', { id: 2 });
  assert.equal(calls.length, 0); assert.equal(bus.emit('game.correct', { id: 3 }), true); advance();
  assert.equal(bus.emit('game.correct', { id: 3 }), false); assert.equal(calls.length, 1);
});
test('expired, unknown, wrong-scope and future events are silent', () => {
  const { bus, calls } = harness(); bus.reset('b');
  bus.emit('game.correct', { scope: 'a' }); bus.emit('ui.click', { at: 1 });
  bus.emit('ui.click', { at: 10000 }); bus.emit('not-a-cue'); assert.equal(calls.length, 0);
});
test('account, stage and suspension invalidate queued playback guards', () => {
  const { bus, calls, advance } = harness(); bus.emit('game.correct');
  assert.equal(calls[0].options.guard(), true); bus.reset('next'); assert.equal(calls[0].options.guard(), false);
  advance(); bus.emit('game.correct'); bus.suspend(); assert.equal(calls[1].options.guard(), false);
});

test('a delayed sample preparation rechecks the original event deadline before rendering', async () => {
  let clock = 1000, finishPrepare;
  const rendered = [];
  const prepared = new Promise(resolve => { finishPrepare = resolve; });
  const bus = createAudioEvents((cue, options) => {
    prepared.then(() => { if (options.guard()) rendered.push(cue); });
    return true;
  }, { now: () => clock });
  assert.equal(bus.emit('game.correct', { id: 'old-at-submit', at: 100 }), true);
  clock += 101; finishPrepare(); await prepared; await Promise.resolve();
  assert.deepEqual(rendered, [], '101 ms of preparation still exceeds this already-aged event TTL');
  clock += 2000;
  assert.equal(bus.emit('game.correct', { id: 'old-at-submit' }), false, 'an expired queued event stays consumed');
});

test('render guards reject a nonfinite clock or an event too far in the future after a clock change', () => {
  let clock = 1000; const calls = [];
  const bus = createAudioEvents((cue, options) => { calls.push(options); return true; }, { now: () => clock });
  assert.equal(bus.emit('ui.confirm', { at: 1000 }), true);
  clock = NaN; assert.equal(calls[0].guard(), false);
  clock = -1; assert.equal(calls[0].guard(), false);
  clock = 2000; assert.equal(calls[0].guard(), true, 'the exact TTL boundary is still valid');
  clock = 2001; assert.equal(calls[0].guard(), false);
});
test('public Mafia event flag is required and does not accept generic death', () => {
  const { bus, calls } = harness(); bus.emit('mafia.assassination.public', { id: 1 });
  bus.emit('mafia.death', { publicEvent: true }); assert.equal(calls.length, 0);
  bus.emit('mafia.assassination.public', { id: 2, publicEvent: true }); assert.equal(calls[0].cue, 'mafiaAssassination');
});
test('notifications and simultaneous correct answers coalesce', () => {
  const { bus, calls, advance } = harness();
  for (let i = 0; i < 12; i++) bus.emit('social.message', { id: i });
  assert.equal(calls.length, 1); advance(); bus.emit('social.message', { id: 13 }); assert.equal(calls.length, 2);
});
test('cancel is silent and does not masquerade as victory', () => {
  const { bus, calls } = harness(); bus.emit('game.cancel'); assert.equal(calls.length, 0);
});
test('Mafia public sounds only consume new authorized log entries', () => {
  const calls = [], bus = createMafiaPublicAudio({ emit: (...args) => calls.push(args) });
  const at = Date.now();
  const state = { code: 'R', matchId: 1, phaseId: 1, serverNow: at, log: [{ id: 1, at, type: 'eliminated', reason: 'night' }] };
  bus.update(state); assert.equal(calls.length, 0);
  bus.update({ ...state, you: { roleId: 'mafia', reports: [{ type: 'killed' }] }, replay: { events: [{ type: 'eliminated', reason: 'night' }] } });
  assert.equal(calls.length, 0);
  state.log.push({ id: 2, at, type: 'eliminated', reason: 'forfeit' }); bus.update(state); assert.equal(calls.length, 0);
  state.log.push({ id: 3, at, type: 'eliminated', reason: 'night' }); bus.update(state); assert.equal(calls.length, 1);
  bus.update(state); assert.equal(calls.length, 1);
  bus.update({ ...state, phaseId: 2 }); assert.equal(calls[0][1].guard(), false);
});
test('Mafia hidden, initial reconnect and delayed observer projections do not leak live events', () => {
  const calls = [], bus = createMafiaPublicAudio({ emit: (...args) => calls.push(args) });
  bus.update({ matchId: 1, phaseId: 1, log: [] });
  const at = Date.now();
  const state = { matchId: 1, phaseId: 2, serverNow: at, log: [{ id: 1, at, type: 'verdict_closed' }] };
  bus.update(state, { hidden: true }); bus.update(state); assert.equal(calls.length, 0);
  bus.suspend(); bus.update({ ...state, log: [...state.log, { id: 2, at, type: 'eliminated', reason: 'night' }] });
  assert.equal(calls.length, 0);
  // An observer only hands in the delayed log: no clock-derived or roster-derived sound.
  bus.update({ ...state, members: [{ alive: false }], serverNow: 999999, log: state.log }); assert.equal(calls.length, 0);
});
test('scene leases arbitrate by priority and return to the remaining owner', () => {
  const calls = [], leases = createSceneLeases(scene => calls.push(scene));
  leases.set('a', 'home', 0); leases.set('b', 'mafia', 20); leases.set('c', 'home', 1);
  assert.equal(calls.at(-1), 'mafia'); leases.release('b'); assert.equal(calls.at(-1), 'home');
  leases.clear(); assert.equal(calls.at(-1), null);
});
test('scene asset gates reject remote, unreviewed and unhashed music', () => {
  const candidate = { id: 'mafia', url: 'audio/mafia.mp3', seconds: 59, sha256: 'a'.repeat(64), licenseVerified: true, listeningApproved: true };
  assert.equal(resolveAudioScene('mafia', 'night', { tracks: { mafia: candidate } }).track, candidate);
  for (const patch of [{ listeningApproved: false }, { licenseVerified: false }, { sha256: null }, { url: 'https://example.com/a.mp3' }]) {
    assert.equal(resolveAudioScene('mafia', 'night', { tracks: { mafia: { ...candidate, ...patch } } }).track, null);
  }
  assert.equal(resolveAudioScene('mafia', 'defense', { tracks: { mafia: candidate } }).track, null);
  assert.equal(resolveAudioScene('home', 'idle', { creatorMode: true }).fallback, null);
});

test('new weapon and gavel assets require local files, hashes, licenses and listening sign-off', async () => {
  const { reviewedEffectBank } = await import('../src/shared/fx/reviewed-effects.js');
  const good = { cue: 'mafiaAssassination', url: 'audio/mafia-shot-a1.mp3', sha256: 'a'.repeat(64), frames: 48000, bytes: 10000, licenseVerified: true, listeningApproved: true };
  assert.equal(Object.keys(reviewedEffectBank()).length, 0);
  assert.equal(Object.keys(reviewedEffectBank([good])).length, 1);
  for (const patch of [{cue:'explosion'}, {listeningApproved:false}, {licenseVerified:false}, {frames:48000*300}, {url:'https://cdn.example.com/a.mp3'}]) assert.equal(Object.keys(reviewedEffectBank([{...good,...patch}])).length,0);
});
