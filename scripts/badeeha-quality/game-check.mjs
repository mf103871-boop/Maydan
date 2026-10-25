// Exercise the built, unmodified game with real packs in an isolated browser.
// Only a local cached test entitlement is seeded; no real account or purchase.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { CATS } from '../../src/data/categories/index.js';
import { BANK_CONTENT_VERSION } from '../../src/games/badeeha/logic.js';
import { BADEEHA_KEYS } from '../../src/games/badeeha/keys.js';
import { RETIRED_GAME_NOTICE } from '../../src/games/badeeha/persistence.js';

const root=path.resolve('dist'), out=path.resolve('.cache/badeeha-quality/game-check');
await mkdir(out,{recursive:true});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.mp3':'audio/mpeg','.wav':'audio/wav','.json':'application/json'};
const server=http.createServer(async(req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 try{const data=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data);}
 catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const checks=[],errors=[],snapshots=[];
const check=(name,ok,detail)=>{checks.push({name,ok,detail});assert.ok(ok,`${name}: ${JSON.stringify(detail)}`);};
const click=async(page,selector)=>{await page.locator(selector).first().evaluate(e=>e.click());};
const button=async(page,text)=>{await page.getByRole('button',{name:text,exact:true}).first().evaluate(e=>e.click());};
async function boot(page){
 await page.goto(base+'/index.html?review='+Date.now()+'#/game/badeeha',{waitUntil:'load'});
 await page.locator('.splash').waitFor({state:'detached'});
 await page.waitForFunction(()=>!!document.querySelector('.m-home,.details-hero'));
 if(!await page.locator('.m-home').count())await button(page,'العب');
 await page.locator('.m-home').waitFor();
}
async function context(){
 const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,locale:'ar',reducedMotion:'reduce'});
 await ctx.route('**/*',async route=>{
  if(route.request().url().startsWith(base))return route.continue();
  // There must be no calls to production while reviewing content locally.
  return route.abort();
 });
 await ctx.addInitScript(({keys})=>{
  Math.random=()=>0;
  if(!sessionStorage.getItem('quality-fixture')){
   sessionStorage.setItem('quality-fixture','yes');
   localStorage.setItem('maydan:account:session',JSON.stringify('local-quality-fixture'));
   localStorage.setItem('maydan:account:me',JSON.stringify({fetchedAt:Date.now(),data:{user:{id:'local-review',name:'مراجعة'},premium:{active:true,until:Date.now()+86400000,source:'test'},trials:{}}}));
   localStorage.setItem(keys.settings,JSON.stringify({soundOn:false}));
  }
 },{keys:BADEEHA_KEYS});
 const page=await ctx.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>errors.push(e.message));
 return{ctx,page};
}
try{
 const sets=[
  {mode:'عائلي',top:600,ids:['zoom','blur','silhouette','tilepuzzle','reveal','spotdiff']},
  {mode:'تحدّي',top:800,ids:['emoji','hidden','hints','code','beforeafter','sound']},
  {mode:'خبراء',top:1000,ids:['zoom','blur','silhouette','tilepuzzle','reveal','spotdiff']},
 ];
 for(const config of sets){
  const{ctx,page}=await context();await boot(page);
  if(config.top===1000){await page.evaluate(()=>navigator.serviceWorker.ready);if(!await page.evaluate(()=>!!navigator.serviceWorker.controller))await boot(page);}
  await click(page,'.m-hero-cta');
  await page.locator('.m-mode-grid button').filter({has:page.locator('b',{hasText:config.mode})}).evaluate(e=>e.click());
  for(const id of config.ids){const name=CATS.find(c=>c.id===id).name;await page.locator('.m-category-main').filter({has:page.locator('b',{hasText:name})}).filter({hasText:name}).evaluateAll((elements,name)=>{const e=elements.find(e=>e.querySelector('b').textContent.trim()===name);if(!e)throw Error(name);e.click();},name);}
  check(`${config.mode}: six real packs selected`,await page.locator('.m-category-pick.selected').count()===6);
  if(config.top===1000){
   await page.locator('.m-offline-row button').evaluate(e=>e.click());
   await page.waitForFunction(()=>/جاهزة/.test(document.querySelector('.m-offline-text small')?.textContent||''),null,{timeout:120000});
   check('visual packs cached by the actual offline control',true);
  }
  await click(page,'.m-sticky-action');await page.locator('.m-board-grid').waitFor();
  const tiers=await page.locator('.m-tier b').allTextContents();
  check(`${config.mode}: difficulty cap`,tiers.length===30&&Math.max(...tiers.map(Number))===config.top,tiers);
  if(config.top===1000)await ctx.setOffline(true);
  for(let column=0;column<6;column++){
   const card=page.locator('.m-board-category').nth(column);
   // Check top-tier visual assistance as well as beginner rendering.
   await card.locator(`.m-tier-${config.top}:not(.done)`).last().evaluate(e=>e.click());
   await page.locator('.m-question-screen').waitFor();
   await page.waitForFunction(()=>!document.querySelector('.m-media-spinner'));
   await page.locator('.m-question-screen img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
   check(`${config.mode}/${config.ids[column]}: media rendered`,await page.locator('.m-media-error').count()===0);
   if(['zoom','blur','silhouette'].includes(config.ids[column])){
    check(`${config.mode}/${config.ids[column]}: high-tier assistance displayed`,await page.locator('.m-question-assistance').count()===1);
    check(`${config.mode}/${config.ids[column]}: assisted image effect applied`,await page.locator('.m-media-img.is-assisted').count()===1);
   }
   if(config.ids[column]==='hints'){
    const original=Number(await page.locator('.m-award').textContent());
    await page.getByRole('button',{name:/اطلب تلميحًا/}).evaluate(e=>e.click());
    check('hint changes visible award by 25%',Number(await page.locator('.m-award').textContent())===original*.75);
   }
   if(config.ids[column]==='reveal'){
    await page.getByRole('button',{name:/اكشف قطعة/}).evaluate(e=>e.click());
    check('one reveal tile opens',await page.locator('.m-reveal-tiles .is-open').count()===1);
   }
   if(config.ids[column]==='tilepuzzle')check('twelve distinct jumbled pieces',await page.locator('.m-jumble i').count()===12);
   if(config.ids[column]==='sound'){
    await page.locator('audio').evaluate(a=>a.play());await page.waitForTimeout(250);
    check('audio plays',await page.locator('audio').evaluate(a=>a.currentTime>0));
   }
   const prefix=`${config.top}-${config.ids[column]}`;
   await page.locator('.m-question-card').screenshot({animations:'disabled',path:path.join(out,prefix+'-before.png')});
   await click(page,'.m-reveal-action');await page.locator('.m-judge').waitFor();
   await page.waitForTimeout(300);
   check(`${prefix}: answer is visible`,(await page.locator('.m-answer strong').textContent()).trim().length>0);
   if(config.ids[column]==='tilepuzzle')check('jumble resolves on reveal',await page.locator('.m-jumble').count()===0);
   if(config.ids[column]==='reveal')check('all twelve tiles open on reveal',await page.locator('.m-reveal-tiles .is-open').count()===12);
   if(config.ids[column]==='spotdiff')check('difference marker on both pictures',await page.locator('.m-diff-spot').count()===2);
   await page.locator('.m-question-card').screenshot({animations:'disabled',path:path.join(out,prefix+'-after.png')});
   snapshots.push(prefix);
   await click(page,'.m-judge-grid button');await page.locator('.m-board-grid').waitFor();
  }
  await page.waitForTimeout(400);
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),BADEEHA_KEYS.active);
  check(`${config.mode}: current bank saved`,saved.contentVersion===BANK_CONTENT_VERSION&&Object.keys(saved.used).length===6);
  await ctx.setOffline(false);await boot(page);await click(page,'.m-saved-card .m-primary');await page.locator('.m-board-grid').waitFor();
  check(`${config.mode}: saved game resumes with scores`,await page.locator('.m-tier.done').count()===6);
  if(config.top===1000){
   // Leave the active game before seeding an old saved version; an active
   // component may flush its current snapshot while the document unloads.
   await page.goto(base+'/index.html?migration-fixture='+Date.now(),{waitUntil:'load'});
   await page.locator('.splash').waitFor({state:'detached'});
   const preserved=await page.evaluate(keys=>{
    const saved=JSON.parse(localStorage.getItem(keys.active));saved.contentVersion='badeeha-before-quality-review';
    localStorage.setItem(keys.active,JSON.stringify(saved));
    return Object.fromEntries([keys.results,keys.history,keys.settings,'maydan:account:session'].map(k=>[k,localStorage.getItem(k)]));
   },BADEEHA_KEYS);
   await boot(page);
   await page.getByText(RETIRED_GAME_NOTICE,{exact:true}).waitFor();
   check('old-bank game displays the existing update notice',await page.getByText(RETIRED_GAME_NOTICE,{exact:true}).count()===1);
   check('old-bank game is unavailable for resume',await page.locator('.m-saved-card .m-primary').count()===0);
   const current=await page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),Object.keys(preserved));
   check('content update preserves stored scores, history, settings and account',JSON.stringify(current)===JSON.stringify(preserved));
  }
  await ctx.close();console.log(`PASS ${config.mode}`);
 }
 check('no browser exceptions',errors.length===0,errors);
}finally{
 await writeFile(path.join(out,'results.json'),JSON.stringify({version:BANK_CONTENT_VERSION,checks,errors,snapshots},null,2)+'\n');
 await browser.close();await new Promise(r=>server.close(r));
}
console.log(JSON.stringify({checks:checks.length,snapshots:snapshots.length,out}));
