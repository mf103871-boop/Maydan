import {build}from'esbuild';
import {webkit}from'playwright';
import {createServer}from'node:http';
import {readFile,writeFile,mkdir}from'node:fs/promises';
import path from'node:path';
import {createHash}from'node:crypto';
import {execFileSync}from'node:child_process';
import sharp from'sharp';
const sourceRoot='C:/Users/user/Documents/Codex/2026-10-01/new-chat/work/maydan-store-source22-2fe';
const output='C:/Users/user/Documents/Codex/2026-10-01/new-chat/outputs/app-store-1.8-22';
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim();
if(commit!=='2fe524e98f8a455b1b801ab4c0fdd9d82f9396ef')throw Error('Frozen source mismatch');
await mkdir(output,{recursive:true});
const captions={
 home:{ar:['كل لَمّة إلها لعبة','٧ ألعاب عربية… والضحكة تجمعكم'],en:['Your people. Your kind of play.','7 Arabic games for your next get-together']},
 ersomha:{ar:['ارسمها… وخليهم يخمّنوا','رسم حي وتخمين جماعي من كل جوال'],en:['Draw it. Let them guess.','Live drawing and guessing, on every phone']},
 badeeha:{ar:['خلّوا المعرفة منافسة','صور وأسئلة وتحديات بين الفرق'],en:['Turn knowledge into a challenge','Picture puzzles, questions and team rivalry']},
 chat:{ar:['من السالفة… للمباراة','شِلَل وصوتيات ودعوات تجمعكم'],en:['From group chat to game night','Private groups, voice notes and game invites']},
 friends:{ar:['أصحابك أقرب من أي وقت','شوف المتصلين وابدأ اللَّمّة'],en:['Your friends, one tap away','See who’s online and get the group together']},
 fabraka:{ar:['الحقيقة… ولا فبركة؟','خَمّن وصوّت وسولفوا مع بعض'],en:['The truth… or a clever bluff?','Guess, vote and talk together']},
};
const built=await build({entryPoints:[path.resolve('scripts/releases/app-store-1.8-22/fixture.jsx')],bundle:true,write:false,format:'iife',jsx:'automatic',minify:true,alias:{'@app':sourceRoot,'react':path.join(sourceRoot,'node_modules/react'),'react-dom':path.join(sourceRoot,'node_modules/react-dom'),'react/jsx-runtime':path.join(sourceRoot,'src/design/jsx-runtime.js')},loader:{'.js':'jsx','.css':'text','.json':'json','.webp':'dataurl','.woff2':'dataurl','.png':'dataurl'},define:{'process.env.NODE_ENV':JSON.stringify('production'),__MAYDAN_PLATFORM__:JSON.stringify('ios'),__MAYDAN_VERSION__:JSON.stringify('1.8')},logLevel:'silent'});
const bundle=built.outputFiles[0].contents;
const fontAr=await readFile(path.join(sourceRoot,'src/shared/brand/assets/arabic.woff2'));
const fontLatin=await readFile(path.join(sourceRoot,'src/shared/brand/assets/latin.woff2'));
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle);return;}
 if(url.pathname.startsWith('/media/')){const file=path.join(sourceRoot,url.pathname);res.setHeader('content-type','image/webp');res.end(await readFile(file));return;}
 if(url.pathname==='/app'){
  res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><base href="/"></head><body><div id="root"></div><script>window.MaydanNative={};window.fetch=()=>Promise.reject(new Error('SCREENSHOT_NETWORK_DISABLED'));window.WebSocket=class{constructor(){throw Error('SCREENSHOT_NETWORK_DISABLED')}};</script><script src="/bundle.js"></script></body></html>`);return;
 }
 const scene=url.searchParams.get('scene')||'home',locale=url.searchParams.get('locale')||'ar',c=captions[scene][locale];
 res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><html lang="${locale}" dir="${locale==='ar'?'rtl':'ltr'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Maydan;src:url(data:font/woff2;base64,${fontAr.toString('base64')})} @font-face{font-family:MaydanLatin;src:url(data:font/woff2;base64,${fontLatin.toString('base64')})}*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}body{font-family:${locale==='ar'?'Maydan':'MaydanLatin'},sans-serif;background:radial-gradient(ellipse at 10% 0%,#DDD3F8 0,transparent 48%),radial-gradient(ellipse at 100% 80%,#BCEAE3 0,transparent 52%),#FFF6E5;color:#30203F;padding:20px 14px 0;display:flex;flex-direction:column;align-items:center}.caption{text-align:center;width:100%;padding:0 5px 17px;flex-shrink:0}.eyebrow{font-size:11px;color:#06768B;letter-spacing:${locale==='ar'?'0':'1.3px'};font-weight:800;margin:0 0 8px}.caption h1{font-size:${locale==='ar'?'32':'31'}px;line-height:1.23;font-weight:800;letter-spacing:${locale==='ar'?'-.7':'-.8'}px;margin:0 auto 8px;max-width:390px}.caption p{font-size:14px;line-height:1.5;color:#6D5B75;margin:0}.app-frame{width:100%;flex:1;min-height:0;position:relative;border:1px solid #D7C6C0;border-bottom:0;border-radius:27px 27px 0 0;overflow:hidden;background:#FFF6E5;box-shadow:0 0 0 5px #FFFDF680,0 15px 35px #30203F30}iframe{width:100%;height:100%;border:0;background:#FFF6E5;display:block}</style></head><body><header class="caption"><div class="eyebrow">${locale==='ar'?'ميدان • ألعاب جمعتنا':'MAYDAN • ARABIC PARTY GAMES'}</div><h1>${c[0]}</h1><p>${c[1]}</p></header><main class="app-frame"><iframe title="Maydan actual game UI" src="/app?scene=${scene}#/${['home'].includes(scene)?'':scene==='friends'?'friends':scene==='chat'?'friends/group/studio-group':'room/456789'}"></iframe></main></body></html>`);
}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,report={commit,method:'Source-rendered production22UI with synthetic memory-only account/game state, Arabic UI in both localizations; marketing captions outside the app iframe. Not native device captures or audio evidence.',shots:[],errors:[]};
const browser=await webkit.launch();
try{
 for(const size of process.argv.includes('--contact')?[[1290,2796]]:[[1179,2556],[1290,2796]])for(const locale of process.argv.includes('--contact')?['ar']:['ar','en'])for(const scene of Object.keys(captions).filter(s=>!process.argv.includes('--scene')||s===process.argv[process.argv.indexOf('--scene')+1])){
  const context=await browser.newContext({viewport:{width:size[0]/3,height:size[1]/3},deviceScaleFactor:3,reducedMotion:'reduce',locale:'ar-JO'}),page=await context.newPage();
  page.on('pageerror',e=>report.errors.push({scene,locale,error:e.message}));
  await page.goto(`${origin}/?scene=${scene}&locale=${locale}`);const frame=page.frames()[1];await frame.waitForFunction(()=>window.captureReady);await frame.evaluate(()=>document.fonts.ready);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500);
  if(scene==='ersomha'){
   const strokes=makeTrain();await frame.evaluate(strokes=>{let seq=0;for(const op of strokes)window.drawingClient.emit({kind:'append',epoch:1,seq:++seq,op});},strokes);await page.waitForTimeout(200);
  }
  if(scene==='fabraka'){
   const grip=frame.getByTestId('call-dock-drag'),box=await grip.boundingBox(),iframeBox=await page.locator('iframe').boundingBox();
   await frame.evaluate(()=>{window.dragProof=[];for(const type of['pointerdown','pointermove','pointerup'])document.addEventListener(type,e=>{if(e.target.closest('.call-dock'))window.dragProof.push({type,x:e.clientX,y:e.clientY,target:e.target.className});},true);});
   await page.mouse.move(box.x+22,box.y+22);await page.mouse.down();await page.mouse.move(iframeBox.x+40,iframeBox.y+200,{steps:20});await page.mouse.up();await page.waitForTimeout(150);
   await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   console.log('drag-proof',JSON.stringify(await frame.evaluate(()=>{const dock=document.querySelector('.call-dock');return{x:dock.dataset.positionX,y:dock.dataset.positionY,style:dock.getAttribute('style'),rect:dock.getBoundingClientRect().toJSON()};})));
  }
  await frame.waitForFunction(()=>[...document.images].filter(img=>img.currentSrc).every(img=>img.complete&&img.naturalWidth>0));
  if(scene==='badeeha'){const resume=frame.getByRole('button',{name:'متابعة الوقت',exact:false});if(await resume.count())await resume.first().click();}
  await page.evaluate(()=>{window.scrollTo(0,0);document.documentElement.scrollTop=0;document.body.scrollTop=0;});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const file=`${locale}-${size[0]}x${size[1]}-${String(Object.keys(captions).indexOf(scene)+1).padStart(2,'0')}-${scene}.png`;
  // App Store rejects an alpha channel even when all pixels are fully opaque.
  const png=await page.screenshot();await writeFile(path.join(output,file),await sharp(png).removeAlpha().png().toBuffer());const geometry=await frame.evaluate(()=>{const dock=document.querySelector('.call-dock'),overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;return{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,bodyText:document.body.innerText.slice(0,180),fontsReady:document.fonts.status,nativeMode:window.captureNativeMode,loaderCount:document.querySelectorAll('.m-media-spinner,.ers-board-status').length,voiceDurations:[...document.querySelectorAll('.lamma-voice-message>div:first-child>bdi')].map(el=>el.textContent),callDock:dock?{rect:dock.getBoundingClientRect().toJSON(),transform:dock.style.transform,participants:[...dock.querySelectorAll('[data-testid="call-dock-participant"]')].map(el=>el.getAttribute('aria-label')),coversExit:[...document.querySelectorAll('[data-design-id="exit"]')].some(el=>overlap(el.getBoundingClientRect(),dock.getBoundingClientRect()))}:null,theme:{bg:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),purple:getComputedStyle(document.documentElement).getPropertyValue('--purple').trim()},images:[...document.images].filter(img=>img.currentSrc).map(img=>({loaded:img.complete&&img.naturalWidth>0,src:img.currentSrc.startsWith('data:')?'embedded':img.getAttribute('src')})),studioLabels:document.body.innerText.includes('معاينة')};});
  const marketing=await page.evaluate(()=>({scrollY,headingTop:document.querySelector('.caption').getBoundingClientRect().top,captionVisible:document.querySelector('.eyebrow').getBoundingClientRect().top>=0,captionOverflow:document.querySelector('.caption').scrollWidth>document.querySelector('.caption').clientWidth+1}));
  report.shots.push({file,scene,locale,outputWidth:size[0],outputHeight:size[1],sha256:createHash('sha256').update(await readFile(path.join(output,file))).digest('hex'),marketing,...geometry});console.log(file,geometry.width,geometry.height);await context.close();
 }
 await writeFile(path.join(output,'capture-report.json'),JSON.stringify(report,null,2));
 const thumbs=await Promise.all(report.shots.filter(s=>s.locale==='ar'&&s.outputWidth===1290).map(async(s,i)=>({input:await sharp(path.join(output,s.file)).resize({width:258}).png().toBuffer(),left:i*270,top:0})));
 await sharp({create:{width:270*6-12,height:560,channels:3,background:'#FFF6E5'}}).composite(thumbs).png().toFile(path.join(output,'contact-ar.png'));
 if(report.errors.length)throw Error(JSON.stringify(report.errors));
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
function makeTrain(){
 const ops=[];const line=(pts,color='#35224a',width=12)=>ops.push({strokeId:`demo-stroke-${ops.length}`,points:pts,color,width,tool:'pen',end:true});
 const ellipse=(x,y,rx,ry,color='#35224a',width=12)=>line(Array.from({length:65},(_,i)=>[x+Math.cos(i*Math.PI/32)*rx,y+Math.sin(i*Math.PI/32)*ry]),color,width);
 // A plausible player drawing, delivered through the real room drawing protocol.
 line([[.13,.72],[.88,.72]],'#8a563d',10);line([[.13,.79],[.88,.79]],'#8a563d',10);
 for(let x=.17;x<.88;x+=.09)line([[x,.70],[x-.035,.82]],'#8a563d',7);
 line([[.18,.64],[.18,.46],[.47,.46],[.47,.64],[.18,.64]],'#118d96',12);
 line([[.23,.46],[.23,.29],[.44,.29],[.44,.46]],'#118d96',12);line([[.2,.28],[.47,.28]],'#35224a',12);
 line([[.28,.34],[.38,.34],[.38,.42],[.28,.42],[.28,.34]],'#3b72b8',10);
 line([[.47,.48],[.69,.48],[.69,.64],[.47,.64]],'#ed6a5a',12);
 line([[.61,.48],[.61,.36],[.67,.36],[.67,.48]],'#35224a',12);line([[.59,.36],[.69,.36]],'#35224a',12);
 line([[.69,.58],[.77,.65],[.69,.65]],'#f4b942',12);
 ellipse(.29,.66,.065,.065);ellipse(.55,.66,.065,.065);ellipse(.29,.66,.014,.014,'#9250bd',12);ellipse(.55,.66,.014,.014,'#9250bd',12);
 line([[.77,.47],[.77,.36],[.91,.36],[.91,.64],[.78,.64]],'#9250bd',12);ellipse(.83,.66,.045,.045);line([[.79,.40],[.86,.40],[.86,.47],[.79,.47],[.79,.40]],'#3b72b8',8);
 ellipse(.66,.25,.04,.028,'#83929b',8);ellipse(.73,.19,.055,.035,'#83929b',8);ellipse(.83,.13,.065,.04,'#83929b',8);
 return ops;
}

