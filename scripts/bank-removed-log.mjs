// يوثّق الأسئلة التي اختفت من كل فئة أثناء المراجعة، كما تشترط docs/bank/RUBRIC.md §6.
// المصدر: حالة الملف عند القاعدة (commit) مقارنةً بحالته الآن — فالنص القديم لا
// يوجد في اللقطة الإحصائية، وgit وحده يحفظه.
//   node scripts/bank-removed-log.mjs <base-ref> [--apply]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const DIR = 'src/data/categories';
const [base] = process.argv.slice(2);
const apply = process.argv.includes('--apply');
if (!base) { process.stderr.write('الاستعمال: node scripts/bank-removed-log.mjs <base-ref> [--apply]\n'); process.exit(2); }

const stamp = new Date().toISOString().slice(0, 10);
let totalRemoved = 0; let totalChanged = 0; let totalReworded = 0;

for (const file of (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort()) {
  const id = file.replace(/\.json$/, '');
  let old;
  try { ({ stdout: old } = await run('git', ['show', `${base}:${path.join(DIR, file)}`], { maxBuffer: 64 * 1024 * 1024 })); }
  catch { continue; }                                    // فئة جديدة لم تكن موجودة
  const was = new Map((JSON.parse(old).qs || []).map((q) => [q.qid, q]));
  const now = new Map((JSON.parse(await readFile(path.join(DIR, file), 'utf8')).qs || []).map((q) => [q.qid, q]));

  const removed = [...was.values()].filter((q) => !now.has(q.qid));
  // سؤال بقي معرّفه وتبدّل جوابه: استُبدل مضمونه، وهو حذف بمعنى المراجعة.
  // وسؤال تبدّل نصه وحده: أُعيدت صياغته، وهو تحسين لا حذف. يُفصل بينهما.
  const replaced = [...was.values()].filter((q) => now.get(q.qid) && now.get(q.qid).a !== q.a);
  const reworded = [...was.values()].filter((q) => {
    const after = now.get(q.qid);
    return after && after.a === q.a && after.q !== q.q;
  });
  if (!removed.length && !replaced.length && !reworded.length) continue;
  totalRemoved += removed.length; totalChanged += replaced.length; totalReworded += reworded.length;

  const lines = [`# أسئلة أُزيلت أو استُبدل مضمونها — ${id}`, '',
    `مراجعة ${stamp}. المقارنة بحالة الملف عند \`${base}\`.`, '',
    `أُزيلت نهائيًا: ${removed.length} · استُبدل جوابها بالمعرّف نفسه: ${replaced.length} · أُعيدت صياغتها: ${reworded.length}`, ''];
  if (removed.length) {
    lines.push('## أُزيلت نهائيًا', '', '| المعرّف | الخانة | السؤال | الجواب |', '| --- | --- | --- | --- |');
    for (const q of removed) lines.push(`| \`${q.qid}\` | ${q.p} | ${String(q.q || '—').replace(/\|/g, '\\|')} | ${String(q.a).replace(/\|/g, '\\|')} |`);
    lines.push('', 'هذه المعرّفات مسجّلة في `docs/bank/retired-qids.json` فلا يُعاد إسنادها.', '');
  }
  if (replaced.length) {
    lines.push('## استُبدل جوابها', '', '| المعرّف | الخانة | كان | صار |', '| --- | --- | --- | --- |');
    for (const q of replaced) {
      const after = now.get(q.qid);
      const before = `${String(q.q || '—')} ← ${q.a}`.replace(/\|/g, '\\|');
      const to = `${String(after.q || '—')} ← ${after.a}`.replace(/\|/g, '\\|');
      lines.push(`| \`${q.qid}\` | ${q.p} | ${before} | ${to} |`);
    }
    lines.push('');
  }
  const target = path.join('docs/bank', `removed-${id}.md`);
  process.stdout.write(`${id}: أُزيلت ${removed.length} · استُبدل جوابها ${replaced.length} · أُعيدت صياغتها ${reworded.length}\n`);
  if (apply) await writeFile(target, `${lines.join('\n')}\n`, 'utf8');
}
process.stdout.write(`المجموع: ${totalRemoved} مُزالًا و${totalChanged} مستبدل الجواب و${totalReworded} معاد الصياغة${apply ? ' — كُتبت السجلات' : ' (شغّل --apply للكتابة)'}\n`);
