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

test('probe and restore reports permit only known APIs, stages and product identifiers', () => {
  const report = catalogDiagnostics({
    api: 'storekit1', stage: 'native-sync', outcome: 'probe-cancelled',
    invalidIds: ['private@example.test', 'plus.monthly', 'plus.yearly', 'plus.monthly'],
    requestedIds: [{ id: 'plus.monthly' }, 'plus.yearly'],
    returnedIds: 'plus.monthly', account: { id: 'private-user' },
    receipt: 'private-receipt', url: 'https://private.example.test',
  });
  assert.deepEqual(report, {
    outcome: 'probe-cancelled', api: 'storekit1', stage: 'native-sync',
    requestedIds: ['plus.yearly'], invalidIds: ['plus.monthly', 'plus.yearly'],
  });
  for (const stage of ['native-sync', 'native-bridge', 'native-entitlements', 'server-verify']) {
    assert.equal(catalogDiagnostics({ api: 'storekit2', stage }).stage, stage);
  }
  assert.deepEqual(catalogDiagnostics({ api: 'private-user', stage: 'private-stage', invalidIds: [null, {}, 1] }), {
    outcome: 'native-error', invalidIds: [],
  });
  assert.doesNotMatch(catalogSupportText(report), /private|receipt|account|https/);
});

test('support reports remain bounded when native error metadata is excessive or malformed', () => {
  const report = catalogDiagnostics({
    elapsedMs: 999_999, bundleId: 'x'.repeat(81), version: '1'.repeat(25),
    errorChain: [
      { domain: 'ASDErrorDomain', code: 500, description: 'private-error', userInfo: { token: 'private-token' } },
      { domain: 'private domain', code: 1 },
      { domain: 'SKErrorDomain', code: Number.MAX_SAFE_INTEGER + 1 },
      { domain: 'IgnoredErrorDomain', code: 2 },
    ],
  });
  assert.deepEqual(report, { outcome: 'native-error', elapsedMs: 600_000, errorChain: [{ domain: 'ASDErrorDomain', code: 500 }] });
  assert.equal(catalogDiagnostics({ elapsedMs: -1 }).elapsedMs, 0);
  for (const elapsedMs of [NaN, Infinity, '123']) {
    assert.equal('elapsedMs' in catalogDiagnostics({ elapsedMs }), false);
  }
  assert.doesNotMatch(catalogSupportText(report), /private|description|userInfo|IgnoredErrorDomain/);
});
