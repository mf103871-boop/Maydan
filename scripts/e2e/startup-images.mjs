// Real built application, actual image bytes, isolated browser storage.
// npm run build:cloudflare
// CHROMIUM_PATH=/path/to/chrome node scripts/e2e/startup-images.mjs <output-directory>
// This script serves dist without rebuilding it. Only the output directory is written.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { BRAND_ASSET_DIR, mediaVersions } from '../lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = path.join(ROOT, 'dist');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maydan-e2e', 'startup-images'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const results = [], errors = [], requests = [], contexts = [], stylesheetResponses = [];
const pageRequests = new WeakMap();
let browser, server, currentPage, base, gateRelease;
let scenario = 'prepare', gateEnabled = true, failedPath = null, serviceWorkerHeld = true;
const serviceWorkerWaiters = new Set();
const releaseServiceWorker = () => { serviceWorkerHeld = false; for (const resolve of serviceWorkerWaiters) resolve(); serviceWorkerWaiters.clear(); };
const gate = new Promise((resolve) => { gateRelease = resolve; });
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
};
const imagePath = (url) => /\.(?:webp|png|jpe?g|gif|svg|avif)$/i.test(new URL(url, 'http://localhost').pathname);
const requestCounts = (kind = 'all') => {
  const counts = {};
  for (const r of requests.filter((r) => r.image && (kind !== 'elective' || r.shell && r.destination !== 'image'))) counts[r.key] = (counts[r.key] || 0) + 1;
  return counts;
};
const countDelta = (before, kind = 'all') => Object.entries(requestCounts(kind)).map(([key, n]) => ({ key, count: n - (before[key] || 0) })).filter((x) => x.count > 0);
async function electiveRequestsSince(page, offset, electiveKeys) {
  // Direct local entry now mounts the real category picker. Its DOM images are
  // required UI, unlike the paused shell fetch queue. Shell images requested by
  // prepareVisuals/<img> are also foreground work. Do not confuse either with a
  // fetch for the same URL. SW installation is held separately during this probe.
  const coverKeys = new Set(await page.locator('[data-design-screen="badeeha.setup"] .m-category-cover img').evaluateAll(images => images.map(image => {
    const url = new URL(image.src, location.href); return url.pathname + url.search;
  })));
  const initiators = pageRequests.get(page);
  const isPickerCover = request => request.key.startsWith('/media/badeeha-covers/') && coverKeys.has(request.key);
  const isForegroundImage = request => isPickerCover(request) || expected.some(entry => entry.key === request.key);
  const traffic = requests.slice(offset.server).filter(request => request.image && electiveKeys.has(request.key));
  const required = request => request.destination === 'image' && isForegroundImage(request);
  return {
    requests: traffic.filter(request => !required(request)),
    unexpectedInitiators: initiators.slice(offset.browser).filter(request => electiveKeys.has(request.key) && !(request.type === 'image' && isForegroundImage(request))),
    requiredPickerCovers: traffic.filter(request => required(request) && isPickerCover(request)).length,
    requiredShellImages: traffic.filter(request => required(request) && !isPickerCover(request)).length,
  };
}
const requestOffset = page => ({ server: requests.length, browser: pageRequests.get(page).length });
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true, animations: 'disabled' });
}
async function layout(page) {
  return page.evaluate(() => {
    const splash = document.querySelector('.splash'), progress = document.querySelector('progress[aria-label="تحميل صور اللعبة"]');
    return {
      viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth,
      splash: !!splash, progress: progress ? { value: progress.value, max: progress.max, text: progress.getAttribute('aria-valuetext') } : null,
      mountedGame: !!document.querySelector('.game-frame, .m-root, .m-question-screen, .m-board-grid, .home-screen'),
      text: splash?.innerText || '',
      background: document.querySelector('.startup-background')?.innerText || '',
    };
  });
}
async function newContext() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'ar', isMobile: true, hasTouch: true,
    reducedMotion: 'reduce', serviceWorkers: 'allow',
  });
  contexts.push(context);
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return context;
}
async function newPage(context) {
  const page = await context.newPage();
  const initiated = []; pageRequests.set(page, initiated);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === base && imagePath(url.href)) initiated.push({ key: url.pathname + url.search, type: request.resourceType() });
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === base && url.pathname.endsWith('.css')) stylesheetResponses.push({ url: url.pathname, status: response.status(), contentType: response.headers()['content-type'] });
  });
  currentPage = page;
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push({ scenario, message: error.message }));
  return page;
}
async function ready(page, screen = '.home-screen') {
  await page.locator('.splash').waitFor({ state: 'detached', timeout: 10000 });
  await page.locator(screen).waitFor({ timeout: 10000 });
  await page.waitForFunction(() => [...document.querySelectorAll('link[rel="stylesheet"]')].every(link => !!link.sheet));
}
async function allCached(page, expected) {
  await page.waitForFunction(async (urls) => {
    const cache = await caches.open('maydan-media-v1');
    return (await Promise.all(urls.map((url) => cache.match(new URL(url, location.href).href)))).every(Boolean);
  }, expected.map((entry) => entry.url), { timeout: 120000, polling: 500 });
  await page.locator('.startup-background').waitFor({ state: 'detached', timeout: 30000 });
}
async function controlled(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
}
async function inspectCache(page, expected) {
  return page.evaluate(async (entries) => {
    const cache = await caches.open('maydan-media-v1'), rows = [];
    for (const entry of entries) {
      const response = await cache.match(new URL(entry.url, location.href).href);
      if (!response) { rows.push({ url: entry.url, ok: false, missing: true }); continue; }
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
      const contentType = response.headers.get('content-type');
      rows.push({ url: entry.url, status: response.status, bytes: bytes.byteLength, sha256, contentType,
        ok: response.status === 200 && /^image\//i.test(contentType || '') && bytes.byteLength === entry.bytes && sha256 === entry.sha256 });
    }
    return rows;
  }, expected);
}

await fs.mkdir(OUT, { recursive: true });
const startedAt = new Date().toISOString();
let expected = [], bankImages = [], cachedAfterFirst = [], cachedAfterRetry = [], sourceHashes;
try {
  const html = await fs.readFile(path.join(DIST, 'index.html'));
  const sw = await fs.readFile(path.join(DIST, 'sw.js'));
  sourceHashes = { html: hash(html), serviceWorker: hash(sw) };
  // Compile only the list for inspection; the browser still runs unmodified dist.
  const manifest = await build({
    stdin: {
      contents: `export { SHELL_ARTWORK_URLS } from './src/shared/brand/art.jsx';
        export { startupImageUrls as bankImageUrls } from './src/shared/media/startup-images.js';`,
      resolveDir: ROOT,
    }, bundle: true, write: false, outdir: DIST, assetNames: `${BRAND_ASSET_DIR}/[name]-[hash]`,
    loader: { '.webp': 'file', '.woff2': 'file' }, jsx: 'automatic',
    format: 'iife', globalName: 'StartupImageManifest', platform: 'browser',
    define: { __MAYDAN_MEDIA_VERSIONS__: JSON.stringify(await mediaVersions(ROOT)) },
    logLevel: 'silent',
  });
  const scope = {};
  vm.runInNewContext(manifest.outputFiles.find(file => file.path.endsWith('.js')).text, scope);
  const describeImage = async (url) => {
    const parsed = new URL(url, 'http://localhost/');
    if (parsed.origin !== 'http://localhost') throw new Error(`This isolated image test requires local image URLs: ${url}`);
    const bytes = await fs.readFile(path.join(DIST, decodeURIComponent(parsed.pathname)));
    return { url, key: parsed.pathname + parsed.search, bytes: bytes.length, sha256: hash(bytes) };
  };
  expected = await Promise.all(Array.from(scope.StartupImageManifest.SHELL_ARTWORK_URLS, describeImage));
  bankImages = await Promise.all(Array.from(scope.StartupImageManifest.bankImageUrls, describeImage));
  check('real startup manifest has 10 unique shell images present in the shipped bundle', expected.length === 10 && new Set(expected.map(entry => entry.url)).size === 10 && expected.every(entry => html.includes(entry.url) && entry.bytes > 0));
  check('separate active game-bank manifest retains all 510 distinct dist images without eager startup loading', bankImages.length === 510 && new Set(bankImages.map(entry => entry.url)).size === 510 && bankImages.every(entry => entry.bytes > 0));
  const shellKeys = new Set(expected.map(entry => entry.key));
  const electiveKeys = new Set([...expected, ...bankImages].map(entry => entry.key));
  const allowedFirst = new Set(expected.slice(0, 3).map(entry => entry.key));
  const target = expected.at(-1);
  check('failure target is one real shell image outside the initial gate', !allowedFirst.has(target.key) && target.key.startsWith('/assets/brand/'), { url: target.url });
  server = http.createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url, 'http://localhost'), key = parsed.pathname + parsed.search;
      const isImage = imagePath(parsed.href), destination = req.headers['sec-fetch-dest'] || '';
      requests.push({ scenario, key, image: isImage, shell: shellKeys.has(key), destination });
      // The SW independently installs release artwork and 32 Fabraka images.
      // Delay its script only during the queue-pause probes so its independent
      // owner cannot satisfy the pending queue or masquerade as queue traffic.
      if (parsed.pathname === '/sw.js' && serviceWorkerHeld) await new Promise(resolve => serviceWorkerWaiters.add(resolve));
      if (shellKeys.has(key) && destination !== 'image' && gateEnabled && !allowedFirst.has(key)) await gate;
      if (res.destroyed) return;
      if (isImage && parsed.pathname === failedPath) { res.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('Injected image outage'); return; }
      let pathname = decodeURIComponent(parsed.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.resolve(DIST, `.${pathname}`);
      if (!file.startsWith(`${path.resolve(DIST)}${path.sep}`)) { res.writeHead(403); res.end(); return; }
      const bytes = await fs.readFile(file).catch(() => null);
      if (!bytes) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(bytes);
    } catch (error) { if (!res.destroyed) { res.writeHead(500); res.end('Static test server error'); } }
  });
  await new Promise((resolve) => server.listen(Number(process.env.E2E_PORT || 0), '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });

  scenario = 'first-launch-delayed-menu';
  const context = await newContext(), page = await newPage(context);
  const firstLaunchAt = Date.now();
  // A safe menu permits elective downloads, including while the splash is up.
  // Direct /play intentionally pauses that queue before its first image request.
  await page.goto(`${base}/#/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const p = document.querySelector('progress[aria-label="تحميل صور اللعبة"]'); return p && p.value > 0 && p.value < p.max; });
  const progress = await layout(page);
  check('real image responses advance progress while the game remains unmounted', progress.splash && !progress.mountedGame && progress.progress.max === expected.length && progress.progress.value > 0 && progress.progress.value < expected.length, progress);
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const view = await layout(page);
    check(`loading layout ${viewport.width}x${viewport.height} has no horizontal overflow`, view.scrollWidth <= viewport.width + 1, view);
    await screenshot(page, `loading-${viewport.width}x${viewport.height}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  const autoEntryMs = Date.now() - firstLaunchAt;
  const whileHeld = await layout(page);
  check('automatic menu entry takes less than five seconds while image responses remain held', gateEnabled && autoEntryMs < 5000 && whileHeld.mountedGame && !whileHeld.splash, { autoEntryMs, ...whileHeld });
  check('pending image download remains visible and nonblocking after entry', await page.locator('.startup-background').isVisible() && whileHeld.background.includes('بالخلفية'), whileHeld);
  const bankKeys = new Set(bankImages.map(entry => entry.key));
  const eagerBankRequests = requests.filter(request => request.image && bankKeys.has(request.key));
  check('Home does not eagerly request the separate 510-image game bank', eagerBankRequests.length === 0, eagerBankRequests);
  await screenshot(page, 'automatic-entry-background');

  scenario = 'play-pauses-elective-downloads';
  await page.goto(`${base}/#/play/badeeha`, { waitUntil: 'domcontentloaded' });
  await ready(page, '[data-design-screen="badeeha.setup"]');
  await page.waitForFunction(() => document.querySelector('.startup-background')?.innerText.includes('متوقف مؤقتًا'));
  const beforePlayDrain = requestOffset(page);
  gateEnabled = false; gateRelease();
  // Three image bodies already in flight may finish, but the play route must not
  // advance the elective queue afterwards. Verify their actual bytes, not a delay
  // alone, before observing the paused queue for one second.
  await page.waitForFunction(async urls => {
    const cache = await caches.open('maydan-media-v1');
    return (await Promise.all(urls.map(url => cache.match(new URL(url, location.href).href)))).every(Boolean);
  }, expected.slice(0, 6).map(entry => entry.url), { timeout: 30000, polling: 100 });
  await page.waitForTimeout(1000);
  const duringPlay = await electiveRequestsSince(page, beforePlayDrain, electiveKeys);
  const drained = await inspectCache(page, expected.slice(0, 6));
  check('play pauses new elective image traffic while preserving already in-flight bodies', duringPlay.requests.length === 0 && duringPlay.unexpectedInitiators.length === 0 && drained.every(entry => entry.ok), { ...duringPlay, completedBodies: drained.length, failures: drained.filter(entry => !entry.ok) });
  check('paused download is explicit and never blocks the mounted game', await page.locator('[data-design-screen="badeeha.setup"]').isVisible() && (await layout(page)).background.includes('متوقف مؤقتًا'));
  await screenshot(page, 'play-download-paused');

  scenario = 'menu-resumes-downloads';
  await page.goto(`${base}/#/`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await allCached(page, expected); releaseServiceWorker(); await controlled(page);
  check('returning to the menu resumes and completes the pending image queue', await page.locator('.home-screen').isVisible() && !(await page.locator('.startup-background').count()));
  cachedAfterFirst = await inspectCache(page, expected);
  check('all 10 startup shell image bodies equal actual dist files', cachedAfterFirst.length === expected.length && cachedAfterFirst.every((x) => x.ok), { total: cachedAfterFirst.length, failures: cachedAfterFirst.filter((x) => !x.ok) });
  await screenshot(page, 'first-launch-ready');

  scenario = 'second-launch';
  const beforeSecond = requestCounts();
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page); await controlled(page);
  const repeated = countDelta(beforeSecond);
  check('second launch uses persistent images without repeat image requests', repeated.length === 0, repeated);
  await screenshot(page, 'second-launch-ready');

  scenario = 'offline-reopen';
  const beforeOffline = requestCounts();
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
  await page.goto(`${base}/#/play/badeeha`, { waitUntil: 'domcontentloaded' }); await ready(page, '[data-design-screen="badeeha.setup"]');
  const decoded = await page.evaluate(async (urls) => {
    const rows = [], queue = [...urls];
    async function run() { while (queue.length) { const url = queue.shift(), image = new Image(); image.src = url;
      try { await image.decode(); rows.push({ url, ok: image.naturalWidth > 0, width: image.naturalWidth, height: image.naturalHeight }); }
      catch { rows.push({ url, ok: false }); } } }
    await Promise.all(Array.from({ length: 6 }, run)); return rows;
  }, expected.map((x) => x.url));
  check('offline reopened application decodes every actual startup shell image', decoded.length === expected.length && decoded.every((x) => x.ok), { total: decoded.length, failures: decoded.filter((x) => !x.ok) });
  check('offline reopen sends no image request to server', countDelta(beforeOffline).length === 0);
  await fs.writeFile(path.join(OUT, 'offline-decode.json'), JSON.stringify(decoded, null, 2) + '\n');
  await screenshot(page, 'offline-ready');
  await context.close();

  scenario = 'injected-single-failure';
  serviceWorkerHeld = true;
  failedPath = new URL(target.url, base).pathname;
  const failureContext = await newContext(), failurePage = await newPage(failureContext);
  const failureLaunchAt = Date.now();
  const beforeDirectPlay = requestOffset(failurePage);
  await failurePage.goto(`${base}/#/play/badeeha`, { waitUntil: 'domcontentloaded' });
  await failurePage.waitForFunction(total => { const p = document.querySelector('progress[aria-label="تحميل صور اللعبة"]'); return p && p.max === total && p.value === 0; }, expected.length);
  await ready(failurePage, '[data-design-screen="badeeha.setup"]');
  const failureEntryMs = Date.now() - failureLaunchAt;
  const directTraffic = await electiveRequestsSince(failurePage, beforeDirectPlay, electiveKeys);
  check('direct game entry takes less than five seconds without starting elective image traffic', failureEntryMs < 5000 && await failurePage.locator('[data-design-screen="badeeha.setup"]').isVisible() && directTraffic.requests.length === 0 && directTraffic.unexpectedInitiators.length === 0, { failureEntryMs, ...directTraffic });
  check('the pending direct-entry download is reported as paused, not complete', (await layout(failurePage)).background.includes('متوقف مؤقتًا'));
  // The injected failure is exercised only after returning to an allowed menu.
  await failurePage.goto(`${base}/#/`, { waitUntil: 'domcontentloaded' }); await ready(failurePage);
  const retry = failurePage.locator('.startup-background').getByRole('button', { name: 'إعادة المحاولة', exact: true });
  await retry.waitFor({ timeout: 120000 });
  const failed = await layout(failurePage);
  check('one failed image has an honest nonblocking count and retry control', !failed.splash && failed.mountedGame && /باقي\s+[1١]\s+صورة/u.test(failed.background) && await retry.isVisible(), failed);
  const cachedWithFailure = await inspectCache(failurePage, expected);
  check('an image failure preserves the other 9 correct shell images', cachedWithFailure.filter((x) => x.ok).length === expected.length - 1 && cachedWithFailure.filter((x) => !x.ok).every((x) => x.url === target.url), { total: cachedWithFailure.length, failures: cachedWithFailure.filter((x) => !x.ok) });
  check('failed image has not entered persistent cache', await failurePage.evaluate(async (url) => !(await (await caches.open('maydan-media-v1')).match(new URL(url, location.href).href)), target.url));
  await screenshot(failurePage, 'failed-image-background');

  scenario = 'reopen-with-missing-image';
  const beforeMissingReload = requestCounts('elective');
  await failurePage.reload({ waitUntil: 'domcontentloaded' });
  await failurePage.getByRole('button', { name: 'الدخول بالمحتوى المتاح', exact: true }).click();
  await ready(failurePage); await retry.waitFor({ timeout: 120000 });
  check('manual continue opens the menu while preserving the incomplete download status', await failurePage.locator('.home-screen').isVisible() && /باقي\s+[1١]\s+صورة/u.test((await layout(failurePage)).background));
  const missingReloadRequests = countDelta(beforeMissingReload, 'elective');
  check('a later launch retries only the missing queue image instead of treating entry as completion', missingReloadRequests.length > 0 && missingReloadRequests.every((x) => new URL(x.key, base).pathname === new URL(target.url, base).pathname), missingReloadRequests);
  await screenshot(failurePage, 'continue-with-available');
  scenario = 'retry-success';
  const beforeRetry = requestCounts('elective'); failedPath = null;
  await retry.click(); await allCached(failurePage, expected);
  const retried = countDelta(beforeRetry, 'elective');
  check('retry downloads only the missing image', retried.length > 0 && retried.every((x) => new URL(x.key, base).pathname === new URL(target.url, base).pathname), retried);
  cachedAfterRetry = await inspectCache(failurePage, expected);
  check('successful retry leaves all 10 correct shell images cached', cachedAfterRetry.length === expected.length && cachedAfterRetry.every((x) => x.ok), { total: cachedAfterRetry.length, failures: cachedAfterRetry.filter((x) => !x.ok) });
  releaseServiceWorker(); await controlled(failurePage);
  check('repaired shell permits real service-worker installation and control', await failurePage.evaluate(() => !!navigator.serviceWorker.controller));
  await screenshot(failurePage, 'retry-success');
  check('no browser JavaScript errors in any scenario', errors.length === 0, errors);
  check('actual packaged stylesheets load with successful CSS responses', stylesheetResponses.length > 0 && stylesheetResponses.every(response => response.status === 200 && /^text\/css(?:;|$)/i.test(response.contentType || '')), stylesheetResponses);
  check('dist was unchanged during regression run', sourceHashes.html === hash(await fs.readFile(path.join(DIST, 'index.html'))) && sourceHashes.serviceWorker === hash(await fs.readFile(path.join(DIST, 'sw.js'))));
} catch (error) {
  check('startup image regression flow completes', false, error.stack || String(error));
  await currentPage?.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  gateRelease(); releaseServiceWorker();
  await browser?.close().catch(() => {});
  if (server) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify({
    startedAt, completedAt: new Date().toISOString(), sourceHashes,
    scope: 'Real unmodified dist and real headless Chromium; 10 startup shell images verified by exact bytes/cache/offline decode/retry. The separate 510-image game bank is checked for distinct real dist files, not eagerly downloaded on Home. Server delay/503 only; SW script held during queue-owner probes then real SW installation/offline behavior checked. Foreground DOM images are distinguished from elective fetches. External requests aborted; no mocked source/image/account responses or payment/production requests.',
    expectedImages: expected, separateBankImages: bankImages, results, errors, requests, stylesheetResponses, cachedAfterFirst, cachedAfterRetry,
    summary: { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, total: results.length },
  }, null, 2) + '\n');
}
console.log(`${results.filter((r) => r.ok).length}/${results.length} checks; output ${OUT}`);
if (results.some((r) => !r.ok)) process.exitCode = 1;
