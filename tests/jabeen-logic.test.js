import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, currentEntrant, standings, createItemSource, normalizeOptions, tiltDecision, isNeutral, orientedTilt, tiltBaseline, restoreSession, sessionSnapshot, TILT_DOWN, TILT_UP, TILT_BASELINE_SAMPLES, TILT_BASELINE_MAX } from '../src/games/jabeen/logic.js';
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

test('المعايرة: القرار بالفرق عن وضع الجبين، والأساس وسيط العينات ويُرفض إن كان الميل الابتدائي كبيرًا', () => {
  // هاتف على الجبين بميل طبيعي 25°: بالزوايا المطلقة كان 25° خارج المدى المحايد فلا يُسلَّح القرار.
  const samples = [24, 26, 25, 80, 25, 24];
  assert.equal(tiltBaseline(samples), 25, 'الوسيط يتجاهل القراءة الشاذة 80');
  assert.equal(tiltBaseline(samples.slice(0, TILT_BASELINE_SAMPLES - 1)), null, 'عينات أقل من اللازم لا تُعاير');
  assert.equal(tiltBaseline([70, 71, 72, 70, 71, 72]), 0, `ميل أكبر من ${TILT_BASELINE_MAX}° عند البداية ليس وضع جبين`);
  assert.ok(isNeutral(25, 25), 'وضع الجبين نفسه محايد بعد المعايرة');
  assert.ok(isNeutral(35, 25));
  assert.equal(tiltDecision(25 + TILT_DOWN, true, 25), 'correct');
  assert.equal(tiltDecision(25 + TILT_UP, true, 25), 'skip');
  assert.equal(tiltDecision(25 + TILT_DOWN - 1, true, 25), null, 'هستيرة: دون العتبة لا قرار');
  assert.equal(tiltDecision(TILT_DOWN + 5, true), 'correct', 'بلا أساس تبقى الزوايا مطلقة كما كانت');
  assert.equal(tiltDecision(TILT_DOWN + 5, true, NaN), 'correct', 'أساس غير صالح يعامَل صفرًا');
});

test('الجلسة المحفوظة (على جبينك): الدور والنتائج والفئة تعود كما هي، والتالف يُرفض', () => {
  const people = [{ id: 'a', name: 'أحمد', emoji: '🦁' }, { id: 'b', name: 'سارة', emoji: '🐼' }];
  const cats = [{ id: 'home', name: 'البيت', icon: '🏠', items: Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, text: `كلمة ${i}` })) }];
  const settings = normalizeOptions({ seconds: 45, categoryId: 'home', control: 'touch' }, cats);
  const source = createItemSource(cats[0], { random: seeded(9) });
  let s = initialState(people, cats[0], settings);
  const snap = (state, extra = {}) => sessionSnapshot({ players: people, settings, seed: 9, cursor: source.cursor, timeLeft: null, profileSession: null, state, ...extra });
  const check = (state) => { const r = restoreSession(JSON.parse(JSON.stringify(snap(state))), cats); assert.ok(r, `restore ${state.phase}`); assert.deepEqual(r.state, JSON.parse(JSON.stringify(state))); };
  check(s);
  s = reduce(s, { type: 'BEGIN', item: source.next() }); check(s);
  s = reduce(s, { type: 'ANSWER', ok: true, item: source.next() }); s = reduce(s, { type: 'ANSWER', ok: false, item: source.next() }); check(s);
  assert.ok(restoreSession(snap(s, { timeLeft: 30 }), cats));
  s = reduce(s, { type: 'TIME_UP' }); check(s);
  s = reduce(s, { type: 'CONFIRM' }); check(s); assert.equal(s.turn, 1);
  assert.equal(restoreSession(snap(reduce(s, { type: 'END' })), cats), null, 'المنتهية لا تُستأنف');
  assert.equal(restoreSession(snap(s), []), null, 'فئة لم تعد موجودة في المحتوى');
  const base = JSON.parse(JSON.stringify(snap(s)));
  const broken = [
    (r) => { r.game = 'beep'; }, (r) => { r.settings.categoryId = 'zz'; }, (r) => { r.settings.seconds = 90; }, (r) => { r.state.turn = 2; },
    (r) => { r.state.phase = 'play'; r.state.item = null; }, (r) => { r.state.item = { id: 1 }; }, (r) => { r.state.results = [{ itemId: 'x' }]; },
    (r) => { r.state.log.push({ entrantId: 'zz', correct: 1, total: 1 }); }, (r) => { r.state.scores = { a: 1 }; }, (r) => { r.state.recycled = 'yes'; },
    (r) => { r.players = [r.players[0]]; }, (r) => { r.timeLeft = 9999; }, (r) => { r.cursor = 2.5; },
  ];
  for (const change of broken) { const r = structuredClone(base); change(r); assert.equal(restoreSession(r, cats), null); }
});
