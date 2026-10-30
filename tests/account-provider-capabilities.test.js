import test from 'node:test';
import assert from 'node:assert/strict';
import { routeAccounts } from '../server/accounts/router.mjs';
import { authorizeUrl } from '../server/accounts/google.mjs';
import { signInProviders } from '../src/shared/account/config.js';

const read = async env => {
  const url = new URL('https://preview.test/api/billing/config');
  return (await routeAccounts(new Request(url), { DB: {}, ...env }, url)).json();
};
test('native-only Apple configuration does not promise a web sign-in redirect', async () => {
  const result = await read({ APPLE_BUNDLE_ID: 'unit.bundle' });
  assert.deepEqual(signInProviders(result, 'ios'), { apple: true, google: false });
  assert.deepEqual(signInProviders(result, 'web'), { apple: false, google: false });
  assert.equal(result.providers.apple, true, 'legacy native clients retain their supported Apple login');
});
test('Google code login is unavailable until its exchange secret is configured', async () => {
  for (const secret of [undefined, '', ' ']) {
    const env = { GOOGLE_CLIENT_ID: 'unit-client', GOOGLE_CLIENT_SECRET: secret };
    assert.equal((await read(env)).providers.google, false);
    assert.throws(() => authorizeUrl(env, { redirectUri: 'https://preview.test/callback' }), /NOT_ELIGIBLE/);
  }
  const result = await read({ GOOGLE_CLIENT_ID: 'unit-client', GOOGLE_CLIENT_SECRET: 'private-test-value', APPLE_SERVICES_ID: 'unit.web' });
  assert.deepEqual(signInProviders(result, 'web'), { apple: true, google: true });
  assert.deepEqual(signInProviders(result, 'ios'), { apple: false, google: true });
  assert.ok(!JSON.stringify(result).includes('private-test-value'));
  assert.ok(!JSON.stringify(result).includes('unit-client'));
});
test('provider selection remains compatible with older server responses', () => {
  assert.deepEqual(signInProviders({ providers: { apple: true, google: false } }, 'ios'), { apple: true, google: false });
  assert.equal(signInProviders(null, 'web'), null);
});
