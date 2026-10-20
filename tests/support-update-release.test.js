import test from 'node:test';
import assert from 'node:assert/strict';
import { supportUpdateUploadPlan, assertSupportUpdateDeployment, verifyPublic18Release, snapshotMainModule, supportUpdateApiClient, uploadedVersionHint } from '../scripts/ios/support-update-release.mjs';

const TOKEN = 'fixture.token.signature';
const releaseId = '11111111-1111-4111-8111-111111111111';
const buildId = '093728e9-5d77-4d9f-8725-5e1c4de8c5f9';
const flags = ['IOS_UPDATE_POLICY_ENABLED', 'IOS_MIN_SUPPORTED_VERSION', 'IOS_MIN_SUPPORTED_BUILD'];
function snapshot() {
  return { versionId: 'old', latestVersionId: 'old', settings: { compatibility_date: '2026-09-01', compatibility_flags: [], observability: { enabled: true }, tags: ['retained'], bindings: [
    { name: 'DB', type: 'd1', id: '9d863a31-6a5c-45f1-91f5-79ad400c3f6e' }, { name: 'SESSION_SECRET', type: 'secret_text' },
    { name: 'LIVEKIT_API_SECRET', type: 'secret_text' }, { name: 'PROVIDER_KEY', type: 'secret_key' }, { name: 'ASSETS', type: 'assets' },
    { name: 'SOCIAL_AUDIO', type: 'r2_bucket', bucket_name: 'maydan-social-audio' },
    { name: 'SOCIAL_JOBS', type: 'durable_object_namespace', class_name: 'LammaJobs', namespace_id: 'existing' },
    { name: 'DESIGN_PUBLISH_ENABLED', type: 'plain_text', text: '0' },
    { name: 'DESIGN_EDITOR_USER_IDS', type: 'plain_text', text: 'fixture-owner' },
    { name: 'DESIGN_STUDIO_RELEASE', type: 'plain_text', text: 'studio-20261019-9217f768' },
    { name: 'PADDLE_ENV', type: 'plain_text', text: 'production' },
  ] }, schedules: { schedules: [{ cron: '* * * * *' }, { cron: '17 3 * * *' }] }, version: { resources: { script_runtime: {
    migration_tag: 'v3-lamma', assets: { base_path: '/', not_found_handling: 'single-page-application', raw_run_worker_first: ['/api', '/api/*', '/health'], raw_headers: '/*\n X-Frame-Options: DENY', raw_redirects: '/old /new 301' },
  } } } };
}
function after(before, plan) {
  const value = structuredClone(before); value.versionId = value.latestVersionId = 'new';
  value.settings.bindings = value.settings.bindings.filter(item => !Object.hasOwn(plan.changes, item.name));
  for (const [name, text] of Object.entries(plan.changes)) value.settings.bindings.push({ name, type: 'plain_text', text });
  return value;
}
function official() {
  return { data: [{ type: 'appStoreVersions', id: releaseId, attributes: { versionString: '1.8', platform: 'IOS', appStoreState: 'READY_FOR_SALE', appVersionState: 'READY_FOR_DISTRIBUTION', downloadable: true }, relationships: { build: { data: { type: 'builds', id: buildId } } } }], links: {} };
}
function selectedBuild() { return { data: { type: 'builds', id: buildId, attributes: { version: '22', processingState: 'VALID', expired: false } } }; }
function listed(country) { return { resultCount: 1, results: [{ trackId: 6808385717, bundleId: 'Maydan', version: '1.8', kind: 'software', wrapperType: 'software', minimumOsVersion: '16.4', trackViewUrl: `https://apps.apple.com/${country}/app/maydan/id6808385717?uo=4` }] }; }
function service(change = () => {}) {
  const calls = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input); calls.push({ url, options });
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.ok(options.signal); assert.equal(options.body, undefined);
    let body;
    if (url.hostname === 'api.appstoreconnect.apple.com') {
      assert.equal(options.headers.authorization, `Bearer ${TOKEN}`);
      if (url.pathname === '/v1/apps/6808385717/appStoreVersions') { assert.equal(url.searchParams.get('filter[versionString]'), '1.8'); assert.equal(url.searchParams.get('filter[platform]'), 'IOS'); body = official(); }
      else { assert.equal(url.pathname, `/v1/appStoreVersions/${releaseId}/build`); body = selectedBuild(); }
    } else {
      assert.equal(url.hostname, 'itunes.apple.com'); assert.equal(url.pathname, '/lookup'); assert.equal(url.searchParams.get('id'), '6808385717');
      assert.deepEqual(options.headers, { accept: 'application/json' }); body = listed(url.searchParams.get('country'));
    }
    const response = change(body, url, calls.length);
    return response || Response.json(body);
  };
  return { fetchImpl, calls };
}

test('support deployment inherits every resource and secret without enabling policy', () => {
  const before = snapshot(), original = structuredClone(before), plan = supportUpdateUploadPlan(before, 'support');
  assert.deepEqual(before, original); assert.deepEqual(plan.changes, {});
  assert.equal(plan.metadata.keep_assets, true); assert.equal(plan.metadata.migrations, undefined); assert.equal(plan.schedules, undefined);
  assert.deepEqual(plan.metadata.keep_bindings, ['secret_text', 'secret_key']);
  assert.ok(plan.metadata.bindings.every(item => item.type === 'inherit'));
  assert.equal(plan.metadata.bindings.some(item => item.name.includes('SECRET')), false);
  assert.deepEqual(plan.metadata.assets.config.run_worker_first, ['/api', '/api/*', '/health']);
  assertSupportUpdateDeployment(before, after(before, plan), plan, 'support');
});

test('activation changes exactly the three fixed version22 variables and rollback changes only enabled flag', () => {
  const before = snapshot(), plan = supportUpdateUploadPlan(before, 'enable');
  assert.deepEqual(plan.changes, { IOS_UPDATE_POLICY_ENABLED: '1', IOS_MIN_SUPPORTED_VERSION: '1.8', IOS_MIN_SUPPORTED_BUILD: '22' });
  assert.deepEqual(plan.metadata.bindings.filter(item => item.type !== 'inherit'), flags.map(name => ({ name, type: 'plain_text', text: plan.changes[name] })));
  const enabled = after(before, plan); assertSupportUpdateDeployment(before, enabled, plan, 'enable');
  const disable = supportUpdateUploadPlan(enabled, 'disable'); assert.deepEqual(disable.changes, { IOS_UPDATE_POLICY_ENABLED: '0' });
  assertSupportUpdateDeployment(enabled, after(enabled, disable), disable, 'disable');
  assert.deepEqual(after(enabled, disable).settings.bindings.filter(item => flags.slice(1).includes(item.name)), enabled.settings.bindings.filter(item => flags.slice(1).includes(item.name)));
});

test('planning rejects unexpected resources, secret policy settings, missing private owner and open Studio publication', () => {
  const mutations = [
    value => { value.version.resources.script_runtime.migration_tag = 'v2-social'; },
    value => { value.settings.bindings = value.settings.bindings.filter(item => item.name !== 'SOCIAL_JOBS'); },
    value => { value.settings.bindings.find(item => item.name === 'SOCIAL_AUDIO').bucket_name = 'preview'; },
    value => { value.settings.bindings.find(item => item.name === 'DB').id = 'other'; },
    value => { value.settings.bindings.find(item => item.name === 'DESIGN_PUBLISH_ENABLED').text = '1'; },
    value => { value.settings.bindings.find(item => item.name === 'DESIGN_EDITOR_USER_IDS').text = ''; },
    value => { value.settings.bindings.push({ name: flags[0], type: 'secret_text' }); },
    value => { value.settings.bindings.push({ name: flags[0], type: 'plain_text', text: '1' }); },
    value => { value.schedules.schedules = [{ cron: '17 3 * * *' }]; },
  ];
  for (const mutation of mutations) { const value = snapshot(); mutation(value); assert.throws(() => supportUpdateUploadPlan(value, 'support')); }
});

test('post-deployment checks reject owner, Studio gate, secrets, policy, asset, runtime and cron drift', () => {
  const before = snapshot(), plan = supportUpdateUploadPlan(before, 'enable');
  for (const mutate of [
    value => { value.settings.bindings.find(item => item.name === 'DESIGN_EDITOR_USER_IDS').text = 'another-owner'; },
    value => { value.settings.bindings.find(item => item.name === 'DESIGN_PUBLISH_ENABLED').text = '1'; },
    value => { value.settings.bindings.find(item => item.name === 'LIVEKIT_API_SECRET').type = 'plain_text'; },
    value => { value.settings.bindings.find(item => item.name === 'PADDLE_ENV').text = 'sandbox'; },
    value => { value.settings.bindings.find(item => item.name === flags[2]).text = '23'; },
    value => { value.settings.bindings.push({ name: 'EXTRA', type: 'plain_text', text: 'x' }); },
    value => { value.settings.compatibility_flags.push('new-flag'); },
    value => { value.schedules.schedules.pop(); },
    value => { value.version.resources.script_runtime.migration_tag = 'v4'; },
    value => { value.version.resources.script_runtime.assets.raw_headers += '\n New: value'; },
    value => { value.version.resources.script_runtime.assets.raw_run_worker_first.push('/*'); },
  ]) { const value = after(before, plan); mutate(value); assert.throws(() => assertSupportUpdateDeployment(before, value, plan, 'enable')); }
});

test('activation proves exact official public selected build and all four country listings with no credential forwarding', async () => {
  const fake = service(); const now = 1_800_000_000_000;
  const evidence = await verifyPublic18Release({ ...fake, token: TOKEN, now: () => now });
  assert.equal(evidence.verifiedAt, new Date(now).toISOString()); assert.equal(evidence.officialPublic, true);
  assert.equal(evidence.version, '1.8'); assert.equal(evidence.build, '22'); assert.equal(evidence.buildId, buildId);
  assert.deepEqual(evidence.countries.map(item => item.country), ['JO', 'SA', 'AE', 'US']);
  assert.equal(fake.calls.length, 6); assert.equal(JSON.stringify(evidence).includes(TOKEN), false);
});

test('no activation evidence is accepted without an official read token', async () => {
  for (const token of ['', 'not-a-jwt', null]) {
    const fake = service(); await assert.rejects(() => verifyPublic18Release({ ...fake, token }), /token is required/); assert.equal(fake.calls.length, 0);
  }
});

test('TestFlight, approval pending release, wrong selected build and expired binaries cannot enable policy', async () => {
  for (const mutate of [
    body => { body.data[0].attributes.appStoreState = 'PENDING_DEVELOPER_RELEASE'; body.data[0].attributes.appVersionState = 'PENDING_DEVELOPER_RELEASE'; },
    body => { body.data[0].attributes.appVersionState = 'WAITING_FOR_REVIEW'; },
    body => { body.data[0].attributes.downloadable = false; },
    body => { body.data[0].attributes.versionString = '1.7.1'; },
    body => { body.data[0].attributes.platform = 'MAC_OS'; },
    body => { body.data.push(structuredClone(body.data[0])); },
    body => { body.links.next = 'https://api.appstoreconnect.apple.com/next'; },
  ]) { const fake = service((body, url) => { if (url.pathname.endsWith('/appStoreVersions')) mutate(body); }); await assert.rejects(() => verifyPublic18Release({ ...fake, token: TOKEN })); assert.equal(fake.calls.length, 1); }
  for (const mutate of [
    body => { body.data.attributes.version = '21'; }, body => { body.data.attributes.processingState = 'PROCESSING'; },
    body => { body.data.attributes.expired = true; }, body => { body.data.id = releaseId; },
  ]) { const fake = service((body, url) => { if (url.pathname.endsWith('/build')) mutate(body); }); await assert.rejects(() => verifyPublic18Release({ ...fake, token: TOKEN })); assert.equal(fake.calls.length, 2); }
});

test('any missing, stale, foreign-country or unexpected Apple listing aborts activation', async () => {
  for (const change of [
    body => { body.results[0].version = '1.7.1'; }, body => { body.results[0].version = '1.9'; },
    body => { body.resultCount = 0; body.results = []; }, body => { body.results[0].bundleId = 'Other'; },
    body => { body.results[0].trackId = 1; }, body => { body.results[0].trackViewUrl = 'https://apps.apple.com/us/app/id6808385717'; },
    body => { body.results[0].trackViewUrl = 'https://attacker.test/jo/app/id6808385717'; },
    body => { body.results[0].minimumOsVersion = ''; }, body => { body.results.push(body.results[0]); },
  ]) { const fake = service((body, url) => { if (url.hostname === 'itunes.apple.com') change(body); }); await assert.rejects(() => verifyPublic18Release({ ...fake, token: TOKEN })); assert.equal(fake.calls.length, 3); }
  for (const country of ['sa', 'ae', 'us']) { const fake = service((body, url) => { if (url.searchParams.get('country') === country) body.resultCount = 0; }); await assert.rejects(() => verifyPublic18Release({ ...fake, token: TOKEN })); }
});

test('Apple transport and invalid JSON failures stop verification without accepting saved evidence', async () => {
  for (const result of [() => new Response(null, { status: 503 }), () => new Response('not-json'), () => { throw new Error('fixture network'); }]) {
    let calls = 0; await assert.rejects(() => verifyPublic18Release({ token: TOKEN, fetchImpl: async () => { calls++; return result(); } })); assert.equal(calls, 1);
  }
});

test('approved exact build resource is required even when the release omits build linkage data', async () => {
  const valid = service((body, url) => { if (url.pathname.endsWith('/appStoreVersions')) delete body.data[0].relationships; });
  assert.equal((await verifyPublic18Release({ ...valid, token: TOKEN })).buildId, buildId);
  const changed = service((body, url) => {
    if (url.pathname.endsWith('/appStoreVersions')) delete body.data[0].relationships;
    if (url.pathname.endsWith('/build')) body.data.id = '22222222-2222-4222-8222-222222222222';
  });
  await assert.rejects(() => verifyPublic18Release({ ...changed, token: TOKEN }), /independently approved native build22/);
  assert.equal(changed.calls.length, 2);
});

test('upload reply script name and deployment ID never masquerade as an active Worker version', () => {
  const deploymentId = '33333333-3333-4333-8333-333333333333';
  assert.equal(uploadedVersionHint({ id: 'maydan-game', deployment_id: deploymentId }), null);
  assert.equal(uploadedVersionHint({ id: deploymentId }), null);
  assert.equal(uploadedVersionHint({ deployment_id: deploymentId }), null);
  assert.equal(uploadedVersionHint({ id: 'maydan-game', version_id: 'not-a-version' }), null);
  assert.equal(uploadedVersionHint({ id: 'maydan-game', version_id: deploymentId }), deploymentId);
  assert.equal(uploadedVersionHint({}), null);
});

test('flag-only module extraction preserves exact UTF8 bytes and refuses silently dropped auxiliary modules', async () => {
  const original = Buffer.from('export default { fetch(){ return new Response("ميدان"); } };\n');
  const data = new FormData(); data.set('maydan-game.mjs', new File([original], 'maydan-game.mjs'));
  const response = new Response(data); const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(await snapshotMainModule({ script: { contentType: response.headers.get('content-type'), base64: bytes.toString('base64') } }), original);
  data.set('extra.wasm', new File([Buffer.from([0,1,2])], 'extra.wasm'));
  const unsafe = new Response(data); const unsafeBytes = Buffer.from(await unsafe.arrayBuffer());
  await assert.rejects(() => snapshotMainModule({ script: { contentType: unsafe.headers.get('content-type'), base64: unsafeBytes.toString('base64') } }), /extra Worker module/);
});

test('operator transport permits reads but refuses database, room, provider, cron and unreviewed write operations', async () => {
  const calls = [], baseApi = async (...args) => { calls.push(args); return { fixture: true }; };
  const readOnly = supportUpdateApiClient('fixture-only', { baseApi });
  await readOnly('/workers/scripts/maydan-game/settings'); await readOnly('/workers/scripts/maydan-rooms/deployments');
  assert.equal(calls.length, 2);
  for (const [suffix, options] of [
    ['/workers/scripts/maydan-game', { form: new FormData() }],
    ['/workers/scripts/maydan-game/schedules', { schedules: [] }],
    ['/workers/scripts/maydan-game/settings', { form: new FormData() }],
    ['/workers/scripts/maydan-game', { exportBody: {} }],
    ['/d1/database/fixed/query', { readMigrations: true }],
    ['/r2/buckets/maydan-social-audio', {}], ['/workers/scripts/another/settings', {}],
  ]) assert.throws(() => readOnly(suffix, options));
  assert.equal(calls.length, 2);
  const writable = supportUpdateApiClient('fixture-only', { allowApply: true, baseApi });
  assert.throws(() => writable('/workers/scripts/maydan-rooms', { form: new FormData() }));
  assert.throws(() => writable('/workers/scripts/maydan-game/settings', { form: new FormData() }));
  await writable('/workers/scripts/maydan-game', { form: new FormData() }); assert.equal(calls.length, 3);
});
