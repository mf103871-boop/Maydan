import test from 'node:test';
import assert from 'node:assert/strict';
import * as mafia from '../server/mafia-model.mjs';
import { MAFIA_ROLES, MAFIA_SUPPORT_ROLES, MAFIA_RECONNECT_MS, mafiaComposition, normalizeMafiaSettings } from '../src/online/mafia-shared.js';

const NOW = 1_800_000_000_000;
const input = n => ({ id: `p${n}`, tokenHash: `token${n}`, name: `لاعب ${n}`, avatar: n % 4 });
function rng(seed = 123) { let n = seed; return () => (n = (Math.imul(n, 1664525) + 1013904223) >>> 0); }
function lobby(count = 8) {
  const room = mafia.createRoom('ABC123', { ...input(0), settings: { mode: count >= 9 ? 'shadow' : 'classic', capacity: count, visibility: 'private' } }, NOW);
  for (let i = 1; i < count; i++) mafia.joinRoom(room, input(i), NOW);
  for (const m of room.members) { mafia.connected(room, m.id, true, NOW); act(room, m.id, { type: 'ready', ready: true }); }
  return room;
}
function act(room, id, command, now = NOW, options = {}) {
  return mafia.action(room, id, { matchId: room.matchId, phaseId: room.phaseId, ...command }, now, options);
}
function started(count = 8, seed = 123) {
  const room = lobby(count);
  act(room, room.hostId, { type: 'start' }, NOW, { randomWord: rng(seed) });
  return room;
}
function step(room) { assert.ok(room.deadlineAt); mafia.tick(room, room.deadlineAt); return room; }
function until(room, phase) {
  for (let i = 0; room.phase !== phase && i < 100; i++) step(room);
  assert.equal(room.phase, phase);
  return room;
}
function setup(roles) {
  const room = started(roles.length);
  roles.forEach((roleId, index) => {
    const s = room.roleStates[`p${index}`], r = MAFIA_ROLES[roleId];
    Object.assign(s, { roleId, faction: r.faction, initialFaction: r.faction, resources: { charges: r.charges, shield: roleId === 'guard' ? 1 : 0, selfProtection: roleId === 'doctor' ? 1 : 0 } });
  });
  return until(room, 'night');
}
const ROLES12 = ['mafia', 'masker', 'blocker', 'leader', 'investigator', 'doctor', 'guard', 'observer', 'reporter', 'herald', 'analyst', 'citizen'];
const choose = (room, id, targetId) => act(room, id, { type: 'night_action', targetId });
const kill = (room, targetId) => room.participants.filter(id => room.roleStates[id].alive && room.roleStates[id].faction === 'mafia').forEach(id => act(room, id, { type: 'mafia_vote', targetId }));

test('settings reject mismatched player ranges and every size has the approved composition', () => {
  assert.equal(normalizeMafiaSettings(null), null);
  assert.equal(normalizeMafiaSettings({ mode: 'classic', capacity: 9 }), null);
  assert.equal(normalizeMafiaSettings({ mode: 'shadow', capacity: 8 }), null);
  assert.equal(normalizeMafiaSettings({ visibility: 'unlisted' }), null);
  assert.equal(mafiaComposition(5), null);
  assert.equal(mafiaComposition(13), null);
  for (let n = 6; n <= 12; n++) for (let seed = 1; seed <= 20; seed++) {
    const room = started(n, seed), expected = mafiaComposition(n);
    const states = Object.values(room.roleStates);
    for (const f of ['mafia', 'town', 'shadow']) assert.equal(states.filter(s => s.faction === f).length, expected[f]);
    for (const role of ['doctor', 'investigator']) assert.equal(states.filter(s => s.roleId === role).length, 1);
    const support = states.filter(s => MAFIA_SUPPORT_ROLES.includes(s.roleId)).map(s => s.roleId);
    assert.equal(support.length, expected.support);
    assert.equal(new Set(support).size, support.length);
    assert.equal(states.filter(s => s.roleId === 'mafia').length, 1);
    assert.equal(room.rulesetVersion, 1);
    assert.equal(JSON.stringify(room).includes('randomWord'), false);
  }
});

test('phase deadlines are authoritative, immutable phase fences and bounded match clocks survive JSON persistence', () => {
  const room = started();
  assert.equal(room.phase, 'role');
  assert.equal(room.deadlineAt, NOW + 10_000);
  step(room); assert.equal(room.phase, 'opening'); assert.equal(room.deadlineAt, NOW + 55_000);
  const old = { type: 'chat', channel: 'public', text: 'مرحبًا', clientId: 'chat0001', matchId: room.matchId, phaseId: room.phaseId };
  assert.throws(() => mafia.action(room, 'p0', old, room.deadlineAt), { code: 'STALE' });
  step(room); assert.equal(room.phase, 'night'); assert.equal(room.round, 1);
  assert.throws(() => mafia.action(room, 'p0', old, NOW), { code: 'STALE' });
  const restored = JSON.parse(JSON.stringify(room));
  mafia.tick(room, NOW + 31 * 60_000); mafia.tick(restored, NOW + 31 * 60_000);
  assert.deepEqual(room, restored);
  assert.equal(room.phase, 'over'); assert.equal(room.outcome.faction, 'draw');
  assert.ok(['day_limit', 'time_limit'].includes(room.outcome.reason));
});

test('night choices can change or cancel; limited charges are spent only at close', () => {
  const room = setup(ROLES12);
  choose(room, 'p4', 'p0'); choose(room, 'p4', 'p1');
  assert.equal(room.roleStates.p4.resources.charges, 2);
  choose(room, 'p4', null); step(room);
  assert.equal(room.roleStates.p4.resources.charges, 2);
  until(room, 'night'); choose(room, 'p4', 'p0'); choose(room, 'p2', 'p4'); step(room);
  assert.equal(room.roleStates.p4.resources.charges, 1);
  assert.equal(room.roleStates.p2.resources.charges, 0);
  assert.deepEqual(room.privateEvents.p4.map(e => e.type), ['no_result']);
});

test('masking, blocking, healing, attack, conversion and reports settle in fixed order', () => {
  const room = setup(ROLES12); room.round = 2;
  choose(room, 'p2', 'p5'); choose(room, 'p1', 'p0');
  choose(room, 'p5', 'p11'); kill(room, 'p11');
  choose(room, 'p3', 'p4'); choose(room, 'p4', 'p0'); choose(room, 'p7', 'p5');
  act(room, 'p10', { type: 'night_action', targetIds: ['p4', 'p3'] });
  step(room);
  assert.equal(room.roleStates.p11.alive, false, 'blocked doctor cannot heal');
  assert.equal(room.roleStates.p4.faction, 'shadow');
  assert.equal(room.roleStates.p4.resources.charges, 1, 'conversion does not refresh charges');
  assert.equal(room.privateEvents.p4.find(e => e.type === 'investigation').faction, 'town', 'mask affects investigator after conversion');
  assert.equal(room.privateEvents.p10.find(e => e.type === 'comparison').same, true, 'comparison sees post-conversion alignment');
  assert.equal(room.privateEvents.p7.at(-1).acted, false, 'blocked activity is not reported');
  assert.ok(!JSON.stringify(room.history).includes('converted'));
});

test('healing preserves guard shield; guard withstands only the first otherwise successful attack', () => {
  const room = setup(ROLES12);
  choose(room, 'p5', 'p6'); kill(room, 'p6'); step(room);
  assert.equal(room.roleStates.p6.resources.shield, 1);
  until(room, 'night'); kill(room, 'p6'); step(room);
  assert.equal(room.roleStates.p6.alive, true); assert.equal(room.roleStates.p6.resources.shield, 0);
  until(room, 'night'); kill(room, 'p6'); step(room);
  assert.equal(room.roleStates.p6.alive, false);
});

test('doctor cannot self-heal twice or repeat a target on consecutive nights; skipped night resets last target', () => {
  const room = setup(ROLES12);
  choose(room, 'p5', 'p5'); step(room); until(room, 'night');
  assert.throws(() => choose(room, 'p5', 'p5'), { code: 'TARGET' });
  choose(room, 'p5', 'p11'); step(room); until(room, 'night');
  assert.throws(() => choose(room, 'p5', 'p11'), { code: 'TARGET' });
  step(room); until(room, 'night'); choose(room, 'p5', 'p11');
  assert.equal(room.nightActions.p5.targetId, 'p11');
});

test('Mafia ballot ties never use arrival order; surviving assistants retain shared attack', () => {
  const room = setup(['mafia', 'masker', 'investigator', 'doctor', 'citizen', 'citizen', 'citizen', 'citizen']);
  act(room, 'p0', { type: 'mafia_vote', targetId: 'p6' }); act(room, 'p1', { type: 'mafia_vote', targetId: 'p7' }); step(room);
  assert.ok(room.roleStates.p6.alive && room.roleStates.p7.alive);
  room.roleStates.p0.alive = false; room.roleStates.p0.factionAtDeath = 'mafia';
  until(room, 'night'); act(room, 'p1', { type: 'mafia_vote', targetId: 'p7' }); step(room);
  assert.equal(room.roleStates.p7.alive, false);
});

test('observer sees accepted unblocked activity, not its type, success or target', () => {
  const room = setup(ROLES12);
  choose(room, 'p7', 'p0'); act(room, 'p0', { type: 'mafia_vote', targetId: 'p11' }); act(room, 'p1', { type: 'mafia_vote', targetId: 'p10' }); step(room);
  assert.equal(room.privateEvents.p7.at(-1).acted, true);
  assert.deepEqual(Object.keys(room.privateEvents.p7.at(-1)).sort(), ['acted', 'at', 'id', 'round', 'targetId', 'type']);
});

test('recruitment never leaks an invalid hidden faction and needs both leader and target alive', () => {
  const room = setup(ROLES12);
  assert.throws(() => choose(room, 'p3', 'p11'), { code: 'ABILITY_UNAVAILABLE' });
  room.round = 2; choose(room, 'p3', 'p0'); step(room);
  assert.deepEqual(room.privateEvents.p3.at(-1), { id: 1, type: 'recruitment', at: NOW + 90_000, round: 2, success: false });
  assert.equal(room.roleStates.p3.resources.charges, 2);
  until(room, 'night'); room.round = 4; choose(room, 'p3', 'p11'); kill(room, 'p3'); step(room);
  assert.equal(room.roleStates.p3.alive, false); assert.equal(room.roleStates.p11.faction, 'town');
  assert.equal(room.roleStates.p3.resources.charges, 1);
});

test('reporter reveals immutable faction at elimination and no hidden role', () => {
  const room = setup(ROLES12);
  kill(room, 'p11'); step(room); until(room, 'night'); choose(room, 'p8', 'p11'); step(room);
  const event = room.history.find(e => e.type === 'faction_revealed');
  assert.equal(event.faction, 'town'); assert.equal(event.playerId, 'p11'); assert.equal(event.roleId, undefined);
  assert.equal(room.roleStates.p8.resources.charges, 0);
});

test('herald extends discussion once, openly, without proving present faction', () => {
  const room = setup(ROLES12);
  assert.throws(() => act(room, 'p9', { type: 'herald' }), { code: 'ABILITY_UNAVAILABLE' });
  until(room, 'discussion'); const before = room.deadlineAt;
  room.roleStates.p9.faction = 'shadow'; act(room, 'p9', { type: 'herald' });
  assert.equal(room.deadlineAt, before + 20_000);
  assert.equal(room.history.at(-1).type, 'extended'); assert.equal(room.history.at(-1).faction, undefined);
  assert.throws(() => act(room, 'p9', { type: 'herald' }), { code: 'ABILITY_UNAVAILABLE' });
});

test('nomination is immutable, ties skip defense, verdict requires strict majority and includes abstainers', () => {
  const room = setup(ROLES12); until(room, 'nomination');
  act(room, 'p0', { type: 'nominate', targetId: 'p11' });
  assert.throws(() => act(room, 'p0', { type: 'nominate', targetId: 'p10' }), { code: 'ALREADY_VOTED' });
  act(room, 'p1', { type: 'nominate', targetId: 'p10' }); step(room);
  assert.equal(room.phase, 'night'); until(room, 'nomination');
  act(room, 'p0', { type: 'nominate', targetId: 'p11' }); step(room); assert.equal(room.phase, 'defense');
  assert.equal(mafia.voiceAudience(room, 'p11').canSpeak, true); assert.equal(mafia.voiceAudience(room, 'p0').canSpeak, false);
  step(room); for (let i = 0; i < 6; i++) act(room, `p${i}`, { type: 'verdict', approve: true });
  assert.throws(() => act(room, 'p0', { type: 'verdict', approve: false }), { code: 'ALREADY_VOTED' });
  step(room); assert.equal(room.roleStates.p11.alive, true, 'six of twelve is not a majority');
  until(room, 'nomination'); act(room, 'p0', { type: 'nominate', targetId: 'p11' }); step(room); step(room);
  for (let i = 0; i < 7; i++) act(room, `p${i}`, { type: 'verdict', approve: true });
  step(room); assert.equal(room.roleStates.p11.alive, false);
});

test('win conditions cover majority, conversion, dead leader, equality and empty table', () => {
  const room = setup(ROLES12);
  const set = (factions, leaderAlive) => {
    for (const s of Object.values(room.roleStates)) s.alive = false;
    factions.forEach((faction, i) => Object.assign(room.roleStates[`p${i}`], { alive: true, faction, roleId: leaderAlive && faction === 'shadow' ? 'leader' : 'citizen' }));
    return mafia.winningFaction(room);
  };
  assert.equal(set(['mafia', 'mafia', 'town', 'shadow'], true), 'mafia');
  assert.equal(set(['mafia', 'town', 'town', 'shadow'], true), null);
  assert.equal(set(['shadow', 'shadow', 'town'], false), 'shadow');
  assert.equal(set(['town', 'town', 'shadow'], false), 'town');
  assert.equal(set(['town', 'shadow'], false), 'draw');
  assert.equal(set(['town', 'shadow'], true), null);
  assert.equal(set(['town'], false), 'town');
  assert.equal(set([], false), 'draw');
});

test('private choices, votes, chat, charges and private activity never change an unrelated snapshot', () => {
  const room = setup(ROLES12), before = mafia.snapshot(room, 'p11', NOW);
  choose(room, 'p4', 'p0'); choose(room, 'p1', 'p0'); act(room, 'p0', { type: 'mafia_vote', targetId: 'p11' });
  act(room, 'p0', { type: 'chat', channel: 'team', text: 'رسالة سرية', clientId: 'message01' });
  assert.deepEqual(mafia.snapshot(room, 'p11', NOW), before);
  const publicJSON = JSON.stringify(before);
  assert.ok(!publicJSON.includes('roleStates')); assert.ok(!publicJSON.includes('initialFaction'));
  assert.equal(before.you.roleId, 'citizen');
  assert.equal(before.replay, null);
  assert.equal(mafia.snapshot(room, 'p1', NOW).chats.team.length, 1);
  until(room, 'nomination'); const beforeVote = mafia.snapshot(room, 'p11', NOW);
  act(room, 'p0', { type: 'nominate', targetId: 'p10' });
  assert.deepEqual(mafia.snapshot(room, 'p11', NOW), beforeVote);
});

test('converted players get subsequent team chat only and cannot infer older sequence numbers', () => {
  const room = setup(ROLES12); room.round = 2;
  act(room, 'p3', { type: 'chat', channel: 'team', text: 'قبل التحويل', clientId: 'shadow01' });
  choose(room, 'p3', 'p11'); step(room); until(room, 'night');
  assert.equal(mafia.snapshot(room, 'p11', NOW).chats.team.length, 0);
  act(room, 'p3', { type: 'chat', channel: 'team', text: 'أهلًا بك', clientId: 'shadow02' });
  const chat = mafia.snapshot(room, 'p11', NOW).chats.team;
  assert.equal(chat.length, 1); assert.equal(chat[0].id, 'team:1'); assert.equal(chat[0].text, 'أهلًا بك');
  assert.equal(chat[0].recipients, undefined); assert.equal(chat[0].viewIds, undefined);
});

test('dead players only listen to public voice and cannot communicate to alive; secret chats never enter replay', () => {
  const room = setup(ROLES12);
  act(room, 'p0', { type: 'chat', channel: 'team', text: 'الخطة الخاصة', clientId: 'secret01' });
  kill(room, 'p11'); step(room); until(room, 'discussion');
  assert.equal(mafia.voiceAudience(room, 'p11').canListen, true); assert.equal(mafia.voiceAudience(room, 'p11').canSpeak, false);
  assert.throws(() => act(room, 'p11', { type: 'chat', channel: 'public', text: 'أنا هنا', clientId: 'public01' }), { code: 'CHANNEL' });
  act(room, 'p11', { type: 'chat', channel: 'observers', text: 'نراقب من هنا', clientId: 'observe1' });
  assert.equal(mafia.snapshot(room, 'p10', NOW).chats.observers.length, 0);
  until(room, 'night'); assert.equal(mafia.voiceAudience(room, 'p11').key, null);
  mafia.technicalAbort(room, NOW + 500_000);
  const replay = mafia.snapshot(room, 'p11', NOW).replay;
  assert.ok(replay.players.length === 12);
  assert.ok(!JSON.stringify(replay).includes('الخطة الخاصة'));
  assert.ok(!JSON.stringify(replay).includes('نراقب من هنا'));
});

test('late joins cannot receive live state, role assignments, events, chat or voice', () => {
  const room = setup(ROLES12); mafia.leaveRoom(room, 'p11', NOW + 56_000);
  mafia.joinRoom(room, { ...input(12), name: 'منتظر جديد' }, NOW + 57_000);
  mafia.connected(room, 'p12', true, NOW + 57_000);
  const snapshot = mafia.snapshot(room, 'p12', NOW + 57_000);
  assert.equal(snapshot.waiting, true); assert.equal(snapshot.phase, 'waiting'); assert.equal(snapshot.you, null);
  assert.deepEqual(snapshot.log, []); assert.deepEqual(snapshot.participants, []); assert.equal(snapshot.deadlineAt, null);
  assert.equal(snapshot.members.every(m => m.alive === null), true);
  assert.equal(mafia.voiceAudience(room, 'p12').key, null);
  assert.throws(() => act(room, 'p12', { type: 'mafia_vote', targetId: 'p0' }), { code: 'ELIMINATED' });
});

test('disconnected player keeps confirmed selections; 90-second grace expires only at a settlement', () => {
  const room = setup(ROLES12); choose(room, 'p4', 'p0');
  const disconnectedAt = NOW + 56_000;
  mafia.connected(room, 'p4', false, disconnectedAt);
  mafia.tick(room, disconnectedAt + 89_999); assert.equal(room.roleStates.p4.alive, true);
  mafia.connected(room, 'p4', true, disconnectedAt + 89_999);
  assert.equal(room.roleStates.p4.alive, true); assert.equal(room.roleStates.p4.resources.charges, 1);
  mafia.connected(room, 'p4', false, disconnectedAt + 90_000);
  mafia.tick(room, disconnectedAt + 180_000); assert.equal(room.roleStates.p4.alive, true, 'grace expiry queues a settlement');
  assert.ok(room.pendingForfeits.p4);
  step(room); assert.equal(room.roleStates.p4.alive, false); assert.equal(room.roleStates.p4.forfeited, true);
});

test('a delayed alarm does not retroactively forfeit a player before grace expiry', () => {
  const room = setup(ROLES12); choose(room, 'p4', 'p0');
  mafia.connected(room, 'p4', false, NOW + 56_000);
  mafia.tick(room, NOW + 200_000);
  assert.equal(room.roleStates.p4.alive, true);
  assert.equal(room.privateEvents.p4[0]?.type, 'investigation', 'first night settled before the disconnect deadline');
  assert.ok(room.pendingForfeits.p4);
  step(room); assert.equal(room.roleStates.p4.alive, false);
});

test('reconnect after grace cannot clear a queued forfeiture, host cannot kick an active opponent', () => {
  const room = setup(ROLES12);
  mafia.connected(room, 'p11', false, NOW + 56_000);
  mafia.connected(room, 'p11', true, NOW + 56_000 + MAFIA_RECONNECT_MS);
  assert.ok(room.pendingForfeits.p11);
  assert.equal(mafia.voiceAudience(room, 'p11').key, null);
  assert.equal(mafia.snapshot(room, 'p11', NOW).you.actions.length, 0);
  assert.throws(() => act(room, 'p11', { type: 'chat', channel: 'team', text: 'محاولة', clientId: 'withdraw1' }, NOW + 147_000), { code: 'WITHDRAWN' });
  assert.throws(() => act(room, room.hostId, { type: 'kick', targetId: 'p11' }), { code: 'PHASE' });
});

test('idempotent receipts do not consume abilities twice, conflicting reuse and chat floods are rejected', () => {
  const room = setup(ROLES12); until(room, 'discussion');
  const command = { type: 'herald', requestId: 'once', matchId: room.matchId, phaseId: room.phaseId };
  mafia.action(room, 'p9', command, NOW); const deadline = room.deadlineAt;
  assert.equal(mafia.action(room, 'p9', command, NOW + 1), false); assert.equal(room.deadlineAt, deadline);
  assert.throws(() => mafia.action(room, 'p9', { ...command, type: 'night_action' }, NOW), { code: 'REQUEST_CONFLICT' });
  for (let i = 0; i < 6; i++) act(room, 'p11', { type: 'chat', channel: 'public', text: 'السلام عليكم', clientId: `chat_${String(i).padStart(4, '0')}` });
  assert.throws(() => act(room, 'p11', { type: 'chat', channel: 'public', text: 'مرحبا', clientId: 'chat_0007' }), { code: 'RATE_LIMIT' });
  assert.throws(() => act(room, 'p10', { type: 'chat', channel: 'public', text: 'kill yourself', clientId: 'chat_0008' }), { code: 'CONTENT_REJECTED' });
});

test('accepted night actions settle equivalently regardless of message order', () => {
  const source = setup(ROLES12); source.round = 2;
  const commands = [
    ['p2', { type: 'night_action', targetId: 'p5' }], ['p1', { type: 'night_action', targetId: 'p0' }],
    ['p4', { type: 'night_action', targetId: 'p0' }], ['p5', { type: 'night_action', targetId: 'p11' }],
    ['p3', { type: 'night_action', targetId: 'p4' }], ['p7', { type: 'night_action', targetId: 'p5' }],
    ['p10', { type: 'night_action', targetIds: ['p4', 'p3'] }],
    ['p0', { type: 'mafia_vote', targetId: 'p11' }], ['p1', { type: 'mafia_vote', targetId: 'p11' }],
  ];
  const left = structuredClone(source), right = structuredClone(source);
  for (const [id, command] of commands) act(left, id, command);
  for (const [id, command] of commands.toReversed()) act(right, id, command);
  step(left); step(right);
  assert.deepEqual(left.roleStates, right.roleStates); assert.deepEqual(left.privateEvents, right.privateEvents);
  assert.deepEqual(left.history, right.history); assert.deepEqual(left.audit, right.audit);
});
