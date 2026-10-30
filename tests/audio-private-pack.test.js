import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { canonical, privateAudioBuild, dataKey, seal, unseal, validateManifest, sealAssets, unpackAssets, verifyMaterialized, BUNDLE_ID } from '../scripts/audio/private-preview.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const preview = { IOS_RELEASE_ENVIRONMENT: 'mafia-preview', MAYDAN_ROOMS_URL: 'https://maydan-mafia-preview.mf103871.workers.dev', MAYDAN_PRIVATE_AUDIO_PREVIEW: '1' };
test('private audio requires both an explicit opt-in and the exact isolated environment', () => {
  assert.equal(privateAudioBuild({}), false);
  assert.equal(privateAudioBuild(preview), true);
  for (const change of [{ IOS_RELEASE_ENVIRONMENT: 'production' }, { MAYDAN_ROOMS_URL: 'https://attacker.test' }]) assert.throws(() => privateAudioBuild({ ...preview, ...change }), /isolated/);
  assert.throws(() => dataKey({ MAYDAN_AUDIO_PREVIEW_KEY_BASE64: 'invalid' }), /key/);
});
test('authenticated capsules reject altered ciphertext, keys and release identity', () => {
  const key = randomBytes(32), aad = { sourceCommit: 'a'.repeat(40), build: '36', kind: 'ipa' }, payload = Buffer.from('private test payload');
  const options = { key, aad, magic: 'MAYDAN-IPA-1\n', filename: 'Maydan.ipa' };
  const { encrypted, receipt } = seal(payload, options);
  assert.deepEqual(unseal(encrypted, receipt, options), payload);
  assert.equal(canonical({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
  assert.throws(() => unseal(encrypted, receipt, { ...options, key: randomBytes(32) }));
  assert.throws(() => unseal(encrypted, receipt, { ...options, aad: { ...aad, build: '37' } }), /identity/);
  const changed = Buffer.from(encrypted); changed[0] ^= 1;
  assert.throws(() => unseal(changed, receipt, options), /ciphertext/);
  const another = seal(payload, options);
  assert.notEqual(another.receipt.nonceBase64, receipt.nonceBase64);
});
test('asset manifest rejects traversal, duplicates and unbounded extraction', () => {
  const files = Array.from({ length: 24 }, (_, i) => ({ url: `audio/candidates/clip-${i}-${'a'.repeat(12)}.m4a`, sha256: 'a'.repeat(64), bytes: 10 }));
  const manifest = { schemaVersion: 1, bundleId: BUNDLE_ID, catalogSHA256: 'b'.repeat(64), files };
  assert.equal(validateManifest(manifest), manifest);
  for (const file of [{ ...files[0], url: '../secret.m4a' }, { ...files[0], bytes: 90 * 1024 * 1024 }, files[1]]) assert.throws(() => validateManifest({ ...manifest, files: [file, ...files.slice(1)] }));
});
test('private materialization is complete, authenticated, bounded and refuses unexpected overwrite', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'maydan-private-audio-'));
  try {
    await mkdir(path.join(root, 'assets/audio-preview'), { recursive: true });
    await mkdir(path.join(root, 'src/shared/fx'), { recursive: true });
    await mkdir(path.join(root, 'source/audio/candidates'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    const files = [];
    for (let i = 0; i < 24; i++) {
      const bytes = Buffer.from(`candidate fixture ${i}`), hash = sha(bytes), url = `audio/candidates/clip-${i}-${hash.slice(0, 12)}.m4a`;
      await writeFile(path.join(root, 'source', url), bytes); files.push({ url, sha256: hash, bytes: bytes.length });
    }
    const catalog = Buffer.from(`export const CANDIDATE_FILES = ${JSON.stringify(files)};\n`);
    await writeFile(path.join(root, 'src/shared/fx/audio-candidate-catalog.js'), catalog);
    const manifest = { schemaVersion: 1, bundleId: BUNDLE_ID, catalogSHA256: sha(catalog), files };
    const manifestPath = path.join(root, 'assets/audio-preview/manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    const key = randomBytes(32);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, files: [...files, { ...files[0], url: `audio/candidates/extra-${files[0].sha256.slice(0, 12)}.m4a` }] }));
    await assert.rejects(sealAssets(path.join(root, 'source'), { root, key }), /complete catalog/);
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal((await sealAssets(path.join(root, 'source'), { root, key })).files, 24);
    await mkdir(path.join(root, 'source-spoof'));
    await symlink(path.join(root, 'source/audio'), path.join(root, 'source-spoof/audio'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(sealAssets(path.join(root, 'source-spoof'), { root, key }), /escaped/);
    await mkdir(path.join(root, 'outside'));
    await mkdir(path.join(root, 'public'));
    await symlink(path.join(root, 'outside'), path.join(root, 'public/audio'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(unpackAssets({ root, key, env: preview }), /symlinks/);
    assert.deepEqual(await readdir(path.join(root, 'outside')), []);
    await rm(path.join(root, 'public/audio'));
    await assert.rejects(unpackAssets({ root, key, env: {} }), /cannot/);
    assert.equal((await unpackAssets({ root, key, env: preview })).files, 24);
    assert.equal((await readdir(path.join(root, 'public/audio/candidates'))).length, 24);
    assert.equal((await verifyMaterialized(root)).files, 24);
    await writeFile(path.join(root, 'public', files[0].url), 'unexpected overwrite');
    await assert.rejects(unpackAssets({ root, key, env: preview }), /integrity/);
    assert.equal(await readFile(path.join(root, 'public', files[0].url), 'utf8'), 'unexpected overwrite');
  } finally { await rm(root, { recursive: true, force: true }); }
});
