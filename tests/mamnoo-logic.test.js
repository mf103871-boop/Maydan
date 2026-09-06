import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, currentTeam, standings, createCardSource, normalizeOptions, MAX_SKIPS } from '../src/games/mamnoo/logic.js';
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
