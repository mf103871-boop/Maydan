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
const empty={frameId:null,avatarId:null,coverId:null,nameColorId:null,roomThemeId:null,entranceId:null,badge:false};
const state={a:{preferred:{...empty},revision:0,presets:[]},b:{preferred:{...empty},revision:0,presets:[]}};
window.writes=[];window.reads=[];window.fixtureState=state;window.applied=[];window.paywalls=[];window.deferred=null;
window.fetch=async url=>{if(String(url).endsWith('/api/cosmetics/catalog'))return new Response(JSON.stringify({version:PLUS_CATALOG_VERSION,serverTime:1793174400000}),{headers:{'content-type':'application/json'}});throw Error('Unexpected API request');};
function Harness(){const[identity,setIdentity]=useState({id:'a',premium:true}),[view,setView]=useState('store');
window.selectAccount=(id,premium=true)=>setIdentity({id,premium});window.selectView=setView;
const requestAuthenticated=async(url,options={})=>{const{id,premium}=identity,record=state[id],method=options.method||'GET',body=options.body||{};
if(method==='GET')window.reads.push(url);if(method!=='GET'){window.writes.push({id,url,method,body});if(window.deferNext){window.deferNext=false;await new Promise(resolve=>window.deferred=resolve);}}
if(url==='/api/me/cosmetics'){if(method==='PATCH'){if(body.revision!==record.revision)throw Object.assign(Error('CONFLICT'),{code:'CONFLICT'});Object.assign(record.preferred,body.selection);record.revision++;}return{preferred:{...record.preferred},effective:premium?{...record.preferred}:{...empty},revision:record.revision,plusActive:premium,serverTime:1793174400000};}
if(url==='/api/me/cosmetics/inventory')return{preferred:{...record.preferred},effective:premium?{...record.preferred}:{...empty},revision:record.revision,plusActive:premium,serverTime:1793174400000,ownedItemIds:[],grants:[],monthly:{windows:[]}};
if(url==='/api/me/setup-presets'){if(method==='POST')record.presets.push({id:'p'+record.presets.length,revision:1,...body});return{presets:[...record.presets],plusActive:premium,limit:10};}
const match=url.match(/setup-presets\\/(p\\d+)(\\/apply)?$/);if(match){const preset=record.presets.find(p=>p.id===match[1]);if(method==='DELETE'){record.presets=record.presets.filter(p=>p.id!==match[1]);return{};}if(match[2])return{preset,settings:preset.settings};}throw Error('Unexpected authenticated request');};
return <AccountContext.Provider value={{...NULL_ACCOUNT,signedIn:true,premium:identity.premium,user:{id:identity.id,name:identity.id==='a'?'أحمد':'ليلى'},requestAuthenticated,openPaywall:options=>window.paywalls.push(options)}}><style>{tokens+ui+platform}</style>{view==='store'?<Store/>:<div className='screen'><SetupPresets game='ersomha' settings={{cycles:2,drawSeconds:60,difficulty:'easy',categories:['animals'],allowReplay:true,words:['hidden-answer'],players:[{id:'secret'}]}} onApply={settings=>window.applied.push({owner:identity.id,settings})}/></div>}</AccountContext.Provider>}
createRoot(document.getElementById('root')).render(<Harness/>);`;
const built=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl'},define:{__MAYDAN_ROOMS_URL__:JSON.stringify('https://plus-fixture.invalid'),'process.env.NODE_ENV':JSON.stringify('production')},logLevel:'silent'});
const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const publicRoot=path.resolve('public');
const server=createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(built.outputFiles[0].contents);return;}
  if(/^\/assets\/plus\/v[123]\//.test(req.url||'')){const target=path.resolve(publicRoot,'.'+req.url);if(target.startsWith(publicRoot+path.sep)){try{res.setHeader('content-type',req.url.endsWith('.svg')?'image/svg+xml':'image/webp');res.end(await readFile(target));return;}catch{res.writeHead(404);res.end();return;}}}
  res.setHeader('content-type','text/html');res.end(html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const results=[];
try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('[data-item-id="sahra.frame"]').waitFor();
  assert.equal(await page.locator('[data-item-id]').count(),5);assert.equal(await page.evaluate(()=>window.writes.length),0);
  assert.deepEqual(await page.getByRole('tab').allTextContents(),['المظهر','مقتنياتي']);
  await page.locator('[data-item-id="sahra.profileSkin"] [data-design-id="item-preview"]').click();const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await page.evaluate(()=>window.writes.length),0);assert.match(await dialog.innerText(),/معاينة فقط/);assert.equal(await dialog.getByRole('tab').count(),0);
  for(const width of[320,390,430,844,1024]){await page.setViewportSize({width,height:width===844?390:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width}`);const box=await dialog.boundingBox();assert.ok(box.width<=width&&box.x>=0,`dialog ${width}`);}
  results.push('only profile/frame subscription; preview makes no writes; responsive phone/landscape/tablet');
  await page.setViewportSize({width:390,height:844});
  const previewOut=path.resolve('.cache/plus-ui');await mkdir(previewOut,{recursive:true});await dialog.screenshot({path:path.join(previewOut,'preview-profile-phone.png')});
  await dialog.getByRole('button',{name:'استخدام البروفايل والإطار معًا',exact:true}).click();await dialog.getByText('حُفظ مظهر بروفايلك. صورتك وبقية اختياراتك محفوظة كما هي.',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.writes[0].body.selection),{profileSkinId:'sahra.profileSkin',frameId:'plus.signature.frame'});
  await dialog.getByRole('button',{name:'إغلاق',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.locator('[data-item-id="sahra.frame"] [data-design-id="item-preview"]').click();await dialog.waitFor();
  await dialog.locator('.plus-preview-category').getByRole('button',{name:'استخدام',exact:true}).click();await page.waitForFunction(()=>window.writes.length===2);
  assert.deepEqual(await page.evaluate(()=>window.writes[1].body.selection),{frameId:'sahra.frame'});
  await dialog.getByText('حُفظ مظهر بروفايلك. صورتك وبقية اختياراتك محفوظة كما هي.',{exact:true}).waitFor();
  results.push('profile/frame pair sends exactly two slots; frame remains independently equipped');
  await dialog.getByRole('button',{name:'إغلاق',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.locator('[data-item-id="artist.frame"] [data-design-id="item-preview"]').click();await dialog.waitFor();await page.evaluate(()=>window.deferNext=true);
  await dialog.locator('.plus-preview-category').getByRole('button',{name:'استخدام',exact:true}).click();await page.waitForFunction(()=>window.deferred!==null);
  await page.evaluate(()=>window.selectAccount('b'));await dialog.waitFor({state:'hidden'});await page.evaluate(()=>{window.deferred();window.deferred=null;});
  assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('.store-product.is-equipped').count(),0);
  results.push('account switch dismisses preview and fences late previous-owner results');
  const reads=await page.evaluate(()=>window.reads.length),writes=await page.evaluate(()=>window.writes.length);
  await page.evaluate(()=>window.selectView('presets'));await page.waitForFunction(()=>!document.querySelector('[data-design-screen="store"]'));
  assert.equal(await page.locator('.plus-presets').count(),0);assert.equal(await page.evaluate(()=>window.reads.length),reads);assert.equal(await page.evaluate(()=>window.writes.length),writes);
  assert.equal(await page.evaluate(()=>window.reads.some(url=>url.includes('setup-presets'))),false);assert.equal(await page.evaluate(()=>window.writes.some(item=>item.url.includes('setup-presets'))),false);
  results.push('paused preset component renders no paid UI and reads/writes no saved records');
  await page.evaluate(()=>{window.selectAccount('b',false);window.selectView('store');});await page.locator('[data-item-id="sahra.frame"]').waitFor();
  await page.locator('[data-item-id="sahra.frame"] [data-design-id="item-use"]').click();assert.equal(await page.evaluate(()=>window.writes.length),writes);assert.equal(await page.evaluate(()=>window.paywalls.at(-1).reason),'cosmetics');
  assert.equal(await page.locator('[data-design-id="permanent-quote"],[data-design-id="test-checkout-confirm"]').count(),0);
  results.push('expired subscription opens profile/frame offer without new external/permanent checkout');
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.store-profile-only').evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
  await page.screenshot({path:path.join(previewOut,'store-phone.png'),fullPage:true});
  console.log(JSON.stringify({passed:results.length,checks:results,physicalIPhone:false,hosted:false},null,2));}finally{await browser.close();server.close();}
