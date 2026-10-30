import test from 'node:test';
import assert from 'node:assert/strict';
import * as mafia from '../server/mafia-model.mjs';
import { MAFIA_ROLES, MAFIA_RULESET_VERSION, MAFIA_MAX_MATCH_MS, normalizeMafiaSettings, supportsMafiaRuleset } from '../src/online/mafia-shared.js';
import { bindSeatAccount, prepareRoomStats } from '../server/room-stats.mjs';
import { prepareMafiaResult, persistMafiaResult } from '../server/mafia-results.mjs';
import { mafiaProgressStatements } from '../server/mafia-progression.mjs';
import { settleRankedMatch } from '../server/mafia-ranked.mjs';
import { projectMafiaReview, readMafiaReview } from '../server/mafia-review.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createMafiaLab, validateMafiaLabProgress } from '../src/games/mafia/tutorial/labs/adapter.mjs';
import { LAB_HUMAN, labActors } from '../src/games/mafia/tutorial/labs/scenarios.mjs';

const NOW = 1_800_000_000_000, PRIVATE = 'TRACKER_PRIVATE_TOKEN_NAME_CHAT';
const person = n => ({ id: `tracker-seat-${n}`, tokenHash: PRIVATE, name: `ضيف ${n}`, avatar: n % 4 });
const role = (room, name) => room.participants.find(id => room.roleStates[id].roleId === name);
const choose = (room, id, fields) => mafia.action(room, id, { type: 'night_action', matchId: room.matchId, phaseId: room.phaseId, ...fields }, room.deadlineAt - 1);
const step = room => { assert.ok(room.deadlineAt); mafia.tick(room, room.deadlineAt); };
function until(room, phase, round = 1) {
  for (let n = 0; (room.phase !== phase || room.round !== round) && n < 100; n++) step(room);
  assert.equal(room.phase, phase); assert.equal(room.round, round);
}
function started({ count = 12, seed = 1, experimental = true, want = [] } = {}) {
  for (let candidate = seed; candidate < seed + 256; candidate++) {
    const room = mafia.createRoom('123456', { ...person(0), settings: {
      mode: count > 8 ? 'shadow' : 'classic', capacity: count, visibility: 'private', voiceMode: 'off',
      ...(experimental ? { experimentalRole: 'tracker' } : {}),
    } }, NOW);
    for (let n = 1; n < count; n++) mafia.joinRoom(room, person(n), NOW);
    for (const member of room.members) {
      bindSeatAccount(room, member.id, `account-${member.id}`);
      mafia.connected(room, member.id, true, NOW);
      mafia.action(room, member.id, { type: 'ready', ready: true, matchId: 0, phaseId: 0 }, NOW);
    }
    const lobby = structuredClone(room); let random = candidate;
    const randomWord = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
    mafia.action(room, room.hostId, { type: 'start', matchId: 0, phaseId: 0 }, NOW, { randomWord });
    if (want.every(name => role(room, name))) return { room, lobby };
  }
  assert.fail('Bounded real role draw did not contain the requested specialties');
}
function attack(room, targetId, split) {
  const actors = room.participants.filter(id => room.roleStates[id].faction === 'mafia' && room.roleStates[id].alive);
  for (const [index, id] of actors.entries()) mafia.action(room, id, { type: 'mafia_vote', targetId: split?.[index] ?? targetId, matchId: room.matchId, phaseId: room.phaseId }, room.deadlineAt - 1);
}
const lastTracking = room => room.privateEvents[role(room, 'tracker')].filter(report => report.type === 'tracking').at(-1);
const publicOnly = report => assert.deepEqual(Object.keys(report).sort(), ['at', 'destinationIds', 'id', 'round', 'targetId', 'type']);

test('tracker integration: v1 draw/catalog/default stay unchanged and v2 replaces exactly one supporting role', () => {
  assert.equal(MAFIA_RULESET_VERSION, 1); assert.equal(Object.keys(MAFIA_ROLES).length, 12); assert.equal(MAFIA_ROLES.tracker, undefined);
  for (const count of [8, 9, 10, 11, 12]) for (let seed = 1; seed <= 16; seed++) {
    const v1 = started({ count, seed, experimental: false }).room, v2 = started({ count, seed }).room;
    assert.equal(v1.rulesetVersion, 1); assert.equal(v2.rulesetVersion, 2);
    const changed = v1.participants.filter(id => v1.roleStates[id].roleId !== v2.roleStates[id].roleId);
    assert.equal(changed.length, 1); assert.equal(v2.roleStates[changed[0]].roleId, 'tracker');
    assert.equal(v2.roleStates[changed[0]].resources.charges, 2);
    assert.deepEqual(Object.values(v1.roleStates).map(s => s.faction), Object.values(v2.roleStates).map(s => s.faction));
  }
  for (const settings of [{ mode: 'classic', capacity: 7, visibility: 'private' }, { mode: 'classic', capacity: 8, visibility: 'public' }])
    assert.equal(normalizeMafiaSettings({ ...settings, experimentalRole: 'tracker' }), null);
  assert.equal(supportsMafiaRuleset({ mafia: 2 }, 1), true);
  for (const mafiaRulesets of [undefined, [1], ['2'], [], null]) assert.equal(supportsMafiaRuleset({ mafia: 2, mafiaRulesets }, 2), false);
  assert.equal(supportsMafiaRuleset({ mafia: 2, mafiaRulesets: [1, 2] }, 2), true);
  assert.equal(supportsMafiaRuleset({ mafiaRulesets: [1, 2, 3] }, 3), false);
});

test('tracker integration: editable/cancellable selections spend a charge only at close and stop after two accepted nights', () => {
  const { room } = started(); until(room, 'night');
  const tracker = role(room, 'tracker'), doctor = role(room, 'doctor'), investigator = role(room, 'investigator');
  assert.equal(mafia.snapshot(room, tracker, room.deadlineAt - 1).you.actions.find(a => a.ability === 'track').remaining, 2);
  assert.throws(() => choose(room, tracker, { targetId: tracker }), { code: 'TARGET' });
  choose(room, tracker, { targetId: doctor }); choose(room, tracker, { targetId: investigator }); choose(room, tracker, { targetId: null });
  step(room); assert.equal(room.roleStates[tracker].resources.charges, 2); assert.deepEqual(room.privateEvents[tracker], []);
  for (const round of [2, 3]) {
    until(room, 'night', round); choose(room, tracker, { targetId: doctor });
    assert.equal(room.roleStates[tracker].resources.charges, 4 - round);
    step(room); assert.equal(room.roleStates[tracker].resources.charges, 3 - round);
  }
  until(room, 'night', 4); assert.throws(() => choose(room, tracker, { targetId: doctor }), { code: 'ABILITY_UNAVAILABLE' });
  assert.equal(mafia.snapshot(room, tracker, room.deadlineAt - 1).you.actions.some(a => a.ability === 'track'), false);
});

test('tracker integration: outgoing protection is owner-only; quiet/passive/incoming-only actors share the same empty report shape', () => {
  for (const targetRole of ['doctor', 'investigator', 'citizen', 'guard']) {
    const { room } = started({ want: ['guard'] }); until(room, 'night');
    const tracker = role(room, 'tracker'), target = role(room, targetRole), destination = role(room, 'citizen');
    if (targetRole === 'doctor') choose(room, target, { targetId: destination });
    else choose(room, role(room, 'doctor'), { targetId: target });
    choose(room, tracker, { targetId: target }); step(room);
    const report = lastTracking(room); publicOnly(report);
    assert.deepEqual(report.destinationIds, targetRole === 'doctor' ? [destination] : []);
    assert.doesNotMatch(JSON.stringify(report), /faction|success|roleId|ability|visitor|aggregate/);
    assert.deepEqual(mafia.snapshot(room, tracker, room.deadlineAt).you.reports, [report]);
    for (const id of room.participants.filter(id => id !== tracker)) {
      const view = mafia.snapshot(room, id, room.deadlineAt);
      assert.equal(view.replay, null); assert.equal(view.you.reports.some(value => value.type === 'tracking'), false);
      assert.doesNotMatch(JSON.stringify(view), /destinationIds|tracking_report|roleStates|TRACKER_PRIVATE_TOKEN/);
    }
  }
});

test('tracker integration: changing only the private tracking target cannot alter any other live recipient projection', () => {
  const { room } = started(); until(room, 'night');
  choose(room, role(room, 'doctor'), { targetId: role(room, 'citizen') });
  const a = structuredClone(room), b = structuredClone(room), tracker = role(room, 'tracker');
  choose(a, tracker, { targetId: role(room, 'doctor') }); choose(b, tracker, { targetId: role(room, 'investigator') });
  step(a); step(b);
  for (const id of room.participants.filter(id => id !== tracker)) assert.deepEqual(mafia.snapshot(a, id, a.deadlineAt), mafia.snapshot(b, id, b.deadlineAt));
  assert.deepEqual(mafia.publicSnapshot(a), mafia.publicSnapshot(b));
});

test('tracker integration: analyst destinations are merged in public seat order without leaking comparison or faction results', () => {
  const { room } = started({ want: ['analyst'] }); until(room, 'night');
  const analyst = role(room, 'analyst'), tracker = role(room, 'tracker');
  const ids = room.participants.filter(id => id !== analyst).slice(1, 3);
  choose(room, analyst, { targetIds: [...ids].reverse() }); choose(room, tracker, { targetId: analyst }); step(room);
  const report = lastTracking(room); publicOnly(report); assert.deepEqual(report.destinationIds, ids);
  assert.equal(Object.hasOwn(report, 'same'), false); assert.equal(Object.hasOwn(report, 'targetIds'), false);
});

test('tracker integration: camouflage does not hide selections; own attack ballot merges without ability-first ordering', () => {
  const { room } = started(); until(room, 'night');
  const masker = role(room, 'masker'), tracker = role(room, 'tracker'), citizen = role(room, 'citizen');
  choose(room, masker, { targetId: masker }); choose(room, role(room, 'doctor'), { targetId: citizen }); attack(room, citizen);
  choose(room, tracker, { targetId: masker }); step(room);
  const report = lastTracking(room); publicOnly(report);
  assert.deepEqual(report.destinationIds, room.participants.filter(id => [masker, citizen].includes(id)));
  assert.equal(room.roleStates[citizen].alive, true, 'protection success is not exposed by tracking');
});

test('tracker integration: blocker ability and its identical attack ballot produce one destination', () => {
  const { room } = started(); until(room, 'night');
  const blocker = role(room, 'blocker'), citizen = role(room, 'citizen');
  choose(room, blocker, { targetId: citizen }); attack(room, citizen); choose(room, role(room, 'tracker'), { targetId: blocker }); step(room);
  assert.deepEqual(lastTracking(room).destinationIds, [citizen]); assert.equal(room.roleStates[citizen].alive, false);
});

test('tracker integration: blocking the observed actor hides its outgoing destinations; blocking tracker spends the charge and yields generic no_result', () => {
  for (const blockedRole of ['doctor', 'tracker']) {
    const { room } = started(); until(room, 'night');
    const tracker = role(room, 'tracker'), doctor = role(room, 'doctor');
    choose(room, doctor, { targetId: role(room, 'citizen') }); choose(room, role(room, 'blocker'), { targetId: role(room, blockedRole) });
    choose(room, tracker, { targetId: doctor }); step(room);
    assert.equal(room.roleStates[tracker].resources.charges, 1);
    const report = room.privateEvents[tracker].at(-1);
    if (blockedRole === 'doctor') { publicOnly(report); assert.deepEqual(report.destinationIds, []); }
    else assert.deepEqual(Object.keys(report).sort(), ['at', 'id', 'round', 'type']);
    assert.equal(report.type, blockedRole === 'doctor' ? 'tracking' : 'no_result');
  }
});

test('tracker integration: an eliminated observed actor retains accepted destinations; an eliminated tracker receives no report', () => {
  for (const victimRole of ['doctor', 'tracker']) {
    const { room } = started(); until(room, 'night');
    const tracker = role(room, 'tracker'), doctor = role(room, 'doctor'), destination = role(room, 'citizen');
    choose(room, doctor, { targetId: destination }); choose(room, tracker, { targetId: doctor }); attack(room, role(room, victimRole)); step(room);
    assert.equal(room.roleStates[role(room, victimRole)].alive, false);
    assert.equal(room.roleStates[tracker].resources.charges, 1);
    assert.deepEqual(room.privateEvents[tracker].filter(r => r.type === 'tracking').map(r => r.destinationIds), victimRole === 'tracker' ? [] : [[destination]]);
  }
});

test('tracker integration: recruiter destinations reveal no outcome; conversion preserves tracker role and remaining charges', () => {
  for (const success of [false, true]) {
    const { room } = started(); until(room, 'night', 2);
    const tracker = role(room, 'tracker'), leader = role(room, 'leader'), target = success ? tracker : role(room, 'mafia');
    choose(room, leader, { targetId: target }); choose(room, tracker, { targetId: leader }); step(room);
    const report = lastTracking(room); publicOnly(report); assert.deepEqual(report.destinationIds, [target]);
    assert.equal(Object.hasOwn(report, 'success'), false);
    assert.equal(room.roleStates[tracker].roleId, 'tracker'); assert.equal(room.roleStates[tracker].resources.charges, 1);
    assert.equal(room.roleStates[tracker].faction, success ? 'shadow' : 'town');
    until(room, 'night', 3); choose(room, tracker, { targetId: role(room, 'doctor') }); step(room);
    assert.equal(room.roleStates[tracker].resources.charges, 0);
  }
});

test('tracker integration: a reporter may choose an eliminated destination, and tracking remains distinct from the public reveal', () => {
  const { room } = started({ want: ['reporter'] }); until(room, 'night');
  const victim = role(room, 'citizen'); attack(room, victim); step(room); until(room, 'night', 2);
  choose(room, role(room, 'reporter'), { targetId: victim }); choose(room, role(room, 'tracker'), { targetId: role(room, 'reporter') }); step(room);
  assert.deepEqual(lastTracking(room).destinationIds, [victim]);
  assert.equal(room.history.filter(e => e.type === 'faction_revealed').at(-1).playerId, victim);
});

test('tracker integration: JSON persistence retains exact pending choices/resources while live replay stays sealed', () => {
  const { room } = started(); until(room, 'night');
  const tracker = role(room, 'tracker'); choose(room, tracker, { targetId: role(room, 'doctor') });
  const restored = JSON.parse(JSON.stringify(room)); assert.deepEqual(restored, room);
  assert.equal(mafia.snapshot(restored, tracker, restored.deadlineAt - 1).replay, null);
  step(restored); assert.equal(restored.roleStates[tracker].resources.charges, 1); assert.deepEqual(lastTracking(restored).destinationIds, []);
});

test('tracker integration: v2 archives remain owner-only anonymous reviews, with zero progression/rank/generic public wins', async t => {
  const { room, lobby } = started(); prepareRoomStats(lobby, room, NOW, { mafiaProgressEnabled: true });
  assert.equal(Object.hasOwn(room.statsMatch, 'rewardPolicyVersion'), false);
  until(room, 'night'); choose(room, role(room, 'doctor'), { targetId: role(room, 'citizen') }); choose(room, role(room, 'tracker'), { targetId: role(room, 'doctor') }); step(room);
  const before = structuredClone(room); mafia.tick(room, room.startedAt + MAFIA_MAX_MATCH_MS);
  const event = prepareMafiaResult(room, NOW + MAFIA_MAX_MATCH_MS); assert.equal(event.rulesetVersion, 2); assert.equal(event.rewardPolicyVersion, null);
  assert.deepEqual(prepareRoomStats(before, room, event.finishedAt, { mafiaProgressEnabled: true, mafiaResult: event }), []);
  const review = projectMafiaReview({ summary: event.summary, finishedAt: event.finishedAt, rulesetVersion: 2 });
  assert.equal(review.available, true); assert.equal(review.players.filter(player => player.roleId === 'tracker').length, 1);
  const trace = review.events.find(e => e.type === 'tracking_report'); assert.ok(trace); assert.ok(trace.destinationSeats.every(Number.isInteger));
  assert.doesNotMatch(JSON.stringify(review), /tracker-seat-|account-|PRIVATE|token|roomCode|playerId|destinationIds|chat|audio|name/);
  const DB = createLocalD1(); t.after(() => DB.close()); const env = { DB, MAFIA_PROGRESS_ENABLED: '1' };
  let now = event.notBefore; t.mock.method(Date, 'now', () => now);
  for (const result of event.results) await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(result.userId, PRIVATE, NOW, NOW).run();
  now = event.finishedAt + 29999; await persistMafiaResult(env, event); assert.equal((await DB.prepare('SELECT COUNT(*) n FROM mafia_history').first()).n, 0);
  now = event.notBefore; await persistMafiaResult(env, event); await persistMafiaResult(env, event);
  assert.equal((await readMafiaReview(env, event.results[0].userId, event.key, now)).available, true);
  assert.deepEqual(await readMafiaReview(env, 'foreign-owner', event.key, now), { available: false });
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM mafia_results').first()).n, 12);
  await assert.rejects(mafiaProgressStatements(env, event), { code: 'MAFIA_PROGRESS_INVALID' });
  await assert.rejects(settleRankedMatch(env, { ...event, ranked: { key: 'forged', seasonId: 'forged' } }), { code: 'MAFIA_RANKED_RESULT' });
  for (const table of ['mafia_progress_events', 'mafia_player_progress', 'mafia_role_progress', 'mafia_ranked_ratings', 'mafia_ranked_receipts', 'player_stats'])
    assert.equal((await DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n, 0, table);
});

test('tracker integration: the complete specialty lesson uses real local rules, restores every checkpoint and performs no external work', async t => {
  for (const name of ['fetch', 'WebSocket', 'setTimeout', 'setInterval']) if (typeof globalThis[name] === 'function')
    t.mock.method(globalThis, name, () => { throw new Error('Forbidden tracker lesson external operation: ' + name); });
  const lab = createMafiaLab({ courseId: 'tracker' }); t.after(() => lab.dispose());
  const actors = labActors('tracker'), target = name => actors.find(actor => actor.roleId === name).id;
  const reports = [], charges = [];
  for (let count = 0; lab.getState().status !== 'completed'; count++) {
    assert.ok(count < 20); const current = lab.getState(); assert.equal(current.snapshot.rulesetVersion, 2);
    const restored = createMafiaLab({ courseId: 'tracker', progress: lab.exportProgress() });
    assert.equal(restored.getState().restoreStatus, 'restored'); assert.deepEqual(restored.getState().snapshot, current.snapshot); restored.dispose();
    if (['trace', 'trace-quiet', 'trace-blocked'].includes(current.coach.stepId)) {
      const selected = current.coach.stepId === 'trace-quiet' ? target('investigator') : target('doctor');
      assert.equal(await lab.act('night_action', { targetId: selected }), true);
      reports.push(lab.getState().snapshot.you.reports.at(-1)); charges.push(lab.getState().snapshot.you.resources.charges);
    } else assert.equal(lab.guide('continue'), true);
    assert.equal(lab.getState().feedback, null);
  }
  assert.deepEqual(charges, [1, 0, 1]); assert.deepEqual(reports.map(r => r.type), ['tracking', 'tracking', 'no_result']);
  assert.equal(reports[0].destinationIds.length, 1); assert.deepEqual(reports[1].destinationIds, []);
  assert.equal(lab.getState().snapshot.you.id, LAB_HUMAN); assert.equal(lab.getState().snapshot.settings.voiceMode, 'off');
  assert.equal(lab.getState().clock.paused, true); assert.equal(lab.advance(1e9), false);
  const journal = lab.exportProgress(); assert.equal(journal.rulesetVersion, 2); assert.deepEqual(validateMafiaLabProgress(journal), journal);
  assert.doesNotMatch(JSON.stringify(journal), /resources|roleStates|reports|tracking|token|account|chat|seed|microphone/);
  assert.equal(validateMafiaLabProgress({ ...journal, rulesetVersion: 1 }), null);
  assert.equal(validateMafiaLabProgress({ ...journal, rawState: { roleId: 'tracker' } }), null);
});
