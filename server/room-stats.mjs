import { fail } from './room-model.mjs';

// Only the public Worker may set accountUserId, after checking account auth.
// Room tokens identify seats; they are never treated as account credentials.
export function bindSeatAccount(room, seatId, accountUserId) {
  const seat = room.members.find((m) => m.id === seatId && !m.left);
  if (!seat || room.phase !== 'lobby') return;
  const userId = typeof accountUserId === 'string' ? accountUserId : null;
  if (userId && room.members.some((m) => !m.left && m.id !== seatId && m.accountUserId === userId)) fail('ACCOUNT_IN_ROOM', 409);
  seat.accountUserId = userId;
}

// The account mapping is frozen at the start. Restored pre-feature matches have
// no marker and must never become an invented historical result.
export function prepareRoomStats(previous, candidate, now = Date.now()) {
  if (previous?.phase === 'lobby' && candidate.phase !== 'lobby' && candidate.matchId !== previous.matchId && candidate.round === 1) {
    candidate.statsMatch = {
      eventId: `online:${crypto.randomUUID()}`, startedAt: now,
      accounts: Object.fromEntries(candidate.participants.map((id) => [id, candidate.members.find((m) => m.id === id)?.accountUserId || null])),
    };
  }
  if (candidate.phase !== 'over' || previous?.phase !== 'result' || candidate.reason || candidate.round !== candidate.rounds || !candidate.statsMatch) return [];
  // An abandoned Fabraka round is not a completed competition.
  if (candidate.game === 'fabraka' && candidate.history.length < candidate.rounds) return [];
  const seats = candidate.participants.filter((id) => candidate.members.some((m) => m.id === id && !m.left));
  const maximum = Math.max(0, ...seats.map((id) => candidate.scores[id] || 0));
  const leaders = maximum > 0 ? seats.filter((id) => candidate.scores[id] === maximum) : [];
  const awarded = new Set();
  return seats.flatMap((id) => {
    const userId = candidate.statsMatch.accounts[id];
    if (!userId || awarded.has(userId)) return [];
    awarded.add(userId);
    const leader = candidate.game === 'fabraka' && leaders.includes(id);
    return [{ userId, eventId: candidate.statsMatch.eventId, game: candidate.game || 'meenfina',
      won: leader && leaders.length === 1, draw: leader && leaders.length > 1, finishedAt: now }];
  });
}
