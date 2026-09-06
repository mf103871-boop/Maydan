// بنك أسئلة «بَديهة»: تحقق وتقرير وترتيب.
//
//   node scripts/bank.mjs validate [<id>]   يفحص فئة واحدة أو البنك كله؛ exit 1 عند أي خطأ
//   node scripts/bank.mjs report [--json]   جدول الفئات × الخانات مع الحالة والوسائط
//   node scripts/bank.mjs sort <id>         يرتّب ملف الفئة (p ثم qid) ويعيد توليد index.js
//   node scripts/bank.mjs index             يعيد توليد index.js فقط
//   node scripts/bank.mjs status <id> done|pending   يحدّث الحالة والأعداد من الملف الفعلي
//
// القواعد كلها في docs/bank/RUBRIC.md، وبنية الملفات في docs/bank/SCHEMA.md.
// الحدود تُقرأ من src/data/bank-status.json ولا تُخفَّض من هنا.
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arabicNormalize } from '../src/shared/lib/arabicNormalize.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATS_DIR = 'src/data/categories';
const STATUS_FILE = 'src/data/bank-status.json';
const MEDIA_DIR = 'media';

export const QID_NEW = /^[a-z][a-z0-9]*-(200|400|600|800|1000)-\d{3}$/;
export const QID_LEGACY = /^[0-9a-f]{12}$/;
const CATEGORY_ID = /^[a-z][a-z0-9]*$/;

// الأنواع التي تعرفها اللعبة. غياب type يعني سؤالًا نصيًا.
export const TYPES = new Set([
  'image', 'audio', 'video', 'diff', 'truefalse', 'choice', 'scramble', 'complete', 'common', 'hints', 'code',
  'emoji', 'order', 'odd', 'grid', 'flag', 'zoom', 'pic', 'sound', 'closest',
]);
const IMAGE_EFFECTS = new Set(['none', 'zoom', 'blur', 'silhouette', 'reveal', 'jumble']);
const MEDIA_TYPES = new Set(['image', 'audio', 'video', 'diff']);
// أنواع لا تحمل إجابة مكتوبة لأن الإجابة داخل عناصرها
const NO_WRITTEN_ANSWER = new Set(['order', 'odd', 'grid']);
// أنواع إجاباتها من مجموعة مغلقة (صح/خطأ، أحد الخيارات) فتكرارها طبيعي
const FIXED_ANSWER = new Set(['truefalse', 'choice']);
// أنواع يجوز أن يخلو سؤالها من نص لأن الوسيط أو العنصر هو السؤال
const NO_TEXT_OK = new Set(['image', 'audio', 'video', 'diff', 'flag', 'zoom', 'pic', 'sound', 'grid', 'odd', 'order', 'scramble', 'common']);

const IMAGE_EXT = /\.(webp|png|jpe?g|gif|avif|svg)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|opus|wav)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const EXTERNAL = /^(https?:)?\/\//i;

// التراخيص المقبولة فقط: CC0، الملك العام، CC BY، CC BY-SA. أي شيء آخر مرفوض.
export function isAllowedLicense(value) {
  const s = String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) return false;
  if (/\bNC\b|\bND\b|NON-?COMMERCIAL|NO-?DERIV/.test(s)) return false;
  if (/^CC0\b/.test(s) || /^PUBLIC DOMAIN\b/.test(s) || /^PD\b/.test(s) || /PDM\b/.test(s)) return true;
  if (/^CC BY(-SA)?( \d(\.\d)?)?$/.test(s) || /^CC-BY(-SA)?(-\d(\.\d)?)?$/.test(s)) return true;
  return false;
}

// التطبيع نفسه الذي تستعمله الواجهة (src/shared/lib/arabicNormalize.js)، كي لا
// يمرّ سؤال من المدقّق ثم تعجز شاشة اللعب عن مطابقة إجابته.
export const normalizeArabic = arabicNormalize;

export function wordCount(text) {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

const isNumeric = (s) => /^[\d٠-٩.,٫ ]+$/.test(String(s || '').trim());

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

export async function readStatus(root = ROOT) {
  return JSON.parse(await readFile(path.join(root, STATUS_FILE), 'utf8'));
}

export async function writeStatus(status, root = ROOT) {
  await writeFile(path.join(root, STATUS_FILE), `${JSON.stringify(status, null, 2)}\n`);
}

export async function listCategoryFiles(root = ROOT) {
  const dir = path.join(root, CATS_DIR);
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith('.json')); } catch { return []; }
  return files.sort();
}

export async function readCategory(root, id) {
  const file = path.join(root, CATS_DIR, `${id}.json`);
  return JSON.parse(await readFile(file, 'utf8'));
}

function mediaList(question) {
  if (!question || question.media == null) return [];
  return Array.isArray(question.media) ? question.media : [question.media];
}

function mediaSrc(entry) {
  if (typeof entry === 'string') return entry.trim();
  if (entry && typeof entry === 'object') return String(entry.src || '').trim();
  return '';
}

function mediaFilePath(root, categoryId, src) {
  if (!src || EXTERNAL.test(src) || /^data:/i.test(src)) return null;
  const rel = src.startsWith(`${MEDIA_DIR}/`) ? src.slice(MEDIA_DIR.length + 1) : path.join(categoryId, src);
  return path.join(root, MEDIA_DIR, rel);
}

// أسئلة الإنتاج الممنوعة في فئات الدراما — بصيغ السؤال لا بالكلمة المفردة، لأن
// «المخرج» قد يكون بابًا و«المنتج» سلعة داخل أحداث العمل. (\b لا يعمل مع العربية.)
const W = '(^|[\\s«"(])';
export const STORY_CREDITS = [
  [new RegExp(`${W}(من (هو |هي )?(أخرج|مخرج|المخرج|مخرجة|المخرجة)|مخرج (المسلسل|الفيلم|الأنمي|العمل|الجزء)|أخرجه|أخرجته|أخرجت )`), 'المخرج'],
  [new RegExp(`${W}(من (كتب|كتبت|ألّف|ألف|ألّفت|مؤلف|المؤلف|كاتب|الكاتب|كاتبة|الكاتبة)|كاتب (السيناريو|المسلسل|القصة|النص)|السيناريو والحوار|مؤلف (المانغا|القصة|الرواية)|مبتكر (المسلسل|الأنمي|الشخصية))`), 'الكاتب/المؤلف'],
  [new RegExp(`${W}(الموسيقى التصويرية|من لحّن|من لحن|ملحن (المقدمة|الشارة|الأغنية))`), 'الملحن'],
  [new RegExp(`${W}(شركة الإنتاج|استوديو (الإنتاج|الرسوم|التحريك|الأنمي)|من أنتج|المنتج (المنفذ|الرئيسي)|إنتاج (استوديو|شركة)|أي استوديو)`), 'الإنتاج'],
  [new RegExp(`${W}((بدأ|بدأت) (عرض|بث)|عُرض (لأول مرة|عام|سنة)|سنة (إنتاج|الإنتاج|عرض|العرض)|عام (إنتاج|الإنتاج)|في أي (عام|سنة) (عُرض|عرض|بدأ|أُنتج|انتج|صدر)|القناة التي عرضت)`), 'تاريخ العرض/الإنتاج'],
  [new RegExp(`${W}(كم (موسمًا|موسما|موسم|حلقة|حلقةً|جزءًا|جزءا)|عدد (المواسم|مواسم|الحلقات|حلقات|أجزاء|الأجزاء))`), 'عدد المواسم أو الحلقات'],
];
export const STORY_ACTOR = new RegExp(`${W}(من (الممثل|الممثلة|الفنان|الفنانة|النجم|النجمة)|من (أدى|أدت|جسّد|جسدت|جسّدت|لعب|لعبت) (شخصية|دور)|(الذي|التي) (جسّد|جسدت|جسّدت|أدى|أدت|لعب|لعبت) (شخصية|دور)|مؤدي صوت|مؤدية صوت|من (يؤدي|تؤدي|أدى|أدت) صوت|الصوت العربي ل)`);
const CREDITS = STORY_CREDITS;
const ACTOR = STORY_ACTOR;

// تسريب الإجابة في نص سؤال آخر: مطابقة كلمة كاملة (مع سوابق مثل و/ب/ل/ال)
// لا مقطعًا داخل كلمة، كي لا تُحسب «مصر» داخل «مصرف».
const CLITIC = '(?:و|ف|ب|ك|ل|ال|وال|بال|فال|كال|لل|ول|وب|فب)?';
export function answerLeaks(answerNorm, questionNorm) {
  if (!answerNorm || !questionNorm) return false;
  const escaped = answerNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^| )${CLITIC}${escaped}( |$)`).test(questionNorm);
}

// ── التحقق ────────────────────────────────────────────────────────────────
export async function validateBank(root = ROOT, { only = null } = {}) {
  const errors = [];
  const warnings = [];
  const status = await readStatus(root);
  const tiers = status.tiers || [200, 400, 600, 800, 1000];
  const tierMin = status.tierMin || 48;
  const maxQ = status.maxQuestionWords || 22;
  const maxA = status.maxAnswerWords || 6;
  const budget = status.mediaBudget || { imageKB: 30, audioKB: 50, categoryMB: 4 };
  const files = await listCategoryFiles(root);
  const ids = files.map((f) => f.replace(/\.json$/, ''));

  if (only && !status.categories[only] && !ids.includes(only)) {
    errors.push(`${only}: فئة غير معروفة (ليست في bank-status.json ولا لها ملف)`);
    return { errors, warnings, categories: [] };
  }
  if (only && !ids.includes(only) && status.categories[only] && status.categories[only].status === 'done') {
    errors.push(`${only}: مسجّلة done ولا ملف لها`);
    return { errors, warnings, categories: [] };
  }

  const packs = [];
  for (const id of ids) {
    if (only && id !== only) continue;
    let pack;
    try {
      pack = await readCategory(root, id);
    } catch (e) {
      errors.push(`${id}: JSON غير صالح — ${e.message}`);
      continue;
    }
    packs.push({ id, pack });
  }

  const seenQid = new Map();
  const seenQ = new Map(); // نص السؤال المطبّع → أول موضع
  const seenA = new Map(); // الإجابة المطبّعة → الفئات التي وردت فيها
  const summaries = [];

  for (const { id, pack } of packs) {
    const err = (m) => errors.push(`${id}: ${m}`);
    const warn = (m) => warnings.push(`${id}: ${m}`);
    const meta = status.categories[id];
    if (!meta) err('الفئة ليست في bank-status.json');
    const done = meta && meta.status === 'done';
    const isMediaCat = !!(meta && meta.media);

    if (pack.id !== id) err(`id داخل الملف «${pack.id}» لا يطابق اسم الملف`);
    if (!CATEGORY_ID.test(String(pack.id || ''))) err('معرّف الفئة يجب أن يكون حروفًا لاتينية صغيرة وأرقامًا');
    if (!pack.name || !String(pack.name).trim()) err('بلا اسم');
    if (!pack.icon || !String(pack.icon).trim()) err('بلا أيقونة');
    if (meta && meta.style === 'story' && pack.style !== 'story') err('فئة درامية بلا "style": "story" في الملف');
    if (!Array.isArray(pack.qs)) { err('qs ليست مصفوفة'); continue; }

    const qs = pack.qs;
    const counts = Object.fromEntries(tiers.map((t) => [t, 0]));
    const topicByTier = new Map(tiers.map((t) => [t, new Map()]));
    const topics = new Set();
    let mediaBytes = 0;
    let actorQuestions = 0;
    const localQ = new Map();
    const localA = new Map();

    for (let i = 0; i < qs.length; i += 1) {
      const q = qs[i];
      const tag = q && q.qid ? q.qid : `#${i + 1}`;
      const qerr = (m) => err(`${tag}: ${m}`);
      const qwarn = (m) => warn(`${tag}: ${m}`);
      if (!q || typeof q !== 'object') { qerr('عنصر ليس كائنًا'); continue; }

      // المعرّف
      const qid = String(q.qid || '');
      if (!QID_NEW.test(qid) && !QID_LEGACY.test(qid)) qerr(`qid غير صالح (المطلوب <id>-<tier>-<nnn>)`);
      else if (QID_NEW.test(qid) && !qid.startsWith(`${id}-`)) qerr('qid لا يبدأ بمعرّف الفئة');
      if (seenQid.has(qid)) qerr(`qid مكرر (ورد أيضًا في ${seenQid.get(qid)})`);
      else seenQid.set(qid, id);

      // النقاط
      if (!tiers.includes(q.p)) qerr(`نقاط غير صالحة (${q.p})`);
      else counts[q.p] += 1;
      if (QID_NEW.test(qid)) {
        const idTier = Number(qid.split('-')[1]);
        if (idTier !== q.p) qwarn(`الخانة في المعرّف (${idTier}) تختلف عن p (${q.p}) — مقبول بعد إعادة التصنيف`);
      }

      // النوع
      const type = q.type;
      if (type !== undefined && !TYPES.has(type)) qerr(`نوع غير معروف: ${type}`);
      const isMediaQ = MEDIA_TYPES.has(type);

      // النص والإجابة
      const text = String(q.q || '').trim();
      if (!text && !(type && NO_TEXT_OK.has(type))) qerr('سؤال بلا نص');
      if (text && wordCount(text) > maxQ) qerr(`نص السؤال ${wordCount(text)} كلمة والحد ${maxQ}`);
      const answer = String(q.a || '').trim();
      if (!answer && !(type && NO_WRITTEN_ANSWER.has(type))) qerr('سؤال بلا إجابة');
      if (answer && wordCount(answer) > maxA) qerr(`الإجابة ${wordCount(answer)} كلمات والحد ${maxA}`);
      if (q.alt !== undefined && (!Array.isArray(q.alt) || q.alt.some((x) => !String(x || '').trim()))) qerr('alt يجب أن تكون مصفوفة نصوص غير فارغة');

      // حقول الجودة (إلزامية للفئات المكتملة)
      if (done) {
        if (q.verified !== true) qerr('verified ليست true');
        if (!q.topic || !String(q.topic).trim()) qerr('بلا topic');
      }
      if (q.topic) {
        topics.add(q.topic);
        if (tiers.includes(q.p)) {
          const m = topicByTier.get(q.p);
          m.set(q.topic, (m.get(q.topic) || 0) + 1);
        }
      }

      // قواعد كل نوع
      if (type === 'image') {
        const effect = q.effect || 'none';
        if (!IMAGE_EFFECTS.has(effect)) qerr(`مؤثر صورة غير معروف: ${effect}`);
        const n = mediaList(q).length;
        if (n !== 1 && n !== 4) qerr(`سؤال صورة بعدد ملفات ${n} (المسموح 1 أو 4)`);
        // «أربع صور وكلمة» يعرضها العارض كما هي، فمؤثر عليها وعدٌ لا يُنفَّذ
        if (n === 4 && effect !== 'none') qerr(`أربع صور لا تقبل مؤثرًا (${effect})`);
      }
      if (type === 'audio' && mediaList(q).length !== 1) qerr('سؤال صوتي يحتاج ملفًا واحدًا');
      if (type === 'video' && mediaList(q).length !== 1) qerr('سؤال فيديو يحتاج ملفًا واحدًا');
      if (type === 'diff') {
        if (mediaList(q).length !== 2) qerr('«اكتشف الفرق» يحتاج صورتين');
        if (q.spot && !(typeof q.spot === 'object' && ['x', 'y', 'r'].every((k) => typeof q.spot[k] === 'number' && q.spot[k] >= 0 && q.spot[k] <= 100))) qerr('spot يجب أن يكون {x,y,r} بنسب مئوية');
      }
      if (type === 'truefalse' && !['صح', 'خطأ'].includes(answer)) qerr('إجابة صح/خطأ يجب أن تكون «صح» أو «خطأ»');
      if (type === 'choice') {
        if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) qerr('choice يحتاج options من 2 إلى 4');
        else if (!q.options.map((o) => normalizeArabic(o)).includes(normalizeArabic(answer))) qerr('إجابة choice ليست ضمن options');
      }
      if (type === 'scramble' && q.letters !== undefined && (!Array.isArray(q.letters) || q.letters.join('') .replace(/\s+/g, '') !== answer.replace(/\s+/g, '') && normalizeArabic(q.letters.join('')) !== normalizeArabic(answer.replace(/\s+/g, '')))) {
        // الحروف المبعثرة يجب أن تكون نفس حروف الإجابة
        const sortStr = (s) => normalizeArabic(s).replace(/\s+/g, '').split('').sort().join('');
        if (!Array.isArray(q.letters) || sortStr(q.letters.join('')) !== sortStr(answer)) qerr('حروف scramble لا تطابق حروف الإجابة');
      }
      if (type === 'complete' && !text.includes('___')) qerr('سؤال «أكمل» بلا فراغ ___');
      if (type === 'common' && (!Array.isArray(q.items) || q.items.length < 3)) qerr('«القاسم المشترك» يحتاج 3 عناصر على الأقل');
      if (type === 'hints' && (!Array.isArray(q.hints) || q.hints.length < 2 || q.hints.length > 5)) qerr('«تلميحات» يحتاج من 2 إلى 5 تلميحات');
      if (type === 'order' && (!Array.isArray(q.items) || q.items.length < 3)) qerr('«رتّب» يحتاج 3 عناصر على الأقل');
      if (type === 'odd' && (!Array.isArray(q.items) || typeof q.odd !== 'number' || q.odd < 0 || q.odd >= q.items.length)) qerr('«الدخيل» يحتاج items وفهرس odd صالحًا');
      if (type === 'grid' && (!Array.isArray(q.grid) || !q.target)) qerr('«الشبكة» تحتاج grid وtarget');
      if (isMediaCat && !isMediaQ) qerr(`فئة وسائط لكن السؤال من نوع ${type || 'نصي'}`);

      // الوسائط
      const media = mediaList(q);
      if (media.length && !isMediaQ && !['flag', 'zoom', 'pic'].includes(type)) qwarn('يحمل media لكن نوعه ليس وسائط');
      if (isMediaQ && media.length === 0) qerr('سؤال وسائط بلا media');
      for (const [mi, entry] of media.entries()) {
        const where = media.length > 1 ? ` (ملف ${mi + 1})` : '';
        const src = mediaSrc(entry);
        if (!src) { qerr(`media بلا src${where}`); continue; }
        if (typeof entry === 'string') {
          qerr(`media نص مجرد؛ المطلوب كائن فيه src وtitle وsourceUrl وauthor وlicense وlicenseUrl${where}`);
        } else {
          for (const k of ['type', 'title', 'sourceUrl', 'author', 'license', 'licenseUrl']) {
            if (!entry[k] || !String(entry[k]).trim()) qerr(`media بلا ${k}${where}`);
          }
          if (entry.license && !isAllowedLicense(entry.license)) qerr(`ترخيص مرفوض: ${entry.license}${where}`);
          const expectKind = type === 'audio' ? 'audio' : type === 'video' ? 'video' : 'image';
          if (entry.type && entry.type !== expectKind) qerr(`media.type «${entry.type}» لا يطابق نوع السؤال ${type}${where}`);
        }
        if (/^data:/i.test(src)) { qwarn(`وسيط مضمّن data: — يُفضَّل ملفًا في media/${where}`); continue; }
        if (EXTERNAL.test(src)) { qwarn(`وسيط خارجي (${src}) — يُفضَّل نسخه محليًا${where}`); continue; }
        const isImg = IMAGE_EXT.test(src); const isAud = AUDIO_EXT.test(src); const isVid = VIDEO_EXT.test(src);
        if (!isImg && !isAud && !isVid) qerr(`امتداد غير مدعوم: ${src}${where}`);
        if (type === 'audio' && !isAud) qerr(`سؤال صوتي بملف ليس صوتًا: ${src}`);
        if ((type === 'image' || type === 'diff') && !isImg) qerr(`سؤال صورة بملف ليس صورة: ${src}${where}`);
        if (type === 'video' && !isVid) qerr(`سؤال فيديو بملف ليس فيديو: ${src}`);
        const file = mediaFilePath(root, id, src);
        if (!(await exists(file))) { qerr(`الملف غير موجود: ${path.relative(root, file)}${where}`); continue; }
        const size = (await stat(file)).size;
        mediaBytes += size;
        const capKB = isAud ? budget.audioKB : isVid ? Infinity : budget.imageKB;
        if (size > capKB * 1024) qerr(`${path.basename(file)} حجمه ${(size / 1024).toFixed(1)} KB والحد ${capKB} KB${where}`);
      }

      // التكرار داخل الفئة
      if (text) {
        const nq = normalizeArabic(text);
        if (localQ.has(nq)) qerr(`نص مكرر داخل الفئة (مثل ${localQ.get(nq)})`);
        else localQ.set(nq, tag);
        if (seenQ.has(nq) && seenQ.get(nq).cat !== id) qerr(`نص مكرر عبر البنك (ورد في ${seenQ.get(nq).cat}/${seenQ.get(nq).tag})`);
        else if (!seenQ.has(nq)) seenQ.set(nq, { cat: id, tag });
      }
      // صح/خطأ والاختيار إجاباتهما محدودة بطبيعتها، فلا تُعدّ مكررة
      if (answer && !(type && (NO_WRITTEN_ANSWER.has(type) || FIXED_ANSWER.has(type)))) {
        const na = normalizeArabic(answer);
        if (localA.has(na)) {
          if (isNumeric(answer)) qwarn(`إجابة رقمية مكررة داخل الفئة (مثل ${localA.get(na)})`);
          else qerr(`إجابة مكررة داخل الفئة «${answer}» (مثل ${localA.get(na)})`);
        } else localA.set(na, tag);
        const catsWithAnswer = seenA.get(na) || new Set();
        catsWithAnswer.add(id);
        seenA.set(na, catsWithAnswer);
      }

      // أسئلة الدراما: عن الأحداث لا عن الصنّاع
      if (pack.style === 'story') {
        const blob = `${text} ${answer}`;
        for (const [re, label] of CREDITS) if (re.test(blob)) qerr(`سؤال عن ${label} بدل أحداث العمل — «${text}»`);
        if (ACTOR.test(text)) {
          actorQuestions += 1;
          if (![800, 1000].includes(q.p)) qerr('سؤال عن الممثلين يجب أن يكون في خانة 800 أو 1000');
        }
      }
    }

    // تسريب الإجابة. حالتان مختلفتان:
    // • داخل سؤالها نفسه: السؤال معطوب، لا شيء يبقى ليُخمَّن → خطأ دائمًا.
    // • داخل سؤال آخر: إجابة من كلمتين فأكثر تظهر حرفيًا في سؤال آخر تكشفه فعلًا
    //   → خطأ. أما الكلمة المفردة الشائعة («الشمس» في سؤال فلكي آخر) فورودها
    //   عرضيّ لا يدل على شيء، ومنعها يعني حذف أسئلة سليمة → تحذير للمراجعة.
    for (const q of qs) {
      if (!q || !q.a || q.type) continue;
      const na = normalizeArabic(q.a);
      if (na.length < 4) continue;
      if (q.q && answerLeaks(na, normalizeArabic(q.q))) err(`${q.qid}: إجابته «${q.a}» مكتوبة داخل نص سؤالها`);
      const multiWord = na.split(' ').length > 1;
      for (const other of qs) {
        if (!other || other === q || !other.q) continue;
        if (!answerLeaks(na, normalizeArabic(other.q))) continue;
        const message = `${q.qid}: إجابته «${q.a}» مكشوفة في نص ${other.qid}`;
        if (multiWord) err(message);
        else warn(`${message} (كلمة مفردة — راجعها: أهي كشف فعلي أم ورود عرضي؟)`);
      }
    }

    // الترتيب
    for (let i = 1; i < qs.length; i += 1) {
      const a = qs[i - 1]; const b = qs[i];
      if (!a || !b) continue;
      if (a.p > b.p || (a.p === b.p && String(a.qid) > String(b.qid))) { err('الملف غير مرتّب (p ثم qid) — شغّل npm run bank:sort'); break; }
    }

    // الحدود
    const total = qs.length;
    if (done) {
      for (const t of tiers) if (counts[t] < tierMin) err(`خانة ${t}: ${counts[t]} سؤالًا والحد ${tierMin}`);
      if (topics.size < 6 || topics.size > 10) err(`عدد المواضيع الفرعية ${topics.size} والمطلوب من 6 إلى 10`);
      for (const t of tiers) {
        const m = topicByTier.get(t);
        for (const [topic, n] of m) if (counts[t] && n / counts[t] > 0.25 + 1e-9) err(`خانة ${t}: موضوع «${topic}» يشغل ${Math.round((n / counts[t]) * 100)}% والحد 25%`);
      }
      if (meta) for (const t of tiers) if (Number(meta.counts?.[t]) !== counts[t]) err(`bank-status: خانة ${t} مسجّلة ${meta.counts?.[t]} والفعلي ${counts[t]}`);
      if (meta && !meta.doneAt) err('bank-status: الفئة done بلا doneAt');
    } else if (total < 24) {
      err(`${total} سؤالًا فقط والحد الأدنى لملف موجود 24`);
    } else if (meta) {
      const drift = tiers.some((t) => Number(meta.counts?.[t]) !== counts[t]);
      if (drift) warn('أعداد bank-status لا تطابق الملف (فئة قيد العمل)');
    }
    if (pack.style === 'story' && total && actorQuestions / total > 0.2 + 1e-9) err(`أسئلة الممثلين ${actorQuestions} من ${total} (${Math.round((actorQuestions / total) * 100)}%) والحد 20%`);
    if (mediaBytes > (budget.categoryMB || 4) * 1024 * 1024) err(`وسائط الفئة ${(mediaBytes / 1024 / 1024).toFixed(2)} MB والحد ${budget.categoryMB} MB`);

    summaries.push({ id, name: pack.name, status: meta ? meta.status : 'unknown', counts, total, topics: topics.size, mediaBytes, media: isMediaCat });
  }

  // إجابات متكررة عبر الفئات: تحذير مجمّع
  if (!only) {
    const cross = [...seenA.entries()].filter(([, cats]) => cats.size > 1);
    if (cross.length) warnings.push(`${cross.length} إجابة تتكرر في أكثر من فئة (مقبول، للعلم): ${cross.slice(0, 8).map(([a, c]) => `«${a}» في ${[...c].join('،')}`).join(' · ')}${cross.length > 8 ? ' …' : ''}`);
  }

  // index.js يستورد كل الملفات ولا يستورد ما لا وجود له
  if (!only) {
    const indexPath = path.join(root, CATS_DIR, 'index.js');
    const src = (await exists(indexPath)) ? await readFile(indexPath, 'utf8') : '';
    const imported = [...src.matchAll(/from ['"]\.\/([a-z0-9]+)\.json['"]/g)].map((m) => m[1]);
    for (const id of ids) if (!imported.includes(id)) errors.push(`index.js لا يستورد ${id}.json — شغّل npm run bank:sort -- ${id}`);
    for (const id of imported) if (!ids.includes(id)) errors.push(`index.js يستورد ${id}.json وهو غير موجود`);
    // فئات done بلا ملف
    for (const [id, meta] of Object.entries(status.categories)) if (meta.status === 'done' && !ids.includes(id)) errors.push(`${id}: مسجّلة done ولا ملف لها`);
  }

  return { errors, warnings, categories: summaries };
}

// ── الترتيب وإعادة توليد الفهرس ────────────────────────────────────────────
export function sortQuestions(qs) {
  return [...qs].sort((a, b) => (a.p - b.p) || String(a.qid).localeCompare(String(b.qid)));
}

export async function sortCategory(root, id) {
  const file = path.join(root, CATS_DIR, `${id}.json`);
  const pack = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(pack.qs)) throw new Error(`${id}: qs ليست مصفوفة`);
  pack.qs = sortQuestions(pack.qs);
  await writeFile(file, `${JSON.stringify(pack, null, 2)}\n`);
  return pack.qs.length;
}

export async function writeIndex(root = ROOT) {
  const status = await readStatus(root);
  const ids = (await listCategoryFiles(root)).map((f) => f.replace(/\.json$/, ''));
  const orderOf = (id) => (status.categories[id] && status.categories[id].order) || 10_000;
  ids.sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b));
  const header = `// بنك أسئلة «بَديهة» — يُولَّده \`npm run bank:sort\` من ملفات هذا المجلد؛ لا يُحرَّر يدويًا.\n// الترتيب هو ترتيب الفئات في شاشة الاختيار (حقل order في bank-status.json).\n// صيغة الحزمة وأنواع الأسئلة في docs/bank/SCHEMA.md.\n`;
  // معرّف الفئة قد يصادف كلمة محجوزة في JavaScript (default، class…)، فالاسم المحلي يُسبَق بـ pack_
  const imports = ids.map((id) => `import pack_${id} from './${id}.json' with { type: 'json' };`).join('\n');
  const body = `\nexport const CATS = [${ids.map((id) => `pack_${id}`).join(', ')}];\n\nexport const CATEGORY_IDS = CATS.map((category) => category.id);\nexport const TOTAL_QUESTIONS = CATS.reduce((sum, category) => sum + category.qs.length, 0);\n`;
  await writeFile(path.join(root, CATS_DIR, 'index.js'), `${header}${imports ? `\n${imports}\n` : '\nexport const NO_CATEGORIES_YET = true;\n'}${body}`);
  return ids;
}

// ── الحالة ─────────────────────────────────────────────────────────────────
export async function setStatus(root, id, next) {
  if (!['done', 'pending'].includes(next)) throw new Error('الحالة يجب أن تكون done أو pending');
  const status = await readStatus(root);
  const meta = status.categories[id];
  if (!meta) throw new Error(`${id}: ليست في bank-status.json`);
  const pack = await readCategory(root, id);
  const counts = Object.fromEntries((status.tiers || []).map((t) => [t, pack.qs.filter((q) => q.p === t).length]));
  meta.counts = counts;
  meta.status = next;
  meta.doneAt = next === 'done' ? new Date().toISOString() : null;
  await writeStatus(status, root);
  return { id, counts, status: next };
}

// ── التقرير ─────────────────────────────────────────────────────────────────
export async function bankReport(root = ROOT) {
  const status = await readStatus(root);
  const tiers = status.tiers || [200, 400, 600, 800, 1000];
  const ids = (await listCategoryFiles(root)).map((f) => f.replace(/\.json$/, ''));
  const rows = [];
  const entries = Object.entries(status.categories).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
  for (const [id, meta] of entries) {
    let counts = Object.fromEntries(tiers.map((t) => [t, 0]));
    let total = 0;
    let hasFile = false;
    if (ids.includes(id)) {
      hasFile = true;
      try {
        const pack = await readCategory(root, id);
        for (const q of pack.qs || []) if (tiers.includes(q.p)) counts[q.p] += 1;
        total = (pack.qs || []).length;
      } catch { /* يظهر في validate */ }
    }
    rows.push({ order: meta.order, id, name: meta.name, status: meta.status, hasFile, media: meta.media, counts, total, note: meta.note || '' });
  }
  for (const id of ids) if (!status.categories[id]) rows.push({ order: 9999, id, name: '(غير مسجّلة)', status: 'unknown', hasFile: true, media: false, counts: {}, total: 0, note: 'ملف بلا سجل في bank-status.json' });
  const done = rows.filter((r) => r.status === 'done').length;
  const questions = rows.reduce((s, r) => s + r.total, 0);
  return { tiers, tierMin: status.tierMin, rows, done, pending: rows.length - done, questions };
}

export function formatReport(r) {
  const pad = (s, n, right = false) => { const str = String(s); return right ? str.padStart(n) : str.padEnd(n); };
  const lines = [];
  lines.push(`بنك بَديهة — ${r.rows.length} فئة · ${r.done} مكتملة · ${r.pending} قيد الانتظار · ${r.questions} سؤالًا · الحد ${r.tierMin}/خانة`);
  lines.push('');
  lines.push(`${pad('#', 3, true)}  ${pad('id', 16)} ${r.tiers.map((t) => pad(t, 5, true)).join(' ')} ${pad('مج', 5, true)}  ${pad('حالة', 8)} ${pad('وسائط', 6)} الاسم`);
  for (const row of r.rows) {
    const tiers = r.tiers.map((t) => pad(row.counts[t] ?? 0, 5, true)).join(' ');
    const state = row.status === 'done' ? 'done' : row.hasFile ? 'wip' : 'pending';
    lines.push(`${pad(row.order, 3, true)}  ${pad(row.id, 16)} ${tiers} ${pad(row.total, 5, true)}  ${pad(state, 8)} ${pad(row.media ? 'media' : '-', 6)} ${row.name}${row.note ? `  ⚑ ${row.note}` : ''}`);
  }
  return lines.join('\n');
}

// ── سطر الأوامر ─────────────────────────────────────────────────────────────
async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'validate') {
    const only = rest.find((a) => !a.startsWith('--')) || null;
    const { errors, warnings, categories } = await validateBank(ROOT, { only });
    for (const c of categories) console.log(`${c.id.padEnd(16)} ${Object.values(c.counts).map((n) => String(n).padStart(3)).join(' ')} = ${String(c.total).padStart(4)}  ${c.status}${c.media ? ' · media' : ''}${c.topics ? ` · ${c.topics} مواضيع` : ''}`);
    if (warnings.length) { console.log(`\nتحذيرات (${warnings.length}):`); for (const w of warnings) console.log(`  ⚠ ${w}`); }
    if (errors.length) { console.log(`\nأخطاء (${errors.length}):`); for (const e of errors) console.log(`  ✗ ${e}`); process.exit(1); }
    console.log(`\n✓ ${only ? `الفئة ${only}` : `البنك (${categories.length} ملفًا)`} سليمة`);
    return;
  }
  if (cmd === 'report') {
    const r = await bankReport(ROOT);
    if (rest.includes('--json')) console.log(JSON.stringify(r, null, 2));
    else console.log(formatReport(r));
    return;
  }
  if (cmd === 'sort') {
    const id = rest[0];
    if (!id) { console.error('الاستعمال: bank sort <id>'); process.exit(2); }
    const n = await sortCategory(ROOT, id);
    const ids = await writeIndex(ROOT);
    console.log(`رُتّبت ${id} (${n} سؤالًا) وأُعيد توليد index.js (${ids.length} فئة)`);
    return;
  }
  if (cmd === 'index') {
    const ids = await writeIndex(ROOT);
    console.log(`أُعيد توليد index.js: ${ids.length} فئة`);
    return;
  }
  if (cmd === 'status') {
    const [id, next] = rest;
    if (!id || !next) { console.error('الاستعمال: bank status <id> done|pending'); process.exit(2); }
    const r = await setStatus(ROOT, id, next);
    console.log(`${r.id}: ${r.status} · ${Object.entries(r.counts).map(([t, n]) => `${t}:${n}`).join(' ')}`);
    return;
  }
  console.error('الأوامر: validate [<id>] · report [--json] · sort <id> · index · status <id> done|pending');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message || e); process.exit(2); });
}
