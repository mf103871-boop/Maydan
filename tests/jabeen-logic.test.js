import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, currentEntrant, standings, createItemSource, normalizeOptions, tiltDecision, isNeutral, orientedTilt, TILT_DOWN, TILT_UP } from '../src/games/jabeen/logic.js';
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
  assert.ok(isNeutral(0), 'الجوال المستوي وضعٌ محايد يُسلِّح القرار التالي');
  assert.ok(isNeutral(-5), 'المدى المحايد يشمل ما دون الصفر قليلًا');
  assert.ok(!isNeutral(TILT_DOWN + 1));
  assert.ok(!isNeutral(TILT_UP - 1));
  assert.ok(!isNeutral(NaN));
});

test('زاوية الإمالة تُصحَّح بحسب دوران الشاشة: beta رأسيًا وgamma أفقيًا', () => {
  // الحركة نفسها (الجوال على الجبين ثم يُمال للأسفل) بأربع وضعيات شاشة:
  assert.equal(orientedTilt({ beta: 60, gamma: 4 }, 0), 60, 'رأسي: beta');
  assert.equal(orientedTilt({ beta: 3, gamma: -60 }, 90), 60, 'أفقي: -gamma');
  assert.equal(orientedTilt({ beta: 3, gamma: 60 }, 270), 60, 'أفقي معكوس: +gamma');
  assert.equal(orientedTilt({ beta: 3, gamma: 60 }, -90), 60, 'window.orientation = -90 مثل 270');
  assert.equal(orientedTilt({ beta: -60, gamma: 2 }, 180), 60, 'رأسي مقلوب: -beta');
  // beta في الوضع الأفقي هي التي كانت تقفز بين 0 و±180 فتعطي قرارًا عشوائيًا
  assert.equal(tiltDecision(orientedTilt({ beta: 179, gamma: -60 }, 90), true), 'correct');
  assert.equal(tiltDecision(orientedTilt({ beta: -179, gamma: -60 }, 90), true), 'correct', 'إشارة beta لم تعد تقلب القرار');
  assert.equal(tiltDecision(orientedTilt({ beta: 0, gamma: 55 }, 90), true), 'skip');
  assert.ok(!Number.isFinite(orientedTilt({ beta: null, gamma: null }, 0)));
  assert.ok(!Number.isFinite(orientedTilt(null, 0)));
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

test('أفعال خارج مرحلتها تُهمل، ونفاد الكلمات من البداية لا ينهي اللعبة قبل الجميع', () => {
  const s = initialState(players, category, { seconds: 60 });
  assert.equal(reduce(s, { type: 'ANSWER', ok: true }), s);
  assert.equal(reduce(s, { type: 'CONFIRM' }), s);
  // بلا كلمة يبدأ الدور فارغًا وينتهي بالمراجعة، فيأتي دور اللاعب التالي
  // بدل القفز إلى شاشة النتائج وإسقاط بقية اللاعبين.
  let next = reduce(s, { type: 'BEGIN', item: null });
  assert.equal(next.phase, 'review');
  assert.deepEqual(next.results, []);
  next = reduce(next, { type: 'CONFIRM' });
  assert.equal(next.phase, 'intro');
  assert.equal(currentEntrant(next).id, 'b', 'اللاعب الثاني ما زال له دور');
});

test('علم «أُعيد الخلط» ينتقل مع البداية ويبقى حتى نهاية المباراة', () => {
  let s = initialState(players, category, { seconds: 60 });
  assert.equal(s.recycled, false);
  s = reduce(s, { type: 'BEGIN', item: { id: 'i1', text: 'أسد' }, recycled: true });
  assert.equal(s.recycled, true);
  s = reduce(s, { type: 'TIME_UP' });
  s = reduce(s, { type: 'CONFIRM' });
  s = reduce(s, { type: 'BEGIN', item: { id: 'i2', text: 'نمر' } });
  assert.equal(s.recycled, true, 'لا يُنسى بعد أول دور');
});
