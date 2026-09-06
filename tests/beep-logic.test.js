import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, currentPlayer, standings, createPromptSource, normalizeOptions, LIVES, BOMB_RANGE } from '../src/games/beep/logic.js';
import { seeded } from './helpers.js';

const players = [
  { id: 'a', name: 'أحمد', emoji: '🦁', color: '#111' },
  { id: 'b', name: 'سارة', emoji: '🐼', color: '#222' },
  { id: 'c', name: 'ليان', emoji: '🦊', color: '#333' },
];
const prompts = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, text: `اذكر 3 أشياء ${i}`, difficulty: (i % 3) + 1, category: 'x' }));

test('الخيارات تُطبَّع إلى القيم المدعومة', () => {
  assert.deepEqual(normalizeOptions(null), { mode: 'three', seconds: 5, rounds: 5 });
  assert.deepEqual(normalizeOptions({ mode: 'x', seconds: 9, rounds: 4 }), { mode: 'three', seconds: 5, rounds: 5 });
  assert.equal(normalizeOptions({ mode: 'bomb', seconds: 10 }).seconds, 10);
});

test('مصدر الطلبات: لا تكرار، والصعوبة تتصاعد مع الجولات', () => {
  const src = createPromptSource(prompts, { random: seeded(3) });
  const ids = new Set();
  const levels = [];
  for (let r = 1; r <= 3; r += 1) for (let k = 0; k < 10; k += 1) { const p = src.next(r, 3); ids.add(p.id); levels.push(p.difficulty); }
  assert.equal(ids.size, 30);
  assert.equal(src.next(1, 3), null, 'نفد');
  assert.ok(levels.slice(0, 10).every((l) => l === 1), 'الجولة الأولى سهلة');
  assert.ok(levels.slice(10, 20).every((l) => l === 2));
  assert.ok(levels.slice(20).every((l) => l === 3));
});

test('مصدر الطلبات يقدّم غير المعروض سابقًا أولًا', () => {
  const seen = Object.fromEntries(prompts.filter((p) => p.difficulty === 1).slice(0, 8).map((p) => [p.id, 1]));
  const src = createPromptSource(prompts, { random: seeded(5), seen });
  const first = [src.next(1, 3), src.next(1, 3)];
  assert.ok(first.every((p) => !seen[p.id]));
});

test('وضع «3 قبل الصفارة»: الأدوار تدور، النقاط تُحسب، وتنتهي بعد الجولات', () => {
  let s = initialState(players, { mode: 'three', seconds: 5, rounds: 3 }, { random: seeded(1) });
  assert.equal(s.phase, 'intro');
  let n = 0;
  const src = createPromptSource(prompts, { random: seeded(2) });
  while (s.phase !== 'over') {
    assert.ok(n < 100, 'حلقة لا تنتهي');
    s = reduce(s, { type: 'BEGIN', prompt: src.next(s.round, s.rounds) });
    assert.equal(s.phase, 'prompt');
    s = reduce(s, { type: 'FINISH', timedOut: n % 2 === 0 });
    assert.equal(s.phase, 'judge');
    s = reduce(s, { type: 'JUDGE', ok: currentPlayer(s).id !== 'c' });
    n += 1;
  }
  assert.equal(n, 9, '3 لاعبين × 3 جولات');
  assert.deepEqual(s.scores, { a: 3, b: 3, c: 0 });
  const st = standings(s);
  assert.equal(st[2].id, 'c');
  assert.equal(s.history.length, 9);
});

test('أفعال في غير مرحلتها لا تغيّر الحالة', () => {
  const s = initialState(players, { mode: 'three' }, { random: seeded(1) });
  assert.equal(reduce(s, { type: 'JUDGE', ok: true }), s);
  assert.equal(reduce(s, { type: 'PASS' }), s);
  assert.equal(reduce(s, { type: 'EXPLODE' }), s);
  assert.equal(reduce(s, { type: 'nope' }), s);
});

test('وضع القنبلة: مؤقت مخفي ضمن المدى، الأرواح تنقص، والإقصاء يتخطى الخارجين', () => {
  let s = initialState(players, { mode: 'bomb' }, { random: seeded(9) });
  assert.ok(s.bombSeconds >= BOMB_RANGE[0] && s.bombSeconds <= BOMB_RANGE[1]);
  const src = createPromptSource(prompts, { random: seeded(2) });
  // يمرّر الجوال حتى يصل إلى اللاعب المطلوب (ويُشغّل القنبلة إن كنا في intro)
  const routeTo = (state, id) => {
    let x = state.phase === 'intro' ? reduce(state, { type: 'BEGIN', prompt: src.next() }) : state;
    let guard = 0;
    while (currentPlayer(x).id !== id) { x = reduce(x, { type: 'PASS', prompt: src.next() }); assert.ok((guard += 1) < 20); }
    return x;
  };
  s = routeTo(s, 'a');
  s = reduce(s, { type: 'PASS', prompt: src.next() });
  assert.equal(currentPlayer(s).id, 'b');
  assert.equal(s.passes.a, 1);
  // انفجار بيد b ثلاث مرات → يخرج
  for (let i = 0; i < 3; i += 1) {
    s = routeTo(s, 'b');
    s = reduce(s, { type: 'EXPLODE' });
    assert.equal(s.lives.b, LIVES - 1 - i);
    assert.equal(s.phase, 'boom');
    assert.equal(s.boomPlayerId, 'b');
    s = reduce(s, { type: 'CONTINUE', bombSeconds: 33 });
    assert.equal(s.bombSeconds, 33);
    assert.equal(s.phase, 'intro');
  }
  assert.ok(s.eliminated.includes('b'));
  assert.notEqual(currentPlayer(s).id, 'b', 'الدور يتخطى الخارج');
  // إخراج لاعب ثانٍ يترك واحدًا → over
  s = routeTo(s, 'c');
  for (let i = 0; i < 2; i += 1) { s = reduce(s, { type: 'EXPLODE' }); s = reduce(s, { type: 'CONTINUE', bombSeconds: 25 }); s = routeTo(s, 'c'); }
  s = reduce(s, { type: 'EXPLODE' });
  assert.equal(s.phase, 'over');
  const st = standings(s);
  assert.equal(st[0].id, 'a');
  assert.equal(st[0].alive, true);
  assert.equal(st[st.length - 1].id, 'b', 'أول خارج آخر الترتيب');
});

test('نفاد الطلبات ينهي اللعبة بدل التعطل', () => {
  let s = initialState(players, { mode: 'three', rounds: 3 }, { random: seeded(1) });
  s = reduce(s, { type: 'BEGIN', prompt: null });
  assert.equal(s.phase, 'over');
});
