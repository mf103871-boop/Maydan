import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, currentTeam, standings, createCardSource, normalizeOptions, restoreSession, sessionSnapshot, MAX_SKIPS } from '../src/games/mamnoo/logic.js';
import { seeded } from './helpers.js';

const teams = [{ id: 't1', name: 'الصقور', color: '#111' }, { id: 't2', name: 'النمور', color: '#222' }];
const cards = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, word: `كلمة${i}`, forbidden: ['أ', 'ب', 'ج', 'د', 'هـ'], category: 'x', difficulty: 1 }));

test('الخيارات', () => {
  assert.deepEqual(normalizeOptions({ seconds: 50 }), { seconds: 60, rounds: 3 });
  assert.equal(normalizeOptions({ seconds: 90, rounds: 4 }).rounds, 4);
});

test('جولة كاملة: صح +1، ممنوع −1، تخطي ≤ 3، ثم تبادل الفرق وانتهاء بعد الجولات', () => {
  const src = createCardSource(cards, { random: seeded(1) });
  let s = initialState(teams, { seconds: 60, rounds: 2 });
  s = reduce(s, { type: 'BEGIN', card: src.next() });
  assert.equal(s.phase, 'play');
  s = reduce(s, { type: 'CORRECT', card: src.next() });
  s = reduce(s, { type: 'CORRECT', card: src.next() });
  s = reduce(s, { type: 'BUZZ', card: src.next() });
  assert.equal(s.scores.t1, 1);
  for (let i = 0; i < MAX_SKIPS + 2; i += 1) s = reduce(s, { type: 'SKIP', card: src.next() });
  assert.equal(s.skipsLeft, 0);
  assert.equal(s.tally.skip, MAX_SKIPS, 'التخطي لا يتجاوز الحد');
  s = reduce(s, { type: 'TIME_UP' });
  assert.equal(s.phase, 'roundEnd');
  s = reduce(s, { type: 'NEXT' });
  assert.equal(currentTeam(s).id, 't2');
  assert.equal(s.round, 1);
  // الفريق الثاني يلعب جولته ثم الجولة الثانية لكليهما
  const play = (n) => { s = reduce(s, { type: 'BEGIN', card: src.next() }); for (let i = 0; i < n; i += 1) s = reduce(s, { type: 'CORRECT', card: src.next() }); s = reduce(s, { type: 'TIME_UP' }); s = reduce(s, { type: 'NEXT' }); };
  play(3);
  assert.equal(s.round, 2);
  assert.equal(currentTeam(s).id, 't1');
  play(2); play(1);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.scores, { t1: 3, t2: 4 });
  assert.equal(standings(s)[0].id, 't2');
  assert.equal(new Set(s.log.map((l) => l.cardId)).size, s.log.length, 'لا بطاقة مكررة');
});

test('نفاد البطاقات ينهي الجولة، وأفعال خارج مرحلتها تُهمل', () => {
  let s = initialState(teams, {});
  s = reduce(s, { type: 'BEGIN', card: cards[0] });
  s = reduce(s, { type: 'CORRECT', card: null });
  assert.equal(s.phase, 'roundEnd');
  assert.equal(reduce(s, { type: 'CORRECT', card: cards[1] }), s);
  assert.equal(reduce(initialState(teams, {}), { type: 'BEGIN', card: null }).phase, 'over');
});

test('الجلسة المحفوظة: لقطة الحالة تعود كما هي في كل مرحلة، والتالف يُرفض بدل أن يُسقط الشاشة', () => {
  const source = createCardSource(cards, { random: seeded(3) });
  let s = initialState(teams, { seconds: 60, rounds: 2 });
  const snap = (state, extra = {}) => sessionSnapshot({ teams, settings: { seconds: 60, rounds: 2 }, seed: 3, cursor: source.cursor, timeLeft: null, profileSession: null, state, ...extra });
  const check = (state) => {
    const restored = restoreSession(JSON.parse(JSON.stringify(snap(state))));
    assert.ok(restored, `restore ${state.phase}`);
    assert.deepEqual(restored.state, JSON.parse(JSON.stringify(state)), 'الحقول غير المعرَّفة (emoji) تسقط في JSON فقط');
    assert.deepEqual(restored.settings, { seconds: 60, rounds: 2 });
  };
  check(s);
  s = reduce(s, { type: 'BEGIN', card: source.next() }); check(s);
  s = reduce(s, { type: 'CORRECT', card: source.next() }); s = reduce(s, { type: 'BUZZ', card: source.next() }); check(s);
  assert.equal(s.scores.t1, 0, 'ممنوع يخصم؛ الخريطة تقبل الأعداد السالبة');
  s = reduce(s, { type: 'BUZZ', card: source.next() }); assert.equal(s.scores.t1, -1); check(s);
  s = reduce(s, { type: 'TIME_UP' }); check(s);
  assert.ok(restoreSession(snap(s, { timeLeft: 12.5 })), 'وقت متبقٍ صالح');
  const over = reduce(reduce(reduce(reduce(s, { type: 'NEXT' }), { type: 'BEGIN', card: source.next() }), { type: 'TIME_UP' }), { type: 'END' });
  assert.equal(restoreSession(snap(over)), null, 'المباراة المنتهية لا تُستأنف');
  const base = JSON.parse(JSON.stringify(snap(s)));
  const broken = [
    (r) => { r.schemaVersion = 2; }, (r) => { r.game = 'beep'; }, (r) => { r.seed = -1; }, (r) => { r.cursor = 'x'; }, (r) => { r.timeLeft = -3; },
    (r) => { r.teams = [{}, {}]; }, (r) => { r.state.teams[0].name = 7; }, (r) => { r.settings = { seconds: 45, rounds: 2 }; },
    (r) => { r.state.phase = 'oops'; }, (r) => { r.state.scores = { t1: 0 }; }, (r) => { r.state.scores.t1 = 1.5; }, (r) => { r.state.turn = 2; },
    (r) => { r.state.round = 3; }, (r) => { r.state.skipsLeft = MAX_SKIPS + 1; }, (r) => { r.state.tally = null; }, (r) => { r.state.log.push({ teamId: 'zz' }); },
    (r) => { r.state.phase = 'play'; r.state.card = null; }, (r) => { r.state.card = { id: 'c1' }; }, (r) => { r.state.completed = 'no'; },
  ];
  for (const change of broken) { const r = structuredClone(base); change(r); assert.equal(restoreSession(r), null); }
  assert.equal(restoreSession(null), null); assert.equal(restoreSession('x'), null);
});
