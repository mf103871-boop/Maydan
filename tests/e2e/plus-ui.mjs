// Actual React UI with an isolated API fixture. This is browser evidence, not
// hosted-service, StoreKit, native iPhone or live subscription evidence.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const fixture = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{Store}from'./src/platform/screens/Store.jsx';import{SetupPresets}from'./src/plus/SetupPresets.jsx';
import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import platform from'./src/platform/platform.css';
import{PLUS_CATALOG_VERSION}from'./src/plus/catalog.js';
const empty={frameId:null,avatarId:null,coverId:null,nameColorId:null,roomThemeId:null,badge:false};
const state={a:{preferred:{...empty},revision:0,presets:[]},b:{preferred:{...empty},revision:0,presets:[]}};
window.writes=[];window.applied=[];window.paywalls=[];window.deferred=null;
window.fetch=async url=>{if(String(url).endsWith('/api/cosmetics/catalog'))return new Response(JSON.stringify({version:PLUS_CATALOG_VERSION,serverTime:1793174400000}),{headers:{'content-type':'application/json'}});throw Error('Unexpected API request');};
function Harness(){const[identity,setIdentity]=useState({id:'a',premium:true}),[view,setView]=useState('store');
window.selectAccount=(id,premium=true)=>setIdentity({id,premium});window.selectView=setView;
const requestAuthenticated=async(url,options={})=>{const{id,premium}=identity,record=state[id],method=options.method||'GET',body=options.body||{};
if(method!=='GET'){window.writes.push({id,url,method,body});if(window.deferNext){window.deferNext=false;await new Promise(resolve=>window.deferred=resolve);}}
if(url==='/api/me/cosmetics'){if(method==='PATCH'){if(body.revision!==record.revision)throw Object.assign(Error('CONFLICT'),{code:'CONFLICT'});Object.assign(record.preferred,body.selection);record.revision++;}return{preferred:{...record.preferred},effective:premium?{...record.preferred}:{...empty},revision:record.revision,plusActive:premium,serverTime:1793174400000};}
if(url==='/api/me/setup-presets'){if(method==='POST')record.presets.push({id:'p'+record.presets.length,revision:1,...body});return{presets:[...record.presets],plusActive:premium,limit:10};}
const match=url.match(/setup-presets\\/(p\\d+)(\\/apply)?$/);if(match){const preset=record.presets.find(p=>p.id===match[1]);if(method==='DELETE'){record.presets=record.presets.filter(p=>p.id!==match[1]);return{};}if(match[2])return{preset,settings:preset.settings};}throw Error('Unexpected authenticated request');};
return <AccountContext.Provider value={{...NULL_ACCOUNT,signedIn:true,premium:identity.premium,user:{id:identity.id,name:identity.id==='a'?'أحمد':'ليلى'},requestAuthenticated,openPaywall:options=>window.paywalls.push(options)}}><style>{tokens+ui+platform}</style>{view==='store'?<Store/>:<div className='screen'><SetupPresets game='ersomha' settings={{cycles:2,drawSeconds:60,difficulty:'easy',categories:['animals'],allowReplay:true,words:['hidden-answer'],players:[{id:'secret'}]}} onApply={settings=>window.applied.push({owner:identity.id,settings})}/></div>}</AccountContext.Provider>}
createRoot(document.getElementById('root')).render(<Harness/>);`;
const built=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl'},define:{__MAYDAN_ROOMS_URL__:JSON.stringify('https://plus-fixture.invalid'),'process.env.NODE_ENV':JSON.stringify('production')},logLevel:'silent'});
const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const publicRoot=path.resolve('public');
const server=createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(built.outputFiles[0].contents);return;}
  if(req.url?.startsWith('/assets/plus/v1/')){const target=path.resolve(publicRoot,'.'+req.url);if(target.startsWith(publicRoot+path.sep)){try{res.setHeader('content-type',req.url.endsWith('.svg')?'image/svg+xml':'image/webp');res.end(await readFile(target));return;}catch{res.writeHead(404);res.end();return;}}}
  res.setHeader('content-type','text/html');res.end(html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const results=[];
try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('button',{name:'استخدم الطقم',exact:true}).first().waitFor();
  assert.equal(await page.locator('.plus-collection').count(),3);assert.equal(await page.evaluate(()=>window.writes.length),0);
  await page.getByRole('button',{name:'جرّب المظهر',exact:true}).first().click();const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await page.evaluate(()=>window.writes.length),0);assert.match(await dialog.innerText(),/معاينة فقط/);
  for(const width of[320,390,430,844,1024]){await page.setViewportSize({width,height:width===844?390:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width}`);const box=await dialog.boundingBox();assert.ok(box.width<=width&&box.x>=0,`dialog ${width}`);}
  results.push('three launch collections; preview makes no writes; phone/landscape/tablet no horizontal overflow');
  await page.setViewportSize({width:390,height:844});
  await dialog.locator('.plus-preview-category').filter({hasText:'إطار الصورة'}).getByRole('button').click();
  await dialog.getByText('حُفظ مظهرك على حسابك. ستراه على أجهزتك أيضًا.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.writes[0].body.selection),{frameId:'sahra.frame'});
  assert.equal(await dialog.locator('.plus-preview-category').filter({hasText:'إطار الصورة'}).getByRole('button').innerText(),'مستخدم الآن');
  results.push('equip sends one allowed slot with revision and refreshes effective appearance');
  await page.evaluate(()=>window.deferNext=true);
  await dialog.locator('.plus-preview-category').filter({hasText:'الصورة المتحركة'}).getByRole('button').click();await page.waitForFunction(()=>window.deferred!==null);
  await page.evaluate(()=>window.selectAccount('b'));await dialog.waitFor({state:'hidden'});await page.getByRole('button',{name:'استخدم الطقم',exact:true}).first().waitFor();
  await page.evaluate(()=>{window.deferred();window.deferred=null;});
  assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByText('حُفظ مظهرك على حسابك. ستراه على أجهزتك أيضًا.',{exact:true}).count(),0);
  assert.equal(await page.getByText('من مظهرك الحالي',{exact:true}).count(),0);
  results.push('account switch dismisses preview and rejects late writes/results from previous identity');
  await page.evaluate(()=>{window.selectAccount('a');window.selectView('presets');});
  await page.getByRole('button',{name:/جلساتي الجاهزة/}).click();await page.getByPlaceholder('مثال: سهرة العيلة').fill('سهرة العيلة');
  await page.getByRole('button',{name:'احفظ الإعدادات الحالية',exact:true}).click();await page.getByText('سهرة العيلة',{exact:true}).waitFor();
  const saved=await page.evaluate(()=>window.writes.find(item=>item.url==='/api/me/setup-presets'));
  assert.deepEqual(saved.body.settings,{cycles:2,drawSeconds:60,difficulty:'easy',categories:['animals']});
  await page.locator('.plus-preset-row').getByRole('button',{name:'استخدام',exact:true}).click();await page.waitForFunction(()=>window.applied.length===1);
  assert.equal(await page.evaluate(()=>window.applied[0].owner),'a');assert.equal(await page.evaluate(()=>window.writes.some(item=>/\/rooms/.test(item.url))),false);
  results.push('preset save excludes answers/replay/players; apply only fills settings and creates no room');
  await page.evaluate(()=>window.selectAccount('a',false));await page.getByText('القوالب محفوظة لك. بلس يتيح حفظها واستخدامها السريع، والخيارات اليدوية مجانية.',{exact:true}).waitFor();await page.getByText('سهرة العيلة',{exact:true}).waitFor();
  const before=await page.evaluate(()=>window.writes.length);await page.locator('.plus-preset-row').getByRole('button',{name:'استخدام',exact:true}).click();assert.equal(await page.evaluate(()=>window.writes.length),before);assert.equal(await page.evaluate(()=>window.paywalls.at(-1).reason),'presets');
  await page.getByRole('button',{name:'حذف جلسة سهرة العيلة',exact:true}).click();await page.getByText('ما عندك جلسة محفوظة لهذه اللعبة بعد.',{exact:true}).waitFor();
  results.push('expired users can read/delete saved presets; paid quick-apply opens honest Plus offer');
  await page.getByPlaceholder('مثال: سهرة العيلة').fill('مسودة خاصة');await page.evaluate(()=>window.selectAccount('b'));await page.getByPlaceholder('مثال: سهرة العيلة').waitFor({state:'hidden'});assert.equal(await page.getByPlaceholder('مثال: سهرة العيلة').count(),0);
  await page.getByRole('button',{name:/جلساتي الجاهزة/}).click();assert.equal(await page.getByPlaceholder('مثال: سهرة العيلة').inputValue(),'');assert.equal(await page.getByText('سهرة العيلة',{exact:true}).count(),0);
  results.push('preset list and unsaved names clear on account change');
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.selectView('store'));await page.getByRole('button',{name:'جرّب المظهر',exact:true}).first().waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.plus-store').evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
  const out=path.resolve('.cache/plus-ui');await mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'store-phone.png'),fullPage:true});
  console.log(JSON.stringify({passed:results.length,checks:results,physicalIPhone:false,hosted:false},null,2));
}finally{await browser.close();server.close();}
