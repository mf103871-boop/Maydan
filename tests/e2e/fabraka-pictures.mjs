// Browser/Service Worker integration with in-memory fixtures. No shared dist,
// provider requests, image generation or external assets are needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
let server, browser, origin, mode = 'ok', requests = 0;
const errors = [];
before(async () => {
  const fixtureImage = await readFile(new URL('../../src/shared/brand/assets/mark.webp', import.meta.url));
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Illustration} from './src/games/fabraka/Illustration.jsx';
      import css from './src/games/fabraka/fabraka.css';
      import ui from './src/shared/ui/ui.css';
      import tokens from './src/shared/theme/tokens.css';
      function View() {
        const [id,setId]=useState('001');
        return <main className="fabraka" style={{maxWidth:520,margin:'auto'}}><style>{tokens+ui+css}</style>
          <Illustration question={{image:'media/fabraka-v3/fab3-'+id+'.webp',imageDescription:'أداة فضية ذات أطراف مستديرة',answer:'PRIVATE_ANSWER',sourceUrl:'https://secret.test/answer'}} />
          <button onClick={()=>setId('002')}>الصورة التالية</button>
        </main>;
      }
      createRoot(document.getElementById('app')).render(<View/>);
      if(new URLSearchParams(location.search).has('sw')) navigator.serviceWorker.register('./sw.js');
    ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { __MAYDAN_MEDIA_VERSIONS__: JSON.stringify({ 'fabraka-v3': 'unit' }) },
    loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent',
  });
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`;
  const urls = ['001','002'].map((id) => `./media/fabraka-v3/fab3-${id}.webp?v=unit`);
  const sw = (await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8')).replaceAll('__BUILD_ID__', 'fabraka-test').replace('/*__FABRAKA_IMAGES__*/[]', JSON.stringify(urls));
  server = http.createServer((req,res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if(path === '/Maydan/sw.js') { res.writeHead(200, {'content-type':'text/javascript'});res.end(sw);return; }
    if(path.includes('/media/')) {
      requests++;
      res.writeHead(mode === 'fail' ? 503 : 200, {'content-type':mode === 'fail' ? 'text/plain' : 'image/webp','cache-control':'no-store'});
      res.end(mode === 'fail' ? 'unavailable' : fixtureImage);return;
    }
    if(path === '/Maydan/' || path === '/Maydan/index.html') { res.writeHead(200, {'content-type':'text/html'});res.end(html);return; }
    res.writeHead(404);res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {});
});
after(async () => {
  await browser?.close();
  if(server?.listening) await new Promise((resolve) => server.close(resolve));
  assert.deepEqual(errors, []);
});
async function fresh(t, nextMode = 'ok', sw = false) {
  mode = nextMode;requests = 0;
  const context = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  t.after(() => context.close());
  const page = await context.newPage();page.on('pageerror', (e)=>errors.push(e.message));
  await page.goto(`${origin}/Maydan/${sw?'?sw=1':''}`);
  return {page,context};
}

test('neutral images resolve under a Pages subpath and do not print the answer/source', async (t) => {
  const {page}=await fresh(t);
  await page.locator('.fab-picture-stage.is-ready').waitFor();
  const img=page.locator('.fab-picture-open img');
  assert.equal(await img.evaluate((el)=>el.currentSrc),`${origin}/Maydan/media/fabraka-v3/fab3-001.webp?v=unit`);
  assert.equal(await img.getAttribute('alt'),'أداة فضية ذات أطراف مستديرة');
  assert.doesNotMatch(await page.locator('main').innerHTML(),/PRIVATE_ANSWER|secret\.test|<svg/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
test('a failed image exposes retry and a repaired response becomes playable', async (t) => {
  const {page}=await fresh(t,'fail');
  await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'تكبير صورة الأداة'}).isEnabled(),false);
  mode='ok';await page.getByRole('button',{name:'إعادة تحميل الصورة'}).click();
  await page.locator('.fab-picture-stage.is-ready').waitFor();
  assert.ok(requests>=2);assert.equal(await page.getByRole('alert').count(),0);
});
test('keyboard zoom traps focus, closes with Escape and restores the opening button', async (t) => {
  const {page}=await fresh(t);await page.locator('.fab-picture-stage.is-ready').waitFor();
  const open=page.getByRole('button',{name:'تكبير صورة الأداة'});
  await open.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'صورة الأداة'});await dialog.waitFor();
  assert.equal(await dialog.getAttribute('aria-modal'),'true');
  await page.keyboard.press('Tab');assert.equal(await dialog.evaluate((el)=>el.contains(document.activeElement)),true);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  assert.equal(await open.evaluate((el)=>document.activeElement===el),true);
});
test('changing a round resets loading and cannot leave an old enlarged picture open', async (t) => {
  const {page}=await fresh(t);await page.locator('.fab-picture-stage.is-ready').waitFor();
  let release;
  const wait=new Promise((resolve)=>{release=resolve;});
  await page.route('**/fab3-002.webp?v=unit',async(route)=>{await wait;await route.continue();});
  await page.getByRole('button',{name:'الصورة التالية'}).click();
  await page.getByRole('status').waitFor();assert.equal(await page.getByRole('button',{name:'تكبير صورة الأداة'}).isEnabled(),false);
  release();await page.locator('.fab-picture-stage.is-ready').waitFor();
  assert.match(await page.locator('.fab-picture-open img').getAttribute('src'),/002\.webp/);
});
test('the service worker installs every picture for a later unseen round offline', async (t) => {
  const {page,context}=await fresh(t,'ok',true);
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  const cached=await page.evaluate(async()=>{const cache=await caches.open('maydan-media-v1');return(await cache.keys()).map((r)=>r.url);});
  for(const id of ['001','002']) assert.ok(cached.includes(`${origin}/Maydan/media/fabraka-v3/fab3-${id}.webp?v=unit`));
  await context.setOffline(true);await page.reload();await page.locator('.fab-picture-stage.is-ready').waitFor();
  await page.getByRole('button',{name:'الصورة التالية'}).click();await page.locator('.fab-picture-stage.is-ready').waitFor();
  assert.match(await page.locator('.fab-picture-open img').getAttribute('src'),/002\.webp/);
  assert.ok(await page.locator('.fab-picture-open img').evaluate((img)=>img.naturalWidth>0));
});

test('retry replaces a corrupt cached image and the repaired canonical URL works offline', async (t) => {
  const {page,context}=await fresh(t,'ok',true);
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  await page.evaluate(async()=>{
    const cache=await caches.open('maydan-media-v1');
    await cache.put(new URL('./media/fabraka-v3/fab3-001.webp?v=unit',location.href),new Response('broken image bytes',{headers:{'content-type':'image/webp'}}));
  });
  await page.reload();await page.getByRole('alert').waitFor();
  await page.getByRole('button',{name:'إعادة تحميل الصورة'}).click();await page.locator('.fab-picture-stage.is-ready').waitFor();
  assert.match(await page.locator('.fab-picture-open img').getAttribute('src'),/fabRetry=1/);
  await context.setOffline(true);await page.reload();await page.locator('.fab-picture-stage.is-ready').waitFor();
  assert.doesNotMatch(await page.locator('.fab-picture-open img').getAttribute('src'),/fabRetry/);
  assert.ok(await page.locator('.fab-picture-open img').evaluate((img)=>img.naturalWidth>0));
});
