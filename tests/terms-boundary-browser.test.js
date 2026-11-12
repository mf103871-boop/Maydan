// Actual TermsBoundary/router/HTTP/consent + local SQLite legal handlers. Account
// context is controlled to exercise identity races without OAuth/provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { localePackagingPlugin } from '../scripts/lib/locale-packaging.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { handleLegalRequest, legalStatus } from '../server/legal/terms.mjs';
import { errorResponse } from '../server/protocol.mjs';
import { termsIdentity } from '../src/shared/legal/terms.js';
import { verifyGuestTermsReceipt } from '../server/legal/guest-terms.mjs';

const ORIGIN='https://maydan-mafia-preview.mf103871.workers.dev';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
let compiled;
const fixtureApp=()=>compiled ||= build({stdin:{contents:`
import React,{useCallback,useMemo,useState}from'react';import{createRoot}from'react-dom/client';
import{TermsBoundary}from'./src/shared/legal/TermsBoundary.jsx';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';
import{PlatformContext}from'./src/platform/context.js';import{setUiLocale}from'./src/shared/i18n/core.js';
import{request}from'./src/shared/account/api.js';import{navigate,useRoute}from'./src/platform/router.js';
import{getGuestTermsReceipt}from'./src/shared/legal/acceptance.js';
window.fixture={toasts:[],tokens:{},owner:'guest'};
function App(){const[owner,setOwner]=useState('guest'),route=useRoute();window.fixture.route=navigate;window.fixture.setOwner=setOwner;window.fixture.owner=owner;
const requestAuthenticated=useCallback((path,options={})=>request(path,{...options,token:window.fixture.tokens[owner]}),[owner]);
const account=useMemo(()=>({...NULL_ACCOUNT,ready:true,signedIn:owner!=='guest',user:owner==='guest'?null:{id:owner},me:null,requestAuthenticated}),[owner,requestAuthenticated]);
window.fixture.receipt=()=>getGuestTermsReceipt(location.origin);
return <PlatformContext.Provider value={{toast:value=>window.fixture.toasts.push(value),settings:{uiLocale:document.documentElement.lang}}}><AccountContext.Provider value={account}><TermsBoundary route={route}><div data-testid="allowed">{route.name}:{owner}</div></TermsBoundary></AccountContext.Provider></PlatformContext.Provider>}
setUiLocale(new URL(location.href).searchParams.get('lang')||'ar').then(()=>createRoot(document.getElementById('root')).render(<App/>));
`,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',jsx:'automatic',outdir:'work/terms-boundary-fixture',plugins:[localePackagingPlugin()],loader:{'.css':'text','.js':'jsx'},define:{__MAYDAN_ROOMS_URL__:JSON.stringify(ORIGIN)},logLevel:'silent'});

async function setup(engine,locale){
 const compiled=await fixtureApp(),raw=createLocalD1(),env={DB:raw,SESSION_SECRET:'terms-browser-fixture-only'},users={},tokens={};
 for(const key of ['a','b']){users[key]=await createUser(env,{name:key,email:key+'@terms.example.test'});tokens[users[key].id]=(await issueSession(env,users[key].id)).token;}
 const browser=await engine.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),requests=[],errors=[];
 const controls={hold:null,oldVersion:false};
 const assets=new Map(compiled.outputFiles.map(file=>[path.basename(file.path),file.contents]));
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',async route=>{
  const incoming=route.request(),url=new URL(incoming.url());
  if(url.origin!==ORIGIN)return route.abort();
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#fff8eb;font-family:Arial}</style><div id="root"></div><script src="/bundle.js"></script>'});
  if(url.pathname==='/bundle.js')return route.fulfill({contentType:'application/javascript',body:Buffer.from(compiled.outputFiles.find(f=>f.path.endsWith('.js')).contents)});
  const asset=assets.get(path.basename(url.pathname));if(asset)return route.fulfill({contentType:'application/json',body:Buffer.from(asset)});
  requests.push({path:url.pathname,method:incoming.method(),headers:await incoming.allHeaders(),body:incoming.postDataJSON()});
  if(url.pathname==='/api/legal/accept'&&controls.hold){const gate=controls.hold;gate.entered.resolve();await gate.release.promise;}
  if(url.pathname==='/api/legal/accept'&&controls.oldVersion)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'TERMS_VERSION_CHANGED'})});
  let response;try{response=await handleLegalRequest(new Request(incoming.url(),{method:incoming.method(),headers:await incoming.allHeaders(),...(incoming.method()==='POST'?{body:incoming.postData()}: {})}),env);}catch(error){response=errorResponse(error);}
  if(!response)return route.fulfill({status:404,contentType:'application/json',body:'{}'});
  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
 });
 await page.goto(ORIGIN+'/?lang='+locale+'#/play/beep');await page.getByRole('checkbox').waitFor();await page.evaluate(tokens=>Object.assign(window.fixture.tokens,tokens),tokens);
 return{page,context,env,raw,users,tokens,requests,errors,controls,async close(){controls.hold?.release.resolve();await browser.close();raw.close();}};
}
const agree=async page=>{await page.getByRole('checkbox').check();await page.locator('button[type=submit]').click();};
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
}
