// اختبارات انحدار للعيوب التي أُصلحت في «على جبينك» و«مين فينا؟».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  initialState as jabeenInitial, reduce as jabeenReduce, createItemSource, currentEntrant, standings as jabeenStandings,
  tiltDecision, isNeutral, orientedTilt, TILT_DOWN, TILT_UP, TILT_NEUTRAL,
} from '../src/games/jabeen/logic.js';
import {
  initialState as meenInitial, reduce as meenReduce, standings as meenStandings, titleFor,
  statementsLabel, TITLES, DEFAULT_TITLE, ROUNDS,
} from '../src/games/meenfina/logic.js';
import { seeded } from './helpers.js';

const read = (p) => JSON.parse(readFileSync(path.resolve('src/data/games', p), 'utf8'));
const statements = read('meenfina/statements.json');
const home = read('jabeen/home.json');

// ————— «على جبينك» —————

test('انحدار: فئة صغيرة وعشرة لاعبين — لا أحد يخرج بصفر لأن الكلمات نفدت', () => {
  const entrants = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `لاعب ${i}`, emoji: '🦁' }));
  const source = createItemSource(home, { random: seeded(7) });
  assert.ok(home.items.length < entrants.length * 10, 'الفئة أصغر من أن تكفي عشرة أدوار كاملة');

  // نفس ما تفعله Game.jsx: عند نفاد الفئة تُعاد دورتها بدل إنهاء المباراة.
  const drawForTurn = () => {
    let item = source.next();
    let recycled = false;
    if (!item) { source.reset(); recycled = true; item = source.next(); }
    return { item, recycled };
  };

  let state = jabeenInitial(entrants, home, { seconds: 60, control: 'touch' });
  const played = [];
  for (let turn = 0; turn < entrants.length; turn += 1) {
    assert.equal(state.phase, 'intro', `الدور ${turn} يجب أن يبدأ`);
    played.push(currentEntrant(state).id);
    const draw = drawForTurn();
    assert.ok(draw.item, 'لا بد من كلمة لكل دور بعد إعادة الخلط');
    state = jabeenReduce(state, { type: 'BEGIN', item: draw.item, recycled: draw.recycled });
    assert.equal(state.phase, 'play');
    for (let i = 0; i < 6; i += 1) {
      if (state.phase !== 'play') break;
      state = jabeenReduce(state, { type: 'ANSWER', ok: true, item: source.next() });
    }
    if (state.phase === 'play') state = jabeenReduce(state, { type: 'TIME_UP' });
    assert.equal(state.phase, 'review');
    state = jabeenReduce(state, { type: 'CONFIRM' });
  }
  assert.equal(state.phase, 'over', 'المباراة تنتهي بعد آخر لاعب لا قبله');
  assert.deepEqual(played, entrants.map((e) => e.id), 'كل لاعب أخذ دوره');
  assert.equal(state.log.length, entrants.length);
  assert.ok(jabeenStandings(state).every((p) => p.score > 0), 'لا لاعب بصفر لأنه لم يلعب');
  assert.equal(state.recycled, true, 'اللاعبون يُخبَرون أن الكلمات أُعيد خلطها');
});

test('انحدار: حركة واحدة في الوضع الأفقي تعطي القرار نفسه مهما كان ميل beta', () => {
  // «أَمِل للأسفل» أفقيًا: gamma هي التي تتحرك، وbeta تقفز بين 0 و±180.
  const down = [
    { beta: 0.4, gamma: -70 }, { beta: 179.6, gamma: -70 }, { beta: -179.6, gamma: -70 },
  ];
  for (const event of down) {
    assert.equal(tiltDecision(orientedTilt(event, 90), true), 'correct', JSON.stringify(event));
    assert.equal(tiltDecision(orientedTilt({ beta: event.beta, gamma: 70 }, 270), true), 'correct');
  }
  const up = { beta: 0.2, gamma: 40 };
  assert.equal(tiltDecision(orientedTilt(up, 90), true), 'skip');
  assert.equal(tiltDecision(orientedTilt({ beta: up.beta, gamma: -40 }, 270), true), 'skip');
  // ولا قرار ما دام الجهاز في المدى المحايد (وهو يشمل الصفر)
  assert.ok(isNeutral(orientedTilt({ beta: 90, gamma: 0 }, 90)), 'الصفر محايد');
  assert.equal(tiltDecision(orientedTilt({ beta: 90, gamma: 0 }, 90), true), null);
  assert.ok(TILT_NEUTRAL[0] < 0 && TILT_NEUTRAL[1] > 0, 'المدى المحايد يحيط بالصفر');
  assert.ok(TILT_UP < TILT_NEUTRAL[0] && TILT_DOWN > TILT_NEUTRAL[1], 'بين المحايد والعتبات هامش');
});

test('انحدار: لا قرار قبل أول قراءة محايدة (يبدأ غير مسلَّح)', () => {
  // ما يفعله useTilt: armed يبدأ false ولا يصير true إلا بقراءة محايدة.
  let armed = false;
  const feed = (event, angle) => {
    const a = orientedTilt(event, angle);
    if (isNeutral(a)) { armed = true; return null; }
    const decision = tiltDecision(a, armed);
    if (decision) armed = false;
    return decision;
  };
  assert.equal(feed({ beta: 2, gamma: -80 }, 90), null, 'الجهاز مائل أصلًا عند بدء الجولة');
  assert.equal(feed({ beta: 2, gamma: -5 }, 90), null, 'قراءة محايدة تُسلّح');
  assert.equal(feed({ beta: 2, gamma: -80 }, 90), 'correct');
  assert.equal(feed({ beta: 2, gamma: -80 }, 90), null, 'لا تكرار قبل العودة للحياد');
});

// ————— «مين فينا؟» —————

test('انحدار: كل وسم في العبارات له لقب، وكل لقب في الجدول تمنحه عبارة', () => {
  const used = new Set(statements.map((s) => s.tag));
  const missing = [...used].filter((tag) => !TITLES[tag]).sort();
  assert.deepEqual(missing, [], `وسوم بلا لقب (ستنال «${DEFAULT_TITLE}»): ${missing.join('، ')}`);
  const unused = Object.keys(TITLES).filter((tag) => !used.has(tag)).sort();
  assert.deepEqual(unused, [], `ألقاب لا يمكن نيلها لأن لا عبارة تحمل وسمها: ${unused.join('، ')}`);
  assert.equal(new Set(Object.values(TITLES)).size, Object.keys(TITLES).length, 'لقب مكرر');
  assert.ok(!Object.values(TITLES).includes(DEFAULT_TITLE), 'اللقب الافتراضي ليس لقب وسم');
});

test('انحدار: كل عبارة في الملف تمنح لقبًا حقيقيًا لا «نجم الجلسة»', () => {
  const players = [{ id: 'a', name: 'أحمد', emoji: '🦁' }, { id: 'b', name: 'سارة', emoji: '🐼' }];
  const generic = [];
  for (const statement of statements) {
    let s = meenInitial(players, { mode: 'point', rounds: 12 });
    s = meenReduce(s, { type: 'BEGIN', statement });
    s = meenReduce(s, { type: 'COUNTDOWN_DONE' });
    s = meenReduce(s, { type: 'PICK', playerIds: ['a'] });
    const title = titleFor(s, 'a');
    if (!title || title === DEFAULT_TITLE) generic.push(`${statement.id} (${statement.tag})`);
    assert.equal(meenStandings(s)[0].title, title);
  }
  assert.deepEqual(generic, [], `عبارات تنتهي باللقب العام: ${generic.slice(0, 5).join('، ')}`);
});

test('انحدار: أزرار عدد العبارات بصيغة عربية سليمة', () => {
  assert.deepEqual(ROUNDS.map(statementsLabel), ['5 عبارات', '8 عبارات', '12 عبارة']);
});
