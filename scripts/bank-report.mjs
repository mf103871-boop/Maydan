// تقرير المراجعة: يقارن لقطة «قبل» بحالة البنك الآن، ويولّد جداول التقرير النهائي.
//   node scripts/bank-report.mjs <before.json> [--media] [--csv <dir>]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { snapshot } from './bank-snapshot.mjs';

const TIERS = [200, 400, 600, 800, 1000];

function diffCategory(before, after) {
  if (!before) return { added: after.total, removed: 0, changed: 0, isNew: true };
  const was = new Set(before.qids);
  const now = new Set(after.qids);
  const added = [...now].filter((q) => !was.has(q)).length;
  const removed = [...was].filter((q) => !now.has(q)).length;
  return { added, removed, kept: [...now].filter((q) => was.has(q)).length, isNew: false };
}

export async function report(beforePath) {
  const before = JSON.parse(await readFile(beforePath, 'utf8'));
  const after = await snapshot();
  const rows = [];
  for (const [id, now] of Object.entries(after.categories)) {
    const was = before.categories[id];
    rows.push({
      id, name: now.name,
      totalBefore: was?.total ?? 0, totalAfter: now.total,
      ...diffCategory(was, now),
      tiersBefore: was ? TIERS.map((t) => was.tiers[t]).join('/') : '—',
      tiersAfter: TIERS.map((t) => now.tiers[t]).join('/'),
      shortfallBefore: was ? TIERS.reduce((a, t) => a + was.shortfall[t], 0) : 0,
      shortfallAfter: TIERS.reduce((a, t) => a + now.shortfall[t], 0),
      story: now.story,
      castBefore: was?.story ? `${(was.castShare * 100).toFixed(1)}%` : '—',
      castAfter: now.story ? `${(now.castShare * 100).toFixed(1)}%` : '—',
      media: now.media,
    });
  }
  return { before, after, rows };
}

// جدول الوسائط: كل ملف مع سؤاله ومصدره وترخيصه.
export async function mediaTable() {
  const after = await snapshot();
  const rows = [];
  for (const id of Object.keys(after.categories)) {
    let data;
    try { data = JSON.parse(await readFile(path.join('src/data/categories', `${id}.json`), 'utf8')); } catch { continue; }
    for (const q of data.qs || []) {
      const entries = Array.isArray(q.media) ? q.media : q.media ? [q.media] : [];
      for (const m of entries) {
        rows.push({
          pack: id, qid: q.qid, tier: q.p, question: q.q, answer: q.a,
          file: `media/${id}/${m.src}`, title: m.title, author: m.author,
          license: m.license, licenseUrl: m.licenseUrl, sourceUrl: m.sourceUrl,
        });
      }
    }
  }
  return rows;
}

const csv = (rows, columns) => [columns.join(','), ...rows.map((r) => columns.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');

if (process.argv[1]?.endsWith('bank-report.mjs')) {
  const [beforePath, ...rest] = process.argv.slice(2);
  const outDir = rest.includes('--csv') ? rest[rest.indexOf('--csv') + 1] : null;
  const { rows } = await report(beforePath);
  const media = await mediaTable();
  if (outDir) {
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'categories.csv'), csv(rows, ['id', 'name', 'totalBefore', 'totalAfter', 'added', 'removed', 'kept', 'tiersBefore', 'tiersAfter', 'shortfallAfter', 'castBefore', 'castAfter', 'media']), 'utf8');
    await writeFile(path.join(outDir, 'media.csv'), csv(media, ['pack', 'qid', 'tier', 'question', 'answer', 'file', 'title', 'author', 'license', 'licenseUrl', 'sourceUrl']), 'utf8');
    process.stderr.write(`كُتب ${rows.length} صفًا للفئات و${media.length} صفًا للوسائط في ${outDir}\n`);
  }
  const touched = rows.filter((r) => r.added || r.removed);
  console.log(`فئات مسّها تغيير: ${touched.length} من ${rows.length}`);
  for (const r of touched) console.log(`  ${r.id.padEnd(16)} ${r.totalBefore}→${r.totalAfter}  +${r.added}/-${r.removed}  ${r.tiersBefore} → ${r.tiersAfter}`);
  const licenses = {};
  for (const m of media) licenses[m.license] = (licenses[m.license] || 0) + 1;
  console.log(`\nوسائط: ${media.length} ملفًا`);
  for (const [l, n] of Object.entries(licenses).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${l}`);
}
