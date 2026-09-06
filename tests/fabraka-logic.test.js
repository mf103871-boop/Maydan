import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, currentWriter, currentVoter, standings, createQuestionSource, normalizeOptions, validateLie, scoreRound, votersFor, TRUTH_ID, POINTS_TRUTH, POINTS_FOOLED } from '../src/games/fabraka/logic.js';
import { seeded } from './helpers.js';

const players = [
  { id: 'a', name: 'أحمد', emoji: '🦁' },
  { id: 'b', name: 'سارة', emoji: '🐼' },
  { id: 'c', name: 'ليان', emoji: '🦊' },
];
const questions = Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, text: `حقيقة رقم ${i} هي ___ وحدة.`, answer: `${i * 3}`, explanation: 'شرح', category: 'x' }));

test('الخيارات', () => {
  assert.equal(normalizeOptions({ rounds: 4 }).rounds, 3);
  assert.equal(normalizeOptions({ rounds: 7 }).rounds, 7);
});

test('رفض الإجابة الفارغة والمطابقة للحقيقة أو لإجابة لاعب آخر (بعد التطبيع)', () => {
  const ctx = { truth: 'القاهرة', taken: ['دمشق'] };
  assert.equal(validateLie('', ctx).ok, false);
  assert.equal(validateLie('   ', ctx).ok, false);
  assert.equal(validateLie('القاهرة', ctx).ok, false, 'الحقيقة نفسها');
  assert.equal(validateLie('  قاهره ', ctx).ok, false, 'الحقيقة بعد التطبيع');
  assert.equal(validateLie('دمشق', ctx).ok, false, 'مكررة');
  assert.equal(validateLie('دِمَشق', ctx).ok, false, 'مكررة بعد التشكيل');
  assert.equal(validateLie('x'.repeat(61), ctx).ok, false, 'طويلة');
  const ok = validateLie('  بغداد   الجديدة ', ctx);
  assert.equal(ok.ok, true);
  assert.equal(ok.text, 'بغداد الجديدة', 'تُنظَّف المسافات');
});

test('جولة كاملة: كتابة سرية، خلط مع الحقيقة، تصويت، كشف، ثم نقاط', () => {
  const src = createQuestionSource(questions, { random: seeded(2) });
  let s = initialState(players, { rounds: 3 });
  assert.equal(s.rounds, 3, 'rounds تُطبَّع إلى قيمة مدعومة');
  s = reduce(s, { type: 'BEGIN', question: src.next() });
  assert.equal(s.phase, 'write');
  assert.equal(currentWriter(s).id, 'a');
  s = reduce(s, { type: 'SUBMIT_LIE', text: 'كذبة-أ', random: seeded(1) });
  assert.equal(currentWriter(s).id, 'b');
  s = reduce(s, { type: 'SUBMIT_LIE', text: 'كذبة-ب', random: seeded(1) });
  s = reduce(s, { type: 'SUBMIT_LIE', text: 'كذبة-ج', random: seeded(1) });
  assert.equal(s.phase, 'vote');
  assert.equal(s.options.length, 4, '3 أكاذيب + الحقيقة');
  assert.equal(s.options.filter((o) => o.id === TRUTH_ID).length, 1);
  assert.equal(new Set(s.options.map((o) => o.id)).size, 4);
  // أ يصوّت للحقيقة، ب يصوّت لكذبة أ، ج يصوّت لكذبة أ
  s = reduce(s, { type: 'VOTE', optionId: TRUTH_ID });
  assert.equal(currentVoter(s).id, 'b');
  s = reduce(s, { type: 'VOTE', optionId: 'a' });
  s = reduce(s, { type: 'VOTE', optionId: 'a' });
  assert.equal(s.phase, 'reveal');
  const round = scoreRound(s);
  assert.equal(round.a, POINTS_TRUTH + POINTS_FOOLED * 2, 'أصاب الحقيقة وخدع اثنين');
  assert.equal(round.b, 0);
  assert.equal(round.c, 0);
  assert.deepEqual(votersFor(s, 'a').map((p) => p.id), ['b', 'c']);
  // الكشف واحدة واحدة: كل الخيارات تُكشف، وهي أكثر من اللاعبين بواحد (الحقيقة)
  const optionCount = s.options.length;
  assert.equal(optionCount, players.length + 1);
  for (let i = 0; i < optionCount - 1; i += 1) {
    s = reduce(s, { type: 'REVEAL_NEXT' });
    assert.equal(s.phase, 'reveal', `ما زال الكشف جاريًا عند ${i + 1}`);
    assert.equal(s.revealIndex, i + 1);
  }
  s = reduce(s, { type: 'REVEAL_NEXT' });
  assert.equal(s.phase, 'roundEnd', 'ينتهي الكشف بعد آخر خيار لا قبله');
  assert.equal(s.scores.a, POINTS_TRUTH + POINTS_FOOLED * 2);
  s = reduce(s, { type: 'NEXT_ROUND' });
  assert.equal(s.phase, 'intro', 'بقيت جولتان');
  assert.equal(s.round, 2);
  // الجولتان الباقيتان بلا نقاط إضافية، ثم تنتهي اللعبة بعد الجولة الأخيرة
  for (const round of [2, 3]) {
    s = reduce(s, { type: 'BEGIN', question: src.next() });
    ['ك1', 'ك2', 'ك3'].forEach((t) => { s = reduce(s, { type: 'SUBMIT_LIE', text: t, random: seeded(1) }); });
    s = reduce(s, { type: 'VOTE', optionId: 'b' });
    s = reduce(s, { type: 'VOTE', optionId: 'c' });
    s = reduce(s, { type: 'VOTE', optionId: 'a' });
    for (let i = 0; i < s.options.length; i += 1) s = reduce(s, { type: 'REVEAL_NEXT' });
    assert.equal(s.phase, 'roundEnd', `نهاية الجولة ${round}`);
    s = reduce(s, { type: 'NEXT_ROUND' });
  }
  assert.equal(s.phase, 'over', 'انتهت بعد الجولة الثالثة');
  assert.equal(standings(s)[0].id, 'a');
});

test('اللاعب لا يستطيع اختيار إجابته، وعدة جولات تتراكم', () => {
  const src = createQuestionSource(questions, { random: seeded(3) });
  let s = initialState(players, { rounds: 3 });
  s = reduce(s, { type: 'BEGIN', question: src.next() });
  ['ك-أ', 'ك-ب', 'ك-ج'].forEach((t) => { s = reduce(s, { type: 'SUBMIT_LIE', text: t, random: seeded(1) }); });
  const before = s;
  s = reduce(s, { type: 'VOTE', optionId: 'a' });
  assert.equal(s, before, 'أ لا يختار إجابته');
  s = reduce(s, { type: 'VOTE', optionId: TRUTH_ID });
  s = reduce(s, { type: 'VOTE', optionId: TRUTH_ID });
  s = reduce(s, { type: 'VOTE', optionId: TRUTH_ID });
  for (let i = 0; i < 4; i += 1) s = reduce(s, { type: 'REVEAL_NEXT' });
  assert.equal(s.phase, 'roundEnd');
  assert.deepEqual(s.scores, { a: POINTS_TRUTH, b: POINTS_TRUTH, c: POINTS_TRUTH });
  s = reduce(s, { type: 'NEXT_ROUND' });
  assert.equal(s.phase, 'intro');
  assert.equal(s.round, 2);
  assert.equal(s.lies.length, 0, 'الجولة الجديدة تبدأ نظيفة');
  assert.equal(s.options.length, 0);
});

test('لا تكرار للأسئلة، وأفعال خارج مرحلتها تُهمل، ونفاد الأسئلة ينهي اللعبة', () => {
  const src = createQuestionSource(questions, { random: seeded(7) });
  const ids = new Set();
  for (let i = 0; i < 12; i += 1) ids.add(src.next().id);
  assert.equal(ids.size, 12);
  assert.equal(src.next(), null);
  const s = initialState(players, {});
  assert.equal(reduce(s, { type: 'VOTE', optionId: 'a' }), s);
  assert.equal(reduce(s, { type: 'REVEAL_NEXT' }), s);
  assert.equal(reduce(s, { type: 'BEGIN', question: null }).phase, 'over');
});
