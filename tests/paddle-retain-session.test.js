import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import * as db from '../server/accounts/db.mjs';
import { issueSession, me } from '../server/accounts/session.mjs';
import { routeAccounts } from '../server/accounts/router.mjs';

const A = `ctm_${'a'.repeat(26)}`, B = `ctm_${'b'.repeat(26)}`;
test('me exposes only the current environment mapping, with no provider or legacy writes', async (t) => {
  const DB = createLocalD1(); t.after(() => DB.close());
  const live = { DB, PADDLE_ENV: 'production' }, sandbox = { DB, PADDLE_ENV: 'sandbox' };
  const user = await db.createUser(live);
  await DB.prepare('INSERT INTO paddle_customers VALUES (?, ?, ?)').bind(user.id, A, 123).run();
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Provider calls are forbidden'); });
  assert.deepEqual((await me(live, user)).paddle, { environment: 'production', customerId: null });
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM paddle_customers_scoped').first()).n, 0);
  assert.deepEqual(await DB.prepare('SELECT * FROM paddle_customers').first(), { user_id: user.id, customer_id: A, created_at: 123 });
  await db.setPaddleCustomer(live, user.id, A); await db.setPaddleCustomer(sandbox, user.id, B);
  assert.deepEqual((await me(live, user)).paddle, { environment: 'production', customerId: A });
  assert.deepEqual((await me(sandbox, user)).paddle, { environment: 'sandbox', customerId: B });
  const another = await db.createUser(live);
  assert.equal((await me(live, another)).paddle.customerId, null);
});

test('authenticated me returns customer metadata and anonymous me cannot retrieve it', async (t) => {
  const env = { DB: createLocalD1(), PADDLE_ENV: 'production' }; t.after(() => env.DB.close());
  const user = await db.createUser(env); await db.setPaddleCustomer(env, user.id, A);
  const session = await issueSession(env, user.id);
  const url = new URL('https://maydan.example/api/me');
  await assert.rejects(routeAccounts(new Request(url), env, url), /AUTH_REQUIRED/);
  const response = await routeAccounts(new Request(url, { headers: { authorization: `Bearer ${session.token}` } }), env, url);
  assert.deepEqual((await response.json()).paddle, { environment: 'production', customerId: A });
});

test('malformed stored Paddle IDs never become Retain identities', async (t) => {
  const env = { DB: createLocalD1(), PADDLE_ENV: 'production' }; t.after(() => env.DB.close());
  const user = await db.createUser(env); await db.setPaddleCustomer(env, user.id, 'internal-id');
  assert.equal((await me(env, user)).paddle.customerId, null);
});
