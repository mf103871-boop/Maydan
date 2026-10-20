// Isolated real-browser regressions for the production design runtime. All API
// responses are synthetic; no account, microphone or external endpoint is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const services = `
import{createContext,useContext}from'react';
export const AccountContext=createContext(null),LammaContext=createContext(null),RouteContext=createContext(null);
export const useAccount=()=>useContext(AccountContext),useLamma=()=>useContext(LammaContext),useRoute=()=>useContext(RouteContext);
export const resolveAccountServer=()=>location.origin;
export const request=(path,options)=>window.fixtureService.read(path,{...options,owner:null});
`;
const harness = `
import React,{useContext,useEffect,useMemo,useState}from'react';
import{createRoot}from'react-dom/client';
import{DesignRuntime}from'./src/design/DesignRuntime.jsx';
import{DesignContext}from'./src/design/context.js';
import{createDefaultDesign}from'./src/design/schema.js';
import{AccountContext,LammaContext,RouteContext}from'fixture-services';
const CACHE='maydan-design-published-v1',STORAGE='maydan:design:published:v1';
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZCYAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
const image=(extra=0)=>{const bytes=new Uint8Array(png.length+extra);bytes.set(png);return new Response(bytes,{headers:{'content-type':'image/png'}});};
function config(channel,versionId,assetIds,label){const document=createDefaultDesign();document.assets=assetIds;document.screens.home={nodes:{title:{text:label}},decorations:assetIds.map((assetId,i)=>({id:'art-'+i,type:'image',assetId,layouts:{portrait:{x:.1+i*.3,y:.35,width:.2,height:.1}}}))};return{channel,versionId,document};}
const published=config('published','public-v1',['public-image'],'published'),preview=config('preview','private-v1',['private-alpha','private-beta'],'private');
const scenario=new URL(location.href).searchParams.get('case')||'offline';
const stats={requests:[],created:[],revoked:[],history:[],cacheWrites:[],quotaFailures:0},pending=new Map();
let remoteOffline=scenario!=='quota',failDelete=false,waitForPrivate=scenario==='logout';
window.fixtureStats=stats;
const createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=createURL(blob);stats.created.push({url,size:blob.size});return url;};
URL.revokeObjectURL=url=>{stats.revoked.push(url);revokeURL(url);};
const openCache=caches.open.bind(caches);
caches.open=async name=>{const cache=await openCache(name);return{match:key=>cache.match(key),put:async(key,response)=>{stats.cacheWrites.push(String(key));if(scenario==='quota'){stats.quotaFailures++;throw new DOMException('fixture cache quota','QuotaExceededError');}return cache.put(key,response);}};};
async function read(resource,{owner=null,method='GET'}={}){
 stats.requests.push({path:resource,owner,method});
 if(method==='DELETE'){if(failDelete)throw new Error('fixture offline');return null;}
 if(remoteOffline)throw new Error('fixture offline');
 if(resource.startsWith('/api/ui-config'))return owner==='owner-A'?preview:published;
 if(resource.endsWith('/public-image'))return image();
 if(resource.endsWith('/private-alpha'))return image(1);
 if(resource.endsWith('/private-beta')){if(waitForPrivate)await new Promise(resolve=>pending.set('private-beta',resolve));return image(2);}
 throw new Error('unexpected fixture endpoint '+resource);
}
window.fixtureService={read,setOnline:value=>{remoteOffline=!value;},setDeleteFailure:value=>{failDelete=value;},releasePrivate:()=>{waitForPrivate=false;pending.get('private-beta')?.();pending.delete('private-beta');}};
function Probe(){const design=useContext(DesignContext);const label=design.document.screens.home?.nodes?.title?.text||'default';useEffect(()=>{stats.history.push({label,assets:{...design.assetUrls}});},[label,design.assetUrls]);return <output id="applied-label">{label}</output>;}
function Harness(){
 const[owner,setOwner]=useState(null),[route,setRoute]=useState('home'),[activeCall,setActiveCall]=useState(false);
 const account=useMemo(()=>({ready:true,signedIn:!!owner,user:owner?{id:owner}:null,requestAuthenticated:(resource,options)=>read(resource,{...options,owner})}),[owner]);
 const lamma=useMemo(()=>({activeCall:activeCall?{id:'fixture-call'}:null}),[activeCall]);const routeValue=useMemo(()=>({name:route}),[route]);
 useEffect(()=>{window.fixtureControls={setOwner,setRoute,setCall:setActiveCall,refresh:()=>dispatchEvent(new Event('online'))};},[]);
 return <AccountContext.Provider value={account}><LammaContext.Provider value={lamma}><RouteContext.Provider value={routeValue}><DesignRuntime><Probe/><section data-design-screen="home" id="scene" style={{position:'relative',height:500,width:360}}><h1 data-design-id="title">default</h1></section></DesignRuntime></RouteContext.Provider></LammaContext.Provider></AccountContext.Provider>;
}
async function start(){
 localStorage.clear();
 if(scenario!=='quota'){localStorage.setItem(STORAGE,JSON.stringify(published));const cache=await openCache(CACHE);await cache.put(location.origin+'/api/design/assets/public-image',image());}
 const root=createRoot(document.getElementById('root'));window.fixtureUnmount=()=>root.unmount();root.render(<Harness/>);
}
void start().catch(error=>{window.fixtureBootError=error.message;});
`;

const targetFiles = new Set(['src/shared/account/context.js','src/shared/account/api.js','src/social/LammaProvider.jsx','src/platform/router.js'].map(file=>path.resolve(file)));
const built = await build({stdin:{contents:harness,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',alias:{'react/jsx-runtime':path.resolve('src/design/jsx-runtime.js')},loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl'},define:{'process.env.NODE_ENV':JSON.stringify('production')},plugins:[{name:'isolated-runtime-services',setup(build){build.onResolve({filter:/.*/},args=>{if(args.path==='fixture-services'||args.importer&&targetFiles.has(path.resolve(path.dirname(args.importer),args.path)))return{path:'fixture-services',namespace:'runtime-test'};});build.onLoad({filter:/.*/,namespace:'runtime-test'},()=>({contents:services,loader:'jsx',resolveDir:process.cwd()}));}}],logLevel:'silent'});
const bundle=built.outputFiles[0].text;
const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;
const server=http.createServer((request,response)=>{response.writeHead(200,{'content-type':request.url==='/bundle.js'?'application/javascript':'text/html;charset=utf-8'});response.end(request.url==='/bundle.js'?bundle:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
async function openFixture(browser,scenario){const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`${origin}/?case=${scenario}`);await page.waitForFunction(()=>window.fixtureControls||window.fixtureBootError);assert.equal(await page.evaluate(()=>window.fixtureBootError),undefined);return{context,page,errors};}
const labelIs=async(page,value)=>{try{await page.waitForFunction(value=>document.querySelector('#applied-label')?.textContent===value,value,{timeout:5000});}catch(error){throw new Error(`Expected ${value}: ${JSON.stringify(await page.evaluate(()=>({label:document.querySelector('#applied-label')?.textContent,stats:fixtureStats,visibility:document.visibilityState,body:document.body.innerText})))}`,{cause:error});}};
const decodedImages=page=>page.waitForFunction(()=>{const images=[...document.querySelectorAll('[data-design-decoration]')];return images.length>0&&images.every(image=>image.tagName==='IMG'&&image.src.startsWith('blob:')&&image.complete&&image.naturalWidth===1);});
async function assertCleanup(page){await page.evaluate(()=>window.fixtureUnmount());await page.waitForFunction(()=>fixtureStats.created.every(item=>fixtureStats.revoked.includes(item.url)));}

for(const[name,engine]of[['chromium',chromium],['webkit',webkit]])test(`${name}: runtime restores public images, defers exits, isolates accounts and tolerates cache quota`,{timeout:90000},async()=>{
 const browser=await engine.launch({headless:true});
 try{
  {const{context,page,errors}=await openFixture(browser,'offline');try{await labelIs(page,'published');await decodedImages(page);assert.equal(await page.evaluate(()=>fixtureStats.requests.some(item=>item.path.includes('/assets/'))),false,'cold offline image hydration must never fetch image bytes');await assertCleanup(page);assert.deepEqual(errors,[]);}finally{await context.close();}}
  {const{context,page,errors}=await openFixture(browser,'transition');try{
    await labelIs(page,'published');await decodedImages(page);
    await page.evaluate(()=>{fixtureService.setOnline(true);fixtureControls.setOwner('owner-A');});await labelIs(page,'private');await decodedImages(page);
    const privateURLs=await page.evaluate(()=>fixtureStats.created.filter(item=>item.size>68).map(item=>item.url));
    await page.evaluate(()=>{fixtureControls.setRoute('play');fixtureControls.setCall(true);fixtureService.setDeleteFailure(true);fixtureService.setOnline(false);});
    await page.getByRole('button',{name:'العودة للتصميم المنشور',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('aside button')?.disabled===true);assert.equal(await page.locator('#applied-label').textContent(),'private','exit waits for the local game');
    await page.evaluate(()=>fixtureControls.setRoute('home'));await page.waitForTimeout(100);assert.equal(await page.locator('#applied-label').textContent(),'private','exit also waits for an active call');
    await page.evaluate(()=>fixtureControls.setCall(false));await labelIs(page,'published');await decodedImages(page);
    await page.evaluate(()=>{fixtureService.setOnline(true);fixtureControls.refresh();});await page.waitForTimeout(120);assert.equal(await page.locator('#applied-label').textContent(),'published','failed preview DELETE must not reapply the ignored owner preview');await decodedImages(page);
    assert.equal(await page.evaluate(urls=>urls.every(url=>fixtureStats.revoked.includes(url)),privateURLs),true,'private object URLs are reclaimed after public fallback');
    assert.equal(await page.evaluate(()=>fixtureStats.cacheWrites.some(key=>key.includes('private-'))),false,'private image bytes never enter published CacheStorage');await assertCleanup(page);assert.deepEqual(errors,[]);
  }finally{await context.close();}}
  {const{context,page,errors}=await openFixture(browser,'logout');try{
    await labelIs(page,'published');await decodedImages(page);
    await page.evaluate(()=>{fixtureService.setOnline(true);fixtureControls.setOwner('owner-A');});
    await page.waitForFunction(()=>fixtureStats.requests.some(item=>item.path.endsWith('/private-beta'))&&fixtureStats.created.some(item=>item.size===69));
    const partialURL=await page.evaluate(()=>fixtureStats.created.find(item=>item.size===69).url);
    await page.evaluate(()=>{fixtureService.setOnline(false);fixtureControls.setOwner(null);});await page.waitForTimeout(50);await page.evaluate(()=>fixtureService.releasePrivate());
    await labelIs(page,'published');await decodedImages(page);await page.waitForFunction(url=>fixtureStats.revoked.includes(url),partialURL);
    assert.equal(await page.evaluate(()=>fixtureStats.history.some(item=>item.label==='private'||Object.keys(item.assets).some(key=>key.startsWith('private-')))),false,'late private image results must never render after logout');
    assert.equal(await page.evaluate(()=>fixtureStats.cacheWrites.some(key=>key.includes('private-'))),false);await assertCleanup(page);assert.deepEqual(errors,[]);
  }finally{await context.close();}}
  {const{context,page,errors}=await openFixture(browser,'quota');try{await labelIs(page,'published');await decodedImages(page);assert.ok(await page.evaluate(()=>fixtureStats.quotaFailures)>0,'fixture must exercise a real cache.put rejection');assert.equal(await page.evaluate(()=>fixtureStats.requests.filter(item=>item.path.endsWith('/public-image')).length),1,'downloaded response must survive the optional cache failure');await assertCleanup(page);assert.deepEqual(errors,[]);}finally{await context.close();}}
 }finally{await browser.close();}
});
test.after(()=>new Promise(resolve=>server.close(resolve)));
