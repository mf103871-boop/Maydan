// Current Conversation + LammaClient, synthetic local API only; no account/network services.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const bundle = await build({ stdin: { contents: `
import React,{useSyncExternalStore} from 'react';import{createRoot}from'react-dom/client';
import{Conversation}from'./src/social/SocialScreen.jsx';import{LammaClient}from'./src/social/lamma-client.js';
import{PlatformContext}from'./src/platform/context.js';import css from'./src/social/social.css';
import ui from'./src/shared/ui/ui.css';import tokens from'./src/shared/theme/tokens.css';
const group={id:'g',name:'لمة الاختبار'};let hidden=new Set();
let messages=Array.from({length:100},(_,i)=>({seq:i+1,clientId:'fixture-'+(i+1),senderId:'peer',text:'رسالة الاختبار رقم '+(i+1)+' — نبقى في المكان نفسه عند تحديث المحادثة',createdAt:Date.now()-100000+(i*100)}));
const client=new LammaClient({request:async path=>{
 if(!path.includes('/messages'))return{group,members:[{id:'peer',name:'صديق'}]};
 const before=Number(new URL('https://local.invalid'+path).searchParams.get('before')||Infinity);
 const visible=messages.filter(m=>m.seq<before&&!hidden.has(m.seq)),page=visible.slice(-50);
 return{messages:page,hasMore:visible.length>page.length,nextBefore:visible.length>page.length?page[0].seq:null};
}});client.userId='me';
const social={openConversation:()=>client.loadGroup('g'),loadOlder:()=>client.loadOlderGroup('g'),markRead:()=>{},setTyping:()=>{}};
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
window.fixture={async refresh(){messages.push({seq:101,clientId:'fixture-101',senderId:'peer',text:'رسالة جديدة',createdAt:Date.now()});await client.loadGroup('g',{quiet:true});await paint();},async hide(ids){hidden=new Set(ids);client.invalidateAudio();await client.loadGroup('g',{quiet:true});await paint();},async logout(){client.stop();await paint();}};
function App(){const state=useSyncExternalStore(client.subscribe,client.getSnapshot);return <PlatformContext.Provider value={{sound:{play(){}},haptics:{vibrate(){}},settings:{}}}><style>{tokens+ui+css}</style><style>{'html,body,#root{margin:0;height:100%;overflow:hidden}.social-chat{height:100dvh;max-height:100dvh}.social-message-scroll{overflow-anchor:none}'}</style><Conversation friend={group} conversation={state.groupConversations.g} account={{user:{id:'me',name:'أنا'}}} social={social} onBack={()=>{}} onMenu={()=>{}} notify={()=>{}} /></PlatformContext.Provider>};
createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'esm', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const code = bundle.outputFiles[0].text;
const server = http.createServer((req,res) => { res.setHeader('content-type',req.url === '/fixture.js'?'text/javascript':'text/html');res.end(req.url === '/fixture.js'?code:'<!doctype html><html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script></html>'); });
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const out=process.env.E2E_OUTPUT_DIR||'.cache/lamma-history-recovery';await fs.mkdir(out,{recursive:true});
const result={scope:'Local Chromium/WebKit current Conversation + LammaClient; no production or physical-device claim',engines:[]};
try{
 for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch();
  try{
   const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   await page.goto(origin);await page.waitForFunction(()=>document.querySelectorAll('[data-message-key]').length===50);
   await page.getByRole('button',{name:'تحميل الرسائل الأقدم',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-message-key]').length===100);
   const anchor=await page.evaluate(async()=>{
    const el=document.querySelector('.social-message-scroll'),node=[...el.querySelectorAll('[data-message-key]')].find(n=>n.textContent.includes('رقم 25 —'));
    el.scrollTop+=node.getBoundingClientRect().top-el.getBoundingClientRect().top-20;el.dispatchEvent(new Event('scroll'));await new Promise(r=>requestAnimationFrame(r));
    return{key:node.dataset.messageKey,offset:node.getBoundingClientRect().top-el.getBoundingClientRect().top};
   });
   const offset=async()=>page.evaluate(key=>{const el=document.querySelector('.social-message-scroll'),node=[...el.querySelectorAll('[data-message-key]')].find(n=>n.dataset.messageKey===key);return node?node.getBoundingClientRect().top-el.getBoundingClientRect().top:null;},anchor.key);
   await page.evaluate(()=>window.fixture.refresh());assert.equal(await page.locator('[data-message-key]').count(),101);const afterMessage=await offset();assert.ok(Math.abs(afterMessage-anchor.offset)<2,JSON.stringify({name,anchor,afterMessage}));
   await page.evaluate(()=>window.fixture.hide([1,2,3,4,5,6,7,8,9,10]));assert.equal(await page.locator('[data-message-key]').count(),91);const afterRevocation=await offset();assert.ok(Math.abs(afterRevocation-anchor.offset)<2,JSON.stringify({name,anchor,afterRevocation}));
   await page.screenshot({path:path.join(out,name+'-history.png')});
   await page.evaluate(()=>window.fixture.logout());assert.equal(await page.locator('[data-message-key]').count(),0);assert.deepEqual(errors,[]);
   result.engines.push({name,loaded:100,afterIncoming:101,afterRevokedRows:91,anchorOffset:anchor.offset,afterMessage,afterRevocation,afterLogout:0});
  }finally{await browser.close();}
 }
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await new Promise(resolve=>server.close(resolve));}
