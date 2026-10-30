// Actual CallViewport/SocialHost and styles; account/social contexts are
// isolated Studio fixtures. This proves geometry and drafts, not provider voice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { escapeInlineScript } from '../scripts/lib.mjs';

test('full-page chat uses the space below a changing flow banner without losing keyboard, drafts or dialog focus', { timeout: 60000 }, async () => {
  const built = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PreviewProviders}from'./src/design/preview-platform.jsx';import{CallViewport}from'./src/social/CallViewport.jsx';import{SocialHost}from'./src/social/SocialHost.jsx';
    const root=createRoot(document.getElementById('root'));window.unmountFixture=()=>root.unmount();root.render(<PreviewProviders sceneId="social.conversation"><aside id="flow-banner" style={{padding:'14px 16px',font:'15px/1.5 system-ui',background:'#fff1cf'}}>معاينة محلية معزولة — شريط تنبيه طبيعي الارتفاع يبقى ظاهرًا فوق التطبيق.</aside><CallViewport><div data-social-page-slot/></CallViewport><SocialHost/></PreviewProviders>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl', '.svg': 'dataurl' }, logLevel: 'silent' });
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${escapeInlineScript(built.outputFiles[0].text)}</script></html>`;
  const server = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 430, height: 932 }, locale: 'ar', reducedMotion: 'reduce' });
        await page.goto(`http://127.0.0.1:${server.address().port}/#/friends/studio-sara`);
        const input = page.locator('textarea'); await input.waitFor();
        await page.evaluate(() => { document.body.style.margin = '8px'; });
        const inViewport = async () => {
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.waitForFunction(() => {
            const input = document.querySelector('textarea'), banner = document.getElementById('flow-banner');
            if (!input || !banner) return false;
            const rect = input.getBoundingClientRect(), bar = banner.getBoundingClientRect(), panel = document.querySelector('.lamma-page-panel').getBoundingClientRect(), body = getComputedStyle(document.body);
            const bottom = innerHeight - parseFloat(body.marginBottom) - parseFloat(body.paddingBottom);
            return Math.abs(panel.bottom - bottom) < 1 && rect.top >= bar.bottom && rect.bottom <= bottom && document.documentElement.scrollHeight <= innerHeight + 1;
          });
          const box = await input.boundingBox(); assert.ok(box.height >= 44);
        };
        for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }, { width: 390, height: 490 }]) {
          await page.setViewportSize(viewport); await inViewport();
        }
        await input.fill('مسودة محلية A · دون إرسال');
        const before = await page.locator('.lamma-page-panel').boundingBox();
        await page.evaluate(() => { document.getElementById('flow-banner').textContent += ' تنبيه إضافي يتمدد مع طول النص وتغيّر مساحة الشاشة، دون تغيير مقاس نافذة المتصفح.'; });
        await inViewport();
        const after = await page.locator('.lamma-page-panel').boundingBox();
        assert.ok(after.height < before.height, 'flow/header changes must resize the page without a viewport event');
        // A safe-area allocation is ordinary ancestor padding; it must also be
        // reserved without pretending this browser owns an actual iPhone notch.
        await page.evaluate(() => { document.body.style.paddingBottom = '24px'; });
        await inViewport();
        assert.equal(await input.inputValue(), 'مسودة محلية A · دون إرسال');
        assert.ok(await input.evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16));
        await page.getByRole('button', { name: 'إعدادات التنبيهات', exact: true }).click();
        const dialog = page.getByRole('dialog'); await dialog.waitFor();
        assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
        assert.equal(await input.inputValue(), 'مسودة محلية A · دون إرسال');
        await page.evaluate(() => { window.retiredViewport = document.querySelector('.call-game-viewport'); window.unmountFixture(); });
        assert.equal(await page.evaluate(() => window.retiredViewport.style.getPropertyValue('--app-viewport-height')), '');
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('the actual scripted Mafia tutorial stays inside the remaining viewport below an external flow banner', { timeout: 60000 }, async () => {
  const built = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{PreviewProviders}from'./src/design/preview-platform.jsx';import{CallViewport}from'./src/social/CallViewport.jsx';import{MafiaTutorialPreview}from'./src/games/mafia/tutorial/MafiaTutorial.jsx';createRoot(document.getElementById('root')).render(<PreviewProviders sceneId="mafia.tutorial"><aside id="flow-banner" style={{padding:'14px 16px',font:'15px/1.5 system-ui',background:'#fff1cf'}}>معاينة محلية معزولة — شريط تنبيه طبيعي فوق التدريب مع الشخصيات المصطنعة.</aside><CallViewport><MafiaTutorialPreview/></CallViewport></PreviewProviders>);`, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl', '.svg': 'dataurl' }, logLevel: 'silent' });
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${escapeInlineScript(built.outputFiles[0].text)}</script></html>`;
  const server = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 430, height: 932 }, locale: 'ar', reducedMotion: 'reduce' });
        await page.goto(`http://127.0.0.1:${server.address().port}/#/tutorial/mafia`);
        await page.locator('.mafia-tutorial-screen').waitFor();
        await page.evaluate(() => { document.body.style.margin = '8px'; });
        for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }, { width: 390, height: 490 }]) {
          await page.setViewportSize(viewport);
          await page.waitForFunction(() => {
            const frame = document.querySelector('.mafia-tutorial-screen')?.getBoundingClientRect();
            return frame && frame.bottom <= innerHeight - 7 && document.documentElement.scrollHeight <= innerHeight + 1;
          });
          const coach = page.locator('[data-design-id="tutorial-continue"]');
          assert.ok(await coach.isVisible());
          const box = await coach.boundingBox(); assert.ok(box.height >= 44 && box.y + box.height <= viewport.height);
        }
        // Still the real tutorial engine: the coach advances through its normal
        // button, instead of replacing gameplay with a screenshot fixture.
        const initialStep = await page.locator('[data-design-id="tutorial-coach"]').getAttribute('data-lesson-step');
        await page.locator('[data-design-id="tutorial-continue"]').click();
        await page.waitForFunction(step => document.querySelector('[data-design-id="tutorial-coach"]').dataset.lessonStep !== step, initialStep);
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
