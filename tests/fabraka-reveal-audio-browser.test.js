// Actual Game + reducer/restore + React StrictMode. No audio device or server.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';
import {presentationCssPlugin} from '../scripts/presentation-css.mjs';

const source=`import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';
import{Game}from'./src/games/fabraka/Game.jsx';import{initialState,reduce,currentActor,turnKey,restoreSession}from'./src/games/fabraka/logic.js';
const players=[{id:'a',name:'أحمد',avatar:0},{id:'b',name:'سارة',avatar:1},{id:'c',name:'ليان',avatar:2}];
const deck=Array.from({length:12},(_,i)=>({id:'q'+i,factId:'q'+i,text:'في السؤال '+i+' الإجابة ___.',answer:'8',aliases:['ثمانية'],decoys:['11','13','17','19','21','23','25','27'],explanation:'شرح الاختبار',category:'x',curious:true,kind:'text'}));
const go=(s,type,extra={})=>reduce(s,{type,round:s.round,key:turnKey(s),playerId:currentActor(s)?.id,...extra});
let gather=initialState(players,{rounds:3,writeSeconds:0,discussionSeconds:0},{deck,seed:42,sessionId:'restore-audio-test'});
gather=go(go(gather,'BEGIN'),'START_WRITING');let i=0;while(gather.phase==='write'){gather=go(gather,'READY');gather=go(gather,'DRAFT',{text:['9','10','12'][i++]});gather=go(gather,'SUBMIT_LIE');}while(gather.phase==='vote'){gather=go(gather,'READY');gather=go(gather,'VOTE',{optionId:null,funnyId:null});}
if(gather.phase!=='gather'||!restoreSession(gather))throw Error('invalid real fixture');
const pending=go(gather,'START_REVEAL'),revealed=go(pending,'REVEAL');if(!restoreSession(pending)||!restoreSession(revealed))throw Error('invalid real reveal restore');
window.cues=[];window.completions=[];window.saved=[];let serial=0;
const api={storage:{persistent:true,get:()=>null,set:(key,value)=>{window.saved.push(value);return true;},remove(){}},sound:{play:cue=>window.cues.push(cue)},haptics:{vibrate(){}},confetti:{fire(){}},matchOver:value=>window.completions.push(value),setInGame(){},setBeforeExit(){},setExitMessage(){},restart(){},backToSetup(){}};
const root=createRoot(document.getElementById('root'));let current,key;
const paint=()=>root.render(<StrictMode><div data-case={key}><Game key={serial} api={api} players={players} savedSession={current} onExit={()=>{}}/></div></StrictMode>);
window.show=(kind)=>{key=kind;serial++;current=kind==='fresh'?gather:kind==='revealed'?revealed:pending;window.cues=[];paint();};window.repaint=paint;window.close=()=>root.unmount();window.show('pending');`;

for(const [name,engine]of[['chromium',chromium],['webkit',webkit]])test(`${name}: local Fabraka restores reveal silently, fresh reveal stages sound once without changing reducer outcomes`,{timeout:60_000},async t=>{
  const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',plugins:[presentationCssPlugin()],loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.png':'dataurl','.woff2':'dataurl'},define:{'process.env.NODE_ENV':'"development"'},logLevel:'silent'});
  const server=http.createServer((req,res)=>{const js=req.url==='/bundle.js';res.setHeader('content-type',js?'text/javascript':'text/html;charset=utf-8');res.end(js?bundle.outputFiles[0].contents:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script></html>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await engine.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-design-screen="fabraka.local.reveal"]').waitFor();await page.waitForTimeout(50);
  assert.deepEqual(await page.evaluate(()=>window.cues),[],'restored pending reveal is a baseline, not fresh drumroll');
  await page.locator('[data-design-id=pause]').click();await page.getByRole('button',{name:'متابعة اللعب',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.cues),[],'pause/resume does not replay baseline');
  await page.locator('[data-design-id=reveal]').click();await page.waitForFunction(()=>window.cues.length>0);assert.deepEqual(await page.evaluate(()=>window.cues),['reveal'],'a new accepted reveal still sounds');
  await page.evaluate(()=>window.repaint());await page.waitForTimeout(30);assert.deepEqual(await page.evaluate(()=>window.cues),['reveal']);
  await page.evaluate(()=>window.show('revealed'));await page.locator('[data-case=revealed]').waitFor();await page.waitForTimeout(50);assert.deepEqual(await page.evaluate(()=>window.cues),[],'already-revealed restore and StrictMode effect replay are silent');
  await page.evaluate(()=>window.show('fresh'));await page.locator('[data-design-screen="fabraka.local.gather"]').waitFor();assert.deepEqual(await page.evaluate(()=>window.cues),[]);
  await page.getByRole('button',{name:'ابدأوا الكشف',exact:true}).click();await page.locator('[data-design-screen="fabraka.local.reveal"]').waitFor();assert.deepEqual(await page.evaluate(()=>window.cues),['drumroll']);
  await page.locator('[data-design-id=reveal]').click();await page.waitForFunction(()=>window.cues.length===2);assert.deepEqual(await page.evaluate(()=>window.cues),['drumroll','reveal']);
  await page.evaluate(()=>window.repaint());await page.waitForTimeout(30);assert.deepEqual(await page.evaluate(()=>window.cues),['drumroll','reveal']);assert.deepEqual(await page.evaluate(()=>window.completions),[],'no false match completion');assert.deepEqual(errors,[]);await page.evaluate(()=>window.close());
  if(process.env.FABRAKA_AUDIO_QA_OUT){await mkdir(process.env.FABRAKA_AUDIO_QA_OUT,{recursive:true});await writeFile(path.join(process.env.FABRAKA_AUDIO_QA_OUT,name+'.json'),JSON.stringify({engine:name,actualGame:true,actualReducerAndRestore:true,strictMode:true,restoredPendingSilent:true,restoredRevealedSilent:true,freshDrumrollAndRevealOnce:true,pauseAndRerenderSilent:true,errors,providerOrDevice:false},null,2));}
});
