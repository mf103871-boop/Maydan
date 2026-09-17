// يجمع بنود الشك التي يكتبها وكلاء التدقيق في ملف واحد مرتّب، ويصنّفها بنوع القرار
// حتى يقرر المالك على الأنماط دفعةً واحدة بدل بندٍ بند.
//   node scripts/bank-doubts.mjs <doubts-dir> [--md <out.md>]
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [dir] = process.argv.slice(2);
const mdIndex = process.argv.indexOf('--md');
const mdOut = mdIndex === -1 ? null : process.argv[mdIndex + 1];

// أنماط القرار المتكررة. الترتيب مقصود: الأدق أولًا.
const KINDS = [
  ['معلومة غير مؤكدة', /لم أتحقق|غير مؤكد|غير موثّق|محلّ خلاف|تحتاج تدقيق|قد تلتبس|مصدر ثانوي/],
  ['مستوى بين خانتين', /مستوى|خانت|أصعب|أسهل|بين 200|بين خانتين/],
  ['نطاق الفئة', /نطاق|تداخل|خارج الفئة|بصمة الفئة/],
  ['تكرار أو تشابه', /تكرار|مكرر|تشابه|ازدواج/],
  ['صيغة الجواب', /صيغة الجواب|جواب عام|جواب فضفاض|تهجئة|النقل العربي|alt/],
  ['تسريب جواب', /مكشوف|تسريب|يكشف/],
  ['قرار تحريري', /قرار|نمط|توصية|إقرار/],
  ['ملف مشترك', /ملف خارج|retired|removed-|bank-status/],
];

const classify = (item) => {
  const text = `${item.issue || ''} ${item.detail || ''}`;
  for (const [name, re] of KINDS) if (re.test(text)) return name;
  return 'أخرى';
};

const all = [];
for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
  let data;
  try { data = JSON.parse(await readFile(path.join(dir, file), 'utf8')); } catch { continue; }
  for (const item of data.items || []) all.push({ category: data.category || file.replace(/\.json$/, ''), kind: classify(item), ...item });
}

const byKind = {};
for (const item of all) (byKind[item.kind] ||= []).push(item);
process.stdout.write(`${all.length} بندًا من ${new Set(all.map((i) => i.category)).size} فئة\n`);
for (const [kind, items] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
  process.stdout.write(`${String(items.length).padStart(4)}  ${kind}\n`);
}

if (mdOut) {
  const lines = ['# بنود الشك — مراجعة بنك «بَديهة»', '',
    `${all.length} بندًا جمعها وكلاء التدقيق من ${new Set(all.map((i) => i.category)).size} فئة.`,
    'كل بند يذكر السؤال والمشكلة والخيارات وتوصية المدقّق.', ''];
  for (const [kind, items] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${kind} — ${items.length} بندًا`, '');
    for (const item of items) {
      lines.push(`- **${item.category}** \`${item.qid || '—'}\`: ${item.detail || item.issue}`);
      if (item.options?.length) lines.push(`  - الخيارات: ${item.options.join(' · ')}`);
      if (item.recommend) lines.push(`  - التوصية: ${item.recommend}`);
    }
    lines.push('');
  }
  await writeFile(mdOut, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`كُتب ${mdOut}\n`);
}
