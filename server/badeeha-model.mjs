// Authoritative multi-phone Badeeha: one phone per team, the host presents and judges
// like the single-device game. Every phone carries the question bank, so the room keeps
// question IDs and the game state only (turn, scores, aids, phase); the server never
// needs, stores or sends question text, media or answers.
import { BADEEHA_PROTOCOL, BADEEHA_TIMERS, BADEEHA_MAX_TEAMS, ROOM_TTL, HOST_GRACE, AVATARS } from '../src/online/shared.js';
import MaydanLogicBeta, { pointsAfterHints } from '../src/games/badeeha/logic.js';
import { active, playing, member, transferHost, admitMember, newMember, fail, extendForMatch, kickSeat, colorOf } from './room-model.mjs';

const { MODES, ROUND_SIZES } = MaydanLogicBeta;
const TOOLS = ['double', 'two', 'time'];
const PLAYING = ['board', 'question', 'reveal'];
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_HINTS = 5;
const EXTRA_TIME_MS = 30_000;
const has = (object, key) => Object.hasOwn(object, key);

// The host's phone builds the deck from its own bank and history, exactly like the
// single-device setup: six categories, the mode's tiers and the round size. Only the
// shape is checked here; a phone missing a question shows it as unavailable.
export function normalizeSettings(input) {
  const value = input && typeof input === 'object' ? input : {};
  const mode = has(MODES, value.mode) ? value.mode : null;
  if (!mode || !ROUND_SIZES.includes(value.roundSize) || !BADEEHA_TIMERS.includes(value.timer)) fail('INVALID');
  const categories = value.categories;
  if (!Array.isArray(categories) || categories.length !== 6 || new Set(categories).size !== 6 || !categories.every((id) => typeof id === 'string' && ID.test(id))) fail('QUESTIONS');
  const deck = value.deck;
  if (!deck || typeof deck !== 'object' || Array.isArray(deck) || Object.keys(deck).length !== 6 || !categories.every((id) => Array.isArray(deck[id]))) fail('QUESTIONS');
  const tiers = MODES[mode].tiers, seen = new Set(), clean = {};
  for (const id of categories) {
    clean[id] = deck[id].map((cell) => {
      if (!cell || typeof cell.qid !== 'string' || !ID.test(cell.qid) || !tiers.includes(cell.p) || seen.has(cell.qid)) fail('QUESTIONS');
      seen.add(cell.qid);
      return { qid: cell.qid, p: cell.p };
    });
  }
  if (seen.size !== value.roundSize) fail('QUESTIONS');
  return { mode, roundSize: value.roundSize, timer: value.timer, categories: [...categories], deck: clean };
}

export function createRoom(code, input, now) {
  const settings = normalizeSettings(input.settings);
  return { game: 'badeeha', code, revision: 0, createdAt: now, expiresAt: now + ROOM_TTL,
    hostId: input.id, hostMissingSince: now, phase: 'lobby', matchId: 0, round: 0, rounds: settings.roundSize,
    settings, deadlineAt: null, reason: null, members: [newMember(input, now, { host: true })], banned: [],
    participants: [], scores: {}, teams: {}, used: {}, turn: 0, current: null, effect: { double: false, two: false },
    hintsUsed: 0, verdict: null, undo: null };
}
export function joinRoom(room, input, now) {
  if (!room.members.some((m) => m.id === input.id && !m.left) && active(room).length >= BADEEHA_MAX_TEAMS) fail('FULL_BADEEHA', 409);
  return admitMember(room, input, now, { lateJoin: true });
}

const turnTeam = (room) => room.participants[room.turn] || null;
const answered = (room) => Object.keys(room.used).length;
// The next team in order that is still in the room. A team that left keeps its points
// on the board but no longer gets a turn.
function nextTurn(room) {
  const size = room.participants.length;
  for (let step = 1; step <= size; step++) {
    const index = (room.turn + step) % size;
    if (playing(room).includes(room.participants[index])) return index;
  }
  return room.turn;
}
function finish(room, reason = null) {
  room.phase = 'over'; room.deadlineAt = null; room.current = null; room.reason = reason; room.undo = null;
  if (!reason) room.round = room.rounds;
}
export function leaveRoom(room, id, now) {
  const m = member(room, id); m.left = true; m.connected = false; m.ready = false;
  transferHost(room, now, room.hostId === id);
  if (!active(room).length) { room.phase = 'closed'; room.deadlineAt = null; return; }
  if (PLAYING.includes(room.phase) && playing(room).length < 2) finish(room, 'players_left');
  else if (room.phase === 'board' && turnTeam(room) === id) room.turn = nextTurn(room);
  if (room.phase === 'lobby') room.members = active(room);
}
export function tick(room, now) {
  if (now >= room.expiresAt) { room.phase = 'closed'; room.reason = 'expired'; room.deadlineAt = null; return; }
  transferHost(room, now);
}
export function nextAlarm(room, now) {
  const deadlines = [room.expiresAt];
  if (room.hostMissingSince !== null && active(room).some((m) => m.connected)) deadlines.push(room.hostMissingSince + HOST_GRACE);
  return Math.max(now + 1, Math.min(...deadlines));
}

export function action(room, actorId, command, now) {
  const actor = member(room, actorId);
  if (!actor.connected) fail('DISCONNECTED', 409);
  if (command.matchId !== room.matchId) fail('STALE', 409);
  if (['open', 'tool', 'hint', 'reveal', 'judge', 'undo', 'end'].includes(command.type) && command.round !== room.round) fail('STALE', 409);
  const host = () => { if (room.hostId !== actorId) fail('HOST_ONLY', 403); };
  const phase = (value) => { if (room.phase !== value) fail('PHASE', 409); };
  switch (command.type) {
    case 'ready':
      phase('lobby'); if (typeof command.ready !== 'boolean') fail('INVALID'); actor.ready = command.ready; break;
    case 'kick':
      leaveRoom(room, kickSeat(room, actorId, command, now, host), now); break;
    case 'start': {
      host(); phase('lobby');
      const teams = active(room);
      if (teams.length < 2 || teams.length > BADEEHA_MAX_TEAMS || !teams.every((m) => m.connected && m.ready)) fail('NOT_READY_BADEEHA', 409);
      extendForMatch(room, now);
      room.matchId++; room.round = 1; room.reason = null;
      room.participants = teams.map((m) => m.id);
      room.scores = Object.fromEntries(room.participants.map((id) => [id, 0]));
      room.teams = Object.fromEntries(room.participants.map((id) => [id, { correct: 0, steals: 0, tools: { double: true, two: true, time: true } }]));
      room.used = {}; room.turn = 0; room.current = null; room.verdict = null; room.undo = null;
      room.effect = { double: false, two: false }; room.hintsUsed = 0; room.deadlineAt = null;
      room.phase = 'board'; break;
    }
    case 'open': {
      phase('board');
      if (actorId !== room.hostId && actorId !== turnTeam(room)) fail('TURN', 403);
      const cell = typeof command.categoryId === 'string' && Number.isSafeInteger(command.index) && room.settings.deck[command.categoryId]?.[command.index];
      if (!cell || room.used[cell.qid]) fail('CELL', 409);
      room.current = { categoryId: command.categoryId, index: command.index, qid: cell.qid, p: cell.p };
      room.effect = { double: false, two: false }; room.hintsUsed = 0; room.verdict = null;
      room.deadlineAt = now + room.settings.timer * 1000; room.phase = 'question'; break;
    }
    case 'tool': {
      phase('question');
      if (actorId !== turnTeam(room)) fail('TURN', 403);
      if (!TOOLS.includes(command.tool)) fail('INVALID');
      if (now >= room.deadlineAt) fail('STALE', 409);
      const tools = room.teams[actorId].tools;
      if (!tools[command.tool]) fail('TOOL_USED', 409);
      tools[command.tool] = false;
      if (command.tool === 'time') room.deadlineAt += EXTRA_TIME_MS;
      else room.effect[command.tool] = true;
      break;
    }
    case 'hint':
      phase('question');
      if (actorId !== room.hostId && actorId !== turnTeam(room)) fail('TURN', 403);
      if (room.hintsUsed >= MAX_HINTS) fail('INVALID');
      room.hintsUsed++; break;
    case 'reveal':
      host(); phase('question'); room.phase = 'reveal'; room.deadlineAt = null; break;
    case 'judge': {
      host(); phase('reveal');
      const winner = command.teamId ?? null;
      if (winner !== null && !playing(room).includes(winner)) fail('TARGET');
      room.undo = { scores: { ...room.scores }, teams: structuredClone(room.teams), used: { ...room.used }, turn: room.turn, round: room.round };
      const { qid, p } = room.current, turnId = turnTeam(room);
      let points = 0, steal = false;
      if (winner !== null) {
        const base = pointsAfterHints(p, room.hintsUsed);
        steal = winner !== turnId;
        points = !steal && room.effect.double ? base * 2 : base;
        room.scores[winner] += points;
        room.teams[winner].correct++;
        if (steal) room.teams[winner].steals++;
      }
      room.used[qid] = true;
      room.verdict = { teamId: winner, points, steal, qid };
      room.current = null; room.effect = { double: false, two: false }; room.hintsUsed = 0;
      if (answered(room) >= room.rounds) { finish(room); break; }
      room.round = answered(room) + 1; room.turn = nextTurn(room); room.phase = 'board';
      break;
    }
    // The single-device game lets the presenter take back the last verdict; so does the room.
    case 'undo': {
      host(); phase('board');
      if (!room.undo) fail('PHASE', 409);
      Object.assign(room, { scores: room.undo.scores, teams: room.undo.teams, used: room.undo.used, turn: room.undo.turn, round: room.undo.round });
      if (!playing(room).includes(turnTeam(room))) room.turn = nextTurn(room);
      room.undo = null; room.verdict = null; break;
    }
    case 'end':
      host(); if (!PLAYING.includes(room.phase)) fail('PHASE', 409); finish(room, 'ended'); break;
    case 'restart':
      host(); phase('over'); room.matchId++; room.phase = 'lobby'; room.round = 0; room.reason = null;
      room.members = active(room); room.members.forEach((m) => { m.ready = m.id === room.hostId; });
      Object.assign(room, { participants: [], scores: {}, teams: {}, used: {}, turn: 0, current: null, verdict: null, undo: null, deadlineAt: null });
      break;
    default: fail('INVALID');
  }
}

export function snapshot(room, viewerId, now) {
  return { protocol: BADEEHA_PROTOCOL, game: 'badeeha', code: room.code, revision: room.revision, serverNow: now,
    expiresAt: room.expiresAt, hostId: room.hostId, hostMissingSince: room.hostMissingSince, phase: room.phase,
    matchId: room.matchId, round: room.round, rounds: room.rounds, reason: room.reason, deadlineAt: room.deadlineAt,
    settings: room.settings, used: Object.keys(room.used), turnId: room.phase === 'lobby' ? null : turnTeam(room),
    teams: room.participants.map((id) => ({ id, score: room.scores[id] || 0, correct: room.teams[id]?.correct || 0,
      steals: room.teams[id]?.steals || 0, tools: room.teams[id]?.tools || { double: false, two: false, time: false } })),
    current: room.current, effect: room.effect, hintsUsed: room.hintsUsed, verdict: room.verdict, canUndo: Boolean(room.undo),
    members: room.members.map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, emoji: AVATARS[m.avatar], color: colorOf(m),
      connected: m.connected, ready: m.ready, left: m.left, score: room.scores[m.id] || 0 })),
    participants: room.participants };
}
