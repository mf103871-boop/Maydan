// يمنح أسئلة الحزم المعاد بناؤها معرّفات لم تُستعمل من قبل.
//
// سجل «لُعب سابقًا» على جهاز اللاعب يخزّن المعرّفات. والحزمة المعاد بناؤها تبدأ الترقيم
// من 001 فتصطدم بمعرّفات أسئلة قديمة مختلفة تمامًا، فيُخفى السؤال الجديد عمّن لعب
// القديم. الحل: إزاحة الترقيم فوق أعلى رقم استُعمل في تلك الخانة سابقًا.
//
//   node scripts/bank-renumber.mjs <before.json> <pack…> [--apply]
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [beforePath, ...packs] = args.filter((a) => a !== '--apply');
const before = JSON.parse(await readFile(beforePath, 'utf8'));

const pad = (n) => String(n).padStart(3, '0');

for (const pack of packs) {
  const file = path.join('src/data/categories', `${pack}.json`);
  const data = JSON.parse(await readFile(file, 'utf8'));
  // أعلى رقم استُعمل في كل خانة قبل إعادة البناء.
  const ceiling = {};
  for (const qid of before.categories[pack]?.qids || []) {
    const [, tier, index] = qid.split('-');
    ceiling[tier] = Math.max(ceiling[tier] || 0, Number(index) || 0);
  }
  const counters = {};
  const renames = [];
  for (const q of data.qs) {
    const tier = String(q.p);
    const start = (ceiling[tier] || 0) + 1;
    const index = (counters[tier] = (counters[tier] || start - 1) + 1);
    const next = `${pack}-${tier}-${pad(index)}`;
    if (next === q.qid) continue;
    const entries = Array.isArray(q.media) ? q.media : q.media ? [q.media] : [];
    for (const m of entries) {
      if (!m?.src) continue;
      const suffix = m.src.slice(q.qid.length);           // «.webp» أو «-1.webp»
      if (!m.src.startsWith(q.qid)) continue;
      renames.push([path.join('media', pack, m.src), path.join('media', pack, next + suffix)]);
      m.src = next + suffix;
    }
    q.qid = next;
  }
  process.stdout.write(`${pack}: ${renames.length} ملفًا · يبدأ الترقيم فوق ${JSON.stringify(ceiling)}\n`);
  if (!apply) continue;
  for (const [from, to] of renames) await rename(from, to);
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  // سجل المصادر يحمل اسم الملف، فيُحدَّث معه.
  const indexPath = path.join('media', pack, '_sources.json');
  try {
    const list = JSON.parse(await readFile(indexPath, 'utf8'));
    const map = new Map(renames.map(([from, to]) => [path.basename(from), path.basename(to)]));
    for (const record of list) if (map.has(record.file)) record.file = map.get(record.file);
    await writeFile(indexPath, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  } catch { /* لا سجل */ }
}
