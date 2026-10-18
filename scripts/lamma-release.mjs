// Default modes are read-only. The separately coordinated --apply mode requires
// an exact reviewed plan digest, fresh encrypted backup, passing live-provider
// evidence and unchanged live metadata. No secret update or TestFlight upload.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { getBackendProvenance } from './lib/lamma-provenance.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ACCOUNT = '3fa113e56f10150f13618f641b9fe98e';
const DATABASE = '9d863a31-6a5c-45f1-91f5-79ad400c3f6e';
const WORKERS = ['maydan-game', 'maydan-rooms'];
const ORIGIN = 'https://maydan-game.mf103871.workers.dev';
const PRIVATE = path.join(homedir(), '.codex', 'private', 'maydan-lamma-release');
const execute = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MIGRATIONS_QUERY = 'SELECT name FROM d1_migrations ORDER BY id';
const SOURCE_PATHS = ['server', 'package.json', 'package-lock.json', 'src/shared/account/config.js'];
const PROVIDER_CHECKS = [
  'preview capability and accepted synthetic friendships',
  'direct real audio, other-device guard, and room-ending token revocation',
  'twelve accepted group members connect and receive actual audio',
  'real provider join webhooks bind every participant SID',
  'blocking revokes media and old token while unrelated group members stay connected',
  'voluntary provider disconnect triggers authenticated webhook departure',
  'group room end revokes remaining tokens and drains RoomService jobs',
];
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function activeVersion(deployments) {
  const active = deployments?.deployments?.[0];
  assert.equal(active?.versions?.length, 1, 'Mixed production rollout: stop and reconcile before release.');
  assert.equal(active.versions[0].percentage, 100, 'Production must have exactly one fully active version.');
  return active.versions[0].version_id;
}

export function assertLatestActive(versions, activeId) {
  assert.equal(versions?.items?.[0]?.id, activeId, 'Latest uploaded version differs from the deployed version; inherited bindings could be unsafe.');
}

export function leaseOf(snapshot) {
  return hash(canonical({ versionId: snapshot.versionId, latestVersionId: snapshot.latestVersionId, settings: snapshot.settings,
    runtime: snapshot.version.resources.script_runtime, schedules: snapshot.schedules }));
}

export function assertLease(before, current) {
  assert.equal(leaseOf(current), leaseOf(before), 'Live worker changed since preflight; take a fresh snapshot and review again.');
}

export function assetsConfig(runtimeAssets) {
  assert.ok(runtimeAssets?.not_found_handling, 'Missing current asset routing configuration.');
  const config = {};
  for (const key of ['base_path', 'html_handling', 'not_found_handling']) if (runtimeAssets[key] !== undefined) config[key] = runtimeAssets[key];
  config.run_worker_first = runtimeAssets.raw_run_worker_first ?? runtimeAssets.static_routing?.user_worker;
  for (const key of ['headers', 'redirects']) if (runtimeAssets[`raw_${key}`] !== undefined) config[`_${key}`] = runtimeAssets[`raw_${key}`];
  assert.ok(Array.isArray(config.run_worker_first) && config.run_worker_first.includes('/api/*'), 'Unexpected live API asset routing.');
  return config;
}

export function uploadPlan(name, snapshot) {
  assert.ok(WORKERS.includes(name));
  const bindings = snapshot.settings.bindings;
  const db = bindings.find(binding => binding.name === 'DB');
  assert.equal(db?.id || db?.database_id, DATABASE, 'Production database binding changed.');
  assert.ok(bindings.some(binding => binding.name === 'SESSION_SECRET' && binding.type === 'secret_text'));
  const secretTypes = ['secret_text', 'secret_key'];
  // Inherit bindings by name: never round-trip a secret value or overwrite live
  // billing/provider variables with the repository's older defaults.
  const metadata = { main_module: `${name}.mjs`,
    bindings: bindings.filter(binding => !secretTypes.includes(binding.type)).map(binding => ({ name: binding.name, type: 'inherit' })),
    keep_bindings: secretTypes, compatibility_date: snapshot.settings.compatibility_date,
    compatibility_flags: snapshot.settings.compatibility_flags || [],
    annotations: { 'workers/message': 'Lamma backend only; preserve existing public assets' } };
  for (const key of ['placement', 'logpush', 'observability', 'tail_consumers', 'tags', 'limits']) {
    if (snapshot.settings[key] !== undefined) metadata[key] = snapshot.settings[key];
  }
  const audio = bindings.find(binding => binding.name === 'SOCIAL_AUDIO');
  if (audio) assert.equal(audio.bucket_name, 'maydan-social-audio', 'Preview audio bucket forbidden in production.');
  else metadata.bindings.push({ name: 'SOCIAL_AUDIO', type: 'r2_bucket', bucket_name: 'maydan-social-audio' });
  const jobs = bindings.find(binding => binding.name === 'SOCIAL_JOBS');
  if (!jobs) metadata.bindings.push({ name: 'SOCIAL_JOBS', type: 'durable_object_namespace', class_name: 'LammaJobs',
    ...(name === 'maydan-rooms' ? { script_name: 'maydan-game' } : {}) });
  else {
    assert.equal(jobs.class_name, 'LammaJobs');
    assert.equal(jobs.script_name || name, 'maydan-game');
  }
  const runtime = snapshot.version.resources.script_runtime;
  if (name === 'maydan-game') {
    assert.ok(bindings.some(binding => binding.name === 'ASSETS' && binding.type === 'assets'));
    metadata.keep_assets = true;
    metadata.assets = { config: assetsConfig(runtime.assets) };
    assert.ok(['v2-social', 'v3-lamma'].includes(runtime.migration_tag), 'Unexpected production DO migration; do not guess its history.');
    if (runtime.migration_tag === 'v2-social') metadata.migrations = { old_tag: 'v2-social', new_tag: 'v3-lamma', steps: [{ new_sqlite_classes: ['LammaJobs'] }] };
  } else assert.equal(runtime.migration_tag, 'v1', 'Unexpected rooms DO migration.');
  const cron = (snapshot.schedules?.schedules || []).map(schedule => ({ cron: schedule.cron }));
  if (name === 'maydan-game' && !cron.some(item => item.cron === '* * * * *')) cron.push({ cron: '* * * * *' });
  if (name === 'maydan-rooms') assert.ok(!cron.some(item => item.cron === '* * * * *'), 'Rooms must not duplicate the new minute jobs cron.');
  return { metadata, schedules: cron, lease: leaseOf(snapshot) };
}

export function referencedPaths(documents) {
  const paths = new Set(['/','/index.html','/sw.js','/manifest.webmanifest','/online.config.json']);
  for (const source of documents) for (const match of source.matchAll(/(?:\.\/)?(?:media|audio|icons|assets)\/[A-Za-z0-9_./%+-]+\.(?:webp|png|jpe?g|gif|svg|m4a|mp3|ogg|wav|webm|json|js|css)/g)) {
    const pathname = '/' + match[0].replace(/^\.\//, '');
    if (!pathname.includes('..')) paths.add(pathname);
  }
  return [...paths].sort();
}

export function assertAssetsUnchanged(before, after) {
  assert.deepEqual(after, before, 'Public asset bytes or security/routing headers changed. Do not release TestFlight.');
}

async function auth() {
  const { stdout } = await execute(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'auth', 'token', '--json'],
    { cwd: ROOT, timeout: 30_000, windowsHide: true, maxBuffer: 1_048_576 });
  const value = JSON.parse(stdout);
  assert.ok(value.token && ['oauth', 'api', 'oauth_token', 'api_token'].some(type => String(value.type).toLowerCase().includes(type)), 'Unsupported Wrangler auth result.');
  return value.token;
}

export function apiClient(token, allowApply = false) {
  return async (suffix, { exportBody, readMigrations = false, form, schedules, raw = false } = {}) => {
    // Hard route allowlist. POST only exports D1 or runs one fixed read query.
    assert.ok(/^\/workers\/scripts\/(maydan-game|maydan-rooms)(\/(settings|deployments|schedules|versions(?:\/[a-f0-9-]+)?))?$/.test(suffix)
      || suffix === '/workers/scripts/maydan-lamma-preview/deployments'
      || suffix === `/d1/database/${DATABASE}/export` || suffix === `/d1/database/${DATABASE}/query`
      || /^\/r2\/buckets\/maydan-social-audio(?:\/domains\/(managed|custom))?$/.test(suffix), 'Unapproved Cloudflare API path.');
    if (exportBody) assert.equal(suffix, `/d1/database/${DATABASE}/export`);
    if (readMigrations) assert.equal(suffix, `/d1/database/${DATABASE}/query`);
    if (form || schedules) {
      assert.equal(allowApply, true, 'Read-only API client refuses production writes.');
      assert.ok(form ? /^\/workers\/scripts\/(maydan-game|maydan-rooms)$/.test(suffix) : /^\/workers\/scripts\/(maydan-game|maydan-rooms)\/schedules$/.test(suffix));
    }
    const jsonBody = exportBody || (readMigrations ? { sql: MIGRATIONS_QUERY, params: [] } : schedules);
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${suffix}${form ? '?bindings_inherit=strict' : ''}`, {
      method: form || schedules ? 'PUT' : jsonBody ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(120_000),
      headers: { Authorization: `Bearer ${token}`, ...(jsonBody ? { 'content-type': 'application/json' } : {}) },
      ...(form ? { body: form } : jsonBody ? { body: JSON.stringify(jsonBody) } : {}) });
    assert.ok(response.ok, `Cloudflare preflight HTTP ${response.status}; response body suppressed.`);
    if (raw) return { contentType: response.headers.get('content-type'), base64: Buffer.from(await response.arrayBuffer()).toString('base64') };
    const data = await response.json();
    assert.equal(data.success, true, 'Cloudflare preflight rejected; response body suppressed.');
    return data.result;
  };
}

function privateDirectory(value) {
  const dir = path.resolve(value || path.join(PRIVATE, new Date().toISOString().replace(/[:.]/g, '-')));
  const relative = path.relative(PRIVATE, dir);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Release records must be inside the private release directory.');
  return dir;
}

async function protect(bytes, decrypt = false) {
  assert.equal(process.platform, 'win32', 'This release helper requires Windows DPAPI; do not save plaintext production backups.');
  const script = `Add-Type -AssemblyName System.Security; $inputBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd()); $result = [Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($inputBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 512 * 1024 * 1024 },
      (error, stdout) => error ? reject(new Error('Private backup encryption failed; no contents were logged.')) : resolve(Buffer.from(stdout, 'base64')));
    child.stdin.end(bytes.toString('base64'));
  });
}
export async function savePrivate(dir, name, value) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(dir, `${name}.dpapi`), await protect(Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))), { mode: 0o600, flag: 'wx' });
}
export async function loadPrivate(dir, name, raw = false) {
  const bytes = await protect(await readFile(path.join(dir, `${name}.dpapi`)), true);
  return raw ? bytes : JSON.parse(bytes);
}

export async function snapshotWorker(api, name) {
  const base = `/workers/scripts/${name}`;
  const [settings, deployments, schedules, versions] = await Promise.all([api(`${base}/settings`), api(`${base}/deployments`), api(`${base}/schedules`), api(`${base}/versions`)]);
  const versionId = activeVersion(deployments), version = await api(`${base}/versions/${versionId}`);
  assertLatestActive(versions, versionId);
  const script = await api(base, { raw: true });
  assert.equal(activeVersion(await api(`${base}/deployments`)), versionId, 'Worker changed while backing it up.');
  assertLatestActive(await api(`${base}/versions`), versionId);
  return { settings, deployments, schedules, versionId, latestVersionId: versions.items[0].id, version, script };
}

async function publicAsset(pathname) {
  assert.ok(pathname.startsWith('/') && !pathname.startsWith('//') && !pathname.includes('..'));
  const response = await fetch(ORIGIN + pathname, { redirect: 'follow', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(40_000) });
  assert.equal(new URL(response.url).origin, ORIGIN, 'Public asset redirected off-site.');
  assert.equal(response.status, 200, `Public asset unavailable: ${pathname}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const headers = Object.fromEntries(['content-type', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'cache-control'].map(key => [key, response.headers.get(key)]));
  return { entry: { path: pathname, finalPath: new URL(response.url).pathname, sha256: hash(bytes), bytes: bytes.length, headers }, bytes };
}

export async function publicManifest(paths) {
  const entryDocs = await Promise.all(['/','/sw.js','/manifest.webmanifest'].map(publicAsset));
  const discovered = referencedPaths(entryDocs.map(item => item.bytes.toString('utf8')));
  if (paths) assert.deepEqual(discovered, paths, 'The live frontend reference list changed.');
  const remaining = [...discovered], entries = [];
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (remaining.length) entries.push((await publicAsset(remaining.shift())).entry);
  }));
  return { paths: discovered, entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
    coverage: 'Entry documents and their explicit local asset references; API does not expose the complete stored asset manifest. keep_assets preserves that full set.' };
}

async function preflight(dir) {
  const api = apiClient(await auth()), snapshots = {};
  for (const name of WORKERS) snapshots[name] = await snapshotWorker(api, name);
  const manifest = await publicManifest();
  for (const name of WORKERS) assertLease(snapshots[name], await snapshotWorker(api, name));
  const migrations = await api(`/d1/database/${DATABASE}/query`, { readMigrations: true });
  assert.ok(migrations.every(item => item.success), 'Could not read the production migration ledger.');
  const snapshot = { createdAt: new Date().toISOString(), accountId: ACCOUNT, databaseId: DATABASE, workers: snapshots, public: manifest,
    migrations: migrations.flatMap(item => item.results).map(item => item.name) };
  await savePrivate(dir, 'preflight', snapshot);
  const summary = { directory: dir, createdAt: snapshot.createdAt, versions: Object.fromEntries(WORKERS.map(name => [name, snapshots[name].versionId])),
    assetsVerified: manifest.entries.length, publicManifestSHA256: hash(canonical(manifest)), productionChanged: false };
  await writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600, flag: 'wx' });
  return summary;
}

async function backup(dir) {
  const before = await loadPrivate(dir, 'preflight'), api = apiClient(await auth());
  for (const name of WORKERS) assertLease(before.workers[name], await snapshotWorker(api, name));
  let result, bookmark; const deadline = Date.now() + 10 * 60_000;
  do {
    result = await api(`/d1/database/${DATABASE}/export`, { exportBody: { output_format: 'polling', dump_options: { no_schema: false, no_data: false, tables: [] }, ...(bookmark ? { current_bookmark: bookmark } : {}) } });
    assert.ok(result.success && result.status !== 'error', 'D1 export failed; response suppressed.');
    if (result.status === 'complete') break;
    bookmark = result.at_bookmark; assert.ok(bookmark && Date.now() < deadline, 'D1 export timed out.'); await sleep(3000);
  } while (true);
  const url = new URL(result.result.signed_url);
  assert.ok(url.protocol === 'https:' && !url.username && !url.password, 'Invalid D1 export download.');
  // No Cloudflare bearer is sent to the separately signed download URL.
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  assert.ok(response.ok, 'D1 export download failed.');
  const sql = Buffer.from(await response.arrayBuffer());
  assert.ok(sql.length > 100 && sql.includes(Buffer.from('CREATE TABLE')), 'D1 export is not a complete schema/data backup.');
  await savePrivate(dir, 'production-d1.sql', sql);
  assert.equal(hash(await loadPrivate(dir, 'production-d1.sql', true)), hash(sql), 'Encrypted backup round-trip verification failed.');
  const receipt = { completedAt: new Date().toISOString(), bytes: sql.length, sha256: hash(sql), bookmark: result.at_bookmark || bookmark || null };
  await savePrivate(dir, 'd1-receipt', receipt);
  return { directory: dir, backupComplete: true, bytes: sql.length, sha256: receipt.sha256, productionDataMutated: false };
}

async function plan(dir) {
  const snapshot = await loadPrivate(dir, 'preflight');
  const plans = Object.fromEntries(WORKERS.map(name => [name, uploadPlan(name, snapshot.workers[name])]));
  await cleanSourceCommit();
  const provenance = await getBackendProvenance(ROOT, { requireClean: true });
  const migration = await readFile(path.join(ROOT, 'server/migrations/0008_lamma.sql'));
  const migrationNames = (await readdir(path.join(ROOT, 'server/migrations'))).filter(name => name.endsWith('.sql')).sort();
  const pendingMigrations = migrationNames.filter(name => !snapshot.migrations.includes(name));
  assert.deepEqual(pendingMigrations, ['0008_lamma.sql'], 'This helper authorizes only additive migration 0008; reconcile other migrations separately.');
  const bundles = {}, sourceInputs = {};
  for (const name of WORKERS) {
    const compiled = await build({ entryPoints: [path.join(ROOT, 'server', name === 'maydan-game' ? 'full-worker.mjs' : 'worker.mjs')],
      absWorkingDir: ROOT, bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', minify: false, sourcemap: false, logLevel: 'silent' });
    assert.equal(compiled.outputFiles.length, 1);
    const bytes = Buffer.from(compiled.outputFiles[0].contents); bundles[name] = { sha256: hash(bytes), bytes: bytes.length };
    for (const filename of Object.keys(compiled.metafile.inputs)) sourceInputs[filename] = hash(await readFile(path.resolve(ROOT, filename)));
    await savePrivate(dir, `${name}.mjs`, bytes);
  }
  for (const filename of SOURCE_PATHS.filter(filename => filename !== 'server')) sourceInputs[filename] = hash(await readFile(path.join(ROOT, filename)));
  const review = { ...provenance, createdAt: new Date().toISOString(), plans, bundles, sourceInputs, pendingMigrations, migrationSHA256: hash(migration),
    helperSHA256: hash(await readFile(fileURLToPath(import.meta.url))),
    provenanceHelperSHA256: hash(await readFile(path.join(ROOT, 'scripts/lib/lamma-provenance.mjs'))),
    blockers: ['Live provider revocation must pass before backend deployment; actual-device acceptance gates public UI release.', 'Production providers/private R2 must be provisioned and re-preflighted.',
      'Encrypted D1 export required immediately before additive migration 0008.', 'New DO migration prevents rollback across this lifecycle change.',
      'Recheck metadata leases immediately before any coordinated upload. --apply requires the exact plan digest.'],
    sequence: ['Verify live provider acceptance', 'Re-preflight after production resource provisioning', 'Export D1', 'Apply additive SQL migration 0008',
      'Upload maydan-game keep_assets multipart with LammaJobs migration', 'Upload maydan-rooms', 'Add minute cron on main only',
      'Verify assets and old-client API compatibility', 'Upload native build to internal TestFlight group only'] };
  await savePrivate(dir, 'deployment-plan', review);
  return { directory: dir, sourceCommit: review.sourceCommit, sourceServerTree: review.sourceServerTree, backendTreeSha256: review.backendTreeSha256,
    workerPlans: plans, bundles, pendingMigrations, migrationSHA256: review.migrationSHA256,
    planSHA256: hash(canonical(review)), planReady: true, applied: false };
}

export function assertProviderEvidence(report, now = Date.now()) {
  assert.equal(report?.passed, true, 'Live provider acceptance is not passing.');
  assert.equal(report.origin, 'https://maydan-lamma-preview.mf103871.workers.dev');
  assert.ok(!report.preflightOnly && Array.isArray(report.checks) && report.checks.every(check => check.passed), 'Incomplete live provider evidence.');
  for (const name of PROVIDER_CHECKS) assert.ok(report.checks.some(check => check.name === name && check.passed), `Missing live acceptance check: ${name}`);
  assert.equal(report.maximumConnectedParticipants, 12, 'Real twelve-peer media test required.');
  assert.match(report.sourceCommit || '', /^[a-f0-9]{40}$/);
  assert.match(report.sourceServerTree || '', /^[a-f0-9]{40}$/);
  assert.match(report.backendTreeSha256 || '', /^[a-f0-9]{64}$/);
  assert.match(report.previewDeploymentVersion || '', /^[a-f0-9-]{36}$/, 'Provider report must identify the tested preview deployment.');
  assert.ok(report.finishedAt && now - Date.parse(report.finishedAt) < 24 * 60 * 60_000 && now >= Date.parse(report.finishedAt), 'Provider evidence is expired or future-dated.');
  assert.ok(report.cleanup && report.cleanup.providerJobsRemaining === 0 && !report.cleanup.verificationFailed && report.cleanup.remainingUsersAndSessions === 0
    && report.cleanup.accountsSeeded === 12 && report.cleanup.accountsDeleted === 12
    && report.cleanup.callsCreated > 0 && report.cleanup.callEndRequestsAccepted === report.cleanup.callsCreated, 'Provider cleanup incomplete.');
}

export function assertProvenance(review, current, evidence) {
  for (const key of ['sourceServerTree', 'backendTreeSha256']) {
    assert.equal(current[key], review[key], 'Backend source changed after plan review.');
    assert.equal(evidence[key], review[key], 'Provider acceptance tested different backend source.');
  }
  // sourceCommit may differ for later documentation/release-tool-only commits.
}

async function cleanSourceCommit() {
  const options = { cwd: ROOT, windowsHide: true };
  const { stdout: dirty } = await execute('git', ['status', '--porcelain', '--untracked-files=all', '--', ...SOURCE_PATHS], options);
  assert.equal(dirty.trim(), '', 'Commit and review all backend source changes, including untracked files, before making the release plan.');
  const { stdout: commit } = await execute('git', ['rev-parse', 'HEAD'], options);
  return commit.trim();
}

export function migrationConfig() {
  return { name: 'maydan-release-d1', account_id: ACCOUNT, compatibility_date: '2026-09-01',
    d1_databases: [{ binding: 'DB', database_name: 'maydan-accounts', database_id: DATABASE, migrations_dir: path.join(ROOT, 'server/migrations') }] };
}

export function assertPrivateBucket(managed, custom) {
  assert.equal(managed.enabled, false, 'Production audio bucket has public r2.dev access.');
  assert.ok(Array.isArray(custom.domains) && custom.domains.every(domain => domain.enabled === false), 'Production audio bucket has an enabled public custom domain.');
}

export async function assertDeployedBundle(script, name, expectedDigest) {
  const bytes = Buffer.from(script.base64, 'base64');
  const response = new Response(bytes, { headers: { 'content-type': script.contentType } });
  const form = await response.formData();
  const main = form.get(`${name}.mjs`);
  assert.ok(typeof main === 'string' || (main && typeof main.arrayBuffer === 'function'), 'Reviewed module is missing from the live worker.');
  // Cloudflare's download response can omit filename=, which FormData parses
  // as a text field. Both representations must verify the same UTF-8 bytes.
  const source = typeof main === 'string' ? Buffer.from(main, 'utf8') : Buffer.from(await main.arrayBuffer());
  assert.equal(hash(source), expectedDigest, 'Live worker code differs from the reviewed bundle.');
}

export function expectedSchedules(name, review, recovery) {
  if (!recovery || name !== 'maydan-rooms') return review.plans[name].schedules;
  assert.equal(recovery.operation, 'deduplicate-rooms-daily-cron');
  assert.equal(recovery.originalPlanSHA256, hash(canonical(review)), 'Recovery receipt refers to another release plan.');
  assert.deepEqual(recovery.previousRoomsSchedules, [{ cron: '17 3 * * *' }]);
  assert.deepEqual(review.plans['maydan-rooms'].schedules, recovery.previousRoomsSchedules);
  assert.deepEqual(recovery.expectedRoomsSchedules, []);
  assert.equal(recovery.writesCompleted, true, 'Recovery writes have not completed.');
  return [];
}

async function apply(dir, expectedDigest, evidencePath) {
  assert.match(expectedDigest || '', /^[a-f0-9]{64}$/, 'Pass the reviewed plan SHA-256 explicitly.');
  const review = await loadPrivate(dir, 'deployment-plan');
  assert.equal(hash(canonical(review)), expectedDigest, 'The release plan differs from the reviewed digest.');
  assert.equal(hash(await readFile(fileURLToPath(import.meta.url))), review.helperSHA256, 'Release helper changed after plan review.');
  assert.equal(hash(await readFile(path.join(ROOT, 'scripts/lib/lamma-provenance.mjs'))), review.provenanceHelperSHA256, 'Provenance helper changed after plan review.');
  const evidence = JSON.parse(await readFile(evidencePath || '', 'utf8'));
  assertProviderEvidence(evidence);
  const snapshot = await loadPrivate(dir, 'preflight'), receipt = await loadPrivate(dir, 'd1-receipt');
  const backupSQL = await loadPrivate(dir, 'production-d1.sql', true);
  assert.equal(hash(backupSQL), receipt.sha256, 'Encrypted D1 backup integrity failed.');
  assert.ok(Date.now() >= Date.parse(receipt.completedAt) && Date.now() - Date.parse(receipt.completedAt) < 30 * 60_000, 'Take a fresh D1 backup before migration (maximum age 30 minutes).');
  await cleanSourceCommit();
  assertProvenance(review, await getBackendProvenance(ROOT, { requireClean: true }), evidence);
  for (const [filename, digest] of Object.entries(review.sourceInputs)) assert.equal(hash(await readFile(path.resolve(ROOT, filename))), digest, 'Bundled dependency changed after plan review.');
  assert.equal(hash(await readFile(path.join(ROOT, 'server/migrations/0008_lamma.sql'))), review.migrationSHA256);
  const api = apiClient(await auth(), true);
  assert.equal(activeVersion(await api('/workers/scripts/maydan-lamma-preview/deployments')), evidence.previewDeploymentVersion, 'Preview deployment changed after provider acceptance.');
  for (const name of WORKERS) {
    assertLease(snapshot.workers[name], await snapshotWorker(api, name));
    const names = new Set(snapshot.workers[name].settings.bindings.map(binding => binding.name));
    for (const required of ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY']) assert.ok(names.has(required), `Missing production provider setting ${name}/${required}; re-preflight after provisioning.`);
  }
  await api('/r2/buckets/maydan-social-audio');
  const [managed, custom] = await Promise.all(['managed', 'custom'].map(type => api(`/r2/buckets/maydan-social-audio/domains/${type}`)));
  assertPrivateBucket(managed, custom);
  const ledger = await api(`/d1/database/${DATABASE}/query`, { readMigrations: true });
  assert.deepEqual(ledger.flatMap(item => item.results).map(item => item.name), snapshot.migrations, 'D1 migrations changed since preflight.');
  assertAssetsUnchanged(snapshot.public, await publicManifest(snapshot.public.paths));
  // Fail before any write if a module no longer matches its reviewed fingerprint.
  const modules = {};
  for (const name of WORKERS) {
    modules[name] = await loadPrivate(dir, `${name}.mjs`, true);
    assert.equal(hash(modules[name]), review.bundles[name].sha256);
  }
  const journal = { startedAt: new Date().toISOString(), planSHA256: expectedDigest, phases: [] };
  // An interrupted/partial rollout requires investigation, never an automatic
  // rerun that could apply the SQL migration or overwrite a changed worker.
  await writeFile(path.join(dir, 'apply.lock'), JSON.stringify({ startedAt: journal.startedAt, planSHA256: expectedDigest }), { mode: 0o600, flag: 'wx' });
  const record = async phase => { journal.phases.push(phase); await writeFile(path.join(dir, 'apply-progress.json'), JSON.stringify(journal, null, 2), { mode: 0o600 }); };
  await record('All preconditions passed; starting the coordinated production migration.');
  // No credentials or SQL in argv. Wrangler applies the exact pending migration
  // through its migration ledger; all output is captured and suppressed.
  const configPath = path.join(dir, 'migration-config.json');
  await writeFile(configPath, JSON.stringify(migrationConfig()), { mode: 0o600, flag: 'wx' });
  await execute(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', 'maydan-accounts', '--remote', '--config', configPath],
    { cwd: ROOT, windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, CI: 'true' } });
  await record('Additive D1 migration completed.');
  for (const name of WORKERS) {
    assertLease(snapshot.workers[name], await snapshotWorker(api, name));
    const form = new FormData(), specification = review.plans[name];
    form.set('metadata', new Blob([JSON.stringify(specification.metadata)], { type: 'application/json' }));
    form.set(`${name}.mjs`, new File([modules[name]], `${name}.mjs`, { type: 'application/javascript+module' }));
    await api(`/workers/scripts/${name}`, { form });
    await record(`${name} backend uploaded; public assets retained.`);
    if (name === 'maydan-game') assertAssetsUnchanged(snapshot.public, await publicManifest(snapshot.public.paths));
    if (name === 'maydan-game') await api(`/workers/scripts/${name}/schedules`, { schedules: specification.schedules });
  }
  const result = await verify(dir);
  await record('Original assets, settings and bindings verified. TestFlight has not been uploaded.');
  return { ...result, applied: true, testFlightUploaded: false };
}

export async function verify(dir) {
  const before = await loadPrivate(dir, 'preflight'), api = apiClient(await auth());
  const review = await loadPrivate(dir, 'deployment-plan');
  let recovery;
  try { recovery = await loadPrivate(dir, 'recovery-receipt'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const current = await publicManifest(before.public.paths);
  assertAssetsUnchanged(before.public, current);
  const now = {};
  for (const name of WORKERS) now[name] = await snapshotWorker(api, name);
  assert.deepEqual(now['maydan-game'].version.resources.script_runtime.assets, before.workers['maydan-game'].version.resources.script_runtime.assets,
    'Full public asset routing/header configuration changed.');
  for (const name of WORKERS) {
    await assertDeployedBundle(now[name].script, name, review.bundles[name].sha256);
    const bindings = new Map(now[name].settings.bindings.map(binding => [binding.name, binding]));
    for (const old of before.workers[name].settings.bindings) assert.deepEqual(bindings.get(old.name), old, `Existing ${name} binding changed: ${old.name}`);
    for (const key of ['compatibility_date', 'compatibility_flags', 'placement', 'logpush', 'observability', 'tail_consumers', 'tags', 'limits']) {
      assert.deepEqual(now[name].settings[key], before.workers[name].settings[key], `Existing ${name} setting changed: ${key}`);
    }
    assert.equal(bindings.get('SOCIAL_AUDIO')?.bucket_name, 'maydan-social-audio');
    assert.equal(bindings.get('SOCIAL_JOBS')?.class_name, 'LammaJobs');
    assert.equal(bindings.get('SOCIAL_JOBS')?.script_name || name, 'maydan-game');
    assert.deepEqual((now[name].schedules.schedules || []).map(item => ({ cron: item.cron })).sort((a, b) => a.cron.localeCompare(b.cron)),
      [...expectedSchedules(name, review, recovery)].sort((a, b) => a.cron.localeCompare(b.cron)), 'Worker cron schedule mismatch.');
  }
  assert.equal(now['maydan-game'].version.resources.script_runtime.migration_tag, 'v3-lamma');
  assert.equal(now['maydan-rooms'].version.resources.script_runtime.migration_tag, 'v1');
  const ledger = await api(`/d1/database/${DATABASE}/query`, { readMigrations: true });
  assert.deepEqual(ledger.flatMap(item => item.results).map(item => item.name), [...before.migrations, ...review.pendingMigrations]);
  const result = { verifiedAt: new Date().toISOString(), versions: Object.fromEntries(WORKERS.map(name => [name, now[name].versionId])),
    assetsUnchanged: true, checkedAssets: current.entries.length, originalBindingsUnchanged: true, reviewedWorkerCodeVerified: true,
    ...(recovery ? { recovery: recovery.operation, originalPlanSHA256: recovery.originalPlanSHA256 } : {}) };
  await savePrivate(dir, `verification-${new Date().toISOString().replace(/[:.]/g, '-')}`, result);
  return result;
}

async function main() {
  const [command, suppliedDir, expectedDigest, evidencePath] = process.argv.slice(2);
  assert.ok(['preflight', 'backup', 'plan', 'verify', '--apply'].includes(command), 'Use preflight [private-dir], backup <private-dir>, plan <private-dir>, verify <private-dir>, or the separately authorized --apply <dir> <reviewed-plan-sha256> <provider-report>.');
  if (command !== 'preflight') assert.ok(suppliedDir, 'Use the exact private directory from the preflight summary.');
  const dir = privateDirectory(suppliedDir);
  const result = command === '--apply' ? await apply(dir, expectedDigest, evidencePath) : await ({ preflight, backup, plan, verify }[command])(dir);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ failed: true, message: error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Release preparation failed; credentials and private response bodies suppressed.' })); process.exitCode = 1; });
}
