// بَديهة أونلاين: الغرفة تحفظ معرّفات الأسئلة وحالة اللعب فقط (الدور، النقاط، الوسائل)،
// والمضيف يقدّم ويحكم كما في اللعبة على جهاز واحد.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../server/game-model.mjs';
import { prepareRoomStats } from '../server/room-stats.mjs';
import { BADEEHA_PROTOCOL } from '../src/online/shared.js';
import { pointsAfterHints } from '../src/games/badeeha/logic.js';

const CATS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
function deckOf(roundSize = 20, tiers = [200, 400, 600, 800]) {
  const deck = Object.fromEntries(CATS.map((id) => [id, []]));
  for (let n = 0; n < roundSize; n++) { const id = CATS[n % 6]; deck[id].push({ qid: `${id}-${tiers[deck[id].length % tiers.length]}-9${n}`, p: tiers[deck[id].length % tiers.length] }); }
  return deck;
}
const settings = (extra = {}) => ({ mode: 'standard', roundSize: 20, timer: 60, categories: CATS, deck: deckOf(), ...extra });
const error = (code) => (e) => e.code === code;
function fixture(count = 3, extra = {}) {
  let now = 1000;
  const teams = Array.from({ length: count }, (_, n) => ({ id: String(n + 1).padStart(32, '0'), tokenHash: String(n + 1).repeat(64), name: `فريق ${n + 1}`, avatar: n % 4 }));
  const room = game.createRoom('123456', { ...teams[0], game: 'badeeha', settings: settings(extra) }, now);
  for (const team of teams.slice(1)) game.joinRoom(room, team, now);
  const act = (n, type, fields = {}) => game.action(room, teams[n].id, { type, matchId: room.matchId, round: room.round, ...fields }, now);
  for (const [n, team] of teams.entries()) { game.connected(room, team.id, true, now); act(n, 'ready', { ready: true }); }
  const view = (n = 0) => game.snapshot(room, teams[n].id, now);
  const turnIndex = () => teams.findIndex((t) => t.id === room.participants[room.turn]);
  const firstOpen = () => { for (const id of CATS) { const index = room.settings.deck[id].findIndex((c) => !room.used[c.qid]); if (index >= 0) return { categoryId: id, index }; } return null; };
  return { room, teams, act, view, turnIndex, firstOpen, time: (value) => { now = value; }, now: () => now };
}

test('settings carry exactly six categories and a deck of question IDs that matches the mode and size', () => {
  const host = { id: '1'.repeat(32), tokenHash: '2'.repeat(64), name: 'المضيف', avatar: 0 };
  const make = (value) => game.createRoom('123456', { ...host, game: 'badeeha', settings: value }, 1000);
  assert.equal(make(settings()).settings.roundSize, 20);
  assert.throws(() => make(settings({ categories: CATS.slice(0, 5) })), error('QUESTIONS'));
  assert.throws(() => make(settings({ roundSize: 30 })), error('QUESTIONS'), 'size must match the deck');
  assert.throws(() => make(settings({ mode: 'family' })), error('QUESTIONS'), '800 is not a family tier');
  assert.throws(() => make(settings({ timer: 45 })), error('INVALID'));
  const duplicate = deckOf(); duplicate.c2[0] = { ...duplicate.c1[0] };
  assert.throws(() => make(settings({ deck: duplicate })), error('QUESTIONS'));
  const hostile = deckOf(); hostile.c1[0] = { qid: '<script>', p: 200 };
  assert.throws(() => make(settings({ deck: hostile })), error('QUESTIONS'));
  const room = make(settings());
  assert.deepEqual(Object.keys(room.settings.deck.c1[0]), ['qid', 'p'], 'only IDs and points are stored');
});

test('two to four ready teams start; the turn team or the host opens a cell, nobody else', () => {
  const lone = fixture(1);
  assert.throws(() => lone.act(0, 'start'), error('NOT_READY_BADEEHA'));
  const { room, act, view, turnIndex, firstOpen } = fixture(3);
  act(0, 'start');
  assert.equal(room.phase, 'board'); assert.equal(room.round, 1); assert.equal(view().protocol, BADEEHA_PROTOCOL);
  assert.equal(view().turnId, room.participants[0]);
  assert.throws(() => act(1, 'open', firstOpen()), error('TURN'));
  act(turnIndex(), 'open', firstOpen());
  assert.equal(room.phase, 'question'); assert.equal(room.deadlineAt, 1000 + 60_000);
  assert.throws(() => act(0, 'open', firstOpen()), error('PHASE'));
});

test('aids belong to the turn team once per match: double, two answers and thirty more seconds', () => {
  const { room, act, turnIndex, firstOpen, teams } = fixture(2);
  act(0, 'start'); act(0, 'open', firstOpen());
  assert.throws(() => act(1, 'tool', { tool: 'double' }), error('TURN'));
  act(0, 'tool', { tool: 'double' }); act(0, 'tool', { tool: 'two' }); act(0, 'tool', { tool: 'time' });
  assert.deepEqual(room.effect, { double: true, two: true }); assert.equal(room.deadlineAt, 1000 + 90_000);
  assert.throws(() => act(0, 'tool', { tool: 'double' }), error('TOOL_USED'));
  assert.throws(() => act(0, 'tool', { tool: 'magic' }), error('INVALID'));
  // The judged double pays twice the cell.
  act(0, 'reveal'); act(0, 'judge', { teamId: teams[0].id });
  assert.equal(room.scores[teams[0].id], room.verdict.points);
  assert.equal(room.verdict.points, 2 * room.settings.deck.c1[0].p);
  assert.equal(turnIndex(), 1, 'the turn passes on');
});

test('the host judges after the reveal: a steal earns the base points, hints cost a quarter each, nobody earns nothing', () => {
  const { room, act, teams, firstOpen, turnIndex } = fixture(2);
  act(0, 'start');
  act(0, 'open', firstOpen()); act(0, 'tool', { tool: 'double' });
  assert.throws(() => act(0, 'judge', { teamId: teams[1].id }), error('PHASE'), 'judging waits for the reveal');
  assert.throws(() => act(1, 'reveal'), error('HOST_ONLY'));
  act(0, 'reveal');
  const p = room.current.p;
  act(0, 'judge', { teamId: teams[1].id });
  assert.deepEqual(room.verdict, { teamId: teams[1].id, points: p, steal: true, qid: room.verdict.qid }, 'a steal never doubles');
  assert.equal(view(room, teams).steals, 1);
  // Team 2's turn: two hints, then judged right.
  act(turnIndex(), 'open', firstOpen());
  act(turnIndex(), 'hint'); act(0, 'hint');
  const second = room.current.p;
  act(0, 'reveal'); act(0, 'judge', { teamId: teams[1].id });
  assert.equal(room.verdict.points, pointsAfterHints(second, 2));
  act(turnIndex(), 'open', firstOpen()); act(0, 'reveal'); act(0, 'judge', { teamId: null });
  assert.equal(room.verdict.points, 0); assert.equal(room.verdict.teamId, null);
  function view(r, list) { return game.snapshot(r, list[0].id, 1000).teams.find((t) => t.id === list[1].id); }
});

test('the host takes back the last verdict, and the match ends once every cell is judged', () => {
  const { room, act, teams, firstOpen, turnIndex } = fixture(2);
  act(0, 'start');
  act(0, 'open', firstOpen()); act(0, 'reveal'); act(0, 'judge', { teamId: teams[0].id });
  const after = JSON.stringify({ scores: room.scores, used: room.used, turn: room.turn });
  act(0, 'undo');
  assert.equal(Object.keys(room.used).length, 0); assert.equal(room.scores[teams[0].id], 0); assert.equal(room.turn, 0);
  assert.throws(() => act(0, 'undo'), error('PHASE'), 'one level only');
  act(0, 'open', firstOpen()); act(0, 'reveal'); act(0, 'judge', { teamId: teams[0].id });
  assert.equal(JSON.stringify({ scores: room.scores, used: room.used, turn: room.turn }), after);
  let previous = null, stats = [];
  while (room.phase !== 'over') {
    act(turnIndex(), 'open', firstOpen()); act(0, 'reveal');
    previous = structuredClone(room);
    act(0, 'judge', { teamId: teams[turnIndex()].id });
  }
  assert.equal(room.reason, null); assert.equal(room.round, room.rounds); assert.equal(Object.keys(room.used).length, 20);
  // Finished rooms report a competitive result for linked accounts.
  previous.statsMatch = { eventId: 'online:fixture', startedAt: 1, accounts: { [teams[0].id]: 'u1', [teams[1].id]: 'u2' } };
  room.statsMatch = previous.statsMatch; stats = prepareRoomStats(previous, room, 2000);
  assert.equal(stats.length, 2); assert.equal(stats.every((s) => s.game === 'badeeha'), true);
  assert.equal(stats.filter((s) => s.won || s.draw).length >= 1, true);
  act(0, 'restart'); assert.equal(room.phase, 'lobby'); assert.deepEqual(room.participants, []);
});

test('a team that leaves loses its turn; fewer than two teams ends the match', () => {
  const three = fixture(3);
  three.act(0, 'start');
  game.leaveRoom(three.room, three.teams[0].id, 1100);
  assert.equal(three.room.phase, 'board'); assert.notEqual(three.room.participants[three.room.turn], three.teams[0].id);
  const two = fixture(2);
  two.act(0, 'start'); game.leaveRoom(two.room, two.teams[1].id, 1100);
  assert.equal(two.room.phase, 'over'); assert.equal(two.room.reason, 'players_left');
});

test('the snapshot never carries question text or answers, only IDs and points', () => {
  const { act, view, firstOpen } = fixture(2);
  act(0, 'start'); act(0, 'open', firstOpen());
  const state = view(1);
  assert.deepEqual(Object.keys(state.current).sort(), ['categoryId', 'index', 'p', 'qid']);
  assert.doesNotMatch(JSON.stringify(state), /"(q|a|alt|answer|text)":/);
});

test('rooms hold four teams; a fifth phone is refused and a late phone watches', () => {
  const { room, act } = fixture(4);
  assert.throws(() => game.joinRoom(room, { id: '9'.repeat(32), tokenHash: '8'.repeat(64), name: 'خامس', avatar: 0 }, 1000), error('FULL_BADEEHA'));
  const small = fixture(2); small.act(0, 'start');
  game.joinRoom(small.room, { id: '9'.repeat(32), tokenHash: '8'.repeat(64), name: 'متأخر', avatar: 0 }, 1100);
  assert.equal(small.room.participants.includes('9'.repeat(32)), false);
  void act;
});

test('delayed question commands cannot reveal or score a later Badeeha round', () => {
  const f = fixture(2);
  f.act(0, 'start'); f.act(0, 'open', f.firstOpen());
  const oldRound = f.room.round;
  f.act(0, 'reveal'); f.act(0, 'judge', { teamId: f.teams[0].id });
  f.act(1, 'open', f.firstOpen());
  for (const type of ['hint', 'reveal', 'end']) {
    assert.throws(() => f.act(0, type, { round: oldRound }), error('STALE'), type);
    assert.equal(f.room.phase, 'question');
  }
  f.act(0, 'reveal');
  const before = structuredClone(f.room.scores);
  assert.throws(() => f.act(0, 'judge', { round: oldRound, teamId: f.teams[0].id }), error('STALE'));
  assert.deepEqual(f.room.scores, before);
});

test('undo after a team leaves restores points without handing a departed team the turn', () => {
  const f = fixture(3);
  f.act(0, 'start'); f.act(0, 'open', f.firstOpen());
  f.act(0, 'reveal'); f.act(0, 'judge', { teamId: f.teams[0].id });
  game.leaveRoom(f.room, f.teams[0].id, 1100);
  f.act(1, 'undo');
  assert.notEqual(f.room.participants[f.room.turn], f.teams[0].id);
  f.act(1, 'open', f.firstOpen()); f.act(1, 'reveal');
  assert.throws(() => f.act(1, 'judge', { teamId: f.teams[0].id }), error('TARGET'));
});
