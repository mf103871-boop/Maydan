import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';

const review={available:true,outcome:'shadow',players:[{seat:1,roleId:'investigator',initialFaction:'town',faction:'shadow',won:true,forfeited:false}],events:[
  ...Array.from({length:80},(_,round)=>({type:'converted',round,elapsedSeconds:round*10,actorSeat:1,recruiterSeat:2})),
  {type:'converted',round:2,elapsedSeconds:70,actorSeat:1,recruiterSeat:2},
  {type:'verdict_votes',round:3,elapsedSeconds:90,nomineeSeat:2,votes:[{seat:1,approve:false}]}],earlierEventsOmitted:0};
test('participant review is readable on phones and clears synchronously across account, token and readiness changes',async()=>{
  const built=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{AccountContext}from'./src/shared/account/context.js';import{MafiaReviewDialog}from'./src/online/MafiaReviewDialog.jsx';
    import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';document.head.append(Object.assign(document.createElement('style'),{textContent:tokens+ui}));
    window.pending=[];function App(){const[s,set]=useState({id:'A',token:'a1',ready:true,signedIn:true});window.change=set;
      const account={...s,user:{id:s.id},authHeaders:()=>({Authorization:'Bearer '+s.token}),requestAuthenticated:(path,options)=>new Promise(resolve=>window.pending.push({path,options,resolve}))};
      return <AccountContext.Provider value={account}><MafiaReviewDialog matchKey="fixture:1" onClose={()=>{}}/></AccountContext.Provider>;}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl'},logLevel:'silent'});
  const html='<!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><div id="root"></div><script src="/bundle.js"></script></html>';
  const server=createServer((request,response)=>{response.setHeader('content-type',request.url==='/bundle.js'?'text/javascript':'text/html');response.end(request.url==='/bundle.js'?built.outputFiles[0].contents:html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try{for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
    const browser=await engine.launch({headless:true});
    try{
      const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin);assert.deepEqual(errors,[]);await page.waitForFunction(()=>window.pending?.length===1);
      assert.equal(await page.evaluate(()=>window.pending[0].path),'/api/mafia/history/fixture%3A1');
      await page.evaluate(data=>window.pending[0].resolve(data),review);await page.getByRole('heading',{name:'فوز الرابطة'}).waitFor();
      for(const [width,height]of[[320,568],[390,844],[844,390]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} ${width} overflow`);
        const geometry=await page.locator('.modal-body').evaluate(element=>{element.scrollTop=element.scrollHeight;const rect=element.getBoundingClientRect(),last=element.querySelector('ol li:last-child').getBoundingClientRect(),head=document.querySelector('.modal-head').getBoundingClientRect();return {height:element.clientHeight,scroll:element.scrollHeight,overflow:getComputedStyle(element).overflowY,lastVisible:last.bottom<=rect.bottom+1&&last.top>=rect.top-1,headerVisible:head.top>=0&&head.bottom<=innerHeight};});
        assert.equal(geometry.overflow,'auto');assert.ok(geometry.height>0&&geometry.scroll>geometry.height);assert.ok(geometry.lastVisible&&geometry.headerVisible,JSON.stringify({name,width,geometry}));
      }
      await page.evaluate(()=>window.change({id:'A',token:'a1',ready:false,signedIn:true}));await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
      assert.equal(await page.evaluate(()=>window.pending.length),1);
      await page.evaluate(()=>window.change({id:'A',token:'a2',ready:true,signedIn:true}));await page.waitForFunction(()=>window.pending.length===2);
      assert.equal(await page.getByRole('heading',{name:'فوز الرابطة'}).count(),0);
      await page.evaluate(()=>window.change({id:'B',token:'b1',ready:true,signedIn:true}));await page.waitForFunction(()=>window.pending.length===3);
      await page.evaluate(()=>window.change({id:'A',token:'a3',ready:true,signedIn:true}));await page.waitForFunction(()=>window.pending.length===4);
      await page.evaluate(data=>window.pending[1].resolve(data),review);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.getByRole('heading',{name:'فوز الرابطة'}).count(),0,'old A response must stay hidden after A-B-A');
      await page.evaluate(()=>window.pending[3].resolve({available:false}));await page.getByText(/المراجعة غير متاحة الآن/).waitFor();
      await page.evaluate(()=>window.change({id:'A',token:'a4',ready:true,signedIn:true}));await page.waitForFunction(()=>window.pending.length===5);
      await page.evaluate(data=>window.pending[4].resolve(data),review);await page.getByRole('heading',{name:'فوز الرابطة'}).waitFor();
      await page.evaluate(()=>window.change({id:'A',token:'a4',ready:true,signedIn:false}));await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
      assert.equal(await page.getByRole('heading',{name:'فوز الرابطة'}).count(),0);assert.deepEqual(errors,[]);
      await page.close();
    }finally{await browser.close();}
  }}finally{await new Promise(resolve=>server.close(resolve));}
});
