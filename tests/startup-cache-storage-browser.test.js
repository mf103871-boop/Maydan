import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { escapeInlineScript } from '../scripts/lib.mjs';

test('real image CacheStorage keeps exact versioned bytes and legacy entries offline across document reloads', { timeout: 45000 }, async () => {
  // A complete one-pixel PNG, checked by each browser's image decoder below.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const expectedHash = createHash('sha256').update(png).digest('hex');
  const bundle = await build({ stdin: { contents: `import{cacheStartupImages}from'./src/shared/media/startup-cache.js';window.warm=urls=>cacheStartupImages(urls);`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', logLevel: 'silent' });
  const html = `<!doctype html><meta charset="utf-8"><script>${escapeInlineScript(bundle.outputFiles[0].text)}</script>`;
  let imageRequests = 0;
  const server = createServer((request, response) => {
    if (new URL(request.url, 'http://local.test').pathname.endsWith('.png')) {
      imageRequests++; response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); response.end(png);
    } else { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const engine of [chromium, webkit]) {
      // Ephemeral WebKit intentionally discards CacheStorage entries on reload.
      // A fresh persistent profile exercises normal durable browser storage.
      const tempRoot = path.resolve(os.tmpdir()), profile = await mkdtemp(path.join(tempRoot, 'maydan-image-cache-'));
      let context;
      try {
        context = await engine.launchPersistentContext(profile, { headless: true });
        const page = context.pages()[0] || await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const base = `http://127.0.0.1:${server.address().port}`, urls = ['/a.png?v=1', '/a.png?v=2', '/b.png?v=3'];
        await page.goto(base); const before = imageRequests;
        assert.deepEqual(await page.evaluate(urls => window.warm(urls), urls), { total: 3, ok: 3, failed: 0, persistent: true });
        assert.equal(imageRequests - before, 3, 'each version is fetched exactly once');
        const bytes = await page.evaluate(async urls => {
          const cache = await caches.open('maydan-media-v1'), proof = [];
          for (const url of urls) {
            const response = await cache.match(url), buffer = await response.arrayBuffer();
            const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
            proof.push({ url, digest, length: buffer.byteLength, header: response.headers.get('content-length'), mime: response.headers.get('content-type') });
          }
          // A pre-existing cache response without length must remain usable.
          const legacy = await cache.match(urls[0]);
          await cache.put('/legacy.png?v=old', new Response(await legacy.arrayBuffer(), { headers: { 'content-type': 'image/png' } }));
          return proof;
        }, urls);
        assert.deepEqual(bytes, urls.map(url => ({ url, digest: expectedHash, length: png.length, header: String(png.length), mime: 'image/png' })));
        await page.reload();
        const afterReload = await page.evaluate(async () => (await (await caches.open('maydan-media-v1')).keys()).map(key => key.url));
        await context.setOffline(true);
        const offline = await page.evaluate(async urls => {
          Response.prototype.blob = () => { throw new Error('Native cache must not create a document-backed Blob'); };
          const result = await window.warm([...urls, '/legacy.png?v=old']);
          const cache = await caches.open('maydan-media-v1'), cached = await cache.match(urls[0]);
          if (!cached) return { result, missingCachedImage: true, keys: (await cache.keys()).map(key => key.url), origin: location.origin };
          const raw = new Uint8Array(await cached.arrayBuffer()), image = new Image();
          image.src = 'data:image/png;base64,' + btoa(String.fromCharCode(...raw)); await image.decode();
          return { result, width: image.naturalWidth, height: image.naturalHeight };
        }, urls);
        assert.deepEqual(offline, { result: { total: 4, ok: 4, failed: 0, persistent: true }, width: 1, height: 1 }, JSON.stringify({ afterReload }));
        assert.equal(imageRequests - before, 3, 'reload and offline warm must retain the original versioned cache');
        assert.deepEqual(errors, []);
      } finally {
        await context?.close();
        assert.equal(path.dirname(path.resolve(profile)), tempRoot);
        assert.ok(path.basename(profile).startsWith('maydan-image-cache-'));
        await rm(profile, { recursive: true, force: true });
      }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
