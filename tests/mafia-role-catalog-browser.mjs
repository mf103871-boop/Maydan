// Browser proof of the shipped role components, with memory-only fixture state.
// No room, account, microphone, deployment or provider is created by this test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

let server, browser, origin, script;
const output = path.resolve('.cache/mafia-role-catalog-browser');
before(async () => {
  await mkdir(output, { recursive: true });
  const result = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{MafiaRules,MafiaMatch}from'./src/online/Mafia.jsx';import{createDesignFixture}from'./src/design/screen-catalog.js';import tokens from './src/shared/theme/tokens.css';import ui from './src/shared/ui/ui.css';import brand from './src/shared/brand/brand.css';const root=createRoot(document.getElementById('root'));window.guideEvents=[];window.showRoleFixture=kind=>{const{state,me}=createDesignFixture('online.mafia.night',{now:Date.now()});state.previewReveal=false;root.render(<><style>{tokens+ui+brand}</style>{kind==='guide'?<MafiaRules key="guide" defaultOpen onGuide={event=>window.guideEvents.push(event)} onTutorial={()=>window.guideEvents.push('tutorial')}/>:<MafiaMatch key="match" state={state} me={me} isHost act={()=>true} accountId="owner" tutorial={{onGuide:event=>window.guideEvents.push(event)}}/>}</>)};window.showRoleFixture('guide');`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
  script = result.outputFiles[0].text;
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname;
    if (pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="ar" dir="rtl" data-reduced-motion="true"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return; }
    if (pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript; charset=utf-8'); res.end(script); return; }
    const file = path.resolve('public', '.' + decodeURIComponent(pathname));
    if (file.startsWith(path.resolve('public') + path.sep)) try { const data = await readFile(file); res.setHeader('content-type', path.extname(file) === '.webp' ? 'image/webp' : 'application/octet-stream'); res.end(data); return; } catch {}
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  const engine = process.env.MAFIA_E2E_ENGINE === 'webkit' ? webkit : chromium;
  browser = await engine.launch(engine === chromium && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve)); });

test('role details remain readable, keyboard operable, scrollable and private at phone and landscape widths', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage(), errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await page.goto(origin);
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await page.evaluate(() => window.showRoleFixture('guide'));
    const guide = page.getByRole('dialog', { name: 'دليل مافيا ميدان' }); await guide.waitFor();
    const disclosure = guide.locator('[data-role-id="leader"] details');
    await disclosure.locator('summary').focus(); await page.keyboard.press('Enter');
    assert.equal(await disclosure.getAttribute('open'), '');
    await disclosure.locator('.mafia-role-example').scrollIntoViewIfNeeded();
    const measure = await disclosure.evaluate(element => { const content = element.querySelector('.mafia-role-example'), body = element.closest('.modal-body'), rect = content.getBoundingClientRect(), bounds = body.getBoundingClientRect(); return { overflow: body.scrollWidth - body.clientWidth, exampleFits: rect.left >= bounds.left && rect.right <= bounds.right + 1, scrolled: body.scrollTop > 0, direction: getComputedStyle(element.querySelector('.mafia-role-details')).direction }; });
    assert.ok(measure.overflow <= 1); assert.equal(measure.exampleFits, true); assert.equal(measure.scrolled, true); assert.equal(measure.direction, 'rtl');
    await page.screenshot({ path: path.join(output, `guide-${viewport.width}x${viewport.height}.png`) });
    await guide.getByRole('button', { name: 'إغلاق', exact: true }).click(); await guide.waitFor({ state: 'detached' });
    await page.evaluate(() => window.showRoleFixture('card'));
    assert.equal(await page.locator('[data-design-id="role-content"]').count(), 0);
    await page.locator('[data-design-id="role-toggle"]').click();
    const card = page.getByRole('dialog', { name: 'بطاقتك الخاصة' }); await card.waitFor();
    await card.locator('summary').click(); await card.getByText('المتبقي لك الآن', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `card-${viewport.width}x${viewport.height}.png`) });
    await card.locator('[data-design-id="role-hide"]').click(); await card.waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-design-id="role-content"]').count(), 0);
  }
  const events = await page.evaluate(() => window.guideEvents);
  assert.ok(events.includes('encyclopedia-close')); assert.ok(events.includes('role-open')); assert.ok(events.includes('role-close'));
  assert.deepEqual(errors, []); assert.deepEqual(writes, []); await context.close();
});
