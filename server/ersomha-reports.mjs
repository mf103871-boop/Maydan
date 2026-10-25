import { fail } from './room-model.mjs';
import { readJson, json, sha256 } from './protocol.mjs';
import { requireSession, withRotation } from './accounts/session.mjs';
import { clientIdOf, textOf, userId } from './social/model.mjs';
import { chargeUser } from './social/db.mjs';
import { liveAccountSql } from './moderation/access.mjs';
import { ERSOMHA_PALETTE, ERSOMHA_WIDTHS } from '../src/games/ersomha/drawing.js';

const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const first = (env, sql, ...args) => stmt(env, sql, ...args).first();

export function drawingReportInput(body) {
  const keys = new Set(['roomCode', 'matchId', 'round', 'reason', 'clientId']);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.has(key))
    || !/^\d{6}$/.test(body.roomCode || '') || !Number.isSafeInteger(body.matchId) || body.matchId < 1
    || !Number.isInteger(body.round) || body.round < 1 || body.round > 16) fail('INVALID', 400);
  const reason = textOf(body.reason, 500);
  if ([...reason].length < 3) fail('INVALID', 400);
  return { roomCode: body.roomCode, matchId: body.matchId, round: body.round, reason, clientId: clientIdOf(body.clientId) };
}

// The evidence comes from the room binding, never from a submitted screenshot.
// Project onto a small whitelist so no secret word can enter reports by accident.
export function privateDrawingEvidence(value, input) {
  if (!value || value.game !== 'ersomha' || value.roomCode !== input.roomCode || value.matchId !== input.matchId
    || value.round !== input.round || !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0
    || !value.canvas || !Array.isArray(value.canvas.strokes) || value.canvas.strokes.length > 512) fail('INVALID', 400);
  const drawerUserId = userId(value.drawerUserId);
  const canvas = value.canvas;
  if (!Number.isSafeInteger(canvas.epoch) || canvas.epoch < 1 || !Number.isSafeInteger(canvas.seq) || canvas.seq < 0) fail('INVALID', 400);
  let points = 0;
  const strokes = canvas.strokes.map(stroke => {
    if (!stroke || !/^[A-Za-z0-9_-]{1,100}$/.test(stroke.strokeId || '') || !ERSOMHA_PALETTE.includes(stroke.color)
      || !ERSOMHA_WIDTHS.includes(stroke.width) || !['pen', 'eraser'].includes(stroke.tool)
      || !Array.isArray(stroke.points) || !stroke.points.length) fail('INVALID', 400);
    points += stroke.points.length;
    if (points > 16_000) fail('INVALID', 400);
    const coordinates = stroke.points.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || point.some(n => !Number.isFinite(n) || n < 0 || n > 1)) fail('INVALID', 400);
      return [point[0], point[1]];
    });
    return { strokeId: stroke.strokeId, points: coordinates, color: stroke.color, width: stroke.width, tool: stroke.tool, end: Boolean(stroke.end) };
  });
  return { game: 'ersomha', roomCode: input.roomCode, matchId: input.matchId, round: input.round,
    drawerUserId, createdAt: value.createdAt, canvas: { epoch: canvas.epoch, seq: canvas.seq, strokes, undoneIds: [] } };
}

export async function saveDrawingReport(env, reporterId, body, now = Date.now()) {
  const input = drawingReportInput(body);
  userId(reporterId);
  const reportId = await sha256(`${reporterId}:${input.clientId}:ersomha-report`);
  const requestHash = await sha256(JSON.stringify(input));
  const previous = await first(env, 'SELECT request_hash FROM ersomha_drawing_reports WHERE report_id=?', reportId);
  if (previous) {
    if (previous.request_hash !== requestHash) fail('CONFLICT', 409);
    if (await first(env, 'SELECT id FROM social_reports WHERE id=? AND reporter_id=?', reportId, reporterId)) return { ok: true, reportId };
  }
  if (!env.ROOMS) fail('ROOM_UNAVAILABLE', 503);
  const room = env.ROOMS.get(env.ROOMS.idFromName(input.roomCode));
  const response = await room.fetch(new Request('https://room.internal/drawing-evidence', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountUserId: reporterId, matchId: input.matchId, round: input.round }),
  }));
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    fail(['NOT_FOUND', 'FORBIDDEN', 'EXPIRED'].includes(result?.error) ? result.error : 'ROOM_UNAVAILABLE', response.status >= 500 ? 503 : 404);
  }
  const evidence = privateDrawingEvidence(await response.json(), input);
  const serialized = JSON.stringify(evidence);
  if (new TextEncoder().encode(serialized).length > 900_000) fail('INVALID', 413);
  const live = liveAccountSql('?');
  const exists = 'EXISTS(SELECT 1 FROM users WHERE id=?) AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=?)';
  // The hash reservation and parent report share one D1 transaction. A retry
  // cannot mix another reason or another room's canvas into the first report.
  await env.DB.batch([
    stmt(env, `INSERT OR IGNORE INTO ersomha_drawing_reports(report_id,request_hash,reporter_id,reported_id,room_code,match_id,turn,evidence_json,created_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${live} AND ${exists}`,
    reportId, requestHash, reporterId, evidence.drawerUserId, input.roomCode, input.matchId, input.round, serialized, now,
    reporterId, reporterId, evidence.drawerUserId, evidence.drawerUserId),
    stmt(env, `INSERT OR IGNORE INTO social_reports(id,reporter_id,reported_id,message_seq,message_text,reason,created_at)
      SELECT ?,?,?,NULL,NULL,?,? WHERE EXISTS(SELECT 1 FROM ersomha_drawing_reports WHERE report_id=? AND request_hash=?) AND ${live} AND ${exists}`,
    reportId, reporterId, evidence.drawerUserId, input.reason, now, reportId, requestHash,
    reporterId, reporterId, evidence.drawerUserId, evidence.drawerUserId),
  ]);
  const saved = await first(env, 'SELECT request_hash FROM ersomha_drawing_reports WHERE report_id=?', reportId);
  if (saved && saved.request_hash !== requestHash) fail('CONFLICT', 409);
  if (!saved || !await first(env, 'SELECT id FROM social_reports WHERE id=?', reportId)) fail('NOT_FOUND', 404);
  return { ok: true, reportId };
}

export async function routeDrawingReports(request, env, url, charge) {
  if (url.pathname !== '/api/games/ersomha/reports') return null;
  if (request.method !== 'POST' || !env.DB) fail('NOT_FOUND', 404);
  if (charge) await charge('profileWrite');
  const auth = await requireSession(env, request);
  await chargeUser(env, auth.user.id, 'write');
  const result = await saveDrawingReport(env, auth.user.id, await readJson(request, 4096));
  return withRotation(json(result, 201), auth.rotated);
}

export async function drawingReportEvidence(env, reportId) {
  const found = await first(env, `SELECT d.evidence_json FROM ersomha_drawing_reports d JOIN social_reports r ON r.id=d.report_id WHERE d.report_id=?`, reportId);
  if (!found) fail('NOT_FOUND', 404);
  const value = JSON.parse(found.evidence_json);
  const safe = privateDrawingEvidence(value, value);
  return json({ game: safe.game, round: safe.round, createdAt: safe.createdAt, canvas: safe.canvas });
}

export function drawingReportDeleteStatements(env, accountId) {
  return [stmt(env, 'DELETE FROM ersomha_drawing_reports WHERE reporter_id=? OR reported_id=?', accountId, accountId)];
}

export async function cleanupDrawingReports(env, before) {
  return stmt(env, `DELETE FROM ersomha_drawing_reports WHERE created_at<? OR NOT EXISTS(SELECT 1 FROM social_reports WHERE id=report_id)`, before).run();
}
