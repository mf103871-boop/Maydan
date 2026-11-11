import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { presentationCssPlugin } from '../scripts/presentation-css.mjs';

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: real premium profile palette wins live materials while Studio preview, geometry and separate dialog scope remain intact`, { timeout: 60_000 }, async t => {
  const source = `import React from'react';import{createRoot}from'react-dom/client';import{DesignProvider}from'./src/design/DesignProvider.jsx';import{createDefaultDesign,validateDesignDocument}from'./src/design/schema.js';import{ProfileView,SafetyDialog}from'./src/profiles/ProfileScreen.jsx';import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';
  const profile={id:'palette-me',name:'ليان',theme:'teal',code:'SYNTHETIC',bio:'ملف تجريبي',relationship:'self',earnedTitles:[],earnedBadges:[],featuredBadges:[],achievements:[],stats:{onlineMatches:2},revision:0};
  const account={ready:true,signedIn:true,user:{id:profile.id}},profiles={ready:true,mine:profile,profiles:{},errors:{},loadProfile:async()=>profile};
  const material={color:'#123456',backgroundColor:'#F9F0D1',borderColor:'#7B2701',boxShadow:'none',fontSize:19,padding:17};
  const doc={...createDefaultDesign(),screens:{profile:{nodes:{stats:{style:material,layouts:{portrait:{x:0,y:0,width:.8,height:'auto',z:0}}}}},'profile.safety':{nodes:{'report-reason':{style:{color:'#7B2701',backgroundColor:'#F9F0D1'}}}}}};
  const validation=validateDesignDocument(doc);if(!validation.ok)throw Error(JSON.stringify(validation.errors));
  window.paletteDocumentValid=validation.ok;window.requiredHideRejected=!validateDesignDocument({...doc,screens:{'profile.safety':{nodes:{close:{visible:false}}}}}).ok;
  const root=createRoot(document.getElementById('root'));
  window.renderPalette=({skin=false,preview=false,editing=false})=>{const person={...profile,cosmetics:skin?{profileSkinId:'sahra.profileSkin'}:{}};root.render(<DesignProvider document={doc} preview={preview} editing={editing}><style>{tokens}{ui}</style><ProfileView account={account} profiles={{...profiles,mine:person}} social={{offline:false}}/><section data-design-screen="profile" data-profile-skin={skin?'sahra':'base'}><SafetyDialog action="report" profile={{...profile,id:'friend',name:'صديق تجريبي'}} social={{offline:false}} onClose={()=>{}} onDone={()=>{}}/></section></DesignProvider>);};window.renderPalette({skin:true});`;
  const result = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', minify: true,
    plugins: [presentationCssPlugin()],
    alias: { 'react/jsx-runtime': path.resolve('src/design/jsx-runtime.js') }, loader: { '.js': 'jsx', '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  let accountRequests = 0;
  const publicRoot=path.resolve('public');
  const server = http.createServer(async(req, res) => {
    if (req.url.startsWith('/api/')) { accountRequests++; res.writeHead(404); res.end('{}'); return; }
    if (req.url === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); res.end(result.outputFiles[0].contents); return; }
    if (req.url.startsWith('/assets/')) {
      const file=path.resolve(publicRoot,'.'+new URL(req.url,'http://fixture').pathname);
      if(file.startsWith(publicRoot+path.sep))try{const bytes=await readFile(file);res.setHeader('content-type',file.endsWith('.webp')?'image/webp':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(bytes);return;}catch{/* A real missing asset must not masquerade as prepared artwork. */}
      res.writeHead(404);res.end();return;
    }
    res.setHeader('content-type', 'text/html;charset=utf-8'); res.end('<!doctype html><html dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const browser = await engine.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const snapshot = () => page.evaluate(() => {
    const section = document.querySelector('main.profile-screen [data-design-id=stats]');
    const field = document.querySelector('[data-design-screen="profile.safety"] [data-design-id=report-reason]');
    const close = document.querySelector('[data-design-screen="profile.safety"] [data-design-id=close]');
    const extract = element => ({ color: element.style.color, background: element.style.backgroundColor, border: element.style.borderColor, shadow: element.style.boxShadow, padding: getComputedStyle(element).paddingTop, font: getComputedStyle(element).fontSize, position: element.style.position });
    return { profile: extract(section), dialog: extract(field), close: { visible: !!close.getClientRects().length, width: close.getBoundingClientRect().width, height: close.getBoundingClientRect().height }, skin: document.querySelector('main.profile-screen').dataset.profileSkin };
  });
  await page.locator('[data-design-screen="profile.safety"] [data-design-id=report-reason]').waitFor();
  await page.waitForFunction(() => document.querySelector('main.profile-screen [data-design-id=stats]').style.position === 'absolute');
  assert.equal(await page.evaluate(() => window.paletteDocumentValid && window.requiredHideRejected), true);
  for (const mode of [{skin:true},{skin:false},{skin:true,preview:true},{skin:true,editing:true}]) {
    await page.evaluate(mode => window.renderPalette(mode), mode);
    await page.waitForFunction(({skin,override}) => {
      const main=document.querySelector('main.profile-screen'),stats=main?.querySelector('[data-design-id=stats]');
      return main?.dataset.profileSkin===(skin?'sahra':'base') && stats && (override?stats.style.color==='rgb(18, 52, 86)':stats.style.color==='');
    }, { skin:mode.skin,override:!mode.skin||mode.preview===true||mode.editing===true });
    const data = await snapshot(); const explicit = !mode.skin || mode.preview || mode.editing;
    for (const view of [data.profile]) {
      assert.equal(view.color, explicit ? 'rgb(18, 52, 86)' : '');
      assert.equal(view.background, explicit ? 'rgb(249, 240, 209)' : '');
      assert.equal(view.border, explicit ? 'rgb(123, 39, 1)' : '');
      assert.equal(view.shadow, explicit ? 'none' : '');
      assert.equal(view.padding, '17px'); assert.equal(view.font, '19px');
    }
    assert.equal(data.profile.position, 'absolute', 'Studio placement survives the material palette');
    assert.equal(data.dialog.color, 'rgb(123, 39, 1)', 'a separate dialog root does not inherit the profile palette');
    assert.equal(data.close.visible, true); assert.ok(data.close.width>=44 && data.close.height>=44, 'required private-dialog exit remains usable');
  }
  assert.equal(accountRequests,0); assert.deepEqual(errors,[]);
});
