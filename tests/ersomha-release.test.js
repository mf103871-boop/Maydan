import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ersomhaUploadPlan, previewUploadPlan, assertPreviewIsolation, assertPreviewMetadata, assertErsomhaMigration,
  pendingErsomhaMigrations, assertErsomhaLedger, ersomhaApiClient, assertErsomhaEvidence, ersomhaPublicSmoke,
  ERSOMHA_DATABASE, ERSOMHA_PREVIEW_DATABASE, ERSOMHA_PREVIEW, ERSOMHA_PREVIEW_ORIGIN, ERSOMHA_MIGRATIONS,
  ERSOMHA_API_CHECKS, ERSOMHA_PRIVACY_CHECKS, bundleErsomhaWorker, createErsomhaJournal } from '../scripts/ersomha-release.mjs';
import { PREVIEW_LIVEKIT_PROJECT_ID, PREVIEW_LIVEKIT_HOST } from '../scripts/lib/lamma-provider-target.mjs';

const now = Date.now(), uuid = '11111111-2222-4333-8444-555555555555';
const digest = 'a'.repeat(64), provenance = { sourceCommit: 'b'.repeat(40), sourceServerTree: 'c'.repeat(40), backendTreeSha256: 'd'.repeat(64) };
const ledger = ['0001_accounts.sql', '0008_lamma.sql', '0009_online_room_trials.sql'];
const repository = [...ledger, ...ERSOMHA_MIGRATIONS];
const providerNames = ['preview capability and accepted synthetic friendships', 'direct real audio, other-device guard, and room-ending token revocation',
  'twelve accepted group members connect and receive actual audio', 'real provider join webhooks bind every participant SID',
  'blocking revokes media and old token while unrelated group members stay connected', 'voluntary provider disconnect triggers authenticated webhook departure',
  'group room end revokes remaining tokens and drains RoomService jobs'];
function provider() {
  return { passed: true, origin: ERSOMHA_PREVIEW_ORIGIN, ...provenance, finishedAt: new Date(now).toISOString(),
    checks: providerNames.map(name => ({ name, passed: true })), maximumConnectedParticipants: 12,
    previewDeploymentVersion: uuid, finishedPreviewDeploymentVersion: uuid, providerProjectId: PREVIEW_LIVEKIT_PROJECT_ID, providerHost: PREVIEW_LIVEKIT_HOST,
    cleanup: { accountsSeeded: 12, accountsDeleted: 12, callsCreated: 2, callEndRequestsAccepted: 2, providerJobsRemaining: 0, remainingUsersAndSessions: 0 } };
}
function snapshot(name = ERSOMHA_PREVIEW) {
  const preview = name === ERSOMHA_PREVIEW;
  return { versionId: uuid, latestVersionId: uuid, settings: { compatibility_date: '2026-09-01', compatibility_flags: [], observability: { enabled: true },
    bindings: [{ name: 'DB', type: 'd1', id: preview ? ERSOMHA_PREVIEW_DATABASE : ERSOMHA_DATABASE },
      ...['SESSION_SECRET', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'].map(name => ({ name, type: 'secret_text' })),
      { name: 'IOS_UPDATE_POLICY_ENABLED', type: 'plain_text', text: '0' },
      { name: 'SOCIAL_AUDIO', type: 'r2_bucket', bucket_name: preview ? 'maydan-lamma-preview-audio' : 'maydan-social-audio' },
      ...Object.entries({ ROOMS: 'Room', LIMITERS: 'RequestLimiter', SOCIAL_HUB: 'SocialHub', SOCIAL_JOBS: 'LammaJobs' }).map(([binding, className]) => ({
        name: binding, type: 'durable_object_namespace', class_name: className, namespace_id: `existing-${binding}`,
        ...(name === 'maydan-rooms' && binding === 'SOCIAL_JOBS' ? { script_name: 'maydan-game' } : {}) })),
      ...(name === 'maydan-game' ? [{ name: 'ASSETS', type: 'assets' }] : [])] },
    schedules: { schedules: name === 'maydan-rooms' ? [] : [{ cron: '* * * * *' }, { cron: '17 3 * * *' }] },
    version: { resources: { script_runtime: { migration_tag: preview ? 'v1-lamma-preview' : name === 'maydan-game' ? 'v3-lamma' : 'v1',
      ...(name === 'maydan-game' ? { assets: { not_found_handling: 'single-page-application', base_path: '/', raw_run_worker_first: ['/api', '/api/*', '/health'], raw_headers: '/*\n X-Frame-Options: DENY' } } : {}) } } } };
}
function evidence() {
  const common = { schemaVersion: 1, ...provenance, finishedAt: new Date(now).toISOString(), passed: true };
  const editorial = { bankSha256: 'e'.repeat(64), validation: { ok: true, total: 1200, independentPending: 0 },
    entries: Array.from({ length: 1200 }, (_, i) => ({ id: `concept-${i}`, independent: 'reviewed', contentSha256: digest })), physicalPlaytest: false };
  return { manifest: { ...common, kind: 'ersomha-release-evidence', previewOrigin: ERSOMHA_PREVIEW_ORIGIN, previewDeploymentVersion: uuid }, editorial,
    reports: {
      apiStorage: { ...common, kind: 'ersomha-api-storage', previewOrigin: ERSOMHA_PREVIEW_ORIGIN, previewDeploymentVersion: uuid, authenticatedPeers: 8, testedModuleSHA256: digest,
        checks: ERSOMHA_API_CHECKS.map(name => ({ name, passed: true })), cleanup: { remainingUsersAndSessions: 0, remainingRooms: 0, remainingReports: 0, remainingLeases: 0, remainingHistory: 0, verificationFailed: false } },
      performance: { ...common, scope: 'Controlled local Cloudflare workerd benchmark; no physical device claim', peers: 8, testedModuleSHA256: digest,
        physicalDeviceTrialCompleted: false, network: { injectedRoundTripMs: 120, packetLossSimulated: false }, pointBatchDelayMs: 80,
        sentBatches: 60, observedRemoteDeliveries: 420, expectedRemoteDeliveries: 420, warmupBatchesExcluded: 5, measuredRemoteDeliveries: 385,
        targetP95Ms: 250, remotePointToDeliveryMs: { p95: 215 } },
      contentPrivacy: { ...common, kind: 'ersomha-content-privacy', editorial: structuredClone(editorial), checks: ERSOMHA_PRIVACY_CHECKS.map(name => ({ name, passed: true })) },
      livekit: provider(),
    } };
}
function assertEvidence(value) { return assertErsomhaEvidence(value.manifest, value.reports, { provenance, roomsSHA256: digest, editorial: value.editorial, now }); }

test('production plans preserve the deployed Lamma bindings, DO history, cron and public asset configuration', () => {
  for (const name of ['maydan-game', 'maydan-rooms']) {
    const before = snapshot(name), plan = ersomhaUploadPlan(name, before);
    assert.equal(plan.metadata.migrations, undefined); assert.equal(plan.metadata.keep_assets, name === 'maydan-game' ? true : undefined);
    assert.deepEqual(plan.metadata.keep_bindings, ['secret_text', 'secret_key']);
    assert.ok(plan.metadata.bindings.every(binding => binding.type === 'inherit' && Object.keys(binding).length === 2));
    assert.deepEqual(plan.schedules, [...before.schedules.schedules].sort((a, b) => a.cron.localeCompare(b.cron)));
  }
  const enabled = snapshot('maydan-game'); enabled.settings.bindings.find(item => item.name === 'IOS_UPDATE_POLICY_ENABLED').text = '1';
  assert.throws(() => ersomhaUploadPlan('maydan-game', enabled));
});

test('isolated preview plan inherits all resources and secrets, and never adds migrations, assets or bindings', () => {
  const before = snapshot(), plan = previewUploadPlan(before, provider(), now);
  assert.equal(plan.metadata.main_module, 'maydan-lamma-preview.mjs');
  assert.equal(plan.metadata.migrations, undefined); assert.equal(plan.metadata.keep_assets, undefined); assert.equal(plan.metadata.assets, undefined);
  assert.deepEqual(plan.metadata.keep_bindings, ['secret_text', 'secret_key']);
  assert.deepEqual(plan.metadata.bindings.map(item => item.name).sort(), before.settings.bindings.filter(item => item.type !== 'secret_text').map(item => item.name).sort());
  assert.ok(plan.metadata.bindings.every(item => item.type === 'inherit' && Object.keys(item).length === 2));
});

test('preview isolation refuses production D1/R2/DOs/assets/LiveKit and stale or different deployment proof', () => {
  const changes = [
    value => { value.settings.bindings.find(item => item.name === 'DB').id = ERSOMHA_DATABASE; },
    value => { value.settings.bindings.push({ name: 'OTHER_DB', type: 'd1', id: ERSOMHA_DATABASE }); },
    value => { value.settings.bindings.find(item => item.name === 'SOCIAL_AUDIO').bucket_name = 'maydan-social-audio'; },
    value => { value.settings.bindings.find(item => item.name === 'SOCIAL_JOBS').script_name = 'maydan-game'; },
    value => { value.settings.bindings.push({ name: 'ASSETS', type: 'assets' }); },
    value => { value.version.resources.script_runtime.migration_tag = 'v3-lamma'; },
    value => { value.settings.bindings.find(item => item.name === 'LIVEKIT_URL').type = 'plain_text'; value.settings.bindings.find(item => item.name === 'LIVEKIT_URL').text = 'wss://maydan-gvk8joay.livekit.cloud'; },
  ];
  for (const change of changes) { const current = snapshot(); change(current); assert.throws(() => assertPreviewIsolation(current, provider(), now)); }
  for (const change of [
    proof => { proof.providerHost = 'maydan-gvk8joay.livekit.cloud'; },
    proof => { proof.providerProjectId = 'p_3de7i1u6io3'; },
    proof => { proof.previewDeploymentVersion = '99999999-2222-4333-8444-555555555555'; },
    proof => { proof.finishedAt = new Date(now - 24 * 60 * 60_000).toISOString(); },
    proof => { proof.cleanup.remainingUsersAndSessions = 1; },
  ]) { const proof = provider(); change(proof); assert.throws(() => assertPreviewIsolation(snapshot(), proof, now)); }
});

test('post-preview checks detect binding values, secret names, settings, schedules, assets and DO history drift', () => {
  const before = snapshot(); assert.doesNotThrow(() => assertPreviewMetadata(before, { ...before, versionId: 'new-reviewed' }));
  for (const change of [
    current => { current.settings.bindings.push({ name: 'NEW_SECRET', type: 'secret_text' }); },
    current => { current.settings.bindings.find(item => item.name === 'DB').id = ERSOMHA_DATABASE; },
    current => { current.settings.observability.enabled = false; },
    current => { current.schedules.schedules.push({ cron: '0 0 * * *' }); },
    current => { current.version.resources.script_runtime.migration_tag = 'new'; },
    current => { current.version.resources.script_runtime.assets = { added: true }; },
  ]) { const current = structuredClone(before); change(current); assert.throws(() => assertPreviewMetadata(before, current)); }
});

test('only exact additive Ersomha SQL is accepted and production never reapplies 0009', () => {
  for (const name of [...ERSOMHA_MIGRATIONS, '0009_online_room_trials.sql']) {
    const sql = readFileSync(new URL(`../server/migrations/${name}`, import.meta.url), 'utf8');
    assert.doesNotThrow(() => assertErsomhaMigration(name, sql));
    assert.throws(() => assertErsomhaMigration(name, sql + '\nDELETE FROM users;'));
    assert.throws(() => assertErsomhaMigration(name, sql.replace('CREATE TABLE', 'DROP TABLE')));
  }
  assert.throws(() => assertErsomhaMigration('0012_unknown.sql', 'CREATE TABLE test(id TEXT);'));
  assert.deepEqual(pendingErsomhaMigrations(ledger, repository), ERSOMHA_MIGRATIONS);
  assert.throws(() => pendingErsomhaMigrations(ledger.slice(0, 2), repository));
  assert.deepEqual(pendingErsomhaMigrations(ledger.slice(0, 2), repository, { preview: true }), ['0009_online_room_trials.sql', ...ERSOMHA_MIGRATIONS]);
  assert.throws(() => pendingErsomhaMigrations([...ledger, ERSOMHA_MIGRATIONS[0]], repository));
  assert.throws(() => pendingErsomhaMigrations(ledger, [...repository, '0012_unknown.sql']));
  assert.throws(() => pendingErsomhaMigrations([...ledger, ledger[0]], repository));
  assert.throws(() => pendingErsomhaMigrations([...ledger, '0012_unknown.sql'], repository));
  assert.deepEqual(pendingErsomhaMigrations(repository, repository, { preview: true }), []);
  assert.throws(() => pendingErsomhaMigrations(repository, repository));
  assert.throws(() => pendingErsomhaMigrations([...ledger, ERSOMHA_MIGRATIONS[0]], repository, { preview: true }));
  assert.throws(() => pendingErsomhaMigrations([...ledger.slice(0, 2), ...ERSOMHA_MIGRATIONS], repository, { preview: true }));
  assert.doesNotThrow(() => assertErsomhaLedger(repository, repository, [], { preview: true }));
  assert.doesNotThrow(() => assertErsomhaLedger(ledger, [...ledger, ...ERSOMHA_MIGRATIONS], ERSOMHA_MIGRATIONS));
  assert.throws(() => assertErsomhaLedger(ledger, [...ledger, ...ERSOMHA_MIGRATIONS, '0012_unknown.sql'], ERSOMHA_MIGRATIONS));
  assert.throws(() => assertErsomhaLedger(ledger, [...ledger, ...ERSOMHA_MIGRATIONS], ['0009_online_room_trials.sql', ...ERSOMHA_MIGRATIONS]));
});

test('API defaults to reads, scopes module writes exactly, and cannot mutate secrets, cron, database rows or resources', async () => {
  const sent = [], fetchImpl = async (url, options) => { sent.push({ url, options }); return Response.json({ success: true, result: {} }); };
  const readOnly = ersomhaApiClient('synthetic-token', { fetchImpl });
  await readOnly('/workers/scripts/maydan-lamma-preview/settings');
  assert.equal(sent[0].options.method, 'GET');
  for (const [url, options] of [
    ['/workers/scripts/maydan-game', { form: new FormData() }],
    ['/workers/scripts/maydan-game/secrets', {}],
    ['/workers/scripts/maydan-game/settings', { schedules: [] }],
    ['/workers/scripts/maydan-game/schedules', { form: new FormData() }],
    [`/d1/database/${ERSOMHA_DATABASE}/query`, { sql: 'DELETE FROM users' }],
    [`/d1/database/${ERSOMHA_DATABASE}/query`, {}],
    ['/workers/durable_objects/namespaces', {}],
    ['/r2/buckets', {}],
    [`/d1/database/${ERSOMHA_PREVIEW_DATABASE}/query`, { readMigrations: true }],
  ]) await assert.rejects(readOnly(url, options));
  const preview = ersomhaApiClient('synthetic-token', { writeScope: 'preview', databaseId: ERSOMHA_PREVIEW_DATABASE, fetchImpl });
  await preview(`/workers/scripts/${ERSOMHA_PREVIEW}`, { form: new FormData() });
  const request = sent.at(-1); assert.equal(request.options.method, 'PUT'); assert.ok(request.url.endsWith('?bindings_inherit=strict'));
  await assert.rejects(preview('/workers/scripts/maydan-game', { form: new FormData() }));
  const production = ersomhaApiClient('synthetic-token', { writeScope: 'production', fetchImpl });
  await assert.rejects(production(`/workers/scripts/${ERSOMHA_PREVIEW}`, { form: new FormData() }));
  await readOnly(`/d1/database/${ERSOMHA_DATABASE}/query`, { readMigrations: true });
  assert.deepEqual(JSON.parse(sent.at(-1).options.body), { sql: 'SELECT name FROM d1_migrations ORDER BY id', params: [] });
});

test('D1 API permits only a full schema and data export with no arbitrary option payload', async () => {
  const requests = [], api = ersomhaApiClient('synthetic-token', { databaseId: ERSOMHA_PREVIEW_DATABASE,
    fetchImpl: async (url, options) => { requests.push({ url, options }); return Response.json({ success: true, result: {} }); } });
  const exportBody = { output_format: 'polling', dump_options: { no_schema: false, no_data: false, tables: [] } };
  await api(`/d1/database/${ERSOMHA_PREVIEW_DATABASE}/export`, { exportBody }); assert.equal(requests[0].options.method, 'POST');
  for (const body of [{ ...exportBody, sql: 'DELETE FROM users' }, { ...exportBody, dump_options: { ...exportBody.dump_options, no_data: true } }])
    await assert.rejects(api(`/d1/database/${ERSOMHA_PREVIEW_DATABASE}/export`, { exportBody: body }));
  await assert.rejects(api(`/d1/database/${ERSOMHA_DATABASE}/export`, { exportBody }));
});

test('all four evidence reports must cover the same reviewed backend and exact worker module bytes', () => {
  assert.equal(assertEvidence(evidence()), true);
  const changes = [
    value => { value.manifest.sourceCommit = '0'.repeat(40); },
    value => { value.manifest.previewOrigin = 'https://maydan-game.mf103871.workers.dev'; },
    value => { value.reports.apiStorage.backendTreeSha256 = '0'.repeat(64); },
    value => { value.reports.apiStorage.testedModuleSHA256 = '0'.repeat(64); },
    value => { value.reports.performance.testedModuleSHA256 = '0'.repeat(64); },
    value => { value.reports.livekit.previewDeploymentVersion = '99999999-2222-4333-8444-555555555555'; value.reports.livekit.finishedPreviewDeploymentVersion = value.reports.livekit.previewDeploymentVersion; },
    value => { value.reports.apiStorage.checks.pop(); },
    value => { value.reports.contentPrivacy.checks[0].passed = false; },
    value => { value.reports.apiStorage.finishedAt = new Date(now + 1).toISOString(); },
    value => { value.reports.performance.finishedAt = new Date(now - 24 * 60 * 60_000).toISOString(); },
  ];
  for (const change of changes) { const value = evidence(); change(value); assert.throws(() => assertEvidence(value)); }
});

test('remote API acceptance requires eight authenticated peers and verified complete fixture cleanup', () => {
  for (const change of [
    report => { report.authenticatedPeers = 7; },
    report => { report.cleanup.remainingReports = 1; },
    report => { report.cleanup.remainingLeases = 1; },
    report => { report.cleanup.verificationFailed = true; },
    report => { delete report.cleanup.remainingHistory; },
  ]) { const value = evidence(); change(value.reports.apiStorage); assert.throws(() => assertEvidence(value)); }
});

test('performance gate preserves honest controlled local scope, all deliveries, warmup bounds and 250ms target', () => {
  for (const change of [
    report => { report.scope = 'Actual iPhone proof'; }, report => { report.physicalDeviceTrialCompleted = true; },
    report => { report.network.injectedRoundTripMs = 0; }, report => { report.pointBatchDelayMs = 120; },
    report => { report.sentBatches = 10; }, report => { report.observedRemoteDeliveries = 419; },
    report => { report.warmupBatchesExcluded = 30; }, report => { report.measuredRemoteDeliveries = 420; },
    report => { report.remotePointToDeliveryMs.p95 = 251; }, report => { report.targetP95Ms = 500; },
  ]) { const value = evidence(); change(value.reports.performance); assert.throws(() => assertEvidence(value)); }
});

test('content privacy gate requires exact current independent review of all 1200 concepts, without claiming a player trial', () => {
  for (const change of [
    value => { value.editorial.validation.independentPending = 1; value.reports.contentPrivacy.editorial = structuredClone(value.editorial); },
    value => { value.reports.contentPrivacy.editorial.bankSha256 = '0'.repeat(64); },
    value => { value.reports.contentPrivacy.editorial.entries.pop(); },
    value => { value.editorial.entries[0].independent = 'pending'; value.reports.contentPrivacy.editorial = structuredClone(value.editorial); },
    value => { value.editorial.physicalPlaytest = true; value.reports.contentPrivacy.editorial = structuredClone(value.editorial); },
  ]) { const value = evidence(); change(value); assert.throws(() => assertEvidence(value)); }
});

test('post-deployment smoke requires all three games and disabled policy on both production workers', async () => {
  const fetchImpl = async url => new URL(url).pathname === '/health'
    ? Response.json({ ok: true, accounts: true, protocol: 1, games: ['meenfina', 'fabraka', 'ersomha'] }) : Response.json({ enabled: false, minimumBuild: 0 });
  const smoke = await ersomhaPublicSmoke({ fetchImpl }); assert.equal(Object.keys(smoke).length, 2);
  const old = async url => new URL(url).pathname === '/health'
    ? Response.json({ ok: true, accounts: true, protocol: 1, games: ['meenfina', 'fabraka'] }) : fetchImpl(url);
  await assert.rejects(ersomhaPublicSmoke({ fetchImpl: old })); await ersomhaPublicSmoke({ preflight: true, fetchImpl: old });
  const enabled = async url => new URL(url).pathname === '/health' ? fetchImpl(url) : Response.json({ enabled: true, minimumBuild: 15 });
  await assert.rejects(ersomhaPublicSmoke({ fetchImpl: enabled }));
  const urls = []; await ersomhaPublicSmoke({ preview: true, fetchImpl: async url => { urls.push(url); return fetchImpl(url); } });
  assert.ok(urls.every(url => new URL(url).origin === ERSOMHA_PREVIEW_ORIGIN));
});

test('benchmark export returns the exact unminified ES2022 backend bundle and dependency digests', async () => {
  const compiled = await bundleErsomhaWorker('maydan-rooms'); assert.ok(Buffer.isBuffer(compiled.bytes));
  assert.equal(compiled.byteLength, compiled.bytes.length); assert.equal(compiled.sha256, createHash('sha256').update(compiled.bytes).digest('hex'));
  assert.ok(compiled.sourceInputs['server/worker.mjs']); assert.ok(compiled.sourceInputs['server/ersomha-content.mjs']);
  assert.equal(Object.keys(compiled.sourceInputs).some(name => name.startsWith('../')), false);
  const again = await bundleErsomhaWorker('maydan-rooms'); assert.equal(again.sha256, compiled.sha256);
  await assert.rejects(bundleErsomhaWorker('unreviewed-worker'));
});

test('an ambiguous write keeps the exclusive lock and starting journal, with no implicit retry or false completion', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ersomha-helper-test-'));
  try {
    const phase = await createErsomhaJournal(dir, { operation: 'ersomha-preview-update', planSHA256: digest });
    let attempts = 0;
    await assert.rejects(phase('backend-upload', async () => {
      attempts++;
      const beforeWrite = JSON.parse(await readFile(path.join(dir, 'ersomha-apply-progress.json'), 'utf8'));
      assert.equal(beforeWrite.phases.at(-1).state, 'starting');
      throw new Error('synthetic ambiguous timeout after send');
    }), /ambiguous timeout/);
    assert.equal(attempts, 1);
    const after = JSON.parse(await readFile(path.join(dir, 'ersomha-apply-progress.json'), 'utf8'));
    assert.deepEqual(after.phases.map(item => item.state), ['starting']);
    await assert.rejects(createErsomhaJournal(dir, { operation: 'ersomha-preview-update', planSHA256: digest }), { code: 'EEXIST' });
    assert.equal(attempts, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
