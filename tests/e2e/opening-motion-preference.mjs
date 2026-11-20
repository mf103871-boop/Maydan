// Hold the final native receipt at the local transport boundary. Render the
// real boot template, verifier and controller, then change the OS preference.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const bundle = await build({ stdin: { contents: "import { initializeOpening } from './src/boot/opening.js'; window.opening = initializeOpening();", resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', logLevel: 'silent' });
const template = await readFile('src/index.template.html', 'utf8');
const html = template.slice(0, template.indexOf('<script>')) + '<script src="./fixture.js"></script></body></html>';
const origin = 'https://appassets.androidplatform.net/game/';
const rows = [];
for (const [engine, type] of Object.entries({ webkit, chromium })) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference', serviceWorkers: 'block' });
    let release;
    const lastBatch = new Promise(resolve => { release = resolve; });
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (!url.startsWith(origin)) return route.abort();
      const asset = url.slice(origin.length);
      if (!asset) return route.fulfill({ contentType: 'text/html', body: html });
      if (asset === 'fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      if (asset.startsWith('opening/')) return route.fulfill({ path: path.resolve('public', asset) });
      if (asset.startsWith('__installed_pack__/')) {
        const batch = Number(asset.split('/').pop());
        if (batch === 1) await lastBatch;
        return route.fulfill({ json: { batch, batches: 2, bytes: 32, files: 1, totalBytes: 64, totalFiles: 2 } });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    const motion = () => page.evaluate(() => ['glint', 'ripple'].map(id => document.getElementById('opening-' + id).getAnimations().filter(a => a.playState !== 'finished').length));
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('opening-ripple').getAnimations().some(a => a.playState === 'running'));
      const before = await motion();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const after = await motion();
      const blocked = await page.evaluate(() => document.getElementById('root').hidden && !window.opening.verified);
      release();
      await page.evaluate(() => window.opening.ready);
      const verified = await page.evaluate(() => window.opening.verified);
      rows.push({ engine, before, after, blocked, verified });
    } finally { release(); }
  } finally { await browser.close(); }
}
const out = process.env.E2E_OUTPUT_DIR || '.cache/opening-motion';
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'opening-motion.json'), JSON.stringify(rows, null, 2));
for (const row of rows) {
  assert.deepEqual(row.before, [1, 1], JSON.stringify(row));
  assert.deepEqual(row.after, [0, 0], JSON.stringify(row));
  assert.ok(row.blocked && row.verified, 'Changing motion must preserve the full pack gate');
}
console.log('Both engines stopped in-flight milestone effects and waited for the final receipt.');
