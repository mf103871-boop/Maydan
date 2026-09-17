// فحص شامل لجدار «ميدان بلس» ضد الخادم المحلي بالمزوّد الوهمي (AUTH_DEV_FAKE=1):
// يبني الحزمة في الذاكرة وهي تشير إلى الخادم، ثم يتحقق عبر Playwright من أن
// 68 حزمة مقفولة للمجهول والمسجَّل غير المشترك، وصفر بعد منح الاشتراك؛ وأن
// المباراة المجانية الأولى تمر والثانية تفتح الجدار؛ وأن إنشاء الغرف يُرفض بـ
// PLUS_REQUIRED بعد التجربة ويُقبل للمشترك والمجهول؛ وأن الخروج يُبطل الرمز.
// ليس ضمن `npm test` لأنه يحتاج Playwright وChromium:
//
//   npm run e2e:paywall            (اللقطات في $TMPDIR/maydan-e2e/paywall أو المسار الممرَّر)
//
// متغيرات اختيارية: CHROMIUM_PATH، E2E_PORT (واجهة، 3000)، E2E_API_PORT (خادم، 8790).
// ملاحظة: بعد كل تعديل يجريه الفحص على الخادم مباشرةً (منح/تجربة) يحذف النسخة
// المخزّنة من /api/me قبل إعادة التحميل، لأن الواجهة تحدّثها كل عشر دقائق فقط.
const API_PORT = Number(process.env.E2E_API_PORT || 8790); const WEB_PORT = Number(process.env.E2E_PORT || 3000);
// كما في النشر الكامل على Cloudflare: الـAPI على أصل الصفحة نفسه (خادم الصفحة يمرّر /api و/health).
process.env.MAYDAN_ROOMS_URL = 'same-origin';
import { build as esbuildBuild } from 'esbuild';
import { esbuildOptions, renderHtml, readPkg, mediaVersions } from '../lib.mjs';
import { startLocalServer } from '../../server/local.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import os from 'node:os'; import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('يلزم Playwright: npm i -D playwright'); process.exit(2); }
const OUT = process.argv[2] || path.join(os.tmpdir(), 'maydan-e2e', 'paywall'); fs.mkdirSync(OUT, { recursive: true });
const API = ''; // نداءات الصفحة نسبية: GET بلا Origin كما يفعل المتصفح فعلًا
const SECRET_CODE = 'EXTRACODE'; // رمز يعرفه الخادم وحده (السرّ REDEEM_CODE_HASHES)، ليس في حزمة الويب
let app; let web; let browser;
try {
app = await startLocalServer({ port: API_PORT, origins: `http://localhost:${WEB_PORT}`, vars: { AUTH_DEV_FAKE: '1', SESSION_SECRET: 'e2e-secret', REDEEM_CODE_HASHES: createHash('sha256').update(SECRET_CODE).digest('hex') } });
const pkg = await readPkg(); const media = await mediaVersions();
const result = await esbuildBuild(esbuildOptions({ minify: false, version: pkg.version, media }));
const html = await renderHtml(result.outputFiles[0].text, { version: pkg.version });
web = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/health' || pathname === '/api' || pathname.startsWith('/api/')) {
    // تمرير شفاف يحفظ ترويسات المتصفح (Origin إن وُجد، Sec-Fetch-Site، Referer، Authorization).
    const upstream = http.request({ host: '127.0.0.1', port: API_PORT, method: req.method, path: req.url, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
});
await new Promise((r) => web.listen(WEB_PORT, r));
browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar', isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/unsupported MIME type|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const results = []; const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
const go = async (h, ms = 900) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(ms); };
const tap = async (t) => { const ok = await page.evaluate((x) => { const el = [...document.querySelectorAll('button')].find((b) => !b.disabled && b.offsetParent !== null && (b.textContent || '').includes(x)); if (!el) return false; el.click(); return true; }, t); await page.waitForTimeout(400); return ok; };
const lockedCounts = async () => {
  await go('#/game/badeeha'); await tap('العب'); await page.waitForSelector('.m-home');
  await page.evaluate(() => document.querySelector('.m-hero-cta').click()); await page.waitForSelector('.m-category-pick'); await page.waitForTimeout(500);
  return page.evaluate(() => ({ locked: document.querySelectorAll('.m-category-pick.is-locked').length, total: document.querySelectorAll('.m-category-pick').length }));
};
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const creds = () => ({ id: hex(16), token: hex(32), avatar: 0, rounds: 6 });
const apiCall = (p, body, token) => page.evaluate(async ({ API, p, body, token }) => {
  const r = await fetch(`${API}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, { API, p, body, token });
const reload = async () => { await page.evaluate(() => localStorage.removeItem('maydan:account:me')); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(700); await page.evaluate(() => { const s = document.querySelector('.splash'); if (s) s.click(); }); await page.waitForTimeout(800); };

await page.goto(`http://localhost:${WEB_PORT}/#/`, { waitUntil: 'load' }); await page.waitForTimeout(700);
await page.evaluate(() => { const s = document.querySelector('.splash'); if (s) s.click(); }); await page.waitForTimeout(800);

// ١) مجهول: 68 مقفولة، والنقر يفتح الجدار (بلا إشعار «دون اتصال»).
let c = await lockedCounts(); check('anon locked 68/78', c.locked === 68 && c.total === 78, JSON.stringify(c));
await page.evaluate(() => document.querySelector('.m-category-pick.is-locked .m-category-main').click()); await page.waitForTimeout(600); await shot('01-anon-paywall');
const pw = await page.evaluate(() => { const s = document.querySelector('.paywall'); return { open: !!s, reason: s && s.dataset.reason, text: s ? s.textContent : '' }; });
check('anon paywall opens reason=pack', pw.open && pw.reason === 'pack', pw.reason);
check('paywall online (no offline notice)', !/دون اتصال/.test(pw.text));
check('paywall shows sign-in block (providers unconfigured in dev → note only)', await page.evaluate(() => !!document.querySelector('.paywall-auth .paywall-note')));

// التفعيل للمسجل فقط؛ رمز الخادم لا يفتح شيئًا للمجهول.
await page.evaluate(() => document.querySelector('.paywall-redeem').click()); await page.waitForTimeout(300);
await page.fill('.paywall input[aria-label="رمز الهدية"]', SECRET_CODE);
check('anonymous redemption requires sign-in', await page.evaluate(() => /سجّل الدخول أولًا/.test(document.querySelector('.account-redeem').textContent) && [...document.querySelectorAll('.account-redeem button')].find((b) => b.textContent.includes('تفعيل')).disabled));
const anonRedeem = await apiCall('/api/redeem', { code: SECRET_CODE });
check('anonymous redemption rejected by server', anonRedeem.status === 401, String(anonRedeem.status));
// «رجوع» يعيد الخطط ويعيد التركيز إلى زر الرمز؛ وإغلاق الجدار ثم فتحه يبدأ بالخطط لا بالنموذج.
await page.evaluate(() => [...document.querySelectorAll('.paywall .account-redeem button')].find((b) => b.textContent.includes('رجوع')).click()); await page.waitForTimeout(300); // زر النموذج لا زر رجوع اللعبة
check('back returns to plans and focuses the redeem trigger', await page.evaluate(() => !document.querySelector('.paywall form') && !!document.querySelector('.paywall-plans') && document.activeElement && document.activeElement.classList.contains('paywall-redeem')));
await page.evaluate(() => document.querySelector('.paywall-redeem').click()); await page.waitForTimeout(200);
await page.keyboard.press('Escape'); await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('.m-category-pick.is-locked .m-category-main').click()); await page.waitForTimeout(600);
check('reopened paywall starts on plans', await page.evaluate(() => !!document.querySelector('.paywall .paywall-plans') && !document.querySelector('.paywall form')));
await page.evaluate(() => document.querySelector('.paywall-redeem').click()); await page.waitForTimeout(300);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.evaluate(() => localStorage.setItem('maydan:account:promo', JSON.stringify({ code: 'legacy-public-code', hash: 'legacy-hash', redeemedAt: Date.now() })));
await reload();
c = await lockedCounts(); check('legacy local promo cannot unlock packs', c.locked === 68, JSON.stringify(c));
check('legacy raw gift code removed from storage', await page.evaluate(() => localStorage.getItem('maydan:account:promo') === null));

// ٢) دخول وهمي عبر الخادم ثم حقن الجلسة.
const signin = await apiCall('/api/auth/dev', { subject: 'e2e-user', name: 'مختبر', client: 'web' });
check('dev sign-in 200', signin.status === 200 && !!signin.body?.session?.token, String(signin.status));
const token = signin.body?.session?.token;
await page.evaluate((t) => localStorage.setItem('maydan:account:session', JSON.stringify(t)), token);
await reload();
await go('#/settings'); await page.waitForTimeout(800); await shot('02-settings-signed-in');
const settingsText = await page.evaluate(() => document.body.textContent);
check('settings shows user name', settingsText.includes('مختبر'));
c = await lockedCounts(); check('signed-in free still locked 68', c.locked === 68, JSON.stringify(c));
// ٣) منح اشتراك → صفر مقفول، وتفاصيل اللعبة بلا ملاحظة.
const grant = await apiCall('/api/dev/grant', { until: Date.now() + 30 * 86400e3, product: 'plus.yearly' }, token);
check('dev grant 200 premium', grant.status === 200 && grant.body?.premium?.active === true, JSON.stringify(grant.body?.premium));
await reload();
c = await lockedCounts(); check('premium locked 0', c.locked === 0, JSON.stringify(c)); await shot('03-premium-picker');
await go('#/settings'); await page.waitForTimeout(600); await shot('04-settings-premium');
const st2 = await page.evaluate(() => document.body.textContent); check('settings shows plus active', /بلس/.test(st2) && /سنوي|فعّال|نشط|حتى/.test(st2));
await go('#/game/beep'); const note1 = await page.evaluate(() => (document.querySelector('.details-plus-note') || {}).textContent || '');
check('premium: no plus note on beep details', note1 === '', note1);

// ٤) مستخدم ثانٍ بلا اشتراك: التجربة تمر ثم الجدار.
const s2 = await apiCall('/api/auth/dev', { subject: 'e2e-trial', name: 'تجريبي', client: 'web' }); const token2 = s2.body?.session?.token;
await page.evaluate((t) => { localStorage.setItem('maydan:account:session', JSON.stringify(t)); localStorage.removeItem('maydan:account:me'); localStorage.removeItem('maydan:account:trials'); }, token2);
await reload(); await go('#/game/beep'); await page.waitForTimeout(500);
const note2 = await page.evaluate(() => (document.querySelector('.details-plus-note') || {}).textContent || '');
check('free user: one free match note', /مباراة واحدة مجانية/.test(note2), note2);
await tap('العب'); await page.waitForTimeout(600);
check('first play goes to setup (no paywall)', await page.evaluate(() => !document.querySelector('.paywall') && !!document.querySelector('[aria-label^="إعداد"]')));
// أعلن انتهاء مباراة كما تفعل اللعبة: عبر الخادم مباشرة (نفس ما يفعله markTrial).
const tr = await apiCall('/api/trials/beep', {}, token2); check('POST /api/trials/beep 200', tr.status === 200 && tr.body?.trials?.beep, JSON.stringify(tr.body?.trials));
await reload(); await go('#/game/beep'); await page.waitForTimeout(500);
const note3 = await page.evaluate(() => (document.querySelector('.details-plus-note') || {}).textContent || '');
check('after trial: locked note', /لعبت مباراتك/.test(note3), note3);
await tap('العب'); await page.waitForTimeout(700); await shot('05-trial-paywall');
const pw2 = await page.evaluate(() => { const s = document.querySelector('.paywall'); return { open: !!s, reason: s && s.dataset.reason }; });
check('second play opens paywall reason=trial', pw2.open && pw2.reason === 'trial', JSON.stringify(pw2));
// الرئيسية: شارات.
await page.keyboard.press('Escape'); await go('#/'); await page.waitForTimeout(500); await shot('06-home-badges');
const badges = await page.evaluate(() => [...document.querySelectorAll('.card-badge')].map((b) => b.textContent.trim()));
check('home badges present', badges.length >= 5, JSON.stringify(badges));

// ٥) الغرف: إنشاء غرفة لمستخدم استهلك تجربته → 402؛ وللمشترك 201.
const tf = await apiCall('/api/trials/fabraka', {}, token2);
const room402 = await apiCall('/api/rooms', { ...creds(), game: 'fabraka', name: 'تجريبي' }, token2); check('room create after trial → 402 PLUS_REQUIRED', room402.status === 402 && room402.body?.error === 'PLUS_REQUIRED', JSON.stringify(room402));
const room201 = await apiCall('/api/rooms', { ...creds(), game: 'fabraka', name: 'مختبر' }, token); check('premium room create → 201', room201.status === 201, String(room201.status));
const roomAnon = await apiCall('/api/rooms', { ...creds(), game: 'fabraka', name: 'مجهول' }); check('anon room create allowed', roomAnon.status === 201, String(roomAnon.status));

// ٦) خروج من الإعدادات.
await go('#/settings'); await page.waitForTimeout(500);
const out = await tap('خروج'); check('sign-out button present', out);
await page.waitForTimeout(800); const tokenAfter = await page.evaluate(() => localStorage.getItem('maydan:account:session'));
check('sign-out clears session', tokenAfter === null, String(tokenAfter));
const me401 = await page.evaluate(async ({ API, token2 }) => (await fetch(`${API}/api/me`, { headers: { authorization: `Bearer ${token2}` } })).status, { API, token2 });
check('revoked token → 401', me401 === 401, String(me401));

// ٧) الدخول لا يحول رمز جهاز قديم إلى منحة على الخادم.
await page.evaluate(() => localStorage.setItem('maydan:account:promo', JSON.stringify({ code: 'legacy-public-code', hash: 'legacy-hash', redeemedAt: Date.now() })));
const s3 = await apiCall('/api/auth/dev', { subject: 'e2e-sync', name: 'مزامن', client: 'web' }); const token3 = s3.body?.session?.token;
await page.evaluate((t) => localStorage.setItem('maydan:account:session', JSON.stringify(t)), token3);
await reload(); await page.waitForTimeout(400);
const meSync = await page.evaluate(async () => (await fetch('/api/me', { headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('maydan:account:session')) } })).json());
check('legacy device promo never creates a server grant after sign-in', !meSync.premium.active && meSync.premium.source === null, JSON.stringify(meSync.premium));
check('legacy raw code erased after sign-in', await page.evaluate(() => localStorage.getItem('maydan:account:promo') === null));

// ٨) رمز يعرفه الخادم وحده: ليس في الحزمة، ومع جلسة يُقبل عبر الواجهة نفسها.
await page.evaluate(() => { localStorage.removeItem('maydan:account:promo'); localStorage.removeItem('maydan:account:me'); });
const s4 = await apiCall('/api/auth/dev', { subject: 'e2e-secret', name: 'سرّي', client: 'web' }); const token4 = s4.body?.session?.token;
await page.evaluate((t) => localStorage.setItem('maydan:account:session', JSON.stringify(t)), token4);
await reload(); await go('#/settings'); await page.waitForTimeout(500);
await tap('لديك رمز هدية؟'); await page.waitForTimeout(300);
await page.fill('input[aria-label="رمز الهدية"]', 'wrong-secret');
await page.evaluate(() => [...document.querySelectorAll('.account-redeem button')].find((b) => b.textContent.includes('تفعيل')).click()); await page.waitForTimeout(800);
check('unknown code rejected by server too', await page.evaluate(() => !!document.querySelector('.account-redeem .online-notice.error')));
await page.fill('input[aria-label="رمز الهدية"]', SECRET_CODE.toLowerCase());
await page.evaluate(() => [...document.querySelectorAll('.account-redeem button')].find((b) => b.textContent.includes('تفعيل')).click()); await page.waitForTimeout(1000);
const meSecret = await page.evaluate(async () => (await fetch('/api/me', { headers: { authorization: `Bearer ${JSON.parse(localStorage.getItem('maydan:account:session'))}` } })).json());
check('server-only code redeemed from the UI → premium', meSecret.premium && meSecret.premium.active && meSecret.premium.source === 'promo', JSON.stringify(meSecret.premium));
check('server-only code leaves no device promo', await page.evaluate(() => localStorage.getItem('maydan:account:promo') === null));
c = await lockedCounts(); check('server-only code unlocks packs', c.locked === 0, JSON.stringify(c));


if (errors.length) { console.log('أخطاء الصفحة:'); for (const e of errors) console.log(' -', e.slice(0, 300)); }
const failed = results.filter((r) => !r.ok).length + errors.length; console.log(`${results.length - failed}/${results.length} passed`); fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors, failed }, null, 2));
process.exitCode = failed ? 1 : 0;
} finally {
  if (browser) await browser.close();
  if (web) await new Promise((resolve) => web.close(resolve));
  if (app) await app.close();
}
