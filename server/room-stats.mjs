import { fail } from './room-model.mjs';
import { matchResults } from './mafia-model.mjs';

// Only the public Worker may set accountUserId, after checking account auth.
// Room tokens identify seats; they are never treated as account credentials.
export function bindSeatAccount(room, seatId, accountUserId) {
  const seat = room.members.find((m) => m.id === seatId && !m.left);
  // Match participants remain frozen. A new spectator still needs its verified
  // account now, or it would play the next match anonymously without rejoining.
  const watcher = room.participants?.length > 0 && !room.participants.includes(seatId);
  if (!seat || (room.phase !== 'lobby' && !watcher)) return;
  const userId = typeof accountUserId === 'string' ? accountUserId : null;
  if (userId && room.members.some((m) => !m.left && m.id !== seatId && m.accountUserId === userId)) fail('ACCOUNT_IN_ROOM', 409);
  seat.accountUserId = userId;
}

// The account mapping is frozen at the start. Restored pre-feature matches have
// no marker and must never become an invented historical result.
export function prepareRoomStats(previous, candidate, now = Date.now()) {
  if (previous?.phase === 'lobby' && candidate.phase !== 'lobby' && candidate.matchId !== previous.matchId && (candidate.round === 1 || candidate.game==='mafia')) {
    candidate.statsMatch = {
      eventId: `online:${crypto.randomUUID()}`, startedAt: now,
      accounts: Object.fromEntries(candidate.participants.map((id) => [id, candidate.members.find((m) => m.id === id)?.accountUserId || null])),
    };
  }
  if(candidate.game==='mafia') {
    if(candidate.phase!=='over'||previous?.phase==='over'||!candidate.statsMatch||candidate.technicalAbort||candidate.mafiaMedia?.failed)return [];
    return matchResults(candidate).flatMap(result=>{
      const userId=candidate.statsMatch.accounts[result.playerId];if(!userId)return [];
      return [{userId,eventId:candidate.statsMatch.eventId,game:'mafia',won:!!result.won,draw:candidate.outcome?.faction==='draw',finishedAt:now}];
    });
  }
  // Badeeha's last question ends from its reveal (the host's verdict), the others from a result.
  const finalPhase = candidate.game === 'badeeha' ? 'reveal' : 'result';
  if (candidate.phase !== 'over' || previous?.phase !== finalPhase || candidate.reason || candidate.round !== candidate.rounds || !candidate.statsMatch) return [];
  if (candidate.game === 'badeeha' && Object.keys(candidate.used || {}).length < candidate.rounds) return [];
  // An abandoned Fabraka round is not a completed competition.
  if (candidate.game === 'fabraka' && candidate.history.length < candidate.rounds) return [];
  if (candidate.game === 'ersomha' && (candidate.history.length < candidate.rounds || candidate.history.some(turn => !turn.completed))) return [];
  const seats = candidate.participants.filter((id) => candidate.members.some((m) => m.id === id && !m.left));
  const maximum = Math.max(0, ...seats.map((id) => candidate.scores[id] || 0));
  const leaders = maximum > 0 ? seats.filter((id) => candidate.scores[id] === maximum) : [];
  const awarded = new Set();
  return seats.flatMap((id) => {
    const userId = candidate.statsMatch.accounts[id];
    if (!userId || awarded.has(userId)) return [];
    awarded.add(userId);
    const competitive = candidate.game === 'fabraka' || candidate.game === 'badeeha' || candidate.game === 'ersomha' && candidate.settings.mode === 'competitive';
    const leader = competitive && leaders.includes(id);
    return [{ userId, eventId: candidate.statsMatch.eventId, game: candidate.game || 'meenfina',
      won: leader && leaders.length === 1, draw: leader && leaders.length > 1, finishedAt: now }];
  });
}
