import { normalizeContentIdentity, supportsContentIdentity } from '../src/shared/content-locale.mjs';
import { fail, member } from '../src/shared/room-primitives.mjs';

export function roomContentIdentity(value = {}) {
  try { return normalizeContentIdentity(value); }
  catch (error) { fail(error.message === 'CONTENT_VERSION' ? 'CONTENT_VERSION' : 'CONTENT_LOCALE', 409); }
}
export function requireContentCapability(capabilities, value) {
  const identity = roomContentIdentity(value);
  if (!supportsContentIdentity(capabilities, identity)) fail('UPDATE_REQUIRED', 409);
  return identity;
}
// A rollout stop closes admission to new English matches, while the same
// compatible backend continues serving existing English matches and reconnects.
export const englishContentEnabled = env => String(env?.ENGLISH_CONTENT_ENABLED) !== '0';
export function requireNewContentEnabled(env, value) {
  const identity = roomContentIdentity(value);
  if (identity.contentLocale === 'en' && !englishContentEnabled(env)) fail('CONTENT_UNAVAILABLE', 409);
  return identity;
}
export function recordContentCapability(room, id, capabilities) {
  const seat = member(room, id);
  seat.localizedContent = capabilities?.localizedContent === 1;
}
export function changeRoomContent(room, actorId, command) {
  const actor = member(room, actorId);
  if (!actor.connected) fail('DISCONNECTED', 409);
  if (command.matchId !== room.matchId || (room.game === 'mafia' && command.phaseId !== room.phaseId)) fail('STALE', 409);
  if (actorId !== room.hostId) fail('HOST_ONLY', 403);
  if (room.ranked) fail('MAFIA_RANKED_FIXED', 403);
  if (room.phase !== 'lobby') fail('PHASE', 409);
  const identity = roomContentIdentity(command);
  if (identity.contentLocale === 'en' && room.members.some(seat => !seat.left && !seat.localizedContent)) fail('UPDATE_REQUIRED', 409);
  const previous = roomContentIdentity(room);
  if (previous.contentLocale === identity.contentLocale && previous.contentVersion === identity.contentVersion) return false;
  Object.assign(room, identity);
  for (const seat of room.members) if (!seat.left && seat.id !== room.hostId) seat.ready = false;
  if (room.game === 'mafia') {
    room.settings.community = identity.contentLocale;
    room.settingsRevision = (room.settingsRevision || 0) + 1;
  }
  return true;
}
