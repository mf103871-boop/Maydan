import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';

test('reward UI waits thirty seconds, only reads, and fences account/match changes in Chromium and WebKit',async()=>{
  const source=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{MafiaRewardSummary}from'./src/online/MafiaRewardSummary.jsx';
window.calls=[];const load=(_server,auth,key,{signal})=>new Promise(resolve=>window.calls.push({auth,key,signal,resolve}));
function App(){const[owner,setOwner]=useState('A'),[match,setMatch]=useState('match:1'),[mounted,setMounted]=useState(true),[signedIn,setSignedIn]=useState(true),[ready,setReady]=useState(true);window.owner=setOwner;window.match=setMatch;window.mount=setMounted;window.auth=(signed,loaded)=>{setSignedIn(signed);setReady(loaded)};window.reply=(n,xp=50)=>{const c=window.calls[n];c.resolve({status:'processed',matchKey:c.key,xpAwarded:xp,participationGranted:true,finishedAt:window.finishedAt,roleId:'investigator',achievements:[],grants:[]});};return <AccountContext.Provider value={{...NULL_ACCOUNT,user:owner?{id:owner}:null,signedIn:!!owner&&signedIn,ready,authHeaders:()=>({Authorization:'Bearer '+owner})}}>{mounted&&<MafiaRewardSummary key={owner+match} accountId={owner} server="https://reward-fixture.invalid" receipt={{matchKey:match,notBefore:window.notBefore}} loadReward={load}/>}</AccountContext.Provider>};window.finishedAt=Date.now();window.notBefore=window.finishedAt+30000;createRoot(document.getElementById('root')).render(<App/>);`;
  const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.png':'dataurl','.woff2':'dataurl'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script></html>';
  const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].contents:html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    for(const engine of [chromium,webkit]) {
      const browser=await engine.launch({headless:true});
      try{
        const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],writes=[];
        page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()!=='GET')writes.push(request.method());});
        const time=new Date('2026-10-30T00:00:00Z');await page.clock.install({time});await page.clock.pauseAt(time);await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.getByRole('heading',{name:'رحلتك في مافيا'}).waitFor();
        await page.getByRole('button',{name:'تحديث المكافأة'}).click();
        await page.clock.runFor(29999);assert.equal(await page.evaluate(()=>window.calls.length),0);
        await page.clock.runFor(1);await page.waitForFunction(()=>window.calls.length===1);
        // The privacy boundary is exact above. Resume browser scheduling before
        // external React setters: their effects schedule a new zero-delay read
        // after the commit, which cannot run under a stopped RAF/timer clock.
        await page.clock.resume();
        await page.evaluate(()=>window.reply(0));await page.getByText('+٥٠ خبرة',{exact:true}).waitFor();
        await page.evaluate(()=>window.mount(false));await page.getByRole('heading',{name:'رحلتك في مافيا'}).waitFor({state:'detached'});
        await page.evaluate(()=>window.mount(true));await page.waitForFunction(()=>window.calls.length===2);
        assert.equal(await page.evaluate(()=>window.calls[1].key),'match:1');
        await page.evaluate(()=>window.owner('B'));await page.waitForFunction(()=>window.calls.length===3);
        assert.equal(await page.getByText('+٥٠ خبرة',{exact:true}).count(),0);
        await page.evaluate(()=>window.owner('A'));await page.waitForFunction(()=>window.calls.length===4);
        await page.evaluate(()=>{window.reply(1,70);window.reply(2,70);});await page.waitForTimeout(50);
        assert.equal(await page.getByText('+٧٠ خبرة',{exact:true}).count(),0,'old A and B responses cannot replace the new A');
        assert.equal(await page.evaluate(()=>window.calls[1].signal.aborted&&window.calls[2].signal.aborted),true);
        await page.evaluate(()=>window.match('match:2'));await page.waitForFunction(()=>window.calls.length===5);
        await page.evaluate(()=>window.reply(3,70));await page.waitForTimeout(50);assert.equal(await page.getByText('+٧٠ خبرة',{exact:true}).count(),0);
        await page.evaluate(()=>window.reply(4,50));await page.getByText('+٥٠ خبرة',{exact:true}).waitFor();
        await page.evaluate(()=>window.auth(false,true));await page.getByRole('heading',{name:'رحلتك في مافيا'}).waitFor({state:'detached'});assert.equal(await page.getByText('+٥٠ خبرة',{exact:true}).count(),0,'cached identity after logout cannot retain a reward');
        await page.evaluate(()=>window.auth(true,false));await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>window.calls.length),5,'not-ready account cannot read');
        await page.evaluate(()=>window.owner(null));assert.equal(await page.getByText('+٥٠ خبرة',{exact:true}).count(),0);
        assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);await page.close();
      }finally{await browser.close();}
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
});
