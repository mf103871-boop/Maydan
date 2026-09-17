import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import * as db from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { hmacHex } from '../server/accounts/jwt.mjs';
import { routeAccounts } from '../server/accounts/router.mjs';
import { apiUrl, checkoutEnabled, createTransaction, publicConfig } from '../server/accounts/paddle.mjs';

test('live API host cannot be redirected by a leftover Sandbox/local override', () => {
  for (const PADDLE_API_URL of [undefined, 'https://sandbox-api.paddle.com', 'https://other.example.test', 'http://127.0.0.1:9999']) {
    assert.equal(apiUrl({ PADDLE_ENV: 'production', PADDLE_API_URL }), 'https://api.paddle.com');
  }
  assert.equal(apiUrl({ PADDLE_ENV: 'sandbox' }), 'https://sandbox-api.paddle.com');
  assert.equal(apiUrl({ PADDLE_ENV: 'sandbox', PADDLE_API_URL: 'http://127.0.0.1:9999/' }), 'http://127.0.0.1:9999');
});

test('live configuration stays closed until an explicit true release switch', () => {
  const env = { PADDLE_ENV: 'production', PADDLE_CLIENT_TOKEN: 'live_unit',
    PADDLE_API_KEY: 'unit', PADDLE_WEBHOOK_SECRET: 'unit', PADDLE_PRICE_MONTHLY: 'pri_unit' };
  for (const value of [undefined, '', 'false', '1', 'TRUE']) {
    const candidate = { ...env, PADDLE_CHECKOUT_ENABLED: value };
    assert.equal(checkoutEnabled(candidate), false);
    assert.equal(publicConfig(candidate).checkoutEnabled, false);
    assert.equal(publicConfig(candidate).environment, 'production');
  }
  assert.equal(checkoutEnabled({ ...env, PADDLE_CHECKOUT_ENABLED: 'true' }), true);
  assert.equal(checkoutEnabled({ PADDLE_ENV: 'sandbox' }), true);
  assert.equal(checkoutEnabled({ PADDLE_ENV: 'sandbox', PADDLE_CHECKOUT_ENABLED: 'false' }), false);
});

test('closed live checkout cannot reserve a payment, create a customer, or contact Paddle', async (t) => {
  const env = { DB: createLocalD1(), PADDLE_ENV: 'production', PADDLE_CLIENT_TOKEN: 'live_unit',
    PADDLE_API_KEY: 'unit', PADDLE_WEBHOOK_SECRET: 'unit', PADDLE_PRICE_MONTHLY: 'pri_unit' };
  t.after(() => env.DB.close());
  const user = await db.createUser(env, { email: 'stage@example.test' });
  const session = await issueSession(env, user.id);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); throw new Error('Unexpected provider call'); });
  const url = new URL('https://maydan.test/api/paddle/checkout');
  const request = new Request(url, { method: 'POST', headers: {
    authorization: `Bearer ${session.token}`, 'content-type': 'application/json',
  }, body: JSON.stringify({ plan: 'monthly' }) });
  await assert.rejects(routeAccounts(request, env, url), error => error.code === 'CHECKOUT_DISABLED' && error.status === 503);
  await assert.rejects(createTransaction(env, user, 'monthly'), /CHECKOUT_DISABLED/);
  assert.equal(await db.paddleCheckoutOf(env, user.id), null);
  assert.equal(await db.paddleCustomerOf(env, user.id), null);
  assert.equal(calls.length, 0);
});

test('live webhook checks provider IP before reading the body and still requires its signature', async (t) => {
  const env = { DB: createLocalD1(), PADDLE_ENV: 'production', PADDLE_WEBHOOK_SECRET: 'local-unit-secret' };
  t.after(() => env.DB.close());
  let ipReads = 0, bodyReads = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'https://api.paddle.com/ips'); ipReads++;
    return new Response(JSON.stringify({ data: { ipv4_cidrs: ['192.0.2.44/32'] } }));
  });
  const url = new URL('https://maydan.test/api/paddle/webhook');
  const foreign = new Request(url, { method: 'POST', body: '{}', headers: { 'cf-connecting-ip': '192.0.2.45' } });
  foreign.text = async () => { bodyReads++; throw new Error('Body must not be read'); };
  await assert.rejects(routeAccounts(foreign, env, url), e => e.code === 'IP_FORBIDDEN' && e.status === 403);
  assert.equal(bodyReads, 0);
  const body = JSON.stringify({ event_id: 'evt_local_only', event_type: 'unhandled.event', data: {} });
  const ts = Math.floor(Date.now() / 1000);
  const request = signature => new Request(url, { method: 'POST', body, headers: {
    'cf-connecting-ip': '192.0.2.44', 'paddle-signature': `ts=${ts};h1=${signature}`,
  } });
  await assert.rejects(routeAccounts(request('0'.repeat(64)), env, url), /SIGNATURE/);
  assert.equal(await db.webhookEvent(env, 'paddle:production:evt_local_only'), null);
  const signature = await hmacHex(env.PADDLE_WEBHOOK_SECRET, `${ts}:${body}`);
  assert.equal((await routeAccounts(request(signature), env, url)).status, 200);
  assert.ok(await db.webhookEvent(env, 'paddle:production:evt_local_only'));
  assert.equal(ipReads, 1);
});
