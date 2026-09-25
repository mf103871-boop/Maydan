import test from 'node:test';
import assert from 'node:assert/strict';
import { configured, purchasesConfigured, fetchSubscription } from '../server/accounts/apple.mjs';
import { routeAccounts } from '../server/accounts/router.mjs';

const appleSettings = {
  APPLE_BUNDLE_ID: 'app.unit.maydan',
  APPLE_IAP_PRIVATE_KEY: 'test-private-key-never-public',
  APPLE_IAP_KEY_ID: 'test-key-id-never-public',
  APPLE_IAP_ISSUER_ID: 'test-issuer-never-public',
};
const config = async (env) => {
  const url = new URL('https://maydan.test/api/billing/config');
  return (await routeAccounts(new Request(url), { DB: {}, ...env }, url)).json();
};

test('Apple sign-in configuration alone never enables native purchases', async () => {
  const env = { APPLE_BUNDLE_ID: 'Maydan', APPLE_SERVICES_ID: 'app.maydan.web' };
  assert.equal(configured(env), true);
  assert.equal(purchasesConfigured(env), false);
  const result = await config(env);
  assert.equal(result.providers.apple, true);
  assert.deepEqual(result.apple, { purchasesConfigured: false });
});

test('Apple verification requires all IAP settings and bundle; public config reveals only readiness', async () => {
  for (const key of Object.keys(appleSettings)) {
    for (const value of [undefined, '', '   ']) {
      const env = { ...appleSettings, [key]: value };
      assert.equal(purchasesConfigured(env), false, `${key}=${String(value)}`);
      assert.equal((await config(env)).apple.purchasesConfigured, false);
      await assert.rejects(fetchSubscription(env, 'unit-transaction'), /NOT_ELIGIBLE/);
    }
  }
  const result = await config(appleSettings);
  assert.deepEqual(result.apple, { purchasesConfigured: true });
  for (const secret of Object.values(appleSettings)) assert.ok(!JSON.stringify(result).includes(secret));
});

test('Apple readiness does not change Paddle checkout configuration', async () => {
  const paddle = { PADDLE_CLIENT_TOKEN: 'test_unit', PADDLE_API_KEY: 'key', PADDLE_WEBHOOK_SECRET: 'secret', PADDLE_PRICE_MONTHLY: 'pri_unit' };
  const withoutApple = await config(paddle);
  const withApple = await config({ ...paddle, ...appleSettings });
  assert.deepEqual(withApple.paddle, withoutApple.paddle);
  assert.equal(withoutApple.paddle.checkoutEnabled, true);
});
