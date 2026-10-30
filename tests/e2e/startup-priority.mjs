// Actual Splash/LammaProvider in Chromium; only image delivery and social HTTP
// replies are local fixtures. This proves scheduling, not hosted RTT or iPhone.
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { escapeInlineScript } from '../../scripts/lib.mjs';

const bundle = await build({ stdin: { loader: 'jsx', resolveDir: process.cwd(), contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{Splash}from'./src/platform/screens/Splash.jsx';import{LammaProvider,LammaContext,useLamma}from'./src/social/LammaProvider.jsx';
import{SocialContext}from'./src/social/SocialProvider.jsx';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';
import{navigate}from'./src/platform/router.js';import{audioActivity}from'./src/social/media.js';
window.fixture={pending:[],navigate,audio:active=>audioActivity('fixture-recorder',active)};
let hidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
window.fixture.hide=value=>{hidden=value;document.dispatchEvent(new Event('visibilitychange'))};
function Plain(){const[lamma,setLamma]=useState({});window.fixture.setCall=setLamma;return <LammaContext.Provider value={lamma}><Splash visible={false} onDone={()=>{}}/></LammaContext.Provider>}
function Observe(){const value=useLamma();window.fixture.lamma=value;return <><output id="busy">{String(value.callConnecting)}</output><Splash visible={false} onDone={()=>{}}/></>}
const sound={setDucking(){}};
function Provider(){const[owner,setOwner]=useState('first');window.fixture.setOwner=setOwner;const request=async(path,options={})=>{if(path==='/api/social/calls'&&options.method==='POST'||path.endsWith('/accept'))return new Promise((resolve,reject)=>window.fixture.pending.push({owner,reject:()=>reject(Object.assign(new Error('fixture'),{code:'CALL_UNAVAILABLE'}))}));return {}};const account={...NULL_ACCOUNT,ready:true,signedIn:!!owner,user:owner?{id:owner}:null,requestAuthenticated:request};return <AccountContext.Provider value={account}><PlatformContext.Provider value={{sound}}><SocialContext.Provider value={{connected:false,refresh:async()=>{}}}><LammaProvider><Observe/></LammaProvider></SocialContext.Provider></PlatformContext.Provider></AccountContext.Provider>}
if(location.search.includes('native'))window.MaydanNative={};
createRoot(document.getElementById('root')).render(location.search.includes('provider')?<Provider/>:<Plain/>);
` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const html = `<!doctype html><html><div id="root"></div><script>${escapeInlineScript(bundle.outputFiles[0].text)}</script></html>`;
let requests = 0;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://fixture').pathname;
  if (pathname === '/') { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(html); return; }
  if (pathname.startsWith('/media/')) { requests++; setTimeout(() => { res.writeHead(200, { 'content-type': 'image/webp' }); res.end(Buffer.from([1, 2, 3])); }, 45); return; }
  res.writeHead(404); res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const errors = [], contexts = [];
async function pageAt(path) {
  const context = await browser.newContext(); contexts.push(context); const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + path); await page.waitForFunction(() => !!window.fixture.setCall || !!window.fixture.lamma); return page;
}
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function paused(page) { await page.waitForFunction(() => document.querySelector('.startup-background')?.textContent.includes('متوقف مؤقتًا')); await new Promise(resolve => setTimeout(resolve, 140)); const count = requests; await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(requests, count, 'paused queue launches no more requests after in-flight bodies finish'); }
try {
  const page = await pageAt('/#/online/mafia'); await paused(page); assert.equal(requests, 0, 'direct online launch starts no elective image fetches');
  await page.evaluate(() => fixture.navigate('/')); await page.waitForFunction(() => document.querySelector('.startup-background')?.textContent.includes('نجهّز الصور')); await new Promise(resolve => setTimeout(resolve, 80)); assert.ok(requests > 0);
  await page.evaluate(() => fixture.navigate('/room/123456')); await paused(page); const first = requests;
  assert.ok(await page.evaluate(async () => (await (await caches.open('maydan-media-v1')).keys()).length) > 0, 'in-flight images remain saved');
  await page.evaluate(() => { fixture.setCall({callConnecting:true});fixture.navigate('/'); }); await paused(page);
  await page.evaluate(() => fixture.setCall({activeCall:{id:'fixture'}})); await paused(page);
  await page.evaluate(() => { fixture.setCall({});fixture.hide(true); }); await paused(page);
  await page.evaluate(() => { fixture.audio(true);fixture.hide(false); }); await paused(page);
  assert.equal(requests, first, 'independent busy reasons do not accidentally resume each other');
  await page.evaluate(() => fixture.audio(false)); await new Promise(resolve => setTimeout(resolve, 100)); assert.ok(requests > first, 'resumes the same queue after all busy reasons clear');
  await page.evaluate(() => fixture.hide(true)); await paused(page); await contexts[0].close();
  const beforeNative = requests, native = await pageAt('/?native#/'); await settle(native); await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(requests, beforeNative, 'native bundled-image bypass remains exact'); await contexts[1].close();
  const provider = await pageAt('/?provider#/room/123456'); await provider.waitForFunction(() => fixture.lamma?.loading === false);
  await provider.evaluate(() => { fixture.lamma.startCall({targetType:'direct',targetId:'friend'}).catch(()=>{}); });
  await provider.waitForFunction(() => fixture.pending.length === 1 && fixture.lamma.callConnecting === true);
  await provider.evaluate(() => fixture.navigate('/')); await paused(provider);
  await provider.evaluate(() => fixture.setOwner('second')); await provider.waitForFunction(() => fixture.lamma.callConnecting === false && fixture.lamma.loading === false);
  await provider.evaluate(() => { fixture.lamma.acceptCall('incoming').catch(()=>{}); });
  await provider.waitForFunction(() => fixture.pending.length === 2 && fixture.lamma.callConnecting === true);
  await provider.evaluate(() => fixture.pending[0].reject()); await settle(provider); assert.equal(await provider.evaluate(() => fixture.lamma.callConnecting), true, 'old-account finally cannot clear a new pending call');
  await provider.evaluate(() => fixture.pending[1].reject()); await provider.waitForFunction(() => fixture.lamma.callConnecting === false);
  await provider.evaluate(() => { fixture.lamma.startCall({targetType:'direct',targetId:'friend'}).catch(()=>{}); });
  await provider.waitForFunction(() => fixture.pending.length === 3 && fixture.lamma.callConnecting === true);
  await provider.evaluate(() => fixture.lamma.endCall()); await provider.waitForFunction(() => fixture.lamma.callConnecting === false);
  await provider.evaluate(() => { fixture.lamma.acceptCall('next').catch(()=>{}); });
  await provider.waitForFunction(() => fixture.pending.length === 4 && fixture.lamma.callConnecting === true);
  await provider.evaluate(() => fixture.pending[2].reject()); await settle(provider); assert.equal(await provider.evaluate(() => fixture.lamma.callConnecting), true, 'cancelled attempt cannot clear replacement setup');
  await provider.evaluate(() => fixture.setOwner(null)); await provider.waitForFunction(() => fixture.lamma.callConnecting === false);
  await provider.evaluate(() => fixture.pending[3].reject()); await settle(provider); assert.equal(await provider.evaluate(() => fixture.lamma.callConnecting), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed:true, actualSplash:true, actualLammaProvider:true, pauseResumeOffline:true, nativeBypass:true, directAcceptCancelLogoutFencing:true, pageErrors:errors, hostedPerformanceMeasured:false }));
} finally {
  await Promise.allSettled(contexts.map(context => context.close())); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
