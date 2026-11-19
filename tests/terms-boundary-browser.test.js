// Actual TermsBoundary/router/HTTP/consent + local SQLite legal handlers. Account
// context is controlled to exercise identity races without OAuth/provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { localePackagingPlugin } from '../scripts/lib/locale-packaging.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { handleLegalRequest, legalStatus } from '../server/legal/terms.mjs';
import { errorResponse } from '../server/protocol.mjs';
import { getTermsDocument, termsIdentity } from '../src/shared/legal/terms.js';
import { verifyGuestTermsReceipt } from '../server/legal/guest-terms.mjs';

const ORIGIN='https://maydan-mafia-preview.mf103871.workers.dev';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
let compiled;
const fixtureApp=()=>compiled ||= build({stdin:{contents:`
import React,{useCallback,useMemo,useState}from'react';import{createRoot}from'react-dom/client';
import{TermsBoundary}from'./src/shared/legal/TermsBoundary.jsx';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';
import{PlatformContext}from'./src/platform/context.js';import{setUiLocale}from'./src/shared/i18n/core.js';
import{Terms}from'./src/platform/screens/Legal.jsx';
import{BottomNavigation}from'./src/platform/BottomNavigation.jsx';
import{BrandFonts}from'./src/shared/brand/art.jsx';
import uiCss from './src/shared/ui/ui.css';
import brandCss from './src/shared/brand/brand.css';
import{request}from'./src/shared/account/api.js';import{navigate,useRoute}from'./src/platform/router.js';
import{getGuestTermsReceipt}from'./src/shared/legal/acceptance.js';
window.fixture={toasts:[],tokens:{},owner:'guest'};
function App(){const[owner,setOwner]=useState('guest'),route=useRoute();window.fixture.route=navigate;window.fixture.setOwner=setOwner;window.fixture.owner=owner;
const requestAuthenticated=useCallback((path,options={})=>request(path,{...options,token:window.fixture.tokens[owner]}),[owner]);
const account=useMemo(()=>({...NULL_ACCOUNT,ready:true,signedIn:owner!=='guest',user:['guest','unresolved'].includes(owner)?null:{id:owner},me:null,requestAuthenticated,
 ...(owner==='unresolved'?{refresh:async()=>{window.fixture.identityRefreshes=(window.fixture.identityRefreshes||0)+1;}}:{})}),[owner,requestAuthenticated]);
window.fixture.receipt=()=>getGuestTermsReceipt(location.origin);
return <><BrandFonts/><style>{uiCss}</style><style>{brandCss}</style><PlatformContext.Provider value={{toast:value=>window.fixture.toasts.push(value),settings:{uiLocale:document.documentElement.lang},sound:{play(){}},haptics:{vibrate(){}}}}><AccountContext.Provider value={account}><TermsBoundary route={route}><div data-testid="allowed">{route.name==='terms'?<><Terms/><BottomNavigation route={route}/></>:route.name+':'+owner}</div></TermsBoundary></AccountContext.Provider></PlatformContext.Provider></>}
setUiLocale(new URL(location.href).searchParams.get('lang')||'ar').then(()=>createRoot(document.getElementById('root')).render(<App/>));
`,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',outdir:'work/terms-boundary-fixture',plugins:[localePackagingPlugin()],loader:{'.css':'text','.js':'jsx','.webp':'dataurl','.woff2':'dataurl'},define:{__MAYDAN_ROOMS_URL__:JSON.stringify(ORIGIN)},logLevel:'silent'});

async function setup(engine,locale){
 const compiled=await fixtureApp(),raw=createLocalD1(),env={DB:raw,SESSION_SECRET:'terms-browser-fixture-only'},users={},tokens={};
 for(const key of ['a','b']){users[key]=await createUser(env,{name:key,email:key+'@terms.example.test'});tokens[users[key].id]=(await issueSession(env,users[key].id)).token;}
 const browser=await engine.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),requests=[],errors=[];
 const controls={hold:null,oldVersion:false,statusUnavailable:false,saveUnavailable:false};
 const assets=new Map(compiled.outputFiles.map(file=>[path.basename(file.path),file.contents]));
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{
  const incoming=route.request(),url=new URL(incoming.url());
  if(url.origin!==ORIGIN)return route.abort();
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#fff8f0;font-family:"Maydan Round",sans-serif;--safe-top:0px;--safe-bottom:0px;--safe-left:0px;--safe-right:0px}</style><div id="root"></div><script src="/bundle.js"></script>'});
  if(url.pathname==='/bundle.js')return route.fulfill({contentType:'application/javascript',body:Buffer.from(compiled.outputFiles.find(f=>f.path.endsWith('.js')).contents)});
  const asset=assets.get(path.basename(url.pathname));if(asset)return route.fulfill({contentType:'application/json',body:Buffer.from(asset)});
  requests.push({path:url.pathname,method:incoming.method(),headers:await incoming.allHeaders(),body:incoming.postDataJSON()});
  if(url.pathname==='/api/legal/accept'&&controls.hold){const gate=controls.hold;gate.entered.resolve();await gate.release.promise;}
  if(url.pathname==='/api/legal/accept'&&controls.oldVersion)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'TERMS_VERSION_CHANGED'})});
  if((url.pathname==='/api/legal/status'&&controls.statusUnavailable)||(url.pathname==='/api/legal/accept'&&controls.saveUnavailable)){
   return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'TERMS_UNAVAILABLE'})});
  }
  let response;try{response=await handleLegalRequest(new Request(incoming.url(),{method:incoming.method(),headers:await incoming.allHeaders(),...(incoming.method()==='POST'?{body:incoming.postData()}: {})}),env);}catch(error){response=errorResponse(error);}
  if(!response)return route.fulfill({status:404,contentType:'application/json',body:'{}'});
  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
 });
 await page.goto(ORIGIN+'/?lang='+locale+'#/play/beep');await page.getByRole('checkbox').waitFor();await page.evaluate(tokens=>Object.assign(window.fixture.tokens,tokens),tokens);
 return{page,context,env,raw,users,tokens,requests,errors,controls,async close(){controls.hold?.release.resolve();await browser.close();raw.close();}};
}
const agree=async page=>{await page.getByRole('checkbox').check();await page.locator('button[type=submit]').click();};

test('restored account without a cached identity can retry and return to Settings without agreeing',async()=>{
 const f=await setup(chromium,'en');
 try {
  await f.page.evaluate(()=>window.fixture.setOwner('unresolved'));
  await f.page.getByRole('button',{name:'Retry connection'}).click();
  assert.equal(await f.page.evaluate(()=>window.fixture.identityRefreshes),1);
  assert(await f.page.getByRole('checkbox').isDisabled());
  assert(await f.page.locator('button[type=submit]').isDisabled());
  await f.page.getByRole('button',{name:'Do not agree, go back'}).click();
  await f.page.waitForFunction(()=>location.hash==='#/settings');
  assert(!f.requests.some(row=>row.path==='/api/legal/accept'));
 } finally {await f.close();}
});

async function verifyLayout(page, name, locale, state) {
 const output=process.env.MAYDAN_TERMS_MATRIX;
 const observations=[];
 if(output)await mkdir(output,{recursive:true});
 await page.evaluate(()=>document.fonts.ready);
 for(const width of [360,390,430])for(const scale of [100,200]){
  await page.setViewportSize({width,height:844});
  await page.evaluate(value=>{document.documentElement.style.fontSize=value+'%';window.scrollTo(0,0);},scale);
  const geometry=await page.evaluate(()=>{
   const root=document.querySelector('.terms-consent,.terms-document');
   const targets=[...document.querySelectorAll('.terms-consent button,.terms-check,.terms-document a,.legal .topbar button')];
   const bounds=targets.map(el=>{
    const rect=el.getBoundingClientRect();
    return {width:rect.width,height:rect.height,left:rect.left,right:rect.right};
   });
   return {direction:getComputedStyle(root).direction,fontSize:getComputedStyle(root).fontSize,scrollWidth:document.documentElement.scrollWidth,targets:bounds};
  });
  assert.equal(geometry.direction,locale==='ar'?'rtl':'ltr');
  assert.equal(geometry.fontSize,scale===100?'16px':'32px');
  assert.ok(geometry.scrollWidth<=width+1,`${state} ${width}px at ${scale}% has no horizontal overflow`);
  assert.ok(geometry.targets.length>0);
  for(const target of geometry.targets){
   assert.ok(target.width>=48&&target.height>=48,`${state} has 48px targets`);
   assert.ok(target.left>=-1&&target.right<=width+1,`${state} keeps targets within the viewport width`);
  }
  observations.push({width,scale,...geometry});
  if(output&&(scale===100||width===390)){
   await page.screenshot({path:path.join(output,`${name}-${locale}-${state}-${width}-${scale}.png`),animations:'disabled',fullPage:state!=='document'||scale===200});
  }
 }
 if(output)await writeFile(path.join(output,`${name}-${locale}-${state}.json`),JSON.stringify(observations,null,2)+'\n');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{document.documentElement.style.removeProperty('font-size');window.scrollTo(0,0);});
}

for(const[name,engine]of[['chromium',chromium],['webkit',webkit]])for(const locale of ['ar','en']){
 test(`${name} ${locale}: refusal and safety stay open; offline guest choice precedes real online receipt`,{timeout:60000},async()=>{
  const f=await setup(engine,locale);try{
   assert.equal(await f.page.locator('[data-testid=allowed]').count(),0);assert.equal(f.requests.length,0);
   await f.page.locator('.terms-secondary').click();await f.page.getByText('settings:guest',{exact:true}).waitFor();assert.equal(f.requests.length,0);
   for(const path of ['/terms','/privacy','/friends','/friends/group/test','/profile/other']){await f.page.evaluate(path=>window.fixture.route(path),path);await f.page.locator('[data-testid=allowed]').waitFor();assert.equal(await f.page.getByRole('checkbox').count(),0);}
   await f.page.evaluate(()=>window.fixture.route('/play/beep'));await f.page.getByRole('checkbox').waitFor();assert.equal(await f.page.getByRole('checkbox').isChecked(),false);
   if(locale==='en')await f.page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Fixture blocked storage','SecurityError')};});
   await f.context.setOffline(true);await agree(f.page);await f.page.getByText('play:guest',{exact:true}).waitFor();assert.equal(f.requests.length,0,'local acceptance must not require an API call');
   if(locale==='en')assert.ok(await f.page.evaluate(()=>window.fixture.toasts.length>0),'session-only consent must be disclosed when persistence is denied');
   await f.context.setOffline(false);f.controls.oldVersion=true;await f.page.evaluate(()=>window.fixture.route('/online/mafia'));await f.page.getByRole('alert').waitFor();
   assert.match(await f.page.getByRole('alert').innerText(),locale==='en'?/updat/i:/حدّث ميدان/);assert.equal(await f.page.locator('[data-testid=allowed]').count(),0);
   f.controls.oldVersion=false;f.controls.hold={entered:deferred(),release:deferred()};await f.page.getByRole('button',{name:locale==='en'?'Retry connection':'إعادة الاتصال',exact:true}).click();await f.controls.hold.entered.promise;
   assert.equal(await f.page.locator('[data-testid=allowed]').count(),0,'online cannot mount before its server receipt arrives');
   f.controls.hold.release.resolve();await f.page.getByText('online:guest',{exact:true}).waitFor();
   assert.equal(f.requests.filter(r=>r.path==='/api/legal/accept').length,2);assert.deepEqual(f.requests.at(-1).body,{...termsIdentity(locale),accepted:true});
   const receipt=await f.page.evaluate(()=>window.fixture.receipt());assert.ok(await verifyGuestTermsReceipt(f.env,new Request(ORIGIN+'/api/rooms'),receipt));
   assert.equal((await f.raw.prepare('SELECT COUNT(*) AS n FROM legal_terms_acceptances').first()).n,0);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
 });
 test(`${name} ${locale}: account switching rejects stale in-flight acceptance and409 requires app update`,{timeout:60000},async()=>{
  const f=await setup(engine,locale);try{
   await f.page.evaluate(id=>window.fixture.setOwner(id),f.users.a.id);await f.page.waitForFunction(()=>document.querySelector('form')?.getAttribute('aria-busy')==='false');
   f.controls.hold={entered:deferred(),release:deferred()};await agree(f.page);await f.controls.hold.entered.promise;
   await f.page.evaluate(id=>window.fixture.setOwner(id),f.users.b.id);await f.page.waitForFunction(id=>window.fixture.owner===id,f.users.b.id);
   await f.page.waitForFunction(()=>document.querySelector('form')?.getAttribute('aria-busy')==='false');
   assert.equal(await f.page.getByRole('checkbox').isChecked(),false,'new account must choose explicitly, without inheriting an old account checkbox');
   const staleResponse=f.page.waitForResponse(response=>response.url().endsWith('/api/legal/accept')&&response.request().headers().authorization==='Bearer '+f.tokens[f.users.a.id]);
   f.controls.hold.release.resolve();f.controls.hold=null;await staleResponse;await f.page.waitForFunction(()=>document.querySelector('form')?.getAttribute('aria-busy')==='false');
   assert.equal(await f.page.locator('[data-testid=allowed]').count(),0);assert.equal((await legalStatus(f.env,f.users.b.id)).required,true);
   f.controls.oldVersion=true;await agree(f.page);await f.page.getByRole('alert').waitFor();assert.match(await f.page.getByRole('alert').innerText(),locale==='en'?/updat/i:/حدّث ميدان/);
   assert.equal(await f.page.locator('[data-testid=allowed]').count(),0);assert.equal((await legalStatus(f.env,f.users.b.id)).required,true);
   f.controls.oldVersion=false;await f.page.locator('button[type=submit]').click();await f.page.getByText('play:'+f.users.b.id,{exact:true}).waitFor();assert.equal((await legalStatus(f.env,f.users.b.id)).required,false);
   await f.page.evaluate(()=>window.fixture.setOwner('guest'));await f.page.getByRole('checkbox').waitFor();assert.equal(await f.page.getByRole('checkbox').isChecked(),false,'an account acceptance is not guest/device consent');assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
 });

 test(`${name} ${locale}: connection retry checks status and a failed save resubmits only the explicit choice`,{timeout:90000},async()=>{
  const f=await setup(engine,locale);
  const {page,controls}=f,box=page.getByRole('checkbox'),submit=page.locator('.terms-primary');
  const retryConnection=page.getByRole('button',{name:locale==='en'?'Retry connection':'إعادة الاتصال',exact:true});
  try{
   assert.equal(await box.isChecked(),false);
   assert.equal(await submit.isDisabled(),true);
   await verifyLayout(page,name,locale,'initial');
   await page.locator('.terms-read-actions button').first().click();
   const document=page.locator('.terms-document');
   await document.waitFor();
   const expected=getTermsDocument(locale);
   assert.equal(await document.locator('h1').innerText(),expected.title);
   assert.deepEqual(await document.locator('section h2').allTextContents(),expected.sections.map(section=>section.title));
   assert.deepEqual(await document.locator('section p').allTextContents(),expected.sections.flatMap(section=>section.paragraphs));
   assert.equal(await page.locator('.menu-navigation a[aria-current=page]').getAttribute('href'),'#/profile');
   assert.equal(await box.count(),0);
   await verifyLayout(page,name,locale,'document');
   await page.locator('.legal .topbar button').click();
   await box.waitFor();
   assert.equal(await box.isChecked(),false);
   assert.equal(f.requests.length,0);

   controls.statusUnavailable=true;
   await page.evaluate(id=>window.fixture.setOwner(id),f.users.a.id);
   await retryConnection.waitFor();
   assert.equal(await submit.isDisabled(),true);
   assert.match(await page.getByRole('alert').innerText(),locale==='en'?/check your connection/i:/تحقق من الاتصال/);
   await verifyLayout(page,name,locale,'connection-failure');
   controls.statusUnavailable=false;
   await retryConnection.click();
   await retryConnection.waitFor({state:'hidden'});
   await page.waitForFunction(()=>!document.querySelector('.terms-check input')?.disabled);
   assert.equal(f.requests.filter(request=>request.path==='/api/legal/status').length,2);
   assert.equal(f.requests.filter(request=>request.path==='/api/legal/accept').length,0);

   controls.saveUnavailable=true;
   await agree(page);
   await page.getByRole('alert').waitFor();
   assert.match(await page.getByRole('alert').innerText(),locale==='en'?/choice could not be saved/i:/تعذّر حفظ الموافقة/);
   assert.equal(await retryConnection.count(),0);
   assert.equal(await box.isChecked(),true);
   assert.equal(await submit.isEnabled(),true);
   assert.equal(await page.locator('[data-testid=allowed]').count(),0);
   assert.equal((await legalStatus(f.env,f.users.a.id)).required,true);
   await verifyLayout(page,name,locale,'failed-save');
   controls.saveUnavailable=false;
   await submit.click();
   await page.getByText('play:'+f.users.a.id,{exact:true}).waitFor();
   assert.equal((await legalStatus(f.env,f.users.a.id)).required,false);
   assert.deepEqual(f.requests.filter(request=>request.path==='/api/legal/accept').map(request=>request.body),[
    {...termsIdentity(locale),accepted:true},{...termsIdentity(locale),accepted:true}
   ]);
   assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
 });
}
