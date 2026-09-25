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
import { mediaVersions } from '../lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = path.join(ROOT, 'dist');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'maydan-e2e', 'startup-images'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const results = [], errors = [], requests = [], contexts = [];
let browser, server, currentPage, base, gateRelease;
let scenario = 'prepare', gateEnabled = true, failedPath = null;
const gate = new Promise((resolve) => { gateRelease = resolve; });
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
};
const imagePath = (url) => /\.(?:webp|png|jpe?g|gif|svg|avif)$/i.test(new URL(url, 'http://localhost').pathname);
const requestCounts = () => {
  const counts = {};
  for (const r of requests.filter((r) => r.image)) counts[r.key] = (counts[r.key] || 0) + 1;
  return counts;
};
const countDelta = (before) => Object.entries(requestCounts()).map(([key, n]) => ({ key, count: n - (before[key] || 0) })).filter((x) => x.count > 0);
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
  return context;
}
async function newPage(context) {
  const page = await context.newPage();
  currentPage = page;
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push({ scenario, message: error.message }));
  return page;
}
async function ready(page) {
  await page.locator('.splash').waitFor({ state: 'detached', timeout: 10000 });
  await page.locator('.m-home').waitFor({ timeout: 10000 });
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
let expected = [], cachedAfterFirst = [], cachedAfterRetry = [], sourceHashes;
try {
  const html = await fs.readFile(path.join(DIST, 'index.html'));
  const sw = await fs.readFile(path.join(DIST, 'sw.js'));
  sourceHashes = { html: hash(html), serviceWorker: hash(sw) };
  // Compile only the list for inspection; the browser still runs unmodified dist.
  const manifest = await build({
    entryPoints: [path.join(ROOT, 'src/shared/media/startup-images.js')], bundle: true, write: false,
    format: 'iife', globalName: 'StartupImageManifest', platform: 'browser',
    define: { __MAYDAN_MEDIA_VERSIONS__: JSON.stringify(await mediaVersions(ROOT)) },
    logLevel: 'silent',
  });
  const scope = {};
  vm.runInNewContext(manifest.outputFiles[0].text, scope);
  expected = await Promise.all(Array.from(scope.StartupImageManifest.startupImageUrls, async (url) => {
    const parsed = new URL(url, 'http://localhost/');
    if (parsed.origin !== 'http://localhost') throw new Error(`This local complete-bank test requires local image URLs: ${url}`);
    const bytes = await fs.readFile(path.join(DIST, decodeURIComponent(parsed.pathname)));
    return { url, key: parsed.pathname + parsed.search, bytes: bytes.length, sha256: hash(bytes) };
  }));
  check('real active manifest has 510 unique images', expected.length === 510 && new Set(expected.map((x) => x.url)).size === 510);
  const allowedFirst = new Set(expected.slice(0, 12).map((x) => x.key));
  const target = expected.find((x) => x.url.includes('spotdiff-1000-908-b.webp'));
  if (!target) throw new Error('Expected failure target absent from active manifest');
  server = http.createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url, 'http://localhost'), key = parsed.pathname + parsed.search;
      const isImage = imagePath(parsed.href);
      requests.push({ scenario, key, image: isImage });
      if (isImage && gateEnabled && !allowedFirst.has(key)) await gate;
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

  scenario = 'first-launch-delayed';
  const context = await newContext(), page = await newPage(context);
  const firstLaunchAt = Date.now();
  await page.goto(`${base}/#/play/badeeha`, { waitUntil: 'domcontentloaded' });
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
  check('automatic game entry takes less than five seconds while image responses remain held', gateEnabled && autoEntryMs < 5000 && whileHeld.mountedGame && !whileHeld.splash, { autoEntryMs, ...whileHeld });
  check('pending image download remains visible and nonblocking after entry', await page.locator('.startup-background').isVisible() && whileHeld.background.includes('بالخلفية'), whileHeld);
  await screenshot(page, 'automatic-entry-background');
  gateEnabled = false; gateRelease();
  await allCached(page, expected); await controlled(page);
  check('background download completes without leaving the mounted game', await page.locator('.m-home').isVisible() && !(await page.locator('.startup-background').count()));
  cachedAfterFirst = await inspectCache(page, expected);
  check('all 510 active cached image bodies equal actual dist files', cachedAfterFirst.length === expected.length && cachedAfterFirst.every((x) => x.ok), { total: cachedAfterFirst.length, failures: cachedAfterFirst.filter((x) => !x.ok) });
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
  const decoded = await page.evaluate(async (urls) => {
    const rows = [], queue = [...urls];
    async function run() { while (queue.length) { const url = queue.shift(), image = new Image(); image.src = url;
      try { await image.decode(); rows.push({ url, ok: image.naturalWidth > 0, width: image.naturalWidth, height: image.naturalHeight }); }
      catch { rows.push({ url, ok: false }); } } }
    await Promise.all(Array.from({ length: 6 }, run)); return rows;
  }, expected.map((x) => x.url));
  check('offline reopened application decodes every actual active image', decoded.length === expected.length && decoded.every((x) => x.ok), { total: decoded.length, failures: decoded.filter((x) => !x.ok) });
  check('offline reopen sends no image request to server', countDelta(beforeOffline).length === 0);
  await fs.writeFile(path.join(OUT, 'offline-decode.json'), JSON.stringify(decoded, null, 2) + '\n');
  await screenshot(page, 'offline-ready');
  await context.close();

  scenario = 'injected-single-failure';
  failedPath = new URL(target.url, base).pathname;
  const failureContext = await newContext(), failurePage = await newPage(failureContext);
  const failureLaunchAt = Date.now();
  await failurePage.goto(`${base}/#/play/badeeha`, { waitUntil: 'domcontentloaded' });
  await ready(failurePage);
  const failureEntryMs = Date.now() - failureLaunchAt;
  check('one failed image does not block automatic game entry', failureEntryMs < 5000 && await failurePage.locator('.m-home').isVisible(), { failureEntryMs });
  const retry = failurePage.locator('.startup-background').getByRole('button', { name: 'إعادة المحاولة', exact: true });
  await retry.waitFor({ timeout: 120000 });
  const failed = await layout(failurePage);
  check('one failed image has an honest nonblocking count and retry control', !failed.splash && failed.mountedGame && /باقي\s+[1١]\s+صورة/u.test(failed.background) && await retry.isVisible(), failed);
  const cachedWithFailure = await inspectCache(failurePage, expected);
  check('an image failure preserves the other 509 correct cached images', cachedWithFailure.filter((x) => x.ok).length === expected.length - 1 && cachedWithFailure.filter((x) => !x.ok).every((x) => x.url === target.url), { total: cachedWithFailure.length, failures: cachedWithFailure.filter((x) => !x.ok) });
  check('failed image has not entered persistent cache', await failurePage.evaluate(async (url) => !(await (await caches.open('maydan-media-v1')).match(new URL(url, location.href).href)), target.url));
  await screenshot(failurePage, 'failed-image-background');
  await controlled(failurePage);

  scenario = 'reopen-with-missing-image';
  const beforeMissingReload = requestCounts();
  await failurePage.reload({ waitUntil: 'domcontentloaded' });
  await failurePage.getByRole('button', { name: 'الدخول بالصور المتاحة', exact: true }).click();
  await ready(failurePage); await retry.waitFor({ timeout: 120000 });
  check('manual continue opens the game while preserving the incomplete download status', await failurePage.locator('.m-home').isVisible() && /باقي\s+[1١]\s+صورة/u.test((await layout(failurePage)).background));
  check('a later launch retries only the missing image instead of treating entry as completion', countDelta(beforeMissingReload).length > 0 && countDelta(beforeMissingReload).every((x) => new URL(x.key, base).pathname === new URL(target.url, base).pathname), countDelta(beforeMissingReload));
  await screenshot(failurePage, 'continue-with-available');
  scenario = 'retry-success';
  const beforeRetry = requestCounts(); failedPath = null;
  await retry.click(); await allCached(failurePage, expected);
  const retried = countDelta(beforeRetry);
  check('retry downloads only the missing image', retried.length > 0 && retried.every((x) => new URL(x.key, base).pathname === new URL(target.url, base).pathname), retried);
  cachedAfterRetry = await inspectCache(failurePage, expected);
  check('successful retry leaves all 510 correct images cached', cachedAfterRetry.length === expected.length && cachedAfterRetry.every((x) => x.ok), { total: cachedAfterRetry.length, failures: cachedAfterRetry.filter((x) => !x.ok) });
  await screenshot(failurePage, 'retry-success');
  check('no browser JavaScript errors in any scenario', errors.length === 0, errors);
  check('dist was unchanged during regression run', sourceHashes.html === hash(await fs.readFile(path.join(DIST, 'index.html'))) && sourceHashes.serviceWorker === hash(await fs.readFile(path.join(DIST, 'sw.js'))));
} catch (error) {
  check('startup image regression flow completes', false, error.stack || String(error));
  await currentPage?.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  gateRelease();
  await browser?.close().catch(() => {});
  if (server) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify({
    startedAt, completedAt: new Date().toISOString(), sourceHashes,
    scope: 'Real unmodified dist, local static HTTP server, actual active image bytes and real headless Chromium; server response delay/503 only. No mocked account or network API, no source/image replacement, no payment or production requests.',
    expectedImages: expected, results, errors, requests, cachedAfterFirst, cachedAfterRetry,
    summary: { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, total: results.length },
  }, null, 2) + '\n');
}
console.log(`${results.filter((r) => r.ok).length}/${results.length} checks; output ${OUT}`);
if (results.some((r) => !r.ok)) process.exitCode = 1;
