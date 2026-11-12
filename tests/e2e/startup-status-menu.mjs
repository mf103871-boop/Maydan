// Real Splash image-loader status beside the real bottom navigation. Only image
// delivery and visualViewport are controlled fixtures; no status markup or CSS
// is substituted. This checks browser hit testing, not an iOS software keyboard.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { escapeInlineScript } from '../../scripts/lib.mjs';

const output = path.resolve(process.env.STARTUP_STATUS_SCREENSHOT_DIR || '.cache/startup-status-menu');
await mkdir(output, { recursive: true });
const result = await build({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{PreviewProviders}from'./src/design/preview-platform.jsx';import{Home}from'./src/platform/screens/Home.jsx';import{Store}from'./src/platform/screens/Store.jsx';import{Settings}from'./src/platform/screens/Settings.jsx';import{Players}from'./src/platform/screens/Players.jsx';import{GameDetails}from'./src/platform/screens/GameDetails.jsx';
import{ProfileScreen}from'./src/profiles/ProfileScreen.jsx';
import{BottomNavigation}from'./src/platform/BottomNavigation.jsx';import{CallViewport}from'./src/social/CallViewport.jsx';
import{Splash}from'./src/platform/screens/Splash.jsx';
import{useRoute}from'./src/platform/router.js';
function App(){const route=useRoute(),[attempt,setAttempt]=useState(0);window.startupFixture={restart:()=>setAttempt(value=>value+1)};const scene=route.name==='settings'?'settings':route.name==='profile'?'profile':route.name==='store'?'store':route.name==='players'?'players':route.name==='game'?'game-details':'home';return <PreviewProviders sceneId={scene}><CallViewport>{scene==='settings'?<Settings/>:scene==='profile'?<ProfileScreen/>:scene==='store'?<Store/>:scene==='players'?<Players/>:scene==='game-details'?<GameDetails id="fabraka"/>:<Home/>}</CallViewport><BottomNavigation route={route}/><Splash key={attempt} visible={false} onDone={()=>{}} reducedMotion/></PreviewProviders>}
createRoot(document.getElementById('root')).render(<App/>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, outdir: output, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'file', '.woff2': 'dataurl', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
// Shell artwork is now imported by Splash. Keep real file URLs in this in-memory
// bundle so its real image loader reaches the isolated server's 503 response.
const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><div id="root"></div><script>${escapeInlineScript(result.outputFiles.find(file => file.path.endsWith('.js')).text)}</script></html>`;
let imageRequests = 0, activePage, heldImageResponses = null;
const failImage = response => { response.writeHead(503, { 'content-type': 'text/plain' }); response.end('Isolated image failure'); };
const server = http.createServer((request, response) => {
  if (new URL(request.url, 'http://fixture').pathname === '/') { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html); }
  else { imageRequests += 1; if (heldImageResponses) heldImageResponses.push(response); else failImage(response); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { productionContacted: false, views: [], pageErrors: [] };
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function centerHits(locator) {
  return locator.evaluate(el => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { width: r.width, height: r.height, hit: hit === el || el.contains(hit) }; });
}
async function checkAboveMenu(page) { report.stage = 'above-menu:' + await page.evaluate(() => location.hash);
  await page.waitForFunction(() => { const status = document.querySelector('.startup-background')?.getBoundingClientRect(), menu = document.querySelector('.menu-navigation')?.getBoundingClientRect(); return status && menu && status.bottom <= menu.top - 7 && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--startup-background-space')) >= status.height + 7; });
  const geometry = await page.evaluate(() => ({ status: document.querySelector('.startup-background').getBoundingClientRect().toJSON(), menu: document.querySelector('.menu-navigation').getBoundingClientRect().toJSON(), menuSpace: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--menu-nav-space')), statusSpace: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--startup-background-space')), overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
  assert.ok(Math.abs(geometry.menu.height - geometry.menuSpace) < 1); assert.equal(geometry.overflow, false); return geometry;
}
try {
  for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const [width, height] of [[320,568], [390,844], [844,390]]) {
        const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
        const page = await context.newPage(); activePage = page; page.setDefaultTimeout(15000); page.on('pageerror', error => report.pageErrors.push({ engine: engineName, message: error.message }));
        await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        await page.addInitScript(() => {
          const viewport = Object.assign(new EventTarget(), { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1 });
          Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
          window.setStatusViewport = values => { Object.assign(viewport, values); viewport.dispatchEvent(new Event('resize')); };
        });
        await page.goto(origin + '/#/');
        const status = page.locator('.startup-background'), retry = status.getByRole('button', { name: 'إعادة المحاولة', exact: true }), close = status.getByRole('button', { name: 'إخفاء حالة الصور', exact: true });
        await retry.waitFor(); const geometry = await checkAboveMenu(page), retryHit = await centerHits(retry), closeHit = await centerHits(close);
        assert.ok(retryHit.width >= 44 && retryHit.height >= 44 && retryHit.hit); assert.ok(closeHit.width >= 44 && closeHit.height >= 44 && closeHit.hit);
        const requestsBefore = imageRequests, routeBefore = await page.evaluate(() => location.hash);
        // Hold the real retry responses until its loading phase is observed;
        // immediate loopback failures otherwise collapse that phase between frames.
        heldImageResponses = []; report.stage = 'retry-loading';
        try {
          const nextImageRequest = page.waitForRequest(request => new URL(request.url()).origin === origin && new URL(request.url()).pathname.endsWith('.webp'));
          await retry.click(); await nextImageRequest;
          await page.waitForFunction(() => { const status = document.querySelector('.startup-background'); return status && !status.innerText.includes('إعادة المحاولة'); });
        } finally { const responses = heldImageResponses; heldImageResponses = null; responses.forEach(failImage); }
        await retry.waitFor();
        assert.ok(imageRequests > requestsBefore, 'Retry starts the real image loader again'); assert.equal(await page.evaluate(() => location.hash), routeBefore, 'Retry never selects the underlying Store tab');
        const menu = page.getByTestId('menu-navigation');
        assert.deepEqual(await menu.getByRole('link').evaluateAll(links => links.map(link => link.lastElementChild.textContent)), ['العب', 'الأصدقاء', 'المتجر', 'أنا'], 'the real menu exposes only the four approved destinations');
        await menu.getByRole('link', { name: 'المتجر', exact: true }).click(); await page.waitForFunction(() => location.hash === '#/store'); await checkAboveMenu(page);
        await page.evaluate(() => { location.hash = '#/game/fabraka'; }); await page.locator('.setup-sticky').waitFor(); await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await settle(page); const sticky = await page.locator('.setup-sticky').boundingBox(), banner = await status.boundingBox(); assert.ok(sticky.y + sticky.height <= banner.y - 7, 'sticky game actions remain above the measured status');
        await page.evaluate(() => { location.hash = '#/players'; }); await page.getByRole('button', { name: 'إضافة لاعب', exact: true }).click(); await page.getByRole('textbox', { name: 'اسم اللاعب', exact: true }).waitFor();
        const input = page.getByRole('textbox', { name: 'اسم اللاعب', exact: true }); await input.focus(); await page.evaluate(value => window.setStatusViewport({ height: Math.max(130, value - 180) }), height); await settle(page);
        assert.equal(await status.isVisible(), false, 'background status does not cover typing in the real player editor'); assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--startup-background-space')) || 0), 0); assert.equal(await menu.isVisible(), false, 'real navigation remains hidden during modal typing');
        await input.fill('تجربة'); assert.equal(await input.inputValue(), 'تجربة'); await input.evaluate(el => el.blur()); await page.evaluate(value => window.setStatusViewport({ height: value }), height);
        await page.getByRole('dialog', { name: 'إضافة لاعب', exact: true }).getByRole('button', { name: 'إلغاء', exact: true }).click(); await menu.waitFor(); await retry.waitFor(); await checkAboveMenu(page);
        // A real pointer click must survive the input-to-submit focus handoff:
        // the reserved notice height cannot change underneath the send button.
        await page.evaluate(() => {const form=document.createElement('form');form.id='notice-focus-probe';form.style.cssText='position:fixed;left:8px;bottom:calc(var(--startup-background-space,0px) + var(--menu-nav-space,0px) + 12px);z-index:120;display:flex;gap:4px';const input=document.createElement('input');input.setAttribute('aria-label','رسالة فحص التركيز');input.style.cssText='width:140px;font-size:16px;height:44px';const button=document.createElement('button');button.type='submit';button.textContent='إرسال الفحص';button.style.cssText='min-width:70px;height:44px';form.append(input,button);window.focusProbeSubmits=0;form.addEventListener('submit',event=>{event.preventDefault();window.focusProbeSubmits++;window.focusProbeNoticeVisible=getComputedStyle(document.querySelector('.startup-background')).visibility!=='hidden';window.focusProbeReserve=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--startup-background-space'))||0;});document.body.appendChild(form);});
        await page.getByRole('textbox',{name:'رسالة فحص التركيز'}).fill('نقرة واحدة');
        // The player editor is now a modal; independently exercise keyboard-only
        // suppression in this existing focus probe with no modal present.
        assert.equal(await page.getByRole('dialog').count(), 0);
        await page.evaluate(value => window.setStatusViewport({ height: Math.max(130, value - 180) }), height); await settle(page);
        assert.equal(await status.isVisible(), false, 'background status does not cover non-modal typing'); assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--startup-background-space')) || 0), 0); assert.equal(await menu.isVisible(), false, 'real navigation recognizes the keyboard viewport independently of a modal');
        await page.evaluate(value => window.setStatusViewport({ height: value }), height); await menu.waitFor();
        await page.getByRole('button',{name:'إرسال الفحص',exact:true}).click();
        assert.equal(await page.evaluate(()=>window.focusProbeSubmits),1,'one physical click submits once after input focus');assert.equal(await page.evaluate(()=>window.focusProbeNoticeVisible),false,'the notice stays suppressed during the actual form submit');assert.equal(await page.evaluate(()=>window.focusProbeReserve),0,'reserved geometry stays stable until submission');
        await page.evaluate(()=>document.getElementById('notice-focus-probe').remove());await retry.waitFor();await checkAboveMenu(page);
        await menu.getByRole('link', { name: 'أنا', exact: true }).click(); await page.waitForFunction(() => location.hash === '#/profile');
        const profileSettings = page.locator('[data-design-id="profile-settings"]'); await profileSettings.waitFor(); await checkAboveMenu(page); await profileSettings.click(); await page.waitForFunction(() => location.hash === '#/settings');
        await page.getByRole('button', { name: 'الحساب والخصوصية', exact: true }).click(); await page.waitForFunction(() => location.hash === '#/settings?section=account');
        const openDialog = page.getByRole('button', { name: 'مسح كل البيانات', exact: true }); await openDialog.evaluate(el => el.scrollIntoView({ block: 'center' })); await openDialog.click();
        report.stage = 'modal-hidden-reserve'; const dialog = page.getByRole('dialog', { name: 'مسح بيانات هذا الجهاز؟', exact: true }); await dialog.waitFor(); await page.waitForFunction(() => getComputedStyle(document.querySelector('.startup-background')).visibility === 'hidden' && parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--startup-background-space')) === 0); assert.equal(await status.isVisible(), false, 'real dialog suppresses background image controls'); await menu.waitFor({state:'hidden'}); assert.equal(await menu.isVisible(), false);
        const cancel = dialog.getByRole('button', { name: 'إلغاء', exact: true }); assert.equal((await centerHits(cancel)).hit, true); await cancel.click(); await dialog.waitFor({ state: 'hidden' }); await menu.waitFor(); await retry.waitFor(); await checkAboveMenu(page);
        await openDialog.evaluate(el => el.scrollIntoView({ block: 'center' })); await settle(page); assert.equal((await centerHits(openDialog)).hit, true, 'clear-data action remains reachable after dismissing its dialog');
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await settle(page); const returnToSettings = page.getByRole('button', { name: 'العودة إلى الإعدادات', exact: true }); assert.equal((await centerHits(returnToSettings)).hit, true, 'last Settings action is reachable above the status at scroll end');
        await page.screenshot({ path: path.join(output, `${engineName}-${width}x${height}.png`) });
        const beforeClose = await page.evaluate(() => location.hash); await close.click(); await status.waitFor({ state: 'detached' }); assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--startup-background-space')) || 0), 0); assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-startup-background-visible')), false); assert.equal(await page.evaluate(() => location.hash), beforeClose, 'Close never selects any tab');
        await returnToSettings.click(); await page.waitForFunction(() => location.hash === '#/settings'); await page.locator('[data-design-id="back"]').click(); await page.waitForFunction(() => location.hash === '#/profile');
        await menu.getByRole('link', { name: 'العب', exact: true }).click(); await page.waitForFunction(() => location.hash === '#/');
        report.views.push({ engine: engineName, width, height, retryHit, closeHit, geometry, realRetryRequestedImages: true, keyboardAndDialogPass: true, menuAccessible: true, profileSettingsAndBackPass: true, passed: true }); await context.close();
      }
    } catch (error) { report.debug = await activePage.evaluate(() => ({ hash:location.hash, hasDialog:document.documentElement.matches('html:has([role=dialog][aria-modal=true])'), root:document.documentElement.getAttribute('style'), visible:document.documentElement.hasAttribute('data-startup-background-visible'), status:document.querySelector('.startup-background')?.getBoundingClientRect().toJSON(), statusVisibility:document.querySelector('.startup-background')?getComputedStyle(document.querySelector('.startup-background')).visibility:null, menu:document.querySelector('.menu-navigation')?.getBoundingClientRect().toJSON() })).catch(()=>null); await activePage.screenshot({path:path.join(output,'failure.png')}).catch(()=>{}); throw error; } finally { await browser.close(); }
  }
  assert.equal(report.pageErrors.length, 0); report.passed = true;
} catch (error) { report.passed = false; report.failure = error.message; if (activePage && !activePage.isClosed()) { report.debug = await activePage.evaluate(() => ({ hasDialog: document.documentElement.matches('html:has([role=dialog][aria-modal=true])'), status: getComputedStyle(document.querySelector('.startup-background')).visibility, dialogs: [...document.querySelectorAll('[role=dialog]')].map(el=>el.outerHTML.slice(0,300)) })).catch(()=>null); await activePage.screenshot({ path:path.join(output,'failure.png') }).catch(()=>{}); } process.exitCode = 1; }
finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ passed: report.passed, views: report.views.length, pageErrors: report.pageErrors, failure: report.failure }));
