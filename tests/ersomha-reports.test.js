import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { deleteUser } from '../server/accounts/db.mjs';
import { routeModeration } from '../server/moderation/router.mjs';
import { drawingReportInput, privateDrawingEvidence, saveDrawingReport, routeDrawingReports, cleanupDrawingReports } from '../server/ersomha-reports.mjs';
import { reviewDrawingPath } from '../src/moderation/client.js';

const input = () => ({ roomCode: '123456', matchId: 1, round: 1, reason: 'رسمة غير مناسبة', clientId: 'draw-report-0001' });
const canvas = () => ({ epoch: 1, seq: 1, strokes: [{ strokeId: 'stroke_1', points: [[0.1, 0.2], [0.8, 0.9]], color: '#118d96', width: 6, tool: 'pen', end: true }] });
const evidence = () => ({ game: 'ersomha', roomCode: '123456', matchId: 1, round: 1, drawerUserId: 'drawer', createdAt: Date.now(), canvas: canvas() });
async function fixture() {
  const DB = createLocalD1();
  for (const id of ['reporter', 'drawer', 'moderator']) await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(id, id, Date.now(), Date.now()).run();
  const calls = [];
  const env = { DB, MODERATOR_USER_IDS: 'moderator', ROOMS: { idFromName: id => id, get: code => ({ fetch: async request => {
    const body = await request.json(); calls.push({ code, path: new URL(request.url).pathname, body });
    assert.equal(body.accountUserId, 'reporter');
    return new Response(JSON.stringify(evidence()), { headers: { 'content-type': 'application/json' } });
  } }) } };
  return { env, DB, calls };
}

test('drawing report accepts only a bounded round reference, reason and stable client ID', () => {
  assert.deepEqual(drawingReportInput(input()), input());
  for (const change of [{ round: 0 }, { round: 17 }, { matchId: 'javascript:bad' }, { roomCode: '12345' }, { reason: 'x' }, { clientId: '../a' }, { drawerUserId: 'forged' }, { canvas: canvas() }]) {
    assert.throws(() => drawingReportInput({ ...input(), ...change }), error => error.code === 'INVALID');
  }
  assert.deepEqual(drawingReportInput({ ...input(), reason: '  رسمة مخالفة  ', clientId: crypto.randomUUID() }).reason, 'رسمة مخالفة');
});

test('private evidence strips answers, accounts, guesses and unknown stroke metadata', () => {
  const raw = evidence();
  raw.word = 'secret-answer'; raw.choices = ['secret-choice']; raw.guesses = ['private-guess'];
  raw.canvas.strokes[0].secret = 'unwanted-field';
  const safe = privateDrawingEvidence(raw, input());
  for (const forbidden of ['secret-answer', 'secret-choice', 'private-guess', 'unwanted-field']) assert.equal(JSON.stringify(safe).includes(forbidden), false);
  assert.deepEqual(safe.canvas.strokes[0].points, [[0.1, 0.2], [0.8, 0.9]]);
  for (const bad of [{ color: 'url(https://bad.test)' }, { width: 3000 }, { points: [[1.1, 0]] }, { points: [[0, Number.NaN]] }, { tool: 'image' }]) {
    const value = evidence(); value.canvas.strokes[0] = { ...value.canvas.strokes[0], ...bad };
    assert.throws(() => privateDrawingEvidence(value, input()), error => error.code === 'INVALID');
  }
  assert.throws(() => privateDrawingEvidence({ ...evidence(), round: 2 }, input()), error => error.code === 'INVALID');
});

test('report uses participant-authorized room evidence and retries one durable report without refetch', async () => {
  const { env, DB, calls } = await fixture();
  try {
    const first = await saveDrawingReport(env, 'reporter', input());
    assert.deepEqual(await saveDrawingReport(env, 'reporter', input()), first);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { code: '123456', path: '/drawing-evidence', body: { accountUserId: 'reporter', matchId: 1, round: 1 } });
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM social_reports').first()).n, 1);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM ersomha_drawing_reports').first()).n, 1);
    const saved = await DB.prepare('SELECT * FROM social_reports').first();
    assert.equal(saved.reported_id, 'drawer'); assert.equal(saved.message_text, null); assert.equal(saved.message_seq, null);
    await assert.rejects(saveDrawingReport(env, 'reporter', { ...input(), reason: 'سبب آخر مختلف' }), error => error.code === 'CONFLICT');
  } finally { DB.close(); }
});

test('failed evidence authorization and failed D1 transaction cannot leave a report', async () => {
  const { env, DB } = await fixture();
  try {
    env.ROOMS.get = () => ({ fetch: async () => new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 }) });
    await assert.rejects(saveDrawingReport(env, 'reporter', input()), error => error.code === 'NOT_FOUND');
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM social_reports').first()).n, 0);
    env.ROOMS.get = () => ({ fetch: async () => new Response(JSON.stringify(evidence())) });
    const batch = DB.batch.bind(DB); let failOnce = true;
    DB.batch = async queries => { if (failOnce) { failOnce = false; throw new Error('injected D1 failure'); } return batch(queries); };
    await assert.rejects(saveDrawingReport(env, 'reporter', input()), /injected D1/);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM ersomha_drawing_reports').first()).n, 0);
    assert.equal((await saveDrawingReport(env, 'reporter', input())).ok, true);
  } finally { DB.close(); }
});

test('authenticated report and moderator evidence remain private and clear on account deletion', async () => {
  const { env, DB } = await fixture();
  try {
    const player = await issueSession(env, 'reporter', 'web');
    const moderator = await issueSession(env, 'moderator', 'web');
    const request = new Request('https://maydan.test/api/games/ersomha/reports', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${player.token}` }, body: JSON.stringify(input()) });
    const response = await routeDrawingReports(request, env, new URL(request.url));
    assert.equal(response.status, 201); const result = await response.json();
    const endpoint = `https://maydan.test/api/moderation/reports/${result.reportId}/drawing`;
    const denied = await routeModeration(new Request(endpoint, { headers: { authorization: `Bearer ${player.token}` } }), env);
    assert.equal(denied.status, 403); assert.equal((await denied.json()).error, 'FORBIDDEN');
    const reviewed = await routeModeration(new Request(endpoint, { headers: { authorization: `Bearer ${moderator.token}` } }), env);
    assert.equal(reviewed.status, 200); assert.equal(reviewed.headers.get('cache-control'), 'no-store');
    const detail = await reviewed.json();
    assert.ok(detail.canvas.strokes.length); assert.equal(detail.drawerUserId, undefined); assert.equal(detail.roomCode, undefined);
    await deleteUser(env, 'drawer');
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM ersomha_drawing_reports').first()).n, 0);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM social_reports').first()).n, 0);
  } finally { DB.close(); }
});

test('reported drawing retention follows the parent report rather than retaining orphan evidence', async () => {
  const { env, DB } = await fixture();
  try {
    const saved = await saveDrawingReport(env, 'reporter', input());
    await DB.prepare('DELETE FROM social_reports WHERE id=?').bind(saved.reportId).run();
    await cleanupDrawingReports(env, 1);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM ersomha_drawing_reports').first()).n, 0);
  } finally { DB.close(); }
});

test('moderation drawing preview paths cannot redirect an authenticated request', () => {
  assert.equal(reviewDrawingPath('/api/moderation/reports/report_1/drawing'), '/api/moderation/reports/report_1/drawing');
  for (const value of ['https://bad.test/drawing', '//bad.test/drawing', '/api/moderation/reports/../drawing', '/api/moderation/reports/id/drawing?token=secret', '/api/moderation/reports/id/drawing/extra', null]) assert.equal(reviewDrawingPath(value), null);
});
