// Actual platform/Home render; isolated guest storage and a delayed native
// session bridge. All external requests are blocked, no accounts or services.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { esbuildOptions } from '../../scripts/lib.mjs';
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';

const output = process.env.E2E_OUTPUT_DIR || '.cache/native-home-ready';
await fs.mkdir(output, { recursive: true });
const bundle = await build({ ...esbuildOptions({ minify: true }), format: 'esm' });
const html = '<!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/app.js"></script></html>';
const server = http.createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
  else if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(html); }
  else { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"OFFLINE_TEST"}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const result = { scope: 'Real platform/Home in local Chromium/WebKit with synthetic native bridge; not iOS simulator proof', engines: [] };
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const token = 'e7b0d07a-7fcb-4b58-86c7-32aff0457518';
      await page.addInitScript(token => {
        window.__maydanSimulatorLaunchToken = token;
        window.MaydanNative = {};
        window.__readinessMessages = [];
        window.webkit = { messageHandlers: { maydan: { postMessage(message) {
          if (message.type === 'simulatorGameReady') window.__readinessMessages.push(message);
          else if (message.type === 'socialStoredSession') window.__releaseAccount = () => window.maydanNative.resolve(message.id, { ok: true, result: null });
          else if (message.id) queueMicrotask(() => window.maydanNative.resolve(message.id, { ok: true, result: {} }));
        } } } };
      }, token);
      await page.goto(origin);
      await page.locator('[data-design-screen="home"]').waitFor({ timeout: 10000 }).catch(async error => {
        const diagnostics = { errors, body: (await page.locator('body').innerText()).slice(0, 1500) };
        await fs.writeFile(`${output}/${name}-failure.json`, JSON.stringify(diagnostics, null, 2));
        throw error;
      });
      assert.equal(await page.locator('button.game-card').count(), 8);
      assert.equal(await page.evaluate(() => window.__readinessMessages.length), 0, 'Home DOM alone is not account initialization');
      await page.evaluate(() => window.__releaseAccount());
      await page.waitForFunction(() => window.__readinessMessages.length === 1);
      const receipt = await page.evaluate(() => window.__readinessMessages[0]);
      assert.deepEqual(receipt, { type: 'simulatorGameReady', token, route: 'home', gameCardCount: 8, initialized: true });
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/${name}-home.png` });
      result.engines.push({ name, initializedHome: true, waitedForNativeAccount: true, receipt, errors });
    } finally { await browser.close(); }
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fs.writeFile(`${output}/results.json`, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result));
