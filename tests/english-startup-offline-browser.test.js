// The complete shipped shell and real service worker, not a mocked locale hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { ROOT, DIST, esbuildOptions, renderHtml, renderServiceWorker, audioCueAssets } from '../scripts/lib.mjs';
import { SAMPLE_BANK } from '../src/shared/fx/sample-bank.js';

function loopbackPackageInputs() {
  // This fixture deliberately serves the public, same-origin shell. The native
  // CI job can also enable the origin-restricted Warmth audition: inheriting
  // only its SW cue list would cache private audio while this shell correctly
  // selects the public bank. Capture both build inputs under one public mode,
  // synchronously, and restore the caller's release environment before any await.
  const names = ['MAYDAN_PRIVATE_AUDIO_PREVIEW', 'MAYDAN_WARMTH_PREVIEW'];
  const previous = names.map(name => process.env[name]);
  try {
    for (const name of names) process.env[name] = '0';
    return {
      options: esbuildOptions({ minify: true, assets: 'files', version: 'language-browser', roomsUrl: 'same-origin' }),
      audioCues: audioCueAssets(),
    };
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
}

test('loopback language fixture keeps the public shell and audio cache aligned under native Warmth CI inputs', () => {
  const nativeInputs = {
    MAYDAN_PRIVATE_AUDIO_PREVIEW: '1', MAYDAN_WARMTH_PREVIEW: '1',
    IOS_RELEASE_ENVIRONMENT: 'mafia-preview', MAYDAN_ROOMS_URL: 'https://maydan-mafia-preview.mf103871.workers.dev',
  };
  const previous = Object.fromEntries(Object.keys(nativeInputs).map(name => [name, process.env[name]]));
  try {
    Object.assign(process.env, nativeInputs);
    const { options, audioCues } = loopbackPackageInputs();
    assert.equal(options.define.__MAYDAN_ROOMS_URL__, '"same-origin"');
    assert.equal(options.define.__MAYDAN_AUDIO_PREVIEW__, 'false');
    assert.equal(options.define.__MAYDAN_WARMTH_PREVIEW__, 'false');
    assert.equal(options.define.__MAYDAN_WARMTH_PACK__, 'null');
    assert.deepEqual(audioCues, [...new Set(Object.values(SAMPLE_BANK).map(entry => './' + entry.url))]);
    for (const [name, value] of Object.entries(nativeInputs)) assert.equal(process.env[name], value, `preserve ${name}`);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

let compiled;
function packagedApp() {
  return compiled ||= (async () => {
    const { options, audioCues } = loopbackPackageInputs();
    const result = await build(options);
    const files = result.outputFiles.filter(file => !file.path.endsWith('.js'));
    const urls = files.map(file => './' + path.relative(DIST, file.path).replaceAll('\\', '/'));
    const html = await renderHtml(result.outputFiles.find(file => file.path.endsWith('.js')).text, { version: 'language-browser', assets: urls });
    const sw = renderServiceWorker(await readFile(path.join(ROOT, 'public/sw.js'), 'utf8'), { id: 'language-browser', audioCues, brandAssets: urls.filter(url => !/\/locale-en-[^/]+\.json$/.test(url)) });
    return { html, sw, assets: new Map(files.map(file => ['/' + path.relative(DIST, file.path).replaceAll('\\', '/'), file.contents])) };
  })();
}

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: English first launch recovers from a failed language pack and reloads from the real offline cache`, { timeout: 120000 }, async t => {
  const app = await packagedApp();
  let blockEnglish = true, networkAvailable = true, englishReads = 0;
  const mime = { '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.m4a':'audio/mp4' };
  const server = http.createServer(async (req, res) => {
    if (!networkAvailable) { res.destroy(); return; }
    const url = new URL(req.url, 'http://127.0.0.1'), route = url.pathname;
    res.setHeader('cache-control', 'no-store');
    if (route === '/sw.js') { res.setHeader('content-type', 'text/javascript'); res.end(app.sw); return; }
    if (route === '/' || route === '/index.html') { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(app.html); return; }
    if (/\/locale-en-ui-[A-Z0-9]+\.json$/.test(route)) {
      englishReads++;
      if (blockEnglish) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"TEST_LANGUAGE_UNAVAILABLE"}'); return; }
    }
    if (app.assets.has(route)) { res.setHeader('content-type', mime[path.extname(route)] || 'application/octet-stream'); res.end(app.assets.get(route)); return; }
    if (route.startsWith('/api/')) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"UNAVAILABLE"}'); return; }
    try {
      const root = path.join(ROOT, 'public'), file = path.resolve(root, '.' + route);
      if (!file.startsWith(root + path.sep)) throw Error('OUTSIDE_PUBLIC');
      const bytes = await readFile(file); res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream'); res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const profile = await mkdtemp(path.join(os.tmpdir(), 'maydan-language-browser-'));
  const context = await engine.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 } });
  t.after(async () => { await context.close(); const target = await realpath(profile), parent = await realpath(os.tmpdir()); assert.equal(path.dirname(target), parent); assert.ok(path.basename(target).startsWith('maydan-language-browser-')); await rm(target, { recursive: true, force: true, maxRetries:10, retryDelay:100 }); });
  const origin = `http://127.0.0.1:${server.address().port}`, page = context.pages()[0] || await context.newPage(), errors = [];
  await context.addInitScript(() => { if (!localStorage.getItem('maydan:platform:settings')) localStorage.setItem('maydan:platform:settings', JSON.stringify({ uiLocale: 'en', soundOn: false, musicOn: false, reducedMotion: true, splashSeen: true })); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/');
  await page.getByText('Could not load English. Please try again.', { exact: true }).waitFor();
  assert.equal(await page.locator('button[data-game]').count(), 0, 'a failed English first launch must not silently mount Arabic screens');
  assert.ok(englishReads > 0);
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cachedCues = await page.evaluate(async entries => {
    const cache = await caches.open('maydan-platform-language-browser');
    return Promise.all(entries.map(async entry => {
      const response = await cache.match('./' + entry.url);
      return { url: entry.url, ok: !!response?.ok, type: response?.headers.get('content-type'), bytes: response ? (await response.arrayBuffer()).byteLength : 0 };
    }));
  }, Object.values(SAMPLE_BANK));
  assert.equal(cachedCues.length, Object.keys(SAMPLE_BANK).length);
  for (const [index, entry] of Object.values(SAMPLE_BANK).entries()) {
    assert.deepEqual(cachedCues[index], { url: entry.url, ok: true, type: 'audio/mp4', bytes: entry.bytes }, 'every actual public cue must finish caching before the offline transition');
  }
  const beforeRetry = englishReads; blockEnglish = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('button[data-game="ersomha"]').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
  assert.ok(englishReads > beforeRetry);
  await page.waitForFunction(async () => (await (await caches.open('maydan-media-v1')).keys()).some(request => /\/locale-en-ui-[A-Z0-9]+\.json$/.test(new URL(request.url).pathname)));
  const beforeOffline = englishReads;
  networkAvailable = false;
  await assert.rejects(fetch(origin + '/network-proof'), /fetch failed/);
  await page.reload();
  await page.locator('button[data-game="ersomha"]').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.getByText('Could not load English. Please try again.', { exact: true }).count(), 0);
  assert.equal(englishReads, beforeOffline, 'English dictionary must survive document reload without a network response');
  assert.deepEqual(errors, []);
});
