import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';
import {MAFIA_LABS,labActors} from '../src/games/mafia/tutorial/labs/scenarios.mjs';

test('Chromium/WebKit: six real specialty lessons, wrong choices/retry, RTL, privacy, owned local saves and zero transport', {timeout:180000},async()=>{
  const built=await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`
    import React,{useEffect} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{AccountContext}from'./src/shared/account/context.js';import{LammaContext}from'./src/social/LammaProvider.jsx';
    import{useRoute}from'./src/platform/router.js';import{MafiaLabs}from'./src/games/mafia/tutorial/labs/MafiaLabs.jsx';
    import{useLabProgress}from'./src/games/mafia/tutorial/labs/progress.js';import{createMafiaLab}from'./src/games/mafia/tutorial/labs/adapter.mjs';
    import ui from './src/shared/ui/ui.css';import platform from './src/platform/platform.css';import brand from './src/shared/brand/brand.css';
    window.calls=[];window.mediaCalls=[];window.transport=[];window.view='labs';window.probe=null;
    window.fetch=(...args)=>{window.transport.push('fetch');return Promise.reject(Error('No course HTTP'));};
    window.WebSocket=class{constructor(){window.transport.push('socket');throw Error('No course socket');}};
    const realCall={id:'existing-social-call',scope:'social',status:'connected'};
    window.social=new Proxy({activeCall:realCall},{get(target,key){if(key in target)return target[key];return()=>{window.mediaCalls.push(String(key));throw Error('Existing call mutation');};}});
    const root=createRoot(document.getElementById('root'));
    function Probe(){const value=useLabProgress('doctor');useEffect(()=>{window.probe=value;});return <p>{value.owner||'waiting'}</p>;}
    function App(){const route=useRoute();return <AccountContext.Provider value={window.account}><LammaContext.Provider value={window.social}><style>{ui}{platform}{brand}</style>{window.view==='probe'?<Probe/>:<MafiaLabs key={route.params.lab||'hub'} courseId={route.params.lab}/>}</LammaContext.Provider></AccountContext.Provider>;}
    window.show=(id='A',flags={})=>{window.account={ready:true,signedIn:id!==null,user:id?{id}:null,requestAuthenticated:(...args)=>{window.calls.push(args);return Promise.reject(Error('No status sync'));},authHeaders:()=>{window.calls.push('auth');return{};},...flags};flushSync(()=>root.render(<App/>));};
    window.makeProgress=()=>{const lab=createMafiaLab({courseId:'doctor'});lab.guide('continue');const result=lab.exportProgress();lab.dispose();return result;};
    window.unmount=()=>root.unmount();window.show();
  `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl'},plugins:[{name:'controlled-context-only',setup(builder){
    builder.onResolve({filter:/shared\/account\/api\.js$/},()=>({path:'api',namespace:'fixture'}));
    builder.onResolve({filter:/social\/LammaProvider\.jsx$/},()=>({path:'lamma',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='api'?"export const resolveAccountServer=()=> 'https://specialty.invalid';":"import{createContext,useContext}from'react';export const LammaContext=createContext(null);export const useLamma=()=>useContext(LammaContext);",resolveDir:process.cwd(),loader:'js'}));
  }}],logLevel:'silent'});
  const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}</style><div id="root"></div><script src="/bundle.js"></script></html>';
  const server=createServer(async(request,response)=>{
    const pathname=new URL(request.url,'http://fixture').pathname;
    if(pathname==='/bundle.js'){response.setHeader('content-type','text/javascript');response.end(built.outputFiles[0].contents);return;}
    if(pathname==='/'){response.setHeader('content-type','text/html; charset=utf-8');response.end(html);return;}
    const file=path.resolve('public','.'+decodeURIComponent(pathname));
    if(file.startsWith(path.resolve('public')+path.sep))try{const data=await readFile(file);response.setHeader('content-type',({'.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');response.end(data);return;}catch{/* no private files */}
    response.writeHead(204);response.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const output=path.resolve('.cache/mafia-specialty-browser');await mkdir(output,{recursive:true});
  try{for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
    const browser=await engine.launch({headless:true});
    try{
      const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],writes=[],sockets=[],external=[];
      page.on('pageerror',error=>errors.push(error.message));page.on('websocket',socket=>sockets.push(socket.url()));
      page.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(request.url());});
      await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
      await page.addInitScript(()=>{window.microphoneCalls=0;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>{window.microphoneCalls++;throw Error('No course microphone');},enumerateDevices:async()=>[]}});});
      const button=id=>page.locator('[data-design-id="'+id+'"]').filter({visible:true}).first();
      const expectStep=expected=>page.waitForFunction(step=>document.querySelector('[data-lesson-step]')?.getAttribute('data-lesson-step')===step,expected,{timeout:7000});
      const next=async step=>{await button('tutorial-continue').click();await expectStep(step);};
      const target=async id=>{await page.locator('[data-design-id="player-seat"][data-player-id="'+id+'"]').click();await button('ability-submit').click();};
      const by=(course,role)=>labActors(course).find(actor=>actor.roleId===role).id;
      const retry=async step=>{await button('tutorial-retry').click();await expectStep(step);};
      const ability=async()=>{if(await button('night-ability-tab').count())await button('night-ability-tab').click();};
      await page.goto(origin+'/#/tutorial/mafia?labs=1');await page.getByRole('heading',{name:'تمارين التخصص',exact:true}).waitFor();
      await page.evaluate(()=>localStorage.setItem('maydan:mafia-tutorial:sentinel','original untouched'));
      for(const [course,spec] of Object.entries(MAFIA_LABS)){
        await page.locator('article').filter({has:page.getByRole('heading',{name:spec.title,exact:true})}).getByRole('button',{name:'ابدأ التمرين',exact:true}).click();await expectStep('intro');
        assert.match(await button('tutorial-disclosure').innerText(),/شخصيات تدريب/);assert.equal(await button('voice-join').count(),0);
        if(course==='doctor'){
          for(const [width,height] of [[320,568],[390,844],[844,390]]){
            await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' '+width+' overflow');
            await button('tutorial-continue').scrollIntoViewIfNeeded();const box=await button('tutorial-continue').boundingBox();assert.ok(box.height>=43&&box.x>=0&&box.x+box.width<=width+1);
            await page.screenshot({path:path.join(output,name+'-'+width+'.png'),fullPage:false});
          }
          await page.setViewportSize({width:390,height:844});await button('role-toggle').click();await button('role-content').waitFor();
          assert.equal(await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));return document.querySelectorAll('[data-design-id="role-content"], [data-lesson-step]').length;}),0,'pagehide covers role and private teaching text even before document.hidden changes');
          await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await button('role-toggle').waitFor();assert.equal(await button('role-content').count(),0);
          await button('role-toggle').click();await button('role-content').waitFor();
          await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
          await button('privacy').waitFor();assert.equal(await button('role-content').count(),0);
          assert.equal(await page.locator('[data-lesson-step]').count(),0,'the teaching panel also contains private NPC results and must be covered');
          await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
          await button('role-toggle').waitFor();assert.equal(await button('role-content').count(),0);
          await next('self');await target(by(course,'citizen'));await button('tutorial-retry').waitFor();await retry('self');
          await target('lab-0');await expectStep('self-result');await next('protect');await target(by(course,'investigator'));
          await expectStep('protect-result');await next('repeat');await target(by(course,'citizen'));await expectStep('done');
        }else if(course==='masker'){
          await next('mask');await ability();await target('lab-0');await button('tutorial-retry').waitFor();await retry('mask');await ability();await target(by(course,'mafia'));
          await expectStep('mask-result');assert.match(await page.locator('.mafia-tutorial-coach').innerText(),/أهل الميدان/);await next('unmasked');assert.match(await page.locator('.mafia-tutorial-coach').innerText(),/المافيا/);await next('done');
        }else if(course==='blocker'){
          await next('block');await ability();await target(by(course,'citizen'));await button('tutorial-retry').waitFor();await retry('block');await ability();await target(by(course,'doctor'));
          await expectStep('block-result');await next('shield');await ability();await target(by(course,'guard'));await expectStep('done');
        }else if(course==='conversion'){
          await next('investigate');await target(by(course,'mafia'));await expectStep('investigate-result');await next('recruit');await target(by(course,'citizen'));
          await button('tutorial-retry').waitFor();await retry('recruit');await next('recruit-result');assert.equal(await button('role-content').count(),0);
          await button('role-toggle').click();assert.match(await button('role-content').innerText(),/رابطة الظل/);await button('role-hide').click();await next('after-conversion');await target(by(course,'citizen'));await expectStep('done');
        }else if(course==='tracker'){
          await next('trace');await target(by(course,'doctor'));await expectStep('trace-result');
          assert.match(await page.locator('.mafia-tutorial-coach').innerText(),/وجهة|اختيار/);
          await next('trace-quiet');await target(by(course,'investigator'));await expectStep('trace-quiet-result');
          await next('trace-blocked');await target(by(course,'doctor'));await expectStep('done');
          assert.match(await page.locator('.mafia-tutorial-coach').innerText(),/حُجب تقريرك/);
        }else if(course==='abstention'){
          await next('nominate');await button('abstain').click();await page.getByRole('button',{name:'اعتمد اختياري',exact:true}).click();await expectStep('nominate-result');await next('verdict');
          await button('verdict-yes').click();await page.getByRole('button',{name:'اعتمد اختياري',exact:true}).click();await button('tutorial-retry').waitFor();await retry('verdict');await next('done');
        }else assert.fail('Unhandled specialty lesson: '+course);
        await button('tutorial-finish').click();await page.getByRole('heading',{name:'تمارين التخصص',exact:true}).waitFor();
      }
      assert.equal(await page.locator('article').getByRole('button',{name:'أعد التمرين',exact:true}).count(),Object.keys(MAFIA_LABS).length);
      const records=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('maydan:mafia-labs:')).map(key=>JSON.parse(localStorage.getItem(key))));
      assert.equal(records.length,Object.keys(MAFIA_LABS).length);assert.ok(records.every(record=>record.owner==='https://specialty.invalid|A'&&record.decisions.length>0));
      assert.equal(records.find(record=>record.courseId==='tracker').rulesetVersion,2);
      assert.doesNotMatch(JSON.stringify(records),/roleStates|resources|seed|chat|Bearer/);assert.equal(await page.evaluate(()=>localStorage.getItem('maydan:mafia-tutorial:sentinel')),'original untouched');
      await page.locator('article').filter({has:page.getByRole('heading',{name:MAFIA_LABS.doctor.title,exact:true})}).getByRole('button',{name:'أعد التمرين',exact:true}).click();
      await page.getByRole('button',{name:'استكمل التمرين',exact:true}).click();await expectStep('done');await button('role-toggle').click();await button('role-content').waitFor();
      assert.equal(await page.evaluate(()=>{window.show('B');return Boolean(document.querySelector('[data-design-id="role-content"]'));}),false,'account switch conceals the old private card during the render');
      await expectStep('intro');assert.equal(await button('role-content').count(),0);
      await page.evaluate(()=>window.show('A'));await page.getByRole('button',{name:'استكمل التمرين',exact:true}).waitFor();assert.equal(await button('role-content').count(),0);
      await page.getByRole('button',{name:'استكمل التمرين',exact:true}).click();await expectStep('done');assert.equal(await button('role-content').count(),0);
      // The same hook instance must fence captured callbacks through A -> B -> A,
      // not merely remount a keyed child after the race has already completed.
      await page.evaluate(()=>{window.view='probe';window.show('A');});await page.waitForFunction(()=>window.probe?.record?.status==='completed');
      await page.evaluate(()=>{window.old={update:window.probe.update,owner:window.probe.owner};window.show('B');});await page.waitForFunction(()=>window.probe?.owner?.endsWith('|B')&&window.probe.record);
      assert.equal(await page.evaluate(()=>window.old.update({progress:window.makeProgress()},window.old.owner)),false);
      await page.evaluate(()=>window.show('A'));await page.waitForFunction(()=>window.probe?.owner?.endsWith('|A')&&window.probe.record);
      assert.equal(await page.evaluate(()=>window.old.update({progress:window.makeProgress()},window.old.owner)),false);assert.equal(await page.evaluate(()=>window.probe.record.status),'completed');
      await page.evaluate(()=>window.show('A',{signedIn:false}));await page.waitForFunction(()=>window.probe?.owner?.endsWith('|guest')&&window.probe.record);assert.equal(await page.evaluate(()=>window.probe.record.progress),null);
      await page.evaluate(()=>window.show('A',{ready:false}));await page.waitForFunction(()=>window.probe?.owner===null);assert.equal(await page.evaluate(()=>window.probe.record),null);
      await page.evaluate(()=>{window.show('A');});await page.waitForFunction(()=>window.probe?.record?.status==='completed');
      await page.evaluate(()=>{window.last=window.probe;window.unmount();});assert.equal(await page.evaluate(()=>window.last.update({progress:window.makeProgress()},window.last.owner)),false);
      assert.deepEqual(await page.evaluate(()=>window.calls),[]);assert.deepEqual(await page.evaluate(()=>window.mediaCalls),[]);assert.deepEqual(await page.evaluate(()=>window.transport),[]);
      assert.equal(await page.evaluate(()=>window.microphoneCalls),0);assert.deepEqual(writes,[]);assert.deepEqual(sockets,[]);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
      await context.close();
    }finally{await browser.close();}
  }}finally{await new Promise(resolve=>server.close(resolve));}
});
