import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import * as original from '../src/shared/fx/audio-candidate-catalog.js';
import { audioCatalogPackagingPlugin, packedAudioCatalogSource } from '../scripts/audio/catalog-packaging.mjs';

test('lossless catalog packaging preserves every field, alias, frozen record and preview-only status', async () => {
  const packed = await import(`data:text/javascript;base64,${Buffer.from(packedAudioCatalogSource()).toString('base64')}`);
  for (const key of ['CANDIDATE_BUNDLE_ID','CANDIDATE_FILES','CANDIDATE_AUDITIONS','CANDIDATE_SCENES','CANDIDATE_EFFECTS']) assert.deepEqual(packed[key], original[key], key);
  for (const entry of packed.CANDIDATE_FILES) {
    assert.ok(Object.isFrozen(entry)); assert.ok(Object.isFrozen(entry.processing));
    assert.equal(entry.listeningApproved, false); assert.equal(entry.candidateForPrivateTest, true);
  }
  assert.equal(packed.CANDIDATE_SCENES.home, packed.CANDIDATE_AUDITIONS.menus);
  assert.equal(packed.CANDIDATE_EFFECTS.correct, packed.CANDIDATE_FILES.find(row=>row.id==='fx-correct'));
});

test('the actual bundler plugin reduces startup bytes without touching the catalog source or audio identity', async () => {
  const options = { stdin:{contents:"export * from './src/shared/fx/audio-candidate-catalog.js';",resolveDir:process.cwd()},bundle:true,write:false,minify:true,format:'esm',logLevel:'silent' };
  const plain = await build(options), compact = await build({...options,plugins:[audioCatalogPackagingPlugin()]});
  assert.ok(compact.outputFiles[0].contents.length < plain.outputFiles[0].contents.length - 8000);
  const result = await import(`data:text/javascript;base64,${Buffer.from(compact.outputFiles[0].contents).toString('base64')}`);
  assert.deepEqual(result.CANDIDATE_FILES, original.CANDIDATE_FILES);
});
