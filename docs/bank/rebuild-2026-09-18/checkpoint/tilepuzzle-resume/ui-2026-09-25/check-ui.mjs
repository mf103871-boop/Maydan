// Isolated QA: production app/actual media, test-only in-memory deck selection.
// Writes only to OUT. Does not modify repository, accounts, source, or records.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const ROOT=path.resolve(process.env.MAYDAN_REPO||path.join(path.dirname(fileURLToPath(import.meta.url)),'../../../../../..'));
const OUT=path.resolve(process.argv[2]||process.env.MAYDAN_UI_OUT||path.join(ROOT,'docs/bank/rebuild-2026-09-18/checkpoint/tilepuzzle-resume/ui-replay'));
const require=createRequire(path.join(ROOT,'package.json'));
const {chromium}=require('playwright'),{build}=require('esbuild'),sharp=require('sharp');
const {esbuildOptions,renderHtml,readPkg}=await import(pathToFileURL(path.join(ROOT,'scripts/lib.mjs')));
const read=async relative=>JSON.parse(await fs.readFile(path.join(ROOT,relative),'utf8'));
const packBytes=await fs.readFile(path.join(ROOT,'src/data/categories/tilepuzzle.json'));
const pack=JSON.parse(packBytes),tiers=[200,400,600,800,1000];
if(pack.qs.length!==40||!pack.qs.every(q=>q.type==='image'&&q.effect==='jumble'&&/^tilepuzzle-(200|400|600|800|1000)-90[1-8]$/.test(q.qid)))throw new Error('Wait for the integrated40 jumble questions; old pack must not be tested as new.');
if(!tiers.every(p=>pack.qs.filter(q=>q.p===p).length===8))throw new Error('Expected8 questions per tier.');
await fs.mkdir(path.join(OUT,'screens'),{recursive:true});
await fs.mkdir(path.join(OUT,'stages'),{recursive:true});
const pkg=await readPkg(),options=esbuildOptions({minify:true,version:pkg.version});
options.define.__MAYDAN_ROOMS_URL__=JSON.stringify('same-origin');
options.plugins=[{name:'deterministic-tilepuzzle-batches',setup(builder){
 builder.onLoad({filter:/[/\\]categories[/\\]tilepuzzle\.json$/},()=>({loader:'js',contents:`const pack=${JSON.stringify(pack)}; const n=new URLSearchParams(location.search).get('tilepuzzle-batch'); if(n!==null&&n!=='all'){const i=Number(n);pack.qs=[200,400,600,800,1000].map(p=>pack.qs.filter(q=>q.p===p)[i]);} export default pack;`}));
}}];
const bundle=await build(options),html=await renderHtml(bundle.outputFiles[0].text,{version:pkg.version});
const me={user:{id:'local-tilepuzzle-qa',name:'فحص محلي'},premium:{active:true,until:Date.now()+86400000,source:'test',status:'active',willRenew:false},trials:{},serverTime:Date.now()};
const types={'.js':'text/javascript','.html':'text/html; charset=utf-8','.webp':'image/webp','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
const results=[],errors=[],networkErrors=[],questions=[];
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
 if(pathname==='/sw.js')body=Buffer.from(body.toString().replaceAll('__BUILD_ID__','tilepuzzle-ui-fixture'));
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':body.length});res.end(body);
}catch{if(!res.headersSent)res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const BASE=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const companionPacks=await Promise.all(['general','food','animals','sports','history'].map(id=>read(`src/data/categories/${id}.json`)));
const escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
let page,context;
async function settle(){await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});}
async function state(){return page.locator('.m-question-screen').evaluate(el=>{
 const base=el.querySelector('.m-media-img.fx-jumble'),stage=el.querySelector('.m-media-stage'),grid=el.querySelector('.m-jumble');
 return {text:el.innerText,base:{alt:base.alt,width:base.naturalWidth,height:base.naturalHeight,opacity:getComputedStyle(base).opacity,position:getComputedStyle(base).position,hidden:base.classList.contains('is-hidden-src')},grid:grid?{aria:grid.getAttribute('aria-hidden'),columns:getComputedStyle(grid).gridTemplateColumns,rows:getComputedStyle(grid).gridTemplateRows,ratio:getComputedStyle(grid).aspectRatio,tiles:[...grid.children].map(x=>({position:getComputedStyle(x).backgroundPosition,size:getComputedStyle(x).backgroundSize,image:getComputedStyle(x).backgroundImage}))}:null,canEnlarge:stage.classList.contains('can-enlarge'),stageRole:stage.getAttribute('role'),attributes:[...el.querySelectorAll('img,[title],[aria-label]')].map(x=>({alt:x.getAttribute('alt'),title:x.getAttribute('title'),aria:x.getAttribute('aria-label'),src:x.tagName==='IMG'?x.getAttribute('src'):null}))};
 });}
function leakAnswers(q,s){return [q.a,...(q.alt||[])].filter(a=>typeof a==='string'&&a.trim()).filter(a=>{const word=new RegExp(`(^|[^\\p{L}\\p{N}])(?:ال)?${escaped(a)}(?=$|[^\\p{L}\\p{N}])`,'u');return word.test(s.text)||s.attributes.some(x=>[x.alt,x.title,x.aria,x.src].some(value=>value&&word.test(value)));});}
async function imagePixels(file){const {data,info}=await sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true});let dark=0,color=0;for(let i=0;i<data.length;i+=info.channels){const rgb=[data[i],data[i+1],data[i+2]],max=Math.max(...rgb),min=Math.min(...rgb);if(max<80)dark++;if(max-min>45&&min<180)color++;}return {width:info.width,height:info.height,darkPixels:dark,colorPixels:color};}
try{
 check('all40 neutral media filenames',pack.qs.every(q=>q.media?.src===`${q.qid}.webp`));
 for(let batch=0;batch<8;batch++){
  context=await browser.newContext({viewport:{width:390,height:844},locale:'ar',isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push({batch,message:error.message}));
  page.on('response',response=>{if(response.status()>=400&&!response.url().includes('/api/'))networkErrors.push({batch,status:response.status(),url:response.url().replace(BASE,'')});});
  const route=`${BASE}/?tilepuzzle-batch=${batch}`;
  await page.goto(`${route}#/auth?code=local-tilepuzzle-qa`,{waitUntil:'domcontentloaded'});
  await page.locator('.splash').waitFor({state:'detached'});await page.locator('.home-screen').waitFor();
  await page.goto(`${route}#/play/badeeha`);await page.locator('.m-hero-cta').click();
  for(const p of [pack,...companionPacks])await page.locator('.m-category-main').filter({has:page.locator('b',{hasText:new RegExp(`^${escaped(p.name)}$`)})}).click();
  await page.getByRole('button',{name:/^ابدأ 30 سؤال/}).click();await page.locator('.m-board-grid').waitFor();
  for(const tier of tiers){
   const q=pack.qs.filter(q=>q.p===tier)[batch],start=results.length;
   await page.getByRole('button',{name:`${pack.name}، سؤال ${tier} نقطة`,exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.m-media-img').length===1&&[...document.querySelectorAll('.m-media-img')].every(img=>img.complete&&img.naturalWidth>0)&&document.querySelectorAll('.m-jumble i').length===12);
   await settle();const before=await state();
   const positions=before.grid.tiles.map(t=>t.position);
   const natural=Array.from({length:12},(_,i)=>`${(i%4)*(100/3)}% ${Math.floor(i/4)*50}%`);
   check(`${q.qid}: full source hidden before reveal`,before.base.opacity==='0'&&before.base.hidden&&before.base.position==='absolute',before);
   check(`${q.qid}: twelve complete unique tiles`,positions.length===12&&new Set(positions).size===12&&before.grid.tiles.every(t=>t.size==='400% 300%'&&t.image.includes(q.media.src)),before.grid);
   check(`${q.qid}: 4 columns 3 rows preserving image ratio`,before.grid.columns.split(' ').length===4&&before.grid.rows.split(' ').length===3&&Math.abs((before.grid.ratio.includes('/')?before.grid.ratio.split('/').map(Number).reduce((a,b)=>a/b):parseFloat(before.grid.ratio))-before.base.width/before.base.height)<0.01,before.grid);
   check(`${q.qid}: order is actually shuffled`,positions.some((pos,i)=>{const parts=pos.split(' ').map(parseFloat);return Math.abs(parts[0]-(i%4)*100/3)>0.01||Math.abs(parts[1]-Math.floor(i/4)*50)>0.01;}),positions);
   check(`${q.qid}: generic alt and no answer leak before reveal`,before.base.alt==='صورة السؤال'&&leakAnswers(q,before).length===0,leakAnswers(q,before));
   check(`${q.qid}: enlargement unavailable before reveal`,!before.canEnlarge&&before.stageRole===null);
   await page.locator('.m-media-stage').click();check(`${q.qid}: pressing tiles cannot open original`,await page.locator('.m-lightbox').count()===0);
   const sizing=[];
   for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await settle();
    const box=await page.locator('.m-media-stage').boundingBox();
    const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,fit:getComputedStyle(document.querySelector('.m-media-img')).objectFit}));
    check(`${q.qid}: fits ${width}px mobile`,box.x>=-1&&box.x+box.width<=width+1&&layout.scroll<=width+1&&layout.fit==='contain',{box,layout});sizing.push({box,layout});
   }
   const beforeFile=path.join(OUT,'stages',`${q.qid}-jumble.png`),afterFile=path.join(OUT,'stages',`${q.qid}-full.png`);
   await page.locator('.m-media-stage').screenshot({path:beforeFile,animations:'disabled'});
   await page.screenshot({path:path.join(OUT,'screens',`${q.qid}-before.png`),fullPage:true,animations:'disabled'});
   await page.locator('.m-reveal-action').click();await page.locator('.m-judge').waitFor();await settle();
   await page.locator('.m-jumble-ghost').waitFor({state:'detached'});
   const after=await state();
   check(`${q.qid}: complete source replaces tiles after reveal`,after.base.opacity==='1'&&!after.base.hidden&&!after.grid&&after.canEnlarge,after);
   check(`${q.qid}: correct revealed answer`,after.base.alt===q.a&&(await page.locator('.m-answer strong').innerText())===q.a);
   await page.locator('.m-media-stage').screenshot({path:afterFile,animations:'disabled'});
   await page.screenshot({path:path.join(OUT,'screens',`${q.qid}-after.png`),fullPage:true,animations:'disabled'});
   check(`${q.qid}: revealed screenshot differs from shuffled image`,!(await fs.readFile(beforeFile)).equals(await fs.readFile(afterFile)));
   await page.locator('.m-media-stage.can-enlarge').click();await page.locator('.m-lightbox').waitFor();
   check(`${q.qid}: enlarged revealed image has answer alt`,await page.locator('.m-lightbox img').getAttribute('alt')===q.a);
   await page.getByRole('button',{name:'إغلاق الصورة',exact:true}).click();
   await page.getByRole('button',{name:/إخفاء الإجابة/}).click();await settle();
   const hidden=await state();
   check(`${q.qid}: hide restores same twelve-tile permutation`,hidden.base.opacity==='0'&&hidden.base.hidden&&!!hidden.grid&&JSON.stringify(hidden.grid.tiles.map(t=>t.position))===JSON.stringify(positions),hidden.grid);
   check(`${q.qid}: hide restores neutral text and blocks enlarge`,!hidden.canEnlarge&&hidden.base.alt==='صورة السؤال'&&leakAnswers(q,hidden).length===0);
   await page.locator('.m-nobody').click();await page.locator('.m-board-grid').waitFor();
   await page.setViewportSize({width:390,height:844});
   questions.push({qid:q.qid,answer:q.a,tier:q.p,batch,ok:results.slice(start).every(x=>x.ok),beforeFile,afterFile,positions,sizing});
   console.log(`${questions.at(-1).ok?'PASS':'FAIL'} ${q.qid} (${questions.length}/40)`);
  }
  if(batch===7){
   const decoded=await page.evaluate(async refs=>{const rows=[];for(const src of refs){const image=new Image();image.src=`media/tilepuzzle/${src}`;try{await image.decode();rows.push({src,ok:image.naturalWidth>0,width:image.naturalWidth,height:image.naturalHeight});}catch{rows.push({src,ok:false});}}return rows;},pack.qs.map(q=>q.media.src));
   check('all40 media decode in Chromium',decoded.length===40&&decoded.every(x=>x.ok));await fs.writeFile(path.join(OUT,'asset-decode.json'),JSON.stringify(decoded,null,2));
   await page.goto(`${BASE}/?tilepuzzle-batch=all&credits=1#/about`,{waitUntil:'domcontentloaded'});await page.locator('.about-list').waitFor();
   await page.getByRole('button',{name:'عرض القائمة الكاملة',exact:true}).click();
   const credits=(await page.locator('.credits-list li').allTextContents()).filter(text=>text.includes(`/ ${pack.name}`));
   check('all40 own About rows disclose AI creation',credits.length===40&&credits.every(row=>pack.qs.some(q=>row.includes(q.media.disclosure))),{count:credits.length});
  }
  await context.close();context=null;
 }
 check('all40 individually exercised',questions.length===40&&new Set(questions.map(q=>q.qid)).size===40);
 check('no browser runtime errors',errors.length===0,errors);check('no missing assets',networkErrors.length===0,networkErrors);
}catch(error){check('tilepuzzle gameplay flow',false,error.stack||error.message);await page?.screenshot({path:path.join(OUT,'failure.png'),fullPage:true,animations:'disabled'}).catch(()=>{});}
finally{
 await context?.close();await browser.close();await new Promise(resolve=>server.close(resolve));
 await fs.writeFile(path.join(OUT,'results.json'),JSON.stringify({executedAt:new Date().toISOString(),sourcePackSha256:crypto.createHash('sha256').update(packBytes).digest('hex'),mockAccountOnly:true,sourcePackQuestions:pack.qs.length,selection:'8 isolated browser contexts; each test-only in-memory deck contains one untouched actual question per tier; all40 questions exercised',manualVisualReview:'pending contact-sheet inspection',results,questions,errors,networkErrors},null,2));
}
// Diagnostic contact sheets contain only actual gameplay screenshots, jumbled and
// revealed side by side. Labels are neutral IDs; originals remain available.
for(const tier of tiers){
 const group=questions.filter(q=>q.tier===tier).sort((a,b)=>a.qid.localeCompare(b.qid)),composite=[];
 for(let i=0;i<group.length;i++){
  const q=group[i],left=(i%2)*528,top=Math.floor(i/2)*230;
  const label=Buffer.from(`<svg width="528" height="28"><rect width="528" height="28" fill="#ffffff"/><text x="12" y="20" font-size="16" font-family="Arial">${q.qid} | JUMBLE BEFORE / FULL AFTER</text></svg>`);
  composite.push({input:label,left,top});
  for(const [j,file]of[q.beforeFile,q.afterFile].entries())composite.push({input:await sharp(file).resize(256,192,{fit:'contain',background:'#fff9ed'}).png().toBuffer(),left:left+j*264,top:top+30});
 }
 if(composite.length)await sharp({create:{width:1056,height:920,channels:3,background:'#eeeeee'}}).composite(composite).png().toFile(path.join(OUT,`contact-${tier}.png`));
}
console.log(`${results.filter(x=>x.ok).length}/${results.length} checks;${questions.length}/40 questions;${OUT}`);
if(results.some(x=>!x.ok))process.exitCode=1;
