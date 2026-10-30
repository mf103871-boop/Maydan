import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMafiaPreviewManifest, assertMafiaPreviewConfig, readMafiaPreviewInputs, runMafiaPreviewManifest,
  MAFIA_PREVIEW_TARGET, mafiaPreviewSHA256 } from '../scripts/mafia-preview-manifest.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const actualConfig = JSON.parse(await readFile(path.join(ROOT, 'wrangler.mafia-preview.jsonc'), 'utf8'));
const fixture = () => ({ configSource: JSON.stringify({ ...structuredClone(actualConfig),
  vars: { ...actualConfig.vars, MAFIA_ACCEPT_NEW_MATCHES: '1' } }),
  migrations: [{ name: '0002_second.sql', source: 'ALTER TABLE fixture ADD COLUMN value TEXT;\n' },
    { name: '0001_first.sql', source: 'CREATE TABLE fixture(id INTEGER PRIMARY KEY);\n' }] });
const ledgerFor = (receipt, count = receipt.migrations.files.length, hashes = true) => ({
  schemaVersion: 1, worker: MAFIA_PREVIEW_TARGET.worker, databaseId: MAFIA_PREVIEW_TARGET.databaseId,
  capturedAt: '2026-10-30T12:00:00Z', entries: receipt.migrations.files.slice(0, count).map(file => hashes ? { ...file } : { name: file.name }),
});
const configMutation = (input, mutate) => { const config = JSON.parse(input.configSource); mutate(config); input.configSource = JSON.stringify(config); };

test('local preview receipt hashes exact bytes and remains unverified without a live ledger', () => {
  const input = fixture(), receipt = createMafiaPreviewManifest(input);
  assert.equal(receipt.config.sha256, mafiaPreviewSHA256(input.configSource));
  assert.deepEqual(receipt.migrations.files.map(file => file.name), ['0001_first.sql', '0002_second.sql']);
  assert.equal(receipt.migrations.files[0].sha256, mafiaPreviewSHA256(input.migrations[1].source));
  assert.deepEqual(receipt.capacity, { maxActiveRooms: 1, maxVoiceParticipants: 80 });
  assert.deepEqual(receipt.rules, { rulesetVersion: 1, protocol: 2, supportedRulesetVersions: [1] });
  assert.deepEqual(receipt.gates, { mafiaEnabled: true, acceptNewMatches: true, progressEnabled: true, metricsEnabled: true });
  assert.equal(receipt.migrationLedger.status, 'unverified');
  assert.equal(receipt.pendingMigrations, null);
  assert.equal(receipt.ready, false); assert.equal(receipt.liveVerified, false);
  assert.doesNotMatch(JSON.stringify(receipt), /CREATE TABLE|ALTER TABLE|GOOGLE_CLIENT_ID/);
  assert.deepEqual(createMafiaPreviewManifest(input), receipt, 'pure receipt is deterministic and does not mutate inputs');
});

test('preview locks reject production resources, alternate origins, binding aliases and configuration escape hatches', () => {
  const mutations = [
    config => { config.name = 'maydan-game'; },
    config => { config.main = 'server/worker.mjs'; },
    config => { config.workers_dev = false; },
    config => { config.vars.APP_ORIGIN = 'https://maydan-game.mf103871.workers.dev'; },
    config => { config.vars.EXTRA_ORIGINS += ',https://production.example'; },
    config => { config.d1_databases[0].database_id = 'production-db'; },
    config => { config.d1_databases[0].database_name = 'maydan-accounts'; },
    config => { config.d1_databases[0].binding = 'OTHER_DB'; },
    config => { config.d1_databases[0].migrations_dir = 'other/migrations'; },
    config => { config.d1_databases.push({ ...config.d1_databases[0] }); },
    config => { config.d1_databases[0].preview_database_id = 'production-db'; },
    config => { config.r2_buckets[0].bucket_name = 'maydan-social-audio'; },
    config => { config.r2_buckets.push({ ...config.r2_buckets[0] }); },
    config => { config.durable_objects.bindings[0].script_name = 'maydan-game'; },
    config => { config.durable_objects.bindings[0] = { ...config.durable_objects.bindings[1] }; },
    config => { config.services = [{ binding: 'EXTERNAL', service: 'maydan-game' }]; },
    config => { config.env = { production: { name: 'maydan-game' } }; },
    config => { config.routes = ['production.example/*']; },
    config => { config.assets.directory = '../production/dist'; },
  ];
  for (const mutate of mutations) { const input = fixture(); configMutation(input, mutate); assert.throws(() => createMafiaPreviewManifest(input)); }
});

test('capacity and admission gates are explicit, pinned and reflected without treating drain as a rule version', () => {
  for (const [key, value] of [['MAFIA_MAX_ACTIVE_ROOMS', '2'], ['MAFIA_MAX_VOICE_PARTICIPANTS', '12'],
    ['MAFIA_ACCEPT_NEW_MATCHES', undefined], ['MAFIA_ACCEPT_NEW_MATCHES', 'true'], ['MAFIA_PROGRESS_ENABLED', 'true'], ['MAFIA_ENABLED', 'true'], ['IOS_UPDATE_POLICY_ENABLED', '1']]) {
    const input = fixture(); configMutation(input, config => { config.vars[key] = value; });
    assert.throws(() => createMafiaPreviewManifest(input));
  }
  const input = fixture(); configMutation(input, config => { config.vars.MAFIA_ACCEPT_NEW_MATCHES = '0'; });
  const receipt = createMafiaPreviewManifest(input);
  assert.equal(receipt.gates.acceptNewMatches, false); assert.equal(receipt.rules.rulesetVersion, 1); assert.equal(receipt.ready, false);
});

test('supplied ledger is target-bound, known, unique, contiguous and ordered; matching names never prove applied SQL bytes', () => {
  const input = fixture(), baseline = createMafiaPreviewManifest(input);
  input.ledger = ledgerFor(baseline, 1, false);
  const receipt = createMafiaPreviewManifest(input);
  assert.deepEqual(receipt.pendingMigrations, ['0002_second.sql']);
  assert.equal(receipt.migrationLedger.sqlBytes, 'unverified'); assert.equal(receipt.ready, false);
  const mutations = [
    ledger => { ledger.worker = 'maydan-game'; }, ledger => { ledger.databaseId = 'production-db'; },
    ledger => { ledger.capturedAt = 'not-a-date'; }, ledger => { ledger.entries[0].name = '9999_unknown.sql'; },
    ledger => { ledger.entries.push({ ...ledger.entries[0] }); }, ledger => { ledger.entries.reverse(); },
    ledger => { ledger.entries.shift(); }, ledger => { ledger.entries[0].sha256 = '0'.repeat(64); },
    ledger => { ledger.entries[0].sha256 = null; },
  ];
  for (const mutate of mutations) { const value = ledgerFor(baseline); mutate(value); assert.throws(() => createMafiaPreviewManifest({ ...input, ledger: value })); }
  const full = createMafiaPreviewManifest({ ...input, ledger: ledgerFor(baseline) });
  assert.deepEqual(full.pendingMigrations, []); assert.equal(full.migrationLedger.sqlBytes, 'matched-supplied-checksums');
  assert.equal(full.liveVerified, false); assert.equal(full.ready, false);
  const empty = createMafiaPreviewManifest({ ...input, ledger: ledgerFor(baseline, 0) });
  assert.deepEqual(empty.pendingMigrations, ['0001_first.sql', '0002_second.sql']);
});

test('reviewed manifests and applied checksums reject config drift and every added, missing or edited migration', () => {
  const original = fixture(), reviewedManifest = createMafiaPreviewManifest(original);
  assert.equal(createMafiaPreviewManifest({ ...original, reviewedManifest }).reviewedManifest, 'matched');
  const mutations = [
    input => { input.configSource += '\n'; },
    input => { input.migrations[0].source += '-- changed after review\n'; },
    input => { input.migrations.pop(); },
    input => { input.migrations.push({ name: '0003_third.sql', source: 'SELECT 1;\n' }); },
  ];
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.throws(() => createMafiaPreviewManifest({ ...input, reviewedManifest }), /Reviewed preview manifest differs/); }
  const input = fixture(); input.ledger = ledgerFor(reviewedManifest); input.migrations[0].source += '\n';
  assert.throws(() => createMafiaPreviewManifest(input), /hash differs/);
  for (const name of ['../0001_bad.sql', 'bad.sql', '0001_FIRST.sql']) {
    assert.throws(() => createMafiaPreviewManifest({ ...fixture(), migrations: [{ name, source: 'SELECT 1;' }] }));
  }
  const duplicate = fixture(); duplicate.migrations.push({ ...duplicate.migrations[0] });
  assert.throws(() => createMafiaPreviewManifest(duplicate), /duplicate local migration/);
});

test('local input inventory includes every actual SQL migration through progression, not a hard-coded Mafia-only list', async () => {
  const input = await readMafiaPreviewInputs();
  const receipt = createMafiaPreviewManifest(input);
  const sqlNames = (await readdir(path.join(ROOT, 'server/migrations'))).filter(name => name.endsWith('.sql')).sort();
  assert.deepEqual(receipt.migrations.files.map(file => file.name), sqlNames);
  assert.ok(sqlNames.includes('0014_mafia.sql')); assert.ok(sqlNames.includes('0018_mafia_tutorial.sql'));
  assert.ok(sqlNames.includes('0019_mafia_progress.sql'));
  assert.ok(receipt.migrations.files.length > 14);
  for (const file of receipt.migrations.files) assert.equal(file.sha256, mafiaPreviewSHA256(await readFile(path.join(ROOT, 'server/migrations', file.name))));
});

test('filesystem adapter reads local files only and refuses noncanonical SQL; CLI disallows destination overrides', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mafia-preview-receipt-'));
  try {
    const input = fixture(); await mkdir(path.join(directory, 'server/migrations'), { recursive: true });
    await writeFile(path.join(directory, 'wrangler.mafia-preview.jsonc'), input.configSource);
    for (const file of input.migrations) await writeFile(path.join(directory, 'server/migrations', file.name), file.source);
    assert.deepEqual(createMafiaPreviewManifest(await readMafiaPreviewInputs(directory)), createMafiaPreviewManifest(input));
    await writeFile(path.join(directory, 'server/migrations/invalid.sql'), 'SELECT 1;');
    await assert.rejects(readMafiaPreviewInputs(directory), /canonical names/);
  } finally { await rm(directory, { recursive: true, force: true }); }
  for (const args of [['--origin', 'https://production.example'], ['--config', 'wrangler.jsonc'], ['--ledger'], ['--ledger', 'one.json', '--ledger', 'two.json']]) {
    await assert.rejects(runMafiaPreviewManifest(args), /target overrides are forbidden/);
  }
  assert.throws(() => assertMafiaPreviewConfig(null), /unsupported configuration fields/);
  assert.throws(() => createMafiaPreviewManifest({ ...fixture(), configSource: '{"secret":"do-not-print",' }), error => {
    assert.doesNotMatch(error.message, /do-not-print/); return /valid JSON required/.test(error.message);
  });
});
