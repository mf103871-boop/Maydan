import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, currentVoter, standings, createStatementSource, normalizeOptions, tallyVotes, titleFor, statementsLabel, TITLES, DEFAULT_TITLE, restoreSession, sessionSnapshot } from '../src/games/meenfina/logic.js';
import { seeded } from './helpers.js';

const players = [
  { id: 'a', name: 'أحمد', emoji: '🦁' },
  { id: 'b', name: 'سارة', emoji: '🐼' },
  { id: 'c', name: 'ليان', emoji: '🦊' },
];
const statements = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, text: `مين فينا ${i}؟`, tag: i % 2 ? 'نوم' : 'ضحك' }));

test('الخيارات', () => {
  assert.deepEqual(normalizeOptions(null), { mode: 'point', rounds: 8 });
  assert.equal(normalizeOptions({ mode: 'x', rounds: 6 }).mode, 'point');
  assert.equal(normalizeOptions({ mode: 'secret', rounds: 12 }).rounds, 12);
});

test('وضع «أشّر»: عدّ تنازلي ثم اختيار، والتعادل يُسجَّل للجميع', () => {
  const src = createStatementSource(statements, { random: seeded(1) });
  let s = initialState(players, { mode: 'point', rounds: 5 });
  s = reduce(s, { type: 'BEGIN', statement: src.next() });
  assert.equal(s.phase, 'countdown');
  s = reduce(s, { type: 'COUNTDOWN_DONE' });
  assert.equal(s.phase, 'pick');
  s = reduce(s, { type: 'PICK', playerIds: ['a'] });
  assert.equal(s.scores.a, 1);
  assert.equal(s.phase, 'result');
  s = reduce(s, { type: 'NEXT' });
  s = reduce(s, { type: 'BEGIN', statement: src.next() });
  s = reduce(s, { type: 'COUNTDOWN_DONE' });
  s = reduce(s, { type: 'PICK', playerIds: ['b', 'c'] });
  assert.equal(s.scores.b, 1);
  assert.equal(s.scores.c, 1, 'التعادل يُسجَّل للاثنين');
  assert.deepEqual(s.winners, ['b', 'c']);
});

test('«لا أحد تنطبق عليه» لا يعطي نقاطًا، والمعرّفات غير الموجودة تُهمل', () => {
  let s = initialState(players, { mode: 'point' });
  s = reduce(s, { type: 'BEGIN', statement: statements[0] });
  s = reduce(s, { type: 'COUNTDOWN_DONE' });
  const before = s;
  assert.equal(reduce(s, { type: 'PICK', playerIds: ['zzz'] }), before, 'لاعب غير موجود');
  assert.equal(reduce(s, { type: 'PICK', playerIds: [] }), before, 'اختيار فارغ');
  s = reduce(s, { type: 'SKIP_STATEMENT' });
  assert.equal(s.phase, 'result');
  assert.deepEqual(s.winners, []);
  assert.deepEqual(s.scores, { a: 0, b: 0, c: 0 });
});

test('التصويت السري: كل لاعب بدوره، ثم الفرز والفائز', () => {
  const src = createStatementSource(statements, { random: seeded(2) });
  let s = initialState(players, { mode: 'secret', rounds: 5 });
  s = reduce(s, { type: 'BEGIN', statement: src.next() });
  assert.equal(s.phase, 'vote');
  assert.equal(currentVoter(s).id, 'a');
  s = reduce(s, { type: 'VOTE', targetId: 'b' });
  assert.equal(currentVoter(s).id, 'b');
  s = reduce(s, { type: 'VOTE', targetId: 'b' });
  s = reduce(s, { type: 'VOTE', targetId: 'a' });
  assert.equal(s.phase, 'result');
  const { counts, winners, max } = tallyVotes(s);
  assert.deepEqual(counts, { b: 2, a: 1 });
  assert.equal(max, 2);
  assert.deepEqual(winners, ['b']);
  assert.equal(s.scores.b, 1);
  assert.equal(s.scores.a, 0);
});

test('الألقاب تُشتق من أكثر وسم فاز به اللاعب', () => {
  let s = initialState(players, { mode: 'point', rounds: 12 });
  const play = (statement, winner) => {
    s = reduce(s, { type: 'BEGIN', statement });
    s = reduce(s, { type: 'COUNTDOWN_DONE' });
    s = reduce(s, { type: 'PICK', playerIds: [winner] });
    s = reduce(s, { type: 'NEXT' });
  };
  play({ id: 'x1', text: 'ن1', tag: 'نوم' }, 'a');
  play({ id: 'x2', text: 'ن2', tag: 'نوم' }, 'a');
  play({ id: 'x3', text: 'ض1', tag: 'ضحك' }, 'a');
  play({ id: 'x4', text: 'ط1', tag: 'وسم-غير-معروف' }, 'b');
  assert.equal(titleFor(s, 'a'), TITLES['نوم'], 'أكثر وسم');
  assert.equal(titleFor(s, 'b'), DEFAULT_TITLE, 'وسم غير معروف → لقب افتراضي');
  assert.equal(titleFor(s, 'c'), null, 'بلا فوز = بلا لقب');
  assert.equal(standings(s)[0].id, 'a');
  assert.equal(standings(s)[0].title, TITLES['نوم']);
});

test('اللعبة تنتهي بعد آخر عبارة، ونفاد العبارات ينهيها أيضًا', () => {
  let s = initialState(players, { mode: 'point', rounds: 5 });
  for (let i = 0; i < 5; i += 1) {
    s = reduce(s, { type: 'BEGIN', statement: statements[i] });
    s = reduce(s, { type: 'COUNTDOWN_DONE' });
    s = reduce(s, { type: 'PICK', playerIds: ['a'] });
    s = reduce(s, { type: 'NEXT' });
  }
  assert.equal(s.phase, 'over');
  assert.equal(s.scores.a, 5);
  assert.equal(reduce(initialState(players, {}), { type: 'BEGIN', statement: null }).phase, 'over');
});

test('عدد العبارات يُصاغ بجمع القلة 3–10 وإفراد ما بعدها', () => {
  assert.equal(statementsLabel(5), '5 عبارات');
  assert.equal(statementsLabel(8), '8 عبارات');
  assert.equal(statementsLabel(10), '10 عبارات');
  assert.equal(statementsLabel(12), '12 عبارة');
  assert.equal(statementsLabel(1), 'عبارة واحدة');
  assert.equal(statementsLabel(2), 'عبارتان');
});

test('الجلسة المحفوظة (مين فينا؟): كل مرحلة تعود كما هي، والمنتهية والتالفة تُرفض', () => {
  const people = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `لاعب ${i}`, emoji: '🦁', color: '#123' }));
  const pool = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, text: `مين فينا ${i}؟`, tag: 'sleepy' }));
  const source = createStatementSource(pool, { random: seeded(5) });
  const settings = { mode: 'secret', rounds: 5 };
  let s = initialState(people, settings);
  const snap = (state) => sessionSnapshot({ players: people, settings, seed: 5, cursor: source.cursor, profileSession: 'ps', state });
  const check = (state) => { const r = restoreSession(JSON.parse(JSON.stringify(snap(state)))); assert.ok(r, `restore ${state.phase}`); assert.deepEqual(r.state, JSON.parse(JSON.stringify(state))); assert.equal(r.profileSession, 'ps'); };
  check(s);
  s = reduce(s, { type: 'BEGIN', statement: source.next() }); check(s);
  s = reduce(s, { type: 'VOTE', targetId: 'p1' }); s = reduce(s, { type: 'VOTE', targetId: 'p1' }); check(s);
  s = reduce(s, { type: 'VOTE', targetId: 'p2' }); s = reduce(s, { type: 'VOTE', targetId: 'p1' }); check(s);
  assert.equal(s.phase, 'result'); assert.deepEqual(s.winners, ['p1']);
  s = reduce(s, { type: 'NEXT' }); check(s);
  assert.equal(restoreSession(snap(reduce(s, { type: 'END' }))), null, 'المنتهية لا تُستأنف');
  const base = JSON.parse(JSON.stringify(snap(s)));
  const broken = [
    (r) => { r.game = 'jabeen'; }, (r) => { r.players = r.players.slice(0, 2); }, (r) => { r.settings.mode = 'point'; },
    (r) => { r.state.phase = 'vote'; r.state.statement = null; }, (r) => { r.state.voter = 4; }, (r) => { r.state.votes = { p0: 'zz' }; },
    (r) => { r.state.winners = ['zz']; }, (r) => { r.state.scores.p0 = -1; }, (r) => { r.state.tags.p0 = { sleepy: 'x' }; }, (r) => { r.state.tags.zz = {}; },
    (r) => { r.state.round = 0; }, (r) => { r.cursor = -1; }, (r) => { r.seed = 1.5; },
  ];
  for (const change of broken) { const r = structuredClone(base); change(r); assert.equal(restoreSession(r), null); }
});
