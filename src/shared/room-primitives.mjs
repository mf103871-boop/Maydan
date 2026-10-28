import { MAX_PLAYERS, ROOM_MAX_TTL, MATCH_EXTENSION, START_MIN_REMAINING, SEAT_GRACE, AVATARS, COLORS } from '../online/shared.js';
import { arabicNormalize } from './lib/arabicNormalize.js';
import { objectionableText } from './moderation-filter.mjs';

export class RoomError extends Error {
  // `detail` is a short machine code safe to show a client (a provider's error code such
  // as `invalid_grant`), never a message, token or body.
  constructor(code, status = 400, detail = null) { super(code); this.code = code; this.status = status; this.detail = detail || null; }
}
export function fail(code, status, detail) { throw new RoomError(code, status, detail); }
// Zero-width joiners belong to emoji sequences and to some Arabic keyboards; every
// other control or format character has no place in a name or an answer.
const INVISIBLE = /[\p{Cc}\p{Cf}]/u;
export const hasInvisible = (text) => INVISIBLE.test(text.replace(/[‌‍]/g, ''));
export function profile(value) {
  if (typeof value?.name !== 'string') fail('NAME');
  const name = value.name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!name || Array.from(name).length > 20 || hasInvisible(name)) fail('NAME');
  if (objectionableText(name)) fail('CONTENT_REJECTED',422);
  if (!Number.isInteger(value.avatar) || value.avatar < 0 || value.avatar >= AVATARS.length) fail('INVALID');
  return { name, avatar: value.avatar };
}
// «أحمد» و«احمد» اسم واحد في غرفة تصويت؛ التطبيع العربي يوحّد الهمزة والتاء المربوطة والتشكيل.
export const sameName = (a, b) => a.toLocaleLowerCase('ar') === b.toLocaleLowerCase('ar') || (arabicNormalize(a) !== '' && arabicNormalize(a) === arabicNormalize(b));
export function active(room) { return room.members.filter((m) => !m.left); }
// The seats playing the running match. A seat that joined after the start watches
// from outside `participants` until the next match, so it never counts here.
export function playing(room) { return (room.participants || []).filter((id) => room.members.some((m) => m.id === id && !m.left)); }
// A seat that dropped its connection keeps its place for SEAT_GRACE; after that the
// round no longer waits for it. Reconnecting restores it at once.
export const absent = (m, now) => m.left || (!m.connected && (m.disconnectedAt == null || now - m.disconnectedAt >= SEAT_GRACE));
export function graceDeadlines(room, now) {
  return room.members.filter((m) => !m.left && !m.connected && m.disconnectedAt != null && now < m.disconnectedAt + SEAT_GRACE).map((m) => m.disconnectedAt + SEAT_GRACE);
}
// Looking up another player must never be confused with failing authentication:
// the caller decides whether a missing seat is an auth failure or a stale target.
export function memberOrNull(room, id) { return room.members.find((m) => m.id === id && !m.left) || null; }
export function member(room, id) { return memberOrNull(room, id) || fail('AUTH', 401); }
// كل مقعد يأخذ أول لون غير مستعمل، فتبقى ألوان لوحة النقاط مميزة حتى مع اثني عشر لاعبًا.
export function seatColor(room) {
  const used = new Set(active(room).map((m) => m.colorIndex));
  const free = COLORS.findIndex((_, index) => !used.has(index));
  return free === -1 ? active(room).length % COLORS.length : free;
}
export const colorOf = (m) => COLORS[m.colorIndex ?? m.avatar] || COLORS[0];
export function newMember(input, now, { host = false, colorIndex = 0 } = {}) {
  return { id: input.id, tokenHash: input.tokenHash, ...profile(input), joinedAt: now, connected: false, disconnectedAt: null, ready: host, left: false, colorIndex };
}
export function isBanned(room, input) {
  return (room.banned || []).some((entry) => entry.id === input.id || entry.tokenHash === input.tokenHash);
}
// lateJoin admits a new seat during a match: it watches (it is not in `participants`,
// so it cannot vote or write and nothing waits for it) and plays from the next match.
// Ersomha keeps lobby-only admission because its words are exposed per account.
export function admitMember(room, input, now, { lateJoin = false } = {}) {
  const existing = room.members.find((m) => m.id === input.id && !m.left);
  if (existing) {
    if (existing.tokenHash !== input.tokenHash) fail('AUTH', 401);
    return existing; // Retries and reconnects never allocate a second seat.
  }
  if (isBanned(room, input)) fail('BANNED', 403);
  // A departed participant's public ID still owns its historical votes/scores.
  // It cannot be resurrected as a new spectator with another token mid-match.
  const departed = room.members.find((m) => m.id === input.id && m.left);
  if (departed && room.phase !== 'lobby') {
    if (departed.tokenHash !== input.tokenHash) fail('AUTH', 401);
    fail('STARTED', 409);
  }
  if (room.phase !== 'lobby' && !lateJoin) fail('STARTED', 409);
  if (active(room).length >= MAX_PLAYERS) fail('FULL', 409);
  const p = profile(input);
  if (active(room).some((m) => sameName(m.name, p.name))) fail('NAME_TAKEN', 409);
  // Retain only current-match tombstones (at most the original player count),
  // so late arrivals cannot erase the departed players' names or identities.
  room.members = room.members.filter((m) => !m.left || (room.phase !== 'lobby' && ((room.participants || []).includes(m.id) || Object.hasOwn(room.scores || {}, m.id))));
  const joined = newMember(input, now, { colorIndex: seatColor(room) });
  room.members.push(joined);
  return joined;
}
// Every match start buys the room two more hours, up to six from creation. A room
// with less than a quarter hour left cannot start a match it would cut short.
export function extendForMatch(room, now) {
  const cap = (room.createdAt || now) + ROOM_MAX_TTL;
  room.expiresAt = Math.min(cap, Math.max(room.expiresAt, now + MATCH_EXTENSION));
  if (room.expiresAt - now < START_MIN_REMAINING) fail('EXPIRING', 409);
}
