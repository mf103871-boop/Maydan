import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertErsomhaPreviewURL, assertErsomhaPreviewConfig, parsePreviewD1Result,
  runErsomhaPreviewAcceptance } from '../scripts/ersomha-preview-acceptance.mjs';

test('remote drawing acceptance URLs cannot escape preview or carry credentials', () => {
  assert.equal(assertErsomhaPreviewURL('/api/rooms').hostname, 'maydan-lamma-preview.mf103871.workers.dev');
  for (const url of ['https://maydan-game.mf103871.workers.dev/api/rooms',
    '//maydan-rooms.mf103871.workers.dev/api/rooms', 'http://maydan-lamma-preview.mf103871.workers.dev/health',
    'https://secret@maydan-lamma-preview.mf103871.workers.dev/health',
    '/health?token=do-not-send', '/health#credentials']) assert.throws(() => assertErsomhaPreviewURL(url));
});

test('fixture storage guards reject production D1, foreign DOs, buckets and assets', async () => {
  const source = await readFile(new URL('../wrangler.lamma-preview.jsonc', import.meta.url), 'utf8');
  assert.equal(assertErsomhaPreviewConfig(source), true);
  for (const changed of [
    source.replace('"name": "maydan-lamma-preview"', '"name": "maydan-game"'),
    source.replace('346a7165-9989-4fe2-a5a3-aec017a2d21b', '9d863a31-6a5c-45f1-91f5-79ad400c3f6e'),
    source.replace('"class_name": "Room"', '"class_name": "Room", "script_name": "maydan-game"'),
    source.replace('"bucket_name": "maydan-lamma-preview-audio"', '"bucket_name": "maydan-social-audio"'),
    source.replace('"workers_dev": true', '"workers_dev": true, "assets": { "directory": "public" }'),
  ]) assert.throws(() => assertErsomhaPreviewConfig(changed));
});

test('D1 acceptance reads require successful structured results despite CLI progress text', () => {
  assert.deepEqual(parsePreviewD1Result('Executing query...\n[{"success":true,"results":[{"n":0}]}]'), [{ n: 0 }]);
  assert.throws(() => parsePreviewD1Result('[{"success":false,"results":[]}]'));
  assert.throws(() => parsePreviewD1Result('No JSON response'));
});

test('explicit preview-only invocation is required before any network, database or fixture work', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('Unexpected network'); };
  try {
    await assert.rejects(runErsomhaPreviewAcceptance([]), /Explicit --run-preview/);
    await assert.rejects(runErsomhaPreviewAcceptance(['--run-preview', '--origin', 'https://maydan-game.mf103871.workers.dev']), /Explicit --run-preview/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
