import { MIN_PLAYERS, ROUND_OPTIONS, VOTE_SECONDS, ROOM_TTL, HOST_GRACE, AVATARS, PROTOCOL } from '../src/online/shared.js';
import { TITLES, DEFAULT_TITLE } from '../src/games/meenfina/logic.js';
import { active, playing, absent, graceDeadlines, memberOrNull, member, newMember, colorOf, fail, admitMember, extendForMatch } from '../src/shared/room-primitives.mjs';
export * from '../src/shared/room-primitives.mjs';

export function createRoom(code, input, now) {
  if (!ROUND_OPTIONS.includes(input.rounds)) fail('INVALID');
  const owner = newMember(input, now, { host: true });
  return { code, revision: 0, createdAt: now, expiresAt: now + ROOM_TTL, hostId: owner.id, hostMissingSince: now,
    phase: 'lobby', matchId: 0, round: 0, rounds: input.rounds, voteSeconds: VOTE_SECONDS,
    members: [owner], banned: [], participants: [], deck: [], seenStatements: [], votes: {}, scores: {}, tags: {}, counts: {}, winners: [], deadlineAt: null, reason: null };
}
export const joinRoom = (room, input, now) => admitMember(room, input, now, { lateJoin: true });
export function transferHost(room, now, immediate = false) {
  const host = room.members.find((m) => m.id === room.hostId && !m.left);
  if (host?.connected) { room.hostMissingSince = null; return; }
  room.hostMissingSince ??= now;
  // A watcher may run the room only when no connected player of the match is left.
  const candidates = active(room).filter((m) => m.connected);
  const next = candidates.find((m) => (room.participants || []).includes(m.id)) || candidates[0];
  // A host who left the room has no seat to come back to: hand over at once.
  if (next && (immediate || !host || now >= room.hostMissingSince + HOST_GRACE)) {
    room.hostId = next.id;
    room.hostMissingSince = null;
  }
}
export function connected(room, id, value, now) {
  const m = member(room, id);
  if (value) m.disconnectedAt = null;
  else if (m.disconnectedAt == null) m.disconnectedAt = now;
  m.connected = value;
  transferHost(room, now);
}
// Removing a seat also bans its credentials, or the host has no way to keep a
// disruptive player out: the code is known to everyone in the room.
export function kickSeat(room, actorId, command, now, isHost) {
  isHost();
  if (['over', 'closed'].includes(room.phase)) fail('PHASE', 409);
  if (command.targetId === actorId) fail('INVALID');
  // A seat that already left is not an authentication failure for the host.
  const target = memberOrNull(room, command.targetId);
  if (!target) fail('TARGET_GONE', 409);
  // In the waiting room anyone may be removed; during a match a seat that dropped, or a
  // watcher who is not playing it.
  if (target.connected && room.phase !== 'lobby' && (room.participants || []).includes(target.id)) fail('INVALID');
  room.banned = [...(room.banned || []), { id: target.id, tokenHash: target.tokenHash }].slice(-32);
  return target.id;
}
export function leaveRoom(room, id, now) {
  const m = member(room, id);
  m.left = true; m.connected = false; m.ready = false;
  transferHost(room, now, room.hostId === id);
  if (['vote', 'result'].includes(room.phase) && playing(room).length < MIN_PLAYERS) {
    room.phase = 'over'; room.deadlineAt = null; room.reason = 'players_left';
  } else if (room.phase === 'vote') maybeReveal(room, now);
  if (room.phase === 'lobby') room.members = active(room);
  if (!active(room).length) { room.phase = 'closed'; room.deadlineAt = null; }
}
function question(room) { return room.deck[room.round - 1] || null; }
function beginRound(room, now) {
  room.phase = 'vote'; room.votes = {}; room.counts = {}; room.winners = [];
  room.deadlineAt = now + room.voteSeconds * 1000;
}
function reveal(room) {
  if (room.phase !== 'vote') return;
  const counts = Object.fromEntries(room.participants.map((id) => [id, 0]));
  for (const target of Object.values(room.votes)) if (target !== null && Object.hasOwn(counts, target)) counts[target]++;
  const max = Math.max(0, ...Object.values(counts));
  const winners = max ? room.participants.filter((id) => counts[id] === max) : [];
  for (const id of winners) {
    room.scores[id]++;
    const tag = question(room).tag;
    room.tags[id][tag] = (room.tags[id][tag] || 0) + 1;
  }
  room.counts = counts; room.winners = winners; room.phase = 'result'; room.deadlineAt = null;
}
function maybeReveal(room, now) {
  const voters = room.participants.filter((id) => { const m = room.members.find((x) => x.id === id); return m && !absent(m, now); });
  if (voters.every((id) => Object.hasOwn(room.votes, id))) reveal(room);
}
export function tick(room, now) {
  if (now >= room.expiresAt) { room.phase = 'closed'; room.reason = 'expired'; room.deadlineAt = null; return; }
  transferHost(room, now);
  if (room.phase === 'vote') {
    if (now >= room.deadlineAt) reveal(room);
    else maybeReveal(room, now); // a seat that stayed away past its grace no longer holds the round
  }
}
export function nextAlarm(room, now) {
  const deadlines = [room.expiresAt];
  if (room.phase === 'vote') deadlines.push(room.deadlineAt, ...graceDeadlines(room, now));
  if (room.hostMissingSince !== null && active(room).some((m) => m.connected)) deadlines.push(room.hostMissingSince + HOST_GRACE);
  return Math.max(now + 1, Math.min(...deadlines));
}
export function action(room, actorId, command, now, deck = []) {
  const actor = member(room, actorId);
  if (!actor.connected) fail('DISCONNECTED', 409);
  if (command.matchId !== room.matchId) fail('STALE', 409);
  const isHost = () => { if (actorId !== room.hostId) fail('HOST_ONLY', 403); };
  switch (command.type) {
    case 'ready':
      if (room.phase !== 'lobby' || typeof command.ready !== 'boolean') fail('PHASE', 409);
      actor.ready = command.ready;
      break;
    case 'kick':
      leaveRoom(room, kickSeat(room, actorId, command, now, isHost), now);
      break;
    case 'start': {
      isHost();
      if (room.phase !== 'lobby') fail('PHASE', 409);
      if (active(room).length < MIN_PLAYERS || !active(room).every((m) => m.ready && m.connected)) fail('NOT_READY', 409);
      if (deck.length < room.rounds) fail('INTERNAL', 500);
      extendForMatch(room, now);
      room.matchId++; room.round = 1; room.reason = null;
      room.participants = active(room).map((m) => m.id);
      room.scores = Object.fromEntries(room.participants.map((id) => [id, 0]));
      room.tags = Object.fromEntries(room.participants.map((id) => [id, {}]));
      room.deck = deck.slice(0, room.rounds).map(({ id, text, tag }) => ({ id, text, tag }));
      // Statements shown in this room go to the back of the queue for the next match.
      const used = room.deck.map((q) => q.id);
      room.seenStatements = [...(room.seenStatements || []).filter((id) => !used.includes(id)), ...used].slice(-400);
      beginRound(room, now);
      break;
    }
    case 'vote':
      if (command.round !== room.round) fail('STALE', 409);
      if (room.phase !== 'vote') fail('PHASE', 409);
      if (now >= room.deadlineAt) fail('STALE', 409);
      if (!room.participants.includes(actorId)) fail('AUTH', 403);
      if (command.targetId !== null && !room.participants.includes(command.targetId)) fail('TARGET');
      if (Object.hasOwn(room.votes, actorId)) {
        if (room.votes[actorId] === command.targetId) return;
        fail('VOTED', 409);
      }
      room.votes[actorId] = command.targetId;
      maybeReveal(room, now);
      break;
    case 'next':
      isHost();
      if (command.round !== room.round || room.phase !== 'result') fail('STALE', 409);
      if (room.round === room.rounds) room.phase = 'over';
      else { room.round++; beginRound(room, now); }
      break;
    case 'restart':
      isHost();
      if (room.phase !== 'over') fail('PHASE', 409);
      room.matchId++; room.phase = 'lobby'; room.round = 0;
      room.members = active(room); room.members.forEach((m) => { m.ready = m.id === room.hostId; });
      room.participants = []; room.deck = []; room.votes = {}; room.scores = {}; room.tags = {}; room.winners = []; room.counts = {}; room.reason = null;
      break;
    default: fail('INVALID');
  }
}
export function snapshot(room, viewerId, now) {
  const visibleResults = ['result', 'over'].includes(room.phase);
  return { protocol: PROTOCOL, code: room.code, revision: room.revision, serverNow: now, expiresAt: room.expiresAt,
    hostId: room.hostId, hostMissingSince: room.hostMissingSince, phase: room.phase, matchId: room.matchId,
    round: room.round, rounds: room.rounds, voteSeconds: room.voteSeconds, deadlineAt: room.deadlineAt, reason: room.reason,
    members: room.members.map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, emoji: AVATARS[m.avatar], color: colorOf(m),
      connected: m.connected, ready: m.ready, left: m.left, score: room.scores[m.id] || 0,
      title: TITLES[Object.entries(room.tags[m.id] || {}).sort((a, b) => b[1] - a[1])[0]?.[0]] || DEFAULT_TITLE })),
    participants: room.participants, question: question(room),
    submittedCount: Object.keys(room.votes).length,
    myVote: Object.hasOwn(room.votes, viewerId) ? { submitted: true, targetId: room.votes[viewerId] } : { submitted: false },
    counts: visibleResults ? room.counts : {}, winners: visibleResults ? room.winners : [],
  };
}
