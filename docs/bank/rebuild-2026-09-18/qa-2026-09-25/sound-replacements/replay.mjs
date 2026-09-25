// Technical playback only. Does not visit or submit the human review page.
// Production app, full original bank, isolated local account/history.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const ROOT='C:/Users/user/Desktop/maydan';
const OUT='C:/Users/user/Documents/Codex/2026-09-25/hg/work/sound-r2-gameplay-qa';
const require=createRequire(path.join(ROOT,'package.json'));
const {chromium}=require('playwright'),{build}=require('esbuild');
const {esbuildOptions,renderHtml,readPkg}=await import(pathToFileURL(path.join(ROOT,'scripts/lib.mjs')));
const read=async p=>JSON.parse(await fs.readFile(path.join(ROOT,p),'utf8'));
const hash=async p=>crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT,p))).digest('hex');
const ids=['sound-400-902','sound-400-905','sound-800-908'];
const packs=await Promise.all(['sound','general','food','animals','sports','history'].map(id=>read(`src/data/categories/${id}.json`)));
const pack=packs[0],targets=ids.map(id=>pack.qs.find(q=>q.qid===id));
if(targets.some(q=>!q||q.media.src!==`${q.qid}-r2.mp3`))throw new Error('Expected exact three replacement paths');
const watched=['src/games/badeeha/App.js','src/games/badeeha/styles.css','src/data/categories/sound.json',...targets.map(q=>`media/sound/${q.media.src}`)];
const hashesBefore=Object.fromEntries(await Promise.all(watched.map(async p=>[p,await hash(p)])));
await fs.mkdir(path.join(OUT,'screens'),{recursive:true});
const pkg=await readPkg(),options=esbuildOptions({minify:true,version:pkg.version});
options.define.__MAYDAN_ROOMS_URL__=JSON.stringify('same-origin');
const bundle=await build(options),html=await renderHtml(bundle.outputFiles[0].text,{version:pkg.version});
const me={user:{id:'local-sound-r2-qa',name:'فحص محلي'},premium:{active:true,until:Date.now()+86400000,source:'test',status:'active',willRenew:false},trials:{},serverTime:Date.now()};
const types={'.js':'text/javascript','.html':'text/html; charset=utf-8','.mp3':'audio/mpeg','.webp':'image/webp','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
const results=[],errors=[],networkErrors=[],samples=[],requests=[];
function check(name,ok,detail){results.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});if(!ok)console.log(`FAIL ${name} ${JSON.stringify(detail)}`);}
const server=http.createServer(async(req,res)=>{try{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const json=data=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(pathname==='/api/auth/exchange')return json({session:{token:'isolated-local-fixture-token'},me});
 if(pathname==='/api/me')return json(me);
 if(pathname==='/api/trials/merge')return json({trials:{}});
 if(pathname==='/api/billing/config')return json({auth:{google:false,apple:false},paddle:null});
 if(pathname.startsWith('/api/')){res.writeHead(405);res.end();return;}
 if(pathname==='/'||pathname==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
 let body,file;
 for(const base of [ROOT,path.join(ROOT,'public')]){file=path.resolve(base,`.${pathname}`);if(!file.startsWith(`${path.resolve(base)}${path.sep}`))continue;try{body=await fs.readFile(file);break;}catch{}}
 if(!body){res.writeHead(404);res.end();return;}
 if(pathname==='/sw.js')body=Buffer.from(body.toString().replaceAll('__BUILD_ID__','sound-r2-gameplay-qa'));
 if(pathname.endsWith('-r2.mp3'))requests.push({path:pathname,bytes:body.length,status:200,contentType:'audio/mpeg',requestRange:req.headers.range||null});
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':body.length});res.end(body);
}catch{if(!res.headersSent)res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const BASE=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
let context,page;
async function state(){return page.locator('.m-audio').evaluate(el=>{const a=el.querySelector('audio'),toggle=el.querySelector('.m-audio-btn'),restart=el.querySelector('.m-secondary');return{src:a.getAttribute('src'),currentSrc:a.currentSrc,duration:a.duration,currentTime:a.currentTime,paused:a.paused,ended:a.ended,readyState:a.readyState,networkState:a.networkState,error:a.error?{code:a.error.code,message:a.error.message}:null,muted:a.muted,volume:a.volume,toggleDisabled:toggle.disabled,restartDisabled:restart.disabled,toggleLabel:toggle.getAttribute('aria-label'),meta:el.querySelector('.m-audio-meta').innerText,spent:el.classList.contains('is-spent')};});}
async function waitPlaying(){await page.waitForFunction(()=>{const a=document.querySelector('.m-audio audio');return a&&!a.paused&&a.currentTime>0.05;});}
try{
 check('only the three replacements remain unverified in current bank',pack.qs.filter(q=>q.verified!==true).map(q=>q.qid).sort().join()===ids.slice().sort().join());
 for(const q of targets){
  const start=results.length;
  context=await browser.newContext({viewport:{width:390,height:844},locale:'ar',isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  // Local disposable play-history makes the exact target the only unseen question
  // at its tier. The complete production bank and all verified flags stay intact.
  await context.addInitScript(({history})=>localStorage.setItem('maydan:badeeha:question-history-v4',JSON.stringify(history)),{history:Object.fromEntries(pack.qs.filter(x=>x.qid!==q.qid).map(x=>[x.qid,1]))});
  page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push({qid:q.qid,message:e.message}));
  page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))networkErrors.push({qid:q.qid,status:r.status(),url:r.url().replace(BASE,'')});});
  await page.goto(`${BASE}/#/auth?code=local-sound-r2-qa`,{waitUntil:'domcontentloaded'});
  await page.locator('.splash').waitFor({state:'detached'});await page.locator('.home-screen').waitFor();
  await page.goto(`${BASE}/#/play/badeeha`);await page.locator('.m-hero-cta').click();
  for(const p of packs)await page.locator('.m-category-main').filter({has:page.locator('b',{hasText:new RegExp(`^${escaped(p.name)}$`)})}).click();
  await page.getByRole('button',{name:/^ابدأ 30 سؤال/}).click();await page.locator('.m-board-grid').waitFor();
  const openedAt=Date.now();await page.getByRole('button',{name:`${pack.name}، سؤال ${q.p} نقطة`,exact:true}).click();
  await page.waitForFunction(()=>{const a=document.querySelector('.m-audio audio');return a&&a.readyState>=3&&Number.isFinite(a.duration)&&a.duration>0;});
  await page.locator('.m-media-spinner').waitFor({state:'detached'});
  const readyMs=Date.now()-openedAt,initial=await state();
  check(`${q.qid}: exact replacement path loads`,initial.src===`media/sound/${q.media.src}`&&initial.currentSrc===`${BASE}/media/sound/${q.media.src}`,initial);
  check(`${q.qid}: metadata ready and no decoder error`,initial.readyState>=3&&initial.duration>0&&initial.duration<10&&initial.error===null,{readyMs,duration:initial.duration,readyState:initial.readyState});
  check(`${q.qid}: no autoplay and three plays available`,initial.paused&&initial.currentTime===0&&!initial.toggleDisabled&&!initial.restartDisabled&&initial.meta.includes('3 مرات متبقية من 3'));
  await page.setViewportSize({width:320,height:844});
  const sizing=await page.locator('.m-audio').evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth};});
  check(`${q.qid}: player fits narrow mobile`,sizing.x>=0&&sizing.right<=320&&sizing.scroll<=320,sizing);
  await page.screenshot({path:path.join(OUT,'screens',`${q.qid}-ready.png`),fullPage:true,animations:'disabled'});
  await page.locator('.m-audio-btn').click();await waitPlaying();
  const first=await state();check(`${q.qid}: first play advances clock and consumes one play`,first.currentTime>0&&!first.paused&&first.meta.includes('مرتان متبقيتان من 3'),first);
  await page.locator('.m-audio-btn').click();const paused=await state();
  check(`${q.qid}: pause retains remaining count`,paused.paused&&paused.currentTime>0&&paused.meta.includes('مرتان متبقيتان من 3'),paused);
  await page.locator('.m-audio-btn').click();await waitPlaying();const resumed=await state();
  check(`${q.qid}: resume consumes no additional play`,!resumed.paused&&resumed.meta.includes('مرتان متبقيتان من 3'));
  await page.locator('.m-audio > .m-secondary').click();await page.waitForFunction(()=>document.querySelector('.m-audio-meta').innerText.includes('مرة واحدة متبقية من 3'));await waitPlaying();
  const second=await state();check(`${q.qid}: restart counts as second play`,!second.paused&&second.meta.includes('مرة واحدة متبقية من 3'));
  await page.locator('.m-audio > .m-secondary').click();await page.waitForFunction(()=>document.querySelector('.m-audio').classList.contains('is-spent'));await waitPlaying();
  const third=await state();check(`${q.qid}: third start exhausts fresh-play budget`,third.spent&&third.restartDisabled&&!third.paused&&!third.toggleDisabled,third);
  await page.locator('.m-audio-btn').click();const thirdPaused=await state();
  check(`${q.qid}: third play can still pause and resume`,thirdPaused.paused&&!thirdPaused.toggleDisabled&&thirdPaused.restartDisabled);
  await page.locator('.m-audio-btn').click();await waitPlaying();
  await page.waitForFunction(()=>document.querySelector('.m-audio audio').ended,{},{timeout:12000});
  const ended=await state();check(`${q.qid}: natural end blocks a fourth fresh play`,ended.ended&&ended.paused&&ended.toggleDisabled&&ended.restartDisabled&&ended.meta.includes('انتهت مرات السماع'),ended);
  await page.screenshot({path:path.join(OUT,'screens',`${q.qid}-limit.png`),fullPage:true,animations:'disabled'});
  await page.locator('.m-reveal-action').click();await page.locator('.m-judge').waitFor();const revealed=await state();
  check(`${q.qid}: revealing lifts playback limit`,!revealed.toggleDisabled&&!revealed.restartDisabled&&revealed.meta.includes('بلا حدّ'));
  await page.locator('.m-audio > .m-secondary').click();await waitPlaying();check(`${q.qid}: fourth playback runs after reveal`,!(await state()).paused);
  await page.getByRole('button',{name:'كتم الصوت',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.m-audio audio').paused);const muted=await state();
  check(`${q.qid}: platform mute pauses and disables controls`,muted.paused&&muted.muted&&muted.toggleDisabled&&muted.restartDisabled,muted);
  await page.getByRole('button',{name:'تشغيل الصوت',exact:true}).click();const unmuted=await state();
  check(`${q.qid}: unmute re-enables controls without autoplay`,!unmuted.muted&&unmuted.paused&&!unmuted.toggleDisabled&&!unmuted.restartDisabled);
  await page.locator('.m-audio-btn').click();await waitPlaying();check(`${q.qid}: playback resumes after unmute`,!(await state()).paused);
  await page.locator('.m-audio-btn').click();
  await page.screenshot({path:path.join(OUT,'screens',`${q.qid}-revealed.png`),fullPage:true,animations:'disabled'});
  const resources=await page.evaluate(src=>performance.getEntriesByType('resource').filter(e=>e.name.endsWith('/'+src)).map(e=>({path:new URL(e.name).pathname,initiatorType:e.initiatorType,durationMs:e.duration,responseMs:e.responseEnd-e.requestStart,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize})),q.media.src);
  check(`${q.qid}: replacement fetched successfully`,requests.some(r=>r.path===`/media/sound/${q.media.src}`&&r.status===200)&&resources.length>0,resources);
  samples.push({qid:q.qid,src:q.media.src,durationSeconds:initial.duration,questionOpenToReadyMs:readyMs,resourceTimings:resources,verifiedAtRead:q.verified,technicalChecks:results.length-start,passed:results.slice(start).every(r=>r.ok),identityAudited:false});
  console.log(`${samples.at(-1).passed?'PASS':'FAIL'} ${q.qid}; duration ${initial.duration.toFixed(3)}s; ready ${readyMs}ms; ${results.length-start} checks`);
  await context.close();context=null;
 }
 check('all three replacement clips tested in actual gameplay',samples.length===3&&samples.every(s=>s.passed));
 check('no browser runtime errors',errors.length===0,errors);check('no missing assets',networkErrors.length===0,networkErrors);
}catch(error){check('audio gameplay flow',false,error.stack||error.message);await page?.screenshot({path:path.join(OUT,'failure.png'),fullPage:true,animations:'disabled'}).catch(()=>{});}
finally{
 await context?.close();await browser.close();await new Promise(resolve=>server.close(resolve));
 const hashesAfter=Object.fromEntries(await Promise.all(watched.map(async p=>[p,await hash(p)])));
 check('source, bank and replacement audio bytes unchanged',JSON.stringify(hashesBefore)===JSON.stringify(hashesAfter),{hashesBefore,hashesAfter});
 await fs.writeFile(path.join(OUT,'results.json'),JSON.stringify({executedAt:new Date().toISOString(),scope:'Technical load and actual MediaAudio/gameplay controls only. No auditory identity review or human approval.',browser:'Installed Chrome, headless, 390px and320px mobile, actual playback clock, default playback rate',selection:'Full unchanged production bank; disposable localhost browser history prioritizes one exact unseen target per context. No bank/module overrides.',limitations:'Local loading times are not production network measurements. Headless technical playback cannot establish semantic audio identity.',humanReviewPageVisited:false,humanReviewSubmitted:false,sourceOrBankEdited:false,hashesBefore,hashesAfter,results,samples,requests,errors,networkErrors},null,2)+'\n');
}
console.log(`${results.filter(r=>r.ok).length}/${results.length} checks; ${samples.length}/3 files; ${OUT}`);
if(results.some(r=>!r.ok))process.exitCode=1;
