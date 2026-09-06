import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, currentEntrant, standings, createItemSource, normalizeOptions, tiltDecision, isNeutral, TILT_DOWN, TILT_UP } from '../src/games/jabeen/logic.js';
import { seeded } from './helpers.js';

const players = [{ id: 'a', name: 'أحمد', emoji: '🦁' }, { id: 'b', name: 'سارة', emoji: '🐼' }];
const category = { id: 'animals', name: 'حيوانات', icon: '🦁', items: Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, text: `حيوان${i}` })) };
const cats = [category, { id: 'food', name: 'أكلات', icon: '🍲', items: [{ id: 'f1', text: 'كبسة' }] }];

test('الخيارات تُطبَّع وتقع على فئة موجودة', () => {
  assert.deepEqual(normalizeOptions(null, cats), { seconds: 60, categoryId: 'animals', control: 'auto' });
  assert.equal(normalizeOptions({ categoryId: 'nope' }, cats).categoryId, 'animals');
  assert.equal(normalizeOptions({ categoryId: 'food', seconds: 90, control: 'touch' }, cats).categoryId, 'food');
  assert.equal(normalizeOptions({ control: 'x' }, cats).control, 'auto');
});

test('قرار الإمالة: أسفل=صح، أعلى=تخطي، والمهلة تمنع التكرار حتى العودة للحياد', () => {
  assert.equal(tiltDecision(TILT_DOWN + 5, true), 'correct');
  assert.equal(tiltDecision(TILT_UP - 5, true), 'skip');
  assert.equal(tiltDecision(10, true), null, 'المنطقة المحايدة لا تقرر');
  assert.equal(tiltDecision(TILT_DOWN + 5, false), null, 'غير مسلَّح');
  assert.equal(tiltDecision(NaN, true), null);
  assert.equal(tiltDecision(undefined, true), null);
  assert.ok(isNeutral(15));
  assert.ok(!isNeutral(TILT_DOWN + 1));
  assert.ok(!isNeutral(TILT_UP - 1));
});

test('جولة: إجابات ثم مراجعة قابلة للتصحيح ثم النقاط', () => {
  const src = createItemSource(category, { random: seeded(1) });
  let s = initialState(players, category, { seconds: 60, control: 'touch' });
  s = reduce(s, { type: 'BEGIN', item: src.next() });
  assert.equal(s.phase, 'play');
  s = reduce(s, { type: 'ANSWER', ok: true, item: src.next() });
  s = reduce(s, { type: 'ANSWER', ok: false, item: src.next() });
  s = reduce(s, { type: 'ANSWER', ok: true, item: src.next() });
  assert.equal(s.results.length, 3);
  s = reduce(s, { type: 'TIME_UP' });
  assert.equal(s.phase, 'review');
  s = reduce(s, { type: 'TOGGLE_RESULT', index: 1 });
  assert.equal(s.results[1].ok, true, 'التصحيح اليدوي يعمل');
  s = reduce(s, { type: 'CONFIRM' });
  assert.equal(s.scores.a, 3);
  assert.equal(s.phase, 'intro');
  assert.equal(currentEntrant(s).id, 'b');
  // دور اللاعب الثاني ثم النهاية
  s = reduce(s, { type: 'BEGIN', item: src.next() });
  s = reduce(s, { type: 'ANSWER', ok: true, item: null });
  assert.equal(s.phase, 'review', 'نفاد الكلمات ينقل إلى المراجعة');
  s = reduce(s, { type: 'CONFIRM' });
  assert.equal(s.phase, 'over');
  assert.deepEqual(standings(s).map((x) => x.id), ['a', 'b']);
  assert.equal(s.log.length, 2);
});

test('لا تكرار للكلمات داخل الجولة', () => {
  const src = createItemSource(category, { random: seeded(4) });
  const ids = [];
  let item;
  while ((item = src.next())) ids.push(item.id);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
});

test('أفعال خارج مرحلتها تُهمل، ونفاد الكلمات من البداية ينهي اللعبة', () => {
  const s = initialState(players, category, { seconds: 60 });
  assert.equal(reduce(s, { type: 'ANSWER', ok: true }), s);
  assert.equal(reduce(s, { type: 'CONFIRM' }), s);
  assert.equal(reduce(s, { type: 'BEGIN', item: null }).phase, 'over');
});
