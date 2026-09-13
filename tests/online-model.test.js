import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, connected, action, tick, leaveRoom, snapshot, profile, nextAlarm } from '../server/room-model.mjs';
import { HOST_GRACE, ROOM_TTL, normalizeCode, validateServerUrl } from '../src/online/shared.js';
const people = Array.from({ length: 13 }, (_, n) => ({ id: `p${n}`, tokenHash: `secret${n}`, name: `لاعب ${n}`, avatar: n % 4, rounds: 5 }));
const deck = Array.from({ length: 12 }, (_, n) => ({ id: `q${n}`, text: `سؤال ${n}`, tag: 'نوم' }));
function lobby(n = 3) {
  const r = createRoom('123456', people[0], 1000);
  for (let i = 1; i < n; i++) joinRoom(r, people[i], 1000 + i);
  for (const p of r.members) { connected(r, p.id, true, 1010); p.ready = true; }
  return r;
}
function command(r, id, type, extra = {}, now = 1100) { action(r, id, { type, matchId: r.matchId, round: r.round, ...extra }, now, deck); }
function playing(n = 3) { const r = lobby(n); command(r, 'p0', 'start'); return r; }
const rejects = (code, fn) => assert.throws(fn, (e) => e.code === code);

test('room profiles, Arabic codes and backend URLs validate at the boundary', () => {
  assert.equal(profile({ name: '  أحمد  علي ', avatar: 2 }).name, 'أحمد علي');
  rejects('NAME', () => profile({ name: '\u202Eabc', avatar: 0 }));
  rejects('NAME', () => profile({ name: 'س'.repeat(21), avatar: 0 }));
  rejects('INVALID', () => profile({ name: 'أحمد', avatar: 9 }));
  assert.equal(normalizeCode('١٢٣ ۴۵۶'), '123456');
  assert.equal(validateServerUrl('https://maydan.example/'), 'https://maydan.example');
  for (const value of ['http://public.example', 'https://a:b@public.example', 'https://a.example/path', 'javascript:alert(1)', 'https://a.example/?token=x']) assert.equal(validateServerUrl(value), '');
  assert.equal(validateServerUrl('http://localhost:8787'), 'http://localhost:8787');
});
test('join is idempotent, authenticated, unique and limited to twelve players', () => {
  const r = lobby(12);
  joinRoom(r, people[2], 2000); assert.equal(r.members.length, 12);
  rejects('AUTH', () => joinRoom(r, { ...people[2], tokenHash: 'other' }, 2000));
  rejects('FULL', () => joinRoom(r, people[12], 2000));
  const small = lobby();
  rejects('NAME_TAKEN', () => joinRoom(small, { ...people[3], name: people[1].name }, 2000));
  command(small, 'p0', 'start');
  rejects('STARTED', () => joinRoom(small, people[3], 2000));
  joinRoom(small, people[1], 2000); // Same seat may reconnect during a match.
});
test('only host may start, with three connected and ready players', () => {
  const r = lobby();
  rejects('HOST_ONLY', () => command(r, 'p1', 'start'));
  r.members[1].ready = false; rejects('NOT_READY', () => command(r, 'p0', 'start'));
  r.members[1].ready = true; r.members[2].connected = false; rejects('NOT_READY', () => command(r, 'p0', 'start'));
  rejects('NOT_READY', () => command(lobby(2), 'p0', 'start'));
  r.members[2].connected = true; command(r, 'p0', 'start');
  assert.equal(r.round, 1); assert.equal(r.deadlineAt, 31100); assert.equal(r.participants.length, 3);
});
test('votes remain secret and score exactly once when simultaneous voting finishes', () => {
  const r = playing();
  command(r, 'p0', 'vote', { targetId: 'p1' });
  command(r, 'p0', 'vote', { targetId: 'p1' }); // An identical retry is harmless.
  rejects('VOTED', () => command(r, 'p0', 'vote', { targetId: 'p2' }));
  const observer = snapshot(r, 'p2', 1200);
  assert.deepEqual(observer.counts, {}); assert.deepEqual(observer.myVote, { submitted: false });
  assert.equal(observer.submittedCount, 1);
  for (const privateKey of ['tokenHash', 'secret0', 'secret1', 'deck', 'votes', 'q1']) assert.equal(JSON.stringify(observer).includes(privateKey), false, privateKey);
  command(r, 'p1', 'vote', { targetId: 'p1' }); command(r, 'p2', 'vote', { targetId: 'p0' });
  assert.equal(r.phase, 'result'); assert.deepEqual(r.winners, ['p1']); assert.equal(r.scores.p1, 1);
  rejects('PHASE', () => command(r, 'p2', 'vote', { targetId: 'p0' }));
  tick(r, 40000); assert.equal(r.scores.p1, 1);
  assert.deepEqual(snapshot(r, 'p0', 40000).counts, { p0: 1, p1: 2, p2: 0 });
  assert.equal(JSON.stringify(snapshot(r, 'p0', 40000)).includes('votes'), false);
});
test('ties award each winner, abstentions and zero votes award nobody', () => {
  const r = playing();
  for (let i = 0; i < 3; i++) command(r, `p${i}`, 'vote', { targetId: `p${i}` });
  assert.deepEqual(r.winners, ['p0', 'p1', 'p2']); assert.deepEqual(r.scores, { p0: 1, p1: 1, p2: 1 });
  command(r, 'p0', 'next');
  for (let i = 0; i < 3; i++) command(r, `p${i}`, 'vote', { targetId: null });
  assert.deepEqual(r.winners, []);
  command(r, 'p0', 'next'); tick(r, r.deadlineAt);
  assert.equal(r.phase, 'result'); assert.deepEqual(r.winners, []);
  assert.deepEqual(r.scores, { p0: 1, p1: 1, p2: 1 });
});
test('server deadline reveals partial votes and rejects late or stale commands', () => {
  const r = playing();
  rejects('TARGET', () => command(r, 'p0', 'vote', { targetId: '__proto__' }));
  rejects('STALE', () => command(r, 'p0', 'vote', { targetId: 'p0', round: 99 }));
  rejects('STALE', () => command(r, 'p0', 'vote', { targetId: 'p0' }, r.deadlineAt));
  command(r, 'p1', 'vote', { targetId: 'p2' }); tick(r, r.deadlineAt);
  assert.equal(r.phase, 'result'); assert.equal(r.scores.p2, 1);
  rejects('HOST_ONLY', () => command(r, 'p1', 'next'));
  const old = { matchId: r.matchId, round: r.round };
  command(r, 'p0', 'next');
  rejects('STALE', () => command(r, 'p0', 'next', old));
  rejects('STALE', () => command(r, 'p1', 'vote', { ...old, targetId: 'p1' }));
});
test('host grace, transfer and reconnect retain votes and do not restore old host authority', () => {
  const r = playing(); command(r, 'p0', 'vote', { targetId: 'p1' });
  connected(r, 'p0', false, 2000);
  assert.equal(nextAlarm(r, 2000), 2000 + HOST_GRACE);
  tick(r, 2000 + HOST_GRACE - 1); assert.equal(r.hostId, 'p0');
  connected(r, 'p0', true, 2500); assert.equal(r.hostMissingSince, null);
  connected(r, 'p0', false, 3000); tick(r, 3000 + HOST_GRACE);
  assert.equal(r.hostId, 'p1');
  connected(r, 'p0', true, 24000);
  assert.equal(r.hostId, 'p1'); assert.equal(r.votes.p0, 'p1');
  rejects('HOST_ONLY', () => command(r, 'p0', 'next'));
});
test('explicit departures release lobby seats and end a match with fewer than three', () => {
  const r = lobby(); connected(r, 'p2', false, 1100);
  command(r, 'p0', 'kick', { targetId: 'p2' }); assert.equal(r.members.length, 2);
  joinRoom(r, people[2], 1200); connected(r, 'p2', true, 1200); command(r, 'p2', 'ready', { ready: true });
  command(r, 'p0', 'start'); leaveRoom(r, 'p0', 1300);
  assert.equal(r.hostId, 'p1'); assert.equal(r.phase, 'over'); assert.equal(r.reason, 'players_left');
  command(r, 'p1', 'restart'); assert.equal(r.phase, 'lobby'); assert.equal(r.members.length, 2);
});
test('full match, replay generation and room expiry', () => {
  const r = playing(); const firstMatch = r.matchId;
  for (let round = 1; round <= 5; round++) {
    for (let i = 0; i < 3; i++) command(r, `p${i}`, 'vote', { targetId: 'p0' });
    command(r, 'p0', 'next');
  }
  assert.equal(r.phase, 'over'); assert.equal(r.scores.p0, 5);
  command(r, 'p0', 'restart');
  rejects('STALE', () => command(r, 'p0', 'start', { matchId: firstMatch }));
  tick(r, 1000 + ROOM_TTL); assert.equal(r.phase, 'closed'); assert.equal(r.reason, 'expired');
});
