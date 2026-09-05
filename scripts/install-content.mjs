// يدمج محتوى الألعاب الخمس الجديدة من مجلد المسودّات إلى src/data/games،
// بعد تطبيق أحكام المراجعين (reject/fix). يُشغَّل مرة عند تحديث المحتوى:
//   node scripts/install-content.mjs <مجلد-المسودّات>
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const SRC = process.argv[2];
if (!SRC) {
  console.error('usage: node scripts/install-content.mjs <content-dir>');
  process.exit(1);
}

const DATA = path.join(ROOT, 'src/data/games');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

// أحكام المراجعين: كل ملف مصدر قد يصحبه <name>.verdict.<lens>.json
async function verdictsFor(dir, base) {
  const files = (await readdir(dir)).filter((f) => f.startsWith(`${base}.verdict.`) && f.endsWith('.json'));
  const reject = new Set();
  const fix = {};
  for (const f of files) {
    try {
      const v = await readJson(path.join(dir, f));
      for (const id of v.reject || []) reject.add(id);
      for (const [id, patch] of Object.entries(v.fix || {})) fix[id] = { ...(fix[id] || {}), ...patch };
    } catch (error) {
      console.warn(`  تعذّرت قراءة ${f}: ${error.message}`);
    }
  }
  return { reject, fix, lenses: files.length };
}

function applyVerdict(items, { reject, fix }) {
  return items.filter((it) => !reject.has(it.id)).map((it) => (fix[it.id] ? { ...it, ...fix[it.id] } : it));
}

// يزيل التكرار عبر الملفات: نفس المعرّف أو نفس النص المطبَّع.
function dedupe(items, keyOf) {
  const seenId = new Set();
  const seenKey = new Set();
  const out = [];
  let dropped = 0;
  for (const it of items) {
    const key = keyOf(it);
    if (seenId.has(it.id) || seenKey.has(key)) { dropped += 1; continue; }
    seenId.add(it.id);
    seenKey.add(key);
    out.push(it);
  }
  return { out, dropped };
}

const norm = (s) => String(s || '').replace(/[ًٌٍَُِّْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();

async function collect(game, keyOf) {
  const dir = path.join(SRC, game);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.includes('.verdict.')).sort();
  let all = [];
  let rejected = 0;
  let fixed = 0;
  for (const f of files) {
    const base = f.replace(/\.json$/, '');
    const raw = await readJson(path.join(dir, f));
    const items = Array.isArray(raw) ? raw : raw.items;
    const verdict = await verdictsFor(dir, base);
    const kept = applyVerdict(items, verdict);
    rejected += items.length - kept.length;
    fixed += Object.keys(verdict.fix).length;
    all = all.concat(kept);
  }
  const { out, dropped } = dedupe(all, keyOf);
  return { items: out, files: files.length, rejected, fixed, dropped };
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 1)}\n`, 'utf8');
}

const report = [];

// beep / mamnoo / fabraka / meenfina: ملف واحد مدموج لكل لعبة
for (const [game, out, keyOf] of [
  ['beep', 'beep/prompts.json', (it) => norm(it.text)],
  ['mamnoo', 'mamnoo/cards.json', (it) => norm(it.word)],
  ['fabraka', 'fabraka/questions.json', (it) => norm(it.text)],
  ['meenfina', 'meenfina/statements.json', (it) => norm(it.text)],
]) {
  const r = await collect(game, keyOf);
  await writeJson(path.join(DATA, out), r.items);
  report.push([game, r.items.length, r]);
}

// jabeen: فئة لكل ملف، تحتفظ ببنيتها
{
  const dir = path.join(SRC, 'jabeen');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.includes('.verdict.')).sort();
  let total = 0;
  let rejected = 0;
  let dropped = 0;
  const ids = [];
  for (const f of files) {
    const base = f.replace(/\.json$/, '');
    const cat = await readJson(path.join(dir, f));
    const verdict = await verdictsFor(dir, base);
    const kept = applyVerdict(cat.items, verdict);
    rejected += cat.items.length - kept.length;
    const d = dedupe(kept, (it) => norm(it.text));
    dropped += d.dropped;
    total += d.out.length;
    ids.push(cat.id);
    await writeJson(path.join(DATA, 'jabeen', `${cat.id}.json`), { ...cat, items: d.out });
  }
  const index = `// فئات «على جبينك» — كل فئة ملف مستقل.\n${ids.map((id) => `import ${id} from './${id}.json';`).join('\n')}\n\nexport default [${ids.join(', ')}];\n`;
  await writeFile(path.join(DATA, 'jabeen/index.js'), index, 'utf8');
  report.push(['jabeen', total, { files: files.length, rejected, fixed: 0, dropped }]);
}

console.log('المحتوى المثبَّت:');
for (const [game, count, r] of report) {
  console.log(`  ${game.padEnd(9)} ${String(count).padStart(4)} عنصرًا من ${r.files} ملفات · حُذف بالمراجعة ${r.rejected} · صُحّح ${r.fixed} · مكرر مُزال ${r.dropped}`);
}
