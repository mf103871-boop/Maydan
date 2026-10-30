// Independent actual-React owner/lifecycle tests. These use the shipped hook
// and tutorial view with controlled account/status/social contexts. They are
// local browser evidence, not hosted, native audio or physical-iPhone evidence.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

let browser, server, origin, bundle;
before(async()=>{
  const result=await build({stdin:{resolveDir:process.cwd(),sourcefile:'tutorial-owner-fixture.jsx',loader:'jsx',contents:`
    import React,{useEffect} from 'react';
    import {createRoot} from 'react-dom/client';
    import {AccountContext} from './src/shared/account/context.js';
    import {LammaContext} from './src/social/LammaProvider.jsx';
    import {useTutorialProgress} from './src/games/mafia/tutorial/useTutorialProgress.js';
    import {MafiaTutorial} from './src/games/mafia/tutorial/MafiaTutorial.jsx';
    window.calls=[];window.pending=[];window.probe=null;window.mediaCalls=[];
    window.view='hook';window.loadStatus=false;window.defer=false;
    const root=createRoot(document.getElementById('root'));let revision=0;
    const realCall=Object.freeze({id:'existing-social-call',scope:'social',status:'connected',muted:false,participants:Object.freeze([{id:'friend',speaking:true}])});
    window.social=new Proxy({activeCall:realCall},{get(target,key){if(key in target)return target[key];return(...args)=>{window.mediaCalls.push({key,args});throw Error('Tutorial must not mutate real social media');};},set(){throw Error('Existing call mutated');}});
    function Probe(){const state=useTutorialProgress({loadStatus:window.loadStatus});useEffect(()=>{window.probe=state;});return <p>{state.owner}</p>;}
    window.switchOwner=id=>{
      window.auth={ready:true,signedIn:true,user:{id},requestAuthenticated:(path,options)=>{
        const call={actor:id,path,options};window.calls.push(call);
        if(window.defer)return new Promise(resolve=>window.pending.push({call,resolve}));
        return Promise.resolve({tutorialId:'mafia',scenarioVersion:1,rulesetVersion:1,status:options?.body?.status||'unseen'});
      }};
      root.render(<AccountContext.Provider value={window.auth}><LammaContext.Provider value={window.social}>{window.view==='hook'?<Probe revision={++revision}/>:<MafiaTutorial/>}</LammaContext.Provider></AccountContext.Provider>);
    };
    window.resolveRequest=(index,status)=>{window.pending[index].resolve({tutorialId:'mafia',scenarioVersion:1,rulesetVersion:1,status});};
    window.unmount=()=>root.unmount();
    window.switchOwner('A');
  `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl'},plugins:[{name:'controlled-status-and-social-context',setup(b){
    b.onResolve({filter:/shared\/account\/api\.js$/},()=>({path:'api',namespace:'controlled'}));
    b.onResolve({filter:/social\/LammaProvider\.jsx$/},()=>({path:'lamma',namespace:'controlled'}));
    b.onLoad({filter:/.*/,namespace:'controlled'},args=>({contents:args.path==='api'?"export const resolveAccountServer=()=> 'https://tutorial-review.invalid';":"import {createContext,useContext} from 'react';export const LammaContext=createContext(null);export const useLamma=()=>useContext(LammaContext);",loader:'js',resolveDir:process.cwd()}));
  }}]});
  bundle=result.outputFiles[0].text;
  server=http.createServer((req,res)=>{
    if(req.url==='/'||req.url.startsWith('/?')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(`<html lang="ar"><meta charset="utf-8"><body><div id="root"></div><script>${bundle.replaceAll('</script','<\\/script')}</script></body></html>`);return;}
    res.writeHead(204);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  const engine=process.env.MAFIA_E2E_ENGINE==='webkit'?webkit:chromium;
  browser=await engine.launch(engine===chromium&&process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
});
after(async()=>{await browser?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));});

async function fixture(){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  const errors=[],external=[],sockets=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('websocket',socket=>sockets.push(socket.url()));
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
  await context.addInitScript(()=>{window.microphoneRequests=0;window.nativeMessages=[];window.webkit={messageHandlers:{maydan:{postMessage:message=>{window.nativeMessages.push(message);throw Error('No native bridge mutations in tutorial');}}}};Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>{window.microphoneRequests++;throw Error('No native microphone allowed');},enumerateDevices:async()=>[]}});});
  await page.goto(origin);try{await ownerReady(page,'A');}catch(error){await context.close();throw new Error(`Fixture failed: ${JSON.stringify({errors,external})}`,{cause:error});}
  return{context,page,assertClean:async()=>{assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(sockets,[]);assert.equal(await page.evaluate(()=>window.microphoneRequests),0);assert.deepEqual(await page.evaluate(()=>window.nativeMessages),[]);}};
}
const ownerReady=(page,id)=>page.waitForFunction(id=>window.probe?.owner?.endsWith('|'+id)&&window.probe.record?.owner===window.probe.owner,id,{timeout:5000});
const switchTo=async(page,id)=>{await page.evaluate(id=>window.switchOwner(id),id);await ownerReady(page,id);};
const settle=page=>page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,30)));

test('actual hook rejects captured A callbacks after B and after ABA; unmounted callbacks are inert',{timeout:30000},async()=>{
  const f=await fixture(),{page}=f;
  try{
    await page.evaluate(()=>{window.old={mark:window.probe.mark,update:window.probe.update,current:window.probe.isCurrentOwner,owner:window.probe.owner};});
    for(const id of ['B','A']){
      await switchTo(page,id);
      const rejected=await page.evaluate(()=>({completed:window.old.mark('completed'),skipped:window.old.mark('skipped'),update:window.old.update({status:'completed'},window.old.owner),current:window.old.current(window.old.owner),calls:window.calls.length}));
      assert.deepEqual(rejected,{completed:false,skipped:false,update:false,current:false,calls:0});
    }
    assert.equal(await page.evaluate(()=>window.probe.mark('completed')),true);
    await page.waitForFunction(()=>window.probe.record.status==='completed');
    const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,1);assert.equal(calls[0].actor,'A');
    const disposed=await page.evaluate(()=>{const mark=window.probe.mark;window.unmount();return{result:mark('skipped'),calls:window.calls.length};});
    assert.deepEqual(disposed,{result:false,calls:1});await f.assertClean();
  }finally{await f.context.close();}
});

test('actual hook ignores deferred GET and PUT responses from a previous ABA generation',{timeout:30000},async()=>{
  const f=await fixture(),{page}=f;
  try{
    await page.evaluate(()=>{window.defer=true;window.loadStatus=true;window.switchOwner('A');});
    await page.waitForFunction(()=>window.pending.length===1);
    await switchTo(page,'B');await page.waitForFunction(()=>window.pending.length===2);
    await switchTo(page,'A');await page.waitForFunction(()=>window.pending.length===3);
    await page.evaluate(()=>{window.resolveRequest(0,'completed');window.resolveRequest(1,'skipped');});await settle(page);
    assert.equal(await page.evaluate(()=>window.probe.record.status),'unseen');
    await page.evaluate(()=>window.resolveRequest(2,'unseen'));await settle(page);
    await page.evaluate(()=>window.probe.mark('skipped'));await page.waitForFunction(()=>window.pending.length===4);
    await switchTo(page,'B');await page.waitForFunction(()=>window.pending.length===5);
    await switchTo(page,'A');await page.waitForFunction(()=>window.pending.length===7);
    // Returning A publishes its pending terminal status plus a new GET. The
    // response from the prior A generation cannot upgrade that record.
    await page.evaluate(()=>window.resolveRequest(3,'completed'));await settle(page);
    assert.equal(await page.evaluate(()=>window.probe.record.status),'skipped');
    await f.assertClean();
  }finally{await f.context.close();}
});

test('tutorial simulated voice leaves an existing social call unchanged and never requests media',{timeout:30000},async()=>{
  const f=await fixture(),{page}=f;
  try{
    const call=await page.evaluate(()=>window.social.activeCall);
    await page.evaluate(()=>{window.view='tutorial';window.switchOwner('A');});
    await page.locator('[data-lesson-step="welcome"]').waitFor();
    await page.locator('[data-design-id="tutorial-continue"]').click();
    await page.locator('[data-design-id="message-input"]').fill('رسالة تدريب فقط');await page.locator('[data-design-id="send"]').click();
    await page.locator('[data-lesson-step="lobby-voice"]').waitFor();
    await page.locator('[data-design-id="voice-join"]').click();
    await page.locator('[data-design-id="mute"]').click();
    await page.locator('[data-lesson-step="lobby-ready"]').waitFor();
    assert.deepEqual(await page.evaluate(()=>window.social.activeCall),call);assert.deepEqual(await page.evaluate(()=>window.mediaCalls),[]);
    await page.evaluate(()=>{window.social=Object.freeze({activeCall:Object.freeze({id:'ongoing-mafia-call',scope:'mafia',muted:true})});window.switchOwner('A');});
    await page.getByText('أكمل مجلسك الحالي أولًا.',{exact:false}).waitFor();
    assert.equal(await page.locator('[data-lesson-step]').count(),0);
    assert.deepEqual(await page.evaluate(()=>window.social.activeCall),{id:'ongoing-mafia-call',scope:'mafia',muted:true});
    assert.deepEqual(await page.evaluate(()=>window.calls),[]);await f.assertClean();
  }finally{await f.context.close();}
});
