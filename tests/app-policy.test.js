import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createIOSAppPolicy } from '../server/app-policy.mjs';
import { routeRequest } from '../server/worker.mjs';
import { ENV, NOW, STOREFRONTS, EXPECTED, DISABLED, clone, request, data } from './app-policy-fixtures.js';

const originalFetch = globalThis.fetch;
let transportCalls = 0;
globalThis.fetch = () => { transportCalls++; throw new Error('Policy must not make an external request.'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(transportCalls, 0); });
const make = options => createIOSAppPolicy({ now: () => NOW, ...options });

test('default bundled proof matches the pinned public-release fixture and enables exactly four release storefronts', async () => {
  const handler = make();
  for (const storefront of [...STOREFRONTS, 'jo', 'sa', 'ae', 'us']) {
    const response = await handler(request(`storefront=${storefront}&osVersion=26.6.1`), ENV);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await response.json(), EXPECTED);
  }
  assert.equal(transportCalls, 0);
});

test('missing and malformed trusted records fail open', async () => {
  for (const releaseRecord of [null, false, 1, 'not a record', [], {}, { countries: {} }]) {
    assert.deepEqual(await data(make({ releaseRecord })), DISABLED);
  }
});

test('all pinned release identity, provenance and public-release fields must match', async () => {
  const changes = {
    schemaVersion: 2, appStoreId: '1', bundleId: 'Other', version: '1.9', build: 23,
    buildId: '193728e9-5d77-4d9f-8725-5e1c4de8c5f9', appStoreVersionId: 'e15b847b-310e-441a-a579-1533a75c0b25',
    sourceCommit: '0'.repeat(40), evidenceSHA256: '0'.repeat(64), officialPublic: false, downloadable: false,
  };
  for (const [field, value] of Object.entries(changes)) {
    const record = clone(); record[field] = value;
    assert.deepEqual(await data(make({ releaseRecord: record })), DISABLED, field);
    delete record[field];
    assert.deepEqual(await data(make({ releaseRecord: record })), DISABLED, `${field} missing`);
  }
});

test('invalid or future verification timestamps and unusable clocks fail open', async () => {
  for (const verifiedAt of [null, '', 'yesterday', '2026-10-21', '2026-10-21T04:56:30.151+00:00',
    '2026-02-31T00:00:00.000Z', new Date(NOW + 1).toISOString()]) {
    const record = clone(); record.verifiedAt = verifiedAt;
    assert.deepEqual(await data(make({ releaseRecord: record })), DISABLED);
  }
  for (const now of [() => NaN, () => Infinity, () => { throw new Error('Clock unavailable'); }]) {
    assert.deepEqual(await data(make({ now })), DISABLED);
  }
});

test('the verified release intentionally has no TTL, expiry timer, or refresh request', async () => {
  assert.deepEqual(await data(make({ now: () => Date.parse('2100-01-01T00:00:00.000Z') })), EXPECTED);
  const record = clone(); record.verifiedAt = '2020-01-01T00:00:00.000Z';
  assert.deepEqual(await data(make({ releaseRecord: record })), EXPECTED);
  assert.equal(transportCalls, 0);
});

test('only proven countries and their pinned minimum OS are accepted', async () => {
  const record = clone(); delete record.countries.SA;
  const handler = make({ releaseRecord: record });
  assert.deepEqual(await data(handler, 'storefront=SAU&osVersion=26.6.1'), DISABLED);
  assert.deepEqual(await data(handler, 'storefront=JOR&osVersion=26.6.1'), EXPECTED);
  for (const countries of [null, [], 'JO', {}, { FR: { minimumOS: '16.4' } }, { JO: {} },
    { JO: { minimumOS: '16.3' } }, { JO: { minimumOS: 'unknown' } }]) {
    const bad = clone(); bad.countries = countries;
    assert.deepEqual(await data(make({ releaseRecord: bad })), DISABLED);
  }
  for (const code of ['GBR', 'FR', 'XXX', 'ZZ']) {
    assert.deepEqual(await data(make(), `storefront=${code}&osVersion=26.6.1`), DISABLED);
  }
});

test('device OS must meet the exact recorded minimum', async () => {
  for (const [os, enabled] of [['16.4', true], ['16.4.0', true], ['26.6.1', true], ['16.3.9', false], ['16', false],
    ['unknown', false], ['16.4-beta', false], ['', false]]) {
    assert.deepEqual(await data(make(), `storefront=JOR&osVersion=${os}`), enabled ? EXPECTED : DISABLED);
  }
});

test('a missing, disabled or malformed activation configuration cannot enforce the bundled proof', async () => {
  for (const env of [{}, { ...ENV, IOS_UPDATE_POLICY_ENABLED: '0' }, { ...ENV, IOS_UPDATE_POLICY_ENABLED: 'true' },
    { ...ENV, IOS_MIN_SUPPORTED_BUILD: '0' }, { ...ENV, IOS_MIN_SUPPORTED_BUILD: '22.0' },
    { ...ENV, IOS_MIN_SUPPORTED_BUILD: '1000000' }, { ...ENV, IOS_MIN_SUPPORTED_VERSION: '1.8-beta' }]) {
    assert.deepEqual(await data(make(), undefined, env), DISABLED);
  }
});

test('changing either configured threshold automatically invalidates the old proof', async () => {
  for (const [version, build] of [['1.7', '22'], ['1.8', '21'], ['1.8', '23'], ['1.8.0', '22'], ['1.9', '23']]) {
    assert.deepEqual(await data(make(), undefined, { ...ENV, IOS_MIN_SUPPORTED_VERSION: version, IOS_MIN_SUPPORTED_BUILD: build }), DISABLED);
  }
});

test('caller input and new env properties cannot supply or replace the trusted record', async () => {
  const supplied = encodeURIComponent(JSON.stringify(clone()));
  const env = { ...ENV, IOS_VERIFIED_RELEASE: JSON.stringify(clone()), releaseRecord: clone() };
  const query = `storefront=JOR&osVersion=26.6.1&releaseRecord=${supplied}&url=https://untrusted.test`;
  assert.deepEqual(await data(make({ releaseRecord: null }), query, env), DISABLED);
  assert.deepEqual(await data(make(), query, { ...env, IOS_UPDATE_POLICY_ENABLED: '0' }), DISABLED);
  assert.deepEqual(await data(make(), query, { ...env, releaseRecord: null }), EXPECTED);
});

test('ambiguous, missing or malformed country and OS input fails open', async () => {
  for (const query of ['', 'storefront=JOR', 'osVersion=26.6.1', 'storefront=JOR&storefront=USA&osVersion=26.6.1',
    'storefront=JOR&osVersion=26.6.1&osVersion=16.4', 'storefront=JOR%26country%3Dus&osVersion=26.6.1']) {
    assert.deepEqual(await data(make(), query), DISABLED);
  }
});

test('GET and HEAD preserve the public response contract; all other methods remain rejected', async () => {
  const handler = make();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await handler(request(undefined, { method }), ENV);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assert.deepEqual(await response.json(), { error: 'METHOD' });
  }
  const head = await handler(request(undefined, { method: 'HEAD' }), ENV);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('cache-control'), 'no-store');
  assert.equal(head.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(await head.text(), '');
  assert.deepEqual(await data(handler), EXPECTED);
  const env = {
    get DB() { throw new Error('Policy must not read accounts'); },
    get LIMITERS() { throw new Error('Policy must not allocate session/IP state'); },
  };
  const publicResult = await routeRequest(request(), env);
  assert.equal(publicResult.status, 200);
  assert.deepEqual(await publicResult.json(), DISABLED);
  assert.equal(publicResult.headers.has('x-maydan-session'), false);
  assert.equal((await routeRequest(request(undefined, { method: 'POST' }), env)).status, 405);
  for (const pathname of ['/api/social/me', '/api/rooms', '/api/app-policy/ios/extra']) {
    const blocked = await routeRequest(new Request(`https://fixture.test${pathname}`), env);
    assert.equal(blocked.status, 403);
    assert.deepEqual(await blocked.json(), { error: 'ORIGIN' });
  }
});

test('concurrent and repeated requests need no transport, cache lease, pending lookup, or credentials', async () => {
  const handler = make();
  const results = await Promise.all(Array.from({ length: 100 }, (_, index) => data(handler,
    `storefront=${STOREFRONTS[index % 4]}&osVersion=26.6.1`)));
  assert.ok(results.every(result => result.enabled && result.minimumBuild === 22));
  assert.equal(transportCalls, 0);
});
