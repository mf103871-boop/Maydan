// Actual production dialogs with a synthetic report sink. No reports are sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { presentationCssPlugin } from '../scripts/presentation-css.mjs';

const source = `import React from 'react';import{createRoot}from'react-dom/client';
import{ActionDialog}from'./src/social/SocialScreen.jsx';import{SafetyDialog}from'./src/profiles/ProfileScreen.jsx';
import{setUiLocale}from'./src/shared/i18n/core.js';import{useI18n}from'./src/shared/i18n/react.jsx';
import tokens from './src/shared/theme/tokens.css';import css from './src/shared/ui/ui.css';
window.submittedReports=[];window.changeLocale=setUiLocale;
const social={offline:false,reportUser:async(id,body)=>window.submittedReports.push({id,body})};
const profile={id:'test-person',name:'شخص Test'};const done=()=>{};
function Harness(){useI18n();return <><style>{tokens+css}</style>{location.search==='?profile'?<SafetyDialog action='report' profile={profile} social={social} onClose={done} onDone={done}/>:<ActionDialog action={{kind:'report',user:profile}} social={social} onClose={done} onComplete={done}/>}</>;}
createRoot(document.getElementById('root')).render(<Harness/>);`;

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: changing UI language preserves report reasons, user draft and API values in both production dialogs`, { timeout: 60000 }, async t => {
    const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false,
      format: 'iife', jsx: 'automatic', plugins: [presentationCssPlugin()], loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
    const server = http.createServer((req, res) => {
      if (req.url === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
      res.setHeader('content-type', 'text/html;charset=utf-8');
      res.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const browser = await engine.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const origin = `http://127.0.0.1:${server.address().port}`, errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin || url.protocol === 'data:') return route.continue(); external.push(url.origin); return route.abort(); });
    for (const scene of ['social', 'profile']) {
      await page.goto(`${origin}/?${scene}`);
      const reason = page.locator('[data-design-id="report-reason"]'), details = page.locator('[data-design-id="report-details"]');
      await reason.selectOption('رسائل مزعجة');
      const draft = 'هذا نص شخصي keeps its original words';
      await details.fill(draft);
      await reason.evaluate(element => { window.originalReasonControl = element; });
      await page.evaluate(() => window.changeLocale('en'));
      await page.waitForFunction(() => document.documentElement.lang === 'en');
      assert.equal(await reason.inputValue(), 'رسائل مزعجة');
      assert.equal(await details.inputValue(), draft);
      assert.equal(await reason.evaluate(element => element === window.originalReasonControl), true, 'The selected form must remain mounted.');
      assert.doesNotMatch(await reason.locator('option:checked').innerText(), /\p{Script=Arabic}/u);
      await page.locator(`[data-design-id="${scene === 'social' ? 'confirm' : 'submit'}"]`).click();
      assert.deepEqual(await page.evaluate(() => window.submittedReports), [{ id: 'test-person', body: { reason: `رسائل مزعجة: ${draft}` } }]);
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
  });
}
