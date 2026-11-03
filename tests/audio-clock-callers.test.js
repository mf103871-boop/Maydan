import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { createDeadlineAudio } from '../src/shared/fx/deadline-audio.js';
import { createAudioEvents } from '../src/shared/fx/audio-events.js';

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
// Run the actual caller arguments, not a second copy of its phase rules.
function caller(path, values) {
  const expression = source(path).match(/useCandidateDeadlineWarning\([\s\S]*?\);/)?.[0];
  assert.ok(expression, `${path}: a current public warning caller exists`);
  let result;
  new Function('useCandidateDeadlineWarning', ...Object.keys(values), expression)((...args) => { result = args; }, ...Object.values(values));
  return result;
}
function onlineState(phase) {
  return { code: 'TEST', matchId: 'm1', round: 1, phase, participants: ['me'], _designPreview: false };
}
test('online warnings require connected active participants and public phases; no secret Mafia or hidden bomb caller exists', () => {
  const sound = {}, platform = { sound }, me = { id: 'me' };
  const tests = [
    ['online/Ersomha.jsx', { platform, state: onlineState('draw'), seconds: 5, me, status: 'connected', disabled: false, paused: false, playing: true }, [
      { status: 'reconnecting' }, { disabled: true }, { paused: true }, { playing: false }, { me: { id: 'spectator' } }, { state: { ...onlineState('draw'), _designPreview: true } },
    ]],
    ['online/Fabraka.jsx', { platform, state: onlineState('write'), seconds: 5, me, disabled: false, spectating: false }, [
      { disabled: true }, { spectating: true }, { state: onlineState('host') }, { state: onlineState('result') }, { state: { ...onlineState('write'), _designPreview: true } },
    ]],
    ['online/Online.jsx', { platform, state: onlineState('vote'), seconds: 5, disabled: false, spectating: false }, [
      { disabled: true }, { spectating: true }, { state: onlineState('result') }, { state: { ...onlineState('vote'), _designPreview: true } },
    ]],
  ];
  for (const [path, baseline, silent] of tests) {
    const live = caller(path, baseline); assert.equal(live[0], sound); assert.equal(live[2], 5); assert.equal(live[3], true, path);
    for (const patch of silent) assert.equal(Boolean(caller(path, { ...baseline, ...patch })[3]), false, `${path}: ${JSON.stringify(patch)}`);
  }
  const bomb = source('games/beep/Game.jsx').split('function BombRound(')[1].split('export function')[0];
  assert.ok(bomb.includes('useTimerCues(timer, api, { last: Infinity, fastBelow: -1, hapticBelow: -1 })'));
  assert.doesNotMatch(bomb, /warningKey|useCandidateDeadlineWarning/);
  for (const path of ['online/Mafia.jsx', 'games/mafia/useMafiaSound.js', 'games/mafia/tutorial/MafiaTutorial.jsx']) {
    assert.doesNotMatch(source(path), /useCandidateDeadlineWarning|game\.timer-warning|timerWarning/);
  }
});
test('local Badeeha and Fabraka keep revealed answers, pass-phone, pause and design preview silent', () => {
  const sound = {}, api = { sound, designPreview: false };
  const badeeha = { api, current: { categoryId: 'c', index: 0 }, currentQuestion: { qid: 'q1' }, timeLeft: 5, isDesignPreview: false, effectiveSoundOn: true, screen: 'question', revealed: false, paused: false };
  assert.equal(caller('games/badeeha/App.js', badeeha)[3], true);
  for (const patch of [{ current: null }, { isDesignPreview: true }, { effectiveSoundOn: false }, { screen: 'result' }, { revealed: true }, { paused: true }]) {
    assert.equal(Boolean(caller('games/badeeha/App.js', { ...badeeha, ...patch })[3]), false);
  }
  const state = { sessionId: 's', remaining: 5, phase: 'write', ready: true, paused: false, settings: { writeSeconds: 60 } };
  assert.equal(caller('games/fabraka/Game.jsx', { api, state, key: 'write:p1' })[3], true);
  for (const patch of [{ paused: true }, { ready: false }, { phase: 'host' }, { phase: 'vote' }, { settings: { writeSeconds: 0 } }]) {
    assert.equal(Boolean(caller('games/fabraka/Game.jsx', { api, state: { ...state, ...patch }, key: 'write:p1' })[3]), false);
  }
  assert.equal(caller('games/fabraka/Game.jsx', { api: { ...api, designPreview: true }, state, key: 'write:p1' })[3], false);
});
test('the real Ersomha caller warns once and cannot replay after pause, disconnect or late re-entry', () => {
  let time = 0; const emitted = [];
  const bus = createAudioEvents((cue, options) => { emitted.push({ cue, options }); return true; }, { candidateMode: true, now: () => time });
  const controller = createDeadlineAudio({ emit: bus.emit }, { warningOnly: true, now: () => time });
  const baseline = { platform: {}, state: onlineState('draw'), me: { id: 'me' }, status: 'connected', disabled: false, paused: false, playing: true };
  const apply = (seconds, patch = {}) => { const [, key, remaining, active] = caller('online/Ersomha.jsx', { ...baseline, seconds, ...patch }); controller.update(key, remaining, { active }); };
  apply(9); apply(5); assert.equal(emitted.length, 1); assert.equal(emitted[0].cue, 'timerWarning');
  apply(4, { status: 'reconnecting' }); assert.equal(emitted[0].options.guard(), false);
  apply(3); apply(2); assert.equal(emitted.length, 1);
  time = 2000; apply(4, { state: { ...baseline.state, round: 2 } }); apply(3, { state: { ...baseline.state, round: 2 } });
  assert.equal(emitted.length, 1, 'a newly entered late round establishes a silent baseline');
});
test('all changed public timer callers and shared hooks remain valid JavaScript/JSX', async () => {
  for (const path of ['games/badeeha/App.js', 'games/beep/Game.jsx', 'games/mamnoo/Game.jsx', 'games/jabeen/Game.jsx', 'games/fabraka/Game.jsx', 'online/Ersomha.jsx', 'online/Fabraka.jsx', 'online/Online.jsx', 'shared/fx/useDeadlineAudio.js', 'shared/ui/useTimerCues.js']) {
    await transform(source(path), { loader: 'jsx', sourcefile: path, logLevel: 'silent' });
  }
});
