import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { ENV, NOW, ROOT, STOREFRONTS, EXPECTED, DISABLED, clone } from './app-policy-fixtures.js';

async function runtime(t, overrides = {}) {
  const source = `
    import { createIOSAppPolicy } from './server/app-policy.mjs';
    const policy = createIOSAppPolicy({ now: () => ${overrides.now ?? NOW}${Object.hasOwn(overrides, 'record') ? `, releaseRecord: ${JSON.stringify(overrides.record)}` : ''} });
    export default { fetch(request, env) { return policy(request, env); } };
  `;
  const bundle = await build({ stdin: { contents: source, resolveDir: ROOT, sourcefile: 'app-policy-runtime-fixture.mjs' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const calls = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'app-policy-runtime-fixture', modules: true, script: bundle.outputFiles[0].text, rootPath: ROOT,
    compatibilityDate: '2026-09-01', bindings: overrides.env ?? ENV,
    cachePersist: false, kvPersist: false, r2Persist: false, d1Persist: false, durableObjectsPersist: false,
    outboundService: async request => {
      calls.push(request.url);
      throw new Error('Policy must not make an external request.');
    },
  }));
  t.after(async () => { await mf.dispose(); assert.deepEqual(calls, []); });
  return { mf, calls };
}
const request = (mf, storefront = 'JOR', os = '26.6.1', options) => mf.dispatchFetch(
  `https://fixture.test/api/app-policy/ios?storefront=${storefront}&osVersion=${os}`, options,
);

test('actual workerd serves all four storefronts with exact response and zero outbound requests', async t => {
  const { mf, calls } = await runtime(t);
  for (const storefront of STOREFRONTS) {
    const response = await request(mf, storefront);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), EXPECTED);
    assert.deepEqual(await (await request(mf, storefront)).json(), EXPECTED);
    assert.deepEqual(await (await request(mf, storefront, '16.3.9')).json(), DISABLED);
  }
  for (const storefront of ['GBR', 'FR', 'ZZ']) assert.deepEqual(await (await request(mf, storefront)).json(), DISABLED);
  const head = await request(mf, 'JOR', '26.6.1', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await request(mf, 'JOR', '26.6.1', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.deepEqual(calls, []);
});

test('actual workerd intentionally retains an old proof without timers or network refresh', async t => {
  const { mf } = await runtime(t, { now: Date.parse('2100-01-01T00:00:00.000Z') });
  assert.deepEqual(await (await request(mf)).json(), EXPECTED);
});

test('actual workerd fails open for revoked flags, changed thresholds, invalid/future proof and unsupported country', async t => {
  const future = clone(); future.verifiedAt = '2100-01-01T00:00:00.000Z';
  const missingCountry = clone(); delete missingCountry.countries.JO;
  const wrongApp = clone(); wrongApp.appStoreId = '1';
  for (const overrides of [{ env: { ...ENV, IOS_UPDATE_POLICY_ENABLED: '0' } },
    { env: { ...ENV, IOS_MIN_SUPPORTED_BUILD: '23' } }, { env: { ...ENV, IOS_MIN_SUPPORTED_VERSION: '1.9' } },
    { record: null }, { record: {} }, { record: future }, { record: missingCountry }, { record: wrongApp }]) {
    const { mf } = await runtime(t, overrides);
    assert.deepEqual(await (await request(mf)).json(), DISABLED);
  }
});
