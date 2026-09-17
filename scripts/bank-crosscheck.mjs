// فحوص تعبر حدود الفئة الواحدة — لا يراها وكيل يعمل على ملف واحد.
// (1) تكرار الموضوع نفسه بين حزم الوسائط: لاعب يرى الصورة نفسها في حزمتين.
// (2) تطابق ملفات الوسائط بايتًا ببايت بين الحزم.
// (3) نص سؤال في فئة يكشف جواب سؤال في الفئة نفسها.
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const DIR = 'src/data/categories';
const MEDIA_PACKS = ['flags', 'zoom', 'blur', 'reveal', 'silhouette', 'guesscar', 'placefinder', 'tilepuzzle', 'spotdiff', 'sound'];

const normalize = (s) => String(s || '').trim()
  .replace(/[ً-ْـ]/g, '')      // تشكيل وتطويل
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/\s+/g, ' ')
  .toLowerCase();

async function load() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort();
  const packs = [];
  for (const file of files) packs.push(JSON.parse(await readFile(path.join(DIR, file), 'utf8')));
  return packs;
}

export async function crosscheck() {
  const packs = await load();
  const byId = Object.fromEntries(packs.map((p) => [p.id, p]));
  const report = { sharedAnswers: [], duplicateFiles: [], selfReveal: [] };

  // (1) أجوبة مشتركة بين حزم الوسائط
  const answers = new Map();
  for (const id of MEDIA_PACKS) {
    for (const q of byId[id]?.qs || []) {
      const key = normalize(q.a);
      if (!answers.has(key)) answers.set(key, new Set());
      answers.get(key).add(id);
    }
  }
  for (const [answer, ids] of answers) {
    if (ids.size > 1) report.sharedAnswers.push({ answer, packs: [...ids] });
  }

  // (2) ملفات وسائط متطابقة بين الحزم
  const hashes = new Map();
  for (const id of MEDIA_PACKS) {
    let files = [];
    try { files = (await readdir(path.join('media', id))).filter((f) => !f.startsWith('_')); } catch { continue; }
    for (const file of files) {
      const hash = createHash('md5').update(await readFile(path.join('media', id, file))).digest('hex');
      if (!hashes.has(hash)) hashes.set(hash, []);
      hashes.get(hash).push(`${id}/${file}`);
    }
  }
  for (const [, list] of hashes) {
    const packsOf = new Set(list.map((f) => f.split('/')[0]));
    if (packsOf.size > 1) report.duplicateFiles.push(list);
  }

  // (3) سؤال يكشف جواب سؤال آخر في فئته
  for (const pack of packs) {
    const entries = (pack.qs || []).map((q) => ({ qid: q.qid, a: normalize(q.a), text: normalize(`${q.q || ''} ${(q.hints || []).join(' ')} ${(q.items || []).join(' ')}`) }));
    for (const target of entries) {
      if (target.a.split(' ').length > 3 || target.a.length < 4) continue;
      for (const other of entries) {
        if (other.qid === target.qid) continue;
        if (other.text.includes(target.a)) {
          report.selfReveal.push({ pack: pack.id, answerOf: target.qid, revealedIn: other.qid, answer: target.a });
          break;
        }
      }
    }
  }
  return report;
}

if (process.argv[1]?.endsWith('bank-crosscheck.mjs')) {
  const r = await crosscheck();
  console.log(`أجوبة مشتركة بين حزم الوسائط: ${r.sharedAnswers.length}`);
  for (const s of r.sharedAnswers.slice(0, 20)) console.log(`   «${s.answer}» في ${s.packs.join('، ')}`);
  console.log(`ملفات وسائط متطابقة بين حزم: ${r.duplicateFiles.length}`);
  for (const d of r.duplicateFiles.slice(0, 10)) console.log(`   ${d.join(' = ')}`);
  console.log(`أسئلة تكشف أجوبة أسئلة أخرى في فئتها: ${r.selfReveal.length}`);
  const perPack = {};
  for (const s of r.selfReveal) perPack[s.pack] = (perPack[s.pack] || 0) + 1;
  for (const [p, n] of Object.entries(perPack).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`   ${p}: ${n}`);
}
