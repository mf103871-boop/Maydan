import { fail } from './room-model.mjs';
import { sha256 } from './protocol.mjs';
import { MAFIA_REPORT_CATEGORIES } from '../src/online/mafia-report-shared.js';
import { liveAccountSql, isModerator } from './moderation/access.mjs';

const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const first = (env, sql, ...args) => stmt(env, sql, ...args).first();
const all = async (env, sql, ...args) => (await stmt(env, sql, ...args).all()).results || [];
const exists = alias => `EXISTS(SELECT 1 FROM users u WHERE u.id=${alias}) AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=${alias})`;
const actorSql = `${liveAccountSql('?')} AND EXISTS(SELECT 1 FROM sessions s WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND (s.revoked_at IS NULL OR s.revoked_at>?))`;
const actorArgs = (actor, now) => [actor.userId, actor.userId, actor.sessionId, actor.userId, now, now];
export async function assertMafiaReportActor(env, actor, moderator = false) {
  if (moderator && !isModerator(env, actor.userId)) fail('FORBIDDEN', 403);
  if (!await first(env, `SELECT 1 AS ok WHERE ${actorSql}`, ...actorArgs(actor, Date.now()))) fail('AUTH', 401);
}
export function mafiaReportInput(roomCode, body) {
  if (!/^\d{6}$/.test(roomCode) || typeof body?.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body.reason)
    || !/^[A-Za-z0-9_-]{1,80}$/.test(body.clientId || '') || !/^[A-Za-z0-9_-]{1,80}$/.test(body.targetId || '')
    || !Number.isSafeInteger(body.matchId) || body.matchId < 0 || body.messageId != null && !/^[A-Za-z0-9:_-]{1,120}$/.test(body.messageId)
    || body.scope != null && !['player', 'observer'].includes(body.scope)) fail('INVALID', 400);
  const category = body.category ?? 'other';
  if (!MAFIA_REPORT_CATEGORIES.some(value => value.id === category)) fail('INVALID', 400);
  // Credentials/unknown client fields never enter the stable hash or storage.
  return { roomCode, targetId: body.targetId, matchId: body.matchId, messageId: body.messageId ?? null,
    reason: body.reason.trim(), category, scope: body.scope === 'observer' ? 'observer' : 'player', clientId: body.clientId };
}
export function privateMafiaReportEvidence(raw, input, legacy = false) {
  const perspective = raw?.perspective;
  if (!/^[A-Za-z0-9:_-]{1,180}$/.test(raw?.matchKey || '') || !raw.matchKey.endsWith(`:${input.matchId}`)
    || !Array.isArray(raw.messages) || raw.messages.length > 500 || typeof raw.phase !== 'string'
    || !legacy && (!perspective || perspective.scope !== input.scope || perspective.delayMs !== (input.scope === 'observer' ? 30_000 : 0))) fail('ROOM_UNAVAILABLE', 503);
  const messages = raw.messages.map(message => {
    if (typeof message?.id !== 'string' || message.id.length > 120 || typeof message.playerId !== 'string' || message.playerId.length > 80
      || typeof message.text !== 'string' || message.text.length > 2000 || !Number.isSafeInteger(message.at)
      || !legacy && !['public', 'team', 'observers'].includes(message.channel)) fail('ROOM_UNAVAILABLE', 503);
    return { id: message.id, playerId: message.playerId, text: message.text, at: message.at, channel: legacy ? (['public','team','observers'].includes(message.channel) ? message.channel : 'unknown') : message.channel };
  });
  const channels = [...new Set(messages.map(message => message.channel))].sort();
  if (!legacy && input.scope === 'observer' && channels.some(channel => channel !== 'public')) fail('ROOM_UNAVAILABLE', 503);
  return { game: 'mafia', matchKey: raw.matchKey, phase: raw.phase, capturedAt: Number.isSafeInteger(raw.capturedAt) ? raw.capturedAt : null,
    perspective: { scope: legacy ? 'unknown' : perspective.scope, delayMs: legacy ? null : perspective.delayMs, channels }, messages };
}
const statusSql = `CASE WHEN d.report_id IS NOT NULL THEN 'reviewed' WHEN m.review_started_at IS NOT NULL THEN 'reviewing' ELSE 'queued' END`;
const ownerRow = async (env, actor, id) => first(env, `SELECT m.id,m.room_code,m.match_id,m.category,m.created_at,m.request_hash,${statusSql} AS status
  FROM mafia_reports m JOIN social_reports r ON r.id=m.id LEFT JOIN moderation_report_decisions d ON d.report_id=m.id
  WHERE m.id=? AND m.reporter_id=? AND ${actorSql}`, id, actor.userId, ...actorArgs(actor, Date.now()));
const ownView = row => ({ id: row.id, roomCode: row.room_code, matchId: row.match_id, category: row.category, createdAt: row.created_at, status: row.status });
export async function ownMafiaReportCase(env, actor, id) {
  await ownerRow(env,actor,id);await assertMafiaReportActor(env,actor);const current=await ownerRow(env,actor,id);
  if(!current){await assertMafiaReportActor(env,actor);fail('NOT_FOUND',404);}return ownView(current);
}

export async function saveMafiaReportCase(env, actor, roomCode, body) {
  const input = mafiaReportInput(roomCode, body), id = await sha256(`mafia-report:${actor.userId}:${input.clientId}`);
  const requestHash = await sha256(JSON.stringify(input)); await assertMafiaReportActor(env, actor);
  const prior = await ownerRow(env, actor, id);
  if (prior) {
    if (!prior.request_hash || prior.request_hash !== requestHash) fail('CONFLICT', 409);
    await assertMafiaReportActor(env,actor);const current = await ownerRow(env, actor, id);
    if (!current){await assertMafiaReportActor(env,actor);fail('NOT_FOUND',404);}
    if(current.request_hash!==requestHash)fail('CONFLICT',409);
    return { ok: true, reportId: id, status: current.status };
  }
  const response = await env.ROOMS.get(env.ROOMS.idFromName(roomCode)).fetch(new Request(`https://internal/${roomCode}/mafia-evidence`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountUserId: actor.userId, accountSessionId: actor.sessionId,
      ...(input.scope === 'observer' ? { scope: 'observer', id: body.id, token: body.token } : {}), targetId: input.targetId, messageId: input.messageId, matchId: input.matchId }),
  }));
  if (!response.ok) { const error = await response.json().catch(() => null); fail(['AUTH', 'NOT_FOUND', 'FORBIDDEN'].includes(error?.error) ? error.error : 'ROOM_UNAVAILABLE', response.status >= 500 ? 503 : 404); }
  const raw = await response.json(), evidence = privateMafiaReportEvidence(raw, input);
  const target = raw.reportedUserId;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(target || '') || target === actor.userId) fail('INVALID', 400);
  const serialized = JSON.stringify(evidence); if (new TextEncoder().encode(serialized).length > 180_000) fail('INVALID', 413);
  const now = Date.now(), targetText = evidence.messages.filter(message => message.playerId === input.targetId).map(message => message.text).join('\n').slice(0, 6000);
  await env.DB.batch([
    stmt(env, `INSERT OR IGNORE INTO mafia_reports(id,reporter_id,reported_id,room_code,match_key,reason,evidence,created_at,request_hash,category,match_id)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${actorSql} AND ${exists('?')}`,
    id, actor.userId, target, roomCode, evidence.matchKey, input.reason, serialized, now, requestHash, input.category, input.matchId, ...actorArgs(actor, now), target, target),
    stmt(env, `INSERT OR IGNORE INTO social_reports(id,reporter_id,reported_id,message_seq,message_text,reason,created_at)
      SELECT ?,?,?,NULL,?,?,? WHERE EXISTS(SELECT 1 FROM mafia_reports WHERE id=? AND request_hash=?) AND ${actorSql} AND ${exists('?')}`,
    id, actor.userId, target, targetText, input.reason, now, id, requestHash, ...actorArgs(actor, now), target, target),
  ]);
  await assertMafiaReportActor(env,actor);const saved = await ownerRow(env, actor, id);
  if (!saved){await assertMafiaReportActor(env,actor);fail('NOT_FOUND',404);} if (saved.request_hash !== requestHash) fail('CONFLICT', 409);
  return { ok: true, reportId: id, status: saved.status };
}
export async function ownMafiaReportCases(env, actor, { before = Number.MAX_SAFE_INTEGER, limit = 20 } = {}) {
  if (!Number.isSafeInteger(before) || before < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) fail('INVALID', 400);
  const read = () => all(env, `SELECT m.id,m.room_code,m.match_id,m.category,m.created_at,r.rowid AS seq,${statusSql} AS status
    FROM mafia_reports m JOIN social_reports r ON r.id=m.id LEFT JOIN moderation_report_decisions d ON d.report_id=m.id
    WHERE m.reporter_id=? AND r.rowid<? AND ${actorSql} ORDER BY r.rowid DESC LIMIT ?`, actor.userId, before, ...actorArgs(actor, Date.now()), limit + 1);
  // Re-read after the source lookup so deletion/ownership changes cannot return
  // a case that vanished while its list was being materialized.
  await read();await assertMafiaReportActor(env,actor);const current=await read();
  if(!current.length)await assertMafiaReportActor(env,actor);
  return { reports: current.slice(0, limit).map(ownView), nextBefore: current.length > limit ? current[limit - 1].seq : null };
}
export async function mafiaReportReviewEvidence(env, actor, id) {
  await assertMafiaReportActor(env, actor, true);
  const row = await first(env, `SELECT m.* FROM mafia_reports m JOIN social_reports r ON r.id=m.id
    WHERE m.id=? AND ${exists('m.reporter_id')} AND ${exists('m.reported_id')} AND ${actorSql}`, id, ...actorArgs(actor, Date.now()));
  if (!row) fail('NOT_FOUND', 404);
  let raw; try { raw = JSON.parse(row.evidence); } catch { fail('NOT_FOUND', 404); }
  const matchId = row.match_id ?? Number(row.match_key.split(':').at(-1));
  const safe = privateMafiaReportEvidence(raw, { matchId, scope: raw.perspective?.scope }, !row.request_hash);
  // Validate the source case after materializing evidence, including its parties.
  const current=await first(env,`SELECT 1 AS ok FROM mafia_reports m JOIN social_reports r ON r.id=m.id
    WHERE m.id=? AND m.created_at=? AND m.match_key=? AND m.reporter_id=? AND m.reported_id=? AND m.request_hash IS ?
      AND m.evidence=? AND m.category=? AND m.match_id IS ? AND m.room_code=?
      AND ${exists('m.reporter_id')} AND ${exists('m.reported_id')} AND ${actorSql}`,
  id,row.created_at,row.match_key,row.reporter_id,row.reported_id,row.request_hash,row.evidence,row.category,row.match_id,row.room_code,...actorArgs(actor,Date.now()));
  if(!current){await assertMafiaReportActor(env,actor,true);fail('NOT_FOUND',404);}
  if(!isModerator(env,actor.userId))fail('FORBIDDEN',403);
  return { ...safe, reportId: row.id, roomCode: row.room_code, matchId, category: row.category };
}
