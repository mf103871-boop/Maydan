import test from 'node:test';
import assert from 'node:assert/strict';
import { bindSeatAccount, prepareRoomStats } from '../server/room-stats.mjs';
import { createRoom, joinRoom, connected, snapshot } from '../server/game-model.mjs';

const input = n => ({ id: `seat-${n}`, tokenHash: `hash-${n}`, name: `لاعب ${n}`, avatar: n, rounds: 5 });
function lobby(game = 'meenfina') {
  const room = createRoom('123456', { ...input(0), game }, 1000);
  for (let n = 1; n < 3; n++) joinRoom(room, input(n), 1000);
  room.members.forEach((m, n) => { connected(room, m.id, true, 1001); m.ready = true; if (n < 2) bindSeatAccount(room, m.id, `account-${n}`); });
  return room;
}
function markedResult(game = 'meenfina') {
  const previous = lobby(game);
  const started = structuredClone(previous);
  Object.assign(started, { phase: 'vote', matchId: 1, round: 1, participants: started.members.map(m => m.id), scores: { 'seat-0': 0, 'seat-1': 0, 'seat-2': 0 } });
  assert.deepEqual(prepareRoomStats(previous, started, 2000), []);
  const result = { ...started, phase: 'result', round: started.rounds, history: Array.from({ length: started.rounds }, () => ({})) };
  return { previous: result, over: { ...structuredClone(result), phase: 'over' } };
}

test('seat account binding rejects duplicate accounts and is frozen after the lobby', () => {
  const room = lobby();
  assert.throws(() => bindSeatAccount(room, 'seat-2', 'account-0'), { code: 'ACCOUNT_IN_ROOM' });
  room.phase = 'vote'; bindSeatAccount(room, 'seat-0', 'other-account');
  assert.equal(room.members[0].accountUserId, 'account-0');
});

test('natural Meenfina completion counts authenticated seats only, without competitive wins or account leakage', () => {
  const { previous, over } = markedResult(); over.scores['seat-0'] = 10;
  const events = prepareRoomStats(previous, over, 4000);
  assert.equal(events.length, 2); assert.equal(new Set(events.map(e => e.eventId)).size, 1);
  assert.ok(events.every(e => !e.won && !e.draw && e.game === 'meenfina'));
  assert.deepEqual(events.map(e => e.userId), ['account-0', 'account-1']);
  for (const m of over.members) {
    const publicState = JSON.stringify(snapshot(over, m.id, 4000));
    assert.equal(publicState.includes('account-'), false); assert.equal(publicState.includes('statsMatch'), false);
  }
  assert.deepEqual(prepareRoomStats(over, structuredClone(over), 4100), []);
});

test('Fabraka awards the sole winner, positive tied leaders, and no zero-score wins', () => {
  const { previous, over } = markedResult('fabraka');
  over.scores = { 'seat-0': 5, 'seat-1': 3, 'seat-2': 0 };
  assert.deepEqual(prepareRoomStats(previous, over, 4000).map(e => [e.won, e.draw]), [[true, false], [false, false]]);
  over.scores['seat-1'] = 5;
  assert.deepEqual(prepareRoomStats(previous, over, 4000).map(e => [e.won, e.draw]), [[false, true], [false, true]]);
  over.scores = {};
  assert.ok(prepareRoomStats(previous, over, 4000).every(e => !e.won && !e.draw));
});

test('no backfill, abandonment, missing Fabraka rounds, or departed-player credit', () => {
  const { previous, over } = markedResult('fabraka');
  assert.deepEqual(prepareRoomStats(previous, { ...over, statsMatch: null }, 4000), []);
  assert.deepEqual(prepareRoomStats(previous, { ...over, reason: 'players_left' }, 4000), []);
  assert.deepEqual(prepareRoomStats(previous, { ...over, history: [] }, 4000), []);
  assert.deepEqual(prepareRoomStats(previous, { ...over, round: 4 }, 4000), []);
  over.members[0].left = true;
  assert.deepEqual(prepareRoomStats(previous, over, 4000).map(e => e.userId), ['account-1']);
});

test('restarts mint new event IDs and preserve the match-start account mapping', () => {
  const { previous, over } = markedResult(); const firstEvent = over.statsMatch.eventId;
  over.members[0].accountUserId = 'forged-after-start';
  assert.equal(prepareRoomStats(previous, over, 4000)[0].userId, 'account-0');
  const restarted = { ...structuredClone(over), phase: 'lobby', matchId: 2, round: 0 };
  const started = { ...structuredClone(restarted), phase: 'vote', matchId: 3, round: 1 };
  prepareRoomStats(restarted, started, 6000);
  assert.notEqual(started.statsMatch.eventId, firstEvent);
});
