import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readRetiredQids } from '../scripts/bank.mjs';

const cli = fileURLToPath(new URL('../scripts/bank-retire.mjs', import.meta.url));
async function fixture(t, registry) {
  const root = await mkdtemp(path.join(tmpdir(), 'maydan-retire-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src/data/categories'), { recursive: true });
  await mkdir(path.join(root, 'docs/bank'), { recursive: true });
  await writeFile(path.join(root, 'src/data/categories/general.json'), JSON.stringify({ id: 'general', qs: [{ qid: 'general-200-921', p: 200, q: 'سؤال', a: 'جواب' }] }));
  await writeFile(path.join(root, 'before.json'), JSON.stringify({ categories: { general: { qids: ['general-200-911'] } } }));
  await writeFile(path.join(root, 'docs/bank/retired-qids.json'), JSON.stringify(registry));
  return root;
}
function run(root, apply) {
  const result = spawnSync(process.execPath, [cli, 'before.json', ...(apply ? ['--apply'] : [])], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
test('retirement CLI writes the registry field consumed by validation and is idempotent', async (t) => {
  const root = await fixture(t, { ranges: [], qids: [] });
  run(root, false);
  assert.equal((await readRetiredQids(root)).size, 0, 'dry run must not retire anything');
  run(root, true);
  run(root, true);
  assert.deepEqual([...await readRetiredQids(root)], ['general-200-911']);
});
test('retirement CLI recovers legacy ids without losing existing ranges or qids', async (t) => {
  const root = await fixture(t, { ranges: [{ category: 'general', tier: 400, start: 1, end: 2 }], qids: ['general-600-901'], ids: [{ qid: 'general-800-901' }, 'general-1000-901'] });
  run(root, true);
  const retired = await readRetiredQids(root);
  assert.equal(retired.size, 6);
  for (const qid of ['general-200-911', 'general-400-001', 'general-400-002', 'general-600-901', 'general-800-901', 'general-1000-901']) assert.ok(retired.has(qid));
  const saved = JSON.parse(await readFile(path.join(root, 'docs/bank/retired-qids.json'), 'utf8'));
  assert.equal(Object.hasOwn(saved, 'ids'), false);
});
