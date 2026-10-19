// Separate reviewed operations: support page; enable public 1.8(22); disable.
// Every apply is one main-Worker upload. No asset, database, room, cron or secret
// writes. A failed write requires reconciliation, never a blind retry/rollback.
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
import { supportPageResponse } from '../../server/legal/support.mjs';
import { privacyPageResponse } from '../../server/legal/privacy.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PRIVATE = path.join(homedir(), '.codex', 'private', 'maydan-support-update-release');
const NAME = 'maydan-game', BASE = `/workers/scripts/${NAME}`;
const ORIGIN = 'https://maydan-game.mf103871.workers.dev';
const APP_ID = '6808385717', VERSION = '1.8', BUILD = '22';
const APPROVED_BUILD_ID = '093728e9-5d77-4d9f-8725-5e1c4de8c5f9';
const FLAGS = ['IOS_UPDATE_POLICY_ENABLED', 'IOS_MIN_SUPPORTED_VERSION', 'IOS_MIN_SUPPORTED_BUILD'];
const TARGET = { IOS_UPDATE_POLICY_ENABLED: '1', IOS_MIN_SUPPORTED_VERSION: VERSION, IOS_MIN_SUPPORTED_BUILD: BUILD };
const STOREFRONTS = [['jo', 'JOR'], ['sa', 'SAU'], ['ae', 'ARE'], ['us', 'USA']];
const SETTINGS = ['compatibility_date', 'compatibility_flags', 'placement', 'logpush', 'observability', 'tail_consumers', 'tags', 'limits'];
const HELPERS = ['scripts/ios/support-update-release.mjs', 'scripts/lamma-release.mjs', 'scripts/lib/lamma-provenance.mjs'];
const execute = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const cron = snapshot => (snapshot.schedules?.schedules || []).map(item => item.cron).sort();
const sortedBindings = (snapshot, omitted = []) => snapshot.settings.bindings.filter(item => !omitted.includes(item.name)).sort((a, b) => a.name.localeCompare(b.name));
const binding = (snapshot, name) => snapshot.settings.bindings.find(item => item.name === name);

export function supportUpdateUploadPlan(before, mode) {
  assert.ok(['support', 'enable', 'disable'].includes(mode), 'Unknown support/update operation.');
  assert.equal(before.version.resources.script_runtime.migration_tag, 'v3-lamma', 'Existing v3-lamma Worker required.');
  for (const name of ['ASSETS', 'DB', 'SESSION_SECRET', 'SOCIAL_AUDIO', 'SOCIAL_JOBS']) assert.ok(binding(before, name), `Missing live binding: ${name}`);
  assert.equal(new Set(before.settings.bindings.map(item => item.name)).size, before.settings.bindings.length, 'Duplicate live binding names.');
  assert.equal(binding(before, 'DESIGN_PUBLISH_ENABLED')?.type, 'plain_text', 'Inspectable private Studio gate required.');
  assert.equal(binding(before, 'DESIGN_PUBLISH_ENABLED').text, '0', 'Studio publishing must remain disabled.');
  assert.equal(binding(before, 'DESIGN_EDITOR_USER_IDS')?.type, 'plain_text', 'Existing private Studio owner required.');
  assert.ok(binding(before, 'DESIGN_EDITOR_USER_IDS').text, 'Existing Studio owner must not be empty.');
  assert.match(binding(before, 'DESIGN_STUDIO_RELEASE')?.text || '', /^studio-\d{8}-[a-f0-9]{8}$/);
  for (const name of FLAGS) if (binding(before, name)) assert.equal(binding(before, name).type, 'plain_text', 'Policy flags must not be secret bindings.');
  if (mode !== 'disable') assert.ok(['', '0', undefined].includes(binding(before, FLAGS[0])?.text), 'Do not combine this operation with an already-enabled update policy.');
  assert.ok(cron(before).includes('* * * * *'), 'Existing Lamma cron required.');
  const inherited = uploadPlan(NAME, before);
  assert.equal(inherited.metadata.migrations, undefined, 'No DO migrations permitted.');
  assert.deepEqual(inherited.schedules.map(item => item.cron).sort(), cron(before), 'No cron additions permitted.');
  assert.ok(inherited.metadata.bindings.every(item => item.type === 'inherit'), 'No resource provisioning permitted.');
  const changes = mode === 'enable' ? TARGET : mode === 'disable' ? { IOS_UPDATE_POLICY_ENABLED: '0' } : {};
  const metadata = structuredClone(inherited.metadata);
  metadata.bindings = metadata.bindings.filter(item => !Object.hasOwn(changes, item.name));
  for (const [name, text] of Object.entries(changes)) metadata.bindings.push({ name, type: 'plain_text', text });
  metadata.annotations = { 'workers/message': mode === 'support' ? 'Standalone support page; public assets and private Studio preserved; update policy dormant'
    : mode === 'enable' ? 'Require verified public iOS 1.8(22); existing Worker code and resources preserved'
      : 'Disable mandatory iOS update; existing Worker code and resources preserved' };
  assert.deepEqual(metadata.assets.config, assetsConfig(before.version.resources.script_runtime.assets));
  return { metadata, changes, lease: inherited.lease };
}

export function assertSupportUpdateDeployment(before, after, specification, mode) {
  const allowed = mode === 'enable' ? FLAGS : mode === 'disable' ? [FLAGS[0]] : [];
  assert.deepEqual(sortedBindings(after, allowed), sortedBindings(before, allowed), 'Unapproved existing binding or secret changed.');
  for (const name of allowed) assert.deepEqual(binding(after, name), { name, type: 'plain_text', text: specification.changes[name] }, 'Policy flag differs from the reviewed value.');
  for (const key of SETTINGS) assert.deepEqual(after.settings[key], before.settings[key], `Worker setting changed: ${key}`);
  assert.deepEqual(cron(after), cron(before), 'Cron changed.');
  assert.equal(after.version.resources.script_runtime.migration_tag, before.version.resources.script_runtime.migration_tag, 'DO migration history changed.');
  assert.deepEqual(after.version.resources.script_runtime.assets, before.version.resources.script_runtime.assets, 'Complete asset configuration changed.');
  assert.deepEqual(assetsConfig(after.version.resources.script_runtime.assets), specification.metadata.assets.config);
}

async function checkedJSON(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000), ...options });
  assert.equal(response.status, 200, 'Public-release verification HTTP failure; response suppressed.');
  return response.json();
}

// Called again immediately before enabling, rather than trusting a saved claim.
// The token is supplied by the existing operator credential flow, never written
// to the plan, logs, Worker, app or public Apple-lookup requests.
export async function verifyPublic18Release({ fetchImpl = fetch, token = process.env.MAYDAN_ASC_READ_TOKEN, now = Date.now } = {}) {
  assert.ok(typeof token === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token), 'A short-lived official ASC read token is required; do not put it in command arguments.');
  const headers = { accept: 'application/json', authorization: `Bearer ${token}` };
  const query = new URLSearchParams({ 'filter[platform]': 'IOS', 'filter[versionString]': VERSION,
    'fields[appStoreVersions]': 'platform,versionString,appStoreState,appVersionState,downloadable,build', limit: '10' });
  const versions = await checkedJSON(fetchImpl, `https://api.appstoreconnect.apple.com/v1/apps/${APP_ID}/appStoreVersions?${query}`, { headers });
  assert.ok(Array.isArray(versions.data) && versions.data.length === 1 && !versions.links?.next, 'Exactly one official iOS 1.8 release is required.');
  const release = versions.data[0], attrs = release.attributes;
  assert.equal(release.type, 'appStoreVersions'); assert.match(release.id || '', /^[a-f0-9-]{36}$/i);
  assert.equal(attrs?.platform, 'IOS'); assert.equal(attrs?.versionString, VERSION);
  const publicState = attrs?.appVersionState == null ? attrs?.appStoreState === 'READY_FOR_SALE' : attrs.appVersionState === 'READY_FOR_DISTRIBUTION';
  assert.ok(publicState && (attrs?.appStoreState == null || attrs.appStoreState === 'READY_FOR_SALE'), 'App Store 1.8 must be public, not merely approved or in TestFlight.');
  assert.equal(attrs?.downloadable, true, 'Official ASC release must be downloadable.');
  const result = await checkedJSON(fetchImpl, `https://api.appstoreconnect.apple.com/v1/appStoreVersions/${release.id}/build`, { headers });
  const selected = result.data;
  assert.equal(selected?.type, 'builds'); assert.match(selected?.id || '', /^[a-f0-9-]{36}$/i);
  assert.equal(selected.id, APPROVED_BUILD_ID, 'Public release must select the independently approved native build22 resource.');
  assert.equal(selected.attributes?.version, BUILD, 'Public 1.8 must select exact build22.');
  assert.equal(selected.attributes?.processingState, 'VALID'); assert.equal(selected.attributes?.expired, false);
  if (release.relationships?.build?.data) assert.equal(release.relationships.build.data.id, selected.id, 'Selected build relationship changed.');
  const countries = [];
  for (const [country] of STOREFRONTS) {
    const data = await checkedJSON(fetchImpl, `https://itunes.apple.com/lookup?id=${APP_ID}&entity=software&country=${country}`, { headers: { accept: 'application/json' } });
    assert.equal(data.resultCount, 1, `Public 1.8 is not available in ${country.toUpperCase()}.`);
    assert.ok(Array.isArray(data.results) && data.results.length === 1);
    const app = data.results[0];
    assert.equal(app.trackId, Number(APP_ID)); assert.equal(app.bundleId, 'Maydan');
    assert.equal(app.kind, 'software'); assert.equal(app.wrapperType, 'software'); assert.equal(app.version, VERSION, 'Public storefront must offer exact version1.8.');
    assert.match(app.minimumOsVersion || '', /^\d{1,6}(?:\.\d{1,6}){0,2}$/);
    const link = new URL(app.trackViewUrl);
    assert.equal(link.origin, 'https://apps.apple.com'); assert.equal(link.username, ''); assert.equal(link.password, '');
    assert.equal(link.pathname.split('/')[1]?.toLowerCase(), country, 'Storefront country fallback is forbidden.');
    assert.ok(link.pathname.endsWith(`/id${APP_ID}`));
    countries.push({ country: country.toUpperCase(), version: app.version, minimumOS: app.minimumOsVersion });
  }
  return { verifiedAt: new Date(now()).toISOString(), appId: APP_ID, version: VERSION, build: BUILD,
    appStoreVersionId: release.id, buildId: selected.id, officialPublic: true, downloadable: true, countries };
}

function directory(value) {
  const dir = path.resolve(value || path.join(PRIVATE, new Date().toISOString().replace(/[:.]/g, '-')));
  const relative = path.relative(PRIVATE, dir);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Plan directory must be under the private support/update release directory.');
  return dir;
}

export function supportUpdateApiClient(token, { allowApply = false, baseApi = apiClient(token, allowApply) } = {}) {
  return (suffix, options = {}) => {
    assert.ok(/^\/workers\/scripts\/(maydan-game|maydan-rooms)(\/(settings|deployments|schedules|versions(\/[a-f0-9-]+)?))?$/.test(suffix), 'Only existing Worker snapshots are readable.');
    assert.ok(Object.keys(options).every(key => ['form', 'raw'].includes(key)), 'Database/provider/cron writes are forbidden.');
    if (options.form) {
      assert.equal(allowApply, true, 'Read-only support/update client refuses writes.');
      assert.equal(suffix, BASE, 'Only the main Worker can be uploaded.');
    }
    return baseApi(suffix, options);
  };
}

async function authenticatedClient(allowApply = false) {
  const { stdout } = await execute(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'auth', 'token', '--json'],
    { cwd: ROOT, windowsHide: true, timeout: 30_000, maxBuffer: 1_048_576 });
  const value = JSON.parse(stdout); assert.ok(value.token, 'Existing Wrangler authentication unavailable.');
  return supportUpdateApiClient(value.token, { allowApply });
}

async function sourceInputs() {
  const compiled = await build({ entryPoints: ['server/full-worker.mjs'], absWorkingDir: ROOT, bundle: true, write: false, metafile: true,
    platform: 'browser', format: 'esm', target: 'es2022', minify: false, sourcemap: false, logLevel: 'silent' });
  assert.equal(compiled.outputFiles.length, 1);
  const inputs = {};
  for (const file of [...new Set([...Object.keys(compiled.metafile.inputs), ...HELPERS, 'package.json', 'package-lock.json'])].sort()) {
    const relative = path.relative(ROOT, path.resolve(ROOT, file)).split(path.sep).join('/');
    assert.ok(!relative.startsWith('../') && !path.isAbsolute(relative));
    inputs[relative] = hash(await readFile(path.join(ROOT, relative)));
  }
  const { stdout } = await execute('git', ['status', '--porcelain', '--untracked-files=all', '--', 'server', ...Object.keys(inputs)], { cwd: ROOT, windowsHide: true });
  assert.equal(stdout.trim(), '', 'Commit and review scoped backend/helper changes before planning.');
  return { inputs, module: Buffer.from(compiled.outputFiles[0].contents) };
}

export async function snapshotMainModule(snapshot) {
  const response = new Response(Buffer.from(snapshot.script.base64, 'base64'), { headers: { 'content-type': snapshot.script.contentType } });
  const form = await response.formData();
  const module = form.get(`${NAME}.mjs`);
  assert.equal([...form.keys()].length, 1, 'Unexpected extra Worker module; do not drop runtime dependencies.');
  assert.ok(typeof module === 'string' || typeof module?.arrayBuffer === 'function', 'Main module missing from snapshot.');
  return typeof module === 'string' ? Buffer.from(module) : Buffer.from(await module.arrayBuffer());
}

export function uploadedVersionHint(uploaded) {
  // Cloudflare's Upload Worker Module response documents `id` as the script
  // name, not a version UUID. A deployment ID is also a separate resource.
  // Only an explicit well-formed version_id can add an identity constraint;
  // otherwise the fresh active/latest snapshot, exact module and full metadata
  // verification below remain authoritative and record the actual version ID.
  return /^[a-f0-9-]{36}$/i.test(uploaded?.version_id || '') ? uploaded.version_id : null;
}

async function snapshot(api) {
  return { main: await snapshotWorker(api, NAME), rooms: await snapshotWorker(api, 'maydan-rooms'), assets: await publicManifest() };
}
async function unchanged(api, before) {
  assertLease(before.main, await snapshotWorker(api, NAME));
  assertLease(before.rooms, await snapshotWorker(api, 'maydan-rooms'));
  assertAssetsUnchanged(before.assets, await publicManifest(before.assets.paths));
}

export async function supportUpdatePlan(mode, suppliedDir) {
  const dir = directory(suppliedDir), source = await sourceInputs();
  const provenance = await getBackendProvenance(ROOT, { requireClean: true });
  const api = await authenticatedClient(), before = await snapshot(api);
  assert.equal(before.assets.entries.length, 63, 'Existing 63 public assets must remain intact.');
  const specification = supportUpdateUploadPlan(before.main, mode);
  const availability = mode === 'enable' ? await verifyPublic18Release() : null;
  // Flag-only operations retain the exact deployed module rather than introducing
  // any local backend change as a side effect of changing the three variables.
  const module = mode === 'support' ? source.module : await snapshotMainModule(before.main);
  const supportSHA256 = hash(Buffer.from(await supportPageResponse().arrayBuffer()));
  const privacySHA256 = hash(Buffer.from(await privacyPageResponse().arrayBuffer()));
  await unchanged(api, before);
  const review = { schemaVersion: 1, operation: 'main-support-update-v1', mode, createdAt: new Date().toISOString(), ...provenance,
    sourceInputs: source.inputs, preflightSHA256: hash(canonical(before)), specification, availability,
    bundleSHA256: hash(module), bundleBytes: module.length, supportSHA256, privacySHA256,
    noDatabaseChanges: true, noRoomsChanges: true, noCronChanges: true, noDOMigration: true, keepAssets: true };
  await savePrivate(dir, 'preflight', before); await savePrivate(dir, `${NAME}.mjs`, module); await savePrivate(dir, 'deployment-plan', review);
  return { directory: dir, planSHA256: hash(canonical(review)), sourceCommit: review.sourceCommit, mode,
    bundleSHA256: review.bundleSHA256, previousMainVersion: before.main.versionId, roomsVersion: before.rooms.versionId,
    publicAssetsChecked: 63, changes: specification.changes, publicReleaseVerified: !!availability,
    supportURL: `${ORIGIN}/api/legal/support/`, applied: false, writesPlanned: ['One reviewed main Worker upload; assets and all unapproved bindings inherited'] };
}

async function reviewed(dir, digest, fresh = false) {
  assert.match(digest || '', /^[a-f0-9]{64}$/, 'Exact reviewed plan digest required.');
  const review = await loadPrivate(dir, 'deployment-plan'), before = await loadPrivate(dir, 'preflight');
  assert.equal(hash(canonical(review)), digest, 'Reviewed digest differs.');
  assert.equal(review.operation, 'main-support-update-v1');
  assert.equal(hash(canonical(before)), review.preflightSHA256, 'Encrypted snapshot integrity failed.');
  assert.deepEqual(supportUpdateUploadPlan(before.main, review.mode), review.specification);
  if (fresh) { const age = Date.now() - Date.parse(review.createdAt); assert.ok(age >= 0 && age < 30 * 60_000, 'Plan expired; take a fresh snapshot and review.'); }
  return { review, before };
}

async function verifyPublic(review) {
  for (const [page, digest] of [['support', review.supportSHA256], ['privacy', review.privacySHA256]]) for (const slash of ['', '/']) {
    const response = await fetch(`${ORIGIN}/api/legal/${page}${slash}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'cache-control': 'no-cache' } });
    assert.equal(response.status, 200); assert.equal(hash(Buffer.from(await response.arrayBuffer())), digest, `Public ${page} differs from reviewed content.`);
    assert.ok(response.headers.get('content-type')?.startsWith('text/html'));
  }
  const health = await checkedJSON(fetch, `${ORIGIN}/health`); assert.equal(health.ok, true);
  for (const [, storefront] of STOREFRONTS) {
    const body = await checkedJSON(fetch, `${ORIGIN}/api/app-policy/ios?storefront=${storefront}&osVersion=26.6.1`);
    assert.equal(body.schemaVersion, 1); assert.equal(body.appStoreId, APP_ID);
    assert.equal(body.enabled, review.mode === 'enable', 'Policy response differs from reviewed operation.');
    assert.equal(body.minimumBuild, review.mode === 'enable' ? Number(BUILD) : 0);
    assert.equal(body.minimumVersion, review.mode === 'enable' ? VERSION : null);
  }
}

export async function supportUpdateVerify(suppliedDir, digest, api = null, expectedVersion = null) {
  const dir = directory(suppliedDir), { review, before } = await reviewed(dir, digest);
  api ||= await authenticatedClient();
  const current = await snapshotWorker(api, NAME);
  if (expectedVersion) assert.equal(current.versionId, expectedVersion, 'Uploaded version is not the active version.');
  await assertDeployedBundle(current.script, NAME, review.bundleSHA256);
  assertSupportUpdateDeployment(before.main, current, review.specification, review.mode);
  assertLease(before.rooms, await snapshotWorker(api, 'maydan-rooms'));
  assertAssetsUnchanged(before.assets, await publicManifest(before.assets.paths));
  await verifyPublic(review);
  assertLease(current, await snapshotWorker(api, NAME));
  const receipt = { verifiedAt: new Date().toISOString(), planSHA256: digest, sourceCommit: review.sourceCommit,
    mode: review.mode, versionId: current.versionId, bundleSHA256: review.bundleSHA256, assetsChecked: 63,
    publicAssetsUnchanged: true, roomsUnchanged: true, studioOwnerAndPublishGateUnchanged: true,
    secretsUnchanged: true, schedulesUnchanged: true, assetConfigurationUnchanged: true, changes: review.specification.changes };
  await savePrivate(dir, `verification-${new Date().toISOString().replace(/[:.]/g, '-')}`, receipt); return receipt;
}

export async function supportUpdateApply(suppliedDir, digest) {
  const dir = directory(suppliedDir), { review, before } = await reviewed(dir, digest, true);
  const source = await sourceInputs(); assert.deepEqual(source.inputs, review.sourceInputs, 'Source/helper changed after review.');
  const provenance = await getBackendProvenance(ROOT, { requireClean: true });
  assert.equal(provenance.sourceServerTree, review.sourceServerTree); assert.equal(provenance.backendTreeSha256, review.backendTreeSha256);
  const module = await loadPrivate(dir, `${NAME}.mjs`, true); assert.equal(hash(module), review.bundleSHA256);
  if (review.mode === 'support') assert.equal(hash(source.module), review.bundleSHA256, 'Rebuilt support module differs.');
  else assert.equal(hash(await snapshotMainModule(before.main)), review.bundleSHA256, 'Flag-only operation must retain the exact live module.');
  const api = await authenticatedClient(true); await unchanged(api, before);
  if (review.mode === 'enable') {
    const fresh = await verifyPublic18Release();
    assert.equal(fresh.appStoreVersionId, review.availability.appStoreVersionId); assert.equal(fresh.buildId, review.availability.buildId);
    await savePrivate(dir, 'availability-before-apply', fresh);
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const journal = { planSHA256: digest, mode: review.mode, startedAt: new Date().toISOString(), writeAttempted: false, phase: 'preconditions-passed' };
  await writeFile(path.join(dir, 'apply.lock'), JSON.stringify(journal), { flag: 'wx', mode: 0o600 });
  const record = async phase => { journal.phase = phase; await writeFile(path.join(dir, 'apply-progress.json'), JSON.stringify(journal, null, 2), { mode: 0o600 }); };
  const form = new FormData(); form.set('metadata', new Blob([JSON.stringify(review.specification.metadata)], { type: 'application/json' }));
  form.set(`${NAME}.mjs`, new File([module], `${NAME}.mjs`, { type: 'application/javascript+module' }));
  try {
    assertLease(before.main, await snapshotWorker(api, NAME)); assertLease(before.rooms, await snapshotWorker(api, 'maydan-rooms'));
    journal.writeAttempted = true; await record('upload-request-started');
    const uploaded = await api(BASE, { form }); await record('upload-returned');
    const result = await supportUpdateVerify(dir, digest, api, uploadedVersionHint(uploaded)); await record('verified'); return { ...result, applied: true };
  } catch (error) { await record('stopped-reconciliation-required'); throw error; }
}

async function main() {
  const [command, arg, digest, ...extra] = process.argv.slice(2); assert.equal(extra.length, 0);
  let result;
  if (['--plan-support', '--plan-enable', '--plan-disable'].includes(command)) { assert.equal(digest, undefined); result = await supportUpdatePlan(command.slice(7), arg); }
  else { assert.ok(['--apply', '--verify'].includes(command) && arg && digest, 'Use --plan-support|--plan-enable|--plan-disable [private-dir], then --apply|--verify <private-dir> <reviewed-sha256>.'); result = await (command === '--apply' ? supportUpdateApply(arg, digest) : supportUpdateVerify(arg, digest)); }
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ failed: true, message: error instanceof assert.AssertionError ? error.message.split('\n')[0]
    : 'Support/update operation stopped; credentials and response bodies suppressed. Inspect the private journal before any retry.' })); process.exitCode = 1;
});
