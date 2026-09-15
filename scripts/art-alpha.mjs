// يزيل الخلفية العاجية/البيضاء المدمجة من لوحات الرسوم الصلصالية ويُخرجها بقناة شفافية.
// الأصول المسطّحة (كما سُلِّمت) في src/shared/brand/assets/flat/ ولا تُستورد في الحزمة؛
// المخرجات تحل محل الملفات التي يستوردها art.jsx.
//
//   node scripts/art-alpha.mjs            يعالج اللوحات الثلاث
//   node scripts/art-alpha.mjs --check    يتحقق أن المخرجات شفافة الحواف ويرسب إن لم تكن
//
// الطريقة: لون الخلفية = متوسط الإطار الخارجي؛ غمر (flood fill) من الحواف داخل المساحة
// القريبة من ذلك اللون، فتبقى المناطق العاجية المحاطة داخل الرسم (قرص الشخصية، فتيل
// المصباح، الكف). داخل المنطقة المغمورة تُحسب ألفا ناعمة بين حدّين للمسافة اللونية،
// ويُنقّى لون البكسلات نصف الشفافة من صبغة الخلفية كي لا تبقى هالة عاجية على الأسطح
// الملونة. الظلال الخفيفة المرسومة على الخلفية تُزال عمدًا: يعوّضها ظل CSS يتبع السطح.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src/shared/brand/assets');
export const SHEETS = ['avatars', 'game-icons', 'trophy'];
const T_BG = 42;   // مسافة لونية أقل من هذا = خلفية صرفة (تشمل الظلال الباهتة)
const T_FG = 110;  // أكثر من هذا = رسم صرف؛ بينهما ألفا متدرجة

async function loadSharp() {
  try { return (await import('sharp')).default; } catch (error) {
    console.error(`تعذّر تحميل sharp (${String(error.message).split('\n')[0]}) — نفّذ npm install`); process.exit(2);
  }
}

export function keyBackground(data, width, height, { tBg = T_BG, tFg = T_FG } = {}) {
  const N = width * height;
  let r = 0, g = 0, b = 0, c = 0;
  const add = (i) => { r += data[i]; g += data[i + 1]; b += data[i + 2]; c++; };
  for (let x = 0; x < width; x++) { add(x * 4); add(((height - 1) * width + x) * 4); }
  for (let y = 0; y < height; y++) { add((y * width) * 4); add((y * width + width - 1) * 4); }
  const bg = [r / c, g / c, b / c];
  const dist = (i) => Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]);
  const reach = new Uint8Array(N); const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x; if (reach[p] || dist(p * 4) > tFg) return; reach[p] = 1; stack.push(p);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (stack.length) { const p = stack.pop(); const x = p % width, y = (p / width) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
  const out = Buffer.from(data); let removed = 0;
  for (let p = 0; p < N; p++) {
    if (!reach[p]) continue;
    const i = p * 4; let a = (dist(i) - tBg) / (tFg - tBg); a = a < 0 ? 0 : a > 1 ? 1 : a;
    if (a === 0) removed++;
    if (a < 1) for (let k = 0; k < 3; k++) { const v = a > 0 ? (data[i + k] - (1 - a) * bg[k]) / a : data[i + k]; out[i + k] = v < 0 ? 0 : v > 255 ? 255 : v; }
    out[i + 3] = Math.round(a * 255);
  }
  return { out, bg, removed: removed / N };
}

async function process_(sharp) {
  for (const name of SHEETS) {
    const input = path.join(DIR, 'flat', `${name}.webp`), output = path.join(DIR, `${name}.webp`);
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { out, bg, removed } = keyBackground(data, info.width, info.height);
    await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: 88, alphaQuality: 90, effort: 5 }).toFile(output);
    const bytes = (await stat(output)).size;
    console.log(`${name}: خلفية ${bg.map(Math.round).join(',')} · أُزيل ${(removed * 100).toFixed(1)}% · ${(bytes / 1024).toFixed(0)} ك.ب`);
  }
}

// الحواف الأربع شفافة تمامًا والملف يحمل قناة ألفا: هذا ما تعتمد عليه brand.css.
export async function checkSheets(sharp, dir = DIR) {
  const problems = [];
  for (const name of SHEETS) {
    const file = path.join(dir, `${name}.webp`);
    const meta = await sharp(file).metadata();
    if (!meta.hasAlpha) { problems.push(`${name}: بلا قناة ألفا`); continue; }
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaqueEdge = 0, total = 0;
    const check = (x, y) => { total++; if (data[(y * info.width + x) * 4 + 3] > 8) opaqueEdge++; };
    for (let x = 0; x < info.width; x++) { check(x, 0); check(x, info.height - 1); }
    for (let y = 0; y < info.height; y++) { check(0, y); check(info.width - 1, y); }
    if (opaqueEdge / total > 0.02) problems.push(`${name}: ${(100 * opaqueEdge / total).toFixed(1)}% من بكسلات الإطار غير شفافة`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sharp = await loadSharp();
  if (process.argv.includes('--check')) {
    const problems = await checkSheets(sharp);
    if (problems.length) { for (const p of problems) console.error('✗', p); process.exit(1); }
    console.log(`✓ ${SHEETS.length} لوحات شفافة الحواف`);
  } else await process_(sharp);
}
