import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium,webkit } from 'playwright';

const state=(changes={})=>({available:true,experimental:true,calibrated:false,canManageSeasons:false,
  season:{id:'synthetic-season',status:'open',endsAt:Date.now()+3_600_000,rulesetVersion:1,ratingModel:'preview-elo-1'},
  eligibility:{publicMatches:10,requiredMatches:10,understands:true,cooldownUntil:0,eligible:true},
  rating:{rating:1000,games:0,band:'تحديد المرتبة',provisional:true,placementRemaining:10},queue:null,waiting:0,...changes});
const session={id:'a'.repeat(32),token:'b'.repeat(64)};
const queued=(id=session.id)=>({status:'queued',seatId:id,clientSeatId:id,revision:'synthetic-revision',joinedAt:Date.now(),expiresAt:Date.now()+120_000,code:null});
const assigned=()=>({...queued(),status:'assigned',seatId:'c'.repeat(32),code:'654321'});

test('actual ranked component in Chromium/WebKit: identity fencing, queue cancellation and privacy ownership',{timeout:60_000},async t=>{
  let bundle;
  const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#131018;color:#fff;font-family:Tahoma,sans-serif}button,select{font:inherit}</style><div id="root"></div><script src="/bundle.js"></script></html>';
  const server=createServer((request,response)=>{response.setHeader('content-type',request.url==='/bundle.js'?'text/javascript':'text/html');response.end(request.url==='/bundle.js'?bundle:html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    const built=await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {AccountContext} from './src/shared/account/context.js';
      import {MafiaRanked} from './src/online/MafiaRanked.jsx';
      import {socialInterruption} from './src/social/interruption.js';
      import {readSaved,save} from './src/online/client.js';
      const root=createRoot(document.getElementById('root'));
      let identity={id:'a',token:'Bearer synthetic-a',ready:true,signedIn:true},open=false;
      const authHeaders=()=>identity.token?{Authorization:identity.token}:{};
      window.joined=[];window.closeCount=0;window.requests=[];window.lockEvents=[];
      socialInterruption.subscribe(()=>window.lockEvents.push(socialInterruption.getSnapshot().communicationLocked));
      window.locked=()=>socialInterruption.getSnapshot().communicationLocked;
      window.saved=name=>readSaved(location.origin,name);
      window.seed=(owner,session)=>save(location.origin,'rankedCredentials:'+owner,session);
      function render(){root.render(<AccountContext.Provider value={{ready:identity.ready,signedIn:identity.signedIn,user:{id:identity.id},authHeaders}}>{open&&<MafiaRanked key={identity.id} onClose={()=>{window.closeCount++;open=false;render();}} onJoined={(code,session,stored)=>{window.joined.push({code,session,stored});open=false;render();}}/>}</AccountContext.Provider>);}
      window.show=(next={})=>{identity={...identity,...next};open=true;render();};
      window.hide=()=>{open=false;render();};
      const nativeFetch=window.fetch;
      window.fetch=(url,options={})=>{
        if(!String(url).includes('/api/mafia/ranked'))return nativeFetch(url,options);
        return new Promise(resolve=>{
          const record={path:new URL(url).pathname,method:options.method||'GET',authorization:options.headers?.authorization,body:options.body?JSON.parse(options.body):null,aborted:options.signal?.aborted===true,resolve};
          options.signal?.addEventListener('abort',()=>{record.aborted=true;},{once:true});window.requests.push(record);
        });
      };
      // Deliberately deliver responses even after abort, as an already-buffered
      // fetch/body can do. Component identity/operation fences must still work.
      window.respond=(index,data,status=200)=>window.requests[index].resolve({ok:status<400,json:async()=>data});
      window.__hidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hidden});
      window.ready=true;render();
    `},define:{__MAYDAN_ROOMS_URL__:JSON.stringify(origin)},jsx:'automatic',write:false,bundle:true,format:'iife',loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl'},logLevel:'silent'});
    bundle=built.outputFiles[0].contents;
    for(const [name,engine]of [['Chromium',chromium],['WebKit',webkit]]) {
      const browser=await engine.launch({headless:true});
      try {
        async function open() {
          const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(4000);await page.clock.install();
          page.on('pageerror',error=>console.error('ranked UI fixture:',error.message));
          await page.goto(origin);await page.waitForFunction(()=>window.ready);return page;
        }
        const respond=(page,index,value,status=200)=>page.evaluate(({index,value,status})=>window.respond(index,value,status),{index,value,status});
        const requests=(page,count)=>page.waitForFunction(expected=>window.requests.length===expected,count);
        async function show(page,identity={}){await page.evaluate(value=>window.show(value),identity);}
        const seed=page=>page.evaluate(value=>window.seed('a',value),session);
        async function unknownJoin(page) {
          await seed(page);await show(page);await requests(page,1);await respond(page,0,state());
          await page.getByRole('button',{name:'دخول طابور فردي'}).click();await requests(page,2);
          await respond(page,1,{error:'NETWORK'},503);await requests(page,3);
          assert.equal(await page.evaluate(()=>window.requests[2].path),'/api/mafia/ranked/queue/status');
          await respond(page,2,{error:'NETWORK'},503);await page.getByRole('alert').waitFor();
          await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='التحقق وإلغاء الانتظار')?.disabled);
          assert.equal(await page.evaluate(()=>window.locked()),true);
        }

        await t.test(`${name}: join, duplicate-click protection and exact revision cancellation release privacy`,async()=>{
          const page=await open();try {
            await show(page);await requests(page,1);await respond(page,0,state());
            const button=page.getByRole('button',{name:'دخول طابور فردي'});await button.waitFor();
            await button.evaluate(element=>{element.click();element.click();});await requests(page,2);
            assert.equal(await page.evaluate(()=>window.locked()),true);
            const body=await page.evaluate(()=>window.requests[1].body),queue=queued(body.id);
            await respond(page,1,state({queue,waiting:1}));await page.getByRole('button',{name:'إلغاء الانتظار وإغلاق'}).click();await requests(page,3);
            assert.deepEqual(await page.evaluate(()=>window.requests[2].body),{seatId:body.id,revision:queue.revision});
            await respond(page,2,state());await page.waitForFunction(()=>window.closeCount===1);
            assert.equal(await page.evaluate(()=>window.locked()),false);assert.equal(await page.evaluate(()=>window.joined.length),0);
          }finally{await page.close();}
        });

        await t.test(`${name}: late reads and joins from a replaced account never navigate or write a room session`,async()=>{
          const page=await open();try {
            await seed(page);await show(page);await requests(page,1);await respond(page,0,state());
            await page.getByRole('button',{name:'دخول طابور فردي'}).click();await requests(page,2);
            await show(page,{id:'b',token:'Bearer synthetic-b'});await requests(page,3);
            await respond(page,1,{error:'NETWORK'},503);await respond(page,2,state({rating:{rating:1200,games:20,band:'حساب ب الحالي'}}));
            await page.getByText('حساب ب الحالي',{exact:false}).waitFor();await page.clock.runFor(1100);
            assert.equal(await page.evaluate(()=>window.requests.length),3,'retired join recovery/reconciliation must not send stale account requests');
            assert.equal(await page.evaluate(()=>window.requests[1].aborted),true);assert.equal(await page.evaluate(()=>window.locked()),false);
            assert.equal(await page.evaluate(()=>window.joined.length),0);assert.equal(await page.evaluate(()=>window.saved('lastRoom')),null);
          }finally{await page.close();}
        });

        await t.test(`${name}: a stale account snapshot cannot paint another identity or accept its assignment`,async()=>{
          const page=await open();try {
            await seed(page);await show(page);await requests(page,1);
            await show(page,{id:'b',token:'Bearer synthetic-b'});await requests(page,2);
            await respond(page,0,state({queue:assigned(),rating:{rating:999,games:10,band:'حساب أ الخاص'}}));
            await respond(page,1,state({rating:{rating:1200,games:20,band:'حساب ب الحالي'}}));
            await page.getByText('حساب ب الحالي',{exact:false}).waitFor();assert.equal(await page.getByText('حساب أ الخاص',{exact:false}).count(),0);
            assert.equal(await page.evaluate(()=>window.requests[0].aborted),true);assert.equal(await page.evaluate(()=>window.joined.length),0);
            assert.equal(await page.evaluate(()=>window.saved('654321')),null);
          }finally{await page.close();}
        });

        await t.test(`${name}: token rotation preserves the queue cover without an old-token background reconciler`,async()=>{
          const page=await open();try {
            await seed(page);await show(page);await requests(page,1);await respond(page,0,state({queue:queued()}));await requests(page,2);await respond(page,1,state({queue:queued()}));
            await page.waitForFunction(()=>window.locked());await page.evaluate(()=>{window.lockEvents=[];});
            await show(page,{token:'Bearer rotated-a'});await requests(page,3);await respond(page,2,state({queue:queued()}));await requests(page,4);await respond(page,3,state({queue:queued()}));
            await page.getByRole('button',{name:'إلغاء الانتظار وإغلاق'}).waitFor();await page.clock.runFor(1100);
            assert.equal(await page.evaluate(()=>window.requests.length),4);assert.ok((await page.evaluate(()=>window.requests.slice(2).map(request=>request.authorization))).every(value=>value==='Bearer rotated-a'));
            assert.equal(await page.evaluate(()=>window.lockEvents.includes(false)),false);assert.equal(await page.evaluate(()=>window.locked()),true);
          }finally{await page.close();}
        });

        await t.test(`${name}: detached cleanup cannot release a replacement component's active cover`,async()=>{
          const page=await open();try {
            await seed(page);await show(page);await requests(page,1);await respond(page,0,state({queue:queued()}));await requests(page,2);await respond(page,1,state({queue:queued()}));
            await page.getByRole('button',{name:'إلغاء الانتظار وإغلاق'}).waitFor();await page.evaluate(()=>window.hide());await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
            await show(page);await requests(page,3);await respond(page,2,state({queue:queued()}));await requests(page,4);await respond(page,3,state({queue:queued()}));
            await page.getByRole('button',{name:'إلغاء الانتظار وإغلاق'}).waitFor();await page.clock.runFor(1100);await requests(page,5);await respond(page,4,state());
            await page.clock.runFor(1);assert.equal(await page.evaluate(()=>window.locked()),true,'each dialog instance must own a distinct privacy lock');
            await page.getByRole('button',{name:'إلغاء الانتظار وإغلاق'}).click();await requests(page,6);await respond(page,5,state());await page.waitForFunction(()=>window.closeCount===1);
            assert.equal(await page.evaluate(()=>window.locked()),false);
          }finally{await page.close();}
        });

        await t.test(`${name}: current assignment is saved once with the assigned seat and original secret`,async()=>{
          const page=await open();try {
            await seed(page);await show(page);await requests(page,1);await respond(page,0,state({queue:assigned()}));await page.waitForFunction(()=>window.joined.length===1);
            const saved=await page.evaluate(()=>({joined:window.joined[0],room:window.saved('654321'),owner:window.saved('roomOwner:654321'),last:window.saved('lastRoom')}));
            assert.equal(saved.room.id,'c'.repeat(32));assert.equal(saved.room.token,session.token);assert.equal(saved.owner,'a');assert.equal(saved.last,'654321');assert.equal(saved.joined.session.id,saved.room.id);
            await page.clock.runFor(5001);assert.equal(await page.evaluate(()=>window.joined.length),1);assert.equal(await page.evaluate(()=>window.requests.length),1);
          }finally{await page.close();}
        });

        await t.test(`${name}: hidden-page assignment waits for foreground before navigation`,async()=>{
          const page=await open();try {
            await seed(page);await show(page);await requests(page,1);await page.evaluate(()=>{window.__hidden=true;});await respond(page,0,state({queue:assigned()}));
            await page.waitForFunction(()=>window.locked());assert.equal(await page.evaluate(()=>window.joined.length),0);assert.equal(await page.evaluate(()=>window.saved('lastRoom')),null);
            await page.evaluate(()=>{window.__hidden=false;});await page.clock.runFor(5001);await requests(page,2);await respond(page,1,state({queue:assigned()}));await page.waitForFunction(()=>window.joined.length===1);
          }finally{await page.close();}
        });

        await t.test(`${name}: active-call refusal reconciles the queue and releases only its provisional cover`,async()=>{
          const page=await open();try {
            await show(page);await requests(page,1);await respond(page,0,state());await page.getByRole('button',{name:'دخول طابور فردي'}).click();await requests(page,2);
            await respond(page,1,{error:'MAFIA_RANKED_CALL_ACTIVE'},409);await requests(page,3);await respond(page,2,state());
            await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').textContent(),/أنه المكالمة/);await page.waitForFunction(()=>!window.locked());
            assert.equal(await page.evaluate(()=>window.joined.length),0);
          }finally{await page.close();}
        });

        await t.test(`${name}: unknown join and failed status cannot be unlocked by the dialog close button`,async()=>{
          const page=await open();try {
            await unknownJoin(page);await page.getByRole('button',{name:'إغلاق',exact:true}).click();await page.clock.runFor(200);await requests(page,4);
            assert.equal(await page.evaluate(()=>window.requests[3].path),'/api/mafia/ranked/queue/status');
            assert.equal(await page.evaluate(()=>window.closeCount),0);assert.equal(await page.evaluate(()=>window.locked()),true);
            await respond(page,3,{error:'NETWORK'},503);await page.getByRole('alert').waitFor();await page.clock.runFor(1);
            assert.equal(await page.evaluate(()=>window.closeCount),0);assert.equal(await page.evaluate(()=>window.locked()),true);assert.equal(await page.evaluate(()=>window.joined.length),0);
            assert.equal(await page.getByRole('button',{name:'دخول طابور فردي'}).count(),0);
          }finally{await page.close();}
        });

        for(const outcome of ['gone','queued','assigned'])await t.test(`${name}: ambiguous admission resolves to ${outcome} before close or navigation`,async()=>{
          const page=await open();try {
            await unknownJoin(page);await page.getByRole('button',{name:'التحقق وإلغاء الانتظار'}).click();await requests(page,4);
            await respond(page,3,state({queue:outcome==='gone'?null:outcome==='assigned'?assigned():queued()}));
            if(outcome==='queued'){
              await requests(page,5);assert.equal(await page.evaluate(()=>window.requests[4].path),'/api/mafia/ranked/queue/cancel');
              assert.deepEqual(await page.evaluate(()=>window.requests[4].body),{seatId:session.id,revision:'synthetic-revision'});
              assert.equal(await page.evaluate(()=>window.locked()),true);assert.equal(await page.evaluate(()=>window.closeCount),0);
              await respond(page,4,state());
            }
            if(outcome==='assigned'){
              await page.waitForFunction(()=>window.joined.length===1);assert.equal(await page.evaluate(()=>window.closeCount),0);
              assert.equal(await page.evaluate(()=>window.saved('654321')?.id),'c'.repeat(32));
            }else{await page.waitForFunction(()=>window.closeCount===1);assert.equal(await page.evaluate(()=>window.joined.length),0);}
            await page.waitForFunction(()=>!window.locked());
          }finally{await page.close();}
        });

        await t.test(`${name}: an unknown cancellation keeps privacy until a fresh status resolves assignment`,async()=>{
          const page=await open();try {
            await seed(page);await show(page);await requests(page,1);await respond(page,0,state({queue:queued()}));await requests(page,2);await respond(page,1,state({queue:queued()}));
            await page.getByRole('button',{name:'إلغاء الانتظار وإغلاق'}).click();await requests(page,3);await respond(page,2,{error:'NETWORK'},503);
            await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.locked()),true);assert.equal(await page.evaluate(()=>window.closeCount),0);
            await page.getByRole('button',{name:'التحقق وإلغاء الانتظار'}).click();await requests(page,4);await respond(page,3,state({queue:assigned()}));
            await page.waitForFunction(()=>window.joined.length===1);assert.equal(await page.evaluate(()=>window.closeCount),0);
          }finally{await page.close();}
        });

        await t.test(`${name}: token replacement fences an ambiguous join and account replacement rejects its late assignment`,async()=>{
          const page=await open();try {
            await unknownJoin(page);await show(page,{token:'Bearer rotated-a'});await requests(page,4);
            assert.equal(await page.evaluate(()=>window.requests[3].path),'/api/mafia/ranked/queue/status');assert.equal(await page.evaluate(()=>window.requests[3].authorization),'Bearer rotated-a');
            assert.equal(await page.evaluate(()=>window.locked()),true);
            await show(page,{id:'b',token:'Bearer synthetic-b'});await requests(page,5);
            await respond(page,3,state({queue:assigned()}));await respond(page,4,state());
            await page.getByRole('button',{name:'دخول طابور فردي'}).waitFor();await page.clock.runFor(1100);
            assert.equal(await page.evaluate(()=>window.joined.length),0);assert.equal(await page.evaluate(()=>window.saved('lastRoom')),null);
            assert.equal(await page.evaluate(()=>window.requests.length),5);assert.equal(await page.evaluate(()=>window.locked()),false);
          }finally{await page.close();}
        });

        await t.test(`${name}: closing before the initial snapshot confirms and cancels a cached queue instead of trusting null data`,async()=>{
          const page=await open();try {
            await seed(page);await show(page);await requests(page,1);await page.getByRole('button',{name:'إغلاق',exact:true}).click();await page.clock.runFor(200);await requests(page,2);
            assert.equal(await page.evaluate(()=>window.requests[1].path),'/api/mafia/ranked/queue/status');
            await respond(page,0,state());await respond(page,1,state({queue:queued()}));await requests(page,3);
            assert.equal(await page.evaluate(()=>window.requests[2].path),'/api/mafia/ranked/queue/cancel');assert.equal(await page.evaluate(()=>window.locked()),true);
            await respond(page,2,state());await page.waitForFunction(()=>window.closeCount===1);assert.equal(await page.evaluate(()=>window.locked()),false);
          }finally{await page.close();}
        });

        await t.test(`${name}: detached ambiguous recovery fences once without renewing a known queue forever`,async()=>{
          const page=await open();try {
            await unknownJoin(page);await page.evaluate(()=>window.hide());await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
            await page.clock.runFor(1100);await requests(page,4);assert.equal(await page.evaluate(()=>window.requests[3].path),'/api/mafia/ranked/queue/status');
            await respond(page,3,state({queue:queued()}));await page.clock.runFor(10_001);await requests(page,5);
            assert.equal(await page.evaluate(()=>window.requests[4].path),'/api/mafia/ranked');assert.equal(await page.evaluate(()=>window.requests[4].method),'GET');
            await respond(page,4,state());await page.waitForFunction(()=>!window.locked());assert.equal(await page.evaluate(()=>window.joined.length),0);
          }finally{await page.close();}
        });

        await t.test(`${name}: unmount aborts in-flight reads and prevents later polling or late assignment`,async()=>{
          const page=await open();try {
            await seed(page);await show(page);await requests(page,1);await page.evaluate(()=>window.hide());await page.waitForFunction(()=>window.requests[0].aborted);
            await respond(page,0,state({queue:assigned()}));await page.clock.runFor(5001);
            assert.equal(await page.evaluate(()=>window.requests.length),1);assert.equal(await page.evaluate(()=>window.joined.length),0);assert.equal(await page.evaluate(()=>window.saved('lastRoom')),null);
          }finally{await page.close();}
        });
      }finally{await browser.close();}
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
});
