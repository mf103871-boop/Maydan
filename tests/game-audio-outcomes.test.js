import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = game => readFileSync(new URL(`../src/games/${game}/Game.jsx`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function apiFixture() {
  const sounds = [], haptics = [], completions = []; let confetti = 0;
  return { sounds, haptics, completions, get confetti() { return confetti; }, api: {
    storage: { set() {} }, sound: { emit: type => sounds.push(type), play: name => sounds.push(name) },
    haptics: { vibrate: pattern => haptics.push(pattern) }, confetti: { fire: () => confetti++, burst: () => confetti++ },
    matchOver: value => completions.push(value),
  } };
}

// Execute the actual completion effect body; no duplicated reducer or effect
// implementation in the fixture, and no mounted child UI or browser required.
test('local completed matches keep celebration feedback, while early termination stays neutral and leaves sound ownership to Play', () => {
  for (const game of ['beep', 'jabeen', 'mamnoo', 'meenfina']) {
    const effect = source(game).match(/useEffect\(\(\) => \{\n(\s*if \(state.phase !== 'over'\) return;[\s\S]*?)\n\s*\}, \[state.phase\]/);
    assert.ok(effect, `${game}: completion effect present`);
    const execute = new Function('state', 'api', 'source', 'trimSeen', 'SEEN_KEY', effect[1]);
    for (const completed of [false, true]) {
      const fixture = apiFixture();
      execute({ phase: 'over', completed }, fixture.api, { seen: () => [] }, value => value, 'seen');
      assert.deepEqual(fixture.sounds, [], `${game}: platform owns result audio`);
      assert.deepEqual(fixture.haptics, completed ? ['win'] : [], `${game}: haptics follow real completion`);
      assert.equal(fixture.confetti, completed ? 1 : 0, `${game}: confetti follows real completion`);
      assert.deepEqual(fixture.completions, [{ completed }], game);
    }
  }
  const effect = source('fabraka').match(/if \(state.phase === 'over'\) \{([\s\S]*?api.matchOver\?\.\(\{ completed \}\);\n\s*)\}/);
  assert.ok(effect);
  const execute = new Function('state', 'api', effect[1]);
  for (const completed of [false, true]) {
    const fixture = apiFixture(); execute({ rounds: 2, history: completed ? [{}, {}] : [{}] }, fixture.api);
    assert.deepEqual(fixture.sounds, []);
    assert.deepEqual(fixture.haptics, completed ? ['win'] : []);
    assert.equal(fixture.confetti, completed ? 1 : 0);
    assert.deepEqual(fixture.completions, [{ completed }]);
  }
});

test('a Meenfina vote confirms a choice without marking the player correct or producing victory feedback', () => {
  const body = source('meenfina').match(/const confirmPick = \(\) => \{ (.*) \};/);
  assert.ok(body);
  const fixture = apiFixture(), labels = [], actions = [];
  new Function('api', 'stampScreen', 'dispatch', 'picked', body[1])(fixture.api, value => labels.push(value.text), value => actions.push(value), ['friend']);
  assert.deepEqual(fixture.sounds, ['ui.confirm']); assert.deepEqual(fixture.haptics, ['selection']);
  assert.equal(fixture.confetti, 0); assert.deepEqual(labels, ['تم الاختيار']);
  assert.deepEqual(actions, [{ type: 'PICK', playerIds: ['friend'] }]);
});

test('Jabeen passing a card remains a pass rather than an incorrect answer', () => {
  const body = source('jabeen').match(/const answer = \(ok\) => \{([\s\S]*?)\n  \};/);
  assert.ok(body);
  const execute = new Function('ok', 'api', 'landscape', 'timer', 'setFlash', 'flashTimer', 'clearTimeout', 'setTimeout', 'wait', 'stampScreen', 'drawForTurn', 'dispatch', body[1]);
  for (const ok of [false, true]) {
    const fixture = apiFixture(), actions = [];
    execute(ok, fixture.api, true, { running: true }, () => {}, { current: null }, () => {}, () => 0, value => value, () => {}, () => ({ item: 'next', recycled: false }), value => actions.push(value));
    assert.deepEqual(fixture.sounds, [ok ? 'game.correct' : 'game.pass']);
    assert.deepEqual(actions, [{ type: 'ANSWER', ok, item: 'next', recycled: false }]);
  }
});

test('question playback acquires silence even if already playing, and releasing one media owner preserves another', () => {
  const source = readFileSync(new URL('../src/games/badeeha/media.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const effect = source.match(/useEffect\(\(\) => \{\n(\s*if \(!element\) return undefined;\n\s*let ducking = false;[\s\S]*?)\n\s*\}, \[element, sound\]\);/);
  assert.ok(effect);
  const execute = new Function('element', 'sound', effect[1]);
  const effects = new Set(), music = new Set(), external = Symbol('recording');
  const update = (set, active, owner) => active ? set.add(owner) : set.delete(owner);
  const sound = { setSuppressed: (active, owner) => update(effects, active, owner), setDucking() {}, music: { setSuppressed: (active, owner) => update(music, active, owner) } };
  sound.setSuppressed(true, external); sound.music.setSuppressed(true, external);
  const element = () => Object.assign(new EventTarget(), { paused: false, ended: false, pause() { this.paused = true; this.dispatchEvent(new Event('pause')); } });
  const a = element(), b = element(), endA = execute(a, sound), endB = execute(b, sound);
  assert.equal(effects.size, 3); assert.equal(music.size, 3);
  a.pause(); assert.equal(effects.size, 2); assert.equal(music.size, 2);
  b.dispatchEvent(new Event('error'));
  assert.deepEqual([...effects], [external]); assert.deepEqual([...music], [external]);
  endA(); endB();
  assert.deepEqual([...effects], [external]); assert.deepEqual([...music], [external]);
});
