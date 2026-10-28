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
// بعد تعديل المنح/التجارب مباشرةً على خادم الاختبار نحذف نسخته المحلية من
// /api/me قبل إعادة التحميل، ثم نفحص حالة الحساب المعروضة فعلًا.
const API_PORT = Number(process.env.E2E_API_PORT || 8790); const WEB_PORT = Number(process.env.E2E_PORT || 3000);
// كما في النشر الكامل على Cloudflare: الـAPI على أصل الصفحة نفسه (خادم الصفحة يمرّر /api و/health).
process.env.MAYDAN_ROOMS_URL = 'same-origin';
import { build as esbuildBuild } from 'esbuild';
import { esbuildOptions, renderHtml, readPkg, mediaVersions } from '../lib.mjs';
import { startLocalServer } from '../../server/local.mjs';
import { environmentStorageKey } from '../../src/shared/lib/environment.js';
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
// same-origin builds scope account data to their served origin. Seed/clear
// the local test account, never the unrelated production storage keys.
const accountKey = (name) => environmentStorageKey(`maydan:account:${name}`, `http://localhost:${WEB_PORT}`);
const readAccount = (name) => page.evaluate((key) => localStorage.getItem(key), accountKey(name));
const writeAccount = (name, value) => page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: accountKey(name), value });
const clearAccount = (...names) => page.evaluate((keys) => keys.forEach((key) => localStorage.removeItem(key)), names.map(accountKey));
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/unsupported MIME type|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const results = []; const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
const go = async (h, ms = 900) => {
  // A raw hash change is browser Back while inside a game: it deliberately
  // consumes the game's internal step first. Leave through the actual platform
  // control and its confirmation before asking for a different destination.
  if (await page.locator('.game-frame').count() && await page.evaluate(() => location.hash) !== h) {
    await page.getByRole('button', { name: 'العودة إلى المنصة', exact: true }).click();
    const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'الخروج من اللعبة؟', exact: true }) });
    if (await confirm.count()) await confirm.getByRole('button', { name: 'خروج', exact: true }).click();
    await page.locator('.game-frame').waitFor({ state: 'detached' });
  }
  await page.evaluate((x) => { location.hash = x; }, h);
  await page.waitForFunction((target) => location.hash === target, h);
  if (ms) await page.waitForTimeout(ms);
};
const tap = async (t) => { const ok = await page.evaluate((x) => { const el = [...document.querySelectorAll('button')].find((b) => !b.disabled && b.offsetParent !== null && (b.textContent || '').includes(x)); if (!el) return false; el.click(); return true; }, t); await page.waitForTimeout(400); return ok; };
const lockedCounts = async () => {
  // الخروج من شاشة اللعب يمر بحارس الخروج (استعادة ثم رجوع خطوة)، فمدته متغيرة: ننتظر
  // شاشة التفاصيل وزرها فعلًا بدل مهلة ثابتة.
  await go('#/game/badeeha', 0);
  await page.waitForFunction(() => location.hash === '#/game/badeeha'
    && [...document.querySelectorAll('button')].some((b) => !b.disabled && b.offsetParent !== null && b.textContent.trim() === 'العب على جهاز واحد'));
  await tap('العب على جهاز واحد'); await page.waitForSelector('.m-home');
  await page.evaluate(() => document.querySelector('.m-hero-cta').click()); await page.waitForSelector('.m-category-pick'); await page.waitForTimeout(500);
  return page.evaluate(() => ({ locked: document.querySelectorAll('.m-category-pick.is-locked').length, total: document.querySelectorAll('.m-category-pick').length }));
};
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const creds = () => ({ id: hex(16), token: hex(32), avatar: 0, rounds: 6 });
const apiCall = (p, body, token) => page.evaluate(async ({ API, p, body, token }) => {
  const r = await fetch(`${API}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, { API, p, body, token });
// شاشة البداية لا تُغلق بالنقر عليها: تنتظر الصور حتى ثلاث ثوانٍ أو زر «الدخول بالصور المتاحة».
// النقر على `.splash` نفسها كان ينجح مصادفةً حين تجهز الصور قبل أول خطوة، ويفشل حين تتأخر.
// الشاشات لا تُركَّب قبل انتهاء البداية، فالانتظار على أول شاشة لا على غياب `.splash`
// (قد لا تكون رُسمت بعد لحظة حدث load).
const enter = () => page.waitForFunction(() => {
  const splash = document.querySelector('.splash');
  const button = splash && [...splash.querySelectorAll('button')].find((b) => !b.disabled && b.textContent.includes('الدخول بالصور المتاحة'));
  if (button) button.click();
  return !splash && !!document.querySelector('[data-design-screen]');
}, null, { timeout: 15_000, polling: 200 });
const reload = async () => { await clearAccount('me'); await page.reload({ waitUntil: 'load' }); await enter(); await page.waitForTimeout(300); };

await page.goto(`http://localhost:${WEB_PORT}/#/`, { waitUntil: 'load' }); await page.waitForTimeout(700);
await enter(); await page.waitForTimeout(300);

// ١) كل الفئات مجانية؛ عرض بلس من الإعدادات يخص التخصيص فقط.
let c = await lockedCounts(); check('anon all 78 packs free', c.locked === 0 && c.total === 78, JSON.stringify(c));
await go('#/settings'); await page.locator('[data-design-id="purchase"]').click(); await page.waitForTimeout(600); await shot('01-anon-paywall');
const pw = await page.evaluate(() => { const s = document.querySelector('.paywall'); return { open: !!s, reason: s && s.dataset.reason, text: s ? s.textContent : '' }; });
check('optional cosmetics paywall opens from settings', pw.open && pw.reason === 'settings', pw.reason);
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
await go('#/settings'); await page.locator('[data-design-id="purchase"]').click(); await page.waitForTimeout(600);
check('reopened paywall starts on plans', await page.evaluate(() => !!document.querySelector('.paywall .paywall-plans') && !document.querySelector('.paywall form')));
await page.evaluate(() => document.querySelector('.paywall-redeem').click()); await page.waitForTimeout(300);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await writeAccount('promo', { code: 'legacy-public-code', hash: 'legacy-hash', redeemedAt: Date.now() });
await reload();
c = await lockedCounts(); check('legacy local promo leaves already free packs accessible', c.locked === 0, JSON.stringify(c));
check('legacy raw gift code removed from storage', await readAccount('promo') === null);

// ٢) دخول وهمي عبر الخادم ثم حقن الجلسة.
const signin = await apiCall('/api/auth/dev', { subject: 'e2e-user', name: 'مختبر', client: 'web' });
check('dev sign-in 200', signin.status === 200 && !!signin.body?.session?.token, String(signin.status));
const token = signin.body?.session?.token;
await writeAccount('session', token);
await reload();
await go('#/settings'); await page.waitForTimeout(800); await shot('02-settings-signed-in');
const settingsName = await page.locator('.account-identity b').innerText();
check('settings shows user name', settingsName === 'مختبر');
c = await lockedCounts(); check('signed-in free has no locked packs', c.locked === 0, JSON.stringify(c));
// ٣) منح اشتراك → صفر مقفول، وتفاصيل اللعبة بلا ملاحظة.
const grant = await apiCall('/api/dev/grant', { until: Date.now() + 30 * 86400e3, product: 'plus.yearly' }, token);
check('dev grant 200 premium', grant.status === 200 && grant.body?.premium?.active === true, JSON.stringify(grant.body?.premium));
await reload();
c = await lockedCounts(); check('premium locked 0', c.locked === 0, JSON.stringify(c)); await shot('03-premium-picker');
await go('#/settings'); await page.waitForTimeout(600); await shot('04-settings-premium');
const st2 = await page.locator('.account-plan.is-plus').innerText(); check('settings shows plus active', /بلس فعّال/.test(st2));
await go('#/game/beep'); const note1 = await page.evaluate(() => (document.querySelector('.details-plus-note') || {}).textContent || '');
check('premium: same free gameplay note', /مجانية|مجانًا/.test(note1), note1);

// ٤) مستخدم ثانٍ بلا اشتراك: اللعب مجاني حتى بعد استدعاء واجهة التجربة القديمة.
const s2 = await apiCall('/api/auth/dev', { subject: 'e2e-trial', name: 'تجريبي', client: 'web' }); const token2 = s2.body?.session?.token;
await writeAccount('session', token2); await clearAccount('me', 'trials');
await reload(); await go('#/game/beep'); await page.waitForTimeout(500);
const note2 = await page.evaluate(() => (document.querySelector('.details-plus-note') || {}).textContent || '');
check('free user: all gameplay free note', /مجانية|مجانًا/.test(note2), note2);
await tap('العب'); await page.waitForTimeout(600);
check('first play goes to setup (no paywall)', await page.evaluate(() => !document.querySelector('.paywall') && !!document.querySelector('[aria-label^="إعداد"]')));
// الواجهة القديمة لا تستهلك تجربة جديدة، و markTrial لم يعد يرسلها.
const tr = await apiCall('/api/trials/beep', {}, token2); check('legacy trial endpoint does not charge play', tr.status === 200 && !tr.body?.trials?.beep, JSON.stringify(tr.body?.trials));
await reload(); await go('#/game/beep'); await page.waitForTimeout(500);
const note3 = await page.evaluate(() => (document.querySelector('.details-plus-note') || {}).textContent || '');
check('after legacy trial request: still free', /مجانية|مجانًا/.test(note3), note3);
await tap('العب'); await page.waitForTimeout(700); await shot('05-trial-paywall');
const pw2 = await page.evaluate(() => { const s = document.querySelector('.paywall'); return { open: !!s, reason: s && s.dataset.reason }; });
check('repeat play has no paywall', !pw2.open, JSON.stringify(pw2));
// الرئيسية: شارات.
// الحوار يبقى مسجّلًا كطبقة رجوع طوال حركة الإغلاق، فتغيير العنوان يدويًا خلالها يُعامَل
// كرجوع يغلق الحوار؛ ننتظر خروجه قبل الانتقال كما يفعل اللاعب.
await go('#/'); await page.waitForTimeout(500); await shot('06-home-badges');
const badges = await page.evaluate(() => [...document.querySelectorAll('.card-badge')].map((b) => b.textContent.trim()));
check('home badges present', badges.length >= 5, JSON.stringify(badges));

// ٥) إنشاء الغرف مجاني لغير المشترك والمشترك وفق متطلبات الهوية الحالية.
const tf = await apiCall('/api/trials/fabraka', {}, token2);
const room402 = await apiCall('/api/rooms', { ...creds(), game: 'fabraka', name: 'تجريبي' }, token2); check('room create after legacy trial request stays free', room402.status === 201, JSON.stringify(room402));
const room201 = await apiCall('/api/rooms', { ...creds(), game: 'fabraka', name: 'مختبر' }, token); check('premium room create → 201', room201.status === 201, String(room201.status));
const roomAnon = await apiCall('/api/rooms', { ...creds(), game: 'fabraka', name: 'مجهول' }); check('anon room create allowed', roomAnon.status === 201, String(roomAnon.status));

// ٦) خروج من الإعدادات.
await go('#/settings');
const signoutButton = page.locator('[data-design-id="account-signout"]');
check('sign-out button present', await signoutButton.isVisible());
await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/auth/signout') && response.request().method() === 'POST'), signoutButton.click()]);
await signoutButton.waitFor({ state: 'detached' });
const tokenAfter = await readAccount('session');
check('sign-out clears session', tokenAfter === null, String(tokenAfter));
const me401 = await page.evaluate(async ({ API, token2 }) => (await fetch(`${API}/api/me`, { headers: { authorization: `Bearer ${token2}` } })).status, { API, token2 });
check('revoked token → 401', me401 === 401, String(me401));

// ٧) الدخول لا يحول رمز جهاز قديم إلى منحة على الخادم.
await writeAccount('promo', { code: 'legacy-public-code', hash: 'legacy-hash', redeemedAt: Date.now() });
const s3 = await apiCall('/api/auth/dev', { subject: 'e2e-sync', name: 'مزامن', client: 'web' }); const token3 = s3.body?.session?.token;
await writeAccount('session', token3);
await reload(); await page.waitForTimeout(400);
const meSync = await page.evaluate(async (key) => (await fetch('/api/me', { headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem(key)) } })).json(), accountKey('session'));
check('legacy device promo never creates a server grant after sign-in', !meSync.premium.active && meSync.premium.source === null, JSON.stringify(meSync.premium));
check('legacy raw code erased after sign-in', await readAccount('promo') === null);

// ٨) رمز يعرفه الخادم وحده: ليس في الحزمة، ومع جلسة يُقبل عبر الواجهة نفسها.
await clearAccount('promo', 'me');
const s4 = await apiCall('/api/auth/dev', { subject: 'e2e-secret', name: 'سرّي', client: 'web' }); const token4 = s4.body?.session?.token;
await writeAccount('session', token4);
await reload(); await go('#/settings'); await page.waitForTimeout(500);
await tap('لديك رمز هدية؟'); await page.waitForTimeout(300);
await page.fill('input[aria-label="رمز الهدية"]', 'wrong-secret');
await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/redeem') && response.request().method() === 'POST'), page.locator('.account-redeem').getByRole('button', { name: 'تفعيل', exact: true }).click()]);
await page.locator('.account-redeem .online-notice.error').waitFor();
check('unknown code rejected by server too', await page.evaluate(() => !!document.querySelector('.account-redeem .online-notice.error')));
await page.fill('input[aria-label="رمز الهدية"]', SECRET_CODE.toLowerCase());
await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/redeem') && response.request().method() === 'POST'), page.locator('.account-redeem').getByRole('button', { name: 'تفعيل', exact: true }).click()]);
await page.locator('.account-redeem').waitFor({ state: 'detached' });
await page.locator('.account-plan.is-plus').waitFor();
const meSecret = await page.evaluate(async (key) => (await fetch('/api/me', { headers: { authorization: `Bearer ${JSON.parse(localStorage.getItem(key))}` } })).json(), accountKey('session'));
check('server-only code redeemed from the UI → premium', meSecret.premium && meSecret.premium.active && meSecret.premium.source === 'promo', JSON.stringify(meSecret.premium));
check('server-only code leaves no device promo', await readAccount('promo') === null);
c = await lockedCounts(); check('server-only code unlocks packs', c.locked === 0, JSON.stringify(c));


if (errors.length) { console.log('أخطاء الصفحة:'); for (const e of errors) console.log(' -', e.slice(0, 300)); }
const failed = results.filter((r) => !r.ok).length + errors.length; console.log(`${results.length - failed}/${results.length} passed`); fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors, failed }, null, 2));
process.exitCode = failed ? 1 : 0;
} finally {
  if (browser) await browser.close();
  if (web) await new Promise((resolve) => web.close(resolve));
  if (app) await app.close();
}
