// يقارن لقطة «قبل» بالبنك الآن ويسجّل المعرّفات التي اختفت في docs/bank/retired-qids.json
// حتى لا يُعاد إسنادها: سجل «لُعب سابقًا» على أجهزة اللاعبين يعتمد على المعرّف، فإعادة
// استعماله لسؤال آخر تُخفي السؤال الجديد عمّن لعب القديم.
//   node scripts/bank-retire.mjs <before.json> [--apply]
import { readFile, writeFile } from 'node:fs/promises';
import { snapshot } from './bank-snapshot.mjs';

const FILE = 'docs/bank/retired-qids.json';
const [beforePath] = process.argv.slice(2);
const apply = process.argv.includes('--apply');

const before = JSON.parse(await readFile(beforePath, 'utf8'));
const after = await snapshot();
const registry = JSON.parse(await readFile(FILE, 'utf8'));
// The validator consumes qids (strings). Recover entries written by the old
// helper instead of silently leaving them outside the retirement registry.
registry.qids = [...new Set([
  ...(registry.qids || []),
  ...(registry.ids || []).map((entry) => typeof entry === 'string' ? entry : entry.qid),
])];
const migratedLegacyIds = Object.hasOwn(registry, 'ids');
delete registry.ids;

const known = new Set(registry.qids);
for (const range of registry.ranges || []) {
  for (let n = range.start; n <= range.end; n++) known.add(`${range.category}-${range.tier}-${String(n).padStart(3, '0')}`);
}

const retiring = [];
for (const [id, was] of Object.entries(before.categories)) {
  const now = after.categories[id];
  if (!now) continue;
  const live = new Set(now.qids);
  for (const qid of was.qids) if (!live.has(qid) && !known.has(qid)) retiring.push({ category: id, qid });
}

const byCategory = {};
for (const r of retiring) (byCategory[r.category] ||= []).push(r.qid);
for (const [category, ids] of Object.entries(byCategory)) process.stdout.write(`${category}: ${ids.length} معرّفًا\n`);
process.stdout.write(`${retiring.length} معرّفًا يحتاج تقاعدًا${apply ? '' : ' (شغّل --apply للكتابة)'}\n`);

if (apply && (retiring.length || migratedLegacyIds)) {
  for (const { qid } of retiring) registry.qids.push(qid);
  registry.qids.sort((a, b) => a.localeCompare(b));
  await writeFile(FILE, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  process.stdout.write(`كُتب ${FILE}\n`);
}
