import { randomHex } from '../accounts/jwt.mjs';
import { fail } from '../room-model.mjs';
import { sha256 } from '../protocol.mjs';
import { pairOf, publicProfile, messageView } from './model.mjs';
import { ensurePlayerProfile, profileAchievementStatements } from '../profiles/db.mjs';

const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const first = (env, sql, ...args) => stmt(env, sql, ...args).first();
const all = async (env, sql, ...args) => (await stmt(env, sql, ...args).all()).results || [];
const run = (env, sql, ...args) => stmt(env, sql, ...args).run();
const changed = (result) => Number(result?.meta?.changes || 0) > 0;
const peerOf = (row, id) => row.user_low === id ? row.user_high : row.user_low;
// Repeated inside every sensitive SQL statement, not just a preflight JS check.
const unblocked = (alias) => `NOT EXISTS (SELECT 1 FROM social_blocks b WHERE
  (b.blocker_id = ${alias}.user_low AND b.blocked_id = ${alias}.user_high) OR
  (b.blocker_id = ${alias}.user_high AND b.blocked_id = ${alias}.user_low))`;
const livePair = (alias) => `EXISTS (SELECT 1 FROM users u WHERE u.id = ${alias}.user_low)
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = ${alias}.user_high)
  AND NOT EXISTS (SELECT 1 FROM account_deletions d WHERE d.user_id IN (${alias}.user_low,${alias}.user_high))`;
const allowedConversation = (alias) => `${unblocked(alias)} AND ${livePair(alias)} AND EXISTS
  (SELECT 1 FROM social_friendships f WHERE f.user_low = ${alias}.user_low
    AND f.user_high = ${alias}.user_high AND f.status = 'accepted')`;

export async function ensureProfile(env, userId, now = Date.now()) {
  for (let tries = 0; tries < 5; tries++) {
    const existing = await first(env, `SELECT p.*,u.name FROM social_profiles p JOIN users u ON u.id=p.user_id
      WHERE p.user_id=? AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=p.user_id)`, userId);
    if (existing) return existing;
    await run(env, `INSERT OR IGNORE INTO social_profiles(user_id,code,created_at)
      SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?)
      AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=?)`, userId, `MDN-${randomHex(5).toUpperCase()}`, now, userId, userId);
  }
  const row = await first(env, `SELECT p.*,u.name FROM social_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=?
    AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=p.user_id)`, userId);
  if (!row) fail('NOT_FOUND', 404);
  return row;
}
export async function touchPresence(env, userId, lastActiveAt, onlineUntil) {
  await ensureProfile(env, userId, lastActiveAt);
  await run(env, `UPDATE social_profiles SET last_active_at=MAX(last_active_at,?),online_until=?
    WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=?)
    AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=?)`, lastActiveAt, onlineUntil, userId, userId, userId);
}
export async function chargeUser(env, userId, kind, now = Date.now()) {
  const max = kind === 'request' ? 10 : 120;
  const window = Math.floor(now / 60_000) * 60_000;
  const result = await run(env, `INSERT INTO social_limits(user_id,kind,window_start,count)
    SELECT ?,?,?,1 WHERE EXISTS(SELECT 1 FROM users WHERE id=?)
    AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=?)
    ON CONFLICT(user_id,kind) DO UPDATE SET window_start=MAX(social_limits.window_start,excluded.window_start),
      count=CASE WHEN social_limits.window_start<excluded.window_start THEN 1 ELSE social_limits.count+1 END
    WHERE social_limits.window_start<excluded.window_start OR social_limits.count<?`, userId, kind, window, userId, userId, max);
  if (!changed(result)) fail('RATE_LIMIT', 429);
}
export async function areFriends(env, userId, otherId) {
  const [low, high] = pairOf(userId, otherId);
  return !!await first(env, `SELECT 1 FROM social_friendships f WHERE f.user_low=? AND f.user_high=?
    AND f.status='accepted' AND ${unblocked('f')} AND ${livePair('f')}`, low, high);
}
export async function friendIds(env, userId) {
  const rows = await all(env, `SELECT f.user_low,f.user_high FROM social_friendships f
    WHERE (f.user_low=? OR f.user_high=?) AND f.status='accepted' AND ${unblocked('f')} AND ${livePair('f')}`, userId, userId);
  return rows.map((row) => peerOf(row, userId));
}
export const conversationForUser = (env, userId, conversationId) => first(env,
  `SELECT c.* FROM social_conversations c WHERE c.id=? AND (c.user_low=? OR c.user_high=?) AND ${allowedConversation('c')}`,
  conversationId, userId, userId);
export async function requireConversation(env, userId, conversationId) {
  const row = await conversationForUser(env, userId, conversationId);
  if (!row) fail('NOT_FOUND', 404);
  return row;
}
export async function searchUsers(env, userId, query) {
  const code = query.toUpperCase();
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await all(env, `SELECT p.*,u.name,f.status,f.requester_id FROM social_profiles p
    JOIN users u ON u.id=p.user_id LEFT JOIN social_friendships f
    ON (f.user_low=? AND f.user_high=p.user_id) OR (f.user_high=? AND f.user_low=p.user_id)
    WHERE p.user_id!=? AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=p.user_id)
    AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id)
      OR (b.blocked_id=? AND b.blocker_id=p.user_id))
    AND (p.code=? OR (?=0 AND u.name NOT LIKE '%@%' AND u.name LIKE ? ESCAPE '\\'))
    ORDER BY CASE WHEN p.code=? THEN 0 ELSE 1 END, u.name COLLATE NOCASE,p.user_id LIMIT 20`,
  userId, userId, userId, userId, userId, code, /^MDN-[A-F0-9]{10}$/.test(code) ? 1 : 0, pattern, code);
  return rows.map((row) => ({ ...publicProfile(row), relationship: row.status === 'accepted' ? 'friend' : row.status === 'pending' ?
    (row.requester_id === userId ? 'pending_outgoing' : 'pending_incoming') : 'none' }));
}
export async function friendsOf(env, userId, now) {
  const rows = await all(env, `SELECT p.*,u.name,f.accepted_at,c.id AS conversation_id FROM social_friendships f
    JOIN social_profiles p ON p.user_id=CASE WHEN f.user_low=? THEN f.user_high ELSE f.user_low END
    JOIN users u ON u.id=p.user_id LEFT JOIN social_conversations c ON c.user_low=f.user_low AND c.user_high=f.user_high
    WHERE (f.user_low=? OR f.user_high=?) AND f.status='accepted' AND ${unblocked('f')} AND ${livePair('f')}
    ORDER BY u.name COLLATE NOCASE,p.user_id`, userId, userId, userId);
  return rows.map((row) => ({ ...publicProfile(row, { presence: true, now }), conversationId: row.conversation_id, acceptedAt: row.accepted_at }));
}
export async function requestsOf(env, userId) {
  const rows = await all(env, `SELECT f.*,p.code,p.user_id,u.name FROM social_friendships f
    JOIN social_profiles p ON p.user_id=CASE WHEN f.user_low=? THEN f.user_high ELSE f.user_low END
    JOIN users u ON u.id=p.user_id WHERE (f.user_low=? OR f.user_high=?) AND f.status='pending'
    AND ${unblocked('f')} AND ${livePair('f')} ORDER BY f.created_at DESC,f.id`, userId, userId, userId);
  const result = { incoming: [], outgoing: [] };
  for (const row of rows) result[row.requester_id === userId ? 'outgoing' : 'incoming'].push({ id: row.id, user: publicProfile(row), createdAt: row.created_at });
  return result;
}
export async function requestFriend(env, userId, otherId, now) {
  if (userId === otherId) fail('INVALID', 400);
  await chargeUser(env, userId, 'request', now);
  await ensureProfile(env, otherId, now);
  const [low, high] = pairOf(userId, otherId);
  await run(env, `INSERT OR IGNORE INTO social_friendships(id,user_low,user_high,requester_id,status,created_at)
    SELECT ?,?,?,?,'pending',? WHERE EXISTS(SELECT 1 FROM users WHERE id=?) AND EXISTS(SELECT 1 FROM users WHERE id=?)
    AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id IN (?,?))
    AND NOT EXISTS(SELECT 1 FROM social_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?))`,
  crypto.randomUUID(), low, high, userId, now, low, high, low, high, low, high, high, low);
  const row = await first(env, `SELECT f.* FROM social_friendships f WHERE user_low=? AND user_high=? AND ${unblocked('f')} AND ${livePair('f')}`, low, high);
  if (!row) fail('NOT_FOUND', 404);
  if (row.status !== 'pending' || row.requester_id !== userId) fail('CONFLICT', 409);
  const profile = await ensureProfile(env, otherId, now);
  return { id: row.id, user: publicProfile(profile), createdAt: row.created_at };
}
export async function acceptRequest(env, userId, id, now) {
  const pending = await first(env, 'SELECT * FROM social_friendships WHERE id=? AND (user_low=? OR user_high=?) AND requester_id!=?', id, userId, userId, userId);
  if (!pending) fail('NOT_FOUND', 404);
  const participants = [pending.user_low, pending.user_high];
  for (const participant of participants) await ensurePlayerProfile(env, participant);
  await env.DB.batch([
    stmt(env, `UPDATE social_friendships AS f SET status='accepted',accepted_at=? WHERE id=?
      AND (user_low=? OR user_high=?) AND requester_id!=? AND status='pending' AND ${unblocked('f')} AND ${livePair('f')}`, now, id, userId, userId, userId),
    stmt(env, `INSERT OR IGNORE INTO social_conversations(id,user_low,user_high,created_at)
      SELECT ?,f.user_low,f.user_high,? FROM social_friendships f WHERE f.id=? AND (f.user_low=? OR f.user_high=?)
      AND f.requester_id!=? AND f.status='accepted' AND ${unblocked('f')} AND ${livePair('f')}`, crypto.randomUUID(), now, id, userId, userId, userId),
    ...participants.flatMap(participant => profileAchievementStatements(env, participant, now)),
  ]);
  const row = await first(env, `SELECT c.* FROM social_conversations c JOIN social_friendships f
    ON f.user_low=c.user_low AND f.user_high=c.user_high WHERE f.id=? AND f.requester_id!=?
    AND (c.user_low=? OR c.user_high=?) AND ${allowedConversation('c')}`, id, userId, userId, userId);
  if (!row) fail('NOT_FOUND', 404);
  return { conversationId: row.id, otherId: peerOf(row, userId) };
}
export async function dismissRequest(env, userId, id, cancel) {
  const row = await first(env, `SELECT * FROM social_friendships WHERE id=? AND (user_low=? OR user_high=?)
    AND status='pending' AND requester_id ${cancel ? '=' : '!='} ?`, id, userId, userId, userId);
  if (!row) fail('NOT_FOUND', 404);
  const result = await run(env, `DELETE FROM social_friendships WHERE id=? AND status='pending'
    AND (user_low=? OR user_high=?) AND requester_id ${cancel ? '=' : '!='} ?`, id, userId, userId, userId);
  if (!changed(result)) fail('NOT_FOUND', 404);
  return peerOf(row, userId);
}
export async function removeFriend(env, userId, otherId) {
  const [low, high] = pairOf(userId, otherId);
  await run(env, "DELETE FROM social_friendships WHERE user_low=? AND user_high=? AND status='accepted'", low, high);
}
export async function blocksOf(env, userId) {
  const rows = await all(env, `SELECT p.*,u.name FROM social_blocks b JOIN social_profiles p ON p.user_id=b.blocked_id
    JOIN users u ON u.id=p.user_id WHERE b.blocker_id=? ORDER BY b.created_at DESC`, userId);
  return rows.map((row) => publicProfile(row));
}
export async function blockUser(env, userId, otherId, now) {
  if (userId === otherId) fail('INVALID', 400);
  await ensureProfile(env, otherId, now);
  const [low, high] = pairOf(userId, otherId);
  await env.DB.batch([
    stmt(env, `INSERT OR IGNORE INTO social_blocks(blocker_id,blocked_id,created_at) SELECT ?,?,?
      WHERE EXISTS(SELECT 1 FROM users WHERE id=?) AND EXISTS(SELECT 1 FROM users WHERE id=?)
      AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id IN (?,?))`, userId, otherId, now, userId, otherId, userId, otherId),
    stmt(env, `DELETE FROM social_friendships WHERE user_low=? AND user_high=?
      AND EXISTS(SELECT 1 FROM social_blocks WHERE blocker_id=? AND blocked_id=?)`, low, high, userId, otherId),
  ]);
}
export const unblockUser = (env, userId, otherId) => run(env, 'DELETE FROM social_blocks WHERE blocker_id=? AND blocked_id=?', userId, otherId);

export async function conversationsOf(env, userId, now) {
  const rows = await all(env, `SELECT c.*,p.user_id,p.code,p.last_active_at,p.online_until,u.name,
    COALESCE(r.last_read_seq,0) AS read_seq,COALESCE(pr.last_read_seq,0) AS peer_read_seq,
    (SELECT COUNT(*) FROM social_messages m WHERE m.conversation_id=c.id AND m.sender_id!=? AND m.deleted_at IS NULL AND m.seq>COALESCE(r.last_read_seq,0)) AS unread_count,
    (SELECT MAX(m.seq) FROM social_messages m WHERE m.conversation_id=c.id) AS last_seq
    FROM social_conversations c JOIN social_profiles p ON p.user_id=CASE WHEN c.user_low=? THEN c.user_high ELSE c.user_low END
    JOIN users u ON u.id=p.user_id LEFT JOIN social_reads r ON r.conversation_id=c.id AND r.user_id=?
    LEFT JOIN social_reads pr ON pr.conversation_id=c.id AND pr.user_id=p.user_id
    WHERE (c.user_low=? OR c.user_high=?) AND ${allowedConversation('c')}
    ORDER BY COALESCE(last_seq,0) DESC,c.id`, userId, userId, userId, userId, userId);
  // Each message read independently rechecks membership/block status.
  return Promise.all(rows.map(async (row) => ({ id: row.id, user: publicProfile(row, { presence: true, now }),
    lastMessage: row.last_seq ? await messageForUser(env, userId, row.last_seq) : null,
    unreadCount: row.unread_count, readSeq: row.read_seq, peerReadSeq: row.peer_read_seq })));
}
export async function messageForUser(env, userId, seq) {
  const row = await first(env, `SELECT m.* FROM social_messages m JOIN social_conversations c ON c.id=m.conversation_id
    WHERE m.seq=? AND (c.user_low=? OR c.user_high=?) AND ${allowedConversation('c')}`, seq, userId, userId);
  return row ? messageView(row) : null;
}
export async function messagesOf(env, userId, conversationId, { before, after, limit }) {
  const convo = await requireConversation(env, userId, conversationId);
  const ascending = after !== null;
  const rows = await all(env, `SELECT m.* FROM social_messages m JOIN social_conversations c ON c.id=m.conversation_id
    WHERE c.id=? AND (c.user_low=? OR c.user_high=?) AND ${allowedConversation('c')}
    ${before !== null ? 'AND m.seq<?' : ascending ? 'AND m.seq>?' : ''}
    ORDER BY m.seq ${ascending ? 'ASC' : 'DESC'} LIMIT ?`, conversationId, userId, userId,
  ...(before !== null ? [before] : ascending ? [after] : []), limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  if (!ascending) page.reverse();
  const reads = await all(env, `SELECT r.* FROM social_reads r JOIN social_conversations c ON c.id=r.conversation_id
    WHERE c.id=? AND (c.user_low=? OR c.user_high=?) AND ${allowedConversation('c')}`, conversationId, userId, userId);
  return { messages: page.map(messageView), nextBefore: hasMore && !ascending ? page[0].seq : null,
    nextAfter: page.at(-1)?.seq ?? after ?? 0, hasMore,
    readSeq: reads.find((r) => r.user_id === userId)?.last_read_seq || 0,
    peerReadSeq: reads.find((r) => r.user_id === peerOf(convo, userId))?.last_read_seq || 0 };
}
export async function sendMessage(env, userId, conversationId, text, clientId, now) {
  const hash = await sha256(text);
  await run(env, `INSERT OR IGNORE INTO social_messages(conversation_id,sender_id,client_id,text,original_hash,created_at)
    SELECT c.id,?,?,?,?,? FROM social_conversations c WHERE c.id=? AND (c.user_low=? OR c.user_high=?)
    AND ${allowedConversation('c')} AND (SELECT COUNT(*) FROM social_messages WHERE sender_id=? AND created_at>?)<60`,
  userId, clientId, text, hash, now, conversationId, userId, userId, userId, now - 60_000);
  const row = await first(env, `SELECT m.*,c.user_low,c.user_high FROM social_messages m JOIN social_conversations c ON c.id=m.conversation_id
    WHERE m.sender_id=? AND m.client_id=? AND (c.user_low=? OR c.user_high=?) AND ${allowedConversation('c')}`, userId, clientId, userId, userId);
  if (!row) {
    await requireConversation(env, userId, conversationId);
    fail('RATE_LIMIT', 429);
  }
  if (row.conversation_id !== conversationId || row.original_hash !== hash) fail('CONFLICT', 409);
  return { message: messageView(row), otherId: peerOf(row, userId) };
}
export async function changeMessage(env, userId, seq, text, now) {
  const deleting = text === null;
  const result = await run(env, `UPDATE social_messages SET ${deleting ? "text='',deleted_at=?" : 'text=?,edited_at=?'}
    WHERE seq=? AND sender_id=? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM social_conversations c
      WHERE c.id=social_messages.conversation_id AND (c.user_low=? OR c.user_high=?) AND ${allowedConversation('c')})`,
  ...(deleting ? [now] : [text, now]), seq, userId, userId, userId);
  const message = await messageForUser(env, userId, seq);
  if (!message || message.senderId !== userId || (!changed(result) && !(deleting && message.deletedAt !== null))) fail('NOT_FOUND', 404);
  const convo = await requireConversation(env, userId, message.conversationId);
  return { message, otherId: peerOf(convo, userId) };
}
export async function markRead(env, userId, conversationId, seq, now) {
  const convo = await requireConversation(env, userId, conversationId);
  if (seq > 0) {
    const result = await run(env, `INSERT INTO social_reads(conversation_id,user_id,last_read_seq,updated_at)
      SELECT c.id,?,?,? FROM social_conversations c WHERE c.id=? AND (c.user_low=? OR c.user_high=?)
      AND ${allowedConversation('c')} AND EXISTS(SELECT 1 FROM social_messages m WHERE m.conversation_id=c.id AND m.seq=?)
      ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_seq=MAX(social_reads.last_read_seq,excluded.last_read_seq),updated_at=excluded.updated_at`,
    userId, seq, now, conversationId, userId, userId, seq);
    if (!changed(result)) fail('INVALID', 400);
  }
  const row = await first(env, `SELECT r.last_read_seq FROM social_reads r JOIN social_conversations c ON c.id=r.conversation_id
    WHERE r.conversation_id=? AND r.user_id=? AND (c.user_low=? OR c.user_high=?) AND ${allowedConversation('c')}`, conversationId, userId, userId, userId);
  return { readSeq: row?.last_read_seq || 0, otherId: peerOf(convo, userId) };
}
export async function reportUser(env, userId, otherId, messageSeq, reason, now) {
  if (userId === otherId) fail('INVALID', 400);
  let message = null;
  if (messageSeq !== null) {
    // A member can report received evidence even after blocking/removing a friend.
    message = await first(env, `SELECT m.text FROM social_messages m JOIN social_conversations c ON c.id=m.conversation_id
      WHERE m.seq=? AND m.sender_id=? AND (c.user_low=? OR c.user_high=?) AND m.deleted_at IS NULL`, messageSeq, otherId, userId, userId);
    if (!message) fail('NOT_FOUND', 404);
  }
  const result = await run(env, `INSERT INTO social_reports(id,reporter_id,reported_id,message_seq,message_text,reason,created_at)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?) AND EXISTS(SELECT 1 FROM users WHERE id=?)
    AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id IN (?,?))
    AND (SELECT COUNT(*) FROM social_reports WHERE reporter_id=? AND created_at>?)<10`,
  crypto.randomUUID(), userId, otherId, messageSeq, message?.text || null, reason, now, userId, otherId, userId, otherId, userId, now - 3_600_000);
  if (!changed(result)) fail('RATE_LIMIT', 429);
}
export function socialDeleteStatements(env, userId) {
  const ownConversations = 'SELECT id FROM social_conversations WHERE user_low=? OR user_high=?';
  return [
    stmt(env, `DELETE FROM social_messages WHERE conversation_id IN (${ownConversations}) OR sender_id=?`, userId, userId, userId),
    stmt(env, `DELETE FROM social_reads WHERE conversation_id IN (${ownConversations}) OR user_id=?`, userId, userId, userId),
    stmt(env, 'DELETE FROM social_reports WHERE reporter_id=? OR reported_id=?', userId, userId),
    stmt(env, 'DELETE FROM social_conversations WHERE user_low=? OR user_high=?', userId, userId),
    stmt(env, 'DELETE FROM social_friendships WHERE user_low=? OR user_high=?', userId, userId),
    stmt(env, 'DELETE FROM social_blocks WHERE blocker_id=? OR blocked_id=?', userId, userId),
    stmt(env, 'DELETE FROM social_profiles WHERE user_id=?', userId),
    stmt(env, 'DELETE FROM social_limits WHERE user_id=?', userId),
  ];
}
export async function deleteSocialUser(env, userId) {
  const peers = (await all(env, "SELECT user_low,user_high FROM social_friendships WHERE (user_low=? OR user_high=?) AND status='accepted'", userId, userId))
    .map((row) => peerOf(row, userId));
  await env.DB.batch(socialDeleteStatements(env, userId));
  return peers;
}
