import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';

test('drawing timer keeps its full accessible duration and readable visible unit in both languages', {timeout:60_000},async t=>{
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`
 import React from'react';import{createRoot}from'react-dom/client';import{ErsomhaMatch}from'./src/online/Ersomha.jsx';import{RoomChrome}from'./src/online/Online.jsx';import{Screen}from'./src/shared/ui/components.jsx';import{BrandFonts}from'./src/shared/brand/art.jsx';import{setUiLocale}from'./src/shared/i18n/core.js';
 import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import brand from'./src/shared/brand/brand.css';import online from'./src/online/online.css';
 const locale=new URL(location.href).searchParams.get('locale'),members=[{id:'a',name:'Demo',avatar:0,connected:true,score:0},{id:'b',name:'Peer',avatar:1,connected:true,score:0}];
 const listeners=new Set();const client={ws:{bufferedAmount:0},subscribeDrawing(fn){listeners.add(fn);return()=>listeners.delete(fn);},async command(type){if(type==='drawing_sync')for(const fn of listeners)fn({type:'drawing',kind:'sync',matchId:1,round:1,epoch:1,seq:0,ops:[],undoneIds:[],chunk:0,chunks:1});return{ok:true};}};
 async function main(){await setUiLocale(locale);document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';const state={game:'ersomha',phase:'draw',code:'123456',matchId:1,round:1,rounds:2,drawerId:'a',contentLocale:'ar',contentVersion:'legacy-ar',mode:'cooperative',settings:{cycles:1,difficulty:'easy'},deadlineAt:Date.now()+60000,participants:['a','b'],members,drawing:{epoch:1,seq:0},myWord:'شمس',category:'nature',publicWord:{wordLengths:[],letters:[]},guessedIds:[],recentGuesses:[]};createRoot(document.getElementById('root')).render(<><BrandFonts/><style>{tokens}</style><style>{ui}</style><style>{brand}</style><style>{online}</style><Screen className='stack online-screen'><RoomChrome state={state} code={state.code} status='connected' onExit={()=>{}}><ErsomhaMatch state={state} me={members[0]} disabled={false} isHost act={async()=>true} client={client} status='connected' drawerReady/></RoomChrome></Screen></>);}main();
 `},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
 const html='<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>'+result.outputFiles[0].text+'</script></html>';
 const server=http.createServer((request,response)=>{response.writeHead(200,{'content-type':'text/html;charset=utf-8'});response.end(html);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port,output=path.resolve('.cache/ersomha-timer-browser'),report=[];await mkdir(output,{recursive:true});
 for(const [engineName,engine]of Object.entries({chromium,webkit})){
  const browser=await engine.launch({headless:true});
  try{for(const locale of ['ar','en'])for(const width of [360,393])await t.test(engineName+' '+locale+' '+width,async()=>{
   const context=await browser.newContext({viewport:{width,height:852},isMobile:true,hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
   try{
    page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin+'/?locale='+locale);const timer=page.getByRole('timer');await timer.waitFor();await page.evaluate(()=>document.fonts.ready);
    const read=()=>timer.evaluate(el=>{const value=el.querySelector('b');return{label:el.getAttribute('aria-label'),pill:el.getBoundingClientRect().toJSON(),value:value.getBoundingClientRect().toJSON(),clock:value.textContent,font:parseFloat(getComputedStyle(value).fontSize),seconds:Number(el.dataset.seconds)};});
    const first=await read();assert.match(first.label,locale==='ar'?/ثانية/:/seconds/);assert.match(first.clock,/^[0-9٠-٩]{2}:[0-9٠-٩]{2}$/);assert.ok(first.font>=20);
    assert.ok(first.value.left>=first.pill.left+3&&first.value.right<=first.pill.right-3,'clock fits inside the approved pill with clearance');
    assert.ok(first.value.top>=first.pill.top&&first.value.bottom<=first.pill.bottom,'clock is vertically readable');
    assert.ok(first.seconds>50&&first.seconds<=60);
    await page.waitForTimeout(1100);const later=await read();assert.ok(later.seconds<first.seconds&&later.seconds>=first.seconds-2,'the existing clock still counts real seconds');
    assert.deepEqual(errors,[]);await page.screenshot({path:path.join(output,`${engineName}-${locale}-${width}.png`)});report.push({engine:engineName,locale,width,...later,clockUnchanged:true,pageErrors:0});
   }finally{await context.close();}
  });}finally{await browser.close();}
 }
 await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,views:report,scope:'Actual drawing components and public CSS; synthetic scene only, no server word bank or real room.'},null,2)+'\n');
});
