// Run after: node scripts/build-cloudflare.mjs (the fixture requires a same-origin build).
// Two independent browser accounts against the real Worker, D1 and WebSockets.
// AUTH_DEV_FAKE exists only inside this temporary local runtime.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { chromium } from 'playwright';
import { migrationSql } from '../../server/local-d1.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'maydan-social-e2e-'));
const evidence = path.resolve('.wrangler/social-e2e'); await mkdir(evidence, { recursive: true });
let mf, browser;
const errors = [];
const readTrace = [];
const socketTrace = [];
try {
  const scriptPath = path.join(temporary, 'worker.mjs');
  await build({ entryPoints: ['server/full-worker.mjs'], bundle: true, format: 'esm', platform: 'browser', outfile: scriptPath, logLevel: 'silent' });
  mf = new Miniflare(convertV4MiniflareOptions({ rootPath: temporary, name: 'social-e2e', modules: true, scriptPath,
    compatibilityDate: '2026-09-01', port: 0, host: '127.0.0.1', cf: false,
    durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true }, SOCIAL_HUB: { className: 'SocialHub', useSQLite: true } },
    d1Databases: { DB: 'social-e2e' }, bindings: { AUTH_DEV_FAKE: '1', SESSION_SECRET: 'local-social-e2e-only' },
    assets: { directory: path.resolve('dist'), binding: 'ASSETS', assetConfig: { not_found_handling: 'single-page-application' }, routerConfig: { has_user_worker: true }, run_worker_first: ['/api', '/api/*', '/health'] },
  }));
  const origin = (await mf.ready).origin;
  const database = await mf.getD1Database('DB'); await database.exec(migrationSql());
  async function api(user, endpoint, method = 'GET', body) {
    const response = await fetch(origin+endpoint, { method, headers: { origin, ...(user ? { authorization: `Bearer ${user.session.token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); assert.equal(response.ok, true, JSON.stringify(data)); return data;
  }
  const alice = await api(null, '/api/auth/dev', 'POST', { subject: 'social-e2e-alice', name: 'ليان' });
  const bob = await api(null, '/api/auth/dev', 'POST', { subject: 'social-e2e-bob', name: 'عمر' });
  const bobProfile = await api(bob, '/api/social/me');
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
  async function pageFor(user, viewport) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await context.addInitScript(user => {
      localStorage.setItem('maydan:account:session',JSON.stringify(user.session.token));
      localStorage.setItem('maydan:account:me',JSON.stringify({data:user.me,fetchedAt:Date.now()}));
    }, user);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    let readyResolve;
    const socketReady = new Promise(resolve => { readyResolve = resolve; });
    const view = viewport.width < 760 ? 'mobile' : 'desktop';
    page.on('websocket', socket => {
      if (new URL(socket.url()).pathname !== '/api/social/socket') return;
      const record = (direction, frame) => {
        let data; try { data = JSON.parse(String(frame.payload)); } catch { return; }
        if (data.type === 'ready') readyResolve();
        if (!['ready', 'typing', 'error'].includes(data.type)) return;
        socketTrace.push({ view, direction, at: Date.now(), type: data.type, ...(typeof data.active === 'boolean' ? { active: data.active } : {}), ...(data.error ? { error: data.error } : {}) });
        if (socketTrace.length > 60) socketTrace.shift();
      };
      socket.on('framesent', frame => record('sent', frame));
      socket.on('framereceived', frame => record('received', frame));
      socket.on('close', () => { socketTrace.push({ view, at: Date.now(), type: 'closed' }); });
    });
    const startupRequests = [];
    page.on('response', response => { const endpoint = new URL(response.url()).pathname; if (endpoint.startsWith('/api/')) startupRequests.push({ endpoint, status: response.status() }); });
    page.on('response', response => {
      const endpoint = new URL(response.url()).pathname;
      if (!/\/api\/social\/conversations(?:\/[^/]+\/(?:messages|read))?$/.test(endpoint)) return;
      const entry = { view: viewport.width < 760 ? 'mobile' : 'desktop', method: response.request().method(), endpoint, status: response.status() };
      readTrace.push(entry); if (readTrace.length > 60) readTrace.shift();
      response.json().then(data => {
        if (data.readSeq != null) entry.readSeq = data.readSeq;
        if (data.peerReadSeq != null) entry.peerReadSeq = data.peerReadSeq;
      }).catch(() => {});
    });
    await page.goto(origin+'/#/friends', { waitUntil: 'domcontentloaded' });
    try { await page.locator('.social-code-card strong').filter({ hasText: /MDN-/ }).waitFor({ timeout: 30000 }); }
    catch (error) {
      await page.screenshot({ path: path.join(evidence, 'startup-failure.png'), fullPage: true });
      console.error(JSON.stringify({ startup: await page.evaluate(() => ({ path: location.hash, visibility: document.visibilityState, text: document.body.innerText.slice(0, 1600) })), requests: startupRequests }));
      throw error;
    }
    let readyTimer;
    try {
      await Promise.race([socketReady, new Promise((_, reject) => { readyTimer = setTimeout(() => reject(new Error(view + ': social socket did not receive ready')), 10000); })]);
    } finally { clearTimeout(readyTimer); }
    return page;
  }
  const a = await pageFor(alice, { width: 390, height: 844 });
  const b = await pageFor(bob, { width: 1280, height: 900 });
  await a.getByRole('button', {name:'إضافة صديق',exact:true}).click();
  await a.getByLabel('ابحث بالاسم أو رمز الصديق').fill(bobProfile.user.code);
  await a.getByRole('button', {name:'إضافة',exact:true}).click();
  await a.getByText('تم إرسال الطلب',{exact:true}).waitFor();
  await a.getByRole('dialog').getByRole('button',{name:/إغلاق/}).click();
  await b.getByRole('tab',{name:/الطلبات/}).click();
  await b.getByRole('button',{name:'قبول الطلب',exact:true}).click({ timeout: 10000 });
  await b.getByRole('tab',{name:/الأصدقاء/}).click();
  await a.getByRole('button',{name:'فتح محادثة عمر',exact:true}).click({ timeout: 10000 });
  await a.getByLabel('اكتب رسالة').fill('أهلًا عمر، جاهز لميدان؟');
  await a.getByRole('button',{name:'إرسال الرسالة',exact:true}).click();
  await b.locator('.social-person-row .social-badge').waitFor({ timeout: 10000 });
  const bobRead = b.waitForResponse(response => response.request().method() === 'POST' && /\/api\/social\/conversations\/[^/]+\/read$/.test(new URL(response.url()).pathname), { timeout: 10000 })
    .then(async response => ({ status: response.status(), data: await response.json() })).catch(error => ({ error: error.message }));
  await b.getByRole('button',{name:'فتح محادثة ليان',exact:true}).click();
  await b.locator('.social-message').getByText('أهلًا عمر، جاهز لميدان؟',{exact:true}).waitFor();
  const readResult = await bobRead;
  assert.equal(readResult.status, 200, 'Opening the visible recipient chat must acknowledge reading: '+JSON.stringify(readResult));
  assert.ok(readResult.data.readSeq > 0, 'Read acknowledgement must cover the received message');
  await a.locator('.social-delivery[aria-label="قُرئت"]').waitFor({ timeout: 10000 });
  await a.getByLabel('اكتب رسالة').fill('موعدنا بعد قليل');
  await b.locator('.social-typing').waitFor({ timeout: 5000 });
  await a.getByLabel('اكتب رسالة').fill('');
  await a.locator('.social-message').getByRole('button',{name:'خيارات رسالتك'}).click();
  await a.getByRole('button',{name:'تعديل',exact:true}).click();
  await a.getByRole('dialog').locator('textarea').fill('أهلًا عمر، نبدأ الجولة بعد خمس دقائق؟');
  await a.getByRole('button',{name:'حفظ التعديل',exact:true}).click();
  await b.locator('.social-message').getByText('أهلًا عمر، نبدأ الجولة بعد خمس دقائق؟',{exact:true}).waitFor();
  await b.getByLabel('اكتب رسالة').fill('جاهز! نختار العلوم والتاريخ 🎮');
  await b.getByRole('button',{name:'إرسال الرسالة',exact:true}).click();
  await a.locator('.social-message').getByText('جاهز! نختار العلوم والتاريخ 🎮',{exact:true}).waitFor();
  await a.screenshot({ path: path.join(evidence,'conversation-mobile.png'), fullPage:true });
  await b.screenshot({ path: path.join(evidence,'conversation-desktop.png'), fullPage:true });
  assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,'mobile overflow');
  assert.equal(await b.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,'desktop overflow');
  await a.locator('.social-message.is-mine').getByRole('button',{name:'خيارات رسالتك'}).click();
  await a.getByRole('button',{name:'حذف',exact:true}).click();
  await a.getByRole('button',{name:'حذف الرسالة',exact:true}).click();
  await b.getByText('حُذفت هذه الرسالة',{exact:true}).waitFor();
  await a.reload({ waitUntil:'domcontentloaded' });
  await a.getByText('حُذفت هذه الرسالة',{exact:true}).waitFor({timeout:30000});
  await a.locator('.social-chat-head').getByRole('button',{name:/خيارات/}).click();
  await a.getByRole('button',{name:'حظر',exact:true}).click();
  await a.getByRole('dialog').getByRole('button',{name:'حظر',exact:true}).click();
  await b.getByRole('heading',{name:'هذه المحادثة غير متاحة'}).waitFor({timeout:10000});
  await a.getByRole('button',{name:/المحظورون/}).click();
  await a.getByRole('button',{name:'إلغاء الحظر',exact:true}).click();
  await a.getByRole('dialog').getByRole('button',{name:'إلغاء الحظر',exact:true}).click();
  await a.getByText('أُلغي الحظر',{exact:true}).waitFor({timeout:5000});
  const blocks=await api(alice,'/api/social/blocks'); assert.equal(blocks.users.length,0);
  assert.deepEqual(socketTrace.filter(event => event.type === 'error'), [], 'Normal chat actions must not hit socket limits');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(evidence, 'realtime-trace.json'), JSON.stringify({ readTrace, socketTrace }, null, 2)+'\n');
  console.log(JSON.stringify({ok:true,checks:['request','accept','unread','read-receipt','typing','edit','reply','delete','reload-history','block','unblock','mobile-layout','desktop-layout'],evidence}));
} catch (error) {
  console.error(JSON.stringify({ socialReadTrace: readTrace, socialSocketTrace: socketTrace, browserErrors: errors }));
  await writeFile(path.join(evidence, 'realtime-trace.json'), JSON.stringify({ ok: false, readTrace, socketTrace, browserErrors: errors }, null, 2)+'\n').catch(() => {});
  throw error;
} finally {
  await browser?.close(); await mf?.dispose(); await rm(temporary,{recursive:true,force:true});
}
