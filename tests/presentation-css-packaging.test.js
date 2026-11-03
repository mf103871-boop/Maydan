import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { presentationCssPlugin } from '../scripts/presentation-css.mjs';
import { ROOT, renderServiceWorker, preloadLinks } from '../scripts/lib.mjs';

const CSS = '.presentation-probe{color:rgb(18,109,112);padding-inline:19px;--presentation-art:"أهلاً ميدان"}@media(prefers-reduced-motion:reduce){.presentation-probe{transition:none}}';
async function fixture(t, css = CSS) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'maydan-presentation-css-'));
  const file = path.join(folder, 'fixture.css');
  await writeFile(file, css);
  t.after(async () => {
    const target = await realpath(folder), parent = await realpath(os.tmpdir());
    assert.equal(path.dirname(target), parent); assert.ok(path.basename(target).startsWith('maydan-presentation-css-'));
    await rm(target, { recursive: true, force: true });
  });
  return { folder, file };
}
async function compile(file, { assets = 'files', minify = true, source } = {}) {
  return build({ stdin: { contents: source || `import sheet from ${JSON.stringify(file + '?sheet')};globalThis.presentationSheet=sheet;`, resolveDir: ROOT, loader: 'jsx' },
    bundle: true, format: 'iife', write: false, outfile: path.join(path.dirname(file), 'dist/bundle.js'),
    assetNames: 'assets/brand/[name]-[hash]', jsx: 'automatic', loader: { '.css': 'text' }, minify,
    plugins: [presentationCssPlugin({ assets, minify })], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
}

test('presentation CSS emits hashed local files with unchanged declarations and changes URL only when bytes change', async t => {
  const { file } = await fixture(t);
  const result = await compile(file), again = await compile(file);
  const sheet = result.outputFiles.find(output => output.path.endsWith('.css'));
  assert.ok(sheet); assert.match(sheet.path.replaceAll('\\', '/'), /assets\/brand\/fixture-[A-Z0-9]+\.css$/);
  assert.equal(again.outputFiles.find(output => output.path.endsWith('.css')).path, sheet.path);
  assert.match(sheet.text, /padding-inline:19px/); assert.match(sheet.text, /prefers-reduced-motion:reduce/); assert.match(sheet.text, /أهلاً ميدان/);
  const script = result.outputFiles.find(output => output.path.endsWith('.js')).text;
  assert.doesNotMatch(script, /padding-inline|data:text\/css|createObjectURL/);
  assert.ok(script.includes(path.basename(sheet.path)));
  await writeFile(file, CSS.replace('19px', '23px'));
  assert.notEqual((await compile(file)).outputFiles.find(output => output.path.endsWith('.css')).path, sheet.path);
});

test('standalone and development builds keep complete CSS without needing an asset route', async t => {
  const { file } = await fixture(t);
  for (const minify of [false, true]) {
    const result = await compile(file, { assets: 'inline', minify });
    assert.equal(result.outputFiles.length, 1); assert.match(result.outputFiles[0].text, /padding-inline/);
    assert.doesNotMatch(result.outputFiles[0].text, /assets\/brand\/|fetch\(|createObjectURL/);
  }
});

test('relocated sheets reject relative resources and nested imports instead of shipping broken URLs', async t => {
  const { file } = await fixture(t);
  for (const css of ['.x{background:url(./missing.webp)}', '.x{background:url("../portrait.webp")}', '@import "other.css";.x{color:red}']) {
    await writeFile(file, css);
    await assert.rejects(compile(file), /relative URLs and @import are unsupported/);
  }
  await writeFile(file, '.x{mask:url(#local-mask);background-image:url("/assets/plus/v2/sahra-room.webp")}');
  assert.ok((await compile(file)).outputFiles.some(file => file.path.endsWith('.css')));
});

test('the existing release preloads and offline shell manifest include emitted CSS as required local resources', async t => {
  const { file } = await fixture(t), result = await compile(file);
  const assets = result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => './assets/brand/' + path.basename(file.path));
  assert.match(preloadLinks(assets), /rel="preload" as="style"/);
  const sw = renderServiceWorker(await readFile(path.join(ROOT, 'public/sw.js'), 'utf8'), { id: 'presentation-fixture', brandAssets: assets });
  for (const url of assets) assert.ok(sw.includes(JSON.stringify(url)));
  assert.doesNotMatch(sw, /__BUILD_ID__|\/\*__BRAND_ASSETS__\*\/\[\]/);
});

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: actual linked CSS survives packaged local paths, mount lifecycle and a real service-worker offline reload`, { timeout: 60_000 }, async t => {
  const { file, folder } = await fixture(t);
  const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{PresentationStyles}from'./src/shared/ui/PresentationStyles.jsx';import sheet from ${JSON.stringify(file + '?sheet')};
  function App(){const[enabled,setEnabled]=useState(true);globalThis.setPresentation= setEnabled;return <>{enabled&&<PresentationStyles sheet={sheet}/>}<p className="presentation-probe">ميدان</p></>};createRoot(document.getElementById('root')).render(<App/>);`;
  const result = await compile(file, { source });
  const assets = new Map(result.outputFiles.map(file => ['/' + path.relative(path.join(folder, 'dist'), file.path).replaceAll('\\', '/'), file.contents]));
  const cssPath = [...assets.keys()].find(url => url.endsWith('.css'));
  const sw = renderServiceWorker(await readFile(path.join(ROOT, 'public/sw.js'), 'utf8'), { id: 'presentation-browser', brandAssets: ['./bundle.js', '.' + cssPath] });
  const html = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
  let cssReads = 0, networkAvailable = true;
  const server = http.createServer((req, res) => {
    if (!networkAvailable) { res.destroy(); return; }
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'; img-src 'self'");
    if (pathname === '/sw.js') { res.setHeader('content-type', 'text/javascript'); res.end(sw); }
    else if (assets.has(pathname)) { if (pathname.endsWith('.css')) cssReads++; res.setHeader('content-type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(assets.get(pathname)); }
    else if (pathname === '/' || pathname === '/index.html') { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(html); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const browser = await engine.launch({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext(); const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin + '/index.html');
  await page.waitForFunction(() => { const element = document.querySelector('.presentation-probe'); return element && getComputedStyle(element).paddingInlineStart === '19px'; });
  assert.equal(await page.locator('[data-presentation-sheet=file]').count(), 1);
  await page.evaluate(() => window.setPresentation(false));
  await page.waitForFunction(() => !document.querySelector('[data-presentation-sheet]'));
  await page.waitForFunction(() => { const element = document.querySelector('.presentation-probe'); return element && getComputedStyle(element).paddingInlineStart !== '19px'; });
  await page.evaluate(() => window.setPresentation(true));
  await page.waitForFunction(() => { const element = document.querySelector('.presentation-probe'); return element && getComputedStyle(element).paddingInlineStart === '19px'; });
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.ok(cssReads > 0); const before = cssReads;
  // Cut the real fixture HTTP transport. WebKit's automation setOffline can
  // reject a service-worker navigation before dispatching its fetch event.
  networkAvailable = false;
  await assert.rejects(fetch(origin + '/uncached-network-proof'), /fetch failed/);
  await page.reload();
  await page.waitForFunction(() => { const element = document.querySelector('.presentation-probe'); return element && getComputedStyle(element).paddingInlineStart === '19px'; });
  assert.equal(cssReads, before, 'offline stylesheet is served from the actual required shell cache');
  assert.deepEqual(errors, []);
});
