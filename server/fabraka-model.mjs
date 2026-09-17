// Authoritative simultaneous Fabraka. Only snapshot() may leave the room server.
import { FABRAKA_PROTOCOL, ROOM_TTL, HOST_GRACE, AVATARS, COLORS, VOTE_SECONDS } from '../src/online/shared.js';
import { normalizeOptions, validateLie, matchesTruth, sameAnswer, roundBreakdown, fillName, TRUTH_ID } from '../src/games/fabraka/logic.js';
import { pictureAsset, PICTURE_CREDIT } from '../src/games/fabraka/pictureAssets.js';
import { active, member, memberOrNull, profile, transferHost, joinRoom as joinMember, fail } from './room-model.mjs';
import { shuffled } from './protocol.mjs';

const TIMED = ['host', 'write', 'discussion', 'vote'];
const PLAYING = ['host', 'write', 'discussion', 'vote', 'reveal', 'result'];
const has = (object, key) => Object.hasOwn(object, key);
const zeroStats = () => ({ truths: 0, fooled: 0, laughs: 0 });
const zeroRow = () => ({ truth: 0, fooled: 0, laughs: 0, points: 0, byWriting: false, host: false });
function text(value) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) fail('ANSWER');
  const checked = validateLie(value.normalize('NFKC'));
  if (!checked.ok) fail('ANSWER');
  return checked.text;
}
function deadline(room, phase, now, seconds) {
  room.phase = phase; room.deadlineAt = seconds ? now + seconds * 1000 : null;
}
function presentWriters(room) {
  return room.fab.writers.filter((id) => room.members.some((m) => m.id === id && !m.left));
}
function question(room) { return room.fab?.question; }
// صاحب الحقيقة يدور على المشاركين الحاضرين. ownerShift يعوّض من غادر في المنتصف
// كي يبقى صاحب الجولة الجارية نفسه، ويكمل الدور من بعده بلا جولات ميتة.
function friendOwner(room, round) {
  const size = room.participants.length;
  return size ? room.participants[(((round - 1 - (room.ownerShift || 0)) % size) + size) % size] : null;
}
function dropParticipant(room, id) {
  const index = room.participants.indexOf(id);
  if (index < 0 || room.settings.mode !== 'friends' || !PLAYING.includes(room.phase)) return;
  const size = room.participants.length;
  const current = (((room.round - 1 - (room.ownerShift || 0)) % size) + size) % size;
  room.participants = room.participants.filter((p) => p !== id);
  if (!room.participants.length) return;
  room.ownerShift = room.round - 1 - current + (index <= current ? 1 : 0);
  room.rounds = Math.max(room.round, room.participants.length * room.settings.friendCycles);
}

export function createRoom(code, input, now) {
  const settings = normalizeOptions(input.settings);
  return { game: 'fabraka', code, revision: 0, createdAt: now, expiresAt: now + ROOM_TTL,
    hostId: input.id, hostMissingSince: now, phase: 'lobby', matchId: 0, round: 0, ownerShift: 0,
    rounds: settings.rounds, settings, voteSeconds: VOTE_SECONDS, deadlineAt: null, reason: null,
    members: [{ id: input.id, tokenHash: input.tokenHash, ...profile(input), joinedAt: now, connected: false, ready: true, left: false }],
    participants: [], scores: {}, stats: {}, seenFacts: [], fab: null, history: [] };
}
export function joinRoom(room, input, now) {
  if (!room.members.some((m) => m.id === input.id && !m.left) && active(room).length >= 8) fail('FULL_FABRAKA', 409);
  return joinMember(room, input, now);
}
function abortRound(room, reason) {
  room.fab.aborted = reason; room.phase = 'result'; room.deadlineAt = null;
  room.fab.breakdown = Object.fromEntries(room.participants.map((id) => [id, zeroRow()]));
}
function beginRound(room, now) {
  const f = room.fab;
  const raw = f.deck[f.cursor++];
  if (!raw) fail('QUESTIONS');
  const truthHostId = room.settings.mode === 'friends' ? friendOwner(room, room.round) : null;
  const owner = room.members.find((m) => m.id === truthHostId);
  Object.assign(f, { question: truthHostId ? { ...raw, text: fillName(raw.text, owner.name), answer: '', aliases: [] } : raw,
    truthHostId, writers: active(room).map((m) => m.id).filter((id) => id !== truthHostId),
    submissions: {}, options: [], votes: {}, truthWriters: [], helped: {}, revealGroups: [], revealIndex: 0,
    revealedIds: [], groupShown: false, scored: false, aborted: null, breakdown: {} });
  const fact = raw.factId || raw.id;
  room.seenFacts = [...room.seenFacts.filter((id) => id !== fact), fact].slice(-256);
  if (truthHostId && owner.left) { abortRound(room, 'owner_left'); return; }
  deadline(room, truthHostId ? 'host' : 'write', now, truthHostId ? 90 : room.settings.writeSeconds);
}
function optionsFor(room) {
  const f = room.fab;
  // IDs disclose neither the truth nor the authors and remain stable after reconnection.
  const option = (answer, truth = false) => ({ id: crypto.randomUUID(), text: answer, truth, owners: [], earners: [] });
  const truth = option(question(room).answer, true), groups = [truth];
  for (const [id, submission] of Object.entries(f.submissions)) {
    if (!submission.text) continue;
    if (matchesTruth(submission.text, question(room))) { truth.owners.push(id); continue; }
    let group = groups.slice(1).find((o) => sameAnswer(o.text, submission.text));
    if (!group) { group = option(submission.text); groups.push(group); }
    group.owners.push(id);
    if (!has(f.helped, id)) group.earners.push(id);
  }
  for (const answer of question(room).decoys || []) {
    if (groups.length >= 4) break;
    if (matchesTruth(answer, question(room)) || groups.some((o) => sameAnswer(o.text, answer))) continue;
    groups.push(option(answer));
  }
  f.options = shuffled(groups); f.truthWriters = [...truth.owners];
}
function beginVote(room, now) { deadline(room, 'vote', now, VOTE_SECONDS); }
function finishWriting(room, now) {
  if (room.phase !== 'write') return;
  for (const id of room.fab.writers) if (!has(room.fab.submissions, id)) room.fab.submissions[id] = { text: '', skipped: true };
  optionsFor(room);
  if (room.settings.discussionSeconds) deadline(room, 'discussion', now, room.settings.discussionSeconds);
  else beginVote(room, now);
}
function prepareReveal(room) {
  if (room.phase !== 'vote') return;
  const f = room.fab;
  const eligible = (option) => Object.entries(f.votes).filter(([id, vote]) => !f.truthWriters.includes(id) && vote.optionId === option.id).length;
  const lies = f.options.filter((o) => !o.truth);
  const finalist = [...lies].sort((a, b) => eligible(b) - eligible(a))[0];
  const rest = lies.filter((o) => o !== finalist), quiet = rest.filter((o) => !eligible(o));
  f.revealGroups = quiet.length ? [quiet.map((o) => o.id)] : [];
  for (const o of rest.filter((o) => !quiet.includes(o))) f.revealGroups.push([o.id]);
  f.revealGroups.push(f.options.filter((o) => o.truth || o === finalist).map((o) => o.id));
  room.phase = 'reveal'; room.deadlineAt = null;
}
function maybeAdvance(room, now) {
  const ids = presentWriters(room);
  if (room.phase === 'write' && ids.every((id) => has(room.fab.submissions, id))) finishWriting(room, now);
  if (room.phase === 'vote' && ids.every((id) => has(room.fab.votes, id))) prepareReveal(room);
}
function finishRound(room) {
  const f = room.fab;
  if (f.scored) return;
  const truthId = f.options.find((o) => o.truth)?.id;
  const scoreId = (id) => id === truthId ? TRUTH_ID : id;
  const breakdown = roundBreakdown({ players: room.members, order: f.writers, hostId: f.truthHostId,
    settings: room.settings, round: room.round, rounds: room.rounds, truthWriters: f.truthWriters,
    options: f.options.map((o) => ({ ...o, id: scoreId(o.id) })),
    votes: Object.fromEntries(Object.entries(f.votes).map(([id, v]) => [id, scoreId(v.optionId)])),
    funnyVotes: Object.fromEntries(Object.entries(f.votes).map(([id, v]) => [id, scoreId(v.funnyId)])) });
  for (const id of room.participants) {
    const row = breakdown[id] || zeroRow(), stats = room.stats[id];
    room.scores[id] += row.points; stats.truths += row.truth; stats.fooled += row.fooled; stats.laughs += row.laughs;
  }
  f.breakdown = breakdown; f.scored = true;
  room.history.push({ round: room.round, question: question(room).text, answer: question(room).answer,
    highlights: f.options.filter((o) => !o.truth && o.earners.length).map((o) => ({ text: o.text, owners: o.earners,
      fooled: Object.entries(f.votes).filter(([id, v]) => !f.truthWriters.includes(id) && v.optionId === o.id).length,
      laughs: Object.values(f.votes).filter((v) => v.funnyId === o.id).length })) });
  room.phase = 'result'; room.deadlineAt = null;
}
export function leaveRoom(room, id, now) {
  const m = member(room, id); m.left = true; m.connected = false; m.ready = false;
  transferHost(room, now, room.hostId === id);
  if (!active(room).length) { room.phase = 'closed'; room.deadlineAt = null; return; }
  dropParticipant(room, id);
  if (PLAYING.includes(room.phase) && active(room).length < 3) {
    room.phase = 'over'; room.reason = 'players_left'; room.deadlineAt = null;
  } else if (room.phase === 'host' && room.fab.truthHostId === id) abortRound(room, 'owner_left');
  else if (room.fab) maybeAdvance(room, now);
  if (room.phase === 'lobby') room.members = active(room);
}
export function tick(room, now) {
  if (now >= room.expiresAt) { room.phase = 'closed'; room.reason = 'expired'; room.deadlineAt = null; return; }
  transferHost(room, now);
  if (!room.deadlineAt || now < room.deadlineAt) return;
  if (room.phase === 'host') abortRound(room, 'truth_timeout');
  else if (room.phase === 'write') finishWriting(room, now);
  else if (room.phase === 'discussion') beginVote(room, now);
  else if (room.phase === 'vote') prepareReveal(room);
}
export function nextAlarm(room, now) {
  const deadlines = [room.expiresAt];
  if (TIMED.includes(room.phase) && room.deadlineAt) deadlines.push(room.deadlineAt);
  if (room.hostMissingSince !== null && active(room).some((m) => m.connected)) deadlines.push(room.hostMissingSince + HOST_GRACE);
  return Math.max(now + 1, Math.min(...deadlines));
}
export function action(room, actorId, command, now, deck = []) {
  const actor = member(room, actorId);
  if (!actor.connected) fail('DISCONNECTED', 409);
  if (command.matchId !== room.matchId) fail('STALE', 409);
  if (TIMED.includes(room.phase) && room.deadlineAt && now >= room.deadlineAt) fail('STALE', 409);
  const host = () => { if (room.hostId !== actorId) fail('HOST_ONLY', 403); };
  const phase = (value) => { if (room.phase !== value) fail('PHASE', 409); };
  if (!['ready', 'start', 'kick', 'restart'].includes(command.type) && command.round !== room.round) fail('STALE', 409);
  const f = room.fab;
  switch (command.type) {
    case 'ready':
      phase('lobby'); if (typeof command.ready !== 'boolean') fail('INVALID'); actor.ready = command.ready; break;
    case 'kick': {
      host(); phase('lobby');
      if (command.targetId === actorId) fail('INVALID');
      const target = memberOrNull(room, command.targetId);
      if (!target) fail('TARGET_GONE', 409);
      if (target.connected) fail('INVALID');
      leaveRoom(room, command.targetId, now); break;
    }
    case 'start': {
      host(); phase('lobby');
      const players = active(room);
      if (players.length < 3 || players.length > 8 || !players.every((m) => m.connected && m.ready)) fail('NOT_READY', 409);
      const rounds = room.settings.mode === 'friends' ? players.length * room.settings.friendCycles : room.settings.rounds;
      if (deck.length < rounds) fail('QUESTIONS');
      room.matchId++; room.round = 1; room.rounds = rounds; room.reason = null; room.ownerShift = 0;
      room.participants = players.map((m) => m.id);
      room.scores = Object.fromEntries(room.participants.map((id) => [id, 0]));
      room.stats = Object.fromEntries(room.participants.map((id) => [id, zeroStats()])); room.history = [];
      room.fab = { deck: structuredClone(deck), cursor: 0, helpUsed: [] };
      beginRound(room, now); break;
    }
    case 'truth': {
      phase('host'); if (f.truthHostId !== actorId) fail('TRUTH_OWNER', 403);
      const answer = text(command.text);
      if (command.aliases !== undefined && (!Array.isArray(command.aliases) || command.aliases.length > 3)) fail('ANSWER');
      const aliases = (command.aliases || []).map(text);
      f.question = { ...f.question, answer, aliases, explanation: `هذه إجابة ${actor.name} عن نفسه في هذه الجولة.` };
      deadline(room, 'write', now, room.settings.writeSeconds); break;
    }
    case 'skip_prompt': {
      phase('host'); if (f.truthHostId !== actorId) fail('TRUTH_OWNER', 403);
      if (f.deck.length - f.cursor <= room.rounds - room.round) fail('NO_PROMPT');
      const raw = f.deck[f.cursor++];
      f.question = { ...raw, text: fillName(raw.text, actor.name), answer: '', aliases: [] };
      const fact = raw.factId || raw.id;
      room.seenFacts = [...room.seenFacts.filter((id) => id !== fact), fact].slice(-256);
      // Keeping the original deadline prevents an absent owner from stalling the room.
      break;
    }
    case 'help': {
      phase('write'); if (!f.writers.includes(actorId)) fail('TRUTH_OWNER', 403);
      if (has(f.submissions, actorId)) fail('SUBMITTED', 409);
      if (has(f.helped, actorId)) return;
      if (f.helpUsed.includes(actorId)) fail('HELP_USED');
      const choices = (question(room).decoys || []).filter((answer) => !matchesTruth(answer, question(room)));
      if (!choices.length) fail('NO_HELP');
      f.helped[actorId] = shuffled(choices)[0]; f.helpUsed.push(actorId); break;
    }
    case 'lie': {
      phase('write'); if (!f.writers.includes(actorId)) fail('TRUTH_OWNER', 403);
      const answer = command.skip === true ? '' : text(command.text);
      if (has(f.submissions, actorId)) {
        if (f.submissions[actorId].text === answer) return;
        fail('SUBMITTED', 409);
      }
      f.submissions[actorId] = { text: answer, skipped: command.skip === true };
      maybeAdvance(room, now); break;
    }
    case 'finish_writing':
      host(); phase('write'); if (room.settings.writeSeconds) fail('PHASE', 409);
      finishWriting(room, now); break;
    case 'start_vote': host(); phase('discussion'); beginVote(room, now); break;
    case 'vote': {
      phase('vote'); if (!f.writers.includes(actorId)) fail('TRUTH_OWNER', 403);
      const choice = command.optionId;
      const funny = room.settings.funnyVote ? (command.funnyId ?? null) : null;
      for (const id of [choice, funny]) {
        if (id === null) continue;
        const option = f.options.find((o) => o.id === id);
        if (!option) fail('OPTION');
        if (option.owners.includes(actorId)) fail('OWN_ANSWER');
      }
      if (has(f.votes, actorId)) {
        if (f.votes[actorId].optionId === choice && f.votes[actorId].funnyId === funny) return;
        fail('VOTED', 409);
      }
      f.votes[actorId] = { optionId: choice, funnyId: funny }; maybeAdvance(room, now); break;
    }
    case 'reveal': {
      host(); phase('reveal');
      if (f.groupShown) return;
      f.revealedIds.push(...f.revealGroups[f.revealIndex]); f.groupShown = true;
      if (f.revealIndex === f.revealGroups.length - 1) finishRound(room);
      break;
    }
    case 'next_reveal':
      host(); phase('reveal'); if (!f.groupShown) fail('PHASE', 409);
      f.revealIndex++; f.groupShown = false; break;
    case 'next':
      host(); phase('result');
      if (room.round === room.rounds) { room.phase = 'over'; room.deadlineAt = null; }
      else { room.round++; beginRound(room, now); }
      break;
    case 'restart':
      host(); phase('over'); room.matchId++; room.phase = 'lobby'; room.round = 0; room.reason = null;
      room.members = active(room); room.members.forEach((m) => { m.ready = m.id === room.hostId; });
      room.participants = []; room.ownerShift = 0; room.scores = {}; room.stats = {}; room.history = []; room.fab = null; room.deadlineAt = null;
      break;
    default: fail('INVALID');
  }
}
function publicQuestion(room) {
  const q = question(room);
  if (!q) return null;
  const safe = { text: q.text, kind: q.kind || 'text' };
  if (q.kind === 'picture') Object.assign(safe, { image: pictureAsset(q), imageDescription: q.imageDescription, imageCredit: PICTURE_CREDIT });
  if (room.fab.scored) Object.assign(safe, { answer: q.answer, explanation: q.explanation, sourceUrl: q.sourceUrl || null });
  return safe;
}
export function snapshot(room, viewerId, now) {
  const f = room.fab;
  const optionView = (o) => {
    const safe = { id: o.id, text: o.text, mine: o.owners.includes(viewerId) };
    if (f.scored || f.revealedIds.includes(o.id)) Object.assign(safe, { truth: o.truth, owners: o.owners, earners: o.earners,
      voters: Object.entries(f.votes).filter(([, v]) => v.optionId === o.id).map(([id]) => id),
      funnyVoters: Object.entries(f.votes).filter(([, v]) => v.funnyId === o.id).map(([id]) => id),
      fooled: Object.entries(f.votes).filter(([id, v]) => !f.truthWriters.includes(id) && v.optionId === o.id).length });
    return safe;
  };
  const optionPhase = ['discussion', 'vote', 'reveal', 'result'].includes(room.phase) || (room.phase === 'over' && f?.scored);
  return { protocol: FABRAKA_PROTOCOL, game: 'fabraka', code: room.code, revision: room.revision,
    serverNow: now, expiresAt: room.expiresAt, hostId: room.hostId, hostMissingSince: room.hostMissingSince,
    phase: room.phase, matchId: room.matchId, round: room.round,
    rounds: room.phase === 'lobby' && room.settings.mode === 'friends' ? active(room).length * room.settings.friendCycles : room.rounds,
    settings: room.settings, voteSeconds: VOTE_SECONDS, deadlineAt: room.deadlineAt, reason: room.reason,
    members: room.members.map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, emoji: AVATARS[m.avatar], color: COLORS[m.avatar],
      connected: m.connected, ready: m.ready, left: m.left, score: room.scores[m.id] || 0, stats: room.stats[m.id] || zeroStats() })),
    participants: room.participants, question: publicQuestion(room), truthHostId: f?.truthHostId || null,
    writerCount: f ? presentWriters(room).length : 0,
    writingCount: f ? presentWriters(room).filter((id) => has(f.submissions, id)).length : 0,
    submittedCount: f ? presentWriters(room).filter((id) => has(f.votes, id)).length : 0,
    mySubmission: f && has(f.submissions, viewerId) ? { submitted: true, ...f.submissions[viewerId] } : { submitted: false },
    myVote: f && has(f.votes, viewerId) ? { submitted: true, ...f.votes[viewerId] } : { submitted: false },
    myHelp: f?.helped[viewerId] || null, helpAvailable: Boolean(f && !f.helpUsed.includes(viewerId) && f.writers.includes(viewerId)),
    myTruth: room.phase === 'write' && f?.truthHostId === viewerId ? question(room).answer : null,
    canSkipPrompt: Boolean(room.phase === 'host' && f?.truthHostId === viewerId && f.deck.length - f.cursor > room.rounds - room.round),
    options: optionPhase && f ? f.options.map(optionView) : [],
    reveal: room.phase === 'reveal' ? { options: f.revealGroups[f.revealIndex].map((id) => optionView(f.options.find((o) => o.id === id))),
      shown: f.groupShown, final: f.revealIndex === f.revealGroups.length - 1 } : null,
    breakdown: f?.scored || f?.aborted ? f.breakdown : {},
    truthWriters: f?.scored ? f.truthWriters : [], roundReason: f?.aborted || null,
    history: room.phase === 'over' ? room.history : [],
  };
}
