import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../server/ersomha-model.mjs';
import { connected } from '../server/game-model.mjs';
import { buildErsomhaChoices } from '../server/ersomha-content.mjs';

const people = Array.from({ length: 9 }, (_, n) => ({ id: `seat-${n}`, tokenHash: `secret-${n}`, name: `لاعب ${n}`, avatar: n % 4, settings: {} }));
const rejects = (code, fn) => assert.throws(fn, e => e.code === code);
function lobby(size = 3, settings = {}) {
  const room = game.createRoom('123456', { ...people[0], settings }, 1000);
  for (let n = 1; n < size; n++) game.joinRoom(room, people[n], 1000);
  for (const m of room.members) { connected(room, m.id, true, 1010); m.ready = true; m.accountUserId = `account-${m.id}`; }
  return room;
}
function command(room, id, type, fields = {}, at = 1100) { game.action(room, id, { type, matchId: room.matchId, round: room.round, ...fields }, at); }
function started(size = 3, settings = {}) {
  const room = lobby(size, settings); command(room, 'seat-0', 'start');
  game.setErsomhaChoices(room, buildErsomhaChoices({ difficulty: 'medium' }), 1100); return room;
}
function drawing(size = 3, settings = {}) {
  const room = started(size, settings); command(room, room.draw.drawerId, 'select_word', { choiceId: room.draw.choices[0].id }, 1200); return room;
}

test('settings, eight-seat capacity and automatic two-player cooperation are server enforced', () => {
  rejects('INVALID', () => lobby(3, { cycles: 3 }));
  rejects('INVALID', () => lobby(3, { drawSeconds: 90 }));
  rejects('INVALID', () => lobby(3, { categories: ['animals', 'nature'] }));
  const full = lobby(8); rejects('FULL_ERSOMHA', () => game.joinRoom(full, people[8], 1100));
  const duo = started(2); assert.equal(duo.settings.mode, 'cooperative'); assert.equal(duo.rounds, 2);
  assert.equal(started(3).settings.mode, 'competitive');
  rejects('NOT_READY_DUO', () => command(lobby(1), 'seat-0', 'start'));
  const room = lobby(3); room.members[1].ready = false; rejects('NOT_READY_DUO', () => command(room, 'seat-0', 'start'));
});
test('only the drawer receives choices/word, never future answers, aliases or account identifiers', () => {
  const room = started(); const choices = room.draw.choices;
  assert.equal(game.snapshot(room, 'seat-0', 1100).myChoices.length, 3);
  for (const id of ['seat-1', 'seat-2']) {
    const json = JSON.stringify(game.snapshot(room, id, 1100));
    for (const secret of choices.flatMap(c => [c.answer, c.conceptId, c.familyId, ...c.aliases])) assert.equal(json.includes(secret), false, secret);
    assert.equal(json.includes('tokenHash'), false); assert.equal(json.includes('account-seat'), false);
  }
  command(room, 'seat-0', 'select_word', { choiceId: choices[0].id }, 1200);
  assert.equal(game.snapshot(room, 'seat-0', 1300).myWord, choices[0].answer);
  assert.equal(game.snapshot(room, 'seat-1', 1300).myWord, null);
  assert.equal(game.snapshot(room, 'seat-0', 1300).myChoices.length, 0);
  rejects('ERSOMHA_DRAWER_ONLY', () => command(room, 'seat-1', 'select_word', { choiceId: choices[1].id }, 1300));
  rejects('ERSOMHA_GUESSER_ONLY', () => command(room, 'seat-0', 'guess', { text: choices[0].answer }, 1300));
});
test('correct guesses are redacted and scoring uses ten-second time buckets without first-arrival bonus', () => {
  const room = drawing(), answer = room.draw.word.answer;
  command(room, 'seat-1', 'guess', { text: answer }, 1200 + 9_999);
  assert.equal(room.scores['seat-1'], 0, 'points stay provisional until a valid turn completes');
  assert.equal(game.snapshot(room, 'seat-2', 1200 + 9_999).recentGuesses[0].text, null);
  command(room, 'seat-2', 'guess', { text: answer }, 1200 + 10_000);
  assert.equal(room.phase, 'result'); assert.equal(room.scores['seat-1'], 150); assert.equal(room.scores['seat-2'], 140); assert.equal(room.scores['seat-0'], 100);
  assert.equal(game.snapshot(room, 'seat-2', 12_000).revealedWord, answer);
  game.tick(room, 12_001); assert.equal(room.scores['seat-1'], 150, 'ticks never score a turn twice');
});
test('guesses are short, moderated, bounded and limited separately from drawing traffic', () => {
  const room = drawing();
  rejects('ANSWER', () => command(room, 'seat-1', 'guess', { text: 'س'.repeat(61) }, 1300));
  rejects('ANSWER', () => command(room, 'seat-1', 'guess', { text: '\u202Eس' }, 1300));
  for (let n = 0; n < 5; n++) command(room, 'seat-1', 'guess', { text: 'تخمين آخر' }, 1400 + n);
  rejects('RATE_LIMIT', () => command(room, 'seat-1', 'guess', { text: 'شيء آخر' }, 1500));
  rejects('STALE', () => command(room, 'seat-2', 'guess', { text: 'شيء آخر', round: 99 }, 1500));
});
test('hints reveal letter counts at thirty seconds and only one letter at forty-five active seconds', () => {
  const room = drawing(); game.tick(room, 1200 + 29_999); assert.deepEqual(room.draw.hints, []);
  assert.deepEqual(game.snapshot(room, 'seat-1', 31_199).publicWord.wordLengths, []);
  assert.equal(game.snapshot(room, 'seat-1', 1300).category, room.draw.word.category);
  game.tick(room, 1200 + 30_000); assert.equal(room.draw.hints.length, 0); assert.ok(game.snapshot(room, 'seat-1', 31_200).publicWord.wordLengths.length > 0);
  game.tick(room, 1200 + 45_000); assert.equal(room.draw.hints.length, 1);
  assert.ok(room.draw.hints.length < Array.from(room.draw.word.answer.replace(/\s/g, '')).length);
});
test('one fifteen-second disconnect pause freezes time and a second interruption cancels provisional scores', () => {
  const room = drawing(); const answer = room.draw.word.answer;
  command(room, 'seat-1', 'guess', { text: answer }, 2200);
  connected(room, 'seat-0', false, 3200);
  assert.equal(room.draw.pauseUntil, 18_200); assert.equal(room.deadlineAt, null);
  rejects('PHASE', () => command(room, 'seat-2', 'guess', { text: answer }, 3300));
  connected(room, 'seat-0', true, 8200); assert.equal(room.deadlineAt, 66_200); assert.equal(room.draw.pausedMs, 5000);
  connected(room, 'seat-0', false, 9200);
  assert.equal(room.phase, 'result'); assert.equal(room.draw.cancelled, 'drawer_disconnected');
  assert.equal(room.scores['seat-1'], 0); assert.equal(room.scores['seat-0'], 0);
});
test('an expired drawer grace cancels the turn, while disconnected players cannot extend it indefinitely', () => {
  const room = drawing(); connected(room, 'seat-0', false, 2000);
  game.tick(room, 16_999); assert.equal(room.phase, 'draw');
  game.tick(room, 17_000); assert.equal(room.phase, 'result'); assert.equal(room.draw.cancelled, 'drawer_disconnected');
});
test('drawer ratio freezes eligible seats and leaving cannot turn a partial solve into a perfect score', () => {
  const room = drawing(4), answer = room.draw.word.answer;
  command(room, 'seat-1', 'guess', { text: answer }, 1400); game.leaveRoom(room, 'seat-3', 1500);
  command(room, 'seat-2', 'guess', { text: answer }, 1600);
  assert.equal(room.draw.eligible.length, 3); assert.equal(room.scores['seat-0'], 67);
  const competitive = drawing(3); game.leaveRoom(competitive, 'seat-2', 1300);
  assert.equal(competitive.phase, 'over'); assert.equal(competitive.reason, 'players_left'); assert.equal(competitive.settings.mode, 'competitive');
});
test('automatic selection/reveal advances fair drawer rotation across two cycles without host delay', () => {
  const room = started(2, { cycles: 2 }); const drawers = [];
  for (let round = 1; round <= 4; round++) {
    if (!room.draw.choices.length) game.setErsomhaChoices(room, buildErsomhaChoices({ difficulty: 'medium' }), round * 100_000);
    drawers.push(room.draw.drawerId); const at = room.deadlineAt;
    game.tick(room, at); assert.equal(room.phase, 'draw'); assert.equal(room.draw.word.id, room.draw.choices[0].id);
    game.tick(room, room.deadlineAt); assert.equal(room.phase, 'result');
    rejects('PHASE', () => command(room, room.hostId, 'next', {}, room.deadlineAt - 1));
    game.tick(room, room.deadlineAt); assert.equal(room.phase, round === 4 ? 'over' : 'select');
  }
  assert.deepEqual(drawers, ['seat-0', 'seat-1', 'seat-0', 'seat-1']);
});
test('cooperative results count solutions and remaining active drawing time without inventing individual winners', () => {
  const room = drawing(2); command(room, 'seat-1', 'guess', { text: room.draw.word.answer }, 11_200);
  const state = game.snapshot(room, 'seat-1', 12_000);
  assert.deepEqual(state.cooperative, { solvedTurns: 1, completedTurns: 1, totalTurns: 2, remainingMs: 50_000 });
});
test('Arabic vowel marks and decorative tatweel never create extra letter slots or count as revealed letters', () => {
  const room = drawing(); room.draw.word.answer = 'قطة تخاف خيارًا';
  game.tick(room, 31_200); assert.deepEqual(game.snapshot(room, 'seat-1', 31_200).publicWord.wordLengths, [3, 4, 5]);
  game.tick(room, 46_200); assert.equal(/[\p{M}\u0640]/u.test(room.draw.hints[0].char), false);
});
