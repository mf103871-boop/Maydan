// انحدارات «فبركة» المؤكَّدة: دمج الإجابات الرقمية/النصية، الإشارة بالأرقام العربية،
// اللقطات المحفوظة بطور لا يناسب النمط، حقن الاسم في نص السؤال، ومغادرة صاحب الدور.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, reduce, currentActor, turnKey, restoreSession, sameAnswer, matchesTruth, numericValue, fillName, bestLies, TRUTH_ID } from '../src/games/fabraka/logic.js';
import * as game from '../server/game-model.mjs';

const players = [
  { id: 'a', name: 'أحمد', emoji: '🦁' },
  { id: 'b', name: 'سارة', emoji: '🐼' },
  { id: 'c', name: 'ليان', emoji: '🦊' },
];
const deck = (answer = '78', text = 'نسبة النيتروجين في الهواء ___ بالمئة.') =>
  Array.from({ length: 24 }, (_, i) => ({ id: `q${i}`, factId: `q${i}`, text, answer, aliases: [], decoys: ['11', '13', '17', '19'], explanation: 'شرح', category: 'x', curious: true, kind: 'text' }));
const make = (options = {}, cards = deck(), people = players) =>
  initialState(people, { rounds: 3, writeSeconds: 0, discussionSeconds: 0, ...options }, { deck: cards, seed: 42, sessionId: 'regression' });
const go = (s, type, extra = {}) => reduce(s, { type, round: s.round, key: turnKey(s), playerId: currentActor(s)?.id, ...extra });
function writeAll(s, texts) {
  s = go(s, 'START_WRITING');
  for (const text of texts) { s = go(s, 'READY'); s = go(s, 'DRAFT', { text }); s = go(s, 'SUBMIT_LIE'); }
  return s;
}

test('1 — a number on one side only still merges through the normalised text comparison', () => {
  for (const [a, b] of [['78%', '78'], ['٧٨٪', '78'], ['78.', '78'], ['(78)', '78'], ['٧٨٫٥', '78.5'], ['«القاهرة»', 'القاهرة']]) {
    assert.equal(sameAnswer(a, b), true, `${a} / ${b}`);
    assert.equal(sameAnswer(b, a), true, `${b} / ${a}`);
  }
  for (const [a, b] of [['8', '80'], ['8', 'ثمانية أرجل'], ['78', '87'], ['5', 'خمسة أمتار'], ['1.3', '13']]) {
    assert.equal(sameAnswer(a, b), false, `${a} / ${b}`);
    assert.equal(sameAnswer(b, a), false, `${b} / ${a}`);
  }
  assert.equal(matchesTruth('٧٨٪', { answer: '78' }), true);
  // الأثر في اللعب: «٧٨٪» تُحسب حقيقة ولا تظهر خيارًا إضافيًا يفضح الإجابة.
  const s = writeAll(go(make(), 'BEGIN'), ['٧٨٪', '11', '13']);
  assert.deepEqual(s.truthWriters, ['a']);
  assert.equal(s.options.filter((o) => sameAnswer(o.text, '78')).length, 1);
  assert.equal(s.options.filter((o) => o.id === TRUTH_ID).length, 1);
});

test('2 — a written sign in front of Arabic-Indic digits is still a number', () => {
  assert.equal(numericValue('ناقص ٥'), -5);
  assert.equal(numericValue('سالب ٥'), -5);
  assert.equal(numericValue('ناقص 5'), -5);
  assert.equal(numericValue('سالب خمسة'), -5);
  assert.equal(numericValue('ناقص'), null);
  assert.equal(sameAnswer('ناقص ٥', '-5'), true);
  assert.equal(sameAnswer('سالب ٥', '-5'), true);
  assert.equal(sameAnswer('ناقص ٥', '5'), false);
});

test('3 — a saved truth-owner phase outside «أصحابنا» is rejected, not resumed into a crash', () => {
  const started = go(make(), 'BEGIN');
  assert.equal(started.phase, 'question');
  assert.ok(restoreSession(structuredClone(started)));
  const forged = structuredClone(started);
  forged.phase = 'host';
  assert.equal(currentActor(forged), undefined, 'currentActor has nobody to point at');
  assert.equal(restoreSession(forged), null);
  const friends = go(make({ mode: 'friends' }, deck('', 'وجبة {name} المفضّلة ___.')), 'BEGIN');
  assert.equal(friends.phase, 'host');
  assert.ok(restoreSession(structuredClone(friends)), 'the friends mode keeps its own host phase');
});

test('4 — a player name containing $ cannot rewrite the question for everyone', () => {
  const template = 'وجبة {name} المفضّلة ___.';
  const name = '$`X$&$\'$$';
  assert.equal(fillName(template, name), `وجبة ${name} المفضّلة ___.`);
  const people = [{ id: 'a', name }, players[1], players[2]];
  const s = go(make({ mode: 'friends' }, deck('', template), people), 'BEGIN');
  assert.equal(s.hostId, 'a');
  assert.equal(s.question.text, `وجبة ${name} المفضّلة ___.`);
  const skipped = go(go(s, 'READY'), 'SKIP_PROMPT');
  assert.equal(skipped.question.text, `وجبة ${name} المفضّلة ___.`);
});

test('4 — the server injects the same name literally', () => {
  const now = 1000;
  const name = '$`X$&$\'$$';
  const card = { id: 'friend', factId: 'friend', kind: 'friend', text: 'وجبة {name} المفضّلة ___.', answer: '', aliases: [], decoys: ['أ', 'ب', 'ج'], explanation: 'شرح' };
  const people = Array.from({ length: 3 }, (_, n) => ({ id: String(n + 1).padStart(32, '0'), tokenHash: String(n + 1).repeat(64), name: n ? `لاعب ${n}` : name, avatar: n }));
  const room = game.createRoom('123456', { ...people[0], game: 'fabraka', settings: { mode: 'friends', rounds: 3, writeSeconds: 0, discussionSeconds: 0 } }, now);
  for (const p of people.slice(1)) game.joinRoom(room, p, now);
  for (const p of people) { game.connected(room, p.id, true, now); game.action(room, p.id, { type: 'ready', matchId: room.matchId, round: room.round, ready: true }, now); }
  const cards = Array.from({ length: 12 }, (_, i) => ({ ...card, id: `friend-${i}`, factId: `friend-${i}` }));
  game.action(room, people[0].id, { type: 'start', matchId: room.matchId, round: room.round }, now, cards);
  assert.equal(room.phase, 'host');
  assert.equal(game.snapshot(room, people[1].id, now).question.text, `وجبة ${name} المفضّلة ___.`);
  game.action(room, people[0].id, { type: 'skip_prompt', matchId: room.matchId, round: room.round }, now);
  assert.equal(game.snapshot(room, people[1].id, now).question.text, `وجبة ${name} المفضّلة ___.`);
});

test('5 — a player who leaves «أصحابنا» hands their turns back instead of leaving dead rounds', () => {
  let now = 1000;
  const card = { id: 'friend', factId: 'friend', kind: 'friend', text: 'وجبة {name} المفضّلة ___.', answer: '', aliases: [], decoys: ['أ', 'ب', 'ج'], explanation: 'شرح' };
  const people = Array.from({ length: 4 }, (_, n) => ({ id: String(n + 1).padStart(32, '0'), tokenHash: String(n + 1).repeat(64), name: `لاعب ${n + 1}`, avatar: n }));
  const room = game.createRoom('123456', { ...people[0], game: 'fabraka', settings: { mode: 'friends', rounds: 3, writeSeconds: 0, discussionSeconds: 0, funnyVote: false } }, now);
  for (const p of people.slice(1)) game.joinRoom(room, p, now);
  for (const p of people) { game.connected(room, p.id, true, now); game.action(room, p.id, { type: 'ready', matchId: room.matchId, round: room.round, ready: true }, now); }
  const cards = Array.from({ length: 16 }, (_, i) => ({ ...card, id: `friend-${i}`, factId: `friend-${i}` }));
  const act = (n, type, fields = {}) => game.action(room, people[n].id, { type, matchId: room.matchId, round: room.round, ...fields }, now, cards);
  act(0, 'start');
  assert.equal(room.rounds, 4);
  assert.equal(room.fab.truthHostId, people[0].id);
  // اللاعب الرابع يغادر قبل دوره: يخرج من المشاركين ويقل عدد الجولات بدل أن يبقى دورًا ميتًا.
  game.leaveRoom(room, people[3].id, now);
  assert.equal(room.phase, 'host');
  assert.deepEqual(room.participants, people.slice(0, 3).map((p) => p.id));
  assert.equal(room.rounds, 3);
  const owners = [];
  for (let round = 1; round <= 3; round++) {
    assert.equal(room.round, round);
    assert.equal(room.phase, 'host', `round ${round} starts with a present owner`);
    assert.equal(room.fab.aborted, null);
    owners.push(room.fab.truthHostId);
    const owner = people.findIndex((p) => p.id === room.fab.truthHostId);
    act(owner, 'truth', { text: `حقيقة ${round}` });
    for (const n of [0, 1, 2].filter((n) => n !== owner)) act(n, 'lie', { text: `كذبة ${n}` });
    for (const n of [0, 1, 2].filter((n) => n !== owner)) act(n, 'vote', { optionId: room.fab.options.find((o) => o.truth).id });
    while (room.phase === 'reveal') act(0, room.fab.groupShown ? 'next_reveal' : 'reveal');
    assert.equal(room.phase, 'result');
    act(0, 'next');
    now += 1;
  }
  assert.equal(room.phase, 'over');
  assert.deepEqual(owners, people.slice(0, 3).map((p) => p.id), 'every remaining player owned exactly one round');
});

test('10 — memorable lies carry the round answer so the blank can be filled', () => {
  let s = writeAll(go(make(), 'BEGIN'), ['11', '13', '17']);
  const choice = { a: TRUTH_ID, b: 'lie-a', c: 'lie-a' };
  while (s.phase === 'vote') { s = go(s, 'READY'); s = go(s, 'VOTE', { optionId: choice[currentActor(s).id], funnyId: null }); }
  s = go(s, 'START_REVEAL');
  while (s.phase === 'reveal') { s = go(s, 'REVEAL'); s = go(s, 'REVEAL_NEXT'); }
  const best = bestLies(s)[0];
  assert.equal(best.text, '11');
  assert.equal(best.answer, '78');
  assert.ok(best.question.includes('___'));
});

test('every rebuilt topic stays playable and retired questions cannot return through previous IDs', () => {
  const questions = JSON.parse(readFileSync('src/data/games/fabraka/questions.json', 'utf8'));
  const personal = JSON.parse(readFileSync('src/data/games/fabraka/personal.json', 'utf8'));
  for (const category of new Set(questions.map((q) => q.category))) {
    const curious = questions.filter((q) => q.category === category && q.curious).length;
    assert.ok(curious >= 3, `${category}: ${curious} غرائب فقط`);
  }
  for (const question of questions) {
    assert.match(question.id, /^fab3-/);
    assert.deepEqual(question.previousIds || [], [], 'new bank cannot revive a retired question');
  }
  for (const q of questions) assert.equal(q.text.replace('___', ' ').includes(q.answer), false, q.id);
  // القوالب الشخصية جُمَل اسمية: لا فعل مذكّر ملتصق بـ{name}.
  for (const item of personal) {
    assert.ok(item.text.includes('{name}'), item.id);
    assert.doesNotMatch(item.text, /(^|\s)(لو|إذا)\s+[يفت]?\p{Script=Arabic}+\s*\{name\}/u, item.id);
  }
});
