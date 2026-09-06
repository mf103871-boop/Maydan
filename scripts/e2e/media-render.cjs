// اختبار عرض الوسائط من طرف إلى طرف: يشغّل الموقع المبني في Chromium على مقاس هاتف،
// ويلعب جولة كاملة من الحزم التجريبية (scripts/demo-packs.mjs) ويتحقق من أن كل نوع
// سؤال يُعرض ويعمل فعلًا: الصور بمؤثراتها، الصوت (وسقف المرات الثلاث)، الفيديو،
// اكتشف الفرق، أربع صور، ركّبها صح، الاختيار، الشفرة، التلميحات وخصمها، وشاشة
// «المصادر والتراخيص». ليس ضمن `npm test` لأنه يحتاج Playwright وChromium:
//
//   npm i -D playwright   (أو NODE_PATH يشير إلى تثبيت عام)
//   node scripts/demo-packs.mjs && npm run build && node scripts/e2e/media-render.cjs
//   node scripts/demo-packs.mjs --remove
//
// متغيرات اختيارية: CHROMIUM_PATH (مسار متصفح بديل)، E2E_PORT.
// Drives the built platform through a full بَديهة round whose deck is entirely
// media/special questions, and asserts each visual actually renders and plays.
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('يلزم Playwright: npm i -D playwright  (أو NODE_PATH=/opt/node22/lib/node_modules)'); process.exit(2); }
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const REPO = path.resolve(__dirname, '..', '..');
const ROOT = path.join(REPO, 'dist');
const CATS = path.join(REPO, 'src/data/categories');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.wav': 'audio/wav', '.webm': 'video/webm', '.webp': 'image/webp' };
const PORT = Number(process.env.E2E_PORT || 8098);
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

// خريطة qid → النوع المتوقّع، تُقرأ من نفس ملفات الحزم التي بُني منها الموقع
const expect = new Map();
for (const f of fs.readdirSync(CATS).filter((n) => n.endsWith('.json'))) {
  const pack = JSON.parse(fs.readFileSync(path.join(CATS, f), 'utf8'));
  for (const q of pack.qs) {
    const kind = q.type ? (q.type === 'image' ? `image-${q.effect || 'none'}` : q.type) : 'plain';
    expect.set(q.qid, { kind, p: q.p, a: q.a, pack: pack.id });
  }
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  const errs = [], net404 = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200)));
  p.on('response', (r) => { if (r.status() >= 400) net404.push(r.status() + ' ' + r.url()); });
  // ترتيب ثابت: random()=0 يبقي فرز الأسئلة مستقرًا فيصير المجموعة معلومة سلفًا
  await p.addInitScript(() => { Math.random = () => 0; });

  const tap = async (sel) => {
    await p.waitForSelector(sel, { state: 'attached' });
    const r = await p.evaluate((s) => { const el = document.querySelector(s); if (!el) return 'missing'; if (el.disabled) return 'disabled'; el.click(); return 'ok'; }, sel);
    if (r !== 'ok') throw new Error(`${r}: ${sel}`);
    await p.waitForTimeout(80);
  };
  const tapText = async (t) => {
    const ok = await p.evaluate((x) => { const el = [...document.querySelectorAll('button')].find((b) => !b.disabled && b.offsetParent !== null && (b.textContent || '').includes(x)); if (!el) return false; el.click(); return true; }, t);
    if (!ok) throw new Error('no button: ' + t);
    await p.waitForTimeout(80);
  };

  let fails = 0;
  const check = (ok, msg) => { if (!ok) { fails += 1; console.log('   ✗', msg); } };

  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await p.waitForSelector('.splash', { state: 'detached', timeout: 8000 });
  await p.evaluate(() => { location.hash = '#/game/badeeha'; });
  await p.waitForSelector('.details-hero h1');
  await tapText('العب');
  await p.waitForSelector('.game-frame .m-root .m-home');
  await tap('.m-hero-cta');
  await p.waitForSelector('.m-category-pick');
  await p.evaluate(() => { [...document.querySelectorAll('.m-category-pick .m-category-main')].slice(0, 6).forEach((el) => el.click()); });
  await p.waitForTimeout(150);
  await tap('.m-sticky-action');
  await p.waitForSelector('.m-board-grid');
  const cells = await p.$$eval('.m-tier', (e) => e.length);
  console.log('board cells:', cells);

  const seen = {};
  const scores = () => p.$$eval('.m-score-card .m-points', (e) => e.map((x) => Number(x.textContent)));
  for (let i = 0; i < cells; i += 1) {
    const scoreOnBoard = await scores();
    const opened = await p.evaluate(() => {
      const el = document.querySelector('.m-tier:not(.done)');
      if (!el) return null;
      el.click();
      return true;
    });
    if (!opened) break;
    await p.waitForSelector('.m-question-screen');
    await p.waitForTimeout(220);

    const info = await p.evaluate(() => {
      const q = document.querySelector('.m-question-screen');
      const img = q.querySelector('.m-media-img');
      const au = q.querySelector('audio');
      const vi = q.querySelector('video');
      return {
        err: !!q.querySelector('.m-media-error'),
        spinner: !!q.querySelector('.m-media-spinner'),
        imgClass: img ? img.className : null,
        imgOk: img ? img.naturalWidth > 0 : null,
        imgs: [...q.querySelectorAll('img')].map((x) => x.naturalWidth),
        tiles: q.querySelectorAll('.m-reveal-tiles i').length,
        tilesOpen: q.querySelectorAll('.m-reveal-tiles i.is-open').length,
        audio: au ? { ready: au.readyState, dur: au.duration } : null,
        video: vi ? { ready: vi.readyState, w: vi.videoWidth } : null,
        diffSides: q.querySelectorAll('.m-diff-side').length,
        fourpics: q.querySelectorAll('.m-fourpics img').length,
        jumble: q.querySelectorAll('.m-jumble i').length,
        jumblePos: [...q.querySelectorAll('.m-jumble i')].map((x) => x.style.backgroundPosition),
        canEnlarge: !!q.querySelector('.m-media-stage.can-enlarge'),
        choice: q.querySelectorAll('.m-options span').length,
        code: (q.querySelector('.m-code') || {}).textContent || null,
        codeDir: (q.querySelector('.m-code') || {}).getAttribute ? q.querySelector('.m-code').getAttribute('dir') : null,
        tf: q.querySelectorAll('.m-tf span').length,
        scramble: [...q.querySelectorAll('.m-scramble span')].map((x) => x.textContent).join(''),
        blank: (q.querySelector('.m-blank') || {}).textContent || null,
        items: q.querySelectorAll('.m-item-list span').length,
        hints: q.querySelectorAll('.m-hints > div').length,
        hintBtn: [...q.querySelectorAll('button')].some((x) => (x.textContent || '').includes('اطلب تلميحًا')),
        points: (q.querySelector('.m-question-points, .m-points') || {}).textContent || null,
        qid: window.__mq || null,
      };
    });

    // نعرف السؤال من محتواه: الحزم التجريبية تجعل كل خانة نوعًا واحدًا
    let kind = 'plain';
    if (info.diffSides) kind = 'diff';
    else if (info.fourpics) kind = 'fourpics';
    else if (info.imgClass) kind = 'image-' + (info.imgClass.match(/fx-(\w+)/) || [, 'none'])[1];
    else if (info.choice) kind = 'choice';
    else if (info.code) kind = 'code';
    else if (info.audio) kind = 'audio';
    else if (info.video) kind = 'video';
    else if (info.tf) kind = 'truefalse';
    else if (info.scramble) kind = 'scramble';
    else if (info.blank) kind = 'complete';
    else if (info.items) kind = 'common';
    else if (info.hints) kind = 'hints';
    seen[kind] = (seen[kind] || 0) + 1;

    check(!info.err, `${kind}: صندوق خطأ ظاهر`);
    if (kind.startsWith('image-')) {
      check(info.imgOk === true, `${kind}: الصورة لم تُحمَّل (naturalWidth=0)`);
      if (kind === 'image-reveal') {
        check(info.tiles === 12, `reveal: ${info.tiles} قطعة بدل 12`);
        check(info.tilesOpen === 0, `reveal: قطع مكشوفة قبل الضغط (${info.tilesOpen})`);
        await tapText('اكشف قطعة');
        await p.waitForTimeout(1200);
        await tapText('اكشف قطعة');
        const open2 = await p.$$eval('.m-reveal-tiles i.is-open', (e) => e.length);
        check(open2 === 2, `reveal: بعد ضغطتين بينهما ثانية ${open2} قطعة مكشوفة (القطع تعود للغطاء عند إعادة التركيب)`);
      }
    }
    if (kind === 'audio') {
      check(info.audio.ready >= 2, `audio: readyState=${info.audio.ready}`);
      check(info.audio.dur > 0.5, `audio: duration=${info.audio.dur}`);
      await tap('.m-audio-btn');
      await p.waitForTimeout(350);
      const st = await p.evaluate(() => { const a = document.querySelector('audio'); return { paused: a.paused, t: a.currentTime }; });
      check(!st.paused && st.t > 0, `audio: لم يعمل (paused=${st.paused} t=${st.t})`);
      // يجب أن يستمر التشغيل عبر دقّة مؤقت الثواني (لا إعادة تركيب للمكوّن)
      await p.waitForTimeout(1400);
      const st2 = await p.evaluate(() => { const a = document.querySelector('audio'); return { paused: a.paused, t: a.currentTime, ended: a.ended }; });
      check(st2.t > st.t && (!st2.paused || st2.ended), `audio: توقف بعد دقّة المؤقت (t ${st.t}→${st2.t}, paused=${st2.paused}, ended=${st2.ended})`);
      // سقف ثلاث مرات قبل الكشف: بعد ثلاث بدايات يتعطّل زرّا التشغيل والإعادة
      await tapText('من البداية');
      await p.waitForTimeout(120);
      await tapText('من البداية');
      await p.waitForTimeout(120);
      const cap = await p.evaluate(() => ({
        playDisabled: document.querySelector('.m-audio-btn').disabled,
        restartDisabled: [...document.querySelectorAll('.m-audio button')].some((b) => (b.textContent || '').includes('من البداية') && b.disabled),
        spent: !!document.querySelector('.m-audio.is-spent'),
        label: (document.querySelector('.m-audio-meta b') || {}).textContent,
      }));
      // إيقاف في المنتصف: الاستئناف مسموح؛ بعد انتهاء المقطع: زر التشغيل يُقفل
      await p.evaluate(() => { const a = document.querySelector('audio'); a.pause(); });
      await p.waitForTimeout(120);
      const midway = await p.evaluate(() => document.querySelector('.m-audio-btn').disabled);
      await p.evaluate(() => { const a = document.querySelector('audio'); a.currentTime = a.duration; a.play().catch(() => {}); });
      await p.waitForFunction(() => document.querySelector('audio').ended, null, { timeout: 4000 }).catch(() => {});
      await p.waitForTimeout(150);
      const afterEnd = await p.evaluate(() => ({ ended: document.querySelector('audio').ended, disabled: document.querySelector('.m-audio-btn').disabled }));
      check(cap.restartDisabled && cap.spent, `audio: السقف لم يُطبَّق بعد 3 مرات ${JSON.stringify(cap)}`);
      check(!midway, 'audio: استئناف مقطع متوقف في منتصفه مُنع رغم أنه ليس مرة جديدة');
      check(afterEnd.ended && afterEnd.disabled, `audio: بعد انتهاء المرة الثالثة زر التشغيل ما زال مفعّلًا ${JSON.stringify(afterEnd)}`);
    }
    if (kind === 'image-jumble') {
      check(info.jumble === 12, `jumble: ${info.jumble} قطعة بدل 12`);
      check(new Set(info.jumblePos).size === 12, 'jumble: مواضع القطع ليست 12 موضعًا مختلفًا');
      check(info.jumblePos.some((pos, i) => pos !== `${(i % 4) * (100 / 3)}% ${Math.floor(i / 4) * 50}%`), 'jumble: القطع بترتيبها الأصلي (غير مبعثرة)');
      check(!info.canEnlarge, 'jumble: التكبير متاح قبل الكشف (يسرّب الصورة)');
    }
    if (kind === 'image-none') {
      check(info.canEnlarge, 'image: التكبير باللمس غير متاح للصورة العادية');
      await tap('.m-media-stage.can-enlarge');
      await p.waitForTimeout(150);
      const lb = await p.evaluate(() => ({ open: !!document.querySelector('.m-lightbox'), img: !!document.querySelector('.m-lightbox img') }));
      check(lb.open && lb.img, `lightbox: لم يفتح ${JSON.stringify(lb)}`);
      await tap('.m-lightbox');
      await p.waitForTimeout(150);
      check(!(await p.$('.m-lightbox')), 'lightbox: لم يُغلق باللمس');
    }
    if (kind === 'image-zoom' || kind === 'image-blur') check(!info.canEnlarge, `${kind}: التكبير متاح قبل الكشف (يسرّب الصورة)`);
    if (kind === 'fourpics') check(info.fourpics === 4 && info.imgs.length === 4 && info.imgs.every((w) => w > 0), `fourpics: ${info.fourpics} صور، أحجام ${JSON.stringify(info.imgs)}`);
    if (kind === 'choice') check(info.choice === 2, `choice: ${info.choice} خيارًا`);
    if (kind === 'code') check(!!info.code && info.codeDir === 'ltr', `code: «${info.code}» dir=${info.codeDir}`);
    if (kind === 'video') {
      check(info.video.ready >= 1, `video: readyState=${info.video.ready}`);
      check(info.video.w > 0, `video: videoWidth=${info.video.w}`);
    }
    if (kind === 'diff') {
      check(info.diffSides === 2, `diff: ${info.diffSides} صورة`);
      check(info.imgs.every((w) => w > 0), `diff: صورة لم تُحمَّل ${JSON.stringify(info.imgs)}`);
    }
    if (kind === 'scramble') check(info.scramble.length === 5, `scramble: «${info.scramble}»`);
    if (kind === 'complete') check(info.blank.includes('؟'), `complete: الفراغ مكشوف «${info.blank}»`);
    if (kind === 'common') check(info.items === 3, `common: ${info.items} عنصرًا`);

    let hintsUsed = 0;
    if (kind === 'hints') {
      check(info.hints === 3, `hints: ${info.hints} تلميحًا`);
      check(info.hintBtn, 'hints: لا زر تلميح');
      await tapText('اطلب تلميحًا'); hintsUsed += 1;
      await tapText('اطلب تلميحًا'); hintsUsed += 1;
      const open = await p.$$eval('.m-hints > div.is-open', (e) => e.length);
      check(open === 2, `hints: ${open} مكشوفًا بعد طلبين`);
    }

    await tap('.m-reveal-action');
    await p.waitForSelector('.m-judge');
    await p.waitForTimeout(150);
    const after = await p.evaluate(() => {
      const q = document.querySelector('.m-question-screen');
      return {
        tf: [...q.querySelectorAll('.m-tf span.is-answer')].map((x) => x.textContent),
        scramble: [...q.querySelectorAll('.m-scramble span')].map((x) => x.textContent).join(''),
        blank: (q.querySelector('.m-blank') || {}).textContent || null,
        spot: q.querySelectorAll('.m-diff-spot').length,
        tilesOpen: q.querySelectorAll('.m-reveal-tiles i.is-open').length,
        hintsOpen: q.querySelectorAll('.m-hints > div.is-open').length,
        choiceAnswer: q.querySelectorAll('.m-options span.is-answer').length,
        jumbleGone: q.querySelectorAll('.m-jumble').length === 0,
        imgVisible: !q.querySelector('.m-media-img.is-hidden-src'),
      };
    });
    if (kind === 'truefalse') check(after.tf.length === 1, `truefalse: ${after.tf.length} إجابة مبرزة`);
    if (kind === 'scramble') check(after.scramble === 'ميدان', `scramble بعد الكشف: «${after.scramble}»`);
    if (kind === 'complete') check(after.blank && !after.blank.includes('؟'), `complete بعد الكشف: «${after.blank}»`);
    if (kind === 'choice') check(after.choiceAnswer === 1, `choice: ${after.choiceAnswer} خيار مبرز بعد الكشف`);
    if (kind === 'image-jumble') check(after.jumbleGone && after.imgVisible, `jumble بعد الكشف: القطع ${after.jumbleGone ? 'اختفت' : 'باقية'}، الصورة ${after.imgVisible ? 'ظاهرة' : 'مخفية'}`);
    if (kind === 'diff') check(after.spot === 2, `diff: ${after.spot} علامة موضع`);
    if (kind === 'image-reveal') check(after.tilesOpen === 12, `reveal: ${after.tilesOpen}/12 مكشوفة بعد الإجابة`);
    if (kind === 'hints') check(after.hintsOpen === 3, `hints: ${after.hintsOpen}/3 مكشوفة بعد الإجابة`);

    if (kind === 'hints') {
      await p.screenshot({ path: path.join(SHOTS, 'shot-media-hints.png') });
    } else if (['image-zoom', 'image-blur', 'image-silhouette', 'image-reveal', 'image-jumble', 'fourpics', 'choice', 'code', 'audio', 'video', 'diff'].includes(kind) && seen[kind] === 1) {
      await p.screenshot({ path: path.join(SHOTS, `shot-media-${kind}.png`) });
    }

    // «إجابة صحيحة» للفريق الأول
    await tap('.m-judge-grid button');
    const ended = await Promise.race([
      p.waitForSelector('.m-board-grid', { timeout: 9000 }).then(() => false),
      p.waitForSelector('.m-results, .m-final', { timeout: 9000 }).then(() => true),
    ]).catch(() => true);
    if (kind === 'hints') {
      const scoreAfter = ended ? [] : await scores();
      const gained = ended ? null : Math.max(...scoreAfter.map((v, j) => v - (scoreOnBoard[j] || 0)));
      const q = [...expect.values()].find((x) => x.kind === 'hints');
      const want = Math.round((q.p * (100 - hintsUsed * 25)) / 100);
      check(gained === want, `hints: النقاط ${gained} بدل ${want} (سؤال ${q.p} بعد ${hintsUsed} تلميحين)`);
      console.log('   خصم التلميحات:', gained, 'من', q.p);
    }
    if (ended) { console.log('انتهت الجولة عند السؤال', i + 1); break; }
  }

  // شاشة «المصادر والتراخيص» تعرض ملفات الحزم التجريبية
  // من داخل اللعبة يعترض الإطار تغيير الـhash بتأكيد خروج؛ نفتح «حول» بتحميل جديد
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await p.waitForSelector('.splash', { state: 'detached', timeout: 8000 });
  await p.evaluate(() => { location.hash = '#/about'; });
  await p.waitForSelector('.about-list', { timeout: 8000 });
  const credits = await p.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => (c.textContent || '').includes('المصادر والتراخيص'));
    if (!card) return { found: false };
    const btn = [...card.querySelectorAll('button')].find((b) => (b.textContent || '').includes('عرض القائمة'));
    if (btn) btn.click();
    return { found: true, text: (card.textContent || '').slice(0, 160) };
  });
  await p.waitForTimeout(200);
  const creditRows = await p.$$eval('.credits-list li', (e) => e.length);
  // المتوقع = عدد الملفات المميزة التي تشير إليها الحزم المركّبة فعلًا
  const distinct = new Set();
  for (const f of fs.readdirSync(CATS).filter((n) => n.endsWith('.json'))) {
    for (const q of JSON.parse(fs.readFileSync(path.join(CATS, f), 'utf8')).qs) {
      const list = q.media == null ? [] : Array.isArray(q.media) ? q.media : [q.media];
      for (const m of list) if (m && typeof m === 'object' && m.src) distinct.add(m.src);
    }
  }
  check(credits.found, 'شاشة المصادر والتراخيص غير موجودة في «حول»');
  check(creditRows === distinct.size, `المصادر: ${creditRows} صفًا (المتوقع ${distinct.size} ملفًا مميزًا)`);
  console.log('   المصادر:', credits.text);

  console.log('\nأنواع ظهرت:', JSON.stringify(seen, null, 0));
  const want = ['image-none', 'image-zoom', 'image-blur', 'image-silhouette', 'image-reveal', 'image-jumble', 'fourpics', 'audio', 'video', 'diff', 'truefalse', 'choice', 'code', 'scramble', 'complete', 'common', 'hints'];
  for (const k of want) check(seen[k] > 0, `النوع «${k}» لم يظهر`);
  if (errs.length) { fails += errs.length; console.log('page errors:', errs); }
  const bad404 = net404.filter((u) => !u.includes('favicon'));
  if (bad404.length) { fails += bad404.length; console.log('bad responses:', bad404); }
  console.log(fails ? `\n✗ ${fails} إخفاقًا` : '\n✓ كل الأنواع تعمل');
  await b.close();
  server.close();
  process.exit(fails ? 1 : 0);
})().catch(async (e) => { console.error('CRASH', e); server.close(); process.exit(2); });
