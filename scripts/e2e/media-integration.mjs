// Media integration against the real bank and assets, isolated in a local mock
// Plus account server. No production files/accounts/payments are changed.
// CHROMIUM_PATH=... node scripts/e2e/media-integration.mjs [output-dir]
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { esbuildOptions, renderHtml, readPkg, mediaVersions, ROOT } from '../lib.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maydan-e2e', 'media-integration'));
await fs.mkdir(OUT, { recursive: true });
const pkg = await readPkg();
const options = esbuildOptions({ minify: true, version: pkg.version, media: await mediaVersions() });
options.define.__MAYDAN_ROOMS_URL__ = JSON.stringify('same-origin');
// Exercise the current curated bank without filtering out its silhouette images.
const bundle = await build(options);
const html = await renderHtml(bundle.outputFiles[0].text, { version: pkg.version });
const me = { user: { id: 'local-media-fixture', name: 'فحص محلي' }, premium: { active: true, until: Date.now() + 86400000, source: 'test', status: 'active', willRenew: false }, trials: {}, serverTime: Date.now() };
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const results = [], errors = [], pending = new Set();
let holdImages = true, failAudio = true, injectedFailures = 0;
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); }
function releaseImages() { holdImages = false; for (const resolve of pending) resolve(); pending.clear(); }
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const json = (data) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (pathname === '/api/auth/exchange') return json({ session: { token: 'isolated-local-fixture-token' }, me });
    if (pathname === '/api/me') return json(me);
    if (pathname === '/api/trials/merge') return json({ trials: {} });
    if (pathname === '/api/billing/config') return json({ auth: { google: false, apple: false }, paddle: null });
    if (pathname.startsWith('/api/')) { res.writeHead(405); res.end(); return; }
    if (pathname === '/' || pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
    if (failAudio && pathname.startsWith('/media/sound/')) { injectedFailures++; res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('Intentional media retry test'); return; }
    if (holdImages && /^\/media\/.+\.(webp|png)$/.test(pathname)) await new Promise((resolve) => pending.add(resolve));
    const base = pathname.startsWith('/media/') ? ROOT : path.join(ROOT, 'public');
    const file = path.resolve(base, `.${pathname}`);
    if (!file.startsWith(`${path.resolve(base)}${path.sep}`)) { res.writeHead(403); res.end(); return; }
    let body = await fs.readFile(file).catch((error) => {
      if (!pathname.startsWith('/media/')) throw error;
      return fs.readFile(path.join(ROOT, 'public', `.${pathname}`));
    });
    if (pathname === '/sw.js') body = Buffer.from(body.toString().replaceAll('__BUILD_ID__', `media-e2e-${Date.now()}`));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': body.length }); res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar', isMobile: true, hasTouch: true });
const page = await context.newPage(); page.setDefaultTimeout(15000);
page.on('pageerror', (error) => errors.push(error.message));
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled' });
try {
  // Delay real decode completion only in this isolated browser to inspect the
  // startup gate; the production code gets no fabricated readiness state.
  await context.addInitScript(() => {
    if (sessionStorage.getItem('e2e-readiness-tested')) return;
    const original = Image.prototype.decode;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    window.releaseReadinessTest = () => { sessionStorage.setItem('e2e-readiness-tested', '1'); release(); };
    Image.prototype.decode = function () { return gate.then(() => original.call(this)); };
  });
  await page.goto(`${BASE}/#/auth?code=local-media-fixture`, { waitUntil: 'domcontentloaded' });
  await page.locator('.splash .loading-status').waitFor();
  check('startup waits for actual decode and does not mount a hidden game', await page.locator('.home-screen, .game-frame').count() === 0);
  await shot('startup-loading-slow-decode');
  releaseImages(); // Startup now warms every active image before entering the app.
  await page.evaluate(() => window.releaseReadinessTest());
  await page.locator('.splash').waitFor({ state: 'detached' });
  await page.locator('.home-screen').waitFor();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  check('real service worker controls the local test app', true);
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.locator('#sound-volume').fill('35');
  await page.evaluate(() => { location.hash = '#/play/badeeha'; });
  await page.locator('.m-hero-cta').click();
  check('isolated mock Plus unlocks paid media packs', await page.locator('.m-category-pick.is-locked').count() === 0);
  const ids = ['general', 'silhouette', 'sound', 'blur', 'zoom', 'reveal'];
  const packs = await Promise.all(ids.map(async (id) => JSON.parse(await fs.readFile(path.join(ROOT, 'src/data/categories', `${id}.json`), 'utf8'))));
  for (const pack of packs) await page.locator('.m-category-main').filter({ has: page.locator('b', { hasText: new RegExp(`^${pack.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).click();
  // Simulate media eviction after startup to retain the round's slow-load and
  // recovery checks. Normal launches now have these images cached already.
  await page.evaluate(() => caches.delete('maydan-media-v1'));
  holdImages = true;
  await page.getByRole('button', { name: /^ابدأ 30 سؤال/ }).click();
  await page.locator('.m-round-loading').waitFor();
  check('round loader tracks actual media and keeps the board unmounted', await page.locator('.m-board-grid').count() === 0);
  await shot('round-loading-slow-response');
  await page.getByRole('button', { name: 'متابعة اللعب الآن', exact: true }).click();
  await page.locator('.m-board-grid').waitFor();
  const open = async (pack, points) => {
    await page.getByRole('button', { name: `${pack.name}، سؤال ${points} نقطة`, exact: true }).click();
    await page.locator('.m-question-card').waitFor();
  };
  const finish = async () => { await page.locator('.m-reveal-action').click(); await page.locator('.m-nobody').click(); await page.locator('.m-board-grid').waitFor(); };

  await open(packs[1], 600);
  await page.locator('.m-media-box.is-loading').waitFor();
  check('image question displays a real loading state while its response is held', true);
  await shot('media-loading-slow-response');
  releaseImages();
  await page.waitForFunction(() => { const img = document.querySelector('.m-media-img.fx-silhouette'); return img?.complete && img.naturalWidth > 0; });
  const shadow = await page.locator('.m-media-img.fx-silhouette').evaluate((img) => ({ width: img.naturalWidth, height: img.naturalHeight, filter: getComputedStyle(img).filter, assisted: img.classList.contains('is-assisted') }));
  check('current transparent silhouette retains its black shape with assistance', shadow.filter.includes('brightness(0)') && shadow.assisted, JSON.stringify(shadow));
  check('600-point image includes answer-shape assistance', await page.locator('.m-question-assistance').count() === 1);
  await shot('shadow-assisted');
  await finish();
  await open(packs[0], 1000);
  check('1000-point text includes light assistance', await page.locator('.m-question-assistance').count() === 1);
  await finish();
  await open(packs[0], 200);
  check('200-point text retains original presentation', await page.locator('.m-question-assistance').count() === 0);
  await finish();

  await open(packs[2], 800);
  await page.locator('.m-media-error').waitFor();
  check('unavailable audio shows a retry action', await page.getByRole('button', { name: 'أعد المحاولة', exact: true }).isVisible());
  await page.getByRole('button', { name: 'كتم الصوت', exact: true }).click();
  failAudio = false;
  await page.getByRole('button', { name: 'أعد المحاولة', exact: true }).click();
  await page.waitForFunction(() => { const audio = document.querySelector('.m-audio audio'); return audio?.readyState >= 2; });
  const afterRetry = await page.locator('.m-audio audio').evaluate((audio) => ({ muted: audio.muted, volume: audio.volume, paused: audio.paused, duration: audio.duration }));
  check('retried audio retains global mute and volume on its replacement element', afterRetry.muted && afterRetry.paused && Math.abs(afterRetry.volume - .35) < .001, JSON.stringify(afterRetry));
  check('muted question playback button is disabled', await page.locator('.m-audio-btn').isDisabled());
  await page.getByRole('button', { name: 'تشغيل الصوت', exact: true }).click();
  check('unmuting does not autoplay the question', await page.locator('.m-audio audio').evaluate((audio) => audio.paused));
  await page.locator('.m-audio-btn').click();
  await page.waitForFunction(() => document.querySelector('.m-audio audio')?.currentTime > .1);
  check('real MP3 plays after retry with the saved volume', await page.locator('.m-audio audio').evaluate((audio) => !audio.paused && Math.abs(audio.volume - .35) < .001));
  // Headless Chrome keeps pages visible: deliver the same browser lifecycle
  // event to the real handler and explicitly report it as a simulation.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  check('simulated background visibility pauses question audio after retry', await page.locator('.m-audio audio').evaluate((audio) => audio.paused));
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await shot('audio-retried');
  const audioUrl = await page.locator('.m-audio audio').evaluate((audio) => audio.src);
  await page.waitForFunction(async (url) => !!(await (await caches.open('maydan-media-v1')).match(url)), audioUrl);
  await context.setOffline(true);
  const range = await page.evaluate(async (url) => { const response = await fetch(url, { headers: { Range: 'bytes=0-31' } }); return { status: response.status, bytes: (await response.arrayBuffer()).byteLength, range: response.headers.get('content-range') }; }, audioUrl);
  check('cached audio serves byte ranges completely offline', range.status === 206 && range.bytes === 32, JSON.stringify(range));
  await page.reload({ waitUntil: 'domcontentloaded' });
  // The deliberate cache eviction above left other packs missing. Offline
  // startup must offer entry with the available images rather than claim 100%.
  await page.getByRole('button', { name: 'الدخول بالصور المتاحة', exact: true }).click();
  await page.locator('.splash').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'متابعة', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.m-audio audio')?.readyState >= 2);
  await page.locator('.m-audio-btn').click();
  await page.waitForFunction(() => document.querySelector('.m-audio audio')?.currentTime > .1);
  check('saved media question resumes and plays after a fully offline reload', true);
  await shot('audio-offline');
  check('no JavaScript runtime errors', errors.length === 0, JSON.stringify(errors));
} catch (error) { check('media integration flow', false, error.message); await shot('media-integration-failure').catch(() => {}); }
finally {
  releaseImages(); await browser.close(); await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(path.join(OUT, 'media-integration-results.json'), JSON.stringify({ executedAt: new Date().toISOString(), mockAccountOnly: true, realBankAndAssets: true, inMemorySelection: 'none; current curated bank', injectedAudioFailures: injectedFailures, results, errors }, null, 2));
}
console.log(`${results.filter((result) => result.ok).length}/${results.length} media checks passed`);
if (results.some((result) => !result.ok)) process.exitCode = 1;
