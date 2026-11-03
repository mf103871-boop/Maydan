import { getCosmetic } from '../../src/plus/catalog.js';
import { canUseCosmetic, effectiveCosmetics } from './access.mjs';
import { fail } from '../room-model.mjs';

const slots = { themeId: { kind: 'roomTheme', preference: 'roomThemeId' } };
function appearanceOf(items) {
  if (!items.themeId) return null;
  return { themeId: items.themeId.id, version: items.themeId.version };
}

export function appearanceRefreshNeeded(previous, room, now = Date.now()) {
  if (!previous) return true;
  if (previous.phase === 'lobby' && !['lobby', 'closed'].includes(room.phase)) return true;
  return room.phase === 'lobby' && (previous.phase !== 'lobby' || previous.hostId !== room.hostId || now >= (room.appearanceCheckedAt || 0) + 60_000);
}
// Cosmetic service failure must never stop a free game or a secret voice transition.
export async function prepareRoomAppearance(env, previous, room, now = Date.now()) {
  if (!appearanceRefreshNeeded(previous, room, now)) return;
  const host = room.members.find(m => m.id === room.hostId && !m.left);
  const items = {};
  try {
    if (host?.accountUserId && env.DB) {
      const effective = await effectiveCosmetics(env, host.accountUserId, now);
      const choice = room.appearanceChoice?.hostId === host.id ? room.appearanceChoice : {};
      for (const [key, slot] of Object.entries(slots)) {
        const id = Object.hasOwn(choice, key) ? choice[key] : effective[slot.preference];
        const item = getCosmetic(id, { kind: slot.kind, now });
        if (item && await canUseCosmetic(env, host.accountUserId, id, now)) items[key] = item;
      }
    }
  } catch { /* free fallback; retry at a safe lobby boundary */ }
  room.appearance = appearanceOf(items);
  room.appearanceCheckedAt = now;
}
export async function selectRoomAppearance(env, room, seatId, selection, now = Date.now()) {
  if (room.hostId !== seatId) fail('HOST_ONLY', 403);
  if (room.phase !== 'lobby') fail('PHASE', 409);
  const host = room.members.find(m => m.id === seatId && !m.left);
  if (!host) fail('AUTH', 401);
  // Preserve legacy room-theme choices and licenses. A subscription by itself
  // no longer supplies room art, and retired council choices remain inert.
  const patch = selection == null || typeof selection === 'string' ? { themeId: selection || null } : selection;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !Object.hasOwn(slots, key))) fail('INVALID', 400);
  for (const [key, id] of Object.entries(patch)) {
    const item = id === null ? null : getCosmetic(id, { kind: slots[key].kind, now });
    if (id !== null && !item) fail('INVALID', 400);
    if (item && (!host.accountUserId || !await canUseCosmetic(env, host.accountUserId, item.id, now))) fail('PLUS_REQUIRED', 403);
  }
  const choice = room.appearanceChoice?.hostId === seatId ? room.appearanceChoice : {};
  const candidate = { ...room, appearanceChoice: { ...choice, hostId: seatId, ...patch } };
  await prepareRoomAppearance(env, null, candidate, now);
  room.appearanceChoice = candidate.appearanceChoice;
  room.appearance = candidate.appearance;
  room.appearanceCheckedAt = candidate.appearanceCheckedAt;
}
