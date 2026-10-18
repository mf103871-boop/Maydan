// Backend-only follow-up to the existing Lamma release. Default commands read
// production; --apply requires a frozen reviewed plan, fresh DPAPI D1 export,
// current provider proof and an unchanged production lease. Never retries writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { apiClient, snapshotWorker, uploadPlan, assertLease, savePrivate, loadPrivate, publicManifest,
  assertAssetsUnchanged, assertDeployedBundle, migrationConfig, assertProviderEvidence, assertProvenance,
  activeVersion, assertPrivateBucket } from './lamma-release.mjs';
import { getBackendProvenance } from './lib/lamma-provenance.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DATABASE = '9d863a31-6a5c-45f1-91f5-79ad400c3f6e';
const WORKERS = ['maydan-game', 'maydan-rooms'];
const PRIVATE = path.join(homedir(), '.codex', 'private', 'maydan-lamma-release');
const MIGRATION = '0009_online_room_trials.sql';
const HELPER_PATHS = ['scripts/lamma-social-update.mjs', 'scripts/lamma-release.mjs', 'scripts/lib/lamma-provenance.mjs'];
const SETTINGS = ['compatibility_date', 'compatibility_flags', 'placement', 'logpush', 'observability', 'tail_consumers', 'tags', 'limits'];
const execute = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const cron = snapshot => (snapshot.schedules.schedules || []).map(({ cron: value }) => ({ cron: value })).sort((a, b) => a.cron.localeCompare(b.cron));

export function socialUpdatePlan(name, snapshot) {
  assert.ok(WORKERS.includes(name));
  assert.equal(snapshot.version.resources.script_runtime.migration_tag, name === 'maydan-game' ? 'v3-lamma' : 'v1', 'Only the existing Lamma DO history is supported.');
  for (const binding of ['SOCIAL_AUDIO', 'SOCIAL_JOBS']) assert.ok(snapshot.settings.bindings.some(item => item.name === binding), `Missing existing ${name}/${binding}; resource provisioning is outside this update.`);
  const result = uploadPlan(name, snapshot);
  assert.equal(result.metadata.migrations, undefined, 'This update must never create a Durable Object migration.');
  assert.deepEqual([...result.schedules].sort((a, b) => a.cron.localeCompare(b.cron)), cron(snapshot), 'This update must preserve every cron exactly.');
  const expected = snapshot.settings.bindings.filter(item => !['secret_text', 'secret_key'].includes(item.type)).map(item => item.name).sort();
  assert.deepEqual(result.metadata.bindings.map(item => item.name).sort(), expected, 'This update must not add or remove a binding.');
  assert.ok(result.metadata.bindings.every(item => item.type === 'inherit'), 'Every existing binding must be inherited.');
  const update = snapshot.settings.bindings.find(item => item.name === 'IOS_UPDATE_POLICY_ENABLED');
  assert.notEqual(update?.text, '1', 'An enabled mandatory-update policy requires separate review; do not combine it with TestFlight preparation.');
  result.metadata.annotations = { 'workers/message': 'Lamma responsiveness and online party fixes; existing public assets retained' };
  return result;
}

export function assertOnlineTrialMigration(sql) {
  const statements = sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(statements, 'CREATE TABLE IF NOT EXISTS online_room_trial_claims (user_id TEXT NOT NULL, game TEXT NOT NULL, claim_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, game)); CREATE INDEX IF NOT EXISTS online_room_trial_claims_created ON online_room_trial_claims (created_at);',
    'Only the reviewed additive room-trial table and index are authorized.');
}

export function assertSocialUpdateLedger(before, after) {
  assert.ok(!before.includes(MIGRATION), 'Migration 0009 was already present before this plan; reconcile instead of retrying.');
  assert.deepEqual(after, [...before, MIGRATION], 'Only additive migration 0009 may be added to the production ledger.');
}

export function assertSocialUpdateMetadata(name, before, current) {
  assert.ok(WORKERS.includes(name));
  const bindings = value => [...value.settings.bindings].sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(bindings(current), bindings(before), `${name} bindings changed.`);
  for (const key of SETTINGS) assert.deepEqual(current.settings[key], before.settings[key], `${name} setting changed: ${key}`);
  assert.deepEqual(cron(current), cron(before), `${name} cron changed.`);
  assert.equal(current.version.resources.script_runtime.migration_tag, before.version.resources.script_runtime.migration_tag, `${name} DO history changed.`);
  assert.deepEqual(current.version.resources.script_runtime.assets, before.version.resources.script_runtime.assets, `${name} complete asset configuration changed.`);
}

export function assertFreshBackup(receipt, bytes, now = Date.now()) {
  assert.ok(receipt && Number.isFinite(Date.parse(receipt.completedAt)) && now >= Date.parse(receipt.completedAt) && now - Date.parse(receipt.completedAt) < 30 * 60_000,
    'Take a fresh encrypted D1 export before applying this update (maximum age 30 minutes).');
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 100 && bytes.includes(Buffer.from('CREATE TABLE')), 'Expected a complete schema/data D1 backup.');
  assert.equal(hash(bytes), receipt.sha256, 'Encrypted backup integrity failed.');
  assert.equal(bytes.length, receipt.bytes, 'Encrypted backup byte count changed.');
}

function privateDirectory(value) {
  const dir = path.resolve(value || path.join(PRIVATE, `social-update-${new Date().toISOString().replace(/[:.]/g, '-')}`));
  const relative = path.relative(PRIVATE, dir);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Release records must stay inside the existing private DPAPI release directory.');
  return dir;
}
async function auth() {
  const { stdout } = await execute(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'auth', 'token', '--json'],
    { cwd: ROOT, timeout: 30_000, windowsHide: true, maxBuffer: 1_048_576 });
  const value = JSON.parse(stdout);
  assert.ok(value.token && ['oauth', 'api', 'oauth_token', 'api_token'].some(type => String(value.type).toLowerCase().includes(type)), 'Unsupported Wrangler auth result.');
  return value.token;
}
async function ledger(api) {
  const results = await api(`/d1/database/${DATABASE}/query`, { readMigrations: true });
  assert.ok(results.every(result => result.success), 'Could not read the D1 migration ledger.');
  return results.flatMap(result => result.results).map(item => item.name);
}
export async function publicSmoke({ preflight = false, fetchImpl = fetch } = {}) {
  const checks = {};
  for (const name of WORKERS) {
    const origin = `https://${name}.mf103871.workers.dev`;
    const read = async pathname => {
      const response = await fetchImpl(origin + pathname, { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { 'cache-control': 'no-cache' } });
      assert.equal(response.status, 200, `${name} public smoke failed: ${pathname}`);
      return response.json();
    };
    // The older rooms worker has no public policy route yet. Before updating,
    // prove both health endpoints and the main app's disabled policy; after
    // deployment both reviewed worker modules must expose the public policy.
    const checkPolicy = !preflight || name === 'maydan-game';
    const [health, policy] = await Promise.all([read('/health'), checkPolicy ? read('/api/app-policy/ios?storefront=JOR&osVersion=26.6.1') : null]);
    assert.equal(health.ok, true); assert.equal(health.accounts, true); assert.equal(health.protocol, 1);
    assert.deepEqual(health.games, ['meenfina', 'fabraka']);
    if (checkPolicy) {
      assert.equal(policy.enabled, false, 'Mandatory update must remain disabled during TestFlight preparation.');
      assert.equal(policy.minimumBuild, 0);
    }
    checks[name] = { healthPassed: true, accounts: true, protocol: health.protocol, mandatoryUpdatePolicyChecked: checkPolicy,
      ...(checkPolicy ? { mandatoryUpdateDisabled: true } : {}) };
  }
  return checks;
}

export async function preflightSocialUpdate(dir) {
  const api = apiClient(await auth()), workers = {};
  for (const name of WORKERS) { workers[name] = await snapshotWorker(api, name); socialUpdatePlan(name, workers[name]); }
  const publicAssets = await publicManifest(), migrations = await ledger(api), smoke = await publicSmoke({ preflight: true });
  assert.ok(migrations.includes('0008_lamma.sql') && !migrations.includes(MIGRATION), 'Expected existing Lamma schema and pending migration 0009.');
  for (const name of WORKERS) assertLease(workers[name], await snapshotWorker(api, name));
  // Same encrypted shape as lamma-release.mjs, so its read-only `backup` command
  // performs the existing schema/data export and encrypted round-trip check.
  const snapshot = { createdAt: new Date().toISOString(), accountId: migrationConfig().account_id, databaseId: DATABASE, workers,
    public: publicAssets, migrations, smoke, operation: 'lamma-social-update' };
  await savePrivate(dir, 'preflight', snapshot);
  const summary = { directory: dir, createdAt: snapshot.createdAt, versions: Object.fromEntries(WORKERS.map(name => [name, workers[name].versionId])),
    checkedAssets: publicAssets.entries.length, productionChanged: false, backupCommand: `node scripts/lamma-release.mjs backup "${dir}"` };
  await writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600, flag: 'wx' });
  return summary;
}

export async function planSocialUpdate(dir) {
  const snapshot = await loadPrivate(dir, 'preflight');
  assert.equal(snapshot.operation, 'lamma-social-update');
  const provenance = await getBackendProvenance(ROOT, { requireClean: true });
  const pendingMigrations = (await readdir(path.join(ROOT, 'server/migrations'))).filter(name => name.endsWith('.sql') && !snapshot.migrations.includes(name)).sort();
  assert.deepEqual(pendingMigrations, [MIGRATION], 'Only migration 0009 may be pending.');
  const migration = await readFile(path.join(ROOT, 'server/migrations', MIGRATION));
  assertOnlineTrialMigration(migration.toString('utf8'));
  const plans = Object.fromEntries(WORKERS.map(name => [name, socialUpdatePlan(name, snapshot.workers[name])]));
  const bundles = {}, sourceInputs = {};
  for (const name of WORKERS) {
    const compiled = await build({ entryPoints: [path.join(ROOT, 'server', name === 'maydan-game' ? 'full-worker.mjs' : 'worker.mjs')],
      absWorkingDir: ROOT, bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', minify: false, sourcemap: false, logLevel: 'silent' });
    assert.equal(compiled.outputFiles.length, 1);
    const bytes = Buffer.from(compiled.outputFiles[0].contents);
    bundles[name] = { sha256: hash(bytes), bytes: bytes.length };
    for (const filename of Object.keys(compiled.metafile.inputs)) sourceInputs[filename] = hash(await readFile(path.resolve(ROOT, filename)));
    await savePrivate(dir, `${name}.mjs`, bytes);
  }
  await savePrivate(dir, 'migration-0009.sql', migration);
  const helpers = Object.fromEntries(await Promise.all(HELPER_PATHS.map(async filename => [filename, hash(await readFile(path.join(ROOT, filename)))])));
  const review = { operation: 'lamma-social-update', ...provenance, createdAt: new Date().toISOString(), plans, bundles, sourceInputs, helpers,
    pendingMigrations, migrationSHA256: hash(migration),
    sequence: ['Verify fresh matching preview provider acceptance', 'Recheck worker leases, asset bytes and original migration ledger', 'Verify fresh encrypted full D1 backup',
      'Apply frozen additive migration 0009 only', 'Upload frozen maydan-game module with keep_assets', 'Upload frozen maydan-rooms module',
      'Verify both modules, every binding/setting/cron, original public assets, D1 ledger and disabled update policy'] };
  await savePrivate(dir, 'deployment-plan', review);
  return { directory: dir, operation: review.operation, sourceCommit: review.sourceCommit, sourceServerTree: review.sourceServerTree,
    backendTreeSha256: review.backendTreeSha256, bundles, pendingMigrations, planSHA256: hash(canonical(review)), applied: false };
}

export async function verifySocialUpdate(dir) {
  const before = await loadPrivate(dir, 'preflight'), review = await loadPrivate(dir, 'deployment-plan'), api = apiClient(await auth());
  assert.equal(before.operation, 'lamma-social-update'); assert.equal(review.operation, 'lamma-social-update');
  const current = {};
  for (const name of WORKERS) {
    current[name] = await snapshotWorker(api, name);
    assertSocialUpdateMetadata(name, before.workers[name], current[name]);
    await assertDeployedBundle(current[name].script, name, review.bundles[name].sha256);
  }
  const assets = await publicManifest(before.public.paths);
  assertAssetsUnchanged(before.public, assets);
  assertSocialUpdateLedger(before.migrations, await ledger(api));
  const smoke = await publicSmoke();
  const result = { verifiedAt: new Date().toISOString(), operation: 'lamma-social-update', versions: Object.fromEntries(WORKERS.map(name => [name, current[name].versionId])),
    assetsUnchanged: true, checkedAssets: assets.entries.length, originalBindingsUnchanged: true, originalSettingsUnchanged: true,
    originalCronsUnchanged: true, durableObjectMigrationsUnchanged: true, reviewedWorkerCodeVerified: true, onlyMigration0009Added: true, smoke };
  await savePrivate(dir, `social-update-verification-${new Date().toISOString().replace(/[:.]/g, '-')}`, result);
  return result;
}

export async function applySocialUpdate(dir, expectedDigest, evidencePath) {
  assert.match(expectedDigest || '', /^[a-f0-9]{64}$/, 'Pass the exact reviewed plan digest.');
  const review = await loadPrivate(dir, 'deployment-plan'), before = await loadPrivate(dir, 'preflight');
  assert.equal(review.operation, 'lamma-social-update'); assert.equal(before.operation, 'lamma-social-update');
  assert.equal(hash(canonical(review)), expectedDigest, 'Plan differs from the reviewed digest.');
  for (const [filename, digest] of Object.entries(review.helpers)) assert.equal(hash(await readFile(path.join(ROOT, filename))), digest, 'A release helper changed after plan review.');
  const evidence = JSON.parse(await readFile(evidencePath || '', 'utf8'));
  assertProviderEvidence(evidence);
  assertProvenance(review, await getBackendProvenance(ROOT, { requireClean: true }), evidence);
  const receipt = await loadPrivate(dir, 'd1-receipt'), backup = await loadPrivate(dir, 'production-d1.sql', true);
  assertFreshBackup(receipt, backup);
  for (const [filename, digest] of Object.entries(review.sourceInputs)) assert.equal(hash(await readFile(path.resolve(ROOT, filename))), digest, 'A bundled dependency changed after review.');
  const migration = await loadPrivate(dir, 'migration-0009.sql', true);
  assertOnlineTrialMigration(migration.toString('utf8'));
  assert.equal(hash(migration), review.migrationSHA256);
  assert.equal(hash(await readFile(path.join(ROOT, 'server/migrations', MIGRATION))), review.migrationSHA256, 'Migration source changed after review.');
  const api = apiClient(await auth(), true);
  assert.equal(activeVersion(await api('/workers/scripts/maydan-lamma-preview/deployments')), evidence.previewDeploymentVersion, 'Tested preview deployment changed.');
  for (const name of WORKERS) {
    const current = await snapshotWorker(api, name);
    assertLease(before.workers[name], current);
    assert.deepEqual(socialUpdatePlan(name, current), review.plans[name], 'Reviewed upload metadata changed.');
  }
  assert.deepEqual(await ledger(api), before.migrations, 'Production D1 ledger changed after preflight.');
  const pending = (await readdir(path.join(ROOT, 'server/migrations'))).filter(name => name.endsWith('.sql') && !before.migrations.includes(name)).sort();
  assert.deepEqual(pending, [MIGRATION]);
  assertAssetsUnchanged(before.public, await publicManifest(before.public.paths));
  await publicSmoke({ preflight: true });
  const [managed, custom] = await Promise.all(['managed', 'custom'].map(type => api(`/r2/buckets/maydan-social-audio/domains/${type}`)));
  assertPrivateBucket(managed, custom);
  const modules = {};
  for (const name of WORKERS) {
    modules[name] = await loadPrivate(dir, `${name}.mjs`, true);
    assert.equal(hash(modules[name]), review.bundles[name].sha256, 'Frozen module digest changed.');
  }
  const journal = { operation: 'lamma-social-update', startedAt: new Date().toISOString(), planSHA256: expectedDigest, phases: [] };
  await writeFile(path.join(dir, 'social-update-apply.lock'), JSON.stringify({ startedAt: journal.startedAt, planSHA256: expectedDigest }), { mode: 0o600, flag: 'wx' });
  const record = async (phase, state) => {
    journal.phases.push({ phase, state, at: new Date().toISOString() });
    await writeFile(path.join(dir, 'social-update-apply-progress.json'), JSON.stringify(journal, null, 2), { mode: 0o600 });
  };
  // A directory containing only the frozen additive file prevents the migration
  // runner from discovering a different new migration while applying this plan.
  const migrationDirectory = path.join(dir, 'frozen-migration-0009');
  await mkdir(migrationDirectory, { mode: 0o700 });
  await writeFile(path.join(migrationDirectory, MIGRATION), migration, { mode: 0o600, flag: 'wx' });
  const config = migrationConfig(); config.d1_databases[0].migrations_dir = migrationDirectory;
  const configPath = path.join(dir, 'social-update-migration-config.json');
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
  await record('additive-migration-0009', 'starting');
  await execute(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', 'maydan-accounts', '--remote', '--config', configPath],
    { cwd: ROOT, windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, CI: 'true' } });
  assertSocialUpdateLedger(before.migrations, await ledger(api));
  await record('additive-migration-0009', 'completed');
  for (const name of WORKERS) {
    assertLease(before.workers[name], await snapshotWorker(api, name));
    await record(`${name}-backend-upload`, 'starting');
    const form = new FormData();
    form.set('metadata', new Blob([JSON.stringify(review.plans[name].metadata)], { type: 'application/json' }));
    form.set(`${name}.mjs`, new File([modules[name]], `${name}.mjs`, { type: 'application/javascript+module' }));
    await api(`/workers/scripts/${name}`, { form });
    const current = await snapshotWorker(api, name);
    assertSocialUpdateMetadata(name, before.workers[name], current);
    await assertDeployedBundle(current.script, name, review.bundles[name].sha256);
    if (name === 'maydan-game') assertAssetsUnchanged(before.public, await publicManifest(before.public.paths));
    await record(`${name}-backend-upload`, 'completed');
  }
  const result = await verifySocialUpdate(dir);
  await record('post-deployment-verification', 'completed');
  return { ...result, applied: true, frontendDeployed: false, secretValuesWritten: false, testFlightUploaded: false };
}

async function main() {
  const [command, suppliedDir, digest, evidence] = process.argv.slice(2);
  assert.ok(['preflight', 'plan', 'verify', '--apply'].includes(command), 'Use preflight [private-dir], plan <private-dir>, verify <private-dir>, or --apply <private-dir> <reviewed-plan-digest> <fresh-provider-report>. Backup uses the existing lamma-release.mjs backup command.');
  if (command !== 'preflight') assert.ok(suppliedDir, 'Use the exact directory from this update preflight.');
  const dir = privateDirectory(suppliedDir);
  const result = command === '--apply' ? await applySocialUpdate(dir, digest, evidence) : await ({ preflight: preflightSocialUpdate, plan: planSocialUpdate, verify: verifySocialUpdate }[command])(dir);
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ failed: true, message: error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Social update preparation failed; private data and provider response bodies suppressed.' })); process.exitCode = 1; });
}
