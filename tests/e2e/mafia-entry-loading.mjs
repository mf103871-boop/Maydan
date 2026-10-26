// Actual Entry component with delayed HTTP fixtures. Hosted transport has its
// own acceptance run; this regression isolates the first-tap loading race.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const source=`import React from'react';import{createRoot}from'react-dom/client';import{Entry}from'./src/online/Online.jsx';import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';
window.directoryRequests=[];window.createRequests=[];window.fetch=(url,options={})=>{if(url.includes('/rooms/public'))return new Promise((resolve,reject)=>window.directoryRequests.push({resolve:body=>resolve(new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}})),reject:()=>reject(new Error('fixture-offline'))}));if(url.endsWith('/api/rooms')){window.createRequests.push(JSON.parse(options.body));return Promise.resolve(new Response(JSON.stringify({code:'123456'}),{headers:{'content-type':'application/json'}}));}return Promise.reject(new Error('unexpected-fixture-request'));};
createRoot(document.getElementById('root')).render(<AccountContext.Provider value={{...NULL_ACCOUNT,user:{id:'entry-fixture-account',name:'لاعب الاختبار'}}}><Entry initialGame='mafia' onJoined={code=>window.joined=code}/></AccountContext.Provider>);`;
const built=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl'},define:{__MAYDAN_ROOMS_URL__:JSON.stringify('https://mafia-fixture.invalid'),'process.env.NODE_ENV':JSON.stringify('production')},logLevel:'silent'});
const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?built.outputFiles[0].contents:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);const start=page.locator('form [data-design-id="start"]');
  await page.getByText('نتحقق من توفر مجالس مافيا…',{exact:true}).waitFor();assert.equal(await start.isDisabled(),true);
  await page.locator('form').evaluate(form=>form.requestSubmit());assert.equal(await page.evaluate(()=>window.createRequests.length),0);assert.equal(await page.getByText('مافيا ميدان غير متاحة لبدء مباريات جديدة حاليًا.',{exact:true}).count(),0);
  await page.evaluate(()=>window.directoryRequests[0].reject());await page.getByText('تعذّر التحقق من توفر المجالس. أعد المحاولة قبل إنشاء الغرفة.',{exact:true}).waitFor();assert.equal(await start.isDisabled(),true);
  await page.getByRole('button',{name:'إعادة التحقق',exact:true}).click();await page.waitForFunction(()=>window.directoryRequests.length===2);await page.evaluate(()=>window.directoryRequests[1].resolve({enabled:false,rooms:[]}));
  await page.getByText('إنشاء مجالس مافيا متوقف حاليًا.',{exact:true}).waitFor();assert.equal(await start.isDisabled(),true);
  await page.getByRole('button',{name:'إعادة التحقق',exact:true}).click();await page.waitForFunction(()=>window.directoryRequests.length===3);await page.evaluate(()=>window.directoryRequests[2].resolve({enabled:true,rooms:[]}));
  await page.waitForFunction(()=>!document.querySelector('form [data-design-id="start"]').disabled);await start.click();await page.waitForFunction(()=>window.joined==='123456');assert.equal(await page.evaluate(()=>window.createRequests.length),1);assert.equal(await page.evaluate(()=>window.createRequests[0].game),'mafia');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checks:['pending request blocks first tap without false disabled error','directory failure exposes retry','confirmed disabled stays blocked','retry enables one authorized create'],passed:4,hosted:false}));
}finally{await browser.close();server.close();}
