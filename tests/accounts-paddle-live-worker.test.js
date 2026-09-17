import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../server/paddle-live-worker.mjs';
import { PADDLE_IPS_URL } from '../server/accounts/paddle-ips.mjs';

// Public test fixtures only; no credentials, remote D1, or Paddle mutations.
const SECRET = 'local-webhook-signing-test-fixture';
const KNOWN = '34.237.3.244';
const FOREIGN = '203.0.113.19';
const PRICE = 'pri_01m2rqq887jk85av1b1a68j82k';
const CIDRS = [`${KNOWN}/32`, '34.195.105.136/32', '34.232.58.13/32',
  '35.155.119.135/32', '34.212.5.7/32', '52.11.166.252/32'];
const signature = (body, timestamp = Math.floor(Date.now() / 1000)) =>
  `ts=${timestamp};h1=${createHmac('sha256', SECRET).update(`${timestamp}:${body}`).digest('hex')}`;
const request = (path, { method = 'GET', address, body, signed, headers = {} } = {}) =>
  new Request(`https://maydan-live.test${path}`, { method, body, headers: {
    ...(address === undefined ? {} : { 'cf-connecting-ip': address }),
    ...(signed === undefined ? {} : { 'paddle-signature': signed }), ...headers,
  } });

function fixture(t) {
  const state = { reads: 0, fetches: 0 };
  const env = {
    PADDLE_ENV: 'production', PADDLE_CHECKOUT_ENABLED: 'false',
    PADDLE_PRICE_MONTHLY: PRICE, PADDLE_PRICE_YEARLY: '',
    PADDLE_WEBHOOK_SECRET: SECRET,
    DB: { prepare() { state.reads++; throw new Error('Unexpected database access'); } },
  };
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    state.fetches++;
    assert.equal(url, PADDLE_IPS_URL, 'only public provider IP discovery is allowed');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    assert.deepEqual(init.headers, { accept: 'application/json' });
    return new Response(JSON.stringify({ data: { ipv4_cidrs: CIDRS } }));
  });
  return { env, state };
}

test('live ingress health needs no credentials beyond webhook configuration and never touches D1', async t => {
  const { env, state } = fixture(t);
  const response = await worker.fetch(request('/health'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, checkoutEnabled: false });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const head = await worker.fetch(request('/health', { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.deepEqual(state, { reads: 0, fetches: 0 });
});

test('live ingress closes all application paths and unsupported methods before checking configuration', async t => {
  const { state } = fixture(t);
  for (const [path, method] of [
    ['/', 'GET'], ['/pay.html', 'GET'], ['/api/billing/config', 'GET'],
    ['/api/paddle/checkout', 'POST'], ['/api/paddle/portal', 'GET'],
    ['/api/auth/dev', 'POST'], ['/api/account', 'DELETE'],
    ['/api/paddle/webhook', 'GET'], ['/api/paddle/webhook', 'OPTIONS'],
    ['/api/paddle/webhook/', 'POST'], ['/health', 'POST'],
  ]) {
    const response = await worker.fetch(request(path, { method }), {});
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.deepEqual(await response.json(), { error: 'NOT_FOUND' });
  }
  assert.deepEqual(state, { reads: 0, fetches: 0 });
});

test('missing or malformed configuration fails closed before body, IP fetch or database use', async t => {
  const { env, state } = fixture(t);
  for (const override of [
    { PADDLE_ENV: undefined }, { PADDLE_ENV: 'sandbox' }, { PADDLE_ENV: 'Production' },
    { DB: undefined }, { DB: {} },
    { PADDLE_PRICE_MONTHLY: undefined }, { PADDLE_PRICE_MONTHLY: '' },
    { PADDLE_PRICE_MONTHLY: 'pri_short' }, { PADDLE_PRICE_MONTHLY: `${PRICE}\n` },
    { PADDLE_PRICE_MONTHLY: 'pro_01m2rqq887jk85av1b1a68j82k' },
    { PADDLE_WEBHOOK_SECRET: undefined }, { PADDLE_WEBHOOK_SECRET: '' },
    { PADDLE_WEBHOOK_SECRET: '  ' },
  ]) {
    const broken = { ...env, ...override };
    const req = request('/api/paddle/webhook', { method: 'POST', address: KNOWN, body: 'invalid JSON' });
    const response = await worker.fetch(req, broken);
    assert.equal(response.status, 503, JSON.stringify(Object.keys(override)));
    assert.deepEqual(await response.json(), { error: 'NOT_READY' });
    assert.equal(req.bodyUsed, false);
    assert.equal((await worker.fetch(request('/health'), broken)).status, 503);
  }
  assert.deepEqual(state, { reads: 0, fetches: 0 });
});

test('foreign or missing sender IP is rejected before body and D1, including spoofed forwarding headers', async t => {
  const { env, state } = fixture(t);
  for (const address of [undefined, 'not-an-ip', FOREIGN]) {
    const req = request('/api/paddle/webhook', { method: 'POST', address, body: 'invalid JSON',
      headers: { 'x-forwarded-for': KNOWN, 'x-real-ip': KNOWN } });
    const response = await worker.fetch(req, env);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'IP_FORBIDDEN' });
    assert.equal(req.bodyUsed, false);
  }
  assert.equal(state.reads, 0);
});

test('trusted sender still requires a current matching HMAC before parsing JSON or touching D1', async t => {
  const { env, state } = fixture(t);
  const body = 'invalid JSON';
  for (const signed of [undefined, 'ts=1;h1=bad', signature(`${body}changed`),
    signature(body, Math.floor(Date.now() / 1000) - 600)]) {
    const req = request('/api/paddle/webhook', { method: 'POST', address: KNOWN, body, signed });
    const response = await worker.fetch(req, env);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'SIGNATURE' });
    assert.equal(req.bodyUsed, true);
  }
  assert.equal(state.reads, 0);
});

test('authenticated malformed event is rejected after signature verification and before D1', async t => {
  const { env, state } = fixture(t);
  for (const body of ['invalid JSON', '{}']) {
    const req = request('/api/paddle/webhook', { method: 'POST', address: KNOWN, body, signed: signature(body) });
    const response = await worker.fetch(req, env);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'INVALID' });
  }
  assert.equal(state.reads, 0);
});

test('valid signed event reaches production-scoped deduplication without API key or client token', async t => {
  const { env, state } = fixture(t);
  const eventId = 'evt_local_live_worker_fixture';
  env.DB.prepare = sql => {
    state.reads++;
    assert.equal(sql, 'SELECT id FROM webhook_events WHERE id = ?');
    return { bind(id) {
      assert.equal(id, `paddle:production:${eventId}`);
      return { async first() { return { id }; } };
    } };
  };
  const body = JSON.stringify({ event_id: eventId });
  const req = request('/api/paddle/webhook', { method: 'POST', address: KNOWN, body, signed: signature(body) });
  const response = await worker.fetch(req, env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, duplicate: true });
  assert.equal(state.reads, 1);
});

test('database failure is retryable and never exposes internal exception details', async t => {
  const { env, state } = fixture(t);
  const body = JSON.stringify({ event_id: 'evt_local_failure_fixture' });
  const req = request('/api/paddle/webhook', { method: 'POST', address: KNOWN, body, signed: signature(body) });
  const response = await worker.fetch(req, env);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'INTERNAL' });
  assert.equal(state.reads, 1);
});
