import { fail } from '../room-model.mjs';

export const ONLINE_WINDOW = 45_000;
export const MAX_TEXT = 2000;
export const pairOf = (a, b) => a < b ? [a, b] : [b, a];
export function userId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail('INVALID', 400);
  return value;
}
export function textOf(value, max = MAX_TEXT) {
  if (typeof value !== 'string') fail('INVALID', 400);
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!text || Array.from(text).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) fail('INVALID', 400);
  return text;
}
export function clientIdOf(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(value)) fail('INVALID', 400);
  return value;
}
export function sequenceOf(value, allowZero = false) {
  if (!/^(0|[1-9]\d*)$/.test(String(value))) fail('INVALID', 400);
  const seq = Number(value);
  if (!Number.isSafeInteger(seq) || seq < (allowZero ? 0 : 1)) fail('INVALID', 400);
  return seq;
}
export function pagination(search) {
  const before = search.has('before') ? sequenceOf(search.get('before')) : null;
  const after = search.has('after') ? sequenceOf(search.get('after'), true) : null;
  if (before !== null && after !== null) fail('INVALID', 400);
  const limit = search.has('limit') ? sequenceOf(search.get('limit')) : 50;
  if (limit > 100) fail('INVALID', 400);
  return { before, after, limit };
}
export function publicProfile(row, { presence = false, now = Date.now() } = {}) {
  const name = typeof row.name === 'string' && !row.name.includes('@') ? row.name.trim().slice(0, 80) : '';
  const result = { id: row.user_id || row.id, name: name || 'لاعب ميدان', code: row.code };
  if (presence) {
    result.lastActiveAt = Number(row.last_active_at) || 0;
    result.online = Number(row.online_until) > now && result.lastActiveAt > now - ONLINE_WINDOW;
  }
  return result;
}
export const messageView = (row) => ({
  seq: row.seq, conversationId: row.conversation_id, senderId: row.sender_id,
  text: row.deleted_at === null ? row.text : '', clientId: row.client_id,
  createdAt: row.created_at, editedAt: row.edited_at, deletedAt: row.deleted_at,
});
