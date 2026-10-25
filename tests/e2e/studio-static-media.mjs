// The exact public Studio media route and transformed active bank, using only
// disposable local storage. No owner session, POST or external request is used.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { ROOT, mediaVersions, escapeInlineScript } from '../../scripts/lib.mjs';
import { studioMediaPlugin, verifyStudioMedia } from '../../scripts/studio-media.mjs';
import { startStudioLocal } from '../../scripts/studio-local.mjs';

const manifest = JSON.parse(await readFile(path.join(ROOT, 'server/design/media-manifest.json'), 'utf8'));
assert.equal(manifest.length, 69, 'bounded public media manifest');
assert.equal(new Set(manifest.map(item => item.sha256)).size, 69, 'each route identifies one original');
await verifyStudioMedia({ root: ROOT });
for (const item of manifest) {
  const original = await readFile(path.join(ROOT, item.source));
  assert.equal(original.length, item.bytes, item.source);
  assert.equal(createHash('sha256').update(original).digest('hex'), item.sha256, item.source);
}

await mkdir(path.join(ROOT, '.cache'), { recursive: true });
const directory = await mkdtemp(path.join(ROOT, '.cache/studio-static-media-'));
after(async () => {
  assert.ok(directory.startsWith(path.join(ROOT, '.cache') + path.sep));
  await rm(directory, { recursive: true, force: true });
});
const built = await build({
  stdin: { contents: `import {startupImageUrls} from './src/shared/media/startup-images.js';
import {cacheStartupImages} from './src/shared/media/startup-cache.js';
window.studioMediaHarness={urls:startupImageUrls,cache:cacheStartupImages};`, resolveDir: ROOT },
  bundle: true, write: false, format: 'iife', plugins: [studioMediaPlugin({ root: ROOT })],
  define: { __MAYDAN_MEDIA_VERSIONS__: JSON.stringify(await mediaVersions(ROOT)) }, logLevel: 'silent',
});
const target = path.join(directory, 'studio/static-media-test');
await mkdir(target, { recursive: true });
await writeFile(path.join(target, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><base href="/"><title>Local Studio media regression</title></head><body><main>Public image decoder</main><script>${escapeInlineScript(built.outputFiles[0].text)}</script></body></html>`);

// Other shipped active images are outside the bounded 69-file route. Use their
// real local game bytes when the isolated assets directory has no full dist.
async function existingGameImage(pathname) {
  if (!/^\/media\/[a-zA-Z0-9/_-]+\.(?:webp|png|jpe?g|gif|avif|svg)$/.test(pathname) || pathname.includes('..')) return null;
  for (const base of [path.join(ROOT, 'public'), ROOT, path.join(ROOT, 'dist')]) {
    const file = path.resolve(base, '.' + pathname);
    if (!file.startsWith(path.resolve(base) + path.sep)) continue;
    const bytes = await readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (bytes) return bytes;
  }
  return null;
}

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: all 69 exact Studio originals decode and the transformed startup bank caches completely`, { timeout: 120000 }, async () => {
  const runtime = await startStudioLocal({ assetsDir: directory });
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext(), page = await context.newPage();
  const errors = [], external = [], writes = [], delivered = new Set(), regularPaths = new Set();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (url.origin !== runtime.origin) { external.push(url.origin); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.method() + ' ' + url.pathname); return route.abort(); }
    const response = await route.fetch();
    if (url.pathname.startsWith('/api/studio/media/') && response.ok()) delivered.add(url.pathname);
    if (response.status() === 404 && regularPaths.has(url.pathname)) {
      const bytes = await existingGameImage(url.pathname);
      const types = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml' };
      if (bytes) return route.fulfill({ status: 200, contentType: types[path.extname(url.pathname)], body: bytes });
    }
    return route.fulfill({ response });
  });
  try {
    await page.goto(runtime.origin + '/api/studio/static-media-test/');
    await page.waitForFunction(() => !!window.studioMediaHarness);
    const urls = await page.evaluate(() => window.studioMediaHarness.urls);
    assert.ok(urls.length >= 400, 'actual active bank, including ordinary game media and covers');
    const paths = urls.map(value => new URL(value, runtime.origin + '/').pathname);
    const expectedPaths = manifest.map(item => `/api/studio/media/${item.sha256}.webp`);
    assert.deepEqual([...new Set(paths.filter(value => value.startsWith('/api/studio/media/')))].sort(), expectedPaths.sort(), 'the real bank reaches every bounded route');
    for (const item of manifest) assert.equal(paths.includes('/' + item.source), false, `original missing-host path was replaced: ${item.source}`);
    for (const pathname of paths) if (!pathname.startsWith('/api/studio/media/')) regularPaths.add(pathname);

    const decoded = await page.evaluate(async items => {
      const rows = [];
      for (const item of items) {
        const url = `/api/studio/media/${item.sha256}.webp`;
        const response = await fetch(url), bytes = await response.arrayBuffer();
        if (response.status !== 200) throw new Error(`Original unavailable: ${url} (${response.status})`);
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
        try {
          const image = new Image(); image.src = objectUrl; await image.decode();
          rows.push({ url, status: response.status, type: response.headers.get('content-type'), bytes: bytes.byteLength, sha256: digest, width: image.naturalWidth, height: image.naturalHeight });
        } finally { URL.revokeObjectURL(objectUrl); }
      }
      return rows;
    }, manifest);
    assert.equal(decoded.length, 69);
    for (let index = 0; index < manifest.length; index++) {
      const actual = decoded[index], expected = manifest[index];
      assert.equal(actual.status, 200, expected.source); assert.match(actual.type, /^image\/webp(?:;|$)/);
      assert.equal(actual.bytes, expected.bytes, expected.source); assert.equal(actual.sha256, expected.sha256, expected.source);
      assert.ok(actual.width > 0 && actual.height > 0, expected.source);
    }
    assert.equal(delivered.size, 69, 'every exact original passed through the actual local Studio route');
    const unknown = await page.evaluate(async () => (await fetch('/api/studio/media/' + '0'.repeat(64) + '.webp')).status);
    assert.equal(unknown, 404, 'arbitrary object keys cannot be fetched as public Studio media');

    const cached = await page.evaluate(() => window.studioMediaHarness.cache(window.studioMediaHarness.urls));
    assert.deepEqual(cached, { total: urls.length, ok: urls.length, failed: 0, persistent: true }, 'actual startup image cache reports no missing or unusable image');
    const cacheDigests = await page.evaluate(async items => {
      const cache = await caches.open('maydan-media-v1'), result = [];
      for (const item of items) {
        const response = await cache.match(`/api/studio/media/${item.sha256}.webp`);
        if (!response) { result.push(null); continue; }
        const bytes = await response.arrayBuffer();
        result.push([...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join(''));
      }
      return result;
    }, manifest);
    assert.deepEqual(cacheDigests, manifest.map(item => item.sha256), 'startup cache retains the unmodified originals');
    await context.setOffline(true);
    assert.deepEqual(await page.evaluate(() => window.studioMediaHarness.cache(window.studioMediaHarness.urls)), cached, 'a second startup succeeds fully offline');
    assert.equal(runtime.objects.size, 0, 'public source media never enters user-upload object storage');
    assert.deepEqual(writes, []); assert.deepEqual(external, []); assert.deepEqual(errors, []);
    console.log(`${name}: 69/69 exact originals decoded; ${urls.length}/${urls.length} startup images cached; offline retry complete`);
  } finally { await context.close(); await browser.close(); await runtime.close(); }
});
