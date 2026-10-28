// Run with node tests/e2e/design-semantic-coverage.mjs. This builds real production
// components with memory-only providers; account/network/microphone effects are disabled.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { DESIGN_SCREENS } from '../../src/design/registry.js';
const source = `import React from 'react';import{createRoot}from'react-dom/client';import{PreviewProviders,PlatformDesignScene}from'./src/design/preview-platform.jsx';import{DesignProvider}from'./src/design/DesignProvider.jsx';import{DesignScene}from'./src/design/preview-scenes.jsx';import{getDesignScene}from'./src/design/screen-catalog.js';import{createDefaultDesign}from'./src/design/schema.js';const root=createRoot(document.getElementById('root'));window.renderAudit=(id,variant='normal')=>{const scene=getDesignScene(id),special=id==='play-setup'||id.startsWith('play-setup.')||id.startsWith('setup.')||['account.signin','online.chrome'].includes(id);root.render(<DesignProvider document={createDefaultDesign()} profile="portrait"><PreviewProviders key={id+variant} sceneId={id} previewState={variant}>{scene.renderer==='platform'&&!special?<PlatformDesignScene sceneId={id} previewState={variant}/>:<DesignScene sceneId={id}/>}</PreviewProviders></DesignProvider>);};window.renderAudit('home');`;
const result = await build({ stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',minify:true,alias:{'react/jsx-runtime':path.resolve('src/design/jsx-runtime.js')},loader:{'.js':'jsx','.css':'text','.json':'json','.webp':'dataurl','.woff2':'dataurl','.png':'dataurl'},define:{'process.env.NODE_ENV':JSON.stringify('production')},logLevel:'silent' });
const js = result.outputFiles[0].contents;
const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script>const mem=()=>{const m=new Map;return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear(),key:i=>[...m.keys()][i],get length(){return m.size}}};Object.defineProperty(window,'localStorage',{value:mem()});Object.defineProperty(window,'sessionStorage',{value:mem()});window.fetch=()=>Promise.reject(new Error('PREVIEW_NETWORK_DISABLED'));</script><script src="/bundle.js"></script></body></html>`;
const server = createServer((req,res)=>{res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/bundle.js'?js:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})});
const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
const errors = [], scenes = [];
page.on('pageerror',error=>errors.push(error.message));
try {
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.renderAudit);
 const scenarios=DESIGN_SCREENS.map(screen=>({id:screen.id,variant:'normal'}));for(const id of ['home','settings','players','profile','social.list','social.conversation','account.card','account.paywall'])for(const variant of ['guest','empty','error','longText'])scenarios.push({id,variant});for(const [id,actions] of [['ersomha.draw.drawer',[['click','[data-design-id="focus-toggle"]']]],['online.mafia.discussion',[['click','[data-design-id="role-toggle"]']]],['online.entry',[['click','[data-design-id="entry-join"]']]],['online.entry',[['click','[data-design-id="game-choice.fabraka"]']]],['online.lobby',[['click','[data-design-id="room-settings"]']]],['online.mafia.lobby',[['click','[data-design-id="room-settings"]']]],['social.list',[['click','[data-design-id="tab.groups"]']]],['social.list',[['click','[data-design-id="tab.requests"]']]],['social.search',[['fill','[data-design-id="search-input"]','سارة']]],['social.call',[['click','[data-design-id="speaker"]']]],['badeeha.question',[['click','[data-design-id="reveal"]']]],['about',[['click','[data-design-id="show-all"]']]]])scenarios.push({id,variant:'normal',actions});scenarios.push({id:'ersomha.draw.drawer',variant:'normal',viewport:{width:844,height:390}});for(const screen of scenarios){
  await page.setViewportSize(screen.viewport || {width:390,height:844});const start=errors.length;await page.evaluate(({id,variant})=>window.renderAudit(id,variant),screen);await page.waitForTimeout(140);for(const [kind,selector,value] of screen.actions||[]){const target=page.locator(selector).first();if(await target.count()){if(kind==='fill')await target.fill(value);else await target.click({force:true});await page.waitForTimeout(450);}}
  const data=await page.evaluate(()=>{
   const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
   const fields=el=>({tag:el.tagName.toLowerCase(),label:el.getAttribute('aria-label')||el.innerText?.trim().slice(0,110)||el.getAttribute('placeholder')||'',classes:el.className,screen:el.closest('[data-design-screen]')?.dataset.designScreen||null,parent:el.closest('[data-design-id]')?.dataset.designId||null});
   const interactive=[...document.querySelectorAll('button,a[href],input:not([type=hidden]),textarea,select,[role=button]')].filter(visible);
   return {roots:[...document.querySelectorAll('[data-design-screen]')].map(el=>el.dataset.designScreen),nodes:[...document.querySelectorAll('[data-design-id]')].filter(visible).map(el=>({screen:el.closest('[data-design-screen]')?.dataset.designScreen,id:el.dataset.designId})),interactive:interactive.length,unannotated:interactive.filter(el=>!el.dataset.designId).map(fields),chars:document.body.innerText.length};
  });
  scenes.push({id:screen.id,variant:screen.variant,actions:screen.actions,errors:errors.slice(start),...data});
 }
 const observed=new Set(scenes.flatMap(scene=>scene.nodes.map(node=>`${node.screen}:${node.id}`)));
 const neverSeen=DESIGN_SCREENS.flatMap(screen=>screen.nodes.filter(node=>!observed.has(`${screen.id}:${node.id}`)).map(node=>({screen:screen.id,id:node.id,editable:!!node.editableText,kind:node.kind})));
 const output={at:new Date().toISOString(),scenes,errors,neverSeen};
 await mkdir('.cache',{recursive:true});
 await writeFile('.cache/design-semantic-coverage.json',JSON.stringify(output,null,2));
 const unique=new Map;for(const scene of scenes)for(const node of scene.unannotated){const key=JSON.stringify(node);const row=unique.get(key)||{...node,scenes:[]};row.scenes.push(scene.id);unique.set(key,row);}
 await writeFile('.cache/design-semantic-unannotated.json',JSON.stringify([...unique.values()],null,2));
 assert.deepEqual(errors,[],'Every actual scene renders without browser errors');
 assert.equal(unique.size,0,`Visible controls need semantic IDs: ${JSON.stringify([...unique.values()])}`);
 for(const scene of scenes) {
  assert.ok(scene.chars>=5,`Empty scene: ${scene.id}`);
  assert.ok(scene.roots.includes(scene.id),`Actual root missing for ${scene.id}`);
  for(const {screen,id} of scene.nodes) assert.ok(DESIGN_SCREENS.find(value=>value.id===screen)?.nodes.some(value=>value.id===id),`Unregistered actual semantic node: ${screen}:${id}`);
 }
 for(const screen of DESIGN_SCREENS)for(const node of screen.nodes) {
  assert.ok(observed.has(`${screen.id}:${node.id}`)||typeof node.coverageReason==='string'&&node.coverageReason.length>35,`No actual fixture or precise conditional explanation: ${screen.id}:${node.id}`);
 }
 console.log(JSON.stringify({scenes:scenes.length,errors,unannotatedUnique:unique.size,missingPairCount:neverSeen.length,missingEditablePairCount:neverSeen.filter(n=>n.editable).length,empty:scenes.filter(s=>s.chars<5).map(s=>s.id)},null,2));
}finally{await browser.close();server.close();}
