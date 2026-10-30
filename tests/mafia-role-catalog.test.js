import test from 'node:test';
import assert from 'node:assert/strict';
import * as mafia from '../server/mafia-model.mjs';
import { MAFIA_ROLES, MAFIA_ROLE_GUIDES, MAFIA_ROLE_GUIDE_VERSION, MAFIA_RULESET_VERSION } from '../src/online/mafia-shared.js';

const NOW = 1_800_000_000_000;
const roles = ['mafia', 'masker', 'blocker', 'leader', 'investigator', 'doctor', 'guard', 'observer', 'reporter', 'herald', 'analyst', 'citizen'];
const person = n => ({ id: `p${n}`, name: `لاعب ${n}`, avatar: n % 4, tokenHash: `token-${n}` });
const act = (room, id, command) => mafia.action(room, id, { matchId: room.matchId, phaseId: room.phaseId, ...command }, room.deadlineAt - 1);
function step(room) { mafia.tick(room, room.deadlineAt); }
function until(room, phase) { for (let n = 0; room.phase !== phase && n < 12; n++) step(room); assert.equal(room.phase, phase); }
function roomWithRoles() {
  const room = mafia.createRoom('ABC123', { ...person(0), settings: { mode: 'shadow', capacity: 12, visibility: 'private' } }, NOW);
  for (let i = 1; i < 12; i++) mafia.joinRoom(room, person(i), NOW);
  for (const member of room.members) { mafia.connected(room, member.id, true, NOW); mafia.action(room, member.id, { type: 'ready', ready: true, matchId: room.matchId, phaseId: room.phaseId }, NOW); }
  let random = 5;
  mafia.action(room, 'p0', { type: 'start', matchId: room.matchId, phaseId: room.phaseId }, NOW, { randomWord: () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) });
  roles.forEach((roleId, n) => Object.assign(room.roleStates[`p${n}`], {
    roleId, faction: MAFIA_ROLES[roleId].faction, initialFaction: MAFIA_ROLES[roleId].faction,
    resources: { charges: MAFIA_ROLES[roleId].charges, shield: roleId === 'guard' ? 1 : 0, selfProtection: roleId === 'doctor' ? 1 : 0 },
  }));
  until(room, 'night');
  return room;
}
const choose = (room, id, targetId) => act(room, id, { type: 'night_action', targetId });
const attack = (room, targetId) => ['p0', 'p1', 'p2'].forEach(id => act(room, id, { type: 'mafia_vote', targetId }));
const ability = (room, id, type = 'night_action') => mafia.snapshot(room, id, room.deadlineAt - 2).you.actions.find(action => action.type === type);
function assertFrozenTree(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(assertFrozenTree); } }

test('all twelve public role guides have a frozen complete contract without room state or balance changes', () => {
  assert.equal(MAFIA_ROLE_GUIDE_VERSION, 1);
  assert.equal(MAFIA_RULESET_VERSION, 1);
  assert.deepEqual(Object.keys(MAFIA_ROLE_GUIDES).sort(), [...roles].sort());
  assert.deepEqual(Object.values(MAFIA_ROLES).map(role => role.charges), [null, 2, null, 1, 2, 1, 1, 1, null, 1, 1, 3]);
  assertFrozenTree(MAFIA_ROLE_GUIDES);
  for (const role of Object.values(MAFIA_ROLES)) {
    const guide = role.guide;
    assert.equal(guide, MAFIA_ROLE_GUIDES[role.id], 'one shared source for card, encyclopedia and contract');
    assert.deepEqual(Object.keys(guide).sort(), ['phase', 'timing', 'targets', 'evidence', 'visibility', 'selection', 'consumption', 'limitations', 'interactions', 'example'].sort());
    assert.ok(['none', 'night', 'discussion', 'passive'].includes(guide.phase));
    assert.ok(Number.isInteger(guide.targets.count) && guide.targets.count >= 0 && guide.targets.count <= 2);
    assert.equal(typeof guide.targets.self, 'boolean');
    for (const text of [guide.timing, guide.targets.description, guide.evidence.description, guide.visibility.description, guide.selection.description, guide.consumption.description, guide.example, ...guide.limitations, ...guide.interactions]) assert.match(text, /[\u0600-\u06ff]/u);
    assert.ok(guide.limitations.length && guide.interactions.length);
    assert.equal(typeof guide.selection.editable, 'boolean');
    assert.equal(typeof guide.selection.cancellable, 'boolean');
    for (const field of [guide.targets.scope, guide.evidence.kind, guide.visibility.kind, guide.consumption.when]) assert.match(field, /^[a-z_]+$/);
  }
  assert.doesNotMatch(JSON.stringify(MAFIA_ROLE_GUIDES), /"(?:playerId|targetId|targetIds|reports|assignments|roleStates|teamVotes|resources|tokenHash)"/);
});

test('documented timing and target counts agree with the authoritative action projection', () => {
  const room = roomWithRoles();
  for (const [n, roleId] of roles.entries()) {
    const guide = MAFIA_ROLES[roleId].guide, action = ability(room, `p${n}`, roleId === 'mafia' ? 'mafia_vote' : 'night_action');
    if (guide.phase !== 'night' || roleId === 'leader') assert.equal(action, undefined, roleId);
    else { assert.ok(action, roleId); assert.equal(action.count, guide.targets.count, roleId); }
  }
  assert.equal(MAFIA_ROLES.doctor.guide.targets.self, true);
  assert.ok(ability(room, 'p5').targets.includes('p5'));
  assert.equal(MAFIA_ROLES.analyst.guide.targets.count, 2);
  assert.throws(() => choose(room, 'p10', 'p4'), { code: 'TARGET' });
  room.round = 2;
  assert.ok(ability(room, 'p3').targets.includes('p0'), 'leader selector must include unknown Mafia; never a free faction detector');
  assert.equal(MAFIA_ROLES.leader.guide.targets.scope, 'living_non_shadow_other');
  assert.ok(ability(room, 'p1').targets.includes('p1'));
  assert.ok(!ability(room, 'p1').targets.includes('p4'));
});

test('a cancelled choice keeps its charge while a blocked accepted investigation consumes it at close', () => {
  const room = roomWithRoles(), guide = MAFIA_ROLES.investigator.guide;
  assert.equal(guide.selection.cancellable, true);
  assert.equal(guide.consumption.when, 'night_close');
  choose(room, 'p4', 'p0'); choose(room, 'p4', null);
  assert.equal(room.roleStates.p4.resources.charges, 2);
  step(room);
  assert.equal(room.roleStates.p4.resources.charges, 2);
  until(room, 'night');
  choose(room, 'p4', 'p0'); choose(room, 'p2', 'p4'); choose(room, 'p7', 'p4');
  assert.equal(room.roleStates.p4.resources.charges, 2, 'no early consumption');
  step(room);
  assert.equal(room.roleStates.p4.resources.charges, 1);
  assert.equal(room.privateEvents.p4.at(-1).type, 'no_result');
  assert.equal(room.privateEvents.p7.at(-1).acted, false, 'observer reports unblocked activity, not a successful outcome');
});

test('apparent evidence can be masked and recruitment retains the role and remaining charge', () => {
  const room = roomWithRoles();
  assert.equal(MAFIA_ROLES.investigator.guide.evidence.kind, 'apparent_faction');
  assert.equal(MAFIA_ROLES.analyst.guide.evidence.kind, 'apparent_faction_comparison');
  choose(room, 'p1', 'p0'); choose(room, 'p4', 'p0');
  act(room, 'p10', { type: 'night_action', targetIds: ['p0', 'p11'] });
  step(room);
  assert.equal(room.privateEvents.p4.at(-1).faction, 'town');
  assert.equal(room.privateEvents.p10.at(-1).same, true);
  assert.equal(room.roleStates.p0.faction, 'mafia');
  until(room, 'night');
  choose(room, 'p3', 'p4');
  step(room);
  assert.equal(room.roleStates.p4.roleId, 'investigator');
  assert.equal(room.roleStates.p4.faction, 'shadow');
  assert.equal(room.roleStates.p4.resources.charges, 1);
  assert.equal(MAFIA_ROLES.investigator.faction, 'town', 'public catalog remains the initial affiliation');
});

test('doctor protection preserves the passive shield; blocking its owner cannot remove the shield', () => {
  const room = roomWithRoles();
  assert.equal(MAFIA_ROLES.guard.guide.phase, 'passive');
  assert.equal(MAFIA_ROLES.guard.guide.consumption.when, 'unprotected_attack');
  choose(room, 'p5', 'p6'); attack(room, 'p6'); step(room);
  assert.equal(room.roleStates.p6.resources.shield, 1);
  until(room, 'night');
  assert.ok(!ability(room, 'p5').targets.includes('p6'));
  choose(room, 'p2', 'p6'); attack(room, 'p6'); step(room);
  assert.equal(room.roleStates.p6.alive, true);
  assert.equal(room.roleStates.p6.resources.shield, 0);
});

test('reporter reveals death-time affiliation anonymously, even when killed that night', () => {
  const room = roomWithRoles();
  attack(room, 'p11'); step(room); until(room, 'night');
  assert.equal(MAFIA_ROLES.reporter.guide.targets.scope, 'eliminated');
  assert.equal(MAFIA_ROLES.reporter.guide.evidence.kind, 'faction_at_death');
  assert.equal(MAFIA_ROLES.reporter.guide.visibility.kind, 'public_anonymous');
  assert.ok(ability(room, 'p8').targets.includes('p11'));
  choose(room, 'p8', 'p11'); attack(room, 'p8'); step(room);
  assert.equal(room.roleStates.p8.alive, false);
  const reveal = room.history.find(event => event.type === 'faction_revealed');
  assert.equal(reveal.playerId, 'p11'); assert.equal(reveal.faction, 'town');
  assert.ok(!Object.hasOwn(reveal, 'actorId') && !Object.hasOwn(reveal, 'reporterId'));
  assert.equal(room.roleStates.p8.resources.charges, 0);
});

test('herald is public and immediate in discussion; it is unavailable at night', () => {
  const room = roomWithRoles();
  assert.equal(MAFIA_ROLES.herald.guide.phase, 'discussion');
  assert.equal(MAFIA_ROLES.herald.guide.consumption.when, 'activation');
  assert.equal(MAFIA_ROLES.herald.guide.selection.cancellable, false);
  assert.equal(ability(room, 'p9', 'herald'), undefined);
  until(room, 'discussion');
  const deadline = room.deadlineAt;
  act(room, 'p9', { type: 'herald' });
  assert.equal(room.deadlineAt, deadline + 20_000);
  assert.equal(room.roleStates.p9.resources.charges, 0);
  assert.equal(room.history.at(-1).playerId, 'p9');
  assert.equal(ability(room, 'p9', 'herald'), undefined);
});
