// Backend-only Ersomha release. No resource provisioning, secret writes, cron
// updates, public UI deployment or automatic retries after an ambiguous write.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { snapshotWorker, assertLease, savePrivate, loadPrivate, publicManifest, assertAssetsUnchanged,
  assertDeployedBundle, migrationConfig, assertProviderEvidence, assertProvenance, activeVersion, assertPrivateBucket, leaseOf } from './lamma-release.mjs';
import { socialUpdatePlan, assertSocialUpdateMetadata, assertFreshBackup, assertOnlineTrialMigration } from './lamma-social-update.mjs';
import { getBackendProvenance } from './lib/lamma-provenance.mjs';
import { PREVIEW_LIVEKIT_PROJECT_ID, PREVIEW_LIVEKIT_HOST } from './lib/lamma-provider-target.mjs';
import { ersomhaReviewReport } from './ersomha-content.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ACCOUNT = '3fa113e56f10150f13618f641b9fe98e';
export const ERSOMHA_DATABASE = '9d863a31-6a5c-45f1-91f5-79ad400c3f6e';
export const ERSOMHA_PREVIEW_DATABASE = '346a7165-9989-4fe2-a5a3-aec017a2d21b';
export const ERSOMHA_PREVIEW = 'maydan-lamma-preview';
export const ERSOMHA_PREVIEW_ORIGIN = `https://${ERSOMHA_PREVIEW}.mf103871.workers.dev`;
export const ERSOMHA_MIGRATIONS = ['0010_ersomha.sql', '0011_ersomha_reports.sql'];
const TRIAL_MIGRATION = '0009_online_room_trials.sql';
const WORKERS = ['maydan-game', 'maydan-rooms'];
const PRIVATE = path.join(homedir(), '.codex', 'private', 'maydan-lamma-release');
const SETTINGS = ['compatibility_date', 'compatibility_flags', 'placement', 'logpush', 'observability', 'tail_consumers', 'tags', 'limits'];
const HELPER_PATHS = ['scripts/ersomha-release.mjs', 'scripts/ersomha-content.mjs', 'scripts/lamma-release.mjs',
  'scripts/lamma-social-update.mjs', 'scripts/lib/lamma-provenance.mjs', 'scripts/lib/lamma-provider-target.mjs'];
export const ERSOMHA_API_CHECKS = ['eight-authenticated-peers', 'two-player-cooperative', 'three-to-eight-competitive',
  'server-only-choices', 'history-no-repeat', 'concurrent-account-lock', 'history-exhaustion-safe',
  'stale-lease-fencing', 'private-drawing-reports', 'account-and-report-cleanup'];
export const ERSOMHA_PRIVACY_CHECKS = ['independent-1200-concepts', 'private-bank-not-in-browser-bundle',
  'secret-choices-and-answer-not-broadcast', 'report-evidence-authorized-only', 'report-retention-and-account-deletion', 'drawing-microphone-privacy'];
const execute = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const cron = snapshot => (snapshot.schedules.schedules || []).map(({ cron: value }) => ({ cron: value })).sort((a, b) => a.cron.localeCompare(b.cron));
const targets = preview => preview ? [ERSOMHA_PREVIEW] : WORKERS;
const dbOf = preview => preview ? ERSOMHA_PREVIEW_DATABASE : ERSOMHA_DATABASE;
const operation = preview => preview ? 'ersomha-preview-update' : 'ersomha-backend-update';
const sqlNormalize = sql => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();

// Exported for benchmark and preview tooling: exactly the bytes shipped later.
export async function bundleErsomhaWorker(name) {
  assert.ok(WORKERS.includes(name), 'Only the two reviewed backend entry points may be bundled.');
  const compiled = await build({ entryPoints: [path.join(ROOT, 'server', name === 'maydan-game' ? 'full-worker.mjs' : 'worker.mjs')],
    absWorkingDir: ROOT, bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022',
    minify: false, sourcemap: false, logLevel: 'silent' });
  assert.equal(compiled.outputFiles.length, 1);
  const bytes = Buffer.from(compiled.outputFiles[0].contents), sourceInputs = {};
  for (const filename of Object.keys(compiled.metafile.inputs)) {
    const relative = path.relative(ROOT, path.resolve(ROOT, filename)).split(path.sep).join('/');
    assert.ok(!relative.startsWith('../') && !path.isAbsolute(relative), 'Backend dependency outside repository.');
    sourceInputs[relative] = hash(await readFile(path.join(ROOT, relative)));
  }
  return { bytes, sha256: hash(bytes), byteLength: bytes.length, sourceInputs };
}

export function ersomhaUploadPlan(name, snapshot) {
  const plan = socialUpdatePlan(name, snapshot);
  plan.metadata.annotations = { 'workers/message': 'Ersomha backend only; retain all existing public assets and resources' };
  return plan;
}

export function assertPreviewIsolation(snapshot, providerProof, now = Date.now()) {
  const bindings = snapshot.settings.bindings;
  const db = bindings.find(item => item.name === 'DB');
  assert.equal(db?.id || db?.database_id, ERSOMHA_PREVIEW_DATABASE, 'Exact isolated preview D1 required; production D1 is forbidden.');
  assert.ok(!bindings.some(item => item.type === 'd1' && (item.id || item.database_id) !== ERSOMHA_PREVIEW_DATABASE), 'Foreign D1 binding in preview.');
  assert.equal(bindings.find(item => item.name === 'SOCIAL_AUDIO')?.bucket_name, 'maydan-lamma-preview-audio', 'Exact isolated preview audio bucket required.');
  assert.ok(!bindings.some(item => item.type === 'r2_bucket' && item.bucket_name !== 'maydan-lamma-preview-audio'), 'Foreign R2 binding in preview.');
  assert.ok(!bindings.some(item => item.type === 'assets'), 'Preview must not inherit production public assets.');
  for (const [name, className] of Object.entries({ ROOMS: 'Room', LIMITERS: 'RequestLimiter', SOCIAL_HUB: 'SocialHub', SOCIAL_JOBS: 'LammaJobs' })) {
    const binding = bindings.find(item => item.name === name);
    assert.equal(binding?.type, 'durable_object_namespace'); assert.equal(binding.class_name, className);
    assert.equal(binding.script_name || ERSOMHA_PREVIEW, ERSOMHA_PREVIEW, 'Preview must own every Durable Object binding.');
  }
  assert.ok(bindings.filter(item => item.type === 'durable_object_namespace').every(item => !item.script_name || item.script_name === ERSOMHA_PREVIEW), 'Cross-script preview DO forbidden.');
  assert.equal(snapshot.version.resources.script_runtime.migration_tag, 'v1-lamma-preview', 'Do not guess isolated preview DO history.');
  for (const name of ['SESSION_SECRET', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) assert.ok(bindings.some(item => item.name === name), `Existing preview ${name} required; this tool never provisions secrets.`);
  const url = bindings.find(item => item.name === 'LIVEKIT_URL');
  if (url.type === 'plain_text') assert.equal(new URL(url.text).hostname, PREVIEW_LIVEKIT_HOST, 'Production LiveKit forbidden in preview.');
  assertTestLabProof(providerProof, now);
  assert.equal(providerProof.previewDeploymentVersion, snapshot.versionId, 'Isolation proof must identify the currently deployed preview.');
  assert.notEqual(bindings.find(item => item.name === 'IOS_UPDATE_POLICY_ENABLED')?.text, '1');
}

export function previewUploadPlan(snapshot, providerProof, now = Date.now()) {
  assertPreviewIsolation(snapshot, providerProof, now);
  const metadata = { main_module: `${ERSOMHA_PREVIEW}.mjs`, keep_bindings: ['secret_text', 'secret_key'],
    bindings: snapshot.settings.bindings.filter(item => !['secret_text', 'secret_key'].includes(item.type)).map(item => ({ name: item.name, type: 'inherit' })),
    compatibility_date: snapshot.settings.compatibility_date, compatibility_flags: snapshot.settings.compatibility_flags || [],
    annotations: { 'workers/message': 'Isolated Ersomha preview; inherit existing synthetic-only resources' } };
  for (const key of SETTINGS.filter(key => !['compatibility_date', 'compatibility_flags'].includes(key))) if (snapshot.settings[key] !== undefined) metadata[key] = snapshot.settings[key];
  return { metadata, schedules: cron(snapshot), lease: leaseOf(snapshot) };
}

export function assertPreviewMetadata(before, current) {
  const bindings = value => [...value.settings.bindings].sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(bindings(current), bindings(before), 'Preview binding or inherited secret names changed.');
  for (const key of SETTINGS) assert.deepEqual(current.settings[key], before.settings[key], `Preview setting changed: ${key}`);
  assert.deepEqual(cron(current), cron(before), 'Preview cron changed.');
  assert.equal(current.version.resources.script_runtime.migration_tag, before.version.resources.script_runtime.migration_tag, 'Preview DO history changed.');
  assert.deepEqual(current.version.resources.script_runtime.assets, before.version.resources.script_runtime.assets, 'Preview asset configuration changed.');
}

export function assertErsomhaMigration(name, sql) {
  if (name === TRIAL_MIGRATION) { assertOnlineTrialMigration(sql); return; }
  const expected = {
    '0010_ersomha.sql': 'CREATE TABLE IF NOT EXISTS ersomha_leases (account_hash TEXT PRIMARY KEY, room_key TEXT NOT NULL, lease_token TEXT NOT NULL, fence INTEGER NOT NULL DEFAULT 1, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS ersomha_leases_expiry ON ersomha_leases(expires_at); CREATE TABLE IF NOT EXISTS ersomha_seen (account_hash TEXT NOT NULL, family_id TEXT NOT NULL, concept_id TEXT NOT NULL, exposure_id TEXT NOT NULL, seen_at INTEGER NOT NULL, seen_count INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(account_hash,family_id)); CREATE INDEX IF NOT EXISTS ersomha_seen_concept ON ersomha_seen(account_hash,concept_id); CREATE INDEX IF NOT EXISTS ersomha_seen_exposure ON ersomha_seen(exposure_id);',
    '0011_ersomha_reports.sql': 'CREATE TABLE IF NOT EXISTS ersomha_drawing_reports ( report_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, reporter_id TEXT NOT NULL, reported_id TEXT NOT NULL, room_code TEXT NOT NULL, match_id TEXT NOT NULL, turn INTEGER NOT NULL, evidence_json TEXT NOT NULL, created_at INTEGER NOT NULL ); CREATE INDEX IF NOT EXISTS ersomha_drawing_reports_users ON ersomha_drawing_reports(reporter_id, reported_id); CREATE INDEX IF NOT EXISTS ersomha_drawing_reports_created ON ersomha_drawing_reports(created_at);',
  };
  assert.ok(Object.hasOwn(expected, name), 'Unreviewed migration is forbidden.');
  assert.equal(sqlNormalize(sql), expected[name], 'Only the reviewed additive Ersomha table/index definitions are authorized.');
}

export function pendingErsomhaMigrations(ledger, repositoryMigrations, { preview = false } = {}) {
  assert.equal(new Set(ledger).size, ledger.length, 'Duplicate migration ledger entries.');
  assert.ok(ledger.every(name => repositoryMigrations.includes(name)), 'Unknown deployed migration; reconcile schema before this release.');
  assert.ok(ledger.includes('0008_lamma.sql'), 'Existing Lamma schema required.');
  if (!preview) assert.ok(ledger.includes(TRIAL_MIGRATION), 'Production 0009 must already be deployed; never repeat it.');
  const pending = repositoryMigrations.filter(name => !ledger.includes(name)).sort();
  if (preview && ERSOMHA_MIGRATIONS.every(name => ledger.includes(name))) {
    assert.ok(ledger.includes(TRIAL_MIGRATION), 'Preview Ersomha schema without 0009 requires explicit reconciliation.');
    assert.deepEqual(pending, [], 'Already migrated preview cannot add another unreviewed migration.');
    return pending;
  }
  const allowed = [...(preview && !ledger.includes(TRIAL_MIGRATION) ? [TRIAL_MIGRATION] : []), ...ERSOMHA_MIGRATIONS];
  assert.deepEqual(pending, allowed, 'Reconcile unexpected or partially applied migrations; no blind retry.');
  return pending;
}

export function assertErsomhaLedger(before, after, pending, { preview = false } = {}) {
  const alreadyMigratedPreview = preview && before.includes(TRIAL_MIGRATION) && ERSOMHA_MIGRATIONS.every(name => before.includes(name));
  assert.deepEqual(pending, alreadyMigratedPreview ? [] : [...(preview && !before.includes(TRIAL_MIGRATION) ? [TRIAL_MIGRATION] : []), ...ERSOMHA_MIGRATIONS]);
  assert.deepEqual(after, [...before, ...pending], 'Only the exact reviewed additive ledger entries may be added.');
}

// A narrower API wrapper than Wrangler deploy: only module PUTs can mutate a
// Worker, no namespace/secret/bucket/settings/schedules writes exist here.
export function ersomhaApiClient(token, { writeScope = null, databaseId = ERSOMHA_DATABASE, fetchImpl = fetch } = {}) {
  assert.ok([null, 'production', 'preview'].includes(writeScope));
  assert.ok([ERSOMHA_DATABASE, ERSOMHA_PREVIEW_DATABASE].includes(databaseId));
  return async (suffix, options = {}) => {
    const { exportBody, readMigrations = false, form, raw = false } = options;
    assert.ok(Object.keys(options).every(key => ['exportBody', 'readMigrations', 'form', 'raw'].includes(key)), 'Unknown API option; arbitrary writes forbidden.');
    assert.ok(/^\/workers\/scripts\/(maydan-game|maydan-rooms|maydan-lamma-preview)(\/(settings|deployments|schedules|versions(?:\/[a-f0-9-]+)?))?$/.test(suffix)
      || suffix === `/d1/database/${databaseId}/export` || suffix === `/d1/database/${databaseId}/query`
      || /^\/r2\/buckets\/(maydan-social-audio|maydan-lamma-preview-audio)\/domains\/(managed|custom)$/.test(suffix), 'Unapproved Cloudflare API path.');
    assert.ok(!(exportBody && readMigrations) && !(form && (exportBody || readMigrations || raw)), 'Conflicting API operations.');
    if (exportBody) {
      assert.equal(suffix, `/d1/database/${databaseId}/export`);
      assert.equal(exportBody.output_format, 'polling');
      assert.deepEqual(exportBody.dump_options, { no_schema: false, no_data: false, tables: [] }, 'Only a full read-only D1 export is allowed.');
      assert.ok(Object.keys(exportBody).every(key => ['output_format', 'dump_options', 'current_bookmark'].includes(key)));
    }
    if (readMigrations) assert.equal(suffix, `/d1/database/${databaseId}/query`);
    if (form) {
      const allowed = writeScope === 'preview' ? [ERSOMHA_PREVIEW] : writeScope === 'production' ? WORKERS : [];
      assert.ok(allowed.some(name => suffix === `/workers/scripts/${name}`), 'Module upload outside the explicit write scope.');
      assert.equal(databaseId, dbOf(writeScope === 'preview'), 'Write scope and D1 target disagree.');
    }
    if (suffix.endsWith('/query')) assert.equal(readMigrations, true, 'Only the fixed read-only migration query is allowed.');
    if (suffix.endsWith('/export')) assert.ok(exportBody, 'Use the fixed read-only full export request.');
    const body = exportBody || (readMigrations ? { sql: 'SELECT name FROM d1_migrations ORDER BY id', params: [] } : null);
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${suffix}${form ? '?bindings_inherit=strict' : ''}`, {
      method: form ? 'PUT' : body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(120_000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(form ? { body: form } : body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, `Cloudflare HTTP ${response.status}; private response body suppressed.`);
    if (raw) return { contentType: response.headers.get('content-type'), base64: Buffer.from(await response.arrayBuffer()).toString('base64') };
    const result = await response.json(); assert.equal(result.success, true, 'Cloudflare rejected operation; private response body suppressed.'); return result.result;
  };
}

function fresh(report, now) {
  const at = Date.parse(report.finishedAt);
  assert.ok(Number.isFinite(at) && now >= at && now - at < 24 * 60 * 60_000, 'Evidence is expired or future-dated.');
}
function checks(report, required) {
  assert.equal(report.passed, true, 'Evidence is not passing.');
  assert.ok(Array.isArray(report.checks) && report.checks.every(check => check.passed === true), 'Evidence contains a failed or incomplete check.');
  for (const name of required) assert.ok(report.checks.some(check => check.name === name && check.passed === true), `Missing evidence check: ${name}`);
}
export function assertTestLabProof(report, now = Date.now()) {
  assertProviderEvidence(report, now);
  assert.equal(report.providerHost, PREVIEW_LIVEKIT_HOST, 'Exact isolated Test Lab host required.');
  assert.equal(report.providerProjectId, PREVIEW_LIVEKIT_PROJECT_ID, 'Exact isolated Test Lab project required.');
  assert.equal(report.finishedPreviewDeploymentVersion, report.previewDeploymentVersion, 'Preview changed during provider acceptance.');
  assert.ok(!report.provenanceError, 'Provider provenance verification failed.');
}

export function assertErsomhaEvidence(manifest, reports, { provenance, roomsSHA256, editorial = ersomhaReviewReport(), now = Date.now() }) {
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.kind, 'ersomha-release-evidence'); fresh(manifest, now);
  assert.equal(manifest.previewOrigin, ERSOMHA_PREVIEW_ORIGIN);
  assert.match(manifest.previewDeploymentVersion || '', /^[a-f0-9-]{36}$/);
  assert.equal(manifest.sourceCommit, provenance.sourceCommit, 'Evidence manifest must identify the frozen source commit.');
  for (const key of ['sourceServerTree', 'backendTreeSha256']) assert.equal(manifest[key], provenance[key], 'Evidence manifest source mismatch.');
  for (const name of ['apiStorage', 'performance', 'contentPrivacy', 'livekit']) {
    const report = reports[name]; assert.ok(report, `Missing ${name} report.`); fresh(report, now);
    for (const key of ['sourceServerTree', 'backendTreeSha256']) assert.equal(report[key], provenance[key], `${name} tested different source.`);
    assert.match(report.sourceCommit || '', /^[a-f0-9]{40}$/);
  }
  const api = reports.apiStorage;
  assert.equal(api.schemaVersion, 1); assert.equal(api.kind, 'ersomha-api-storage'); checks(api, ERSOMHA_API_CHECKS);
  assert.equal(api.previewOrigin, manifest.previewOrigin); assert.equal(api.previewDeploymentVersion, manifest.previewDeploymentVersion);
  assert.equal(api.testedModuleSHA256, roomsSHA256); assert.equal(api.authenticatedPeers, 8);
  for (const key of ['remainingUsersAndSessions', 'remainingRooms', 'remainingReports', 'remainingLeases', 'remainingHistory']) assert.equal(api.cleanup?.[key], 0, `API/storage cleanup incomplete: ${key}`);
  assert.equal(api.cleanup.verificationFailed, false);
  const performance = reports.performance;
  assert.equal(performance.passed, true); assert.equal(performance.peers, 8);
  assert.equal(performance.testedModuleSHA256, roomsSHA256, 'Performance tested different worker bytes.');
  assert.match(performance.scope || '', /local/i, 'Controlled local performance scope must be explicit.');
  assert.equal(performance.physicalDeviceTrialCompleted, false, 'This gate must not imply a physical iPhone performance trial.');
  assert.equal(performance.network?.injectedRoundTripMs, 120); assert.equal(performance.network.packetLossSimulated, false);
  assert.ok(performance.pointBatchDelayMs > 0 && performance.pointBatchDelayMs <= 80);
  assert.ok(performance.sentBatches >= 60); assert.equal(performance.observedRemoteDeliveries, performance.sentBatches * 7);
  assert.equal(performance.expectedRemoteDeliveries, performance.sentBatches * 7);
  assert.ok(Number.isInteger(performance.warmupBatchesExcluded) && performance.warmupBatchesExcluded >= 0 && performance.warmupBatchesExcluded <= 5);
  assert.equal(performance.measuredRemoteDeliveries, (performance.sentBatches - performance.warmupBatchesExcluded) * 7);
  assert.equal(performance.targetP95Ms, 250); assert.ok(Number.isFinite(performance.remotePointToDeliveryMs?.p95) && performance.remotePointToDeliveryMs.p95 > 0 && performance.remotePointToDeliveryMs.p95 <= 250);
  const privacy = reports.contentPrivacy;
  assert.equal(privacy.schemaVersion, 1); assert.equal(privacy.kind, 'ersomha-content-privacy'); checks(privacy, ERSOMHA_PRIVACY_CHECKS);
  assert.equal(editorial.validation.ok, true); assert.equal(editorial.validation.total, 1200); assert.equal(editorial.validation.independentPending, 0, 'All 1200 concepts require independent content-bound editorial review.');
  assert.ok(editorial.entries.length === 1200 && editorial.entries.every(entry => entry.independent === 'reviewed'), 'Independent editorial review incomplete.');
  assert.deepEqual(privacy.editorial, editorial, 'Content/privacy report must include the exact current content-bound editorial review.');
  assert.equal(editorial.physicalPlaytest, false);
  assertTestLabProof(reports.livekit, now);
  assert.equal(reports.livekit.previewDeploymentVersion, manifest.previewDeploymentVersion, 'LiveKit and API/storage must test the same current preview.');
  return true;
}

export async function ersomhaPublicSmoke({ preview = false, preflight = false, fetchImpl = fetch } = {}) {
  const result = {};
  for (const name of targets(preview)) {
    const read = async pathname => {
      const response = await fetchImpl(`https://${name}.mf103871.workers.dev${pathname}`, { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { 'cache-control': 'no-cache' } });
      assert.equal(response.status, 200, `${name} public smoke failed: ${pathname}`); return response.json();
    };
    const [health, policy] = await Promise.all([read('/health'), read('/api/app-policy/ios?storefront=JOR&osVersion=26.6.1')]);
    assert.equal(health.ok, true); assert.equal(health.accounts, true); assert.equal(health.protocol, 1);
    const games = [...health.games].sort();
    if (preflight) assert.ok([['fabraka', 'meenfina'], ['ersomha', 'fabraka', 'meenfina']].some(expected => canonical(expected) === canonical(games)), 'Unexpected existing games.');
    else assert.deepEqual(games, ['ersomha', 'fabraka', 'meenfina']);
    assert.equal(policy.enabled, false, 'Mandatory update must remain disabled.'); assert.equal(policy.minimumBuild, 0);
    result[name] = { healthPassed: true, games, mandatoryUpdateDisabled: true };
  }
  return result;
}

function privateDirectory(value, preview = false) {
  const dir = path.resolve(value || path.join(PRIVATE, `ersomha${preview ? '-preview' : ''}-${stamp()}-${randomUUID().slice(0, 8)}`));
  const relative = path.relative(PRIVATE, dir);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Release records must stay inside the existing private DPAPI release directory.');
  return dir;
}
async function auth() {
  const { stdout } = await execute(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'auth', 'token', '--json'], { cwd: ROOT, timeout: 30_000, windowsHide: true, maxBuffer: 1_048_576 });
  const value = JSON.parse(stdout); assert.ok(value.token && /oauth|api/i.test(value.type), 'Unsupported Wrangler authentication.'); return value.token;
}
async function ledger(api, databaseId) {
  const rows = await api(`/d1/database/${databaseId}/query`, { readMigrations: true });
  assert.ok(rows.every(row => row.success), 'Could not read migration ledger.'); return rows.flatMap(row => row.results).map(row => row.name);
}
async function migrationNames() { return (await readdir(path.join(ROOT, 'server/migrations'))).filter(name => name.endsWith('.sql')).sort(); }
async function privateAudio(api, preview) {
  const bucket = preview ? 'maydan-lamma-preview-audio' : 'maydan-social-audio';
  const [managed, custom] = await Promise.all(['managed', 'custom'].map(type => api(`/r2/buckets/${bucket}/domains/${type}`)));
  assertPrivateBucket(managed, custom);
}
function assertOperation(before, preview) { assert.equal(before.operation, operation(preview)); assert.equal(before.databaseId, dbOf(preview)); }
async function snapshotSet(api, preview) { const workers = {}; for (const name of targets(preview)) workers[name] = await snapshotWorker(api, name); return workers; }
async function helperHashes() { return Object.fromEntries(await Promise.all(HELPER_PATHS.map(async name => [name, hash(await readFile(path.join(ROOT, name)))]))); }
async function prepareSnapshot(dir, { preview = false, proof = null } = {}) {
  const databaseId = dbOf(preview), api = ersomhaApiClient(await auth(), { databaseId }), workers = await snapshotSet(api, preview);
  for (const name of targets(preview)) if (preview) previewUploadPlan(workers[name], proof); else ersomhaUploadPlan(name, workers[name]);
  const migrations = await ledger(api, databaseId), pendingMigrations = pendingErsomhaMigrations(migrations, await migrationNames(), { preview });
  const publicAssets = await publicManifest(); assert.equal(publicAssets.entries.length, 63, 'Expected the 63 reviewed existing public assets.');
  const smoke = await ersomhaPublicSmoke({ preview, preflight: true }); await privateAudio(api, preview);
  for (const name of targets(preview)) assertLease(workers[name], await snapshotWorker(api, name));
  const snapshot = { operation: operation(preview), createdAt: new Date().toISOString(), accountId: ACCOUNT, databaseId, workers,
    public: publicAssets, migrations, pendingMigrations, smoke, ...(preview ? { isolationProof: proof } : {}) };
  await savePrivate(dir, 'preflight', snapshot); return snapshot;
}
export async function preflightErsomha(dir) {
  const snapshot = await prepareSnapshot(dir);
  return { directory: dir, operation: snapshot.operation, versions: Object.fromEntries(WORKERS.map(name => [name, snapshot.workers[name].versionId])), checkedAssets: 63,
    pendingMigrations: snapshot.pendingMigrations, productionChanged: false, backupCommand: `node scripts/ersomha-release.mjs backup "${dir}"` };
}

// Versioned encrypted backups can be refreshed without replacing reviewed plans
// or deleting any prior evidence. Never persist a plaintext SQL export.
export async function backupErsomha(dir) {
  const before = await loadPrivate(dir, 'preflight'), preview = before.operation === operation(true); assertOperation(before, preview);
  const api = ersomhaApiClient(await auth(), { databaseId: before.databaseId });
  for (const name of targets(preview)) assertLease(before.workers[name], await snapshotWorker(api, name));
  let result, bookmark; const deadline = Date.now() + 10 * 60_000;
  do {
    result = await api(`/d1/database/${before.databaseId}/export`, { exportBody: { output_format: 'polling', dump_options: { no_schema: false, no_data: false, tables: [] }, ...(bookmark ? { current_bookmark: bookmark } : {}) } });
    assert.ok(result.success && result.status !== 'error', 'D1 export failed; private response suppressed.');
    if (result.status === 'complete') break;
    bookmark = result.at_bookmark; assert.ok(bookmark && Date.now() < deadline, 'D1 export timed out.'); await new Promise(resolve => setTimeout(resolve, 3000));
  } while (true);
  const url = new URL(result.result.signed_url); assert.ok(url.protocol === 'https:' && !url.username && !url.password, 'Invalid D1 export download.');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) }); assert.ok(response.ok, 'D1 export download failed.');
  const bytes = Buffer.from(await response.arrayBuffer()), receipt = { completedAt: new Date().toISOString(), bytes: bytes.length, sha256: hash(bytes), databaseId: before.databaseId, bookmark: result.at_bookmark || bookmark || null };
  assertFreshBackup(receipt, bytes);
  const backupDir = path.join(dir, 'backups', `backup-${stamp()}-${randomUUID().slice(0, 8)}`);
  await savePrivate(backupDir, 'database.sql', bytes); await savePrivate(backupDir, 'receipt', receipt);
  assertFreshBackup(receipt, await loadPrivate(backupDir, 'database.sql', true));
  return { directory: dir, backupDirectory: backupDir, backupComplete: true, bytes: bytes.length, sha256: receipt.sha256, productionDataMutated: false };
}
async function freshBackup(dir, databaseId) {
  const backups = (await readdir(path.join(dir, 'backups'), { withFileTypes: true })).filter(entry => entry.isDirectory() && /^backup-[A-Za-z0-9-]+$/.test(entry.name)).map(entry => entry.name).sort().reverse();
  assert.ok(backups.length, 'Take a fresh encrypted D1 backup.');
  const latest = path.join(dir, 'backups', backups[0]), receipt = await loadPrivate(latest, 'receipt');
  assert.equal(receipt.databaseId, databaseId, 'Backup belongs to another database.'); assertFreshBackup(receipt, await loadPrivate(latest, 'database.sql', true));
}
async function readEvidence(manifestPath) {
  const bytes = await readFile(manifestPath), manifest = JSON.parse(bytes), reports = {}, raw = {};
  assert.deepEqual(Object.keys(manifest.artifacts || {}).sort(), ['apiStorage', 'contentPrivacy', 'livekit', 'performance']);
  for (const [name, item] of Object.entries(manifest.artifacts)) {
    assert.match(item.sha256 || '', /^[a-f0-9]{64}$/); assert.ok(typeof item.path === 'string' && item.path);
    raw[name] = await readFile(path.resolve(path.dirname(manifestPath), item.path)); assert.equal(hash(raw[name]), item.sha256, `${name} evidence hash mismatch.`); reports[name] = JSON.parse(raw[name]);
  }
  return { bytes, manifest, reports, raw };
}
async function frozenEvidence(dir, review) {
  const bytes = await loadPrivate(dir, 'evidence-manifest', true); assert.equal(hash(bytes), review.evidence.manifestSHA256);
  const manifest = JSON.parse(bytes), reports = {};
  for (const [name, digest] of Object.entries(review.evidence.artifactSHA256)) {
    const raw = await loadPrivate(dir, `evidence-${name}`, true); assert.equal(hash(raw), digest); assert.equal(manifest.artifacts[name].sha256, digest); reports[name] = JSON.parse(raw);
  }
  assertErsomhaEvidence(manifest, reports, { provenance: review, roomsSHA256: review.bundles['maydan-rooms'].sha256 }); return { manifest, reports };
}
async function freezePlan(dir, before, { preview = false, evidence = null } = {}) {
  assertOperation(before, preview);
  const provenance = await getBackendProvenance(ROOT, { requireClean: true });
  const pendingMigrations = pendingErsomhaMigrations(before.migrations, await migrationNames(), { preview }), migrations = {};
  for (const name of pendingMigrations) { const bytes = await readFile(path.join(ROOT, 'server/migrations', name)); assertErsomhaMigration(name, bytes.toString('utf8')); migrations[name] = bytes; }
  const plans = {}, bundles = {}, sourceInputs = {}, modules = {};
  for (const name of targets(preview)) {
    plans[name] = preview ? previewUploadPlan(before.workers[name], before.isolationProof) : ersomhaUploadPlan(name, before.workers[name]);
    const compiled = await bundleErsomhaWorker(preview ? 'maydan-rooms' : name);
    modules[name] = compiled.bytes; bundles[name] = { sha256: compiled.sha256, byteLength: compiled.byteLength }; Object.assign(sourceInputs, compiled.sourceInputs);
  }
  if (!preview) assertErsomhaEvidence(evidence.manifest, evidence.reports, { provenance, roomsSHA256: bundles['maydan-rooms'].sha256 });
  const review = { operation: operation(preview), createdAt: new Date().toISOString(), ...provenance, snapshotSHA256: hash(canonical(before)), plans, bundles, sourceInputs, helpers: await helperHashes(), pendingMigrations,
    migrationSHA256: Object.fromEntries(Object.entries(migrations).map(([name, bytes]) => [name, hash(bytes)])),
    ...(preview ? { isolationProofSHA256: hash(canonical(before.isolationProof)) } : { evidence: { manifestSHA256: hash(evidence.bytes), artifactSHA256: Object.fromEntries(Object.entries(evidence.raw).map(([name, bytes]) => [name, hash(bytes)])) } }),
    sequence: ['Recheck exact reviewed source, tested evidence, metadata leases, disabled policy and 63 public assets', 'Verify a fresh encrypted full D1 backup',
      'Apply only the frozen additive migration files', `Upload frozen backend module${preview ? '' : 's'} with every existing binding inherited`, 'Verify reviewed code, unchanged resources, migration ledger and policy'] };
  for (const [name, bytes] of Object.entries(modules)) await savePrivate(dir, `${name}.mjs`, bytes);
  for (const [name, bytes] of Object.entries(migrations)) await savePrivate(dir, `migration-${name}`, bytes);
  if (!preview) { await savePrivate(dir, 'evidence-manifest', evidence.bytes); for (const [name, bytes] of Object.entries(evidence.raw)) await savePrivate(dir, `evidence-${name}`, bytes); }
  await savePrivate(dir, 'deployment-plan', review);
  return { directory: dir, operation: review.operation, sourceCommit: review.sourceCommit, sourceServerTree: review.sourceServerTree, backendTreeSha256: review.backendTreeSha256,
    bundles, pendingMigrations, planSHA256: hash(canonical(review)), applied: false, backupCommand: `node scripts/ersomha-release.mjs backup "${dir}"` };
}
export async function planErsomha(dir, manifestPath) { return freezePlan(dir, await loadPrivate(dir, 'preflight'), { evidence: await readEvidence(path.resolve(manifestPath)) }); }
export async function planErsomhaPreview(dir, isolationPath) {
  const proof = JSON.parse(await readFile(isolationPath, 'utf8')); assertTestLabProof(proof);
  // Require clean frozen source before writing even the private preview snapshot.
  await getBackendProvenance(ROOT, { requireClean: true });
  return freezePlan(dir, await prepareSnapshot(dir, { preview: true, proof }), { preview: true });
}

export async function verifyErsomha(dir, { preview = false } = {}) {
  const before = await loadPrivate(dir, 'preflight'), review = await loadPrivate(dir, 'deployment-plan'); assertOperation(before, preview); assert.equal(review.operation, before.operation);
  assert.equal(hash(canonical(before)), review.snapshotSHA256, 'Preflight snapshot differs from the reviewed plan.');
  const api = ersomhaApiClient(await auth(), { databaseId: before.databaseId }), current = await snapshotSet(api, preview);
  for (const name of targets(preview)) {
    if (preview) assertPreviewMetadata(before.workers[name], current[name]); else assertSocialUpdateMetadata(name, before.workers[name], current[name]);
    await assertDeployedBundle(current[name].script, name, review.bundles[name].sha256);
  }
  assertErsomhaLedger(before.migrations, await ledger(api, before.databaseId), review.pendingMigrations, { preview });
  assertAssetsUnchanged(before.public, await publicManifest(before.public.paths)); await privateAudio(api, preview);
  const smoke = await ersomhaPublicSmoke({ preview });
  const result = { verifiedAt: new Date().toISOString(), operation: review.operation, versions: Object.fromEntries(targets(preview).map(name => [name, current[name].versionId])),
    bundles: review.bundles, sourceCommit: review.sourceCommit, sourceServerTree: review.sourceServerTree, backendTreeSha256: review.backendTreeSha256,
    checkedAssets: 63, assetsUnchanged: true, originalBindingsUnchanged: true, originalSettingsUnchanged: true, originalCronsUnchanged: true,
    durableObjectMigrationsUnchanged: true, reviewedWorkerCodeVerified: true, addedMigrations: review.pendingMigrations, privateAudioVerified: true, smoke };
  await savePrivate(dir, `verification-${stamp()}-${randomUUID().slice(0, 8)}`, result); return result;
}

export async function createErsomhaJournal(dir, { operation: kind, planSHA256 }) {
  assert.ok([operation(false), operation(true)].includes(kind)); assert.match(planSHA256 || '', /^[a-f0-9]{64}$/);
  const journal = { operation: kind, startedAt: new Date().toISOString(), planSHA256, phases: [] };
  await writeFile(path.join(dir, 'ersomha-apply.lock'), JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
  return async (phase, action) => {
    const record = async state => { journal.phases.push({ phase, state, at: new Date().toISOString() }); await writeFile(path.join(dir, 'ersomha-apply-progress.json'), JSON.stringify(journal, null, 2), { mode: 0o600 }); };
    await record('starting'); const result = await action(); await record('completed'); return result;
  };
}

export async function applyErsomha(dir, expectedDigest, { preview = false } = {}) {
  assert.match(expectedDigest || '', /^[a-f0-9]{64}$/, 'Pass the exact reviewed plan digest.');
  const review = await loadPrivate(dir, 'deployment-plan'), before = await loadPrivate(dir, 'preflight'); assertOperation(before, preview); assert.equal(review.operation, before.operation);
  assert.equal(hash(canonical(review)), expectedDigest, 'Plan differs from the reviewed digest.');
  assert.equal(hash(canonical(before)), review.snapshotSHA256, 'Preflight snapshot differs from the reviewed plan.');
  assert.deepEqual(await helperHashes(), review.helpers, 'A release helper changed after plan review.');
  const provenance = await getBackendProvenance(ROOT, { requireClean: true });
  for (const key of ['sourceServerTree', 'backendTreeSha256']) assert.equal(provenance[key], review[key], 'Backend source changed after plan review.');
  await freshBackup(dir, before.databaseId);
  for (const [name, digest] of Object.entries(review.sourceInputs)) assert.equal(hash(await readFile(path.join(ROOT, name))), digest, 'A bundled dependency changed after review.');
  const pending = pendingErsomhaMigrations(before.migrations, await migrationNames(), { preview }); assert.deepEqual(pending, review.pendingMigrations);
  const modules = {}, migrations = {};
  for (const name of targets(preview)) { modules[name] = await loadPrivate(dir, `${name}.mjs`, true); assert.equal(hash(modules[name]), review.bundles[name].sha256); }
  for (const name of pending) {
    const bytes = await loadPrivate(dir, `migration-${name}`, true); assertErsomhaMigration(name, bytes.toString('utf8')); assert.equal(hash(bytes), review.migrationSHA256[name]);
    assert.equal(hash(await readFile(path.join(ROOT, 'server/migrations', name))), review.migrationSHA256[name], 'Migration changed after review.'); migrations[name] = bytes;
  }
  const api = ersomhaApiClient(await auth(), { writeScope: preview ? 'preview' : 'production', databaseId: before.databaseId });
  if (preview) assert.equal(hash(canonical(before.isolationProof)), review.isolationProofSHA256);
  else {
    const evidence = await frozenEvidence(dir, review); assertProvenance(review, provenance, evidence.reports.livekit);
    const tested = await snapshotWorker(api, ERSOMHA_PREVIEW);
    assert.equal(tested.versionId, evidence.manifest.previewDeploymentVersion, 'Tested preview deployment changed.');
    assertPreviewIsolation(tested, evidence.reports.livekit); await assertDeployedBundle(tested.script, ERSOMHA_PREVIEW, review.bundles['maydan-rooms'].sha256);
  }
  for (const name of targets(preview)) {
    const current = await snapshotWorker(api, name); assertLease(before.workers[name], current);
    assert.deepEqual(preview ? previewUploadPlan(current, before.isolationProof) : ersomhaUploadPlan(name, current), review.plans[name], 'Reviewed inherited metadata changed.');
  }
  assert.deepEqual(await ledger(api, before.databaseId), before.migrations, 'D1 ledger changed since preflight.');
  assertAssetsUnchanged(before.public, await publicManifest(before.public.paths)); await privateAudio(api, preview); await ersomhaPublicSmoke({ preview, preflight: true });
  // Network preflight may outlive the backup age checked at entry. Recheck the
  // encrypted export immediately before the first remote mutation is armed.
  await freshBackup(dir, before.databaseId);
  // Lock and a starting journal record precede every remote write. A network
  // error retains this lock; recovery is a separately reviewed plan, never retry.
  const phase = await createErsomhaJournal(dir, { operation: review.operation, planSHA256: expectedDigest });
  if (pending.length) {
    const migrationDirectory = path.join(dir, 'frozen-migrations'); await mkdir(migrationDirectory, { mode: 0o700 });
    for (const [name, bytes] of Object.entries(migrations)) await writeFile(path.join(migrationDirectory, name), bytes, { flag: 'wx', mode: 0o600 });
    const config = migrationConfig(); config.d1_databases[0] = { binding: 'DB', database_name: preview ? 'maydan-lamma-preview-accounts' : 'maydan-accounts', database_id: before.databaseId, migrations_dir: migrationDirectory };
    const configPath = path.join(dir, 'ersomha-migration-config.json'); await writeFile(configPath, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
    await phase('frozen-additive-migrations', async () => {
      await execute(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', config.d1_databases[0].database_name, '--remote', '--config', configPath],
        { cwd: ROOT, windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, CI: 'true' } });
      assertErsomhaLedger(before.migrations, await ledger(api, before.databaseId), pending, { preview });
    });
  }
  for (const name of targets(preview)) {
    assertLease(before.workers[name], await snapshotWorker(api, name));
    await phase(`${name}-backend-upload`, async () => {
      const form = new FormData(); form.set('metadata', new Blob([JSON.stringify(review.plans[name].metadata)], { type: 'application/json' }));
      form.set(`${name}.mjs`, new File([modules[name]], `${name}.mjs`, { type: 'application/javascript+module' })); await api(`/workers/scripts/${name}`, { form });
      const current = await snapshotWorker(api, name); if (preview) assertPreviewMetadata(before.workers[name], current); else assertSocialUpdateMetadata(name, before.workers[name], current);
      await assertDeployedBundle(current.script, name, review.bundles[name].sha256); assertAssetsUnchanged(before.public, await publicManifest(before.public.paths));
    });
  }
  const result = await phase('post-deployment-verification', () => verifyErsomha(dir, { preview }));
  return { ...result, applied: true, frontendDeployed: false, secretValuesWritten: false, resourcesProvisioned: false, testFlightUploaded: false };
}

async function main() {
  const [command, suppliedDir, argument] = process.argv.slice(2);
  assert.ok(['preflight', 'backup', 'plan', '--apply', 'verify', 'preview-plan', '--preview-apply', 'preview-verify'].includes(command), 'Use preflight [dir], backup <dir>, plan <dir> <manifest>, --apply <dir> <digest>, verify <dir>, preview-plan <dir> <current-isolation-proof>, --preview-apply <dir> <digest>, or preview-verify <dir>.');
  if (command !== 'preflight') assert.ok(suppliedDir, 'Use an exact private release directory.');
  const preview = command.includes('preview'), dir = privateDirectory(suppliedDir, preview);
  let result;
  if (command === 'preflight') result = await preflightErsomha(dir);
  else if (command === 'backup') result = await backupErsomha(dir);
  else if (command === 'plan') { assert.ok(argument, 'Pass the evidence manifest.'); result = await planErsomha(dir, argument); }
  else if (command === 'preview-plan') { assert.ok(argument, 'Pass the current isolated Test Lab acceptance report.'); result = await planErsomhaPreview(dir, argument); }
  else if (command === '--apply' || command === '--preview-apply') result = await applyErsomha(dir, argument, { preview });
  else result = await verifyErsomha(dir, { preview });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ failed: true, message: error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Ersomha release preparation failed; private data, credentials and provider response bodies suppressed.' })); process.exitCode = 1;
});
