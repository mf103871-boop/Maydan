// يحذف ملفات الوسائط التي لم يعد أي سؤال يشير إليها، ويزيل سطورها من _sources.json.
// يُشغَّل بعد إعادة بناء الحزم: البناء يكتب ملفات جديدة بالأسماء نفسها، فتبقى بقايا
// الحزمة القديمة على القرص وتُنسخ إلى dist بلا داعٍ.
//   node scripts/media-prune.mjs [--apply]
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const CATEGORIES = 'src/data/categories';
const MEDIA = 'media';

const referenced = async () => {
  const used = new Map();
  for (const file of (await readdir(CATEGORIES)).filter((f) => f.endsWith('.json'))) {
    const data = JSON.parse(await readFile(path.join(CATEGORIES, file), 'utf8'));
    const id = data.id || file.replace(/\.json$/, '');
    const set = used.get(id) || new Set();
    for (const q of data.qs || []) {
      const entries = Array.isArray(q.media) ? q.media : q.media ? [q.media] : [];
      for (const m of entries) if (m?.src) set.add(m.src);
    }
    used.set(id, set);
  }
  return used;
};

const used = await referenced();
const apply = process.argv.includes('--apply');
let total = 0;
for (const pack of (await readdir(MEDIA, { withFileTypes: true })).filter((d) => d.isDirectory())) {
  const dir = path.join(MEDIA, pack.name);
  const keep = used.get(pack.name);
  if (!keep) { process.stdout.write(`… ${pack.name}: لا فئة تحمل هذا المعرّف — تُرك كما هو\n`); continue; }
  const orphans = (await readdir(dir)).filter((f) => !f.startsWith('_') && !keep.has(f));
  if (!orphans.length) continue;
  total += orphans.length;
  process.stdout.write(`${apply ? '✂' : '…'} ${pack.name}: ${orphans.length} ملفًا بلا سؤال\n`);
  if (!apply) continue;
  for (const file of orphans) await unlink(path.join(dir, file));
  const indexPath = path.join(dir, '_sources.json');
  try {
    const list = JSON.parse(await readFile(indexPath, 'utf8'));
    const kept = list.filter((r) => keep.has(r.file));
    if (kept.length !== list.length) await writeFile(indexPath, `${JSON.stringify(kept, null, 2)}\n`, 'utf8');
  } catch { /* لا سجل مصادر لهذه الحزمة */ }
}
process.stdout.write(`${total} ملفًا بلا مرجع${apply ? ' — حُذفت' : ' (شغّل --apply للحذف)'}\n`);
