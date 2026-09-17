import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LocalD1, createLocalD1 } from '../server/local-d1.mjs';
import * as db from '../server/accounts/db.mjs';
import * as paddle from '../server/accounts/paddle.mjs';
import { premiumOf } from '../server/accounts/entitlements.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeAccounts, roomGate } from '../server/accounts/router.mjs';
import { hmacHex } from '../server/accounts/jwt.mjs';

const now = Date.now();
const envOf = (DB = createLocalD1(), PADDLE_ENV = 'production') => ({ DB, PADDLE_ENV, PADDLE_CHECKOUT_ENABLED: 'true',
  PADDLE_API_KEY: 'unit-key', PADDLE_WEBHOOK_SECRET: `unit-${PADDLE_ENV}`,
  PADDLE_CLIENT_TOKEN: PADDLE_ENV === 'production' ? 'live_unit' : 'test_unit',
  PADDLE_PRICE_MONTHLY: `pri_${PADDLE_ENV}_month`, PADDLE_PRICE_YEARLY: `pri_${PADDLE_ENV}_year` });
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const request = (env, path, { token, method = 'GET', body, headers = {} } = {}) => {
  const url = new URL(`https://maydan.test${path}`);
  return routeAccounts(new Request(url, { method, headers: { 'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), env, url);
};
const row = (userId, environment, extra = {}) => ({ user_id: userId, source: 'paddle', environment,
  external_id: `sub_${environment}`, product: 'plus.monthly', status: 'active',
  until: now + 86400000, will_renew: true, occurred_at: now, ...extra });
async function signedHook(env, event, secret = env.PADDLE_WEBHOOK_SECRET) {
  const body = JSON.stringify(event), ts = Math.floor(Date.now() / 1000);
  return request(env, '/api/paddle/webhook', { method: 'POST', body,
    headers: { 'cf-connecting-ip': '192.0.2.10', 'paddle-signature': `ts=${ts};h1=${await hmacHex(secret, `${ts}:${body}`)}` } });
}
const eventOf = (env, userId, id) => ({ event_id: 'evt_shared_id', event_type: 'subscription.updated',
  occurred_at: new Date(now).toISOString(), data: { id, status: 'active', custom_data: { userId },
    customer_id: `ctm_${env.PADDLE_ENV}`, items: [{ price: { id: env.PADDLE_PRICE_MONTHLY } }],
    current_billing_period: { ends_at: new Date(now + 86400000).toISOString() } } });

test('customer migration adds isolated storage without modifying any legacy row', async (t) => {
  const DB = new LocalD1(); t.after(() => DB.close());
  await DB.exec(readFileSync('server/migrations/0001_accounts.sql', 'utf8'));
  await DB.prepare('INSERT INTO paddle_customers VALUES (?, ?, ?)').bind('owner', 'ctm_legacy', 123).run();
  await DB.exec(readFileSync('server/migrations/0002_paddle_customer_environments.sql', 'utf8'));
  assert.deepEqual(await DB.prepare('SELECT * FROM paddle_customers').first(), { user_id: 'owner', customer_id: 'ctm_legacy', created_at: 123 });
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM paddle_customers_scoped').first()).n, 0);
});

test('live me and room gates ignore sandbox/unclassified Paddle while preserving Apple and gifts', async (t) => {
  const env = envOf(); t.after(() => env.DB.close());
  const user = await db.createUser(env), session = await issueSession(env, user.id);
  await db.upsertSubscription(env, row(user.id, 'sandbox'));
  await db.addTrial(env, user.id, 'beep');
  const me = await (await request(env, '/api/me', { token: session.token })).json();
  assert.equal(me.premium.active, false);
  await assert.rejects(roomGate(new Request('https://maydan.test/api/rooms', { headers: { authorization: `Bearer ${session.token}` } }), env, { game: 'beep' }), /PLUS_REQUIRED/);
  assert.equal((await db.subscriptionsOf(env, user.id))[0].environment, 'sandbox', 'historical subscription remains untouched');
  assert.equal(premiumOf([row(user.id, null)], now, env).active, false);
  for (const [source, environment] of [['apple', 'Sandbox'], ['apple', 'Production'], ['promo', 'promo']]) {
    const premium = premiumOf([row(user.id, 'sandbox'), row(user.id, environment, { source })], now, env);
    assert.equal(premium.active, true);
    assert.equal(premium.source, source);
  }
});

test('live checkout for a sandbox subscriber creates a live customer and never reuses the sandbox mapping', async (t) => {
  const env = envOf(), sandbox = envOf(env.DB, 'sandbox'); t.after(() => env.DB.close());
  const user = await db.createUser(env, { email: 'tester@example.test' }), session = await issueSession(env, user.id);
  await db.upsertSubscription(sandbox, row(user.id, 'sandbox'));
  await db.setPaddleCustomer(sandbox, user.id, 'ctm_sandbox');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body });
    return reply({ data: { id: url.endsWith('/customers') ? 'ctm_live' : 'txn_live' } }, 201);
  });
  const checkout = await (await request(env, '/api/paddle/checkout', { method: 'POST', token: session.token, body: { plan: 'monthly' } })).json();
  assert.equal(checkout.environment, 'production');
  assert.equal(checkout.transactionId, 'txn_live');
  assert.ok(calls.every(({ url }) => url.startsWith('https://api.paddle.com/')));
  assert.equal(calls[1].body.customer_id, 'ctm_live');
  assert.equal(calls[1].body.items[0].price_id, env.PADDLE_PRICE_MONTHLY);
  assert.equal((await db.paddleCustomerOf(sandbox, user.id)).customer_id, 'ctm_sandbox');
  assert.equal((await db.paddleCustomerOf(env, user.id)).customer_id, 'ctm_live');
  await db.upsertSubscription(env, row(user.id, 'production'));
  await assert.rejects(request(env, '/api/paddle/checkout', { method: 'POST', token: session.token, body: { plan: 'monthly' } }), /ALREADY_SUBSCRIBED/);
  assert.equal(calls.length, 2, 'a confirmed live subscriber cannot buy a duplicate');
});

test('monthly-only live configuration exposes and sells only its configured price', async (t) => {
  const env = envOf(); delete env.PADDLE_PRICE_YEARLY; t.after(() => env.DB.close());
  const user = await db.createUser(env), session = await issueSession(env, user.id);
  assert.equal(paddle.configured(env), true);
  assert.equal(paddle.publicConfig(env).prices.yearly, '');
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => { bodies.push(JSON.parse(init.body)); return reply({ data: { id: 'txn_monthly_only' } }); });
  assert.equal((await request(env, '/api/paddle/checkout', { method: 'POST', token: session.token, body: { plan: 'monthly' } })).status, 200);
  assert.deepEqual(bodies[0].items, [{ price_id: env.PADDLE_PRICE_MONTHLY, quantity: 1 }]);
  await assert.rejects(request(env, '/api/paddle/checkout', { method: 'POST', token: session.token, body: { plan: 'yearly' } }), /INVALID/);
  assert.equal(bodies.length, 1);
});

test('portal verifies legacy IDs in the selected API and never opens a sandbox portal from live', async (t) => {
  const env = envOf(); t.after(() => env.DB.close());
  const user = await db.createUser(env);
  await db.run(env, 'INSERT INTO paddle_customers VALUES (?, ?, ?)', user.id, 'ctm_legacy', now);
  const calls = [];
  let exists = false;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, method: init.method });
    if (url.endsWith('/portal-sessions')) return reply({ data: { urls: { general: { overview: 'https://customer-portal.paddle.com/live' } } } });
    return exists ? reply({ data: { id: 'ctm_legacy' } }) : reply({}, 404);
  });
  await assert.rejects(paddle.portalUrl(env, user), /NOT_ELIGIBLE/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(await db.paddleCustomerOf(env, user.id), null);
  exists = true;
  assert.equal(await paddle.portalUrl(env, user), 'https://customer-portal.paddle.com/live');
  assert.equal((await db.paddleCustomerOf(env, user.id)).customer_id, 'ctm_legacy');
  assert.equal((await db.legacyPaddleCustomerOf(env, user.id)).customer_id, 'ctm_legacy');
  const other = await db.createUser(env);
  await assert.rejects(db.setPaddleCustomer(env, other.id, 'ctm_legacy'), /ALREADY_LINKED/);
  assert.ok(calls.every(({ url }) => url.startsWith('https://api.paddle.com/')));
});

test('a legacy verification outage cannot create a replacement customer or adopt an unverified mapping', async (t) => {
  const env = envOf(); t.after(() => env.DB.close());
  const user = await db.createUser(env, { email: 'existing@example.test' });
  await db.run(env, 'INSERT INTO paddle_customers VALUES (?, ?, ?)', user.id, 'ctm_legacy', now);
  const methods = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => { methods.push(init.method); return reply({}, 503); });
  await assert.rejects(paddle.createTransaction(env, user, 'monthly'), /PROVIDER/);
  assert.deepEqual(methods, ['GET']);
  assert.equal(await db.paddleCustomerOf(env, user.id), null);
  assert.ok(await db.legacyPaddleCustomerOf(env, user.id));
});

test('live account deletion cancels only live renewals; sandbox cannot delete a live renewal', async (t) => {
  const env = envOf(), sandbox = envOf(env.DB, 'sandbox'); t.after(() => env.DB.close());
  const user = await db.createUser(env), session = await issueSession(env, user.id);
  for (const environment of ['sandbox', 'production']) await db.upsertSubscription(env, row(user.id, environment));
  await db.setPaddleCustomer(env, user.id, 'ctm_live');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => { calls.push(url); return reply({ data: { status: 'canceled' } }); });
  await assert.rejects(request(sandbox, '/api/account', { method: 'DELETE', token: session.token }), /BILLING_CANCEL_FAILED/);
  assert.ok(await db.userById(env, user.id));
  assert.equal(calls.length, 0);
  assert.equal((await request(env, '/api/account', { method: 'DELETE', token: session.token })).status, 204);
  assert.deepEqual(calls, ['https://api.paddle.com/subscriptions/sub_production/cancel']);
  assert.equal(await db.userById(env, user.id), null);
  assert.equal(await db.paddleCustomerOf(env, user.id), null);
});

test('webhook signatures, deduplication, customer maps and subscription rows stay environment-scoped', async (t) => {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'https://api.paddle.com/ips');
    return reply({ data: { ipv4_cidrs: ['192.0.2.10/32'] } });
  });
  const env = envOf(), sandbox = envOf(env.DB, 'sandbox'); t.after(() => env.DB.close());
  const user = await db.createUser(env);
  const sandboxEvent = eventOf(sandbox, user.id, 'sub_sandbox'), liveEvent = eventOf(env, user.id, 'sub_live');
  assert.equal((await signedHook(sandbox, sandboxEvent)).status, 200);
  await assert.rejects(signedHook(env, liveEvent, sandbox.PADDLE_WEBHOOK_SECRET), /SIGNATURE/);
  assert.equal((await signedHook(env, liveEvent)).status, 200, 'same event ID in another environment is not a duplicate');
  assert.equal((await (await signedHook(env, liveEvent)).json()).duplicate, true);
  assert.ok(await db.webhookEvent(env, 'paddle:production:evt_shared_id'));
  assert.ok(await db.webhookEvent(env, 'paddle:sandbox:evt_shared_id'));
  assert.equal((await db.paddleCustomerOf(env, user.id)).customer_id, 'ctm_production');
  assert.equal((await db.paddleCustomerOf(sandbox, user.id)).customer_id, 'ctm_sandbox');
  await assert.rejects(signedHook(env, { ...liveEvent, event_id: 'evt_collision', data: { ...liveEvent.data, id: 'sub_sandbox' } }), /NOT_ELIGIBLE/);
  await assert.rejects(db.upsertSubscription(env, row(user.id, 'production', { external_id: 'sub_sandbox' })), /NOT_ELIGIBLE/);
  assert.equal((await db.subscriptionByExternal(env, 'paddle', 'sub_sandbox')).environment, 'sandbox');
});
