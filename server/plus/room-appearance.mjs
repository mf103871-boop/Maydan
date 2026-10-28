import { getCosmetic } from '../../src/plus/catalog.js';
import { plusActiveFor, effectiveCosmetics } from './access.mjs';
import { fail } from '../room-model.mjs';

export function appearanceRefreshNeeded(previous, room, now = Date.now()) {
  if (!previous) return true;
  if (previous.phase === 'lobby' && !['lobby', 'closed'].includes(room.phase)) return true;
  return room.phase === 'lobby' && (previous.phase !== 'lobby' || previous.hostId !== room.hostId || now >= (room.appearanceCheckedAt || 0) + 60_000);
}
// Cosmetic service failure must never stop a free game or a secret voice transition.
export async function prepareRoomAppearance(env, previous, room, now = Date.now()) {
  if (!appearanceRefreshNeeded(previous, room, now)) return;
  const host = room.members.find(m => m.id === room.hostId && !m.left);
  let id = null;
  try {
    if (host?.accountUserId && env.DB && await plusActiveFor(env, host.accountUserId, now)) {
      id = room.appearanceChoice?.hostId === host.id ? room.appearanceChoice.themeId : (await effectiveCosmetics(env, host.accountUserId, now)).roomThemeId;
    }
  } catch { /* free fallback; retry at a safe lobby boundary */ }
  const item = getCosmetic(id, { kind: 'roomTheme', now });
  room.appearance = item ? { themeId: item.id, version: item.version } : null;
  room.appearanceCheckedAt = now;
}
export async function selectRoomAppearance(env, room, seatId, themeId, now = Date.now()) {
  if (room.hostId !== seatId) fail('HOST_ONLY', 403);
  if (room.phase !== 'lobby') fail('PHASE', 409);
  const host = room.members.find(m => m.id === seatId && !m.left);
  if (!host) fail('AUTH', 401);
  const item = themeId == null ? null : getCosmetic(themeId, { kind: 'roomTheme', now });
  if (themeId != null && !item) fail('INVALID', 400);
  if (item && (!host.accountUserId || !await plusActiveFor(env, host.accountUserId, now))) fail('PLUS_REQUIRED', 403);
  room.appearanceChoice = { hostId: seatId, themeId: item?.id || null };
  room.appearance = item ? { themeId: item.id, version: item.version } : null;
  room.appearanceCheckedAt = now;
}
