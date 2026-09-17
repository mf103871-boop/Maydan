// لقطة إحصائية لبنك «بَديهة»: تُؤخذ قبل التدقيق وبعده، ويقارن بينهما تقرير المراجعة.
// لا تعدّل شيئًا؛ تقرأ ملفات الفئات فقط وتطبع JSON.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = 'src/data/categories';
const TIERS = [200, 400, 600, 800, 1000];
// فئات القصص: تُقاس فيها نسبة أسئلة الأحداث إلى أسئلة الممثلين/الإنتاج.
const STORY = new Set(['arabseries', 'ramadanseries', 'babalhara', 'syriandrama', 'egyptdrama', 'turkishdrama',
  'ertugrul', 'foreignseries', 'breakingbad', 'squidgame', 'movies', 'arabmovies', 'actors', 'anime', 'naruto',
  'onepiece', 'dragonball', 'aot', 'deathnote', 'demonslayer', 'jujutsu', 'hunterxhunter', 'spacetoon', 'cartoon']);
// مؤشرات سؤال «ممثل/إنتاج» لا «حدث داخل العمل».
const CAST = /(مثّل|يمثّل|ممثل|الممثلة|بطل|بطلة|أدّى دور|أدى دور|جسّد|جسد شخصية|من لعب|من أدّى|صوت الشخصية|المؤدي|المخرج|أخرج|إخراج|المؤلف|كتب السيناريو|سيناريو|الشركة المنتجة|أنتج|إنتاج|عدد المواسم|عدد الحلقات|سنة العرض|قناة العرض|جائزة|الممثلون)/;

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

export async function snapshot() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort();
  const categories = {};
  for (const file of files) {
    const data = JSON.parse(await readFile(path.join(DIR, file), 'utf8'));
    const qs = data.qs || [];
    const tiers = Object.fromEntries(TIERS.map((t) => [t, 0]));
    const topics = {};
    const answers = new Map();
    const questions = new Map();
    let media = 0; let verified = 0; let cast = 0; let longQ = 0; let longA = 0;
    for (const q of qs) {
      if (tiers[q.p] !== undefined) tiers[q.p]++;
      topics[q.topic || '—'] = (topics[q.topic || '—'] || 0) + 1;
      if (q.media) media++;
      if (q.verified) verified++;
      if (CAST.test(q.q || '')) cast++;
      if (words(q.q) > 22) longQ++;
      if (words(q.a) > 6) longA++;
      const a = String(q.a || '').trim();
      answers.set(a, (answers.get(a) || 0) + 1);
      const key = String(q.q || '').replace(/\s+/g, ' ').trim();
      questions.set(key, (questions.get(key) || 0) + 1);
    }
    categories[data.id || file.replace(/\.json$/, '')] = {
      name: data.name, icon: data.icon, style: data.style || null, defaultType: data.defaultType || null,
      total: qs.length, tiers, media, verified,
      shortfall: Object.fromEntries(TIERS.map((t) => [t, Math.max(0, 48 - tiers[t])])),
      topics: Object.keys(topics).length,
      topicMaxShare: qs.length ? Math.max(...Object.values(topics)) / qs.length : 0,
      dupAnswers: [...answers.values()].filter((n) => n > 1).length,
      dupQuestions: [...questions.values()].filter((n) => n > 1).length,
      story: STORY.has(data.id), castQuestions: cast,
      castShare: qs.length ? cast / qs.length : 0,
      longQ, longA,
      qids: qs.map((q) => q.qid),
    };
  }
  return { takenAt: new Date().toISOString(), files: files.length, categories };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  process.stdout.write(`${JSON.stringify(await snapshot(), null, 2)}\n`);
}
