import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createLocalD1 } from '../server/local-d1.mjs';
import * as db from '../server/accounts/db.mjs';
import * as apple from '../server/accounts/apple.mjs';
import * as paddle from '../server/accounts/paddle.mjs';
import { routeAccounts, redeemHashes } from '../server/accounts/router.mjs';
import { issueSession, signState } from '../server/accounts/session.mjs';
import { hmacHex } from '../server/accounts/jwt.mjs';
import { premiumOf } from '../server/accounts/entitlements.mjs';
import { PRODUCTS } from '../src/shared/account/config.js';
import { codeHash } from '../src/shared/account/redeem.js';
import { waitForEntitlement, deliverAppleTransaction } from '../src/shared/account/purchases.js';
import { appleChain } from './helpers-apple.js';
import { verifyAppleJws } from '../server/accounts/x509.mjs';

const now = Date.now();
const pem = generateKeyPairSync('ec', { namedCurve: 'P-256', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const envOf = () => ({ DB: createLocalD1(), PADDLE_PRICE_MONTHLY: 'pri_month', PADDLE_PRICE_YEARLY: 'pri_year', PADDLE_WEBHOOK_SECRET: 'test-only-secret', PADDLE_API_KEY: 'test-key' });
const request = (env, path, body, { method = 'POST', token, headers = {} } = {}) => {
  const url = new URL(`https://maydan.test${path}`);
  return routeAccounts(new Request(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), env, url);
};
async function hook(env, event) {
  const raw = JSON.stringify(event), ts = Math.floor(Date.now() / 1000);
  return request(env, '/api/paddle/webhook', raw, { headers: { 'paddle-signature': `ts=${ts};h1=${await hmacHex(env.PADDLE_WEBHOOK_SECRET, `${ts}:${raw}`)}` } });
}
const eventFor = (userId, extra = {}) => ({ event_id: 'evt_retry', event_type: 'subscription.activated', occurred_at: new Date(now).toISOString(), data: { id: 'sub_retry', status: 'active', custom_data: { userId }, items: [{ price: { id: 'pri_month' } }], current_billing_period: { ends_at: new Date(now + 86400000).toISOString() }, ...extra } });

test('Paddle retries a DB failure without losing the signed event', async (t) => {
  const env = envOf(); t.after(() => env.DB.close());
  const user = await db.createUser(env);
  const original = env.DB.prepare.bind(env.DB);
  let failOnce = true;
  env.DB.prepare = (sql) => { if (failOnce && sql.startsWith('INSERT INTO subscriptions')) { failOnce = false; throw new Error('temporary database failure'); } return original(sql); };
  const event = eventFor(user.id);
  await assert.rejects(hook(env, event), /temporary database failure/);
  assert.equal(await db.webhookEvent(env, 'paddle:sandbox:evt_retry'), null);
  assert.equal((await hook(env, event)).status, 200);
  assert.equal(premiumOf(await db.subscriptionsOf(env, user.id)).active, true);
  assert.equal((await (await hook(env, event)).json()).duplicate, true);
});

test('unrelated Paddle prices never grant Plus; canceled/paused status cannot keep future access', () => {
  const env = envOf(); env.DB.close();
  assert.equal(paddle.subscriptionRow(env, eventFor('u', { items: [{ price: { id: 'unrelated' } }] })), null);
  for (const status of ['canceled', 'paused', 'unknown']) {
    const row = paddle.subscriptionRow(env, eventFor('u', { status }));
    assert.equal(row.until, 0);
    assert.equal(premiumOf([row]).active, false);
  }
  const row = paddle.subscriptionRow(env, eventFor('u', { items: [{ price: { id: 'unrelated' } }, { price: { id: 'pri_year' } }] }));
  assert.equal(row.product, PRODUCTS.yearly);
});

test('subscription and customer ownership cannot be silently reassigned', async (t) => {
  const env = envOf(); t.after(() => env.DB.close());
  const owner = await db.createUser(env), other = await db.createUser(env);
  const event = eventFor(owner.id);
  await hook(env, event);
  await assert.rejects(hook(env, { ...eventFor(other.id), event_id: 'evt_other' }), /ALREADY_LINKED/);
  await db.upsertSubscription(env, { ...paddle.subscriptionRow(env, event), user_id: other.id, occurred_at: now + 10000 });
  assert.equal((await db.subscriptionByExternal(env, 'paddle', 'sub_retry')).user_id, owner.id);
  await db.setPaddleCustomer(env, owner.id, 'ctm_owner');
  await assert.rejects(db.setPaddleCustomer(env, other.id, 'ctm_owner'), /ALREADY_LINKED/);
  assert.equal((await db.paddleUserOf(env, 'ctm_owner')).user_id, owner.id);
});

test('Paddle cancellation failure preserves the account and its renewal records', async (t) => {
  const env = envOf(); t.after(() => env.DB.close());
  const user = await db.createUser(env), session = await issueSession(env, user.id);
  await db.upsertSubscription(env, { source: 'paddle', external_id: 'sub_delete', user_id: user.id, product: PRODUCTS.monthly, status: 'active', until: now + 86400000, will_renew: true, occurred_at: now });
  t.mock.method(globalThis, 'fetch', async () => response({ error: 'temporary' }, 503));
  await assert.rejects(request(env, '/api/account', undefined, { method: 'DELETE', token: session.token }), /BILLING_CANCEL_FAILED/);
  assert.ok(await db.userById(env, user.id));
  assert.equal((await db.subscriptionsOf(env, user.id)).length, 1);
});

test('account deletion rolls back earlier table deletions when a later statement fails', async (t) => {
  const env = envOf(); t.after(() => env.DB.close());
  const user = await db.createUser(env), session = await issueSession(env, user.id);
  await db.addTrial(env, user.id, 'beep');
  const prepare = env.DB.prepare.bind(env.DB);
  // The invalid statement fails inside batch after sessions/auth codes have run.
  env.DB.prepare = (sql) => prepare(sql === 'DELETE FROM trials WHERE user_id = ?' ? 'DELETE FROM table_that_does_not_exist WHERE user_id = ?' : sql);
  await assert.rejects(db.deleteUser(env, user.id), /no such table/);
  assert.ok(await db.userById(env, user.id));
  assert.ok(await db.sessionById(env, session.id));
  assert.equal((await db.trialsOf(env, user.id)).beep, true);
  env.DB.prepare = prepare;
  await db.deleteUser(env, user.id);
  assert.equal(await db.userById(env, user.id), null);
  assert.equal(await db.sessionById(env, session.id), null);
});

test('Apple client secret audience matches the native or web token request', async (t) => {
  const env = { APPLE_SIGNIN_PRIVATE_KEY: pem, APPLE_SIGNIN_KEY_ID: 'key', APPLE_TEAM_ID: 'team', APPLE_BUNDLE_ID: 'com.maydan.app', APPLE_SERVICES_ID: 'com.maydan.web' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => { calls.push(new URLSearchParams(init.body)); return response({ refresh_token: 'refresh' }); });
  for (const client of ['ios', 'web']) await apple.exchangeCode(env, { code: 'test', client });
  assert.deepEqual(calls.map((body) => body.get('client_id')), ['com.maydan.app', 'com.maydan.web']);
  for (const body of calls) assert.equal(JSON.parse(Buffer.from(body.get('client_secret').split('.')[1], 'base64url')).sub, body.get('client_id'));
});

test('Apple chooses signed transaction environment and falls back only for transaction-not-found', async (t) => {
  const env = { APPLE_IAP_PRIVATE_KEY: pem, APPLE_IAP_KEY_ID: 'key', APPLE_IAP_ISSUER_ID: 'issuer', APPLE_BUNDLE_ID: 'com.maydan.app' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => { calls.push(url); return url.includes('sandbox') ? response({ data: [] }) : response({ errorCode: 4040010 }, 404); });
  await apple.fetchSubscription(env, '2000', now);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^https:\/\/api.storekit.apple.com\//);
  assert.match(calls[1], /^https:\/\/api.storekit-sandbox.apple.com\//);
  calls.length = 0;
  await apple.fetchSubscription(env, '2000', now, 'Sandbox');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /sandbox/);
});

test('Apple notification retries provider failure and can recover the first purchase by appAccountToken', async (t) => {
  const chain = appleChain(), env = { ...envOf(), APPLE_ROOT_CA_SHA256: chain.rootSha256, APPLE_IAP_PRIVATE_KEY: pem, APPLE_IAP_KEY_ID: 'key', APPLE_IAP_ISSUER_ID: 'issuer', APPLE_BUNDLE_ID: 'com.maydan.app' };
  t.after(() => env.DB.close());
  const user = await db.createUser(env);
  const info = { bundleId: env.APPLE_BUNDLE_ID, productId: PRODUCTS.monthly, originalTransactionId: '2000', appAccountToken: user.id, expiresDate: now + 86400000, environment: 'Sandbox' };
  const signed = chain.sign({ notificationUUID: 'notification_retry', data: { signedTransactionInfo: chain.sign(info) } });
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => ++attempts === 1 ? response({}, 503) : response({ data: [{ lastTransactions: [{ originalTransactionId: '2000', status: 1, signedTransactionInfo: chain.sign(info) }] }] }));
  await assert.rejects(apple.handleNotification(env, signed), /PROVIDER/);
  assert.equal(await db.webhookEvent(env, 'apple:notification_retry'), null);
  assert.equal((await apple.handleNotification(env, signed)).status, 200);
  assert.equal(premiumOf(await db.subscriptionsOf(env, user.id)).active, true);
  assert.equal((await (await apple.handleNotification(env, signed)).json()).duplicate, true);
});

test('production OAuth has no public default signing secret', async () => {
  await assert.rejects(signState({}, { p: 'google' }), /NOT_ELIGIBLE/);
  assert.ok(await signState({ SESSION_SECRET: 'test' }, { p: 'google' }));
});

test('redemption requires a server-configured hash; saved legitimate grants survive rotation', async (t) => {
  const env = envOf(); t.after(() => env.DB.close());
  const user = await db.createUser(env), session = await issueSession(env, user.id);
  assert.deepEqual(redeemHashes(env), []);
  await assert.rejects(request(env, '/api/redeem', { code: 'test-only-gift' }, { token: session.token }), /REDEEM_INVALID/);
  env.REDEEM_CODE_HASHES = codeHash('test-only-gift');
  assert.equal((await request(env, '/api/redeem', { code: 'test-only-gift' }, { token: session.token })).status, 200);
  delete env.REDEEM_CODE_HASHES;
  assert.equal(premiumOf(await db.subscriptionsOf(env, user.id)).active, true);
});

test('checkout waits for the server entitlement and never reports delayed activation as active', async () => {
  let attempts = 0;
  const active = { premium: { active: true, source: 'paddle', until: Date.now() + 86400000 } };
  assert.equal(await waitForEntitlement(async () => ++attempts === 3 ? active : null, { wait: async () => {} }), active);
  assert.equal(attempts, 3);
  await assert.rejects(waitForEntitlement(async () => null, { attempts: 2, wait: async () => {} }), /ACTIVATION_PENDING/);
  await assert.rejects(waitForEntitlement(async () => ({ premium: { ...active.premium, source: 'promo' } }), { attempts: 1 }), /ACTIVATION_PENDING/, 'an existing gift grant is not confirmation of a new payment');
});

test('native transaction finish follows server save; failed save never acknowledges StoreKit', async () => {
  const order = [];
  await deliverAppleTransaction('signed', { submit: async () => { order.push('server'); return {}; }, apply: () => order.push('apply'), acknowledge: async () => order.push('finish') });
  assert.deepEqual(order, ['server', 'apply', 'finish']);
  let finished = false;
  await assert.rejects(deliverAppleTransaction('signed', { submit: async () => { throw new Error('offline'); }, apply: () => {}, acknowledge: async () => { finished = true; } }), /offline/);
  assert.equal(finished, false);
  const swift = readFileSync('ios/Maydan/StoreManager.swift', 'utf8');
  assert.equal([...swift.matchAll(/await transaction\.finish\(\)/g)].length, 1);
  assert.match(swift, /func finishTransaction\(jws: String\)[\s\S]*await transaction\.finish\(\)/);
  assert.match(swift, /Transaction\.unfinished/);
});

test('Paddle accepts the matching signature during secret rotation', async () => {
  const raw = '{}', ts = Math.floor(now / 1000), secret = 'rotation-test';
  const valid = await hmacHex(secret, `${ts}:${raw}`);
  assert.equal(await paddle.verifySignature({ PADDLE_WEBHOOK_SECRET: secret }, `ts=${ts};h1=${valid};h1=${'0'.repeat(64)}`, raw, now), true);
});

test('restoring an old Apple signature checks certificate validity at its signed date', async () => {
  const chain = appleChain();
  const jws = chain.sign({ signedDate: now, transactionId: 'old-valid' });
  const payload = await verifyAppleJws(jws, { rootSha256: chain.rootSha256, now: Date.UTC(2090, 0, 1) });
  assert.equal(payload.transactionId, 'old-valid');
  await assert.rejects(verifyAppleJws(chain.sign({ signedDate: now + 600000 }), { rootSha256: chain.rootSha256, now }), /SIGNATURE/);
});

test('Paddle checkout collects missing email rather than fabricating a billing address', async (t) => {
  const env = envOf(); t.after(() => env.DB.close());
  const user = await db.createUser(env);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return response({ data: { id: 'txn_no_email' } }); });
  const checkout = await paddle.createTransaction(env, user, 'monthly');
  assert.equal(checkout.transactionId, 'txn_no_email');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.customer_id, undefined);
  assert.equal(calls[0].body.custom_data.userId, user.id);
  assert.match(calls[0].body.custom_data.checkoutAttemptId, /^[a-f0-9-]{36}$/);
  assert.doesNotMatch(JSON.stringify(calls), /maydan\.invalid/);
});
