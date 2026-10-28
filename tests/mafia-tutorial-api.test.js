import test from 'node:test';
import assert from 'node:assert/strict';
import { localEnvironment } from '../server/local.mjs';
import { routeRequest } from '../server/worker.mjs';
import { createUser, deleteUser, reserveAccountDeletion } from '../server/accounts/db.mjs';
import { issueSession, ROTATE_AFTER } from '../server/accounts/session.mjs';
import { MAFIA_TUTORIAL_SCENARIO_VERSION as scenarioVersion, MAFIA_TUTORIAL_RULESET_VERSION as rulesetVersion } from '../src/games/mafia/tutorial/version.mjs';

const ORIGIN = 'http://localhost:3000';
const PATH = '/api/me/tutorials/mafia';
const input = status => ({ scenarioVersion, rulesetVersion, status });
async function setup(t) {
  const runtime = localEnvironment({ vars: {} });
  t.after(() => runtime.dispose());
  const { env } = runtime;
  async function person() {
    const user = await createUser(env, { name: 'اختبار التدريب' });
    const session = await issueSession(env, user.id);
    return { ...user, token: session.token, sessionId: session.id };
  }
  async function api(user, body, { method = body === undefined ? 'GET' : 'PUT', path = PATH, origin = ORIGIN, type = 'application/json', raw = false } = {}) {
    const request = new Request(ORIGIN + path, { method, headers: {
      origin, ...(user ? { authorization: `Bearer ${user.token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': type }),
    }, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }) });
    const response = await routeRequest(request, env);
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  const row = user => env.DB.prepare('SELECT * FROM mafia_tutorial_status WHERE user_id=?').bind(user.id).first();
  return { ...runtime, person, api, row };
}

test('tutorial status is private, optional, free and contains no scenario decisions', async t => {
  const h = await setup(t), a = await h.person(), b = await h.person();
  assert.equal((await h.api(null)).status, 401);
  assert.equal((await h.api(null, input('completed'))).status, 401);
  assert.equal((await h.api(a, undefined, { origin: 'https://untrusted.test' })).status, 403);
  const initial = await h.api(a);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body, { tutorialId: 'mafia', scenarioVersion, rulesetVersion, status: 'unseen', updatedAt: null, outdated: false });
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  assert.equal(await h.row(a), null, 'GET does not create progress');
  const saved = await h.api(a, input('completed'));
  assert.equal(saved.status, 200); assert.equal(saved.body.status, 'completed');
  assert.ok(Number.isSafeInteger(saved.body.updatedAt));
  assert.equal((await h.api(b, undefined, { path: PATH + '?userId=' + a.id })).body.status, 'unseen');
  assert.deepEqual(Object.keys(saved.body).sort(), ['tutorialId', 'scenarioVersion', 'rulesetVersion', 'status', 'updatedAt', 'outdated'].sort());
  assert.equal(h.rooms.size, 0);
});

test('tutorial status rejects progress, account overrides, malformed bodies and unsupported versions', async t => {
  const h = await setup(t), a = await h.person();
  for (const extra of ['userId', 'roles', 'progress', 'decisions', 'checkpoint', 'seed', 'updatedAt', 'reward']) {
    assert.equal((await h.api(a, { ...input('completed'), [extra]: 'forged' })).status, 400, extra);
  }
  for (const body of [{}, [], null, { ...input('completed'), scenarioVersion: '1' }, input('unseen'), input('in-progress'), { ...input('completed'), rulesetVersion: 1.5 }]) {
    assert.equal((await h.api(a, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await h.api(a, { ...input('completed'), scenarioVersion: scenarioVersion + 1 })).status, 409);
  assert.equal((await h.api(a, { ...input('completed'), rulesetVersion: rulesetVersion + 1 })).status, 409);
  assert.equal((await h.api(a, '{broken', { raw: true })).status, 400);
  assert.equal((await h.api(a, ' '.repeat(513), { raw: true })).status, 413);
  assert.equal((await h.api(a, input('completed'), { type: 'text/plain' })).status, 415);
  assert.equal((await h.api(a, input('completed'), { method: 'POST' })).status, 405);
  assert.equal(await h.row(a), null);
});

test('concurrent devices cannot downgrade completion and idempotent writes preserve timestamp', async t => {
  const h = await setup(t), a = await h.person();
  assert.equal((await h.api(a, input('skipped'))).body.status, 'skipped');
  const requests = ['skipped', 'completed', 'skipped', 'completed', 'skipped', 'skipped'];
  const replies = await Promise.all(requests.map(status => h.api(a, input(status))));
  assert.ok(replies.every(reply => reply.status === 200));
  const completed = await h.row(a); assert.equal(completed.status, 'completed');
  for (const status of ['skipped', 'completed']) assert.equal((await h.api(a, input(status))).body.status, 'completed');
  assert.deepEqual(await h.row(a), completed);
});

test('a rolled-back server cannot erase a newer lesson completion', async t => {
  const h = await setup(t), a = await h.person();
  await h.env.DB.prepare('INSERT INTO mafia_tutorial_status VALUES(?,?,?,?,?)')
    .bind(a.id, scenarioVersion + 1, rulesetVersion, 'completed', 1000).run();
  const before = await h.row(a), response = await h.api(a);
  assert.equal(response.body.status, 'unseen'); assert.equal(response.body.outdated, true); assert.equal(response.body.updatedAt, null);
  assert.equal((await h.api(a, input('skipped'))).status, 409);
  assert.deepEqual(await h.row(a), before);
});

test('account deletion removes only its tutorial status and old sessions cannot restore it', async t => {
  const h = await setup(t), a = await h.person(), b = await h.person();
  await h.api(a, input('completed')); await h.api(b, input('skipped'));
  const other = await h.row(b);
  await deleteUser(h.env, a.id);
  assert.equal(await h.row(a), null); assert.deepEqual(await h.row(b), other);
  assert.equal((await h.api(a, input('completed'))).status, 401);
  assert.equal(await h.row(a), null);
});

test('deletion reservation and post-auth deletion race prevent status mutation', async t => {
  const h = await setup(t), a = await h.person(), b = await h.person();
  await reserveAccountDeletion(h.env, a.id, 'delete-a');
  assert.equal((await h.api(a)).status, 409);
  assert.equal((await h.api(a, input('completed'))).status, 409);
  assert.equal(await h.row(a), null);
  const original = h.env.DB.prepare.bind(h.env.DB); let raced = false;
  h.env.DB.prepare = sql => {
    if (!raced && sql.startsWith('INSERT INTO mafia_tutorial_status')) {
      raced = true;
      h.env.DB.database.prepare('INSERT INTO account_deletions VALUES(?,?,?)').run(b.id, 'delete-race', Date.now());
    }
    return original(sql);
  };
  assert.equal((await h.api(b, input('completed'))).status, 409);
  assert.equal(raced, true); assert.equal(await h.row(b), null);
});

test('suspended users cannot sync terminal lesson status', async t => {
  const h = await setup(t), a = await h.person();
  await h.env.DB.prepare('INSERT INTO moderation_suspensions VALUES(?,?,?,?,?)').bind(a.id, 'moderator', 'test', Date.now(), Date.now()).run();
  assert.equal((await h.api(a)).status, 403);
  assert.equal((await h.api(a, input('completed'))).status, 403);
  assert.equal(await h.row(a), null);
});

test('terminal tutorial sync does not create gameplay, rewards, media or outbound requests', async t => {
  const h = await setup(t), a = await h.person();
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Tutorial must not call external services'); });
  const tables = (await h.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='mafia_tutorial_status' ORDER BY name").all()).results.map(r => r.name);
  const snapshot = () => Promise.all(tables.map(async name => [name, (await h.env.DB.prepare('SELECT * FROM ' + name).all()).results]));
  const before = await snapshot();
  assert.equal((await h.api(a)).status, 200);
  assert.equal((await h.api(a, input('completed'))).status, 200);
  assert.deepEqual(await snapshot(), before);
  assert.equal(h.rooms.size, 0);
});

test('tutorial API preserves session rotation and rate limits writes by verified account', async t => {
  const h = await setup(t), a = await h.person();
  await h.env.DB.prepare('UPDATE sessions SET last_seen=? WHERE id=?').bind(Date.now() - ROTATE_AFTER - 1000, a.sessionId).run();
  const first = await h.api(a, input('skipped'));
  assert.equal(first.status, 200); assert.match(first.headers.get('x-maydan-session'), /^mdn1\./);
  a.token = first.headers.get('x-maydan-session');
  for (let n = 1; n < 30; n++) assert.equal((await h.api(a, input('skipped'))).status, 200);
  assert.equal((await h.api(a, input('completed'))).status, 429);
  assert.equal((await h.api(a)).body.status, 'skipped');
});
