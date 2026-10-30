// Real React controls with explicit synthetic HTTP responses; no hosted/live
// account mutations. Server/workerd tests separately prove authoritative seats.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
const source=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{Entry}from'./src/online/Online.jsx';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';
window.directoryRequests=[];window.mutations=[];window.deferredMutations=[];window.fetch=(url,options={})=>{if(url.includes('/rooms/public'))return new Promise(resolve=>window.directoryRequests.push({url,headers:options.headers,signal:options.signal,resolve:body=>resolve(new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}}))}));if(options.method==='POST'){window.mutations.push({url,headers:options.headers,body:JSON.parse(options.body)});const error=window.nextMutationError;window.nextMutationError=null;const response=()=>new Response(JSON.stringify(error?{error}:{code:'654321'}),{status:error?409:200,headers:{'content-type':'application/json'}});return window.deferMutation?new Promise(resolve=>window.deferredMutations.push(()=>resolve(response()))):Promise.resolve(response());}return Promise.reject(new Error('unexpected-fixture-request'));};
function Fixture(){const p=new URLSearchParams(location.search);const[owner,setOwner]=useState(p.has('guest')?null:'fixture-owner');const[mounted,setMounted]=useState(true);window.switchOwner=setOwner;window.unmountEntry=()=>setMounted(false);const account={...NULL_ACCOUNT,user:owner?{id:owner,name:'لاعب الاختبار'}:null,signedIn:!!owner,authHeaders:()=>owner?{authorization:'Bearer '+owner}:{}};return <AccountContext.Provider value={account}>{mounted?<Entry initialGame={p.get('game')||'mafia'} initialCode={p.get('code')||''} onJoined={code=>window.joined=code}/>:<p>left entry</p>}</AccountContext.Provider>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
const built=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl'},define:{__MAYDAN_ROOMS_URL__:JSON.stringify('https://mafia-fixture.invalid'),'process.env.NODE_ENV':JSON.stringify('production')},logLevel:'silent'});
const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?built.outputFiles[0].contents:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const engine=process.env.MAFIA_E2E_ENGINE==='webkit'?webkit:chromium;
const browser=await engine.launch({headless:true,...(engine===chromium&&process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const checks=[],errors=[],room={code:'123456',protocol:2,mode:'classic',hostName:'مضيف حقيقي',capacity:8,players:3,ready:2};
async function page(query=''){const p=await browser.newPage({viewport:{width:390,height:844}});p.on('pageerror',e=>errors.push(e.message));await p.routeWebSocket(/mafia-fixture\.invalid/,socket=>socket.close({code:1011,reason:'isolated synthetic directory'}));await p.goto(`http://127.0.0.1:${server.address().port}/${query}`);return p;}
async function respond(p,rooms=[],enabled=true){await p.waitForFunction(()=>window.directoryRequests.length>0);await p.evaluate(({rooms,enabled})=>window.directoryRequests.at(-1).resolve({enabled,rooms}),{rooms,enabled});await p.waitForFunction(()=>document.querySelector('.online-directory-list')?.getAttribute('aria-busy')==='false'||document.querySelector('form [data-design-id="start"]')?.disabled===false);}
async function filters(p){const more=p.getByRole('button',{name:'خيارات الغرف والمساعدة',exact:true});if(await more.getAttribute('aria-expanded')!=='true')await more.click();await p.getByRole('button',{name:'تصفية الغرف',exact:true}).click();}
async function settleCreate(p){await respond(p);await p.locator('[data-design-id="create-public-room"]').click();await p.waitForFunction(()=>window.directoryRequests.length>=2);await respond(p);}
try{
  {
    const p=await page();await p.locator('[data-design-screen="online.mafia.directory"]').first().waitFor();
    assert.equal(await p.locator('form').count(),0);assert.equal(await p.locator('[data-design-id="room-join"]').count(),0);assert.equal(await p.locator('[data-design-id="quick-join"]').isDisabled(),true);
    await respond(p);assert.equal(await p.locator('[data-design-id="empty"]').count(),1);assert.equal(await p.locator('[data-design-id="room-join"]').count(),0);
    await p.locator('[data-design-id="create-public-room"]').click();await p.waitForFunction(()=>window.directoryRequests.length>=2);await respond(p);assert.equal(await p.locator('[data-design-id="visibility"]').inputValue(),'public');
    await p.locator('form [data-design-id="start"]').click();await p.waitForFunction(()=>window.joined==='654321');
    const requests=await p.evaluate(()=>window.mutations);assert.equal(requests.length,1);assert.equal(requests[0].url,'https://mafia-fixture.invalid/api/rooms');assert.equal(requests[0].body.settings.visibility,'public');checks.push('public directory first, honest empty state, explicit public creation');await p.close();
  }
  {
    const p=await page();await settleCreate(p);await p.locator('[data-design-id="visibility"]').selectOption('private');await p.locator('form [data-design-id="start"]').click();await p.waitForFunction(()=>window.joined==='654321');assert.equal(await p.evaluate(()=>window.mutations[0].body.settings.visibility),'private');checks.push('private room choice preserved');await p.close();
  }
  {
    const p=await page();await respond(p,[room]);await p.locator('[data-design-id="room-join"]').click();await p.waitForFunction(()=>window.joined==='654321');const [request]=await p.evaluate(()=>window.mutations);assert.equal(request.url,'https://mafia-fixture.invalid/api/rooms/123456/join');assert.equal(request.body.matchmaking,true);checks.push('public card joins real code with authoritative waiting/public fence');await p.close();
  }
  {
    const p=await page();await respond(p,[room]);await filters(p);await p.locator('[data-design-id="directory-voice"]').selectOption('off');await p.waitForFunction(()=>window.directoryRequests.length===2);await respond(p,[room]);await p.locator('[data-design-id="quick-join"]').click();await p.waitForFunction(()=>window.joined==='654321');const requests=await p.evaluate(()=>window.mutations);assert.equal(requests.length,1);assert.equal(requests[0].url,'https://mafia-fixture.invalid/api/matchmaking/join');assert.equal(requests[0].body.voiceMode,'off');checks.push('quick join never creates a room');await p.close();
  }
  {
    const p=await page();await respond(p,[room]);await p.evaluate(()=>window.switchOwner('second-owner'));await p.waitForFunction(()=>window.directoryRequests.length===2);assert.equal(await p.locator('[data-design-id="room-join"]').count(),0);await respond(p);assert.equal(await p.locator('[data-design-id="room-join"]').count(),0);assert.equal(await p.evaluate(()=>window.directoryRequests.at(-1).headers.authorization),'Bearer second-owner');
    await p.locator('[data-design-id="refresh"]').click();await p.waitForFunction(()=>window.directoryRequests.length===3);await p.evaluate(()=>window.switchOwner('third-owner'));await p.waitForFunction(()=>window.directoryRequests.length===4);await p.evaluate(room=>window.directoryRequests[2].resolve({enabled:true,rooms:[room]}),room);assert.equal(await p.locator('[data-design-id="room-join"]').count(),0);await respond(p);checks.push('account change clears directory and rejects stale account responses');await p.close();
  }
  {
    const p=await page();await respond(p,[room]);await p.evaluate(()=>window.nextMutationError='STARTED');await p.locator('[data-design-id="room-join"]').click();await p.waitForFunction(()=>window.directoryRequests.length===2);await respond(p);assert.equal(await p.locator('[data-design-id="room-join"]').count(),0);assert.equal(await p.evaluate(()=>window.joined),undefined);checks.push('stale started room refreshes instead of silently spectating');await p.close();
  }
  {
    const p=await page();await settleCreate(p);await p.evaluate(()=>window.deferMutation=true);await p.locator('form [data-design-id="start"]').click();await p.waitForFunction(()=>window.deferredMutations.length===1);await p.evaluate(()=>window.unmountEntry());await p.getByText('left entry',{exact:true}).waitFor();await p.evaluate(()=>window.deferredMutations[0]());await p.waitForTimeout(30);assert.equal(await p.evaluate(()=>window.joined),undefined);assert.equal(await p.evaluate(()=>!!localStorage.getItem('maydan:online:https://mafia-fixture.invalid:pendingCreate:mafia:fixture-owner')),true);checks.push('late create does not navigate after exit and retains retry credentials');await p.close();
  }
  {
    const p=await page();await respond(p,[room]);await p.evaluate(()=>window.deferMutation=true);await p.locator('[data-design-id="room-join"]').click();await p.waitForFunction(()=>window.deferredMutations.length===1);await p.evaluate(()=>window.switchOwner('second-owner'));await p.waitForFunction(()=>window.directoryRequests.length===2);await p.evaluate(()=>window.switchOwner('fixture-owner'));await p.waitForFunction(()=>window.directoryRequests.length===3);await p.evaluate(()=>window.deferredMutations[0]());await p.waitForTimeout(30);assert.equal(await p.evaluate(()=>window.joined),undefined);await respond(p,[room]);await p.evaluate(()=>window.deferMutation=false);await p.locator('[data-design-id="room-join"]').click();await p.waitForFunction(()=>window.joined==='654321');checks.push('account A-B-A rejects old join completion but permits a new explicit join');await p.close();
  }
  {
    const p=await page();await p.clock.install();await respond(p,[room]);await p.clock.fastForward(15001);await p.waitForFunction(()=>window.directoryRequests.length===2);await respond(p);assert.equal(await p.locator('[data-design-id="room-join"]').count(),0);checks.push('visible directory refresh replaces current occupancy without fake population');await p.close();
  }
  {
    const p=await page('?code=246810');await p.locator('[data-design-id="room-code"]').waitFor();assert.equal(await p.locator('[data-design-id="room-code"]').inputValue(),'246810');await p.locator('form [data-design-id="start"]').click();await p.waitForFunction(()=>window.joined==='654321');const [request]=await p.evaluate(()=>window.mutations);assert.equal(request.url,'https://mafia-fixture.invalid/api/rooms/246810/join');assert.equal(request.body.matchmaking,undefined);checks.push('private/code invitations retain ordinary join semantics');await p.close();
  }
  {
    const p=await page('?guest=1');await p.locator('[data-design-screen="online.mafia.directory"]').first().waitFor();assert.equal(await p.evaluate(()=>window.directoryRequests.length),0);assert.equal(await p.locator('[data-design-id="quick-join"]').isDisabled(),true);checks.push('guest discovery requests wait for account login');await p.close();
  }
  {
    const p=await page('?game=meenfina');await p.locator('[data-design-screen="online.meenfina.directory"]').waitFor();await respond(p);assert.ok((await p.evaluate(()=>window.directoryRequests.at(-1).url)).includes('game=meenfina'),'generic directory is explicitly scoped to its actual game');await p.locator('[data-design-id="create-public-room"]').click();await p.waitForFunction(()=>window.directoryRequests.length>=2);await respond(p);await p.locator('form [data-design-id="start"]').waitFor();assert.equal(await p.locator('[data-design-id="directory-mode"]').count(),0);checks.push('existing other online games use the same scoped directory and preserve real creation');await p.close();
  }
  {
    const p=await page();await respond(p,[{...room,full:true,status:'playing',voiceMode:'off'}]);await p.locator('[data-design-id="room-observe"]').click();await p.waitForFunction(()=>window.joined==='654321');const request=await p.evaluate(()=>window.mutations[0]);assert.equal(request.url,'https://mafia-fixture.invalid/api/rooms/123456/observe');assert.equal(request.body.capabilities.mafia,2);const storage=await p.evaluate(()=>({observer:JSON.parse(localStorage.getItem('maydan:online:https://mafia-fixture.invalid:observer:654321')),player:localStorage.getItem('maydan:online:https://mafia-fixture.invalid:654321')}));assert.equal(storage.observer.scope,'observer');assert.equal(storage.player,null);checks.push('full/running room observation uses separate credentials without consuming a seat');await p.close();
  }
  {
    const p=await page();await respond(p,[room]);await filters(p);await p.locator('[data-design-id="directory-voice"]').selectOption('off');await p.waitForFunction(()=>window.directoryRequests.length===2);assert.ok((await p.evaluate(()=>window.directoryRequests.at(-1).url)).includes('voice=off'));await p.evaluate(room=>window.directoryRequests.at(-1).resolve({enabled:true,rooms:[room],nextCursor:'opaque-page-two'}),room);await p.locator('[data-design-id="directory-next"]').click();await p.waitForFunction(()=>window.directoryRequests.length===3);assert.ok((await p.evaluate(()=>window.directoryRequests.at(-1).url)).includes('cursor=opaque-page-two'));await respond(p);await filters(p);await p.locator('[data-design-id="directory-status"]').selectOption('playing');await p.waitForFunction(()=>window.directoryRequests.length===4);assert.ok(!(await p.evaluate(()=>window.directoryRequests.at(-1).url)).includes('cursor='));await respond(p);checks.push('voice/status filters and opaque pagination are sent without mixing pages');await p.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,passed:checks.length,hosted:false}));
}finally{await browser.close();server.close();}
