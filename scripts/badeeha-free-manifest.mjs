// Public identifiers only: the Worker never needs question text or answers to
// determine whether an online deck belongs entirely to the ten free packs.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { FREE_PACKS } from '../src/shared/account/config.js';

export async function freeQuestionManifest() {
  const result = {};
  for (const category of FREE_PACKS) {
    const pack = JSON.parse(await readFile(new URL(`../src/data/categories/${category}.json`, import.meta.url), 'utf8'));
    if (pack.id !== category || !Array.isArray(pack.qs)) throw new Error('Invalid free question pack');
    result[category] = pack.qs.map(question => question.qid).sort();
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await writeFile(new URL('../server/data/badeeha-free-manifest.json', import.meta.url), JSON.stringify(await freeQuestionManifest(), null, 2) + '\n');
}
