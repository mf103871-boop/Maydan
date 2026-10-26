import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { privateBankManifest, privateBankOverlay, bundlePreservedMafiaWorker, preservedHash, preservedMafiaUploadMetadata, pairedPreservationDraft, compiledSections } from '../scripts/mafia-preserved-bundle.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'maydan-mafia-bundle-'));
  const repo = path.join(root, 'public'), source = path.join(root, 'private');
  const entry = { id: 'fixture-concept', answer: 'synthetic-fixture-only' };
  for (const base of [repo, source]) {
    await mkdir(path.join(base, 'server/data/ersomha'), { recursive: true });
    await writeFile(path.join(base, 'server/data/ersomha/fixture.mjs'), `export default ${JSON.stringify([entry])};`);
    await writeFile(path.join(base, 'server/ersomha-content.mjs'), "import entries from './data/ersomha/fixture.mjs'; export const ERSOMHA_BANK_VERSION=2,ERSOMHA_BANK=entries,ERSOMHA_CATALOG=entries,ERSOMHA_RETIRED={};");
    for (const name of ['worker', 'full-worker']) await writeFile(path.join(base, `server/${name}.mjs`), "import {ERSOMHA_BANK} from './ersomha-content.mjs'; export default {fetch(){return new Response(JSON.stringify(ERSOMHA_BANK));}};");
  }
  const expected = { semanticSHA256: preservedHash(JSON.stringify([entry])), counts: { version: 2, catalog: 1, active: 1, retired: 0 } };
  return { root, repo, source, expected, close: async () => {
    const target = path.resolve(root), parent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(target), parent); assert.match(path.basename(target), /^maydan-mafia-bundle-/);
    await rm(target, { recursive: true, force: true });
  } };
}

test('private overlay compiles only server bytes in memory while leaving canonical sources untouched', async () => {
  const f = await fixture();
  try {
    const canonical = await readFile(path.join(f.repo, 'server/ersomha-content.mjs'));
    const manifest = await privateBankManifest(f.source, f.expected, { repositoryRoot: f.repo });
    assert.equal(manifest.publicUploadAllowed, false); assert.equal(manifest.modules.length, 2);
    assert.equal(Object.hasOwn(manifest, 'answers'), false);
    const result = await bundlePreservedMafiaWorker('maydan-game', manifest, { repositoryRoot: f.repo });
    assert.equal(result.containsPrivateContent, true); assert.equal(result.privateBank.active, 1);
    assert.ok(result.bytes.includes(Buffer.from('synthetic-fixture-only')));
    assert.deepEqual(await readFile(path.join(f.repo, 'server/ersomha-content.mjs')), canonical);
    assert.equal(preservedHash(result.bytes), result.sha256);
  } finally { await f.close(); }
});

test('private bank verification refuses source inside the public checkout, inventory mismatch and semantic drift', async () => {
  const f = await fixture();
  try {
    await assert.rejects(privateBankManifest(f.repo, f.expected, { repositoryRoot: f.repo }), /outside/);
    await assert.rejects(privateBankManifest(f.source, { ...f.expected, semanticSHA256: 'a'.repeat(64) }, { repositoryRoot: f.repo }), /semantic/);
    await assert.rejects(privateBankManifest(f.source, { ...f.expected, counts: { ...f.expected.counts, active: 2 } }, { repositoryRoot: f.repo }), /inventory/);
  } finally { await f.close(); }
});

test('overlay rejects changed private files, client entrypoints and disk output', async () => {
  const f = await fixture();
  try {
    const manifest = await privateBankManifest(f.source, f.expected, { repositoryRoot: f.repo });
    const options = { absWorkingDir: f.repo, entryPoints: ['server/worker.mjs'], bundle: true, write: false, logLevel: 'silent', plugins: [privateBankOverlay(manifest, { repositoryRoot: f.repo })] };
    await assert.rejects(build({ ...options, write: true, outdir: 'dist' }), /memory/);
    await assert.rejects(build({ ...options, entryPoints: ['src/client.js'] }), /entrypoints/);
    await writeFile(path.join(f.source, 'server/data/ersomha/fixture.mjs'), 'export default [];');
    await assert.rejects(bundlePreservedMafiaWorker('maydan-game', manifest, { repositoryRoot: f.repo }), /changed after review/);
  } finally { await f.close(); }
});

function snapshot(name) {
  return { versionId: `${name}-v1`, latestVersionId: `${name}-v1`, settings: { compatibility_date: '2026-09-01', annotations: { retained: 'true' }, usage_model: 'standard',
    bindings: [{ name: 'DB', type: 'd1', id: 'live-id' }, { name: 'SESSION_SECRET', type: 'secret_text' }, { name: 'ROOMS', type: 'durable_object_namespace' }, { name: 'SOCIAL_AUDIO', type: 'r2_bucket', bucket_name: 'live-audio' }, { name: 'SOCIAL_JOBS', type: 'durable_object_namespace' }, { name: 'ASSETS', type: 'assets' }, { name: 'IOS_UPDATE_POLICY_ENABLED', type: 'plain_text', text: '1' }, { name: 'DESIGN_EDITOR_USER_IDS', type: 'plain_text', text: 'owner' }] },
    schedules: { schedules: [{ cron: '17 3 * * *' }] }, version: { resources: { script_runtime: { migration_tag: name === 'maydan-game' ? 'v3-lamma' : 'v1', assets: { not_found_handling: 'single-page-application', raw_run_worker_first: ['/api/*'], raw_headers: 'retained-headers' } } } } };
}
test('paired metadata inherits live resources, update/Studio flags and secrets, keeps assets and never adds migrations or feature flags', () => {
  const before = snapshot('maydan-game'), result = preservedMafiaUploadMetadata('maydan-game', before);
  assert.equal(result.metadata.keep_assets, true); assert.deepEqual(result.metadata.keep_bindings, ['secret_text', 'secret_key']);
  assert.ok(result.metadata.bindings.every(binding => binding.type === 'inherit'));
  assert.equal(result.metadata.bindings.some(binding => binding.name.startsWith('MAFIA_')), false);
  assert.equal(result.metadata.migrations, undefined); assert.equal(result.featureFlagMutation, false);
  assert.deepEqual(result.metadata.annotations, before.settings.annotations); assert.deepEqual(result.schedules, before.schedules);
  const missing = structuredClone(before); missing.settings.bindings = missing.settings.bindings.filter(binding => binding.name !== 'SOCIAL_AUDIO');
  assert.throws(() => preservedMafiaUploadMetadata('maydan-game', missing), /provisioning/);
});

test('reviewable paired draft requires matching live proofs and exact bytes, remains unable to apply', () => {
  const names = ['maydan-game', 'maydan-rooms'], bytes = Buffer.from('synthetic-server-fixture'), digest = 'a'.repeat(64);
  const input = { sourceCommit: 'a'.repeat(40), snapshots: Object.fromEntries(names.map(name => [name, snapshot(name)])), bundles: Object.fromEntries(names.map(name => [name, { bytes, sha256: preservedHash(bytes), byteLength: bytes.length, sourceInputsSHA256: digest, privateBank: { semanticSHA256: digest } }])),
    bankProof: { exactLiveMatch: true, semanticSHA256: digest, versions: Object.fromEntries(names.map(name => [name, `${name}-v1`])) }, supportProof: { exactLiveMatch: true }, migrationLedger: ['0013_social_group_creation.sql'], migrationSHA256: digest };
  const result = pairedPreservationDraft(input); assert.equal(result.readyToApply, false); assert.equal(result.remoteWrites, false); assert.equal(result.migration.pending, true);
  assert.ok(result.blockers.length >= 4);
  assert.throws(() => pairedPreservationDraft({ ...input, bankProof: { ...input.bankProof, exactLiveMatch: false } }), /live workers/);
  const changed = structuredClone(input); changed.bundles['maydan-rooms'].bytes = Buffer.from('drift');
  assert.throws(() => pairedPreservationDraft(changed));
});

test('compiled section inventory retains repeated cyclic boundaries instead of silently dropping them', () => {
  const sections = compiledSections('// server/a.mjs\nfirst\n// server/b.mjs\nsecond\n// server/a.mjs\nlast\n');
  assert.deepEqual([...sections.keys()], ['server/a.mjs', 'server/b.mjs', 'server/a.mjs#2']);
  assert.match(sections.get('server/a.mjs'), /first/); assert.match(sections.get('server/a.mjs#2'), /last/);
});
