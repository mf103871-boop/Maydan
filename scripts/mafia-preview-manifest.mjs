// Local receipt only: no network, credentials, child processes, writes, migration
// application or deployment. Redirect stdout to save the CLI's JSON receipt.
//
// node scripts/mafia-preview-manifest.mjs [--ledger evidence.json]
//   [--reviewed-manifest reviewed.json]
//
// Optional supplied ledger envelope (not fetched or authenticated by this tool):
// { schemaVersion: 1, worker: 'maydan-mafia-preview', databaseId: '...',
//   capturedAt: '2026-10-30T12:00:00Z', entries: [{ name: '0001_accounts.sql', sha256?: '...' }] }
// Names alone, including a normal D1 migration ledger, cannot prove which SQL
// bytes were applied. Optional SHA-256s are compared with local bytes but remain
// supplied evidence; neither they nor an empty pending list establish readiness.
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAFIA_PROTOCOL, MAFIA_RULESET_VERSION } from '../src/online/mafia-shared.js';
import { MAFIA_SUPPORTED_RULESET_VERSIONS } from '../server/mafia-ruleset-policy.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG = 'wrangler.mafia-preview.jsonc';
const MIGRATIONS = 'server/migrations';
const SQL_NAME = /^\d{4}_[a-z0-9_-]+\.sql$/;
const SHA256 = /^[a-f0-9]{64}$/;
export const MAFIA_PREVIEW_TARGET = Object.freeze({
  worker: 'maydan-mafia-preview',
  origin: 'https://maydan-mafia-preview.mf103871.workers.dev',
  databaseName: 'maydan-mafia-preview-accounts',
  databaseId: 'cf5fb670-9fb5-4eeb-9717-ed76edb152e1',
  bucketName: 'maydan-mafia-preview-audio',
});
const DO_CLASSES = Object.freeze({ ROOMS: 'Room', LIMITERS: 'RequestLimiter', SOCIAL_HUB: 'SocialHub', SOCIAL_JOBS: 'LammaJobs' });
const check = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_, item) => object(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
export const mafiaPreviewSHA256 = value => createHash('sha256').update(value).digest('hex');
function keys(value, allowed, label) {
  check(object(value) && Object.keys(value).every(key => allowed.includes(key)), `${label}: unsupported configuration fields.`);
}
function parseJSON(source, label) {
  try { return JSON.parse(source); }
  catch { throw new Error(`${label}: valid JSON required; comments and trailing commas are not accepted.`); }
}
function bytes(value, label) {
  check(typeof value === 'string' || value instanceof Uint8Array, `${label}: local bytes required.`);
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
}

export function assertMafiaPreviewConfig(config) {
  const target = MAFIA_PREVIEW_TARGET;
  keys(config, ['$schema', 'name', 'main', 'compatibility_date', 'workers_dev', 'assets', 'vars', 'durable_objects',
    'migrations', 'd1_databases', 'r2_buckets', 'triggers', 'observability'], 'Preview');
  check(config.name === target.worker && config.main === 'server/full-worker.mjs' && config.workers_dev === true,
    'Exact preview Worker and entrypoint required.');
  const forbidExternal = value => {
    if (!value || typeof value !== 'object') return;
    check(!Object.hasOwn(value, 'script_name'), 'External script_name bindings are forbidden.');
    for (const child of Object.values(value)) forbidExternal(child);
  };
  forbidExternal(config);
  check(Array.isArray(config.d1_databases) && config.d1_databases.length === 1, 'Exactly one preview D1 binding required.');
  const database = config.d1_databases[0];
  keys(database, ['binding', 'database_name', 'database_id', 'migrations_dir'], 'D1');
  check(database.binding === 'DB' && database.database_name === target.databaseName && database.database_id === target.databaseId
    && database.migrations_dir === MIGRATIONS, 'Exact preview D1 and migration directory required.');
  check(Array.isArray(config.r2_buckets) && config.r2_buckets.length === 1, 'Exactly one preview R2 binding required.');
  const bucket = config.r2_buckets[0];
  keys(bucket, ['binding', 'bucket_name'], 'R2');
  check(bucket.binding === 'SOCIAL_AUDIO' && bucket.bucket_name === target.bucketName, 'Exact preview R2 required.');
  keys(config.durable_objects, ['bindings'], 'Durable Objects');
  const bindings = config.durable_objects.bindings;
  check(Array.isArray(bindings) && bindings.length === Object.keys(DO_CLASSES).length, 'Exact local preview Durable Objects required.');
  const seen = new Set();
  for (const binding of bindings) {
    keys(binding, ['name', 'class_name'], 'Durable Object');
    check(Object.hasOwn(DO_CLASSES, binding.name) && DO_CLASSES[binding.name] === binding.class_name && !seen.has(binding.name),
      'Foreign, duplicate or changed Durable Object binding.');
    seen.add(binding.name);
  }
  check(canonical(config.migrations) === canonical([{ tag: 'v1-mafia-preview', new_sqlite_classes: Object.values(DO_CLASSES) }]),
    'Preview Durable Object migration history changed.');
  keys(config.assets, ['directory', 'binding', 'not_found_handling', 'run_worker_first'], 'Assets');
  check(config.assets.binding === 'ASSETS' && config.assets.directory === 'dist', 'Exact local preview assets required.');
  keys(config.vars, ['APP_ORIGIN', 'EXTRA_ORIGINS', 'APPLE_BUNDLE_ID', 'MAFIA_ENABLED', 'MAFIA_ACCEPT_NEW_MATCHES',
    'MAFIA_MAX_ACTIVE_ROOMS', 'MAFIA_MAX_VOICE_PARTICIPANTS', 'IOS_UPDATE_POLICY_ENABLED', 'GOOGLE_CLIENT_ID'], 'Variables');
  check(config.vars.APP_ORIGIN === target.origin && config.vars.EXTRA_ORIGINS === 'maydan://app', 'Exact preview origins required.');
  check(config.vars.IOS_UPDATE_POLICY_ENABLED === '0', 'Preview update policy must remain disabled.');
  check(['0', '1'].includes(config.vars.MAFIA_ENABLED), 'Explicit MAFIA_ENABLED gate required.');
  check(['0', '1'].includes(config.vars.MAFIA_ACCEPT_NEW_MATCHES), 'Explicit MAFIA_ACCEPT_NEW_MATCHES gate required.');
  check(config.vars.MAFIA_MAX_ACTIVE_ROOMS === '1' && config.vars.MAFIA_MAX_VOICE_PARTICIPANTS === '80',
    'Preview capacity must remain exactly 1 active room / 80 voice participants.');
  return config;
}

function migrationManifest(migrations) {
  check(Array.isArray(migrations) && migrations.length > 0, 'All local SQL migration files are required.');
  const names = new Set();
  return migrations.map(file => {
    check(object(file) && SQL_NAME.test(file.name) && !names.has(file.name), 'Invalid or duplicate local migration name.');
    names.add(file.name);
    return { name: file.name, sha256: mafiaPreviewSHA256(bytes(file.source, 'Migration')) };
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function ledgerReceipt(ledger, migrations) {
  if (ledger == null) return { ledger: { status: 'unverified', capturedAt: null, applied: null, sqlBytes: 'unverified' }, pending: null };
  keys(ledger, ['schemaVersion', 'worker', 'databaseId', 'capturedAt', 'entries'], 'Ledger');
  check(ledger.schemaVersion === 1 && ledger.worker === MAFIA_PREVIEW_TARGET.worker && ledger.databaseId === MAFIA_PREVIEW_TARGET.databaseId,
    'Ledger must identify the exact preview Worker and D1.');
  check(typeof ledger.capturedAt === 'string' && Number.isFinite(Date.parse(ledger.capturedAt)), 'Ledger capture time required.');
  check(Array.isArray(ledger.entries), 'Ledger entries must be an ordered array.');
  const known = new Map(migrations.map(file => [file.name, file.sha256])), seen = new Set();
  for (const [index, entry] of ledger.entries.entries()) {
    keys(entry, ['name', 'sha256'], 'Ledger entry');
    check(known.has(entry.name), 'Unknown migration in supplied ledger.');
    check(!seen.has(entry.name), 'Duplicate migration in supplied ledger.');
    seen.add(entry.name);
    check(migrations[index]?.name === entry.name, 'Ledger must be a complete ordered prefix of local migrations; reconcile gaps first.');
    if (Object.hasOwn(entry, 'sha256')) check(SHA256.test(entry.sha256) && entry.sha256 === known.get(entry.name),
      'Supplied applied migration hash differs from local SQL bytes.');
  }
  return { ledger: { status: 'supplied-not-live-verified', capturedAt: ledger.capturedAt,
    applied: ledger.entries.map(entry => ({ name: entry.name, sha256: entry.sha256 ?? null })),
    sqlBytes: !ledger.entries.length ? 'not-applicable' : ledger.entries.every(entry => Object.hasOwn(entry, 'sha256'))
      ? 'matched-supplied-checksums' : 'unverified' }, pending: migrations.slice(ledger.entries.length).map(file => file.name) };
}

const reviewFields = receipt => ({ target: receipt.target, config: receipt.config, migrations: receipt.migrations,
  migrationSetSHA256: receipt.migrationSetSHA256, rules: receipt.rules, capacity: receipt.capacity, gates: receipt.gates });

// Pure: the caller provides local bytes and optional evidence. No live state is
// inferred, no SQL is returned, and supplied evidence never becomes live proof.
export function createMafiaPreviewManifest({ configSource, migrations, ledger = null, reviewedManifest = null } = {}) {
  const configBytes = bytes(configSource, 'Preview configuration');
  const config = assertMafiaPreviewConfig(parseJSON(configBytes.toString('utf8'), 'Preview configuration'));
  check(MAFIA_RULESET_VERSION === 1 && MAFIA_PROTOCOL === 2 && canonical(MAFIA_SUPPORTED_RULESET_VERSIONS) === '[1]',
    'Review the receipt policy before changing ruleset v1 / protocol 2.');
  const files = migrationManifest(migrations), supplied = ledgerReceipt(ledger, files);
  const receipt = {
    schemaVersion: 1, kind: 'mafia-preview-manifest', scope: 'local-read-only-preview-receipt',
    target: { ...MAFIA_PREVIEW_TARGET }, config: { file: CONFIG, sha256: mafiaPreviewSHA256(configBytes) },
    migrations: { directory: MIGRATIONS, files }, migrationSetSHA256: mafiaPreviewSHA256(canonical(files)),
    rules: { rulesetVersion: MAFIA_RULESET_VERSION, protocol: MAFIA_PROTOCOL, supportedRulesetVersions: [...MAFIA_SUPPORTED_RULESET_VERSIONS] },
    capacity: { maxActiveRooms: Number(config.vars.MAFIA_MAX_ACTIVE_ROOMS), maxVoiceParticipants: Number(config.vars.MAFIA_MAX_VOICE_PARTICIPANTS) },
    gates: { mafiaEnabled: config.vars.MAFIA_ENABLED === '1', acceptNewMatches: config.vars.MAFIA_ACCEPT_NEW_MATCHES === '1' },
    migrationLedger: supplied.ledger, pendingMigrations: supplied.pending,
    reviewedManifest: reviewedManifest == null ? 'not-supplied' : 'matched',
    ready: false, liveVerified: false,
    limitations: [
      'Local files and supplied evidence only; no live Worker, D1, R2, provider, deployment or device verification.',
      'A names-only D1 ledger cannot prove the SQL bytes applied; supplied checksums are not independently authenticated.',
      'Capture freshness and the absence of concurrent live changes are not verified. An empty pending list is not release acceptance.',
    ],
  };
  if (reviewedManifest != null) {
    check(reviewedManifest.schemaVersion === 1 && reviewedManifest.kind === receipt.kind
      && canonical(reviewFields(reviewedManifest)) === canonical(reviewFields(receipt)),
    'Reviewed preview manifest differs from local configuration, rules or migration bytes.');
  }
  return receipt;
}

export async function readMafiaPreviewInputs(root = ROOT) {
  const directory = path.join(root, MIGRATIONS);
  check(await realpath(directory) === path.resolve(directory), 'Migration directory symlinks are forbidden.');
  const entries = (await readdir(directory, { withFileTypes: true })).filter(entry => /\.sql$/i.test(entry.name));
  check(entries.every(entry => entry.isFile() && SQL_NAME.test(entry.name)), 'SQL migrations must be regular files with canonical names.');
  const [configSource, migrations] = await Promise.all([
    readFile(path.join(root, CONFIG)),
    Promise.all(entries.map(async entry => ({ name: entry.name, source: await readFile(path.join(directory, entry.name)) }))),
  ]);
  return { configSource, migrations };
}

export async function runMafiaPreviewManifest(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    check(['--ledger', '--reviewed-manifest'].includes(flag) && typeof argv[index + 1] === 'string'
      && !argv[index + 1].startsWith('--') && !Object.hasOwn(options, flag),
    'Usage: mafia-preview-manifest.mjs [--ledger FILE] [--reviewed-manifest FILE]; target overrides are forbidden.');
    options[flag] = argv[index + 1];
  }
  const inputs = await readMafiaPreviewInputs();
  for (const [flag, field] of [['--ledger', 'ledger'], ['--reviewed-manifest', 'reviewedManifest']]) {
    if (options[flag]) inputs[field] = parseJSON(await readFile(options[flag], 'utf8'), 'Supplied evidence');
  }
  return createMafiaPreviewManifest(inputs);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await runMafiaPreviewManifest(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(`Mafia preview receipt rejected: ${error.message}`); process.exitCode = 1; }
}
