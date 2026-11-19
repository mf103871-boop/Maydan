// Real shared controls, pointer input and computed motion in both browser engines.
// The core-only case also protects consumers that do not mount the brand layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const output = process.env.SHARED_MOTION_EVIDENCE_DIR || path.join(process.cwd(), '.cache/shared-ui-motion');
const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{Button,Modal,Sheet}from'./src/shared/ui/components.jsx';
import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import brand from'./src/shared/brand/brand.css';
function App(){const[open,setOpen]=useState(false),[sheet,setSheet]=useState(false),[clicks,setClicks]=useState(0);return <>
<style>{tokens}</style><style>{ui}</style>{location.search.includes('brand')&&<style>{brand}</style>}
<main style={{padding:24,display:'grid',gap:24}}><Button id="press" onClick={()=>setClicks(n=>n+1)} onPointerDown={event=>{
const ripple=event.currentTarget.querySelector('.ripple');window.rippleAtPress=ripple?{duration:getComputedStyle(ripple).animationDuration,name:getComputedStyle(ripple).animationName}:null;
}}>اختبار الضغط</Button><output id="clicks">{clicks}</output><Button id="open" onClick={()=>setOpen(true)}>افتح النافذة</Button><Button id="open-sheet" onClick={()=>setSheet(true)}>افتح اللوحة</Button></main>
{open&&<Modal placement="bottom" title="نافذة سفلية" onClose={()=>setOpen(false)}><p>محتوى النافذة المشتركة</p></Modal>}
{sheet&&<Sheet open title="لوحة الخيارات" onClose={()=>{window.sheetClosedAt=performance.now();setSheet(false);}}><p>خيارات اللعبة</p></Sheet>}</>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const html = '<!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>' + bundle.outputFiles[0].text + '</script></html>';
const server = createServer((_, response) => { response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); response.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir(output, { recursive: true });
test.after(() => new Promise(resolve => server.close(resolve)));

const state = locator => locator.evaluate(element => {
  const css = getComputedStyle(element), ripple = element.querySelector('.ripple');
  return { active: element.matches(':active'), transform: css.transform, transitionDuration: css.transitionDuration, shadow: css.boxShadow, rect: element.getBoundingClientRect().toJSON(), ripple: ripple ? { opacity: getComputedStyle(ripple).opacity, duration: getComputedStyle(ripple).animationDuration } : null };
});
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: shared button and docked modal honor normal, OS and app motion`, { timeout: 45000 }, async () => {
  const browser = await engine.launch({ headless: true });
  const observations = [];
  try {
    for (const layer of ['core', 'brand']) for (const mode of ['normal', 'os-reduced', 'app-reduced']) {
      const page = await browser.newPage({ viewport: { width: 393, height: 852 }, reducedMotion: mode === 'os-reduced' ? 'reduce' : 'no-preference' });
      const errors = [], external = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { external.push('blocked-external-request'); return route.abort(); } return route.continue(); });
      if (mode === 'app-reduced') await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.reducedMotion = 'true'; }); });
      try {
        await page.goto(`${origin}/?${layer}`);
        const button = page.locator('#press');
        await button.waitFor();
        await tick(page);
        const before = await state(button), box = before.rect;
        assert.equal(before.transform, 'none');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await tick(page);
        const first = await state(button);
        assert.equal(first.active, true, 'the real pointer is held down on the button');
        assert.notEqual(first.shadow, before.shadow, 'pressed feedback remains visible');
        const rippleAtPress = await page.evaluate(() => window.rippleAtPress);
        assert.ok(rippleAtPress, 'the real Button pointer handler ran');
        if (mode === 'normal') {
          assert.equal(first.transitionDuration.split(',')[0].trim(), '0.09s');
          assert.equal(before.transitionDuration.split(',')[0].trim(), '0.14s');
          assert.equal(rippleAtPress.duration, '0.55s');
          await page.waitForFunction(() => getComputedStyle(document.querySelector('#press')).transform === 'matrix(0.98, 0, 0, 0.98, 0, 1)');
        } else {
          assert.equal(first.transform, 'none', 'reduced motion removes scale/translation, not only their duration');
          assert.deepEqual(first.rect, before.rect, 'held button geometry stays fixed');
          assert.ok(parseFloat(rippleAtPress.duration) <= 0.00001, 'existing reduced-motion rules finish the decorative ripple immediately');
          assert.ok(!first.ripple || Number(first.ripple.opacity) === 0, 'no visible expanding ripple remains after a rendering frame');
        }
        const held = await state(button);
        await page.mouse.up();
        await page.waitForFunction(() => document.querySelector('#clicks').textContent === '1');
        const released = await state(button);
        if (mode === 'normal') assert.equal(released.transitionDuration.split(',')[0].trim(), '0.14s');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('#press')).transform === 'none');
        // Use keyboard activation for the dialog so its invoking focus is
        // explicit in both engines; the press test above uses real pointer input.
        await page.locator('#open').focus();
        await page.locator('#open').press('Enter');
        const dialog = page.getByRole('dialog', { name: 'نافذة سفلية' });
        await dialog.waitFor();
        const modal = await dialog.evaluate(element => ({ name: getComputedStyle(element).animationName, duration: getComputedStyle(element).animationDuration, role: element.getAttribute('aria-modal') }));
        assert.equal(modal.name, 'ui-sheet-in');
        assert.equal(modal.role, 'true');
        if (mode === 'normal') assert.equal(modal.duration, '0.26s', 'docked modal uses the approved sheet duration');
        else assert.ok(parseFloat(modal.duration) <= 0.00001);
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]').getAnimations().some(animation => animation.playState === 'running'));
        if (layer === 'core' && mode === 'normal') await page.screenshot({ path: path.join(output, `${name}-docked-modal.png`) });
        await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.activeElement === document.querySelector('#open'));
        await page.locator('#open-sheet').focus();
        await page.locator('#open-sheet').press('Enter');
        const sheet = page.getByRole('dialog', {name:'لوحة الخيارات'});
        await sheet.waitFor();
        const sheetEnter = await sheet.evaluate(element => ({name:getComputedStyle(element).animationName,duration:getComputedStyle(element).animationDuration}));
        assert.equal(sheetEnter.name,'ui-sheet-in');
        if(mode==='normal') assert.equal(sheetEnter.duration,'0.26s');
        else assert.ok(parseFloat(sheetEnter.duration)<=0.00001);
        await page.waitForFunction(() => !document.querySelector('.sheet').getAnimations().some(animation=>animation.playState==='running'));
        await page.evaluate(()=>document.addEventListener('keydown',event=>{if(event.key==='Escape')window.sheetCloseRequestedAt=performance.now();},{capture:true,once:true}));
        await sheet.press('Escape');
        if(mode==='normal') {
          const sheetExit=await sheet.evaluate(element=>({name:getComputedStyle(element).animationName,duration:getComputedStyle(element).animationDuration}));
          assert.deepEqual(sheetExit,{name:'ui-sheet-out',duration:'0.18s'});
        }
        await sheet.waitFor({state:'detached'});
        await page.waitForFunction(()=>document.activeElement===document.querySelector('#open-sheet'));
        const sheetCloseElapsed=await page.evaluate(()=>window.sheetClosedAt-window.sheetCloseRequestedAt);
        if(mode==='normal') assert.ok(sheetCloseElapsed>=175,'the close transition finishes before removing the dialog');
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        observations.push({ layer, mode, before, first, held, released, rippleAtPress, modal, sheetEnter, sheetCloseElapsed, clickCount: 1, focusRestored: true, pageErrors: errors, externalRequests: external });
      } finally { await page.close(); }
    }
    await writeFile(path.join(output, `${name}.json`), JSON.stringify({ engine: name, passed: true, physicalDevice: false, fixture: 'Actual Button and Modal with real CSS, local in-memory bundle; no API/account/game state.', observations }, null, 2) + '\n');
  } finally { await browser.close(); }
});
