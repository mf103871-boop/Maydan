import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { activeVersion, assertLatestActive, assertLease, leaseOf, uploadPlan, assetsConfig,
  assertAssetsUnchanged, assertProviderEvidence, assertPrivateBucket, migrationConfig, apiClient, assertProvenance, assertDeployedBundle } from '../scripts/lamma-release.mjs';

function snapshot(name = 'maydan-game') {
  return { versionId: '123', latestVersionId: '123', settings: { compatibility_date: '2026-09-01', compatibility_flags: [],
    tags: ['existing'], observability: { enabled: true }, bindings: [
      { name: 'DB', type: 'd1', id: '9d863a31-6a5c-45f1-91f5-79ad400c3f6e' },
      { name: 'SESSION_SECRET', type: 'secret_text' }, { name: 'BILLING_SECRET', type: 'secret_key' },
      { name: 'PADDLE_ENV', type: 'plain_text', text: 'production' },
      { name: 'ROOMS', type: 'durable_object_namespace', class_name: 'Room', namespace_id: 'existing-namespace' },
      ...(name === 'maydan-game' ? [{ name: 'ASSETS', type: 'assets' }] : []),
    ] }, schedules: { schedules: name === 'maydan-game' ? [{ cron: '17 3 * * *' }] : [] },
    version: { resources: { script_runtime: { migration_tag: name === 'maydan-game' ? 'v2-social' : 'v1',
      ...(name === 'maydan-game' ? { assets: { not_found_handling: 'single-page-application', base_path: '/',
        raw_run_worker_first: ['/api', '/api/*', '/health'], raw_headers: '/*\n X-Frame-Options: DENY', raw_redirects: '/old /new 301' } } : {}) } } } };
}

test('rejects gradual deployments and latest-upload inheritance ambiguity', () => {
  assert.equal(activeVersion({ deployments: [{ versions: [{ version_id: 'a', percentage: 100 }] }] }), 'a');
  assert.throws(() => activeVersion({ deployments: [{ versions: [{ version_id: 'a', percentage: 50 }, { version_id: 'b', percentage: 50 }] }] }));
  assert.throws(() => assertLatestActive({ items: [{ id: 'unreleased' }] }, 'deployed'), /Latest uploaded/);
  assertLatestActive({ items: [{ id: 'deployed' }] }, 'deployed');
});

test('lease detects changed versions, schedules and provider bindings', () => {
  const a = snapshot();
  assert.equal(leaseOf(a), leaseOf(structuredClone(a)));
  for (const change of [s => { s.versionId = 'b'; }, s => { s.latestVersionId = 'unreleased'; },
    s => { s.settings.bindings[3].text = 'sandbox'; }, s => { s.schedules.schedules.push({ cron: '* * * * *' }); }]) {
    const b = structuredClone(a); change(b); assert.throws(() => assertLease(a, b), /changed since preflight/);
  }
});

test('backend-only metadata keeps assets and inherits every existing binding without secret values', () => {
  const { metadata, schedules } = uploadPlan('maydan-game', snapshot());
  assert.equal(metadata.keep_assets, true);
  assert.deepEqual(metadata.keep_bindings, ['secret_text', 'secret_key']);
  assert.deepEqual(metadata.bindings.find(b => b.name === 'PADDLE_ENV'), { name: 'PADDLE_ENV', type: 'inherit' });
  assert.deepEqual(metadata.bindings.find(b => b.name === 'ROOMS'), { name: 'ROOMS', type: 'inherit' });
  assert.equal(metadata.bindings.some(b => /SECRET/.test(b.name)), false);
  assert.deepEqual(metadata.assets.config, { base_path: '/', not_found_handling: 'single-page-application',
    run_worker_first: ['/api', '/api/*', '/health'], _headers: '/*\n X-Frame-Options: DENY', _redirects: '/old /new 301' });
  assert.deepEqual(metadata.tags, ['existing']);
  assert.deepEqual(metadata.migrations, { old_tag: 'v2-social', new_tag: 'v3-lamma', steps: [{ new_sqlite_classes: ['LammaJobs'] }] });
  assert.deepEqual(schedules, [{ cron: '17 3 * * *' }, { cron: '* * * * *' }]);
});

test('secondary worker reuses main jobs namespace and adds no cron or migration', () => {
  const plan = uploadPlan('maydan-rooms', snapshot('maydan-rooms'));
  assert.deepEqual(plan.metadata.bindings.find(b => b.name === 'SOCIAL_JOBS'), { name: 'SOCIAL_JOBS', type: 'durable_object_namespace', class_name: 'LammaJobs', script_name: 'maydan-game' });
  assert.equal(plan.metadata.migrations, undefined);
  assert.equal(plan.metadata.keep_assets, undefined);
  assert.deepEqual(plan.schedules, []);
  const existing = snapshot('maydan-rooms');
  existing.schedules.schedules.push({ cron: '17 3 * * *' });
  assert.deepEqual(uploadPlan('maydan-rooms', existing).schedules, [{ cron: '17 3 * * *' }]);
  existing.schedules.schedules.push({ cron: '* * * * *' });
  assert.throws(() => uploadPlan('maydan-rooms', existing), /minute jobs cron/);
});

test('refuses wrong database, preview bucket, unsupported migration and asset routing', () => {
  for (const change of [s => { s.settings.bindings[0].id = 'preview'; },
    s => s.settings.bindings.push({ name: 'SOCIAL_AUDIO', type: 'r2_bucket', bucket_name: 'preview' }),
    s => { s.version.resources.script_runtime.migration_tag = 'v9'; },
    s => { s.version.resources.script_runtime.assets.raw_run_worker_first = ['/health']; }]) {
    const s = snapshot(); change(s); assert.throws(() => uploadPlan('maydan-game', s));
  }
  assert.throws(() => assetsConfig({}));
});

test('asset verification catches byte, reference and security-header drift', () => {
  const manifest = { paths: ['/'], entries: [{ path: '/', sha256: 'abc', headers: { 'x-frame-options': 'DENY' } }] };
  assertAssetsUnchanged(manifest, structuredClone(manifest));
  for (const change of [s => { s.entries[0].sha256 = 'def'; }, s => s.paths.push('/new'), s => { s.entries[0].headers['x-frame-options'] = null; }]) {
    const changed = structuredClone(manifest); change(changed); assert.throws(() => assertAssetsUnchanged(manifest, changed));
  }
});

function evidence() {
  return { origin: 'https://maydan-lamma-preview.mf103871.workers.dev', passed: true, finishedAt: new Date().toISOString(), maximumConnectedParticipants: 12,
    sourceCommit: 'a'.repeat(40), sourceServerTree: 'b'.repeat(40), backendTreeSha256: 'c'.repeat(64), previewDeploymentVersion: '12345678-1234-1234-1234-123456789abc',
    checks: [
      'preview capability and accepted synthetic friendships', 'direct real audio, other-device guard, and room-ending token revocation',
      'twelve accepted group members connect and receive actual audio', 'real provider join webhooks bind every participant SID',
      'blocking revokes media and old token while unrelated group members stay connected', 'voluntary provider disconnect triggers authenticated webhook departure',
      'group room end revokes remaining tokens and drains RoomService jobs',
    ].map(name => ({ name, passed: true })), cleanup: { providerJobsRemaining: 0, remainingUsersAndSessions: 0, accountsSeeded: 12, accountsDeleted: 12, callsCreated: 2, callEndRequestsAccepted: 2 } };
}

test('evidence requires real media, revocation, fresh timestamps and complete cleanup', () => {
  assertProviderEvidence(evidence());
  for (const change of [s => { s.passed = false; }, s => { s.preflightOnly = true; }, s => s.checks.pop(),
    s => { s.maximumConnectedParticipants = 2; }, s => { s.cleanup.providerJobsRemaining = 1; },
    s => { delete s.cleanup.remainingUsersAndSessions; }, s => { s.finishedAt = '2020-01-01T00:00:00Z'; }]) {
    const s = evidence(); change(s); assert.throws(() => assertProviderEvidence(s));
  }
});

test('provider provenance allows documentation commits but rejects different server trees or bytes', () => {
  const reviewed = evidence(), docs = { ...reviewed, sourceCommit: 'd'.repeat(40) };
  assertProvenance(reviewed, docs, reviewed);
  assert.throws(() => assertProvenance(reviewed, { ...docs, backendTreeSha256: 'e'.repeat(64) }, reviewed));
  assert.throws(() => assertProvenance(reviewed, docs, { ...reviewed, sourceServerTree: 'f'.repeat(40) }));
});

test('deployed module verification rejects a different or missing worker bundle', async () => {
  const bytes = Buffer.from('export default { fetch() { return new Response("ok") } };');
  const form = new FormData(); form.set('maydan-game.mjs', new File([bytes], 'maydan-game.mjs', { type: 'application/javascript+module' }));
  const response = new Response(form);
  const script = { contentType: response.headers.get('content-type'), base64: Buffer.from(await response.arrayBuffer()).toString('base64') };
  const digest = createHash('sha256').update(bytes).digest('hex');
  await assertDeployedBundle(script, 'maydan-game', digest);
  await assert.rejects(assertDeployedBundle(script, 'maydan-game', '0'.repeat(64)), /differs from the reviewed bundle/);
  await assert.rejects(assertDeployedBundle(script, 'maydan-rooms', digest), /missing from the live worker/);
});

test('requires private R2 and a fixed migration destination without build hooks', () => {
  assertPrivateBucket({ enabled: false }, { domains: [] });
  assert.throws(() => assertPrivateBucket({ enabled: true }, { domains: [] }));
  assert.throws(() => assertPrivateBucket({ enabled: false }, { domains: [{ enabled: true }] }));
  const config = migrationConfig();
  assert.equal(config.d1_databases[0].database_id, '9d863a31-6a5c-45f1-91f5-79ad400c3f6e');
  assert.equal(config.build, undefined);
  assert.equal(config.assets, undefined);
});

test('API client defaults to read-only and rejects off-target paths before sending', async () => {
  const api = apiClient('synthetic-token');
  await assert.rejects(api('/workers/scripts/maydan-game', { form: new FormData() }), /Read-only/);
  await assert.rejects(api('/workers/scripts/maydan-game/schedules', { schedules: [] }), /Read-only/);
  await assert.rejects(api('/workers/scripts/other'), /Unapproved/);
  await assert.rejects(api('/d1/database/other/export', { exportBody: {} }), /Unapproved/);
});

test('explicit apply upload uses strict inherit and migration reads cannot accept arbitrary SQL', async t => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { seen.push({ url, options }); return Response.json({ success: true, result: {} }); });
  await apiClient('synthetic', true)('/workers/scripts/maydan-game', { form: new FormData() });
  assert.ok(seen[0].url.endsWith('?bindings_inherit=strict'));
  assert.equal(seen[0].options.method, 'PUT');
  await apiClient('synthetic')('/d1/database/9d863a31-6a5c-45f1-91f5-79ad400c3f6e/query', { readMigrations: true });
  assert.deepEqual(JSON.parse(seen[1].options.body), { sql: 'SELECT name FROM d1_migrations ORDER BY id', params: [] });
});
