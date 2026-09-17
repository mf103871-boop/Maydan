import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import * as db from '../server/accounts/db.mjs';
import * as paddle from '../server/accounts/paddle.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeAccounts } from '../server/accounts/router.mjs';
import { hmacHex } from '../server/accounts/jwt.mjs';

const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
async function setup(t) {
  const env = { DB: createLocalD1(), PADDLE_ENV: 'production', PADDLE_CHECKOUT_ENABLED: 'true', PADDLE_API_KEY: 'unit', PADDLE_CLIENT_TOKEN: 'live_unit', PADDLE_WEBHOOK_SECRET: 'unit-secret', PADDLE_PRICE_MONTHLY: 'pri_month', PADDLE_PRICE_YEARLY: 'pri_year' };
  t.after(() => env.DB.close());
  const user = await db.createUser(env), session = await issueSession(env, user.id);
  const request = (path, method, body, headers = {}) => {
    const url = new URL(`https://maydan.test${path}`);
    return routeAccounts(new Request(url, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}`, ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), env, url);
  };
  return { env, user, request, checkout: () => request('/api/paddle/checkout', 'POST', { plan: 'monthly' }) };
}

test('parallel checkout requests reserve once; retries return the same provider-verified transaction', async (t) => {
  const { env, user, checkout } = await setup(t);
  const started = deferred(), finish = deferred(); let posts = 0, data;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (init.method === 'POST') { posts++; data = { ...JSON.parse(init.body), id: 'txn_once', status: 'ready' }; started.resolve(); await finish.promise; }
    return reply({ data });
  });
  const first = checkout(); await started.promise;
  await assert.rejects(checkout(), /CHECKOUT_PENDING/);
  assert.equal(posts, 1);
  finish.resolve(); assert.equal((await (await first).json()).transactionId, 'txn_once');
  const retries = await Promise.all([checkout(), checkout()]);
  assert.deepEqual(await Promise.all(retries.map(async (r) => (await r.json()).transactionId)), ['txn_once', 'txn_once']);
  assert.equal(posts, 1);
  assert.equal((await db.paddleCheckoutOf(env, user.id)).transaction_id, 'txn_once');
});

test('a lost POST response never expires; signed transaction event repairs it without a second POST', async (t) => {
  const { env, user, checkout, request } = await setup(t);
  let posts = 0, data;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (_url === 'https://api.paddle.com/ips') return reply({ data: { ipv4_cidrs: ['192.0.2.10/32'] } });
    if (init.method === 'POST') { posts++; data = { ...JSON.parse(init.body), id: 'txn_lost', status: 'ready' }; throw new Error('response lost after creation'); }
    return reply({ data });
  });
  await assert.rejects(checkout(), /CHECKOUT_REVIEW/);
  await db.run(env, 'UPDATE paddle_checkouts SET created_at = 0, updated_at = 0 WHERE user_id = ?', user.id);
  await assert.rejects(checkout(), /CHECKOUT_REVIEW/);
  await assert.rejects(request('/api/account', 'DELETE'), /CHECKOUT_REVIEW/);
  assert.equal(await db.first(env, 'SELECT * FROM account_deletions WHERE user_id = ?', user.id), null, 'blocked deletion releases only its deletion guard');
  assert.ok(await db.paddleCheckoutOf(env, user.id));
  assert.equal(posts, 1);
  const event = { event_id: 'evt_recover', event_type: 'transaction.created', data };
  const body = JSON.stringify(event), ts = Math.floor(Date.now() / 1000);
  const recovered = await request('/api/paddle/webhook', 'POST', body, { 'cf-connecting-ip': '192.0.2.10', 'paddle-signature': `ts=${ts};h1=${await hmacHex(env.PADDLE_WEBHOOK_SECRET, `${ts}:${body}`)}` });
  assert.equal((await recovered.json()).recovered, true);
  assert.equal((await (await checkout()).json()).transactionId, 'txn_lost');
  assert.equal(posts, 1);
  assert.equal((await db.subscriptionsOf(env, user.id)).length, 0, 'transaction recovery never grants Plus');
});

test('5xx, rate-limit and malformed success responses all retain the uncertain reservation', async (t) => {
  for (const [status, body] of [[503, { error: { code: 'internal', type: 'api_error' } }], [429, { error: { code: 'rate_limit', type: 'request_error' } }], [200, {}]]) {
    const context = await setup(t); let calls = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return reply(body, status); });
    await assert.rejects(context.checkout(), /CHECKOUT_REVIEW/);
    await assert.rejects(context.checkout(), /CHECKOUT_REVIEW/);
    assert.equal(calls, 1);
    assert.equal((await db.paddleCheckoutOf(context.env, context.user.id)).state, 'unknown');
    mock.mock.restore();
  }
});

test('explicit provider rejection releases the reservation; a later corrected request may create', async (t) => {
  const { env, user, checkout } = await setup(t); let posts = 0;
  t.mock.method(globalThis, 'fetch', async () => ++posts === 1
    ? reply({ error: { type: 'request_error', code: 'transaction_invalid_item' } }, 400)
    : reply({ data: { id: 'txn_corrected', status: 'ready' } }, 201));
  await assert.rejects(checkout(), /PROVIDER/);
  assert.equal(await db.paddleCheckoutOf(env, user.id), null);
  assert.equal((await (await checkout()).json()).transactionId, 'txn_corrected');
  assert.equal(posts, 2);
});

test('failure before transaction POST releases reservation, but a failed result save keeps it', async (t) => {
  const { env, user, checkout } = await setup(t);
  user.email = 'unit@example.test';
  await db.run(env, 'UPDATE users SET email = ? WHERE id = ?', user.email, user.id);
  let calls = 0;
  const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return reply({}, 503); });
  await assert.rejects(checkout(), /PROVIDER/);
  assert.equal(await db.paddleCheckoutOf(env, user.id), null);
  mock.mock.restore();
  await db.run(env, 'UPDATE users SET email = NULL WHERE id = ?', user.id);
  t.mock.method(globalThis, 'fetch', async () => { calls++; return reply({ data: { id: 'txn_saved_provider' } }); });
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => { if (sql.startsWith('UPDATE paddle_checkouts SET transaction_id')) throw new Error('D1 unavailable after provider success'); return prepare(sql); };
  await assert.rejects(checkout(), /CHECKOUT_REVIEW/);
  env.DB.prepare = prepare;
  await assert.rejects(checkout(), /CHECKOUT_REVIEW/);
  assert.equal(calls, 2);
});

test('completed payment needs a canceled and ended subscription before allowing re-subscription', async (t) => {
  const { env, user, checkout } = await setup(t); let posts = 0, data;
  let subscription = { id: 'sub_old', status: 'paused', paused_at: new Date(Date.now() - 1000).toISOString() };
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.includes('/subscriptions/')) return reply({ data: subscription });
    if (init.method === 'POST') { posts++; data = { ...JSON.parse(init.body), id: `txn_${posts}`, status: 'ready' }; }
    return reply({ data });
  });
  await checkout(); data.status = 'completed'; data.subscription_id = 'sub_old';
  for (const status of ['paused', 'past_due', 'active']) {
    subscription.status = status;
    await assert.rejects(checkout(), /CHECKOUT_PENDING/);
  }
  subscription = { id: 'sub_old', status: 'canceled', current_billing_period: { ends_at: new Date(Date.now() + 86400000).toISOString() } };
  await assert.rejects(checkout(), /CHECKOUT_PENDING/);
  subscription.current_billing_period.ends_at = new Date(Date.now() - 86400000).toISOString();
  assert.equal((await (await checkout()).json()).transactionId, 'txn_2');
  assert.equal(posts, 2);
  assert.equal((await db.paddleCheckoutOf(env, user.id)).transaction_id, 'txn_2');
});

test('paid/completed without a confirmed subscription and unknown GET results cannot release a checkout', async (t) => {
  const { checkout } = await setup(t); let data, posts = 0, failedRead = false;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (init.method === 'POST') { posts++; data = { ...JSON.parse(init.body), id: 'txn_pending', status: 'ready' }; }
    return failedRead ? reply({}, 404) : reply({ data });
  });
  await checkout();
  for (const status of ['paid', 'completed', 'billed', 'past_due']) { data.status = status; await assert.rejects(checkout(), /CHECKOUT_PENDING/); }
  failedRead = true;
  await assert.rejects(checkout(), /CHECKOUT_REVIEW/);
  assert.equal(posts, 1);
});

test('parallel retries after confirmed cancellation still create only one replacement', async (t) => {
  const { checkout } = await setup(t); let posts = 0, first, replacement;
  const started = deferred(), finish = deferred();
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init.method === 'GET') return reply({ data: url.endsWith('/txn_replacement') ? replacement : { ...first, status: 'canceled' } });
    posts++;
    if (posts === 1) { first = { ...JSON.parse(init.body), id: 'txn_canceled', status: 'ready' }; return reply({ data: first }); }
    replacement = { ...JSON.parse(init.body), id: 'txn_replacement', status: 'ready' };
    started.resolve(); await finish.promise;
    return reply({ data: replacement });
  });
  await checkout();
  const outcomes = Promise.allSettled([checkout(), checkout()]);
  await started.promise; finish.resolve();
  const results = await outcomes;
  assert.equal(posts, 2, 'one original plus one replacement');
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  for (const result of results) {
    if (result.status === 'fulfilled') assert.equal((await result.value.json()).transactionId, 'txn_replacement');
    else assert.equal(result.reason.code, 'CHECKOUT_PENDING');
  }
});

test('account deletion blocks new checkout across environments and stale authenticated user objects', async (t) => {
  const { env, user, request, checkout } = await setup(t);
  await db.run(env, 'INSERT INTO identities (provider, subject, user_id, refresh_token, created_at) VALUES (?, ?, ?, ?, ?)', 'apple', 'unit-delete', user.id, 'refresh-unit', Date.now());
  // A direct deletion guard represents the period while provider cancellation/revocation is pending.
  assert.equal(await db.reserveAccountDeletion(env, user.id, 'deletion-unit'), true);
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return reply({}); });
  await assert.rejects(checkout(), /CHECKOUT_PENDING/);
  await assert.rejects(paddle.createTransaction({ ...env, PADDLE_ENV: 'sandbox' }, user, 'monthly'), /CHECKOUT_PENDING/);
  assert.equal(calls, 0);
  await db.releaseAccountDeletion(env, user.id, 'deletion-unit');
  // A failed provider revocation must release the deletion guard.
  await assert.rejects(request('/api/account', 'DELETE'));
  assert.equal(await db.first(env, 'SELECT * FROM account_deletions WHERE user_id = ?', user.id), null);
  await db.deleteUser(env, user.id);
  await assert.rejects(paddle.createTransaction(env, user, 'monthly'), /CHECKOUT_PENDING/);
  assert.equal(calls, 0, 'a stale user object cannot create a transaction after deletion');
});

test('deletion cancels a paused subscription; provider failure releases deletion guard but preserves the payment binding', async (t) => {
  const { env, user, request, checkout } = await setup(t);
  let transaction, cancellationFails = true;
  const cancellationBodies = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/transactions')) {
      transaction = { ...JSON.parse(init.body), id: 'txn_paused', status: 'ready' };
      return reply({ data: transaction });
    }
    if (url.includes('/transactions/')) return reply({ data: transaction });
    if (url.endsWith('/cancel')) {
      cancellationBodies.push(JSON.parse(init.body));
      return cancellationFails ? reply({}, 503) : reply({ data: { id: 'sub_paused', status: 'canceled' } });
    }
    return reply({ data: { id: 'sub_paused', status: 'paused', scheduled_change: { action: 'resume' } } });
  });
  await checkout();
  transaction.status = 'completed'; transaction.subscription_id = 'sub_paused';
  await db.upsertSubscription(env, { source: 'paddle', external_id: 'sub_paused', user_id: user.id, status: 'paused', until: 0, will_renew: false });
  await assert.rejects(request('/api/account', 'DELETE'), /BILLING_CANCEL_FAILED/);
  assert.ok(await db.userById(env, user.id));
  assert.equal((await db.paddleCheckoutOf(env, user.id)).transaction_id, 'txn_paused');
  assert.equal(await db.first(env, 'SELECT * FROM account_deletions WHERE user_id = ?', user.id), null);
  cancellationFails = false;
  assert.equal((await request('/api/account', 'DELETE')).status, 204);
  assert.deepEqual(cancellationBodies, [{ effective_from: 'immediately' }, { effective_from: 'immediately' }]);
  assert.equal(await db.userById(env, user.id), null);
});

test('deletion accepts a provider-confirmed scheduled cancellation without repeating cancellation', async (t) => {
  const { env, user, request } = await setup(t);
  await db.upsertSubscription(env, { source: 'paddle', external_id: 'sub_scheduled', user_id: user.id, status: 'active', until: Date.now() + 86400000, will_renew: false });
  const methods = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    methods.push(init.method);
    return reply({ data: { id: 'sub_scheduled', status: 'active', scheduled_change: { action: 'cancel' } } });
  });
  assert.equal((await request('/api/account', 'DELETE')).status, 204);
  assert.deepEqual(methods, ['GET']);
});
