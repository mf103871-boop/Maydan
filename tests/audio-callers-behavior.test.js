import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAudioEvents } from '../src/shared/fx/audio-events.js';
import { createLocalMatchAudio } from '../src/shared/fx/match-audio.js';

// Execute the current caller itself, including its deferred visual callback.
// The real completion controller and event bus own audio; browser UI/storage
// effects are narrow stand-ins and never open media or a remote service.
const badeeha = readFileSync(new URL('../src/games/badeeha/App.js', import.meta.url), 'utf8');
const start = badeeha.indexOf('  function finishGame(');
const end = badeeha.indexOf('  function judgeQuestion(', start);
assert.ok(start >= 0 && end > start, 'actual Badeeha completion caller exists');
const actualFinishGame = badeeha.slice(start, end);

for (const early of [true, false]) test(`Badeeha ${early ? 'early exit stays silent' : 'completed match sounds once'} without changing its deferred result visuals`, () => {
  const sounds = [], completions = [], timers = [], saved = new Map();
  const bus = createAudioEvents(cue => { sounds.push(cue); return true; });
  const completion = createLocalMatchAudio(bus, 'badeeha', 'actual-finish-caller');
  const teams = [{ id: 'a', name: 'أ', score: 4, correct: 2, steals: 0 }, { id: 'b', name: 'ب', score: 1, correct: 1, steals: 0 }];
  let confetti = 0, screen = '', record;
  const context = {
    api: { matchOver(value) { completions.push(value); completion.complete(value.completed); }, confetti: { fire() { confetti++; } } },
    teams, used: { q1: true, q2: true }, totalQuestions: 2, roundSize: 2, mode: 'teams', results: [],
    setTeams() {}, betaCloneTeams: value => structuredClone(value), setResults() {},
    setFinalResult(value) { record = value; }, saveKey: (key, value) => saved.set(key, value),
    MAYDAN_BETA_KEYS: { results: 'results', active: 'active' }, saveTimerRef: { current: null },
    window: { setTimeout(callback, delay) { timers.push({ callback, delay }); }, clearTimeout() {} },
    betaRemoveKey: key => saved.delete(key), activeSnapshotRef: { current: {} },
    setSavedActive() {}, setConfirmEnd() {}, setShowScore() {}, setCurrent() {}, setScreen(value) { screen = value; },
    playSfx: cue => sounds.push(cue), reducedMotion: false, confettiFx: { fire() { confetti++; } }, haptic() {},
  };
  const finishGame = new Function(...Object.keys(context), `${actualFinishGame}\nreturn finishGame;`)(...Object.values(context));
  finishGame(early);
  assert.deepEqual(completions, [{ completed: !early }], 'the existing completion rule remains authoritative');
  assert.equal(screen, 'result');
  assert.equal(record.early, early);
  assert.equal(record.answered, 2);
  assert.equal(saved.get('results')[0], record, 'the same result is persisted');
  assert.deepEqual(timers.map(value => value.delay), [360], 'the existing visual delay is unchanged');
  assert.equal(confetti, 0, 'visuals remain deferred');
  timers[0].callback();
  assert.equal(confetti, 1, 'the original visual callback still runs');
  assert.deepEqual(sounds, early ? [] : ['fanfare'], 'only the completion controller may sound a finished match');
});
