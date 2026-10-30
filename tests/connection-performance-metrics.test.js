import test from 'node:test';
import assert from 'node:assert/strict';
import { performanceRoute, timed, withRequestMetrics } from '../server/performance.mjs';
import { providerRequest } from '../server/lamma/provider.mjs';

const enabled = { CONNECTION_METRICS_ENABLED: '1', CONNECTION_METRICS_SAMPLE_RATE: '1' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function capture(t) { const records = []; t.mock.method(console, 'info', value => records.push(JSON.parse(value))); return records; }
const request = (path = '/api/social/groups/private-group/messages?ticket=private-ticket') => new Request(`https://example.test${path}`, {
  method: 'POST', headers: { authorization: 'Bearer private-token', 'x-maydan-trace-id': 'attacker-label' }, body: 'private-message-and-role',
});

test('connection diagnostics are opt-in and sampling zero leaves the response untouched', async t => {
  const records = capture(t), response = new Response('ok');
  for (const env of [{}, { ...enabled, CONNECTION_METRICS_SAMPLE_RATE: '0' }, { ...enabled, CONNECTION_METRICS_SAMPLE_RATE: 'invalid' }]) {
    assert.equal(await withRequestMetrics(request(), env, actual => { assert.equal(actual, env); return response; }), response);
  }
  assert.equal(records.length, 0);
});

test('diagnostic route labels exclude secrets, role actions, unknown paths and socket tickets', () => {
  assert.equal(performanceRoute(request()), 'social_groups');
  assert.equal(performanceRoute(new Request('https://example.test/api/social/attachments/secret-file/content')), 'social_audio');
  assert.equal(performanceRoute(new Request('https://example.test/api/rooms/123456/voice')), null);
  assert.equal(performanceRoute(new Request('https://example.test/auth/google/callback?code=secret')), null);
  assert.equal(performanceRoute(new Request('https://example.test/api/social/groups/private-group/messages', { headers: { upgrade: 'websocket' } })), null);
  assert.equal(performanceRoute(new Request('https://example.test/api/social/arbitrary-sensitive-label')), null);
});

test('only bounded server labels and a server-generated trace reach logs and timing headers', async t => {
  const records = capture(t), original = { ...enabled, sentinel: 'private-env' };
  const response = await withRequestMetrics(request(), original, async env => {
    assert.notEqual(env, original);
    assert.equal(original.REQUEST_METRICS, undefined);
    await timed(env, 'auth', async () => {});
    await timed(env, 'private-user-label', async () => {});
    return new Response('private-response', { status: 201, headers: { 'x-maydan-session': 'private-rotation', 'access-control-expose-headers': 'x-maydan-session' } });
  });
  assert.equal(response.status, 201);
  assert.equal(await response.text(), 'private-response');
  assert.equal(response.headers.get('x-maydan-session'), 'private-rotation');
  assert.match(response.headers.get('x-maydan-trace-id'), /^[a-f0-9-]{36}$/);
  assert.match(response.headers.get('server-timing'), /^app;dur=\d+(?:\.\d)?$/);
  assert.match(response.headers.get('access-control-expose-headers'), /x-maydan-session/);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 201);
  assert.deepEqual(Object.keys(records[0].stages), ['auth']);
  assert.equal(records[0].requestId, response.headers.get('x-maydan-trace-id'));
  const serialized = JSON.stringify(records);
  for (const secret of ['private-group', 'private-ticket', 'private-token', 'attacker-label', 'private-message-and-role', 'private-response', 'private-rotation', 'private-env', 'private-user-label']) assert.equal(serialized.includes(secret), false, secret);
});

test('concurrent requests cannot share stages or identifiers', async t => {
  const records = capture(t), gate = deferred();
  const first = withRequestMetrics(request('/api/social/calls'), enabled, async env => { await timed(env, 'provider_create', () => gate.promise); return new Response('one'); });
  const second = await withRequestMetrics(request('/api/social/attachments'), enabled, async env => { await timed(env, 'r2_put', async () => {}); return new Response('two'); });
  gate.resolve(); await first;
  assert.equal(records.length, 2);
  const audio = records.find(record => record.route === 'social_audio'), calls = records.find(record => record.route === 'social_calls');
  assert.deepEqual(Object.keys(audio.stages), ['r2_put']);
  assert.deepEqual(Object.keys(calls.stages), ['provider_create']);
  assert.notEqual(audio.requestId, calls.requestId);
  assert.equal(second.status, 200);
});

test('post-ACK notification timing is separate and never makes the ACK wait', async t => {
  const records = capture(t), gate = deferred(); let notification;
  const response = await withRequestMetrics(request(), enabled, async env => {
    notification = timed(env, 'fanout', () => gate.promise);
    return new Response('committed');
  });
  assert.equal(response.status, 200);
  assert.equal(records.length, 1);
  assert.equal(records[0].stages.fanout, undefined);
  gate.resolve(); await notification;
  assert.equal(records.length, 2);
  assert.equal(records[1].event, 'maydan.connection.background');
  assert.equal(records[1].requestId, records[0].requestId);
  assert.equal(records[1].stage, 'fanout');
});

test('provider timing preserves strict revocation and excludes provider payloads and credentials', async t => {
  const records = capture(t), env = { ...enabled, LIVEKIT_URL: 'wss://test.livekit.cloud', LIVEKIT_API_KEY: 'private-key', LIVEKIT_API_SECRET: 'private-secret' };
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 404 }));
  await withRequestMetrics(request('/api/social/calls'), env, async measured => {
    await providerRequest(measured, 'RemoveParticipant', { room: 'private-room', identity: 'private-identity' });
    await assert.rejects(providerRequest(measured, 'RemoveParticipant', { room: 'private-room' }, { strictRevocation: true }), error => error.code === 'CALLS_UNAVAILABLE');
    return new Response('{}');
  });
  assert.equal(records[0].stages.provider_remove.count, 2);
  for (const secret of ['private-key', 'private-secret', 'private-room', 'private-identity']) assert.equal(JSON.stringify(records).includes(secret), false);
});

test('diagnostics preserve both operation failures and successful replies when logging is unavailable', async t => {
  t.mock.method(console, 'info', () => { throw new Error('logging unavailable'); });
  const expected = new Error('private-error');
  await assert.rejects(withRequestMetrics(request(), enabled, env => timed(env, 'auth', async () => { throw expected; })), error => error === expected);
  const response = await withRequestMetrics(request(), enabled, async () => new Response('saved'));
  assert.equal(await response.text(), 'saved');
});
