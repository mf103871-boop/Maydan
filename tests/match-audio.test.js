import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioEvents } from '../src/shared/fx/audio-events.js';
import { createLocalMatchAudio, createOnlineMatchAudio } from '../src/shared/fx/match-audio.js';

function fixture() {
  const played = [];
  let now = 1000;
  const sound = createAudioEvents((cue, options) => { played.push({ cue, options }); return true; }, { now: () => now });
  return { sound, played, advance() { now += 1500; } };
}
const state = (phase, extra = {}) => ({ game: 'fabraka', matchId: 1, round: 3, phase, ...extra });

test('a remounted local game completes again; duplicate callbacks and aborted games stay silent', () => {
  const f = fixture();
  const first = createLocalMatchAudio(f.sound, 'jabeen');
  assert.equal(first.complete(true), true);
  assert.equal(first.complete(true), false);
  f.advance(); first.dispose();
  assert.equal(first.complete(true), false);
  createLocalMatchAudio(f.sound, 'jabeen').complete(true);
  f.advance();
  const aborted = createLocalMatchAudio(f.sound, 'jabeen');
  assert.equal(aborted.complete(false), false);
  assert.equal(aborted.complete(true), false);
  assert.deepEqual(f.played.map(x => x.cue), ['fanfare', 'fanfare']);
});

test('StrictMode cleanup/setup cannot resurrect a queued completion or replay a settled match', () => {
  const f = fixture();
  const match = createLocalMatchAudio(f.sound, 'beep');
  match.complete(true);
  const queued = f.played[0].options.guard;
  match.dispose(); match.activate();
  assert.equal(queued(), false);
  assert.equal(match.complete(true), false);
  const untouched = createLocalMatchAudio(f.sound, 'beep');
  untouched.dispose(); untouched.activate();
  f.advance(); assert.equal(untouched.complete(true), true);
});

test('self-managed Badeeha can begin and finish multiple matches without remounting Play', () => {
  const f = fixture();
  const match = createLocalMatchAudio(f.sound, 'badeeha');
  match.begin(); match.complete(true);
  const old = f.played.at(-1).options.guard;
  f.advance(); match.begin();
  assert.equal(old(), false);
  assert.equal(match.complete(true), true);
  assert.equal(match.complete(true), false);
  assert.deepEqual(f.played.map(x => x.cue), ['fanfare', 'fanfare']);
});

test('different rooms with the same match counters each play their own completion once', () => {
  const f = fixture();
  for (const room of ['123456', '654321']) {
    const audio = createOnlineMatchAudio(f.sound, room);
    audio.update(state('vote'));
    assert.equal(audio.update(state('over')), 'game.complete');
    assert.equal(audio.update(state('over')), null);
    f.advance(); audio.dispose();
  }
  assert.deepEqual(f.played.map(x => x.cue), ['fanfare', 'fanfare']);
});

test('initial, reconnected and hidden room results are consumed without replay on resume', () => {
  const f = fixture();
  const audio = createOnlineMatchAudio(f.sound, '123456');
  audio.update(state('result'));
  audio.update(state('over'), { hidden: true });
  f.advance(); audio.update(state('over'), { hidden: false });
  audio.update(state('vote', { matchId: 2 }));
  audio.update(null, { connected: false });
  audio.update(state('over', { matchId: 2 }));
  assert.equal(f.played.length, 0);
});

test('room aborts, Mafia and design previews do not get a generic victory', () => {
  const f = fixture();
  for (const extra of [{ reason: 'players_left' }, { reason: 'technical_abort' }, { reason: 'future_abort' }, { game: 'mafia' }, { _designPreview: true }]) {
    const audio = createOnlineMatchAudio(f.sound, JSON.stringify(extra));
    audio.update(state('vote', extra));
    audio.update(state('over', extra));
    f.advance();
  }
  assert.equal(f.played.length, 0);
});

test('a later phase or disconnect invalidates pending sounds', () => {
  const f = fixture();
  const audio = createOnlineMatchAudio(f.sound, '123456');
  audio.update(state('vote')); audio.update(state('result'));
  const result = f.played.at(-1).options.guard;
  assert.equal(result(), true);
  audio.update(state('over'));
  assert.equal(result(), false);
  const completion = f.played.at(-1).options.guard;
  audio.update(null, { connected: false });
  assert.equal(completion(), false);
});
