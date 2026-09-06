// جلب وسائط مفتوحة الرخصة لأسئلة الحزم: يبحث في ويكيميديا كومنز وOpenverse وناسا
// وأرشيف الإنترنت، ولا يقبل إلا CC0 والملك العام وCC BY وCC BY-SA (لا NC ولا ND ولا
// مجهول الرخصة). ثم يضغط الصورة إلى webp بأطول ضلع 640 بكسل، أو يقصّ أول 8 ثوانٍ من
// الصوت إلى mp3 أحادي مضبوط الصوت، ويسجّل النسبة في media/<الفئة>/_sources.json ويطبع
// مقطع "media" الجاهز للصق في السؤال.
//
// الاستعمال:
//   node scripts/media-fetch.mjs <category-id> <query> <image|audio> [options]
//     --qid <id>        معرّف السؤال؛ الملف يصير media/<category-id>/<qid>.webp|.mp3 (إلزامي إلا مع --list)
//     --list            اعرض المرشحين فقط دون تنزيل (الرقم، المصدر، العنوان، الرخصة، المؤلف، الأبعاد/المدة، الرابط)
//     --pick <n>        نزّل المرشح رقم n من القائمة نفسها بدل أول مقبول (يبدأ من 1)
//     --from <url|File:Name>  تجاوز البحث واجلب هذا العنصر بعينه: صفحة ملف في كومنز، أو عنصر Openverse/ناسا/أرشيف
//     --source <commons|openverse|nasa|archive|all>  المصدر (الافتراضي all، وتُجرَّب بهذا الترتيب)
//     --suffix <n>      لأسئلة الصور المتعددة: الملف يصير <qid>-<n>.webp
//     --max-kb <n>      ميزانية الحجم (الافتراضي: صورة 30، صوت 50)
//     --force           اكتب فوق الملف إن كان موجودًا
//     --json            اطبع السجل (ما يُكتب في _sources.json) بصيغة JSON على stdout
//   أكواد الخروج: 0 نجاح؛ 1 لا مرشح مقبول / فشل التنزيل / تجاوز الميزانية؛ 2 خطأ استعمال أو أدوات.
//
// ملاحظات تشغيلية اكتُشفت بالتجربة:
//   - خادم مصغّرات ويكيميديا لا يخدم غير المتصفحات إلا بمقاسات قياسية، وتنزيل الأصول
//     الكبيرة يُرفض (429)، لذا تُستعمل مصغّرة الـAPI كما هي (بعد حذف معاملات utm).
//   - واجهة كومنز تحدّ الطلبات المتتابعة بنص "too many requests"، فنعيد المحاولة بهدوء.
//   - بحث أرشيف الإنترنت بأحرف البدل داخل licenseurl يُسقط خادمهم، فنرشّح الرخص محليًا.
import { readFile, writeFile, copyFile, mkdir, mkdtemp, rm, stat, access } from 'node:fs/promises';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

// fetch المدمج في Node يتجاهل HTTPS_PROXY ما لم يُضبط NODE_USE_ENV_PROXY قبل الإقلاع؛
// خلف وكيل (كبيئة Claude Code السحابية) نعيد تشغيل السكربت نفسه بالمتغيّر مضبوطًا.
const proxied = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxied && !process.env.NODE_USE_ENV_PROXY && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // --no-warnings: وكيل البيئة في undici يطبع تحذيرًا تجريبيًا لا يهم مستخدم الأداة
  const child = spawnSync(process.execPath, ['--no-warnings', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(child.status ?? 1);
}

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_AGENT = 'MaydanPlatform/1.0 (https://github.com/mf103871-boop/maydan; media fetch script)';
const TIMEOUT_MS = 30_000;
const DEFAULT_KB = { image: 30, audio: 50 };
const SOURCES = { image: ['commons', 'openverse', 'nasa'], audio: ['commons', 'openverse', 'archive'] };
const ALLOWED_HOSTS = new Set([
  'commons.wikimedia.org', 'upload.wikimedia.org', 'api.openverse.org', 'live.staticflickr.com',
  'cdn.freesound.org', 'prod-1.storage.jamendo.com', 'images-api.nasa.gov', 'images-assets.nasa.gov', 'archive.org',
]);
const COMMONS_THUMB_STEPS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840];
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/tiff']);
// للصوت نحتاج أول 8 ثوانٍ فقط، فلا داعي لتنزيل مقطوعة كاملة.
const AUDIO_DOWNLOAD_CAP = 6 * 1024 * 1024;
const IMAGE_DOWNLOAD_CAP = 25 * 1024 * 1024;
const IMAGE_ATTEMPTS = [[640, 75], [640, 65], [640, 55], [640, 45], [512, 60], [400, 60]];
const AUDIO_ATTEMPTS = [[8, '48k'], [8, '40k'], [6, '40k']];
const MAX_CANDIDATE_TRIES = 3;
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const UNKNOWN_AUTHOR = 'مؤلف غير معروف';

const USAGE = `الاستعمال: node scripts/media-fetch.mjs <category-id> <query> <image|audio> [options]
  --qid <id>   --list   --pick <n>   --from <url|File:Name>   --source <commons|openverse|nasa|archive|all>
  --suffix <n>   --max-kb <n>   --force   --json`;

class UsageError extends Error {}
class ToolError extends Error {}
class FetchError extends Error {}
class BudgetError extends Error {}
class NoCandidateError extends Error {}

const log = (...args) => console.error(...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fmtKb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const exists = (file) => access(file).then(() => true, () => false);
const clip = (text, max = 120) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const stripHtml = (html = '') => html
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}
function hostAllowed(url) {
  const host = hostOf(url);
  return ALLOWED_HOSTS.has(host) || host.endsWith('.archive.org');
}

// ---------------------------------------------------------------- سطر الأوامر

function parseArgs(argv) {
  const opts = { positional: [], list: false, force: false, json: false, source: 'all' };
  const valued = { qid: 'qid', pick: 'pick', from: 'from', source: 'source', suffix: 'suffix', 'max-kb': 'maxKb' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { console.log(USAGE); process.exit(0); }
    if (!arg.startsWith('--')) { opts.positional.push(arg); continue; }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (name in valued) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined) throw new UsageError(`الخيار --${name} يحتاج قيمة`);
      opts[valued[name]] = value;
    } else if (name === 'list' || name === 'force' || name === 'json') {
      opts[name] = true;
    } else {
      throw new UsageError(`خيار غير معروف: ${arg}`);
    }
  }
  const [category, query, kind] = opts.positional;
  if (!category || !query || !kind) throw new UsageError('ينقص وسيط مطلوب: <category-id> <query> <image|audio>');
  if (kind !== 'image' && kind !== 'audio') throw new UsageError(`النوع يجب أن يكون image أو audio، لا "${kind}"`);
  if (!SAFE_NAME.test(category)) throw new UsageError(`معرّف الفئة غير صالح كاسم مجلد: "${category}"`);
  if (!opts.list && !opts.qid) throw new UsageError('حدّد --qid <id> أو استعمل --list');
  if (opts.qid && !SAFE_NAME.test(opts.qid)) throw new UsageError(`--qid غير صالح كاسم ملف: "${opts.qid}"`);
  if (opts.suffix !== undefined && !SAFE_NAME.test(opts.suffix)) throw new UsageError(`--suffix غير صالح: "${opts.suffix}"`);
  if (opts.source !== 'all' && !['commons', 'openverse', 'nasa', 'archive'].includes(opts.source)) {
    throw new UsageError(`--source يقبل commons أو openverse أو nasa أو archive أو all، لا "${opts.source}"`);
  }
  if (opts.source !== 'all' && !SOURCES[kind].includes(opts.source)) {
    throw new UsageError(opts.source === 'nasa' ? 'ناسا للصور فقط' : 'أرشيف الإنترنت للصوت فقط');
  }
  if (opts.pick !== undefined) {
    opts.pick = Number(opts.pick);
    if (!Number.isInteger(opts.pick) || opts.pick < 1) throw new UsageError('--pick يحتاج رقمًا صحيحًا يبدأ من 1');
    if (opts.from) throw new UsageError('--pick لا يجتمع مع --from');
  }
  if (opts.maxKb !== undefined) {
    opts.maxKb = Number(opts.maxKb);
    if (!(opts.maxKb > 0)) throw new UsageError('--max-kb يحتاج رقمًا موجبًا');
  }
  return { ...opts, category, query, kind, sources: opts.source === 'all' ? SOURCES[kind] : [opts.source] };
}

// ---------------------------------------------------------------- الشبكة

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, headers: { 'User-Agent': USER_AGENT, ...init.headers } });
  } catch (error) {
    if (error.name === 'AbortError') throw new FetchError(`انتهت مهلة الطلب (${TIMEOUT_MS / 1000} ث): ${url}`);
    throw new FetchError(`تعذّر الاتصال بـ ${hostOf(url)}: ${error.cause?.code || error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// طلب JSON مع إعادة محاولة هادئة عند تقييد المعدل أو عطل الخادم.
async function fetchJson(url, label) {
  const delays = [2500, 7000];
  for (let attempt = 0; ; attempt++) {
    let res;
    let text;
    try {
      res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
      text = await res.text();
    } catch (error) {
      if (attempt < delays.length) { await sleep(delays[attempt]); continue; }
      throw error;
    }
    const throttled = res.status === 429 || res.status >= 500 || /too many requests/i.test(text.slice(0, 300));
    if (throttled && attempt < delays.length) {
      log(`… ${label} يحدّ الطلبات مؤقتًا، إعادة المحاولة بعد ${delays[attempt] / 1000} ث`);
      await sleep(delays[attempt]);
      continue;
    }
    if (throttled) throw new FetchError(`${label}: تقييد معدل الطلبات (HTTP ${res.status}) — أعد المحاولة بعد دقيقة`);
    if (!res.ok) throw new FetchError(`${label}: HTTP ${res.status}`);
    try { return JSON.parse(text); } catch { throw new FetchError(`${label}: الردّ ليس JSON`); }
  }
}

// ينزّل إلى Buffer مع إعادة محاولة متباعدة. خادم ملفات ويكيميديا يردّ 429 على
// التنزيلات المتتابعة، وإعادة المحاولة فورًا تزيد الطين بلّة، فالانتظار يتصاعد.
const DOWNLOAD_DELAYS = [0, 2500, 7000, 15_000];
async function downloadBuffer(url, { cap, partial }) {
  if (!hostAllowed(url)) throw new FetchError(`المضيف غير مسموح: ${hostOf(url)}`);
  let lastError;
  for (let attempt = 0; attempt < DOWNLOAD_DELAYS.length; attempt++) {
    if (DOWNLOAD_DELAYS[attempt]) {
      log(`… الخادم يحدّ التنزيل، إعادة المحاولة بعد ${DOWNLOAD_DELAYS[attempt] / 1000} ث`);
      await sleep(DOWNLOAD_DELAYS[attempt]);
    }
    try {
      const res = await fetchWithTimeout(url, { headers: partial ? { Range: `bytes=0-${cap - 1}` } : {} });
      if (!res.ok) throw new FetchError(`HTTP ${res.status} عند تنزيل ${url}`);
      const declared = Number(res.headers.get('content-length') || 0);
      if (!partial && declared > cap) throw new FetchError(`الملف كبير جدًا (${fmtKb(declared)})`);
      const chunks = [];
      let total = 0;
      for await (const chunk of res.body) {
        chunks.push(chunk);
        total += chunk.length;
        if (total >= cap) {
          if (!partial) throw new FetchError(`الملف كبير جدًا (أكثر من ${fmtKb(cap)})`);
          break;
        }
      }
      return Buffer.concat(chunks);
    } catch (error) {
      lastError = error;
      // خطأ نهائي (ملف كبير، مضيف ممنوع، 404): لا فائدة من الانتظار
      if (!/HTTP (429|5\d\d)|fetch failed|timeout|network|terminated/i.test(String(error.message))) break;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------- الرخص

const CC = 'https://creativecommons.org/';

// يوحّد نصوص الرخصة من أي مزوّد (أسماء قصيرة، رموز، روابط) إلى واحدة من:
// CC0 1.0 / Public Domain / CC BY x.y / CC BY-SA x.y — ويعيد null لكل ما عداها
// (NC، ND، GFDL، «حقوق محفوظة»، «استخدام عادل»، مجهول…). هذا الفلتر لا يُتجاوز.
export function normalizeLicense(...parts) {
  // نقطة الإصدار (4.0) هي النقطة الوحيدة التي تبقى؛ كل ترقيم آخر يصير فاصلًا حتى لا
  // تفلت "CC BY-NC." من فحص حدود الرموز.
  const s = parts.filter(Boolean).join(' ').toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/(?<!\d)\.|\.(?!\d)/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!s) return null;
  const has = (re) => re.test(s);
  if (has(/(^|-)(nc|nd)(-|$)/) || has(/non-?commercial|no-?deriv/)) return null;
  if (has(/cc0|publicdomain-zero|(^|-)zero-1\.0/)) return { license: 'CC0 1.0', licenseUrl: `${CC}publicdomain/zero/1.0/` };
  if (has(/public-?domain|(^|-)pdm?(-|$)/)) return { license: 'Public Domain', licenseUrl: `${CC}publicdomain/mark/1.0/` };
  // الاسم الطويل الرسمي ("Attribution-ShareAlike 4.0 International") لا يذكر CC،
  // لكنه رخصة كرييتف كومنز. يُقبل فقط بصيغته الكاملة برقم إصدار، فلا تُخلط مع
  // قوالب "Attribution" المجردة (رخصة حرة أخرى ليست ضمن الأربع المسموحة).
  const isCc = has(/(^|-)cc(-|$)|creativecommons/) || has(/(^|-)attribution(-sharealike)?-[1-4]\.[05](-|$)/);
  const version = (s.match(/(^|-)([1-4]\.[05])(-|$)/) || [])[2];
  const suffix = version ? `${version}/` : '';
  if (isCc && has(/(^|-)by-sa(-|$)|sharealike/)) return { license: version ? `CC BY-SA ${version}` : 'CC BY-SA', licenseUrl: `${CC}licenses/by-sa/${suffix}` };
  if (isCc && has(/(^|-)by(-|$)|(^|-)attribution(-|$)/)) return { license: version ? `CC BY ${version}` : 'CC BY', licenseUrl: `${CC}licenses/by/${suffix}` };
  return null;
}

export const isAllowedLicense = (...parts) => normalizeLicense(...parts) !== null;

// مرشح موحّد من أي مزوّد. reject يشرح سبب الاستبعاد إن وُجد. العنوان والمؤلف لا يُتركان
// فارغين أبدًا: يُعوَّضان من بديل صريح وتُسجَّل ملاحظة ⚠ ليراجع مؤلف الحزمة صفحة المصدر.
function candidate(fields, { licenseParts, rawLicense, fallbackTitle = '', fallbackAuthor = UNKNOWN_AUTHOR }) {
  const lic = normalizeLicense(...licenseParts);
  const warnings = [];
  let { title, author } = fields;
  if (!title) {
    title = clip(fallbackTitle) || 'بلا عنوان';
    warnings.push(`العنوان غير مذكور في بيانات المصدر؛ استُعمل «${title}» — راجع صفحة المصدر`);
  }
  if (!author) {
    author = fallbackAuthor;
    warnings.push(`المؤلف غير مذكور في بيانات المصدر؛ كُتب «${author}» — راجع صفحة المصدر قبل النشر`);
  }
  return {
    downloadUrl: null, width: null, height: null, durationSec: null, ...fields, title, author, warnings,
    licenseRaw: rawLicense, license: lic?.license ?? null, licenseUrl: lic?.licenseUrl ?? null,
    reject: lic ? null : `الرخصة غير مقبولة: ${rawLicense || 'غير محددة'}`,
  };
}

function acceptDownload(c, url) {
  if (c.reject) return c;
  if (!url) c.reject = 'لا رابط ملف قابل للتنزيل';
  else if (!hostAllowed(url)) c.reject = `المضيف غير مسموح: ${hostOf(url)}`;
  else c.downloadUrl = url;
  return c;
}

// ---------------------------------------------------------------- ويكيميديا كومنز

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

function commonsUrl(extra) {
  return `${COMMONS_API}?${new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata', iiurlwidth: '800',
    iiextmetadatafilter: 'LicenseShortName|License|LicenseUrl|Artist|ImageDescription|ObjectName|Credit',
    ...extra,
  })}`;
}

// يحذف معاملات utm ويحوّل thumb.wikimedia.org إلى upload.wikimedia.org (المضيف المسموح).
function cleanWikiUrl(url) {
  if (!url) return null;
  const u = new URL(url);
  u.search = '';
  if (u.hostname === 'thumb.wikimedia.org') u.hostname = 'upload.wikimedia.org';
  return u.toString();
}

// الـAPI يعيد مصغّرة بأقرب مقاس قياسي، إلا للأصول الأصغر من المطلوب فيعيد الأصل نفسه —
// وتنزيل الأصل محدود، فنبني مصغّرة بأكبر مقاس قياسي أصغر من عرض الأصل.
function commonsImageUrl(info) {
  const thumb = cleanWikiUrl(info.thumburl);
  if (thumb && thumb.includes('/thumb/')) return thumb;
  const original = cleanWikiUrl(info.url);
  const step = [...COMMONS_THUMB_STEPS].reverse().find((w) => w < info.width);
  if (!step || !/^image\/(jpeg|png|gif|webp)$/.test(info.mime)) return original;
  const u = new URL(original);
  const name = u.pathname.split('/').pop();
  u.pathname = `${u.pathname.replace('/wikipedia/commons/', '/wikipedia/commons/thumb/')}/${step}px-${name}`;
  return u.toString();
}

const isAudioMime = (mime, width) => (/^audio\//.test(mime) && !/midi/.test(mime)) || (mime === 'application/ogg' && !width);

function commonsCandidate(page, kind) {
  const info = page.imageinfo?.[0] || {};
  const meta = info.extmetadata || {};
  const field = (key) => stripHtml(meta[key]?.value || '');
  const name = page.title.replace(/^File:/, '');
  const c = candidate({
    provider: 'commons', kind,
    title: clip(field('ImageDescription') || field('ObjectName')),
    author: field('Artist') || field('Credit'),
    sourceUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    originalUrl: cleanWikiUrl(info.url),
    width: info.width || null, height: info.height || null,
    durationSec: info.duration ? Number(info.duration.toFixed(1)) : null,
  }, {
    licenseParts: [field('License'), field('LicenseShortName'), field('LicenseUrl')],
    rawLicense: field('LicenseShortName') || field('License'),
    fallbackTitle: name.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
  });
  if (c.reject) return c;
  if (kind === 'image' && !IMAGE_MIMES.has(info.mime)) { c.reject = `ليس صورة مدعومة (${info.mime || 'نوع مجهول'})`; return c; }
  if (kind === 'audio' && !isAudioMime(info.mime, info.width)) { c.reject = `ليس ملفًا صوتيًا مدعومًا (${info.mime || 'نوع مجهول'})`; return c; }
  return acceptDownload(c, kind === 'audio' ? c.originalUrl : commonsImageUrl(info));
}

async function searchCommons(query, kind) {
  const gsrsearch = `${query} filetype:${kind === 'audio' ? 'audio' : 'bitmap'}`;
  const data = await fetchJson(commonsUrl({ generator: 'search', gsrnamespace: '6', gsrsearch, gsrlimit: '20' }), 'كومنز');
  const pages = (data.query?.pages || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages.map((page) => commonsCandidate(page, kind));
}

async function fetchCommonsFile(title, kind) {
  const data = await fetchJson(commonsUrl({ titles: title }), 'كومنز');
  const page = data.query?.pages?.[0];
  if (!page || page.missing || !page.imageinfo) throw new NoCandidateError(`لا يوجد ملف بهذا الاسم في كومنز: ${title}`);
  return commonsCandidate(page, kind);
}

// ---------------------------------------------------------------- Openverse

const OPENVERSE_API = 'https://api.openverse.org/v1';
const openverseEndpoint = (kind) => (kind === 'audio' ? 'audio' : 'images');

function openverseCandidate(r, kind) {
  const c = candidate({
    provider: `openverse/${r.provider || r.source || 'unknown'}`, kind,
    title: clip(r.title || ''), author: r.creator || '',
    sourceUrl: r.foreign_landing_url || r.url, originalUrl: r.url || null,
    width: r.width || null, height: r.height || null,
    durationSec: r.duration ? Number((r.duration / 1000).toFixed(1)) : null,
  }, {
    licenseParts: [`cc-${r.license}-${r.license_version || ''}`, r.license_url],
    rawLicense: `${r.license || ''} ${r.license_version || ''}`.trim(),
    fallbackTitle: r.url ? decodeURIComponent(new URL(r.url).pathname.split('/').pop()) : '',
  });
  return acceptDownload(c, r.url);
}

async function searchOpenverse(query, kind) {
  const params = new URLSearchParams({ q: query, license: 'cc0,by,by-sa', page_size: '20' });
  const data = await fetchJson(`${OPENVERSE_API}/${openverseEndpoint(kind)}/?${params}`, 'Openverse');
  return (data.results || []).map((r) => openverseCandidate(r, kind));
}

async function fetchOpenverseItem(id, kind) {
  return openverseCandidate(await fetchJson(`${OPENVERSE_API}/${openverseEndpoint(kind)}/${id}/`, 'Openverse'), kind);
}

// ---------------------------------------------------------------- ناسا (صور فقط)

const NASA_API = 'https://images-api.nasa.gov/search';

function nasaCandidate(item) {
  const d = item.data?.[0] || {};
  const links = item.links || [];
  const variant = (name) => links.find((l) => l.href?.includes(`~${name}.`))?.href;
  const href = (variant('medium') || variant('small') || links[0]?.href || '').replace(/^http:/, 'https:');
  const c = candidate({
    provider: 'nasa', kind: 'image',
    title: clip(d.title || ''), author: d.secondary_creator || d.photographer || '',
    sourceUrl: `https://images.nasa.gov/details/${d.nasa_id}`, originalUrl: href || null,
  }, { licenseParts: ['public domain'], rawLicense: 'Public Domain (NASA)', fallbackTitle: d.nasa_id || '', fallbackAuthor: 'NASA' });
  return acceptDownload(c, href);
}

async function searchNasa(query) {
  const data = await fetchJson(`${NASA_API}?${new URLSearchParams({ q: query, media_type: 'image', page_size: '20' })}`, 'ناسا');
  return (data.collection?.items || []).map(nasaCandidate);
}

async function fetchNasaItem(id) {
  const data = await fetchJson(`${NASA_API}?${new URLSearchParams({ nasa_id: id, media_type: 'image' })}`, 'ناسا');
  const item = data.collection?.items?.[0];
  if (!item) throw new NoCandidateError(`لا يوجد عنصر صورة في ناسا بالمعرّف ${id}`);
  return nasaCandidate(item);
}

// ---------------------------------------------------------------- أرشيف الإنترنت (صوت فقط)

const ARCHIVE = 'https://archive.org';

function archiveCandidate(doc, meta = null) {
  const creator = Array.isArray(doc.creator) ? doc.creator.join(', ') : (doc.creator || '');
  return candidate({
    provider: 'archive', kind: 'audio',
    title: clip(String(doc.title || '')), author: creator,
    sourceUrl: `${ARCHIVE}/details/${doc.identifier}`, originalUrl: null,
    identifier: doc.identifier, meta,
  }, { licenseParts: [doc.licenseurl], rawLicense: doc.licenseurl || '', fallbackTitle: doc.identifier });
}

async function searchArchive(query) {
  const params = new URLSearchParams({ q: `${query} AND mediatype:audio AND licenseurl:*`, rows: '40', output: 'json' });
  for (const field of ['identifier', 'title', 'creator', 'licenseurl']) params.append('fl[]', field);
  const data = await fetchJson(`${ARCHIVE}/advancedsearch.php?${params}`, 'أرشيف الإنترنت');
  if (data.error) throw new FetchError(`أرشيف الإنترنت: ${data.error}`);
  return (data.response?.docs || []).map((doc) => archiveCandidate(doc));
}

async function fetchArchiveItem(identifier) {
  const meta = await fetchJson(`${ARCHIVE}/metadata/${identifier}`, 'أرشيف الإنترنت');
  if (!meta.metadata) throw new NoCandidateError(`لا يوجد عنصر في أرشيف الإنترنت بالمعرّف ${identifier}`);
  const c = archiveCandidate({ identifier, ...meta.metadata }, meta);
  if (!c.reject && meta.metadata.mediatype !== 'audio') c.reject = `العنصر ليس صوتيًا (${meta.metadata.mediatype})`;
  return c;
}

const parseLength = (value) => {
  if (!value) return null;
  const parts = String(value).split(':').map(Number);
  return parts.some(Number.isNaN) ? null : Number(parts.reduce((acc, n) => acc * 60 + n, 0).toFixed(1));
};

// يُستدعى عند التنزيل فقط: يختار أصغر ملف mp3/ogg/flac في العنصر ويتحقق من الرخصة ثانيةً.
async function resolveArchiveFile(c) {
  const meta = c.meta || await fetchJson(`${ARCHIVE}/metadata/${c.identifier}`, 'أرشيف الإنترنت');
  if (!isAllowedLicense(meta.metadata?.licenseurl)) throw new NoCandidateError(`رخصة العنصر ${c.identifier} غير مقبولة: ${meta.metadata?.licenseurl || 'غير محددة'}`);
  const files = (meta.files || [])
    .filter((f) => /\.(mp3|ogg|oga|flac)$/i.test(f.name) && Number(f.size) > 0)
    .sort((a, b) => Number(a.size) - Number(b.size));
  if (!files.length) throw new FetchError(`لا ملف صوتي مناسب (mp3/ogg/flac) في ${c.identifier}`);
  const file = files[0];
  c.originalUrl = `${ARCHIVE}/download/${c.identifier}/${file.name.split('/').map(encodeURIComponent).join('/')}`;
  c.durationSec = parseLength(file.length);
  return acceptDownload(c, c.originalUrl);
}

// ---------------------------------------------------------------- --from

async function fetchFrom(from, kind) {
  if (/^File:/i.test(from)) return fetchCommonsFile(from, kind);
  let u;
  try { u = new URL(from); } catch { throw new UsageError(`--from يقبل رابطًا أو "File:Name.ext"، لا "${from}"`); }
  const host = u.hostname;
  if (/^commons\.(m\.)?wikimedia\.org$/.test(host)) {
    const m = u.pathname.match(/^\/wiki\/(File:.+)$/i);
    const title = m ? decodeURIComponent(m[1]) : u.searchParams.get('title');
    if (!title || !/^File:/i.test(title)) throw new UsageError('رابط كومنز يجب أن يشير إلى صفحة File:…');
    return fetchCommonsFile(title, kind);
  }
  if (/(^|\.)openverse\.org$/.test(host)) {
    const m = u.pathname.match(/\/(image|images|audio)\/([0-9a-f-]{36})/i);
    if (!m) throw new UsageError('رابط Openverse يجب أن يحوي معرّف الصورة أو الصوت');
    const linkKind = m[1].toLowerCase().startsWith('image') ? 'image' : 'audio';
    if (linkKind !== kind) throw new UsageError(`الرابط لعنصر ${linkKind} والمطلوب ${kind}`);
    return fetchOpenverseItem(m[2], kind);
  }
  if (/(^|\.)nasa\.gov$/.test(host)) {
    if (kind !== 'image') throw new UsageError('ناسا للصور فقط');
    const m = u.pathname.match(/details[/-]([^/?#]+)/);
    if (!m) throw new UsageError('رابط ناسا يجب أن يكون بصيغة images.nasa.gov/details/<id>');
    return fetchNasaItem(decodeURIComponent(m[1]));
  }
  if (/(^|\.)archive\.org$/.test(host)) {
    if (kind !== 'audio') throw new UsageError('أرشيف الإنترنت للصوت فقط');
    const m = u.pathname.match(/^\/(?:details|download|metadata)\/([^/?#]+)/);
    if (!m) throw new UsageError('رابط الأرشيف يجب أن يكون بصيغة archive.org/details/<identifier>');
    return fetchArchiveItem(m[1]);
  }
  throw new UsageError(`--from لا يدعم هذا الموقع: ${host}`);
}

// ---------------------------------------------------------------- المعالجة

// sharp يُحمَّل عند الحاجة فقط: --list والصوت لا يحتاجانه، وتعطّله يُبلَّغ بسطر واحد لا بتتبّع.
async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch (error) {
    throw new ToolError(`تعذّر تحميل sharp لمعالجة الصور (${String(error.message).split('\n')[0]}) — نفّذ npm install`);
  }
}

async function processImage(sharp, input, maxBytes) {
  let last;
  for (const [side, quality] of IMAGE_ATTEMPTS) {
    const { data, info } = await sharp(input)
      .rotate()
      .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    last = { buffer: data, bytes: data.length, width: info.width, height: info.height };
    if (data.length <= maxBytes) return last;
  }
  throw new BudgetError(`الصورة ${fmtKb(last.bytes)} تتجاوز الميزانية ${fmtKb(maxBytes)} حتى بعد كل التخفيضات`);
}

async function resolveFfmpeg() {
  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  try { candidates.push((await import('ffmpeg-static')).default); } catch { /* غير مثبّت؛ نجرّب PATH */ }
  candidates.push('ffmpeg');
  for (const bin of candidates.filter(Boolean)) {
    let stdout;
    try { ({ stdout } = await run(bin, ['-hide_banner', '-encoders'])); } catch { continue; }
    if (/\blibmp3lame\b/.test(stdout)) return bin;
    throw new ToolError(`ffmpeg الموجود (${bin}) بلا مشفّر libmp3lame — عيّن FFMPEG_PATH إلى نسخة تدعمه`);
  }
  throw new ToolError('لم يُعثر على ffmpeg — ثبّت ffmpeg-static أو عيّن FFMPEG_PATH');
}

async function probeDuration(ffmpeg, file) {
  const { stderr } = await run(ffmpeg, ['-hide_banner', '-i', file, '-f', 'null', '-']);
  const m = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])).toFixed(2)) : null;
}

async function processAudio(ffmpeg, input, output, maxBytes) {
  let last;
  for (const [seconds, bitrate] of AUDIO_ATTEMPTS) {
    try {
      await run(ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error', '-t', String(seconds), '-i', input, '-vn', '-map_metadata', '-1',
        '-ac', '1', '-ar', '44100', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'libmp3lame', '-b:a', bitrate, output,
      ]);
    } catch (error) {
      throw new Error(`ffmpeg فشل في تحويل الملف: ${(error.stderr || error.message).trim().split('\n').pop()}`);
    }
    const bytes = (await stat(output)).size;
    last = { bytes, durationSec: await probeDuration(ffmpeg, output) };
    if (bytes <= maxBytes) return last;
  }
  throw new BudgetError(`الصوت ${fmtKb(last.bytes)} يتجاوز الميزانية ${fmtKb(maxBytes)} حتى بعد كل التخفيضات`);
}

const audioExt = (url) => (new URL(url).pathname.match(/\.(mp3|ogg|oga|opus|wav|flac|m4a|aac|webm)$/i) || ['', 'bin'])[1];

// ينزّل المرشح ويعالجه ويكتب الملف النهائي. يعيد { bytes, width, height, durationSec }.
async function acquire(c, { kind, ffmpeg, sharp, maxBytes, outPath }) {
  if (c.provider === 'archive' && !c.downloadUrl) await resolveArchiveFile(c);
  if (c.reject) throw new NoCandidateError(c.reject);
  const buffer = kind === 'audio'
    ? await downloadBuffer(c.downloadUrl, { cap: AUDIO_DOWNLOAD_CAP, partial: true })
    : await downloadBuffer(c.downloadUrl, { cap: IMAGE_DOWNLOAD_CAP, partial: false });
  await mkdir(path.dirname(outPath), { recursive: true });
  if (kind === 'image') {
    const { buffer: webp, ...result } = await processImage(sharp, buffer, maxBytes);
    await writeFile(outPath, webp);
    return { ...result, durationSec: null };
  }
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'media-fetch-'));
  try {
    const input = path.join(tmp, `input.${audioExt(c.downloadUrl)}`);
    const output = path.join(tmp, 'output.mp3');
    await writeFile(input, buffer);
    const result = await processAudio(ffmpeg, input, output, maxBytes);
    await copyFile(output, outPath);
    return { ...result, width: null, height: null };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- السجل والإخراج

// يقرأ سجل النسب ويتحقق أنه مصفوفة JSON. يُستدعى قبل أي عمل شبكي (سجل تالف = لا نبدأ)
// ثم مرة أخرى عند الحفظ ليُبنى التحديث على أحدث نسخة على القرص.
async function readSourceIndex(dir) {
  const file = path.join(dir, '_sources.json');
  const rel = path.relative(ROOT, file);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { file, list: [] };
    throw new ToolError(`تعذّر قراءة ${rel}: ${error.message}`);
  }
  try {
    const list = JSON.parse(text);
    if (!Array.isArray(list)) throw new Error('المحتوى ليس مصفوفة');
    return { file, list };
  } catch (error) {
    throw new ToolError(`${rel} تالف (${error.message}) — أصلحه أو احذفه قبل المتابعة`);
  }
}

async function saveSourceRecord(dir, record) {
  const { file, list } = await readSourceIndex(dir);
  const i = list.findIndex((r) => r.file === record.file);
  if (i === -1) list.push(record); else list[i] = record;
  await writeFile(file, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
}

function describe(c, kind) {
  if (kind === 'image') return c.width ? `${c.width}×${c.height}` : '—';
  return c.durationSec != null ? `${c.durationSec} ث` : '—';
}

function printCandidates(list, kind) {
  list.forEach((c, i) => {
    const status = c.reject ? `✗ ${c.reject}` : `✓ ${c.license}`;
    console.log(`${String(i + 1).padStart(2)}. [${c.provider}] ${status} | ${describe(c, kind)} | ${c.author} | ${c.title}`);
    console.log(`    ${c.sourceUrl}`);
    for (const warning of c.warnings) console.log(`    ⚠ ${warning}`);
  });
}

const failureSummary = (status) => status.failed.map(({ source, reason }) => `${source}: ${reason}`).join('؛ ');

const snippet = (record) => `"media": { ${Object.entries({
  src: record.file, type: record.kind, title: record.title, sourceUrl: record.sourceUrl,
  author: record.author, license: record.license, licenseUrl: record.licenseUrl,
}).map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(', ')} }`;

// ---------------------------------------------------------------- التشغيل

const SEARCHERS = { commons: searchCommons, openverse: searchOpenverse, nasa: searchNasa, archive: searchArchive };

// يمرّ على المصادر بالترتيب ولا يستعلم مصدرًا إلا عند الحاجة، فيبقى ترقيم --list و--pick واحدًا.
// المصدر الذي يفشل يُسجَّل في status.failed مع السبب، لأن فشله يزحزح ترقيم ما بعده.
async function* candidateStream(sources, query, kind, status) {
  for (const source of sources) {
    let list;
    try {
      list = await SEARCHERS[source](query, kind);
    } catch (error) {
      status.failed.push({ source, reason: error.message });
      log(`⚠ ${source}: ${error.message}`);
      continue;
    }
    if (!list.length) log(`… ${source}: لا نتائج`);
    yield* list;
  }
}

// --list: «لا نتائج» ينجح (0)، أما إن لم يردّ أي مصدر لأن المصادر فشلت فهذا خطأ (1) مع أسبابه.
async function listCandidates(stream, kind, json, status) {
  const list = [];
  for await (const c of stream) list.push(c);
  if (json) console.log(JSON.stringify(list.map(({ meta, ...c }) => c), null, 2));
  else printCandidates(list, kind);
  if (!list.length && status.failed.length) throw new NoCandidateError(`لم يردّ أي مصدر بنتائج — مصادر فشلت: ${failureSummary(status)}`);
  if (!list.length && !json) console.log('لا نتائج لهذا البحث.');
  if (status.failed.length) log(`⚠ مصادر فشلت (وقد يختلف ترقيم --pick عند إعادة البحث): ${failureSummary(status)}`);
}

async function main(argv) {
  const opts = parseArgs(argv);
  const { category, query, kind } = opts;
  const maxBytes = (opts.maxKb ?? DEFAULT_KB[kind]) * 1024;
  const outDir = path.join(ROOT, 'media', category);
  const fileName = opts.list ? null : `${opts.qid}${opts.suffix ? `-${opts.suffix}` : ''}.${kind === 'image' ? 'webp' : 'mp3'}`;
  const outPath = fileName && path.join(outDir, fileName);
  if (outPath && !opts.force && await exists(outPath)) {
    throw new UsageError(`الملف موجود: media/${category}/${fileName} — استعمل --force للكتابة فوقه`);
  }
  // كل ما قد يمنع الحفظ يُفحص قبل أي طلب شبكي: صلاحية السجل، ثم الأداة التي يحتاجها النوع.
  if (outPath) await readSourceIndex(outDir);
  const tools = opts.list ? {} : kind === 'audio' ? { ffmpeg: await resolveFfmpeg() } : { sharp: await loadSharp() };

  const status = { failed: [] };
  const stream = opts.from
    ? (async function* single() { yield await fetchFrom(opts.from, kind); }())
    : candidateStream(opts.sources, query, kind, status);
  if (opts.list) return listCandidates(stream, kind, opts.json, status);

  // مع --pick وأكثر من مصدر، فشل مصدر قبل المرشح المطلوب يعني أن الرقم لم يعد يشير إلى ما رآه
  // المستخدم في --list؛ نرفض حينها بدل أن ننزّل مرشحًا آخر بصمت.
  const pickUnsafe = () => Boolean(opts.pick) && opts.sources.length > 1 && status.failed.length > 0;
  const pickUnsafeMessage = () => `ترقيم --pick غير مضمون لأن مصدرًا فشل قبل المرشح ${opts.pick} (${failureSummary(status)}) — أعد الأمر مع --source <اسم المصدر>، فالترقيم داخل المصدر الواحد ثابت`;
  let chosen = null;
  let result = null;
  let index = 0;
  let rejected = 0;
  let tries = 0;
  const strict = Boolean(opts.pick || opts.from);
  for await (const c of stream) {
    index += 1;
    if (opts.pick && index !== opts.pick) continue;
    if (pickUnsafe()) throw new NoCandidateError(pickUnsafeMessage());
    if (c.reject) {
      if (strict) throw new NoCandidateError(`المرشح ${index} (${c.provider}) مرفوض: ${c.reject}`);
      rejected += 1;
      continue;
    }
    log(`↓ ${index}. [${c.provider}] ${c.title} — ${c.license}`);
    try {
      result = await acquire(c, { kind, ...tools, maxBytes, outPath });
      chosen = c;
      break;
    } catch (error) {
      if (strict || error instanceof ToolError) throw error;
      tries += 1;
      log(`⚠ فشل المرشح ${index}: ${error.message}`);
      if (tries >= MAX_CANDIDATE_TRIES) break;
    }
  }
  if (!chosen) {
    const failed = status.failed.length ? ` — مصادر فشلت: ${failureSummary(status)}` : '';
    if (pickUnsafe()) throw new NoCandidateError(pickUnsafeMessage());
    if (opts.pick) throw new NoCandidateError(`لا يوجد مرشح رقم ${opts.pick} (العدد ${index})${failed}`);
    if (tries) throw new NoCandidateError(`فشلت ${tries} محاولات تنزيل أو معالجة ولم يُحفظ ملف${failed}`);
    if (index === 0) throw new NoCandidateError(status.failed.length ? `لم يردّ أي مصدر بنتائج${failed}` : 'لا نتائج لهذا البحث في المصادر المختارة');
    throw new NoCandidateError(`كل المرشحين (${rejected}) مرفوضون بسبب الرخصة أو المضيف${failed}`);
  }
  for (const warning of chosen.warnings) log(`⚠ ${warning}`);

  const record = {
    file: fileName, kind, provider: chosen.provider, query, title: chosen.title,
    sourceUrl: chosen.sourceUrl, originalUrl: chosen.originalUrl, author: chosen.author,
    license: chosen.license, licenseUrl: chosen.licenseUrl,
    bytes: result.bytes, width: result.width, height: result.height, durationSec: result.durationSec,
    fetchedAt: new Date().toISOString(),
  };
  try {
    await saveSourceRecord(outDir, record);
  } catch (error) {
    await rm(outPath, { force: true }); // لا يبقى ملف وسائط بلا سجل نسبة
    throw error;
  }
  if (opts.json) { console.log(JSON.stringify(record, null, 2)); return; }
  const shape = kind === 'image' ? `${record.width}×${record.height}` : `${record.durationSec} ث`;
  console.log(`✓ media/${category}/${fileName} — ${fmtKb(record.bytes)}، ${shape}، ${record.license}، ${record.provider}`);
  console.log(`  السجل: media/${category}/_sources.json`);
  console.log(snippet(record));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      const usage = error instanceof UsageError;
      console.error(`✗ ${error.message}`);
      if (usage) console.error(USAGE);
      process.exit(usage || error instanceof ToolError ? 2 : 1);
    },
  );
}
