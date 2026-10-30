import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { escapeInlineScript } from '../scripts/lib.mjs';

// The cache fixture holds real Splash in its background-progress state. No
// image/network timing assumption or duplicated status markup drives the test.
test('background image status preserves fraction order and passes taps while its close control remains usable', { timeout: 60000 }, async () => {
  const built = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{PreviewProviders}from'./src/design/preview-platform.jsx';import{Splash}from'./src/platform/screens/Splash.jsx';window.underlyingClicks=0;createRoot(document.getElementById('root')).render(<PreviewProviders sceneId="home"><button id="underlying" style={{position:'fixed',bottom:10,left:12,right:12,height:58}} onClick={()=>window.underlyingClicks++}>ابدأ اللعب</button><Splash visible={false} onDone={()=>{}}/></PreviewProviders>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl', '.svg': 'dataurl' }, plugins: [{ name: 'controlled-image-cache', setup(plugin) {
    plugin.onLoad({ filter: /startup-cache\.js$/ }, () => ({ contents: `export function cacheStartupImages(_urls,{onProgress}){onProgress({done:89,total:510,ok:89,failed:0});return new Promise(()=>{});}`, loader: 'js' }));
  } }], logLevel: 'silent' });
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${escapeInlineScript(built.outputFiles[0].text)}</script></html>`;
  const server = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ar', reducedMotion: 'reduce' });
        await page.goto(`http://127.0.0.1:${server.address().port}/#/`);
        const fraction = page.locator('.startup-background bdi'); await fraction.waitFor();
        for (const width of [320, 390]) {
          await page.setViewportSize({ width, height: 844 });
          await fraction.evaluate(node => { node.parentElement.style.fontSize = '20px'; });
          const order = await fraction.evaluate(node => {
            const range = document.createRange();
            range.selectNodeContents(node.firstChild); const completed = range.getBoundingClientRect();
            range.selectNodeContents(node.lastChild); const total = range.getBoundingClientRect();
            return { completed: completed.x, total: total.x, completedY: completed.y, totalY: total.y, direction: getComputedStyle(node).direction };
          });
          assert.equal(order.direction, 'ltr'); assert.ok(order.completed < order.total, `completed / total must retain its visual order inside the RTL sentence: ${JSON.stringify(order)}`);
          assert.equal(order.completedY, order.totalY, 'the fraction remains together when the Arabic status wraps');
        }
        await fraction.evaluate(node => { node.parentElement.style.fontSize = ''; });
        await page.getByRole('button', { name: 'ابدأ اللعب', exact: true }).click({ timeout: 2500 });
        assert.equal(await page.evaluate(() => window.underlyingClicks), 1);
        const close = page.getByRole('button', { name: 'إخفاء حالة الصور', exact: true });
        const box = await close.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
        await close.focus(); await page.keyboard.press('Enter');
        await page.locator('.startup-background').waitFor({ state: 'detached' });
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
