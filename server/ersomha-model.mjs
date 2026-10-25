// Authoritative game state. Word cards and account/lease identifiers are private:
// snapshot() is the only projection allowed onto a player's state channel.
import { ERSOMHA_PROTOCOL, ERSOMHA_CATEGORIES, ROOM_TTL, HOST_GRACE, AVATARS } from '../src/online/shared.js';
import { active, member, profile, transferHost, joinRoom as joinMember, fail, hasInvisible, extendForMatch, kickSeat, colorOf } from './room-model.mjs';
import { objectionableText } from './moderation/filter.mjs';
import { matchesErsomhaAnswer, getErsomhaPool } from './ersomha-content.mjs';

export const ERSOMHA_SELECT_MS = 10_000;
export const ERSOMHA_DRAW_MS = 60_000;
export const ERSOMHA_RESULT_MS = 7_000;
export const ERSOMHA_PAUSE_MS = 15_000;
export const ERSOMHA_PLAYING = ['select', 'draw', 'result'];
const zeroRow = () => ({ guess: 0, draw: 0, points: 0 });
const hintText = text => text.normalize('NFKC').replace(/[\p{M}\u0640]/gu, '');
const accountOf = (room, id) => room.members.find(m => m.id === id)?.accountUserId;
export function normalizeErsomhaSettings(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('INVALID');
  const mode = input.mode ?? 'competitive', cycles = input.cycles ?? 1, difficulty = input.difficulty ?? 'medium';
  if (!['competitive', 'cooperative'].includes(mode) || ![1, 2].includes(cycles) || !['easy', 'medium', 'hard'].includes(difficulty)) fail('INVALID');
  if (input.drawSeconds !== undefined && input.drawSeconds !== 60) fail('INVALID');
  if (input.allowReplay !== undefined && typeof input.allowReplay !== 'boolean') fail('INVALID');
  const categories = input.categories ?? [];
  if (!Array.isArray(categories) || categories.length > 30 || categories.some(c => typeof c !== 'string' || !ERSOMHA_CATEGORIES.some(category => category.id === c)) || new Set(categories).size !== categories.length) fail('INVALID');
  if (categories.length && categories.length < 3) fail('INVALID');
  // Content validates categories too. Unknown IDs must not silently widen a pool.
  if (!getErsomhaPool({ categories, difficulty }).length) fail('ERSOMHA_CONTENT_EXHAUSTED', 409);
  return { mode, cycles, difficulty, categories: [...categories], allowReplay: input.allowReplay === true, drawSeconds: 60 };
}
export function createRoom(code, input, now) {
  const settings = normalizeErsomhaSettings(input.settings);
  return { game: 'ersomha', code, revision: 0, createdAt: now, expiresAt: now + ROOM_TTL,
    hostId: input.id, hostMissingSince: now, phase: 'lobby', matchId: 0, round: 0, rounds: 0,
    settings, deadlineAt: null, reason: null, participants: [], scores: {}, history: [],
    ersomhaKey: crypto.randomUUID(), ersomhaLeaseToken: crypto.randomUUID(), ersomhaLease: null,
    members: [{ id: input.id, tokenHash: input.tokenHash, ...profile(input), joinedAt: now, connected: false, disconnectedAt: null, ready: true, left: false, colorIndex: 0 }],
    banned: [], draw: null, ersomhaPlan: null };
}
export function joinRoom(room, input, now) {
  if (!room.members.some(m => m.id === input.id && !m.left) && active(room).length >= 8) fail('FULL_ERSOMHA', 409);
  return joinMember(room, input, now);
}
function drawer(room) { return room.members.find(m => m.id === room.draw?.drawerId && !m.left); }
function beginTurn(room, now) {
  const drawerId = room.turnOrder[room.round - 1];
  room.phase = 'select'; room.deadlineAt = now + ERSOMHA_SELECT_MS;
  room.draw = { drawerId, choices: [], word: null, eligible: [], correct: {}, guesses: [], nextGuessId: 0,
    guessWindows: {}, scored: false, cancelled: null, breakdown: {}, startedAt: null, pauseUsed: false,
    pauseUntil: null, pauseStartedAt: null, pauseRemainingMs: null, pausedMs: 0, hints: [], lengthsRevealed: false,
    viewers: room.members.filter(m => !m.left && room.participants.includes(m.id)).map(m => accountOf(room, m.id)).filter(Boolean),
    drawing: { epoch: 1, seq: 0 } };
  // A departed seat's later scheduled turn is skipped without exposing a card.
  if (!drawer(room)) finishTurn(room, now, 'drawer_left');
}
export function setErsomhaChoices(room, cards, now) {
  if (room.phase !== 'select' || room.draw.choices.length) return;
  if (cards.length !== 3) fail('ERSOMHA_CONTENT_EXHAUSTED', 409);
  room.draw.choices = structuredClone(cards);
  // Database preparation must not eat the player's ten-second choice window.
  room.deadlineAt = now + ERSOMHA_SELECT_MS;
}
function chooseWord(room, card, now) {
  room.draw.word = card; room.draw.startedAt = now;
  room.draw.eligible = room.participants.filter(id => id !== room.draw.drawerId && room.members.some(m => m.id === id && !m.left));
  room.phase = 'draw'; room.deadlineAt = now + ERSOMHA_DRAW_MS;
}
function finishTurn(room, now, cancelled = null) {
  const d = room.draw;
  if (!d || d.scored) return;
  d.scored = true; d.cancelled = cancelled; d.pauseUntil = null; d.pauseRemainingMs = null;
  d.breakdown = Object.fromEntries(room.participants.map(id => [id, zeroRow()]));
  if (!cancelled) {
    for (const [id, result] of Object.entries(d.correct)) if (d.breakdown[id]) d.breakdown[id].guess = result.points;
    d.breakdown[d.drawerId].draw = d.eligible.length ? Math.round(100 * Object.keys(d.correct).length / d.eligible.length) : 0;
    for (const [id, row] of Object.entries(d.breakdown)) { row.points = row.guess + row.draw; room.scores[id] = (room.scores[id] || 0) + row.points; }
  }
  room.history.push({ round: room.round, drawerId: d.drawerId, solved: Object.keys(d.correct).length,
    remainingMs: !cancelled && Object.keys(d.correct).length ? Math.max(0, ERSOMHA_DRAW_MS - elapsed(room, now)) : 0,
    eligible: d.eligible.length, cancelled, completed: !cancelled });
  room.phase = 'result'; room.deadlineAt = now + ERSOMHA_RESULT_MS;
}
function endMatch(room, reason = null) {
  room.phase = 'over'; room.deadlineAt = null; room.reason = reason;
  if (room.draw?.pauseUntil) { room.draw.pauseUntil = null; room.draw.pauseRemainingMs = null; }
}
function nextTurn(room, now) {
  if (room.round >= room.rounds) { endMatch(room); return; }
  room.round++; beginTurn(room, now);
}
function presentMinimum(room) { return room.settings.mode === 'cooperative' ? 2 : 3; }
export function leaveRoom(room, id, now) {
  const m = member(room, id); m.left = true; m.connected = false; m.ready = false;
  transferHost(room, now, room.hostId === id);
  if (ERSOMHA_PLAYING.includes(room.phase)) {
    if (active(room).length < presentMinimum(room)) endMatch(room, 'players_left');
    else if (id === room.draw.drawerId && ['select', 'draw'].includes(room.phase)) finishTurn(room, now, 'drawer_left');
    else if (room.phase === 'draw') maybeSolved(room, now);
  }
  if (room.phase === 'lobby') room.members = active(room);
  if (!active(room).length) { room.phase = 'closed'; room.deadlineAt = null; }
}
function elapsed(room, now) { return Math.max(0, now - room.draw.startedAt - room.draw.pausedMs); }
function maybeSolved(room, now) {
  const waiting = room.draw.eligible.filter(id => room.members.some(m => m.id === id && !m.left));
  if (waiting.length && waiting.every(id => Object.hasOwn(room.draw.correct, id))) finishTurn(room, now);
}
function pauseOrResume(room, now) {
  const d = room.draw, m = drawer(room);
  if (!m) { finishTurn(room, now, 'drawer_left'); return; }
  if (d.pauseUntil) {
    if (now >= d.pauseUntil) { finishTurn(room, now, 'drawer_disconnected'); return; }
    if (m.connected) {
      d.pausedMs += now - d.pauseStartedAt; room.deadlineAt = now + d.pauseRemainingMs;
      d.pauseUntil = null; d.pauseStartedAt = null; d.pauseRemainingMs = null;
    }
    return;
  }
  if (!m.connected) {
    if (d.pauseUsed) { finishTurn(room, now, 'drawer_disconnected'); return; }
    d.pauseUsed = true; d.pauseStartedAt = now; d.pauseUntil = now + ERSOMHA_PAUSE_MS;
    d.pauseRemainingMs = Math.max(0, room.deadlineAt - now); room.deadlineAt = null;
  }
}
function revealHints(room, now) {
  const d = room.draw, chars = Array.from(hintText(d.word.answer).replace(/\s/g, ''));
  d.lengthsRevealed = elapsed(room, now) >= 30_000;
  const index = Math.floor(chars.length / 2);
  d.hints = elapsed(room, now) >= 45_000 && chars.length > 1 ? [{ index, char: chars[index] }] : [];
}
export function tick(room, now) {
  if (now >= room.expiresAt) { room.phase = 'closed'; room.reason = 'expired'; room.deadlineAt = null; return; }
  transferHost(room, now);
  if (room.phase === 'draw') {
    // Expiry wins over a disconnect arriving after the drawing deadline.
    if (!room.draw.pauseUntil && now >= room.deadlineAt) { finishTurn(room, now); return; }
    pauseOrResume(room, now);
    if (room.phase === 'draw' && !room.draw.pauseUntil) { revealHints(room, now); maybeSolved(room, now); }
  } else if (room.phase === 'select' && room.deadlineAt <= now && room.draw.choices.length) {
    if (!drawer(room)?.connected) finishTurn(room, now, 'drawer_disconnected');
    else chooseWord(room, room.draw.choices[0], now);
  } else if (room.phase === 'result' && room.deadlineAt <= now) nextTurn(room, now);
}
export function nextAlarm(room, now) {
  const times = [room.expiresAt];
  if (room.deadlineAt) times.push(room.deadlineAt);
  if (room.draw?.pauseUntil) times.push(room.draw.pauseUntil);
  if (room.phase === 'draw' && !room.draw.pauseUntil) {
    for (const hint of [30_000, 45_000]) { const at = room.draw.startedAt + room.draw.pausedMs + hint; if (at > now) times.push(at); }
  }
  if (room.hostMissingSince !== null && active(room).some(m => m.connected)) times.push(room.hostMissingSince + HOST_GRACE);
  if (room.ersomhaLease && ERSOMHA_PLAYING.includes(room.phase)) times.push(room.ersomhaLease.renewAt);
  return Math.max(now + 1, Math.min(...times));
}
export function action(room, actorId, command, now) {
  const actor = member(room, actorId);
  if (!actor.connected) fail('DISCONNECTED', 409);
  if (command.matchId !== room.matchId) fail('STALE', 409);
  const host = () => { if (actorId !== room.hostId) fail('HOST_ONLY', 403); };
  switch (command.type) {
    case 'ready':
      if (room.phase !== 'lobby' || typeof command.ready !== 'boolean') fail('PHASE', 409);
      actor.ready = command.ready; break;
    case 'settings':
      host(); if (room.phase !== 'lobby') fail('PHASE', 409); room.settings = normalizeErsomhaSettings(command.settings); break;
    case 'kick': leaveRoom(room, kickSeat(room, actorId, command, now, host), now); break;
    case 'start': {
      host(); if (room.phase !== 'lobby') fail('PHASE', 409);
      const present = active(room);
      if (present.length < 2 || !present.every(m => m.ready && m.connected)) fail('NOT_READY_DUO', 409);
      room.settings.mode = present.length === 2 ? 'cooperative' : 'competitive';
      extendForMatch(room, now); room.matchId++; room.round = 1; room.reason = null; room.history = [];
      room.participants = present.map(m => m.id); room.scores = Object.fromEntries(room.participants.map(id => [id, 0]));
      room.turnOrder = Array.from({ length: room.settings.cycles }, () => room.participants).flat(); room.rounds = room.turnOrder.length;
      room.ersomhaLease = null; room.ersomhaPlan = null; room.ersomhaLeaseToken = `${room.ersomhaKey}:${room.matchId}`; beginTurn(room, now); break;
    }
    case 'select_word': {
      if (command.round !== room.round) fail('STALE', 409);
      if (actorId !== room.draw.drawerId) fail('ERSOMHA_DRAWER_ONLY', 403);
      if (room.phase === 'draw' && room.draw.word?.id === command.choiceId) return;
      if (room.phase !== 'select' || now >= room.deadlineAt) fail('PHASE', 409);
      const card = room.draw.choices.find(c => c.id === command.choiceId); if (!card) fail('OPTION');
      chooseWord(room, card, now); break;
    }
    case 'guess': {
      if (command.round !== room.round) fail('STALE', 409);
      if (room.phase !== 'draw' || room.draw.pauseUntil || now >= room.deadlineAt) fail('PHASE', 409);
      if (actorId === room.draw.drawerId || !room.draw.eligible.includes(actorId)) fail('ERSOMHA_GUESSER_ONLY', 403);
      if (Object.hasOwn(room.draw.correct, actorId)) return;
      if (typeof command.text !== 'string' || hasInvisible(command.text)) fail('ANSWER');
      const text = command.text.normalize('NFKC').trim().replace(/\s+/g, ' ');
      if (!text || Array.from(text).length > 60) fail('ANSWER');
      if (objectionableText(text)) fail('CONTENT_REJECTED', 422);
      const window = room.draw.guessWindows[actorId] || { at: now, count: 0 };
      if (now - window.at >= 5_000) { window.at = now; window.count = 0; }
      if (++window.count > 5) fail('RATE_LIMIT', 429); room.draw.guessWindows[actorId] = window;
      const correct = matchesErsomhaAnswer(text, room.draw.word);
      if (correct) room.draw.correct[actorId] = { at: now, points: 100 + Math.max(0, 50 - 10 * Math.floor(elapsed(room, now) / 10_000)) };
      room.draw.guesses.push({ id: ++room.draw.nextGuessId, playerId: actorId, text: correct ? null : text, correct, at: now });
      room.draw.guesses = room.draw.guesses.slice(-40); maybeSolved(room, now); break;
    }
    case 'next':
      host(); if (command.round !== room.round || room.phase !== 'result') fail('STALE', 409);
      // A host cannot shorten the reveal for slower readers.
      if (now < room.deadlineAt) fail('PHASE', 409); nextTurn(room, now); break;
    case 'restart':
      host(); if (room.phase !== 'over') fail('PHASE', 409);
      room.matchId++; room.phase = 'lobby'; room.round = 0; room.rounds = 0; room.deadlineAt = null; room.reason = null;
      room.members = active(room); room.members.forEach(m => { m.ready = m.id === room.hostId; });
      room.participants = []; room.scores = {}; room.history = []; room.draw = null; room.ersomhaLease = null; room.ersomhaPlan = null; break;
    default: fail('INVALID');
  }
}
export function snapshot(room, viewerId, now) {
  const d = room.draw, isDrawer = d?.drawerId === viewerId, revealed = room.phase === 'result' || room.phase === 'over';
  const word = d?.word?.answer;
  const result = { protocol: ERSOMHA_PROTOCOL, game: 'ersomha', code: room.code, revision: room.revision,
    serverNow: now, expiresAt: room.expiresAt, hostId: room.hostId, hostMissingSince: room.hostMissingSince,
    phase: room.phase, matchId: room.matchId, round: room.round, rounds: room.rounds, settings: room.settings,
    deadlineAt: room.deadlineAt, reason: room.reason, participants: room.participants,
    members: room.members.map(m => ({ id: m.id, name: m.name, avatar: m.avatar, emoji: AVATARS[m.avatar], color: colorOf(m),
      connected: m.connected, ready: m.ready, left: m.left, score: room.scores[m.id] || 0,
      ...(m.profile ? { profile: { avatarPreset: m.profile.avatarPreset, theme: m.profile.theme, avatarUrl: m.profile.avatarUrl, revision: m.profile.revision } } : {}) })),
    drawerId: d?.drawerId || null, category: d?.word?.category || null, pauseUntil: d?.pauseUntil || null, pauseRemainingMs: d?.pauseRemainingMs ?? null,
    publicWord: word && room.phase === 'draw' ? { wordLengths: d.lengthsRevealed ? hintText(word).split(/\s+/).map(w => Array.from(w).length) : [], letters: d.hints } : null,
    myChoices: isDrawer && room.phase === 'select' ? d.choices.map(c => ({ id: c.id, text: c.answer, category: c.category, difficulty: c.difficulty })) : [],
    myWord: isDrawer && room.phase === 'draw' ? word : null, revealedWord: revealed ? word || null : null,
    guessedIds: Object.keys(d?.correct || {}), myGuessed: Boolean(d?.correct?.[viewerId]),
    recentGuesses: d?.guesses || [], drawing: d?.drawing || { epoch: 1, seq: 0 },
    breakdown: revealed ? d?.breakdown || {} : {}, roundReason: d?.cancelled || null,
    cooperative: room.settings.mode === 'cooperative' ? { solvedTurns: room.history.filter(h => h.solved > 0 && !h.cancelled).length,
      completedTurns: room.history.length, totalTurns: room.rounds, remainingMs: room.history.reduce((sum, turn) => sum + (turn.remainingMs || 0), 0) } : null,
  };
  return result;
}
