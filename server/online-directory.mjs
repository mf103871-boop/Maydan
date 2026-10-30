import { fail, roomCapacity } from './game-model.mjs';
import { minimumOnlinePlayers } from '../src/online/shared.js';
import { getGameModeSupport } from '../src/shared/game-mode-support.mjs';
import { liveAccountSql } from './moderation/access.mjs';
import { requireSession } from './accounts/session.mjs';
import { json } from './protocol.mjs';

export const ONLINE_DIRECTORY_GAMES = Object.freeze(['badeeha', 'ersomha', 'fabraka', 'meenfina']);
export const ONLINE_DIRECTORY_LEASE_MS = 90_000;
export const ONLINE_DIRECTORY_REFRESH_MS = 30_000;
export const onlineDirectoryEnabled = env => String(env.ONLINE_PUBLIC_DIRECTORY_ENABLED) === '1';
const supported = game => ONLINE_DIRECTORY_GAMES.includes(game);
const publicRoom = room => supported(room?.game) && room.directory?.visibility === 'public';
export const needsOnlineDirectory = (env, room) => onlineDirectoryEnabled(env) && publicRoom(room);
const roomKey = room => `${room.code}:${room.createdAt}:${room.roomTrialClaim}`;

// No opt-in existed in old clients or saved rooms. Never reinterpret them as public.
export function normalizeRoomDirectory(input, env) {
  if (input.directory == null) return null;
  if (!supported(input.game) || typeof input.directory !== 'object' || Array.isArray(input.directory)
      || !['public', 'private'].includes(input.directory.visibility)) fail('INVALID');
  const visibility = input.directory.visibility;
  if (visibility === 'private') return { visibility: 'private' };
  if (!onlineDirectoryEnabled(env) || !env.DB) fail('DIRECTORY_DISABLED', 409);
  if (!input.accountUserId) fail('AUTH_REQUIRED', 401);
  const raw = input.directory.name;
  if (typeof raw !== 'string') fail('NAME');
  const name = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (Array.from(name).length < 2 || Array.from(name).length > 40 || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069<>]/u.test(name)) fail('NAME');
  return { visibility, name };
}

export async function assertOnlineDirectoryAdmission(env, room, input) {
  if (input.directoryJoin === true && (!publicRoom(room) || input.game !== room.game)) fail('GAME', 409);
  if (!publicRoom(room)) return;
  // Admission does not depend on an advisory listing or its feature flag.
  // Turning discovery off must not turn an existing public room into a guest room.
  if (!input.accountUserId || !env.DB) fail('AUTH_REQUIRED', 401);
  const valid = await env.DB.prepare(`SELECT 1 FROM users account WHERE account.id=? AND ${liveAccountSql('account.id')}`)
    .bind(input.accountUserId).first();
  if (!valid) fail('AUTH', 401);
  const current = room.members.find(m => !m.left && m.id === input.id);
  if (current && current.accountUserId !== input.accountUserId) fail('AUTH', 401);
  if (room.members.some(m => !m.left && m.id !== input.id && m.accountUserId === input.accountUserId)) fail('ACCOUNT_IN_ROOM', 409);
  const accounts = [...new Set(room.members.filter(m => !m.left && m.accountUserId !== input.accountUserId).map(m => m.accountUserId).filter(Boolean))];
  if (!accounts.length) return;
  const placeholders = accounts.map(() => '?').join(',');
  const blocked = await env.DB.prepare(`SELECT 1 FROM social_blocks WHERE
    (blocker_id=? AND blocked_id IN (${placeholders})) OR (blocked_id=? AND blocker_id IN (${placeholders})) LIMIT 1`)
    .bind(input.accountUserId, ...accounts, input.accountUserId, ...accounts).first();
  if (blocked) fail('ROOM_BLOCKED', 403);
}

// Called only after the authoritative room commit; no answers, settings or seat
// credentials enter this table. A directory failure never rolls back a live match.
export async function updateOnlineDirectory(env, room, now = Date.now()) {
  if (!onlineDirectoryEnabled(env) || !env.DB || !publicRoom(room)) return;
  const members = room.members.filter(m => !m.left);
  const host = members.find(m => m.id === room.hostId);
  const listed = publicRoom(room) && members.length > 0 && host?.accountUserId
    && !['closed', 'over'].includes(room.phase) && room.expiresAt > now;
  if (!listed) {
    // Incarnations protect a newer room if a code is ever recycled.
    await env.DB.prepare('DELETE FROM online_public_rooms WHERE room_code=? AND room_key=?').bind(room.code, roomKey(room)).run();
    return;
  }
  const accounts=[...new Set(members.map(m=>m.accountUserId).filter(Boolean))];
  const {results:liveMembers}=await env.DB.prepare(`SELECT account.id FROM users account WHERE account.id IN (${accounts.map(()=>'?').join(',')}) AND ${liveAccountSql('account.id')}`)
    .bind(...accounts).all();
  const liveAccounts=liveMembers.map(member=>member.id);
  if (!liveAccounts.includes(host.accountUserId)) {
    await env.DB.prepare('DELETE FROM online_public_rooms WHERE room_code=? AND room_key=?').bind(room.code, roomKey(room)).run();
    return;
  }
  const capacity = roomCapacity(room), status = room.phase === 'lobby' ? 'waiting' : 'playing';
  // Existing engines admit a waiting seat for the following match. Their own
  // joinRoom remains the final authority; the directory reserves no seats.
  const joinable = members.length < capacity;
  await env.DB.prepare(`INSERT INTO online_public_rooms
    (room_code,room_key,game,room_name,host_user_id,member_user_ids,players,capacity,minimum,status,joinable,created_at,updated_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(room_code) DO UPDATE SET
    room_key=excluded.room_key,game=excluded.game,room_name=excluded.room_name,host_user_id=excluded.host_user_id,
    member_user_ids=excluded.member_user_ids,players=excluded.players,capacity=excluded.capacity,
    minimum=excluded.minimum,status=excluded.status,joinable=excluded.joinable,created_at=excluded.created_at,
    updated_at=excluded.updated_at,expires_at=excluded.expires_at`)
    .bind(room.code, roomKey(room), room.game, room.directory.name, host.accountUserId,
      JSON.stringify(liveAccounts), members.length,
      capacity, minimumOnlinePlayers(room.game, room.settings), status, joinable ? 1 : 0,
      room.createdAt, now, Math.min(room.expiresAt, now + ONLINE_DIRECTORY_LEASE_MS)).run();
}

const cursorOf = row => btoa(JSON.stringify([row.created_at, row.room_code])).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function parseCursor(value) {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail('INVALID');
  try {
    const parsed = JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/')));
    if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isSafeInteger(parsed[0]) || parsed[0] < 0 || !/^\d{6}$/.test(parsed[1])) fail('INVALID');
    return parsed;
  } catch { fail('INVALID'); }
}

export async function listOnlineDirectory(env, userId, { game, status = 'all', cursor = '', limit = 20 } = {}, now = Date.now()) {
  if (!supported(game)) fail('GAME');
  if (!['all', 'waiting', 'playing'].includes(status) || !Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 30) fail('INVALID');
  if (!onlineDirectoryEnabled(env) || !env.DB) return { game, enabled: false, rooms: [], nextCursor: null, serverNow: now };
  const after = parseCursor(cursor), count = Number(limit);
  const conditions = [`r.game=?`, `r.expires_at>?`, liveAccountSql('r.host_user_id'),
    `NOT EXISTS(SELECT 1 FROM social_blocks b JOIN json_each(r.member_user_ids) member
      ON ((b.blocker_id=? AND b.blocked_id=member.value) OR (b.blocked_id=? AND b.blocker_id=member.value)))`];
  const values = [game, now, userId, userId];
  if (status !== 'all') { conditions.push('r.status=?'); values.push(status); }
  if (after) { conditions.push('(r.created_at<? OR (r.created_at=? AND r.room_code<?))'); values.push(after[0], after[0], after[1]); }
  const { results } = await env.DB.prepare(`SELECT r.* FROM online_public_rooms r WHERE ${conditions.join(' AND ')}
    ORDER BY r.created_at DESC,r.room_code DESC LIMIT ?`).bind(...values, count + 1).all();
  const page = results.slice(0, count);
  return { game, enabled: true, rooms: page.map(row => ({ code: row.room_code, game: row.game,
    roomName: row.room_name, players: row.players, capacity: row.capacity, minimum: row.minimum,
    unit: getGameModeSupport(row.game).unit, status: row.status, full: row.players >= row.capacity,
    joinable: Boolean(row.joinable), createdAt: row.created_at })),
    nextCursor: results.length > count ? cursorOf(page.at(-1)) : null, serverNow: now };
}

export async function routeOnlineDirectory(request, env, url, charge) {
  if (url.pathname !== '/api/online/rooms/public' || request.method !== 'GET') return null;
  const { user } = await requireSession(env, request, { rotate: false });
  if (charge) await charge('socialRead', 'RATE_LIMIT', user.id);
  return json(await listOnlineDirectory(env, user.id, Object.fromEntries(url.searchParams)));
}
export async function cleanupOnlineDirectory(env, now=Date.now()) {
  if(onlineDirectoryEnabled(env)&&env.DB)await env.DB.prepare('DELETE FROM online_public_rooms WHERE expires_at<=?').bind(now).run();
}
