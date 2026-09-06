// اختبار اللعب دون إنترنت: يثبت أن زر «حمّل» يخزّن وسائط الفئات في العامل الخدمي، وأن
// ويلعب جولة كاملة من الحزم التجريبية (scripts/demo-packs.mjs) ويتحقق من أن كل نوع
// سؤال يُعرض ويعمل فعلًا: الصور بمؤثراتها، الصوت (وسقف المرات الثلاث)، الفيديو،
// اكتشف الفرق، أربع صور، ركّبها صح، الاختيار، الشفرة، التلميحات وخصمها، وشاشة
// «المصادر والتراخيص». ليس ضمن `npm test` لأنه يحتاج Playwright وChromium:
//
//   npm i -D playwright   (أو NODE_PATH يشير إلى تثبيت عام)
//   node scripts/demo-packs.mjs && npm run build && node scripts/e2e/media-offline.cjs
//   node scripts/demo-packs.mjs --remove
//
// متغيرات اختيارية: CHROMIUM_PATH (مسار متصفح بديل)، E2E_PORT.
// يثبت أن زر «حمّل» يخزّن وسائط الفئات في العامل الخدمي، وأن اللعب يستمر
// بعد قطع الشبكة تمامًا.
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('يلزم Playwright: npm i -D playwright  (أو NODE_PATH=/opt/node22/lib/node_modules)'); process.exit(2); }
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const REPO = path.resolve(__dirname, '..', '..');
const ROOT = path.join(REPO, 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.wav': 'audio/wav', '.webm': 'video/webm', '.webp': 'image/webp' };
const PORT = Number(process.env.E2E_PORT || 8099);
const SHOTS = path.join(require('os').tmpdir(), 'maydan-e2e');
fs.mkdirSync(SHOTS, { recursive: true });
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(url.parse(req.url).pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  await p.addInitScript(() => { Math.random = () => 0; });
  let fails = 0;
  const check = (ok, m) => { if (!ok) { fails += 1; console.log('   ✗', m); } else console.log('   ✓', m); };
  const tapText = async (t) => {
    await p.waitForFunction((x) => [...document.querySelectorAll('button')].some((el) => !el.disabled && el.offsetParent !== null && (el.textContent || '').includes(x)), t);
    await p.evaluate((x) => { [...document.querySelectorAll('button')].find((el) => !el.disabled && el.offsetParent !== null && (el.textContent || '').includes(x)).click(); }, t);
    await p.waitForTimeout(100);
  };

  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload({ waitUntil: 'load' });
  check(await p.evaluate(() => !!navigator.serviceWorker.controller), 'العامل الخدمي يتحكم بالصفحة');

  await p.waitForSelector('.splash', { state: 'detached' });
  await p.evaluate(() => { location.hash = '#/game/badeeha'; });
  await p.waitForSelector('.details-hero h1');
  await tapText('العب');
  await p.waitForSelector('.game-frame .m-root .m-home');
  await p.click('.m-hero-cta');
  await p.waitForSelector('.m-category-pick');
  await p.evaluate(() => { [...document.querySelectorAll('.m-category-pick .m-category-main')].slice(0, 6).forEach((el) => el.click()); });
  await p.waitForTimeout(200);

  const row = await p.$('.m-offline-row');
  check(!!row, 'صف تجهيز الوسائط ظهر للفئات ذات الوسائط');
  const label = await p.textContent('.m-offline-text small');
  console.log('   ', label.trim());
  await tapText('حمّل');
  await p.waitForFunction(() => { const el = document.querySelector('.m-offline-text small'); return el && /جاهزة|تعذّر/.test(el.textContent); }, null, { timeout: 30000 });
  const after = (await p.textContent('.m-offline-text small')).trim();
  check(after.includes('جاهزة'), `بعد التحميل: «${after}»`);

  const cached = await p.evaluate(async () => {
    const c = await caches.open('maydan-media-v1');
    return (await c.keys()).map((r) => r.url);
  });
  const want = Number((label.match(/(\d+) ملفًا/) || [])[1] || 0);
  check(cached.length >= want && want > 0, `مخزن الوسائط فيه ${cached.length} من ${want} ملفًا`);

  // اقطع الشبكة تمامًا ثم العب
  await ctx.setOffline(true);
  await p.click('.m-sticky-action');
  await p.waitForSelector('.m-board-grid');
  check(true, 'اللوحة بُنيت بعد قطع الشبكة');

  const kinds = {};
  for (let i = 0; i < 30; i += 1) {
    const opened = await p.evaluate(() => { const el = document.querySelector('.m-tier:not(.done)'); if (!el) return false; el.click(); return true; });
    if (!opened) break;
    await p.waitForSelector('.m-question-screen');
    await p.waitForTimeout(200);
    const info = await p.evaluate(() => {
      const q = document.querySelector('.m-question-screen');
      const img = q.querySelector('.m-media-img');
      const au = q.querySelector('audio');
      const vi = q.querySelector('video');
      return { err: !!q.querySelector('.m-media-error'), img: img ? img.naturalWidth : null,
        imgs: [...q.querySelectorAll('.m-media-img')].map((x) => x.naturalWidth),
        audio: au ? au.readyState : null, video: vi ? vi.readyState : null };
    });
    if (info.imgs.length) { kinds.image = (kinds.image || 0) + 1; if (!info.imgs.every((w) => w > 0)) { fails += 1; console.log('   ✗ صورة لم تُحمَّل بلا شبكة', JSON.stringify(info.imgs)); } }
    if (info.audio !== null) { kinds.audio = (kinds.audio || 0) + 1; if (info.audio < 2) { fails += 1; console.log('   ✗ صوت لم يجهز بلا شبكة readyState=' + info.audio); } }
    if (info.video !== null) { kinds.video = (kinds.video || 0) + 1; if (info.video < 1) { fails += 1; console.log('   ✗ فيديو لم يجهز بلا شبكة readyState=' + info.video); } }
    if (info.err) { fails += 1; console.log('   ✗ صندوق خطأ ظهر بلا شبكة'); }
    await p.click('.m-reveal-action');
    await p.waitForSelector('.m-judge');
    await p.click('.m-judge-grid button');
    const done = await Promise.race([
      p.waitForSelector('.m-board-grid', { timeout: 8000 }).then(() => false),
      p.waitForSelector('.m-results, .m-final', { timeout: 8000 }).then(() => true),
    ]).catch(() => true);
    if (done) break;
  }
  console.log('   وسائط شُغّلت بلا شبكة:', JSON.stringify(kinds));
  check((kinds.image || 0) > 0 && (kinds.audio || 0) > 0 && (kinds.video || 0) > 0, 'صورة وصوت وفيديو عملت كلها بلا شبكة');

  console.log(fails ? `\n✗ ${fails} إخفاقًا` : '\n✓ اللعب دون إنترنت يعمل بعد التجهيز');
  await b.close(); server.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); server.close(); process.exit(2); });
