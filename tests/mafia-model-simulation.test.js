import test from 'node:test';
import assert from 'node:assert/strict';
import * as mafia from '../server/mafia-model.mjs';

const NOW = 1_800_000_000_000;
function rng(seed) { let n = seed; return () => (n = (Math.imul(n, 1664525) + 1013904223) >>> 0); }
const player = n => ({ id: `p${n}`, tokenHash: `secret${n}`, name: `لاعب ${n}`, avatar: n % 4 });
function act(room, id, command, now, options) { return mafia.action(room, id, { matchId: room.matchId, phaseId: room.phaseId, ...command }, now, options); }
function make(n, randomWord) {
  const room = mafia.createRoom('SIM123', { ...player(0), settings: { mode: n >= 9 ? 'shadow' : 'classic', capacity: n } }, NOW);
  for (let i = 1; i < n; i++) mafia.joinRoom(room, player(i), NOW);
  for (const m of room.members) { mafia.connected(room, m.id, true, NOW); act(room, m.id, { type: 'ready', ready: true }, NOW); }
  act(room, 'p0', { type: 'start' }, NOW, { randomWord });
  return room;
}
function commands(room, now, randomWord) {
  const all = [], alive = room.participants.filter(id => room.roleStates[id].alive);
  const candidate = alive[randomWord() % alive.length];
  const killTarget = alive.filter(id => room.roleStates[id].faction !== 'mafia')[0];
  for (const id of alive) {
    const view = mafia.snapshot(room, id, now);
    for (const a of view.you.actions) {
      if (randomWord() % 7 === 0) continue; // Missing actions and abstention are ordinary inputs.
      if (a.type === 'verdict') { all.push([id, { type: a.type, approve: randomWord() % 3 !== 0 }]); continue; }
      if (a.type === 'herald') { if (randomWord() % 2) all.push([id, { type: a.type }]); continue; }
      if (!a.targets.length) continue;
      if (a.count === 2) {
        if (a.targets.length < 2) continue;
        const first = randomWord() % a.targets.length;
        const second = (first + 1 + randomWord() % (a.targets.length - 1)) % a.targets.length;
        all.push([id, { type: a.type, targetIds: [a.targets[first], a.targets[second]] }]);
      } else {
        const targetId = a.type === 'mafia_vote' && a.targets.includes(killTarget) ? killTarget : a.type === 'nominate' && a.targets.includes(candidate) ? candidate : a.targets[randomWord() % a.targets.length];
        all.push([id, { type: a.type, targetId }]);
      }
    }
  }
  return all;
}

test('3,150 seeded full matches across 6–12 seats: ordering, private projections, persistence and termination invariants', () => {
  let completed = 0, phaseTransitions = 0, commandCount = 0;
  const outcomes = { town: 0, mafia: 0, shadow: 0, draw: 0 };
  for (let n = 6; n <= 12; n++) for (let seed = 1; seed <= 450; seed++) {
    const randomWord = rng(n * 100_000 + seed);
    let room = make(n, randomWord), steps = 0, previousPhaseId = room.phaseId;
    while (room.phase !== 'over') {
      assert.ok(steps++ < 100, 'every match must end without an external next command');
      const at = room.deadlineAt - 1, selected = commands(room, at, randomWord);
      const reversed = room.phase === 'night' ? JSON.parse(JSON.stringify(room)) : null;
      // Observing a private choice must not expose a counter or payload to any
      // unrelated living participant, including an opponent in the same room.
      for (const [id, command] of selected) {
        const observer = room.participants.find(other => other !== id && room.roleStates[other].alive);
        const before = observer && mafia.snapshot(room, observer, at);
        act(room, id, command, at);
        if (observer && !['herald', 'chat'].includes(command.type)) assert.deepEqual(mafia.snapshot(room, observer, at), before);
        commandCount++;
      }
      if (reversed) {
        for (const [id, command] of selected.toReversed()) act(reversed, id, command, at);
        mafia.tick(reversed, reversed.deadlineAt);
      }
      mafia.tick(room, room.deadlineAt);
      if (reversed) {
        assert.deepEqual(room.roleStates, reversed.roleStates);
        assert.deepEqual(room.privateEvents, reversed.privateEvents);
        assert.deepEqual(room.history, reversed.history);
        assert.deepEqual(room.outcome, reversed.outcome);
      }
      assert.ok(room.phaseId > previousPhaseId); previousPhaseId = room.phaseId; phaseTransitions++;
      for (const s of Object.values(room.roleStates)) {
        assert.ok(s.resources.charges == null || s.resources.charges >= 0);
        assert.ok(s.resources.shield >= 0 && s.resources.selfProtection >= 0);
        assert.ok(!s.eliminatedAt || !s.alive, 'no resurrection or duplicate seat replacement');
      }
      if (steps % 3 === 0) room = JSON.parse(JSON.stringify(room));
    }
    assert.equal(room.participants.length, n);
    assert.equal(mafia.matchResults(room).length, n);
    assert.ok(room.outcome.endedAt - room.startedAt <= 30 * 60_000);
    for (const id of room.participants) {
      const final = mafia.snapshot(room, id, room.outcome.endedAt);
      assert.equal(final.replay.players.length, n);
      assert.equal(final.chats.team.length, 0);
      assert.equal(final.chats.observers.length, 0);
    }
    outcomes[room.outcome.faction]++; completed++;
  }
  assert.equal(completed, 3150);
  assert.ok(phaseTransitions > 20_000);
  assert.ok(commandCount > 40_000);
  // These counts describe adversarial synthetic actions, never a balance claim.
  console.log(JSON.stringify({ syntheticMatches: completed, phaseTransitions, commandCount, outcomes }));
});
