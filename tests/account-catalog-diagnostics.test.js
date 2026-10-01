import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogDiagnostics, catalogSupportText } from '../src/shared/account/catalog-diagnostics.js';

test('catalog support report excludes personal data and raw StoreKit errors', () => {
  const details = catalogDiagnostics({
    outcome: 'storekit-error', bundleId: 'Maydan', version: '1.5', build: '7', iOSVersion: '26.0',
    storefrontCountry: 'JOR', canMakePayments: true, elapsedMs: 150.6,
    requestedIds: ['plus.monthly', 'plus.yearly', 'private-product'], returnedIds: [],
    receipt: 'secret-receipt', userId: 'secret-user', email: 'private@example.com',
    errorChain: [{ domain: 'ASDErrorDomain', code: 500, description: 'private-error', userInfo: { token: 'secret-token' } }],
  });
  assert.equal(details.outcome, 'storekit-error');
  assert.equal(details.storefrontCountry, 'JOR');
  assert.equal(details.elapsedMs, 151);
  assert.deepEqual(details.errorChain, [{ domain: 'ASDErrorDomain', code: 500 }]);
  assert.deepEqual(details.requestedIds, ['plus.monthly', 'plus.yearly']);
  assert.doesNotMatch(catalogSupportText(details), /secret|private|userId|email|receipt/);
});

test('catalog support report bounds malformed fields and preserves failure distinctions', () => {
  assert.deepEqual(catalogDiagnostics({ outcome: 'unknown', storefrontCountry: 'Jordan', build: '<script>', errorChain: [{ domain: 'private data', code: 1 }] }, 'empty'), { outcome: 'empty', errorChain: [] });
  for (const outcome of ['missing-config', 'empty', 'storekit-error', 'storekit-timeout', 'bridge-timeout', 'bridge-unavailable']) {
    assert.equal(catalogDiagnostics({ outcome }).outcome, outcome);
  }
  assert.equal(catalogDiagnostics(null, 'arbitrary-secret').outcome, 'native-error');
  assert.equal(catalogSupportText(null), '');
});
