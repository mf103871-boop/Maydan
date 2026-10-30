// Authoritative Mafia rules. Only snapshot(), voiceAudience() and matchResults()
// are projections; never send this room object or audit trail to a live client.
import { ROOM_TTL, HOST_GRACE, AVATARS, arabicNumber } from '../../online/shared.js';
import { MAFIA_PROTOCOL, MAFIA_RULESET_VERSION, MAFIA_EXPERIMENTAL_RULESET_VERSION, MAFIA_ALL_ROLES as MAFIA_ROLES, MAFIA_SUPPORT_ROLES, MAFIA_TIMERS, MAFIA_RECONNECT_MS, MAFIA_MAX_DAYS, MAFIA_MAX_MATCH_MS, mafiaComposition, mafiaMinimumPlayers, normalizeMafiaSettings } from '../../online/mafia-shared.js';
import { active, member, newMember, admitMember, extendForMatch, colorOf, fail, hasInvisible, profile, sameName } from '../../shared/room-primitives.mjs';
import { objectionableText } from '../../shared/moderation-filter.mjs';

const FINISHED = new Set(['lobby', 'over', 'closed']);
// A public waiting room fills with strangers. A seat whose phone has been gone
// this long frees its place (and its account's Mafia lease) instead of keeping
// the room listed with absent players and blocking the start.
export const MAFIA_PUBLIC_LOBBY_IDLE_MS = 120_000;
const idleSince = m => m.disconnectedAt ?? m.joinedAt ?? null;
const publicLobby = room => room.phase === 'lobby' && room.settings.visibility === 'public';
const DAY_VOICE = new Set(['opening', 'discussion', 'nomination', 'defense', 'verdict', 'over']);
const own = (object, key) => Object.hasOwn(object, key);
const copy = value => structuredClone(value);
const living = room => room.participants.filter(id => room.roleStates[id]?.alive);
const publicChange = room => { room.publicRevision = (room.publicRevision || 0) + 1; };
const seat = (room, id) => room.members.find(m => m.id === id);
const state = (room, id) => room.roleStates[id] || null;
const aliveState = (room, id) => { const s = state(room, id); if (!s?.alive) fail('ELIMINATED', 403); return s; };
const isRunning = room => !FINISHED.has(room.phase);

// The host only deals, restarts and kicks in the lobby. When the seat must be
// handed over (left, or gone past its grace), prefer a connected member who can
// actually start a match (canHost: a live authenticated account, refreshed by
// the server at join/reconnect), then a player of the current match. No billing priority.
function transferHost(room, now, immediate = false) {
  const host = room.members.find(m => m.id === room.hostId && !m.left);
  if (host?.connected) { room.hostMissingSince = null; return; }
  room.hostMissingSince ??= now;
  const candidates = active(room).filter(m => m.connected), playing = m => (room.participants || []).includes(m.id);
  const next = candidates.find(m => m.canHost && playing(m)) || candidates.find(m => m.canHost) || candidates.find(playing) || candidates[0];
  if (next && (immediate || !host || now >= room.hostMissingSince + HOST_GRACE)) { room.hostId = next.id; room.hostMissingSince = null; }
}
function publicEvent(room, type, now, data = {}) {
  room.publicSequence += 1;
  room.history.push({ id: room.publicSequence, type, at: now, round: room.round, ...data });
  if (room.history.length > 256) room.history.shift();
  publicChange(room);
}
function report(room, id, type, now, data = {}) {
  const reports = room.privateEvents[id] ||= [];
  reports.push({ id: reports.length + 1, type, at: now, round: room.round, ...data });
}
function audit(room, type, now, data = {}) { room.audit.push({ type, at: now, round: room.round, ...data }); }
function phase(room, name, now, seconds = MAFIA_TIMERS[name]) {
  room.phase = name; room.phaseId += 1;
  room.deadlineAt = seconds ? now + seconds * 1000 : null;
  publicChange(room);
}
// Rejection sampling avoids modulo bias. Injection is an explicit argument to
// action(), never a stored seed or anything accepted from a client command.
function randomBelow(max, randomWord) {
  const cap = Math.floor(0x100000000 / max) * max;
  let n;
  do {
    n = randomWord ? randomWord() : crypto.getRandomValues(new Uint32Array(1))[0];
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('Invalid random source');
  } while (n >= cap);
  return n % max;
}
function shuffle(values, randomWord) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomBelow(i + 1, randomWord);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createRoom(code, input, now) {
  const settings = normalizeMafiaSettings(input.settings);
  if (!settings) fail('INVALID');
  settings.roomName ||= Array.from(`مجلس ${profile(input).name}`).slice(0,30).join('');
  if (objectionableText(settings.roomName)) fail('CONTENT_REJECTED',422);
  return {
    game: 'mafia', protocol: MAFIA_PROTOCOL, code, revision: 0, publicRevision: 0, publicSequence: 0, settingsRevision: 0,
    rulesetVersion: settings.experimentalRole==='tracker'?MAFIA_EXPERIMENTAL_RULESET_VERSION:MAFIA_RULESET_VERSION, createdAt: now, expiresAt: now + ROOM_TTL,
    hostId: input.id, hostMissingSince: now, phase: 'lobby', phaseId: 0, matchId: 0,
    round: 0, settings, deadlineAt: null, startedAt: null, reason: null,
    members: [newMember(input, now, { host: true })], banned: [], participants: [],
    roleStates: {}, scores: {}, history: [], audit: [], privateEvents: {},
    nightActions: {}, killVotes: {}, nominationVotes: {}, verdictVotes: {}, nomineeId: null,
    chats: { public: [], mafia: [], shadow: [], observers: [] }, chatSequences: {},
    chatRate: {}, receipts: {}, pendingForfeits: {}, outcome: null, winners: [],
  };
}

// A public card or quick join has no name field to correct, so a repeated name
// takes the first free number ("سارة ٢") instead of refusing the seat.
function freeName(room, name) {
  const taken = candidate => active(room).some(m => sameName(m.name, candidate));
  if (!taken(name)) return name;
  for (let n = 2; n <= 13; n++) {
    const suffix = ` ${arabicNumber(n)}`;
    const candidate = Array.from(name).slice(0, 20 - Array.from(suffix).length).join('').trim() + suffix;
    if (!taken(candidate)) return candidate;
  }
  return name;
}
export function joinRoom(room, input, now) {
  if (room.phase === 'closed') fail('CLOSED', 409);
  const wasPresent = room.members.some(m => m.id === input.id && !m.left);
  // A kick removes the account, not only its seat: a fresh seat from the same
  // account cannot walk back in through a public card or quick join.
  if (!wasPresent && input.accountUserId && room.banned.some(entry => entry.accountUserId === input.accountUserId)) fail('BANNED', 403);
  if (!wasPresent && active(room).length >= room.settings.capacity) fail('FULL', 409);
  const seat = !wasPresent && input.matchmaking ? { ...input, name: freeName(room, profile(input).name) } : input;
  const result = admitMember(room, seat, now, { lateJoin: true });
  if (!wasPresent) publicChange(room);
  return result;
}

export function connected(room, id, value, now) {
  const m = member(room, id);
  if (m.connected === value) return;
  if (value && isRunning(room) && m.disconnectedAt != null && now >= m.disconnectedAt + MAFIA_RECONNECT_MS && state(room, id)?.alive) room.pendingForfeits[id] ||= { reason: 'disconnect', at: m.disconnectedAt + MAFIA_RECONNECT_MS };
  m.connected = value;
  m.disconnectedAt = value ? null : (m.disconnectedAt ?? now);
  const previousHost = room.hostId;
  transferHost(room, now);
  publicChange(room);
  if (previousHost !== room.hostId) publicEvent(room, 'host_changed', now, { playerId: room.hostId });
}

export function leaveRoom(room, id, now) {
  const m = member(room, id);
  if (isRunning(room) && state(room, id)?.alive) room.pendingForfeits[id] ||= { reason: 'leave', at: now };
  m.left = true; m.connected = false; m.ready = false;
  transferHost(room, now, room.hostId === id);
  if (room.phase === 'lobby') room.members = active(room);
  publicChange(room);
  if (!active(room).length) {
    if (isRunning(room)) technicalAbort(room, now, 'players_left');
    room.phase = 'closed'; room.phaseId += 1; room.deadlineAt = null;
  }
}

function start(room, now, randomWord) {
  if (room.phase !== 'lobby') fail('PHASE', 409);
  const members = active(room);
  if (members.length < mafiaMinimumPlayers(room.settings.mode) || members.length > room.settings.capacity) fail('PLAYERS', 409);
  if(room.rulesetVersion===2&&members.length<8)fail('PLAYERS',409);
  if (!members.every(m => m.connected && m.ready)) fail('NOT_READY', 409);
  const composition = mafiaComposition(members.length);
  const roles = ['investigator', 'doctor', 'mafia'];
  if (composition.mafia === 2) roles.push(randomBelow(2, randomWord) === 0 ? 'masker' : 'blocker');
  if (composition.mafia === 3) roles.push('masker', 'blocker');
  if (composition.shadow) roles.push('leader');
  roles.push(...shuffle(MAFIA_SUPPORT_ROLES, randomWord).slice(0, composition.support));
  if(room.rulesetVersion===2){const supportIndex=roles.findIndex(role=>MAFIA_SUPPORT_ROLES.includes(role));if(supportIndex<0)fail('PLAYERS',409);roles[supportIndex]='tracker';}
  while (roles.length < members.length) roles.push('citizen');
  const assigned = shuffle(roles, randomWord);
  extendForMatch(room, now);
  room.matchId += 1; room.round = 0; room.startedAt = now; room.reason = null;
  room.participants = members.map(m => m.id);
  room.roleStates = {}; room.privateEvents = {}; room.audit = []; room.history = []; room.publicSequence = 0;
  room.nightActions = {}; room.killVotes = {}; room.nominationVotes = {}; room.verdictVotes = {};
  room.pendingForfeits = {}; room.nomineeId = null; room.winners = []; room.outcome = null;
  room.chats = { public: [], mafia: [], shadow: [], observers: [] }; room.chatSequences = {}; room.chatRate = {};
  members.forEach((m, index) => {
    const roleId = assigned[index], definition = MAFIA_ROLES[roleId];
    room.roleStates[m.id] = {
      roleId, faction: definition.faction, initialFaction: definition.faction, alive: true,
      resources: { charges: definition.charges, selfProtection: roleId === 'doctor' ? 1 : 0, shield: roleId === 'guard' ? 1 : 0 },
      lastProtectedId: null, teamSince: now, eliminatedAt: null, factionAtDeath: null,
      convertedAt: null, forfeited: false,
    };
    room.privateEvents[m.id] = [];
    room.scores[m.id] = 0;
  });
  audit(room, 'roles', now, { assignments: room.participants.map(id => ({ playerId: id, roleId: state(room, id).roleId, faction: state(room, id).faction })) });
  publicEvent(room, 'match_started', now, { count: members.length, composition });
  phase(room, 'role', now);
}

function eliminate(room, id, now, reason) {
  const s = state(room, id);
  if (!s?.alive) return;
  s.alive = false; s.eliminatedAt = now; s.factionAtDeath = s.faction;
  s.forfeited = reason === 'forfeit';
  audit(room, 'eliminated', now, { playerId: id, reason, faction: s.faction, roleId: s.roleId });
  publicEvent(room, 'eliminated', now, { playerId: id, reason });
}
function markExpiredForfeits(room, now) {
  for (const id of living(room)) {
    const m = seat(room, id);
    if (!m?.left && !m?.connected && m?.disconnectedAt != null && now >= m.disconnectedAt + MAFIA_RECONNECT_MS) room.pendingForfeits[id] ||= { reason: 'disconnect', at: m.disconnectedAt + MAFIA_RECONNECT_MS };
  }
}
function flushForfeits(room, now) {
  markExpiredForfeits(room, now);
  for (const id of room.participants) if (room.pendingForfeits[id]?.at <= now) {
    eliminate(room, id, now, 'forfeit');
    delete room.pendingForfeits[id];
  }
}

export function winningFaction(room) {
  const counts = { town: 0, mafia: 0, shadow: 0 };
  for (const id of living(room)) counts[state(room, id).faction] += 1;
  const { town, mafia, shadow } = counts;
  if (!town && !mafia && !shadow) return 'draw';
  if (mafia && mafia >= town + shadow) return 'mafia';
  if (mafia) return null;
  if (shadow > town) return 'shadow';
  const leaderAlive = living(room).some(id => state(room, id).roleId === 'leader');
  if (!shadow || (!leaderAlive && town > shadow)) return 'town';
  if (!leaderAlive && town === shadow) return 'draw';
  return null;
}
function finish(room, now, faction, reason) {
  room.outcome = { faction, reason, endedAt: now };
  room.reason = reason;
  room.winners = faction === 'draw' ? [] : room.participants.filter(id => state(room, id).faction === faction);
  for (const id of room.participants) room.scores[id] = room.winners.includes(id) ? 1 : 0;
  phase(room, 'over', now, 0);
  publicEvent(room, 'match_ended', now, { faction, reason });
}
function maybeFinish(room, now) {
  const winner = winningFaction(room);
  if (winner) { finish(room, now, winner, 'faction'); return true; }
  return false;
}
export function technicalAbort(room, now, reason = 'voice_unavailable') {
  if (!isRunning(room)) return false;
  finish(room, now, 'draw', reason);
  room.technicalAbort = true;
  return true;
}
function beginNight(room, now) {
  if (room.round >= MAFIA_MAX_DAYS) { finish(room, now, 'draw', 'day_limit'); return; }
  room.round += 1;
  room.nightActions = {}; room.killVotes = {}; room.nominationVotes = {}; room.verdictVotes = {}; room.nomineeId = null;
  publicEvent(room, 'night_started', now);
  phase(room, 'night', now);
}
function topTarget(values) {
  const counts = new Map();
  for (const id of values) if (id) counts.set(id, (counts.get(id) || 0) + 1);
  const max = Math.max(0, ...counts.values());
  const top = [...counts.entries()].filter(([, n]) => n === max).map(([id]) => id);
  return max && top.length === 1 ? top[0] : null;
}

function settleNight(room, now) {
  // Copy the accepted choices before resolving any death. Submission order has
  // no bearing on resolution and all limited charges are spent at this boundary.
  const actors = living(room);
  const actions = actors.filter(id => room.nightActions[id]).map(id => ({ id, ...room.nightActions[id] }));
  const ballots = actors.filter(id => state(room, id).faction === 'mafia' && own(room.killVotes, id));
  for (const a of actions) {
    const s = state(room, a.id);
    if (s.resources.charges != null) s.resources.charges -= 1;
    if (s.roleId === 'doctor') {
      s.lastProtectedId = a.targetId;
      if (a.targetId === a.id) s.resources.selfProtection -= 1;
    }
    audit(room, 'night_action', now, { playerId: a.id, roleId: s.roleId, targetId: a.targetId ?? null, targetIds: a.targetIds ?? null });
  }
  for (const id of actors) if (state(room, id).roleId === 'doctor' && !room.nightActions[id]) state(room, id).lastProtectedId = null;
  for (const id of ballots) audit(room, 'attack_vote', now, { playerId: id, targetId: room.killVotes[id] });
  const blocked = new Set(actions.filter(a => state(room, a.id).roleId === 'blocker').map(a => a.targetId));
  const effective = actions.filter(a => !blocked.has(a.id));
  const masked = new Set(effective.filter(a => state(room, a.id).roleId === 'masker').map(a => a.targetId));
  const protectedIds = new Set(effective.filter(a => state(room, a.id).roleId === 'doctor').map(a => a.targetId));
  const targetId = topTarget(ballots.map(id => room.killVotes[id]));
  let attacked = false;
  if (targetId && state(room, targetId)?.alive && !protectedIds.has(targetId)) {
    const victim = state(room, targetId);
    if (victim.resources.shield > 0) {
      victim.resources.shield -= 1;
      report(room, targetId, 'shield_used', now);
      audit(room, 'shield_used', now, { playerId: targetId });
    } else { eliminate(room, targetId, now, 'night'); attacked = true; }
  }
  // A seat whose return grace expired counts as withdrawn at settlement. Their
  // confirmed choices remain, but a departing leader/target cannot be recruited.
  flushForfeits(room, now);
  for (const a of effective.filter(a => state(room, a.id).roleId === 'leader')) {
    const leader = state(room, a.id), target = state(room, a.targetId);
    const success = leader.alive && target?.alive && target.faction === 'town';
    if (success) {
      target.faction = 'shadow'; target.convertedAt = now; target.teamSince = now;
      audit(room, 'converted', now, { playerId: a.targetId, recruiterId: a.id, roleId: target.roleId });
      report(room, a.targetId, 'converted', now, { faction: 'shadow' });
    }
    if (leader.alive) report(room, a.id, 'recruitment', now, { success: Boolean(success), ...(success ? { targetId: a.targetId } : {}) });
  }
  // A blocked recruitment also gets the same generic failure, never its cause.
  for (const a of actions.filter(a => state(room, a.id).roleId === 'leader' && blocked.has(a.id))) if (state(room, a.id).alive) report(room, a.id, 'recruitment', now, { success: false });
  const apparentFaction = id => masked.has(id) ? 'town' : state(room, id).faction;
  const acted = new Set([...effective.map(a => a.id), ...ballots.filter(id => room.killVotes[id] && !blocked.has(id))]);
  for (const a of effective) {
    const s = state(room, a.id);
    if (s.roleId === 'reporter') {
      const target = state(room, a.targetId);
      // The reveal is public; who revealed it is not. Naming the reporter here would
      // reach every phone and hand the Mafia its next target. The replay keeps it.
      if (target?.factionAtDeath) publicEvent(room, 'faction_revealed', now, { playerId: a.targetId, faction: target.factionAtDeath });
    }
    if (!s.alive) continue;
    if (s.roleId === 'investigator') report(room, a.id, 'investigation', now, { targetId: a.targetId, faction: apparentFaction(a.targetId) });
    if (s.roleId === 'analyst') report(room, a.id, 'comparison', now, { targetIds: a.targetIds, same: apparentFaction(a.targetIds[0]) === apparentFaction(a.targetIds[1]) });
    if (s.roleId === 'observer') report(room, a.id, 'activity', now, { targetId: a.targetId, acted: acted.has(a.targetId) });
    if (s.roleId === 'tracker' && room.rulesetVersion === 2) {
      // Visits describe accepted outgoing selections, never their ability type,
      // success, alignment, incoming visitors or the aggregate Mafia attack.
      // An actor's ability and own attack ballot are merged in public seat order.
      const observed = effective.find(choice => choice.id === a.targetId);
      const destinations = new Set(observed ? observed.targetIds || [observed.targetId] : []);
      if(ballots.includes(a.targetId)&&!blocked.has(a.targetId)&&room.killVotes[a.targetId])destinations.add(room.killVotes[a.targetId]);
      const destinationIds=room.participants.filter(id=>destinations.has(id));
      report(room,a.id,'tracking',now,{targetId:a.targetId,destinationIds});
      audit(room,'tracking_report',now,{playerId:a.id,targetId:a.targetId,destinationIds});
    }
  }
  for (const a of actions.filter(a => blocked.has(a.id) && ['investigator', 'analyst', 'observer', ...(room.rulesetVersion===2?['tracker']:[])].includes(state(room, a.id).roleId))) if (state(room, a.id).alive) report(room, a.id, 'no_result', now);
  room.nightActions = {}; room.killVotes = {};
  publicEvent(room, 'dawn', now, { peaceful: !attacked });
  if (!maybeFinish(room, now)) phase(room, 'dawn', now);
}

function advance(room, now) {
  if (room.phase === 'night') { settleNight(room, now); return; }
  flushForfeits(room, now);
  if (maybeFinish(room, now)) return;
  switch (room.phase) {
    case 'role': phase(room, 'opening', now); break;
    case 'opening': beginNight(room, now); break;
    case 'dawn': phase(room, 'discussion', now, room.settings.mode === 'shadow' ? MAFIA_TIMERS.shadowDiscussion : MAFIA_TIMERS.discussion); break;
    case 'discussion': room.nominationVotes = {}; phase(room, 'nomination', now); break;
    case 'nomination': {
      const nomineeId = topTarget(Object.values(room.nominationVotes).filter(id => !id || state(room, id)?.alive));
      room.nomineeId = nomineeId;
      publicEvent(room, 'nomination_closed', now, { nomineeId });
      if (nomineeId) phase(room, 'defense', now);
      else beginNight(room, now);
      break;
    }
    case 'defense':
      if (!state(room, room.nomineeId)?.alive) beginNight(room, now);
      else { room.verdictVotes = {}; phase(room, 'verdict', now); }
      break;
    case 'verdict': {
      const alive = living(room);
      const approvals = alive.filter(id => room.verdictVotes[id] === true).length;
      const passed = approvals > alive.length / 2;
      audit(room, 'verdict_votes', now, { votes: copy(room.verdictVotes), nomineeId: room.nomineeId });
      publicEvent(room, 'verdict_closed', now, { nomineeId: room.nomineeId, approvals, total: alive.length, passed });
      if (passed) eliminate(room, room.nomineeId, now, 'verdict');
      if (!maybeFinish(room, now)) beginNight(room, now);
      break;
    }
    default: break;
  }
}

export function tick(room, now) {
  if (now >= room.expiresAt) {
    if (isRunning(room)) finish(room, now, 'draw', 'expired');
    room.phase = 'closed'; room.phaseId += 1; room.reason = 'expired'; room.deadlineAt = null; publicChange(room); return;
  }
  if (publicLobby(room)) for (const m of active(room)) if (!m.connected && idleSince(m) != null && now >= idleSince(m) + MAFIA_PUBLIC_LOBBY_IDLE_MS && room.phase === 'lobby') leaveRoom(room, m.id, now);
  if (room.phase === 'closed') return;
  const oldHost = room.hostId;
  transferHost(room, now);
  if (oldHost !== room.hostId) publicEvent(room, 'host_changed', now, { playerId: room.hostId });
  if (!isRunning(room)) return;
  const limitAt = room.startedAt + MAFIA_MAX_MATCH_MS;
  // Delayed alarms settle each phase at its original deadline. Never give a
  // late websocket command fresh time by resetting the clock to delivery time.
  let guard = 0;
  while (isRunning(room) && room.deadlineAt != null && now >= room.deadlineAt && room.deadlineAt <= limitAt && guard++ < 100) advance(room, room.deadlineAt);
  if (isRunning(room)) markExpiredForfeits(room, now);
  if (isRunning(room) && now >= limitAt) finish(room, limitAt, 'draw', 'time_limit');
}

export function nextAlarm(room, now) {
  const deadlines = [room.expiresAt];
  if (isRunning(room)) {
    deadlines.push(room.deadlineAt, room.startedAt + MAFIA_MAX_MATCH_MS);
    for (const id of living(room)) {
      const m = seat(room, id);
      if (!m?.left && !m?.connected && m?.disconnectedAt != null && !room.pendingForfeits[id]) deadlines.push(m.disconnectedAt + MAFIA_RECONNECT_MS);
    }
  }
  if (room.hostMissingSince != null && active(room).some(m => m.connected)) deadlines.push(room.hostMissingSince + HOST_GRACE);
  if (publicLobby(room)) for (const m of active(room)) if (!m.connected && idleSince(m) != null) deadlines.push(idleSince(m) + MAFIA_PUBLIC_LOBBY_IDLE_MS);
  return Math.max(now + 1, Math.min(...deadlines.filter(Number.isFinite)));
}

function nightTargets(room, id) {
  const s = state(room, id);
  const alive = living(room);
  if (!s?.alive) return [];
  switch (s.roleId) {
    case 'reporter': return room.participants.filter(other => !state(room, other).alive && state(room, other).factionAtDeath);
    case 'doctor': return alive.filter(other => other !== s.lastProtectedId && (other !== id || s.resources.selfProtection > 0));
    case 'masker': return alive.filter(other => state(room, other).faction === 'mafia');
    case 'blocker': return alive.filter(other => state(room, other).faction !== 'mafia');
    // The leader may select any unknown non-ally; rejecting a hidden Mafia target
    // here would turn the recruitment selector into a free alignment detector.
    case 'leader': return alive.filter(other => other !== id && state(room, other).faction !== 'shadow');
    default: return alive.filter(other => other !== id);
  }
}
function canNightAction(room, s) {
  return s?.alive && room.phase === 'night' && !['citizen', 'guard', 'herald', 'mafia'].includes(s.roleId)
    && (s.resources.charges == null || s.resources.charges > 0)
    && (s.roleId !== 'leader' || [2, 4, 6].includes(room.round));
}
function chooseNightAction(room, id, command) {
  const s = aliveState(room, id);
  if (!canNightAction(room, s)) fail('ABILITY_UNAVAILABLE', 409);
  if (command.targetId === null && command.targetIds == null) { delete room.nightActions[id]; return; }
  const targets = nightTargets(room, id);
  if (s.roleId === 'analyst') {
    if (!Array.isArray(command.targetIds) || command.targetIds.length !== 2 || command.targetIds[0] === command.targetIds[1] || !command.targetIds.every(target => targets.includes(target))) fail('TARGET', 409);
    room.nightActions[id] = { targetIds: [...command.targetIds].sort() };
  } else {
    if (!targets.includes(command.targetId)) fail('TARGET', 409);
    room.nightActions[id] = { targetId: command.targetId };
  }
}

export function voiceAudience(room, id) {
  const s = state(room, id), m = seat(room, id);
  const none = { key: null, canSpeak: false, canListen: false, epoch: room.phaseId };
  if (!s || !m || m.left || !m.connected || room.phase === 'closed' || room.pendingForfeits[id]) return none;
  if (room.phase === 'night') {
    if (!s.alive || s.faction === 'town') return none;
    return { key: s.faction, canSpeak: true, canListen: true, epoch: room.phaseId };
  }
  if (DAY_VOICE.has(room.phase)) return { key: 'public', canSpeak: (s.alive || room.phase === 'over') && (room.phase !== 'defense' || id === room.nomineeId), canListen: true, epoch: room.phaseId };
  return none;
}
export function voiceGroups(room) {
  return ['public', 'mafia', 'shadow'].map(key => ({ key, epoch: room.phaseId, members: room.participants.map(id => ({ playerId: id, ...voiceAudience(room, id) })).filter(a => a.key === key) })).filter(group => group.members.length);
}
function chatPermission(room, id, requested) {
  if(room.phase==='lobby'&&requested==='public')return 'public';
  const s = state(room, id);
  if (!s) fail('WAITING', 403);
  if (requested === 'team') {
    if (room.phase !== 'night' || !s.alive || s.faction === 'town') fail('CHANNEL', 403);
    return s.faction;
  }
  if (requested === 'observers') {
    if (s.alive || ['over', 'closed'].includes(room.phase)) fail('CHANNEL', 403);
    return 'observers';
  }
  if (requested !== 'public' || !DAY_VOICE.has(room.phase) || (!s.alive && room.phase !== 'over') || (room.phase === 'defense' && room.nomineeId !== id)) fail('CHANNEL', 403);
  return 'public';
}
function sendChat(room, id, command, now) {
  const channel = chatPermission(room, id, command.channel);
  if (typeof command.text !== 'string' || hasInvisible(command.text)) fail('TEXT');
  const text = command.text.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!text || Array.from(text).length > 500) fail('TEXT');
  if (objectionableText(text)) fail('CONTENT_REJECTED', 422);
  if (typeof command.clientId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(command.clientId)) fail('INVALID');
  if (room.chats[channel].some(m => m.playerId === id && m.clientId === command.clientId)) return;
  const recent = (room.chatRate[id] || []).filter(at => now - at < 10_000);
  if (recent.length >= 6) fail('RATE_LIMIT', 429);
  room.chatRate[id] = [...recent, now];
  const recipients = channel === 'public' ? (room.phase==='lobby'?active(room).map(m=>m.id):[...room.participants]) : room.participants.filter(other => {
    const s = state(room, other);
    return channel === 'observers' ? !s.alive : s.alive && s.faction === channel;
  });
  const viewIds = {};
  for (const recipient of recipients) {
    const key = `${channel}:${recipient}`;
    room.chatSequences[key] = (room.chatSequences[key] || 0) + 1;
    viewIds[recipient] = String(room.chatSequences[key]);
  }
  if(channel==='public')room.publicChatSequence=(room.publicChatSequence||0)+1;
  room.chats[channel].push({ clientId: command.clientId, playerId: id, text, at: now, recipients, viewIds, ...(channel==='public'?{publicId:`${room.matchId}:${room.publicChatSequence}`}:{}) });
  if (room.chats[channel].length > 100) room.chats[channel].shift();
  if (channel === 'public') publicChange(room);
}

export function action(room, actorId, command, now, options = {}) {
  const actor = member(room, actorId);
  if (!actor.connected) fail('DISCONNECTED', 409);
  if (!command || typeof command.type !== 'string') fail('INVALID');
  const requestId = command.requestId;
  if (requestId != null && (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId))) fail('INVALID');
  const receiptKey = requestId ? `${command.matchId}:${requestId}` : null;
  const fingerprint = JSON.stringify(command);
  const receipts = room.receipts[actorId] || [];
  const receipt = receiptKey && receipts.find(r => r.key === receiptKey);
  if (receipt) { if (receipt.fingerprint !== fingerprint) fail('REQUEST_CONFLICT', 409); return false; }
  if (command.matchId !== room.matchId || command.phaseId !== room.phaseId) fail('STALE', 409);
  if (room.phase === 'closed') fail('CLOSED', 409);
  if (isRunning(room) && room.pendingForfeits[actorId]?.at <= now) fail('WITHDRAWN', 409);
  if (room.deadlineAt != null && now >= room.deadlineAt) fail('STALE', 409);
  const host = () => { if (actorId !== room.hostId) fail('HOST_ONLY', 403); };
  switch (command.type) {
    case 'ready':
      if (room.phase !== 'lobby' || typeof command.ready !== 'boolean') fail('PHASE', 409);
      actor.ready = command.ready; publicChange(room); break;
    case 'settings': {
      host(); if (room.phase !== 'lobby') fail('PHASE', 409);
      const settings = normalizeMafiaSettings(command.settings);
      if (!settings || settings.capacity < active(room).length) fail('INVALID');
      // A room keeps its saved semantics through lobby edits and rematches.
      if((settings.experimentalRole==='tracker')!==(room.rulesetVersion===2))fail('MAFIA_RULESET_FIXED',409);
      settings.roomName ||= Array.from(`مجلس ${actor.name}`).slice(0,30).join('');
      if(objectionableText(settings.roomName))fail('CONTENT_REJECTED',422);
      if(command.expectedSettingsRevision!=null&&command.expectedSettingsRevision!==(room.settingsRevision||0))fail('CONFLICT',409);
      // Another mode, or a room opened to or closed from strangers, is not the
      // match the others readied for, so they confirm again.
      if (JSON.stringify(settings)!==JSON.stringify(normalizeMafiaSettings(room.settings))) for (const m of active(room)) m.ready = false;
      room.settingsRevision=(room.settingsRevision||0)+1;
      room.settings = settings; publicChange(room); break;
    }
    case 'start': host(); start(room, now, options?.randomWord); break;
    case 'restart':
      host(); if (room.phase !== 'over') fail('PHASE', 409);
      room.members = active(room); room.participants = []; room.roleStates = {};
      room.history = []; room.audit = []; room.privateEvents = {}; room.pendingForfeits = {};
      room.chats = { public: [], mafia: [], shadow: [], observers: [] }; room.chatSequences = {}; room.chatRate = {};
      room.nightActions = {}; room.killVotes = {}; room.nominationVotes = {}; room.verdictVotes = {};
      room.outcome = null; room.technicalAbort = false; room.winners = []; room.round = 0; room.startedAt = null; room.nomineeId = null; room.reason = null;
      for (const m of room.members) m.ready = m.id === room.hostId;
      phase(room, 'lobby', now, 0); break;
    case 'host': {
      // A host may hand the waiting room to a connected member, e.g. one who can start it.
      host(); if (room.phase !== 'lobby') fail('PHASE', 409);
      const target = room.members.find(m => m.id === command.targetId && !m.left);
      if (!target || target.id === actorId || !target.connected) fail('TARGET', 409);
      room.hostId = target.id; room.hostMissingSince = null;
      publicEvent(room, 'host_changed', now, { playerId: target.id }); break;
    }
    case 'kick': {
      host(); if (room.phase !== 'lobby') fail('PHASE', 409);
      if (command.targetId === actorId) fail('INVALID');
      const target = member(room, command.targetId);
      room.banned = [...room.banned, { id: target.id, tokenHash: target.tokenHash, ...(target.accountUserId ? { accountUserId: target.accountUserId } : {}) }].slice(-32);
      leaveRoom(room, target.id, now); break;
    }
    case 'night_action': chooseNightAction(room, actorId, command); break;
    case 'mafia_vote': {
      const s = aliveState(room, actorId);
      if (room.phase !== 'night' || s.faction !== 'mafia') fail('ABILITY_UNAVAILABLE', 403);
      if (command.targetId !== null && (!state(room, command.targetId)?.alive || state(room, command.targetId).faction === 'mafia')) fail('TARGET', 409);
      room.killVotes[actorId] = command.targetId; break;
    }
    case 'nominate':
      aliveState(room, actorId);
      if (room.phase !== 'nomination') fail('PHASE', 409);
      if (own(room.nominationVotes, actorId)) fail('ALREADY_VOTED', 409);
      if (command.targetId !== null && !state(room, command.targetId)?.alive) fail('TARGET', 409);
      room.nominationVotes[actorId] = command.targetId;
      audit(room, 'nomination_vote', now, { playerId: actorId, targetId: command.targetId }); break;
    case 'verdict':
      aliveState(room, actorId);
      if (room.phase !== 'verdict' || typeof command.approve !== 'boolean') fail('PHASE', 409);
      if (own(room.verdictVotes, actorId)) fail('ALREADY_VOTED', 409);
      room.verdictVotes[actorId] = command.approve; break;
    case 'herald': {
      const s = aliveState(room, actorId);
      if (room.phase !== 'discussion' || s.roleId !== 'herald' || s.resources.charges < 1) fail('ABILITY_UNAVAILABLE', 409);
      s.resources.charges -= 1; room.deadlineAt += 20_000;
      audit(room, 'extended', now, { playerId: actorId }); publicEvent(room, 'extended', now, { playerId: actorId, seconds: 20 }); break;
    }
    case 'chat': sendChat(room, actorId, command, now); break;
    default: fail('INVALID');
  }
  if (receiptKey) room.receipts[actorId] = [...receipts, { key: receiptKey, fingerprint }].slice(-128);
  return true;
}

function availableActions(room, id) {
  const s = state(room, id), actions = [];
  if (!s?.alive || room.pendingForfeits[id]) return actions;
  if (canNightAction(room, s)) actions.push({ type: 'night_action', ability: MAFIA_ROLES[s.roleId].ability, targets: nightTargets(room, id), count: s.roleId === 'analyst' ? 2 : 1, remaining: s.resources.charges });
  if (room.phase === 'night' && s.faction === 'mafia') actions.push({ type: 'mafia_vote', targets: living(room).filter(other => state(room, other).faction !== 'mafia'), count: 1, remaining: null });
  if (room.phase === 'discussion' && s.roleId === 'herald' && s.resources.charges > 0) actions.push({ type: 'herald', targets: [], count: 0, remaining: 1 });
  if (room.phase === 'nomination' && !own(room.nominationVotes, id)) actions.push({ type: 'nominate', targets: living(room), count: 1, remaining: 1 });
  if (room.phase === 'verdict' && !own(room.verdictVotes, id)) actions.push({ type: 'verdict', targets: [], count: 0, remaining: 1 });
  return actions;
}
function visibleChats(room, id) {
  if(room.phase==='lobby')return {public:room.chats.public.map(({recipients:_r,viewIds:_v,clientId:_c,...m})=>({...m,id:m.publicId})),team:[],observers:[]};
  const s = state(room, id);
  if (!s) return { public: [], team: [], observers: [] };
  const project = (list, label) => list.filter(m => m.recipients.includes(id)).map(({ recipients: _recipients, viewIds, ...m }) => ({ ...m, id: `${label}:${viewIds[id]}` }));
  return {
    public: project(room.chats.public, 'public'),
    team: s.alive && s.faction !== 'town' && room.phase === 'night' ? project(room.chats[s.faction], 'team') : [],
    observers: !s.alive && !['over', 'closed'].includes(room.phase) ? project(room.chats.observers, 'observers') : [],
  };
}

export function matchResults(room) {
  if (!room.outcome) return [];
  return room.participants.map(id => {
    const s = state(room, id);
    return { playerId: id, roleId: s.roleId, initialFaction: s.initialFaction, faction: s.faction, won: room.winners.includes(id), forfeited: s.forfeited, eliminatedAt: s.eliminatedAt };
  });
}

export function snapshot(room, viewerId, now) {
  const viewer = room.members.find(m => m.id === viewerId && !m.left);
  if (!viewer) fail('AUTH', 401);
  const s = state(room, viewerId), waiting = isRunning(room) && !s;
  const ended = ['over', 'closed'].includes(room.phase) && Boolean(room.outcome);
  const known = Boolean(s) || room.phase === 'lobby' || ended;
  const members = room.members.map((m, index) => {
    const ms = state(room, m.id);
    return { id: m.id, name: m.name, avatar: m.avatar, emoji: AVATARS[m.avatar], color: colorOf(m),
      ...(m.profile ? { profile: copy(m.profile) } : {}), seat: index + 1, connected: m.connected, ready: m.ready, left: m.left,
      spectator: Boolean(room.participants.length && !ms), alive: known && ms ? ms.alive : null,
      eliminatedAt: known && ms ? ms.eliminatedAt : null, forfeited: known && ms ? ms.forfeited : false };
  });
  const privateView = s && !viewer.left ? {
    id: viewerId, spectator: false, roleId: s.roleId, faction: s.faction, alive: s.alive, pendingForfeit: Boolean(room.pendingForfeits[viewerId]),
    allies: s.alive && s.faction !== 'town' ? living(room).filter(id => id !== viewerId && state(room, id).faction === s.faction) : [],
    resources: copy(s.resources), actions: availableActions(room, viewerId),
    nightAction: copy(room.nightActions[viewerId] || null), killTarget: room.killVotes[viewerId] ?? null,
    // A tie cancels the attack, so the Mafia sees its own team's current ballot.
    // Only living Mafia viewers receive it; nobody else's snapshot changes.
    teamVotes: room.phase === 'night' && s.alive && s.faction === 'mafia' ? Object.fromEntries(living(room).filter(id => id !== viewerId && state(room, id).faction === 'mafia' && own(room.killVotes, id)).map(id => [id, room.killVotes[id]])) : {},
    reports: copy(room.privateEvents[viewerId] || []),
    myNomination: own(room.nominationVotes, viewerId) ? room.nominationVotes[viewerId] : null,
    myVerdict: own(room.verdictVotes, viewerId) ? room.verdictVotes[viewerId] : null,
    nominationSubmitted: own(room.nominationVotes, viewerId), verdictSubmitted: own(room.verdictVotes, viewerId),
    voice: voiceAudience(room, viewerId),
  } : room.phase==='lobby'?{id:viewerId,roleId:null,spectator:false}:null;
  return {
    protocol: room.protocol||1, game: 'mafia', rulesetVersion: room.rulesetVersion,
    code: room.code, revision: room.publicRevision, serverNow: now, expiresAt: room.expiresAt,
    hostId: room.hostId, phase: waiting ? 'waiting' : room.phase, phaseId: waiting ? null : room.phaseId,
    matchId: room.matchId, round: waiting ? null : room.round, deadlineAt: waiting ? null : room.deadlineAt,
    settings: copy(room.settings), settingsRevision:room.settingsRevision||0, waiting, members,
    participants: waiting ? [] : [...room.participants],
    composition: mafiaComposition(room.participants.length || room.settings.capacity),
    possibleRoles: Object.keys(MAFIA_ROLES).filter(id => {
      const count = mafiaComposition(room.participants.length || room.settings.capacity);
      if(id==='tracker')return room.rulesetVersion===2;
      if(room.rulesetVersion===2&&count.support===1&&MAFIA_SUPPORT_ROLES.includes(id))return false;
      return (id !== 'leader' || count.shadow > 0) && (!MAFIA_SUPPORT_ROLES.includes(id) || count.support > 0) && (!['masker', 'blocker'].includes(id) || count.mafia > 1);
    }),
    nomineeId: waiting ? null : room.nomineeId, you: privateView,
    log: waiting ? [] : copy(room.history), chats: visibleChats(room, viewerId),
    outcome: ended ? copy(room.outcome) : null, winners: ended ? [...room.winners] : [],
    replay: ended && s ? { players: matchResults(room), events: copy(room.audit) } : null,
    reason: waiting ? null : room.reason,
  };
}

// This allowlist is the only source for delayed observers. Never derive it by
// deleting fields from a player's private snapshot or by returning the audit.
export function publicSnapshot(room) {
  const ended=['over','closed'].includes(room.phase)&&Boolean(room.outcome);
  return {protocol:room.protocol||1,game:'mafia',rulesetVersion:room.rulesetVersion,code:room.code,
    matchId:room.matchId,phase:room.phase,phaseId:room.phaseId,round:room.round,deadlineAt:room.deadlineAt,
    hostId:room.hostId,settings:copy(room.settings),settingsRevision:room.settingsRevision||0,
    members:room.members.map((m,index)=>{const s=state(room,m.id);return {id:m.id,name:m.name,avatar:m.avatar,emoji:AVATARS[m.avatar],color:colorOf(m),seat:index+1,connected:m.connected,ready:m.ready,left:m.left,alive:s?.alive??null,eliminatedAt:s?.eliminatedAt??null,forfeited:s?.forfeited||false,...(m.profile?{profile:copy(m.profile)}:{})};}),
    participants:[...room.participants],nomineeId:room.nomineeId,composition:mafiaComposition(room.participants.length||room.settings.capacity),
    log:copy(room.history),chats:{public:room.chats.public.map(m=>({id:m.publicId||`public:${m.at}:${m.playerId}`,playerId:m.playerId,text:m.text,at:m.at})),team:[],observers:[]},
    outcome:ended?copy(room.outcome):null,winners:ended?[...room.winners]:[],
    replay:ended?{players:matchResults(room),events:copy(room.history)}:null,
    reason:room.reason,appearance:copy(room.appearance||null)};
}
