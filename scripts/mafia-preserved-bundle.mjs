// Preparation only: no fetch, upload, migration, credentials or apply entrypoint.
// Unpublished Ersomha sources are read outside this checkout and only enter the
// in-memory server bundles. Callers must seal returned bytes outside the repo.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { assetsConfig, leaseOf } from './lamma-release.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WORKERS = ['maydan-game', 'maydan-rooms'];
const PRIVATE_FILE = /^server\/(?:data\/ersomha\/[a-z0-9-]+\.mjs|ersomha-content\.mjs)$/;
const SECRET_TYPES = ['secret_text', 'secret_key'];
export const preservedHash = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = (root, file) => path.relative(root, file).replaceAll('\\', '/');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function compiledSections(text) {
  const matches = [...text.matchAll(/^\/\/ (?:server|src)\/[^\r\n]+$/gm)], seen = new Map();
  assert.ok(matches.length, 'Readable server module boundaries required.');
  return new Map(matches.map((match, index) => {
    const name = match[0].slice(3), count = (seen.get(name) || 0) + 1; seen.set(name, count);
    return [count === 1 ? name : `${name}#${count}`, text.slice(match.index, matches[index + 1]?.index ?? text.length)];
  }));
}
export const isPrivateBankSection = name => PRIVATE_FILE.test(name.replace(/#\d+$/, ''));

export async function privateBankManifest(privateSourceRoot, expected, { repositoryRoot = ROOT } = {}) {
  const sourceRoot = await realpath(privateSourceRoot), repo = await realpath(repositoryRoot);
  const rel = relative(repo, sourceRoot);
  assert.ok(rel.startsWith('../') || path.isAbsolute(rel), 'Private source must remain outside the public checkout.');
  assert.match(expected?.semanticSHA256 || '', /^[a-f0-9]{64}$/, 'Pin the verified live semantic digest.');
  const compiled = await build({ absWorkingDir: sourceRoot, entryPoints: ['server/ersomha-content.mjs'], bundle: true, write: false, metafile: true, format: 'esm', platform: 'neutral', logLevel: 'silent' });
  const files = Object.keys(compiled.metafile.inputs).filter(file => PRIVATE_FILE.test(file)).sort();
  assert.ok(files.includes('server/ersomha-content.mjs') && files.length >= 2, 'Private bank dependencies are incomplete.');
  assert.ok(!files.some(file => /independent-review\.mjs|accepted-answer-overlaps/.test(file)), 'Editorial evidence must not enter runtime.');
  const modules = [];
  for (const file of files) modules.push({ file, sha256: preservedHash(await readFile(path.join(sourceRoot, file))) });
  // Import only this verified local content module; never evaluate downloaded
  // Worker code. Neither the catalog nor answers are returned in the manifest.
  const bank = await import(pathToFileURL(path.join(sourceRoot, 'server/ersomha-content.mjs')).href);
  const counts = { version: bank.ERSOMHA_BANK_VERSION, catalog: bank.ERSOMHA_CATALOG.length, active: bank.ERSOMHA_BANK.length, retired: Object.keys(bank.ERSOMHA_RETIRED).length };
  assert.deepEqual(counts, expected.counts, 'The preserved bank inventory differs.');
  assert.equal(preservedHash(JSON.stringify(bank.ERSOMHA_BANK)), expected.semanticSHA256, 'Private active bank semantic digest differs.');
  if (expected.moduleHashes) assert.deepEqual(modules, expected.moduleHashes, 'Verified private module bytes changed.');
  return { schemaVersion: 1, sourceRoot, ...counts, semanticSHA256: expected.semanticSHA256, modules, sourceManifestSHA256: preservedHash(canonical(modules)), publicUploadAllowed: false };
}

export function privateBankOverlay(manifest, { repositoryRoot = ROOT, loaded = new Set() } = {}) {
  assert.equal(manifest.publicUploadAllowed, false);
  const pinned = new Map(manifest.modules.map(item => [item.file, item.sha256]));
  assert.equal(pinned.size, manifest.modules.length, 'Duplicate private source entries.');
  return { name: 'mafia-preserve-private-live-bank', async setup(builder) {
    assert.equal(builder.initialOptions.write, false, 'Private server bundles must stay in memory for sealed storage.');
    assert.equal(builder.initialOptions.outdir, undefined); assert.equal(builder.initialOptions.outfile, undefined);
    assert.ok(builder.initialOptions.entryPoints.every(entry => ['server/full-worker.mjs', 'server/worker.mjs'].includes(entry)), 'Private overlay is restricted to the two server entrypoints.');
    // esbuild resolves symlinks by default. In particular macOS temp paths may
    // arrive as /private/var even when the caller used /var. Compare physical
    // paths on both sides, without relaxing the pinned relative file allowlist.
    const repo = await realpath(repositoryRoot);
    builder.onLoad({ filter: /[\\/]server[\\/]/ }, async args => {
      const sourcePath = await realpath(args.path), file = relative(repo, sourcePath);
      if (!PRIVATE_FILE.test(file)) return;
      assert.ok(pinned.has(file), 'A private bank runtime dependency is not in the frozen manifest.');
      const bytes = await readFile(path.join(manifest.sourceRoot, file));
      assert.equal(preservedHash(bytes), pinned.get(file), 'Private source changed after review.');
      loaded.add(file);
      return { contents: bytes.toString('utf8'), loader: 'js', resolveDir: path.dirname(sourcePath) };
    });
  } };
}

export async function bundlePreservedMafiaWorker(name, manifest, { repositoryRoot = ROOT } = {}) {
  assert.ok(WORKERS.includes(name));
  const repo = await realpath(repositoryRoot);
  const loaded = new Set();
  const compiled = await build({ absWorkingDir: repo, entryPoints: [name === 'maydan-game' ? 'server/full-worker.mjs' : 'server/worker.mjs'],
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', minify: false, sourcemap: false, logLevel: 'silent',
    plugins: [privateBankOverlay(manifest, { repositoryRoot: repo, loaded })] });
  assert.equal(compiled.outputFiles.length, 1); assert.deepEqual([...loaded].sort(), manifest.modules.map(item => item.file).sort());
  const bytes = Buffer.from(compiled.outputFiles[0].contents), sourceInputs = {};
  const privateFiles = new Set(manifest.modules.map(item => item.file));
  for (const file of Object.keys(compiled.metafile.inputs)) {
    assert.ok(!file.startsWith('../') && !path.isAbsolute(file), 'Source dependency escaped the checkout.');
    sourceInputs[file] = privateFiles.has(file) ? manifest.modules.find(item => item.file === file).sha256 : preservedHash(await readFile(path.join(repo, file)));
  }
  return { bytes, sha256: preservedHash(bytes), byteLength: bytes.length, sourceInputs, sourceInputsSHA256: preservedHash(canonical(sourceInputs)), privateBank: { semanticSHA256: manifest.semanticSHA256, sourceManifestSHA256: manifest.sourceManifestSHA256, catalog: manifest.catalog, active: manifest.active, retired: manifest.retired, version: manifest.version }, containsPrivateContent: true };
}

export function preservedMafiaUploadMetadata(name, snapshot) {
  assert.ok(WORKERS.includes(name));
  const bindings = snapshot.settings?.bindings;
  assert.ok(Array.isArray(bindings)); assert.equal(new Set(bindings.map(item => item.name)).size, bindings.length);
  for (const required of ['DB', 'SESSION_SECRET', 'ROOMS', 'SOCIAL_AUDIO', 'SOCIAL_JOBS']) assert.ok(bindings.some(item => item.name === required), 'Existing resources must be present; provisioning is forbidden.');
  const runtime = snapshot.version.resources.script_runtime;
  assert.equal(runtime.migration_tag, name === 'maydan-game' ? 'v3-lamma' : 'v1');
  const metadata = { main_module: `${name}.mjs`, bindings: bindings.filter(item => !SECRET_TYPES.includes(item.type)).map(item => ({ name: item.name, type: 'inherit' })), keep_bindings: [...SECRET_TYPES], compatibility_date: snapshot.settings.compatibility_date, compatibility_flags: snapshot.settings.compatibility_flags || [] };
  for (const key of ['placement', 'logpush', 'observability', 'tail_consumers', 'tags', 'limits', 'annotations', 'usage_model']) if (snapshot.settings[key] !== undefined) metadata[key] = structuredClone(snapshot.settings[key]);
  if (name === 'maydan-game') { assert.ok(bindings.some(item => item.name === 'ASSETS' && item.type === 'assets')); metadata.keep_assets = true; metadata.assets = { config: assetsConfig(runtime.assets) }; }
  assert.equal(metadata.migrations, undefined);
  return { metadata, lease: leaseOf(snapshot), schedules: structuredClone(snapshot.schedules), featureFlagMutation: false, resourceProvisioning: false };
}

export function pairedPreservationDraft({ snapshots, bundles, sourceCommit, bankProof, supportProof, migrationLedger, migrationSHA256 }) {
  assert.match(sourceCommit, /^[a-f0-9]{40}$/); assert.match(migrationSHA256, /^[a-f0-9]{64}$/);
  assert.equal(bankProof.exactLiveMatch, true, 'Prove local private bytes match both live workers before planning.');
  assert.equal(supportProof.exactLiveMatch, true, 'The restored support response must match live GET/HEAD.');
  assert.equal(new Set(migrationLedger).size, migrationLedger.length);
  assert.ok(migrationLedger.includes('0013_social_group_creation.sql'), 'Reconcile the actual pre-Mafia migration ledger.');
  const workers = {};
  for (const name of WORKERS) {
    const compiled = bundles[name]; assert.equal(preservedHash(compiled.bytes), compiled.sha256);
    assert.equal(compiled.privateBank.semanticSHA256, bankProof.semanticSHA256);
    const current = snapshots[name]; assert.equal(current.versionId, bankProof.versions[name], 'Private-bank proof is from another live version.');
    workers[name] = { beforeVersion: current.versionId, beforeLease: leaseOf(current), reviewedModuleSHA256: compiled.sha256, byteLength: compiled.byteLength, sourceInputsSHA256: compiled.sourceInputsSHA256, upload: preservedMafiaUploadMetadata(name, current) };
  }
  return { schemaVersion: 1, kind: 'mafia-paired-preservation-draft', sourceCommit, workers, bankProof, supportProof,
    migration: { name: '0014_mafia.sql', sha256: migrationSHA256, pending: !migrationLedger.includes('0014_mafia.sql') }, migrationLedger,
    readyToApply: false, remoteWrites: false, blockers: ['Freeze and review the integrated candidate bytes and source.', 'Pass the isolated live provider and authenticated API acceptance against these same bytes.', 'Take a fresh encrypted D1 backup and recheck both live leases.', 'Implement and independently review a single-dispatch paired operator; this preparer cannot apply.', 'Keep public feature activation separate pending physical iPhone and human acceptance.'] };
}
