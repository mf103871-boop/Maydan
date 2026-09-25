// Isolated QA: production app/actual media, test-only in-memory deck selection.
// Writes only to OUT. Does not modify repository, accounts, source, or records.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const ROOT=path.resolve(process.env.MAYDAN_ROOT||path.join(path.dirname(fileURLToPath(import.meta.url)),'../../../../..'));
const OUT=path.resolve(process.argv[2]||path.join(path.dirname(fileURLToPath(import.meta.url)),'rerun'));
const require=createRequire(path.join(ROOT,'package.json'));
const {chromium}=require('playwright'),{build}=require('esbuild'),sharp=require('sharp');
const {esbuildOptions,renderHtml,readPkg}=await import(pathToFileURL(path.join(ROOT,'scripts/lib.mjs')));
const read=async relative=>JSON.parse(await fs.readFile(path.join(ROOT,relative),'utf8'));
const packBytes=await fs.readFile(path.join(ROOT,'src/data/categories/spotdiff.json'));
const pack=JSON.parse(packBytes),tiers=[200,400,600,800,1000];
if(pack.qs.length!==40||!pack.qs.every(q=>q.type==='diff'&&Array.isArray(q.media)&&q.media.length===2&&/^spotdiff-(200|400|600|800|1000)-90[1-8]$/.test(q.qid)))throw new Error('Wait for the integrated40 spotdiff questions; old pack must not be tested as new.');
if(!tiers.every(p=>pack.qs.filter(q=>q.p===p).length===8))throw new Error('Expected8 questions per tier.');
await fs.mkdir(path.join(OUT,'screens'),{recursive:true});
await fs.mkdir(path.join(OUT,'stages'),{recursive:true});
const pkg=await readPkg(),options=esbuildOptions({minify:true,version:pkg.version});
options.define.__MAYDAN_ROOMS_URL__=JSON.stringify('same-origin');
options.plugins=[{name:'deterministic-spotdiff-batches',setup(builder){
 builder.onLoad({filter:/[/\\]categories[/\\]spotdiff\.json$/},()=>({loader:'js',contents:`const pack=${JSON.stringify(pack)}; const n=new URLSearchParams(location.search).get('spotdiff-batch'); if(n!==null&&n!=='all'){const i=Number(n);pack.qs=[200,400,600,800,1000].map(p=>pack.qs.filter(q=>q.p===p)[i]);} export default pack;`}));
}}];
const bundle=await build(options),html=await renderHtml(bundle.outputFiles[0].text,{version:pkg.version});
const me={user:{id:'local-spotdiff-qa',name:'فحص محلي'},premium:{active:true,until:Date.now()+86400000,source:'test',status:'active',willRenew:false},trials:{},serverTime:Date.now()};
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
 if(pathname==='/sw.js')body=Buffer.from(body.toString().replaceAll('__BUILD_ID__','spotdiff-ui-fixture'));
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':body.length});res.end(body);
}catch{if(!res.headersSent)res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const BASE=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const companionPacks=await Promise.all(['general','food','animals','sports','history'].map(id=>read(`src/data/categories/${id}.json`)));
const escaped=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
let page,context;
async function settle(){await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});}

const mediaHashes=await Promise.all(pack.qs.flatMap(q=>q.media.map(async m=>({src:m.src,sha256:crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT,'media/spotdiff',m.src))).digest('hex')}))));
const rendererHashes=await Promise.all(['src/games/badeeha/App.js','src/games/badeeha/styles.css'].map(async file=>({file,sha256:crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT,file))).digest('hex')})));
async function capture(q,width,phase,stageFile){
 await page.locator('.m-diff').evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));await settle();
 const visibility=await page.evaluate(()=>{const d=document.querySelector('.m-diff').getBoundingClientRect(),h=document.querySelector('.m-header')?.getBoundingClientRect();return{stageTop:d.top,stageBottom:d.bottom,headerBottom:h?.bottom||0,viewportHeight:innerHeight};});
 check(`${q.qid}/${width}/${phase}: both images visible below sticky header`,visibility.stageTop>=visibility.headerBottom-1&&visibility.stageBottom<=visibility.viewportHeight+1,visibility);
 await page.locator('.m-diff').screenshot({path:stageFile,animations:'disabled'});
 await page.evaluate(()=>window.scrollTo(0,0));await settle();
 await page.screenshot({path:path.join(OUT,'screens',`${q.qid}-${width}-${phase}.png`),fullPage:true,animations:'disabled'});
}
async function state(){return page.locator('.m-question-screen').evaluate(el=>{
 const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
 return{text:el.innerText,answer:el.querySelector('.m-answer strong')?.innerText,frames:[...el.querySelectorAll('.m-diff-frame')].map(frame=>{const img=frame.querySelector('img'),mark=frame.querySelector('.m-diff-spot');return{frame:box(frame),image:box(img),src:img.getAttribute('src'),alt:img.alt,width:img.naturalWidth,height:img.naturalHeight,fit:getComputedStyle(img).objectFit,mark:mark?{box:box(mark),left:mark.style.left,top:mark.style.top,width:mark.style.width}:null}}),attributes:[...el.querySelectorAll('img,[title],[aria-label]')].map(x=>({alt:x.getAttribute('alt'),title:x.getAttribute('title'),aria:x.getAttribute('aria-label'),src:x.tagName==='IMG'?x.getAttribute('src'):null})),layout:{viewport:innerWidth,scroll:document.documentElement.scrollWidth,columns:getComputedStyle(el.querySelector('.m-diff')).gridTemplateColumns}};
});}
const normalize=s=>s.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/\s+/g,' ').trim();
function leaks(q,s){return[q.a,...(q.alt||[])].filter(x=>typeof x==='string'&&x.trim()).filter(a=>{const needle=normalize(a);return normalize(s.text).includes(needle)||s.attributes.some(x=>[x.alt,x.title,x.aria,x.src].some(v=>v&&normalize(v).includes(needle)));});}
function markCheck(q,s){return s.frames.map(f=>{const m=f.mark?.box,im=f.image;if(!m)return{ok:false,reason:'missing'};const actual={x:100*(m.x+m.width/2-im.x)/im.width,y:100*(m.y+m.height/2-im.y)/im.height,diameter:100*m.width/im.width};return{actual,wanted:q.spot,ok:Math.abs(actual.x-q.spot.x)<.8&&Math.abs(actual.y-q.spot.y)<.8&&Math.abs(actual.diameter-q.spot.r*2)<.8&&Math.abs(m.width-m.height)<1.5,inside:m.x>=im.x-1.5&&m.y>=im.y-1.5&&m.x+m.width<=im.x+im.width+1.5&&m.y+m.height<=im.y+im.height+1.5};});}
try{
 check('all80 neutral media filenames',pack.qs.every(q=>q.media.every((m,i)=>m.src===`${q.qid}-${i?'b':'a'}.webp`)));
 for(let batch=0;batch<8;batch++){
  context=await browser.newContext({viewport:{width:390,height:844},locale:'ar',isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push({batch,message:error.message}));
  page.on('response',response=>{if(response.status()>=400&&!response.url().includes('/api/'))networkErrors.push({batch,status:response.status(),url:response.url().replace(BASE,'')});});
  const route=`${BASE}/?spotdiff-batch=${batch}`;
  await page.goto(`${route}#/auth?code=local-spotdiff-qa`,{waitUntil:'domcontentloaded'});
  await page.locator('.splash').waitFor({state:'detached'});await page.locator('.home-screen').waitFor();
  await page.goto(`${route}#/play/badeeha`);await page.locator('.m-hero-cta').click();
  for(const p of [pack,...companionPacks])await page.locator('.m-category-main').filter({has:page.locator('b',{hasText:new RegExp(`^${escaped(p.name)}$`)})}).click();
  await page.getByRole('button',{name:/^ابدأ 30 سؤال/}).click();await page.locator('.m-board-grid').waitFor();
  for(const tier of tiers){
   const q=pack.qs.filter(q=>q.p===tier)[batch],start=results.length;
   await page.getByRole('button',{name:`${pack.name}، سؤال ${tier} نقطة`,exact:true}).click();
   await page.waitForFunction(()=>[...document.querySelectorAll('.m-diff img')].length===2&&[...document.querySelectorAll('.m-diff img')].every(x=>x.complete&&x.naturalWidth>0));
   await settle();const initial=await state();
   check(`${q.qid}: new question has two decoded images and no marker`,initial.frames.length===2&&initial.frames.every(f=>f.width===1280&&f.height===960&&!f.mark));
   const views=[];
   for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await settle();const before=await state();
    check(`${q.qid}/${width}: generic numbered alt and no answer leak before reveal`,before.frames.every((f,i)=>f.alt===`الصورة ${i+1}`)&&leaks(q,before).length===0,leaks(q,before));
    check(`${q.qid}/${width}: no marker before reveal`,before.frames.every(f=>!f.mark));
    check(`${q.qid}/${width}: no horizontal overflow, full contain images`,before.layout.scroll<=width+1&&before.frames.every(f=>f.image.x>=-1&&f.image.x+f.image.width<=width+1&&f.fit==='contain'&&Math.abs(f.image.width/f.image.height-4/3)<.02),before.layout);
    const [first,second]=before.frames.map(f=>f.image);
    const gridOk=width===390?Math.abs(first.y-second.y)<1.5&&(first.x+first.width<=second.x+1.5||second.x+second.width<=first.x+1.5):Math.abs(first.x-second.x)<1.5&&second.y>=first.y+first.height;
    check(`${q.qid}/${width}: ${width===390?'two side-by-side images':'one image per row'}`,gridOk,{first,second});
    await page.locator('.m-diff img').first().click();check(`${q.qid}/${width}: no hidden original/answer lightbox`,await page.locator('.m-lightbox').count()===0);
    const beforeFile=path.join(OUT,'stages',`${q.qid}-${width}-before.png`),afterFile=path.join(OUT,'stages',`${q.qid}-${width}-after.png`);
    await capture(q,width,'before',beforeFile);
    const reveal=page.locator('.m-reveal-action');if(await reveal.count())await reveal.click();else await page.getByRole('button',{name:/إظهار الإجابة/}).click();
    await page.locator('.m-judge').waitFor();await settle();const after=await state(),marks=markCheck(q,after);
    check(`${q.qid}/${width}: revealed answer exactly matches`,after.answer===q.a,after.answer);
    check(`${q.qid}/${width}: exactly two physical-left/top markers with correct diameter`,after.frames.length===2&&after.frames.every(f=>f.mark)&&marks.every(m=>m.ok),marks);
    check(`${q.qid}/${width}: marker circles remain within actual image bounds`,marks.every(m=>m.inside),marks);
    check(`${q.qid}/${width}: marker frames match actual image boxes`,after.frames.every(f=>Math.abs(f.frame.x-f.image.x)<1.5&&Math.abs(f.frame.y-f.image.y)<1.5&&Math.abs(f.frame.width-f.image.width)<1.5&&Math.abs(f.frame.height-f.image.height)<1.5));
    await capture(q,width,'after',afterFile);
    await page.getByRole('button',{name:/إخفاء الإجابة/}).click();await settle();const hidden=await state();
    check(`${q.qid}/${width}: hide removes both markers and answer leakage`,hidden.frames.every(f=>!f.mark)&&leaks(q,hidden).length===0,leaks(q,hidden));
    check(`${q.qid}/${width}: hide preserves original image sources`,hidden.frames.every((f,i)=>f.src===before.frames[i].src));
    views.push({width,beforeFile,afterFile,before,after,marks});
   }
   await page.locator('.m-nobody').click();await page.locator('.m-board-grid').waitFor();await page.setViewportSize({width:390,height:844});
   questions.push({qid:q.qid,answer:q.a,tier:q.p,batch,spot:q.spot,ok:results.slice(start).every(r=>r.ok),views});
   console.log(`${questions.at(-1).ok?'PASS':'FAIL'} ${q.qid} (${questions.length}/40)`);
  }
  if(batch===7){
   const decoded=await page.evaluate(async refs=>{const rows=[];for(const src of refs){const im=new Image();im.src=`media/spotdiff/${src}`;try{await im.decode();rows.push({src,ok:im.naturalWidth>0,width:im.naturalWidth,height:im.naturalHeight});}catch{rows.push({src,ok:false});}}return rows;},pack.qs.flatMap(q=>q.media.map(m=>m.src)));
   check('all80 media decode in Chromium',decoded.length===80&&decoded.every(x=>x.ok));await fs.writeFile(path.join(OUT,'asset-decode.json'),JSON.stringify(decoded,null,2)+'\n');
   await page.goto(`${BASE}/?spotdiff-batch=all&credits=1#/about`,{waitUntil:'domcontentloaded'});await page.locator('.about-list').waitFor();await page.getByRole('button',{name:'عرض القائمة الكاملة',exact:true}).click();
   const credits=(await page.locator('.credits-list li').allTextContents()).filter(t=>t.includes(`/ ${pack.name}`));
   check('all80 own About rows disclose AI creation',credits.length===80&&credits.every(row=>pack.qs.some(q=>q.media.some(m=>m.disclosure&&row.includes(m.disclosure)))),{count:credits.length});
   await fs.writeFile(path.join(OUT,'about-credits.json'),JSON.stringify(credits,null,2)+'\n');
  }
  await context.close();context=null;
 }
 check('all40 individually exercised at390 and320',questions.length===40&&new Set(questions.map(q=>q.qid)).size===40&&questions.every(q=>q.views.length===2));
 check('pack did not change during run',packBytes.equals(await fs.readFile(path.join(ROOT,'src/data/categories/spotdiff.json'))));
 const unchanged=await Promise.all(mediaHashes.map(async m=>m.sha256===crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT,'media/spotdiff',m.src))).digest('hex')));
 check('all80 media hashes unchanged during run',unchanged.every(Boolean));
 const rendererUnchanged=await Promise.all(rendererHashes.map(async m=>m.sha256===crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT,m.file))).digest('hex')));
 check('renderer files unchanged during run',rendererUnchanged.every(Boolean));
 check('no browser runtime errors',errors.length===0,errors);check('no missing assets',networkErrors.length===0,networkErrors);
}catch(error){check('spotdiff gameplay flow',false,error.stack||error.message);await page?.screenshot({path:path.join(OUT,'failure.png'),fullPage:true,animations:'disabled'}).catch(()=>{});}
finally{
 await context?.close();await browser.close();await new Promise(resolve=>server.close(resolve));
 await fs.writeFile(path.join(OUT,'results.json'),JSON.stringify({executedAt:new Date().toISOString(),sourcePackSha256:crypto.createHash('sha256').update(packBytes).digest('hex'),mediaHashes,rendererHashes,mockAccountOnly:true,sourcePackQuestions:pack.qs.length,selection:'8 isolated browser contexts; test-only in-memory decks contain one unchanged actual question per tier; all40 exercised at390 and320.',manualVisualReview:'pending contact-sheet inspection',results,questions,errors,networkErrors},(k,v)=>typeof v==='string'&&v.startsWith(OUT)?path.relative(OUT,v).replaceAll('\\','/'):v,2)+'\n');
}
for(const tier of tiers)for(const width of [390,320]){
 const group=questions.filter(q=>q.tier===tier).sort((a,b)=>a.qid.localeCompare(b.qid)),batchSize=width===390?4:2;
 for(let batch=0;batch<Math.ceil(group.length/batchSize);batch++){
  const rows=group.slice(batch*batchSize,batch*batchSize+batchSize),composite=[],tileWidth=360,tileHeight=width===390?200:470,rowHeight=tileHeight+30;
  for(let i=0;i<rows.length;i++){const q=rows[i],v=q.views.find(v=>v.width===width);composite.push({input:Buffer.from(`<svg width="728" height="28"><rect width="728" height="28" fill="#fff"/><text x="8" y="20" font-size="16" font-family="Arial">${q.qid} | ${width}px BEFORE / REVEALED</text></svg>`),left:0,top:i*rowHeight});for(const[j,file]of[v.beforeFile,v.afterFile].entries())composite.push({input:await sharp(file).resize(tileWidth,tileHeight,{fit:'contain',background:'#fff9ed'}).png().toBuffer(),left:j*368,top:i*rowHeight+30});}
  if(composite.length)await sharp({create:{width:728,height:rows.length*rowHeight,channels:3,background:'#eee'}}).composite(composite).png().toFile(path.join(OUT,`contact-${tier}-${width}-${batch+1}.png`));
 }
}
console.log(`${results.filter(r=>r.ok).length}/${results.length} checks; ${questions.length}/40 questions; ${OUT}`);
if(results.some(r=>!r.ok))process.exitCode=1;
