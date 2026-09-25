// Read-only production bank/app regression. No deck or source replacements.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const ROOT='C:/Users/user/Desktop/maydan';
const OUT='C:/Users/user/Documents/Codex/2026-09-25/hg/work/reveal-wrapper-regression-final-2026-09-25';
const require=createRequire(path.join(ROOT,'package.json'));
const {chromium}=require('playwright'),{build}=require('esbuild');
const {esbuildOptions,renderHtml,readPkg}=await import(pathToFileURL(path.join(ROOT,'scripts/lib.mjs')));
const read=async relative=>JSON.parse(await fs.readFile(path.join(ROOT,relative),'utf8'));
const hash=async relative=>crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT,relative))).digest('hex');
const watched=['src/games/badeeha/App.js','src/games/badeeha/styles.css',...['blur','silhouette','flags'].map(id=>`src/data/categories/${id}.json`)];
const hashesBefore=Object.fromEntries(await Promise.all(watched.map(async p=>[p,await hash(p)])));
const packs=await Promise.all(['blur','silhouette','flags','general','food','animals'].map(id=>read(`src/data/categories/${id}.json`)));
await fs.mkdir(path.join(OUT,'screens'),{recursive:true});
const pkg=await readPkg(),options=esbuildOptions({minify:true,version:pkg.version});
options.define.__MAYDAN_ROOMS_URL__=JSON.stringify('same-origin');
const bundle=await build(options),html=await renderHtml(bundle.outputFiles[0].text,{version:pkg.version});
const me={user:{id:'local-reveal-wrapper-regression',name:'فحص محلي'},premium:{active:true,until:Date.now()+86400000,source:'test',status:'active',willRenew:false},trials:{},serverTime:Date.now()};
const types={'.js':'text/javascript','.html':'text/html; charset=utf-8','.webp':'image/webp','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
const results=[],errors=[],networkErrors=[],samples=[];
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
 if(pathname==='/sw.js')body=Buffer.from(body.toString().replaceAll('__BUILD_ID__','reveal-wrapper-regression'));
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':body.length});res.end(body);
}catch{if(!res.headersSent)res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const BASE=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'ar',isMobile:true,hasTouch:true,reducedMotion:'reduce'});
const page=await context.newPage();page.setDefaultTimeout(20000);
page.on('pageerror',error=>errors.push(error.message));
page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))networkErrors.push({status:r.status(),url:r.url().replace(BASE,'')});});
const escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
async function settle(){await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});}
async function state(){return page.locator('.m-question-screen').evaluate(el=>{
 const base=el.querySelector('.m-media-stage > img'),clean=el.querySelector('.m-media-clean'),stage=el.querySelector('.m-media-stage'),box=el.querySelector('.m-media-box');
 return {text:el.innerText,base:{src:base.getAttribute('src'),alt:base.alt,width:base.naturalWidth,height:base.naturalHeight,filter:getComputedStyle(base).filter},clean:clean?{alt:clean.alt,hidden:clean.getAttribute('aria-hidden'),opacity:getComputedStyle(clean).opacity,filter:getComputedStyle(clean).filter}:null,canEnlarge:stage.classList.contains('can-enlarge'),stageRole:stage.getAttribute('role'),directBoxChildren:[...box.children].map(n=>n.className),tileButtons:el.querySelectorAll('.m-reveal-tile-btn').length,tileLayers:el.querySelectorAll('.m-reveal-tiles').length,attributes:[...el.querySelectorAll('img,[title],[aria-label]')].map(x=>({alt:x.getAttribute('alt'),title:x.getAttribute('title'),aria:x.getAttribute('aria-label'),src:x.tagName==='IMG'?x.getAttribute('src'):null}))};
 });}
function leaks(q,s){return [q.a,...q.alt||[]].filter(a=>typeof a==='string'&&a.trim()).filter(a=>{const word=new RegExp(`(^|[^\\p{L}\\p{N}])(?:ال)?${escaped(a)}(?=$|[^\\p{L}\\p{N}])`,'u');return word.test(s.text)||s.attributes.some(x=>[x.alt,x.title,x.aria,x.src].some(v=>v&&word.test(v)));});}
try{
 await page.goto(`${BASE}/#/auth?code=local-reveal-wrapper-regression`,{waitUntil:'domcontentloaded'});
 await page.locator('.splash').waitFor({state:'detached'});await page.locator('.home-screen').waitFor();
 await page.goto(`${BASE}/#/play/badeeha`);await page.locator('.m-hero-cta').click();
 for(const p of packs)await page.locator('.m-category-main').filter({has:page.locator('b',{hasText:new RegExp(`^${escaped(p.name)}$`)})}).click();
 await page.getByRole('button',{name:/^ابدأ 30 سؤال/}).click();await page.locator('.m-board-grid').waitFor();
 for(const pack of packs.slice(0,3)){
  const start=results.length;
  await page.getByRole('button',{name:`${pack.name}، سؤال 200 نقطة`,exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.m-media-stage > img')].length>0&&[...document.querySelectorAll('.m-media-stage > img')].every(img=>img.complete&&img.naturalWidth>0));
  await settle();const before=await state(),qid=path.basename(before.base.src,'.webp'),q=pack.qs.find(q=>q.qid===qid);
  if(!q)throw new Error(`Actual displayed image ${before.base.src} has no question in ${pack.id}`);
  check(`${qid}: actual full-bank question selected`,q.p===200&&before.base.width>0);
  check(`${qid}: fragment adds no DOM wrapper or tile button`,before.directBoxChildren.length===1&&before.directBoxChildren[0].includes('m-media-stage')&&before.tileButtons===0&&before.tileLayers===0,before.directBoxChildren);
  check(`${qid}: hidden answer and generic alt`,before.base.alt==='صورة السؤال'&&leaks(q,before).length===0,leaks(q,before));
  const plain=q.effect==='none';
  check(`${qid}: original pre-reveal effect preserved`,plain?before.base.filter==='none'&&before.clean===null:q.effect==='blur'?/^blur\((16|14\.4)px\) saturate\(1\.3\)$/.test(before.base.filter)&&before.clean?.opacity==='0':before.base.filter==='brightness(0) contrast(2)'&&before.clean?.opacity==='0',before);
  check(`${qid}: correct enlargement gate before reveal`,plain?before.canEnlarge&&before.stageRole==='button':!before.canEnlarge&&before.stageRole===null);
  await page.locator('.m-media-stage').click();
  if(plain){await page.locator('.m-lightbox').waitFor();check(`${qid}: unrevealed enlargement keeps generic alt`,await page.locator('.m-lightbox img').getAttribute('alt')==='صورة السؤال');await page.getByRole('button',{name:'إغلاق الصورة',exact:true}).click();}
  else check(`${qid}: clicking hidden effect cannot bypass it`,await page.locator('.m-lightbox').count()===0);
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});await settle();
   const geometry=await page.evaluate(()=>{const stage=document.querySelector('.m-media-stage'),button=document.querySelector('.m-reveal-action'),s=stage.getBoundingClientRect(),b=button.getBoundingClientRect();const cx=b.x+b.width/2,cy=b.y+b.height/2;return{viewport:innerWidth,scroll:document.documentElement.scrollWidth,fit:getComputedStyle(document.querySelector('.m-media-img')).objectFit,stage:s.toJSON(),button:b.toJSON(),buttonCenterVisible:cy>=0&&cy<innerHeight,buttonHit:document.elementFromPoint(cx,cy)?.closest('button')===button};});
   check(`${qid}: ${width}px image fits and reveal action does not overlap`,geometry.stage.x>=-1&&geometry.stage.right<=width+1&&geometry.scroll<=width+1&&geometry.fit==='contain'&&geometry.button.top>=geometry.stage.bottom-1,geometry);
   await page.locator('.m-reveal-action').scrollIntoViewIfNeeded();
   const hit=await page.locator('.m-reveal-action').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===el;});
   check(`${qid}: ${width}px reveal action receives pointer`,hit);
  }
  await page.screenshot({path:path.join(OUT,'screens',`${qid}-before.png`),fullPage:true,animations:'disabled'});
  await page.locator('.m-reveal-action').click();await page.locator('.m-judge').waitFor();await settle();
  const after=await state();
  check(`${qid}: matching answer and clear image revealed`,after.base.alt===q.a&&(await page.locator('.m-answer strong').innerText())===q.a&&after.canEnlarge&&(plain?after.base.filter==='none':after.clean.opacity==='1'&&after.clean.filter==='none'),after);
  check(`${qid}: reveal creates no tile controls or extra wrapper`,after.tileButtons===0&&after.tileLayers===0&&after.directBoxChildren.length===1);
  await page.screenshot({path:path.join(OUT,'screens',`${qid}-after.png`),fullPage:true,animations:'disabled'});
  await page.locator('.m-media-stage').click();await page.locator('.m-lightbox').waitFor();
  check(`${qid}: revealed enlargement uses answer alt`,await page.locator('.m-lightbox img').getAttribute('alt')===q.a);
  await page.getByRole('button',{name:'إغلاق الصورة',exact:true}).click();
  await page.getByRole('button',{name:/إخفاء الإجابة/}).click();await settle();const hidden=await state();
  check(`${qid}: hide restores prior effect, generic alt and gate`,hidden.base.alt==='صورة السؤال'&&hidden.base.filter===before.base.filter&&hidden.canEnlarge===before.canEnlarge&&hidden.clean?.opacity===before.clean?.opacity&&leaks(q,hidden).length===0,hidden);
  check(`${qid}: hidden answer uses masked placeholder without aliases or tile button`,(await page.locator('.m-answer.is-hidden strong').innerText())==='• • •'&&(await page.locator('.m-answer.is-hidden strong').getAttribute('aria-hidden'))==='true'&&(await page.locator('.m-answer-alt').count())===0&&hidden.tileButtons===0);
  await page.screenshot({path:path.join(OUT,'screens',`${qid}-hidden.png`),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:/إظهار الإجابة/}).click();await settle();
  const reshown=await state();
  check(`${qid}: answer toggle shows image and answer again`,reshown.base.alt===q.a&&(await page.locator('.m-answer strong').innerText())===q.a&&reshown.canEnlarge&&(plain?reshown.clean===null:reshown.clean?.opacity==='1'));
  samples.push({pack:pack.id,qid,question:q.q,answer:q.a,effect:q.effect,tier:q.p,checks:results.length-start,passed:results.slice(start).every(r=>r.ok)});
  console.log(`${samples.at(-1).passed?'PASS':'FAIL'} ${qid} ${results.length-start} checks`);
  await page.locator('.m-nobody').click();await page.locator('.m-board-grid').waitFor();await page.setViewportSize({width:390,height:844});
 }
 check('three real gameplay samples completed',samples.length===3&&samples.every(s=>s.passed));
 check('no browser runtime errors',errors.length===0,errors);check('no missing local assets',networkErrors.length===0,networkErrors);
}catch(error){check('regression flow',false,error.stack||error.message);await page.screenshot({path:path.join(OUT,'failure.png'),fullPage:true,animations:'disabled'}).catch(()=>{});}
finally{
 await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));
 const hashesAfter=Object.fromEntries(await Promise.all(watched.map(async p=>[p,await hash(p)])));
 check('tested source and three bank files remained unchanged',JSON.stringify(hashesBefore)===JSON.stringify(hashesAfter),{hashesBefore,hashesAfter});
 await fs.writeFile(path.join(OUT,'results.json'),JSON.stringify({executedAt:new Date().toISOString(),selection:'One actual 200-point question in each of blur, silhouette and flags, selected normally from unchanged production bank. No question/deck fixtures or category overrides.',auth:'Local mock account only; no real account writes',browser:'Installed Chrome, headless, mobile 390x844 and 320x844, reduced motion',hashesBefore,hashesAfter,results,samples,errors,networkErrors},null,2)+'\n');
}
console.log(`${results.filter(r=>r.ok).length}/${results.length} checks; ${samples.length}/3 samples; ${OUT}`);
if(results.some(r=>!r.ok))process.exitCode=1;
