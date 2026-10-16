// Read-only --plan, then a separately reviewed --apply <dir> <plan-sha256>.
// Exactly one production write is possible: the main Worker's module upload.
// No asset upload, D1 operation, rooms deployment, cron write or DO migration.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { apiClient, snapshotWorker, assertLease, uploadPlan, assetsConfig, savePrivate, loadPrivate,
  publicManifest, assertAssetsUnchanged, assertDeployedBundle } from '../lamma-release.mjs';
import { getBackendProvenance } from '../lib/lamma-provenance.mjs';
import { privacyPageResponse } from '../../server/legal/privacy.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NAME = 'maydan-game';
const BASE = `/workers/scripts/${NAME}`;
const ORIGIN = 'https://maydan-game.mf103871.workers.dev';
const PRIVATE = path.join(homedir(), '.codex', 'private', 'maydan-policy-release');
const HELPERS = ['scripts/ios/publish-policy-backend.mjs', 'scripts/lamma-release.mjs', 'scripts/lib/lamma-provenance.mjs'];
const SETTINGS = ['compatibility_date', 'compatibility_flags', 'placement', 'logpush', 'observability', 'tail_consumers', 'tags', 'limits'];
const execute = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const cron = snapshot => (snapshot.schedules?.schedules || []).map(item => item.cron).sort();
const bindings = snapshot => [...snapshot.settings.bindings].sort((a, b) => a.name.localeCompare(b.name));

export function policyUploadPlan(snapshot) {
  assert.equal(snapshot.version.resources.script_runtime.migration_tag, 'v3-lamma', 'Only the existing v3-lamma main Worker is supported.');
  const existing = new Map(snapshot.settings.bindings.map(binding => [binding.name, binding]));
  for (const name of ['ASSETS', 'DB', 'SESSION_SECRET', 'SOCIAL_AUDIO', 'SOCIAL_JOBS']) assert.ok(existing.has(name), `Missing live binding: ${name}`);
  const policy = existing.get('IOS_UPDATE_POLICY_ENABLED');
  if (policy) {
    assert.equal(policy.type, 'plain_text', 'Cannot verify that a secret policy flag is disabled.');
    assert.ok(['', '0'].includes(policy.text), 'This deployment must keep the update policy disabled.');
  }
  assert.ok(cron(snapshot).includes('* * * * *'), 'Existing Lamma job cron is missing; reconcile separately.');
  const plan = uploadPlan(NAME, snapshot);
  assert.equal(plan.metadata.migrations, undefined, 'DO migration forbidden in this release.');
  assert.deepEqual(plan.schedules.map(item => item.cron).sort(), cron(snapshot), 'Cron changes are forbidden.');
  assert.ok(plan.metadata.bindings.every(binding => binding.type === 'inherit'), 'New/changed bindings are forbidden.');
  assert.deepEqual(plan.metadata.bindings.map(binding => binding.name).sort(), snapshot.settings.bindings
    .filter(binding => !['secret_text', 'secret_key'].includes(binding.type)).map(binding => binding.name).sort());
  const original = assetsConfig(snapshot.version.resources.script_runtime.assets);
  plan.metadata.assets.config = { ...original, run_worker_first: [...original.run_worker_first] };
  for (const route of ['/privacy', '/privacy/']) {
    if (!plan.metadata.assets.config.run_worker_first.includes(route)) plan.metadata.assets.config.run_worker_first.push(route);
  }
  plan.metadata.annotations = { 'workers/message': 'Public privacy page and dormant iOS update policy; preserve public assets' };
  return { metadata: plan.metadata, lease: plan.lease };
}

export function assertPolicyDeployment(before, after, plan) {
  assert.deepEqual(bindings(after), bindings(before), 'Existing production bindings changed.');
  assert.deepEqual(cron(after), cron(before), 'Production schedules changed.');
  for (const key of SETTINGS) assert.deepEqual(after.settings[key], before.settings[key], `Production setting changed: ${key}`);
  const runtime = after.version.resources.script_runtime;
  assert.equal(runtime.migration_tag, 'v3-lamma', 'DO migration tag changed.');
  assert.deepEqual(assetsConfig(runtime.assets), plan.metadata.assets.config, 'Only the exact privacy routes may change in asset configuration.');
  // raw_run_worker_first/static_routing are Cloudflare's two representations of
  // the intentional route change. Every other asset/runtime field is preserved.
  const withoutRouting = assets => Object.fromEntries(Object.entries(assets).filter(([key]) => !['raw_run_worker_first', 'static_routing'].includes(key)));
  assert.deepEqual(withoutRouting(runtime.assets), withoutRouting(before.version.resources.script_runtime.assets), 'Other live asset configuration changed.');
}

function privateDirectory(value) {
  const dir = path.resolve(value || path.join(PRIVATE, new Date().toISOString().replace(/[:.]/g, '-')));
  const relative = path.relative(PRIVATE, dir);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Plan records must be inside the private policy-release directory.');
  return dir;
}

async function authenticatedClient(allowApply = false) {
  const { stdout } = await execute(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'auth', 'token', '--json'],
    { cwd: ROOT, windowsHide: true, timeout: 30_000, maxBuffer: 1_048_576 });
  const credentials = JSON.parse(stdout);
  assert.ok(typeof credentials.token === 'string' && credentials.token.length > 0, 'Wrangler authentication unavailable.');
  const api = apiClient(credentials.token, allowApply);
  return (suffix, options = {}) => {
    assert.ok(new RegExp(`^${BASE}(/(settings|deployments|schedules|versions(/[a-f0-9-]+)?))?$`).test(suffix), 'Only the main Worker can be inspected or uploaded.');
    assert.ok(Object.keys(options).every(key => ['form', 'raw'].includes(key)), 'D1/cron/provider operations are forbidden.');
    if (options.form) assert.equal(suffix, BASE, 'Only the main module upload is writable.');
    return api(suffix, options);
  };
}

async function sourceInputs() {
  const compiled = await build({ entryPoints: ['server/full-worker.mjs'], absWorkingDir: ROOT, bundle: true, write: false, metafile: true,
    platform: 'browser', format: 'esm', target: 'es2022', minify: false, sourcemap: false, logLevel: 'silent' });
  assert.equal(compiled.outputFiles.length, 1, 'Unexpected bundled module count.');
  const files = new Set([...Object.keys(compiled.metafile.inputs), ...HELPERS, 'package.json', 'package-lock.json']);
  const inputs = {};
  for (const filename of [...files].sort()) {
    const relative = path.relative(ROOT, path.resolve(ROOT, filename)).split(path.sep).join('/');
    assert.ok(!relative.startsWith('../') && !path.isAbsolute(relative), 'Source outside repository.');
    inputs[relative] = hash(await readFile(path.join(ROOT, relative)));
  }
  const { stdout } = await execute('git', ['status', '--porcelain', '--untracked-files=all', '--', 'server', ...Object.keys(inputs)], { cwd: ROOT, windowsHide: true });
  assert.equal(stdout.trim(), '', 'Commit and review all source and release helper changes before planning.');
  return { inputs, module: Buffer.from(compiled.outputFiles[0].contents) };
}

async function plan(dir) {
  const provenance = await getBackendProvenance(ROOT, { requireClean: true });
  const source = await sourceInputs();
  const api = await authenticatedClient();
  const before = await snapshotWorker(api, NAME);
  const specification = policyUploadPlan(before);
  const assets = await publicManifest();
  assertLease(before, await snapshotWorker(api, NAME));
  // This is a worker snapshot only. No database is mutated by this release.
  const preflight = { worker: before, assets };
  const privacy = Buffer.from(await privacyPageResponse('GET').arrayBuffer());
  const review = { schemaVersion: 1, operation: 'ios-policy-and-privacy-backend-only', createdAt: new Date().toISOString(), ...provenance,
    sourceInputs: source.inputs, preflightSHA256: hash(canonical(preflight)), specification,
    bundleSHA256: hash(source.module), bundleBytes: source.module.length, privacySHA256: hash(privacy),
    policyEnabled: false, noDatabaseChanges: true, noCronChanges: true, noRoomsChanges: true, noDOMigration: true, keepAssets: true };
  await savePrivate(dir, 'preflight', preflight);
  await savePrivate(dir, `${NAME}.mjs`, source.module);
  await savePrivate(dir, 'deployment-plan', review);
  return { directory: dir, planSHA256: hash(canonical(review)), sourceCommit: provenance.sourceCommit,
    sourceServerTree: provenance.sourceServerTree, bundleSHA256: review.bundleSHA256, previousVersion: before.versionId,
    publicAssetsChecked: assets.entries.length, policyEnabled: false, applied: false,
    metadataChanges: { run_worker_firstAdded: specification.metadata.assets.config.run_worker_first
      .filter(route => !assetsConfig(before.version.resources.script_runtime.assets).run_worker_first.includes(route)) },
    mutationsPlanned: ['Upload reviewed maydan-game module with keep_assets=true and inherited bindings'] };
}

async function reviewed(dir, digest, requireFresh = false) {
  assert.match(digest || '', /^[a-f0-9]{64}$/, 'Pass the exact reviewed plan SHA-256.');
  const review = await loadPrivate(dir, 'deployment-plan');
  assert.equal(hash(canonical(review)), digest, 'Plan digest differs from the reviewed digest.');
  assert.equal(review.operation, 'ios-policy-and-privacy-backend-only');
  const before = await loadPrivate(dir, 'preflight');
  assert.equal(hash(canonical(before)), review.preflightSHA256, 'Original worker snapshot integrity failed.');
  assert.deepEqual(policyUploadPlan(before.worker), review.specification, 'Unapproved metadata delta.');
  if (requireFresh) {
    const age = Date.now() - Date.parse(review.createdAt);
    assert.ok(age >= 0 && age < 30 * 60_000, 'Plan is older than 30 minutes; take a fresh read-only plan.');
  }
  return { review, before };
}

async function verifyPublic(privacySHA256) {
  const checks = [];
  for (const pathname of ['/privacy', '/privacy/']) {
    const response = await fetch(ORIGIN + pathname, { redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'cache-control': 'no-cache' } });
    assert.equal(response.status, 200, 'Public privacy route unavailable.');
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), privacySHA256, 'Public privacy copy differs from the reviewed page.');
    assert.ok(response.headers.get('content-type')?.startsWith('text/html'), 'Wrong privacy content type.');
    checks.push(pathname);
  }
  const health = await fetch(ORIGIN + '/health', { redirect: 'error', signal: AbortSignal.timeout(20_000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true, 'Existing health API failed.');
  const policy = await fetch(ORIGIN + '/api/app-policy/ios?storefront=JOR&osVersion=26.6.1', { redirect: 'error', signal: AbortSignal.timeout(20_000) });
  assert.equal(policy.status, 200);
  assert.equal(policy.headers.get('cache-control'), 'no-store');
  const body = await policy.json();
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.enabled, false, 'Mandatory update must remain disabled.');
  assert.equal(body.minimumBuild, 0);
  assert.equal(body.minimumVersion, null);
  assert.equal(body.appStoreId, '6808385717');
  return { privacyPaths: checks, policyDisabled: true, healthPassed: true };
}

async function verify(dir, digest, api = null, uploadVersionId = null) {
  const { review, before } = await reviewed(dir, digest);
  api ||= await authenticatedClient();
  const current = await snapshotWorker(api, NAME);
  if (uploadVersionId) assert.equal(current.versionId, uploadVersionId, 'Active version differs from the uploaded version.');
  await assertDeployedBundle(current.script, NAME, review.bundleSHA256);
  assertPolicyDeployment(before.worker, current, review.specification);
  const assets = await publicManifest(before.assets.paths);
  assertAssetsUnchanged(before.assets, assets);
  const smoke = await verifyPublic(review.privacySHA256);
  assertLease(current, await snapshotWorker(api, NAME));
  const receipt = { verifiedAt: new Date().toISOString(), planSHA256: digest, sourceCommit: review.sourceCommit, versionId: current.versionId,
    bundleSHA256: review.bundleSHA256, publicAssetsUnchanged: true, assetsChecked: assets.entries.length, bindingsUnchanged: true,
    schedulesUnchanged: true, migrationTag: 'v3-lamma', ...smoke };
  await savePrivate(dir, `verification-${new Date().toISOString().replace(/[:.]/g, '-')}`, receipt);
  return receipt;
}

async function apply(dir, digest) {
  const { review, before } = await reviewed(dir, digest, true);
  const currentSource = await sourceInputs();
  assert.deepEqual(currentSource.inputs, review.sourceInputs, 'Source/helper changed after review.');
  assert.equal(hash(currentSource.module), review.bundleSHA256, 'Rebuilt worker differs from the reviewed bundle.');
  const provenance = await getBackendProvenance(ROOT, { requireClean: true });
  assert.equal(provenance.backendTreeSha256, review.backendTreeSha256, 'Backend changed after review.');
  assert.equal(provenance.sourceServerTree, review.sourceServerTree, 'Server commit tree changed after review.');
  const module = await loadPrivate(dir, `${NAME}.mjs`, true);
  assert.equal(hash(module), review.bundleSHA256, 'Encrypted reviewed module integrity failed.');
  const api = await authenticatedClient(true);
  assertAssetsUnchanged(before.assets, await publicManifest(before.assets.paths));
  assertLease(before.worker, await snapshotWorker(api, NAME));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const journal = { planSHA256: digest, startedAt: new Date().toISOString(), phase: 'preconditions-passed', writeAttempted: false };
  await writeFile(path.join(dir, 'apply.lock'), JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
  const record = async phase => { journal.phase = phase; await writeFile(path.join(dir, 'apply-progress.json'), JSON.stringify(journal, null, 2), { mode: 0o600 }); };
  const form = new FormData();
  form.set('metadata', new Blob([JSON.stringify(review.specification.metadata)], { type: 'application/json' }));
  form.set(`${NAME}.mjs`, new File([module], `${NAME}.mjs`, { type: 'application/javascript+module' }));
  try {
    // The closest available optimistic lease: the API has no metadata CAS field.
    assertLease(before.worker, await snapshotWorker(api, NAME));
    journal.writeAttempted = true;
    await record('upload-request-started');
    const uploaded = await api(BASE, { form });
    await record('upload-returned');
    const candidate = uploaded?.version_id || uploaded?.id;
    const uploadVersion = /^[a-f0-9-]{36}$/.test(candidate || '') ? candidate : null;
    const result = await verify(dir, digest, api, uploadVersion);
    await record('verified');
    return { ...result, applied: true };
  } catch (error) {
    await record('stopped-reconciliation-required');
    // Do not blindly re-upload or roll back: a network failure may be after the
    // production write. The encrypted snapshot permits a separately reviewed
    // main-only roll-forward/recovery after inspecting current live state.
    throw error;
  }
}

async function main() {
  const [command, suppliedDir, digest, ...extra] = process.argv.slice(2);
  assert.ok(['--plan', '--apply', '--verify'].includes(command) && extra.length === 0, 'Use --plan [private-dir], --apply <private-dir> <reviewed-sha256>, or --verify <private-dir> <reviewed-sha256>.');
  if (command !== '--plan') assert.ok(suppliedDir && digest, 'Use the exact plan directory and SHA-256.');
  if (command === '--plan') assert.equal(digest, undefined, 'Unexpected plan argument.');
  const dir = privateDirectory(suppliedDir);
  const result = command === '--plan' ? await plan(dir) : command === '--apply' ? await apply(dir, digest) : await verify(dir, digest);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ failed: true, message: error instanceof assert.AssertionError ? error.message.split('\n')[0]
    : 'Policy deployment stopped; credentials and response bodies suppressed. Inspect the private journal before any retry.' })); process.exitCode = 1; });
}
