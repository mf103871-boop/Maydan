// Local-only UI fixture. No project files or external services are changed.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const repo = process.env.MAYDAN_REPO || path.resolve(__dirname, '../../../../../..');
const out = process.env.MAYDAN_UI_OUT || path.join(require('node:os').tmpdir(), 'Maydan-ui-review');
const requireRepo = createRequire(path.join(repo, 'package.json'));
const { chromium } = requireRepo('playwright');
const { build } = requireRepo('esbuild');
const sharp = requireRepo('sharp');
const checks = [], errors = [];
const check = (name, ok, detail) => { checks.push({name, ok:!!ok, ...(detail ? {detail} : {})}); assert.ok(ok, name + (detail ? `: ${JSON.stringify(detail)}` : '')); };
(async () => {
  await fs.mkdir(out, {recursive:true});
  const {esbuildOptions, renderHtml} = await import(pathToFileURL(path.join(repo, 'scripts/lib.mjs')).href);
  const {CATS} = await import(pathToFileURL(path.join(repo, 'src/data/categories/index.js')).href);
  const {BANK_CONTENT_VERSION} = await import(pathToFileURL(path.join(repo, 'src/games/badeeha/logic.js')).href);
  const versions = {'badeeha-covers':'ui-review-20260923', zoom:'ui-review-20260923'};
  const opts = esbuildOptions({media:versions, version:'ui-local-20260923'});
  const production = await build(opts);
  const html = await renderHtml(production.outputFiles.find(f=>f.path.endsWith('.js')).text, {version:'ui-local-20260923'});
  check('production application bundles without full-build bank/media gates', true);
  // Isolated production game for saved-session zoom fixtures: no account/network boundary is exercised.
  const standalone = {...opts}; delete standalone.entryPoints;
  standalone.stdin = {resolveDir:repo, loader:'jsx', contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './src/games/badeeha/App.js'; createRoot(document.getElementById('root')).render(<App api={{settings:{soundOn:false,hapticsOn:false,reducedMotion:true}}}/>);`};
  const game = await build(standalone);
  const gameHtml = await renderHtml(game.outputFiles.find(f=>f.path.endsWith('.js')).text, {version:'ui-local-20260923'});
  const assets=[];
  for(const cat of CATS){
    const f=path.join(repo,'public/media/badeeha-covers',cat.id+'.webp');
    const bytes=await fs.readFile(f), meta=await sharp(bytes).metadata();
    assets.push({id:cat.id,width:meta.width,height:meta.height,bytes:bytes.length});
    check(`${cat.id}: decodable 4:3 cover exists`, meta.format==='webp' && Math.abs(meta.width/meta.height-4/3)<.001);
  }
  await fs.writeFile(path.join(out,'asset-and-bundle-checks.json'),JSON.stringify({checks,assets},null,2));
  if(process.argv.includes('--compile-only')) { console.log(JSON.stringify({passed:checks.length,browser:'not requested'},null,2)); return; }
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox']});
  const newContext=()=>browser.newContext({viewport:{width:390,height:844},locale:'ar',reducedMotion:'reduce',serviceWorkers:'block',isMobile:true,hasTouch:true});
  async function routeLocal(context, document, fault={}) {
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url()), p=decodeURIComponent(url.pathname);
      if(!['GET','HEAD'].includes(route.request().method())) return route.abort();
      if(p==='/') return route.fulfill({contentType:'text/html',body:document});
      if(p.startsWith('/media/')){
        if(fault.missing && p.endsWith('/geo.webp')) return route.fulfill({status:404,body:'intentional missing-cover fixture'});
        if(fault.pending && p.endsWith('/general.webp')) await fault.pending;
        for(const base of ['public','']){
          const candidate=path.join(repo,base,p.slice(1));
          try{return await route.fulfill({contentType:p.endsWith('.webp')?'image/webp':'application/octet-stream',body:await fs.readFile(candidate)});}catch(e){if(e.code!=='ENOENT')throw e;}
        }
      }
      if(p==='/api/billing/config') return route.fulfill({contentType:'application/json',body:'{"checkoutEnabled":false}'});
      return route.fulfill({status:404,body:'outside local fixture'});
    });
  }
  try {
    const ctx=await newContext(); await routeLocal(ctx,html);
    const page=await ctx.newPage(); page.on('pageerror',e=>errors.push(e.message));
    await page.goto('https://covers.test/#/play/badeeha'); await page.locator('.m-hero-cta').click();
    const cards=page.locator('.m-category-pick'); check('78 cover choices render',await cards.count()===78);
    await cards.locator('img').evaluateAll(imgs=>imgs.forEach(img=>img.loading='eager'));
    await page.waitForFunction(()=>document.querySelectorAll('.m-category-cover[data-state="ready"]').length===78);
    check('all actual cover files decode in browser',await cards.locator('img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)));
    const sizes=[];
    for(const width of [320,360,390,430,768,1440]){
      await page.setViewportSize({width,height:844});
      const size=await page.evaluate(()=>({width:innerWidth,columns:getComputedStyle(document.querySelector('.m-category-picker')).gridTemplateColumns.split(' ').length,overflow:document.documentElement.scrollWidth>innerWidth,button:document.querySelector('.m-favorite').getBoundingClientRect().width,ratios:[...document.querySelectorAll('.m-category-cover')].map(x=>{const r=x.getBoundingClientRect();return r.width/r.height})}));
      check(`cover layout at ${width}px`,!size.overflow && size.columns===(width<600?2:width<900?3:5) && size.button>=47 && size.ratios.every(r=>Math.abs(r-4/3)<.025),size); sizes.push(size);
    }
    await page.setViewportSize({width:390,height:844});
    await cards.first().scrollIntoViewIfNeeded(); await page.screenshot({path:path.join(out,'covers-phone.png')});
    await cards.first().locator('.m-category-main').click(); check('cover selection retained',await cards.first().locator('.m-category-main').getAttribute('aria-pressed')==='true');
    await cards.first().locator('.m-favorite').click(); check('favorite independent of selection',await cards.first().locator('.m-favorite').getAttribute('aria-pressed')==='true' && await cards.first().locator('.m-category-main').getAttribute('aria-pressed')==='true');
    await page.locator('.m-search input').fill('يوتيوبرز'); check('long category name searchable',await cards.count()===1 && await cards.locator('b').textContent()==='يوتيوبرز وصنّاع محتوى');
    check('cover decorative alt',await cards.locator('img').getAttribute('alt')==='');
    await ctx.close();
    const faultCtx=await newContext(); let release; const pending=new Promise(r=>release=r); await routeLocal(faultCtx,html,{missing:true,pending});
    const fp=await faultCtx.newPage(); await fp.goto('https://covers.test/#/play/badeeha'); await fp.locator('.m-hero-cta').click();
    const fc=fp.locator('.m-category-cover').first(); await fc.scrollIntoViewIfNeeded();
    check('pending image uses icon fallback',await fc.getAttribute('data-state')==='loading' && await fc.locator('.m-category-cover-fallback').isVisible());
    const before=await fc.boundingBox(); release(); await fp.waitForFunction(()=>document.querySelector('.m-category-cover').dataset.state==='ready'); const after=await fc.boundingBox();
    check('cover loading causes no layout shift',Math.abs(before.height-after.height)<1);
    await fp.waitForFunction(()=>document.querySelectorAll('.m-category-cover')[1].dataset.state==='fallback');
    check('404 cover removes broken image',await fp.locator('.m-category-cover').nth(1).locator('img').count()===0); await faultCtx.close();
    const zoom=CATS.find(c=>c.id==='zoom'); check('new zoom integration has 40 cards',zoom.qs.length===40);
    const selected=['zoom','general','geo','science','animals','history'];
    for(const q of zoom.qs){
      const zctx=await newContext(); await routeLocal(zctx,gameHtml);
      const deck=Object.fromEntries(selected.map(id=>[id,CATS.find(c=>c.id===id).qs.slice(0,5).map(x=>x.qid)])); deck.zoom[0]=q.qid;
      const teams=['الفريق الأول','الفريق الثاني'].map(name=>({name,score:0,correct:0,steals:0,tools:{double:true,two:true,time:true}}));
      const snapshot={version:2,contentVersion:BANK_CONTENT_VERSION,screen:'question',teams,selectedCategories:selected,timerLength:60,mode:'expert',roundSize:30,deck,used:{},turn:0,current:{categoryId:'zoom',index:0},timeLeft:60,paused:true,revealed:false,answerHidden:false,mixedItems:[],effect:{double:false,two:false},hintsUsed:0,questionBaseTeams:teams};
      await zctx.addInitScript(s=>localStorage.setItem('maydan:badeeha:active-game-v2',JSON.stringify(s)),snapshot);
      const zp=await zctx.newPage(); zp.on('pageerror',e=>errors.push(`${q.qid}: ${e.message}`)); await zp.goto('https://zoom.test/'); await zp.locator('.m-saved-card .m-primary').click();
      await zp.waitForFunction(()=>{const i=document.querySelector('.m-media-img');return i?.complete&&i.naturalWidth>0&&!document.querySelector('.m-media-spinner');});
      const inspect=()=>zp.locator('.m-media-img').evaluate(i=>({origin:i.style.transformOrigin,transform:getComputedStyle(i).transform,alt:i.alt,canEnlarge:!!i.closest('.can-enlarge'),overflow:document.documentElement.scrollWidth>innerWidth}));
      const scale=[600,800,1000].includes(q.p)?3.16:3.4;
      let state=await inspect(); check(`${q.qid}: authored crop and no pre-reveal lightbox`,state.origin===(q.origin||'50% 50%') && state.transform.startsWith(`matrix(${scale},`) && !state.canEnlarge && !state.overflow,state);
      if(q.qid.endsWith('901')) await zp.locator('.m-question-card').screenshot({path:path.join(out,q.qid+'-before.png')});
      await zp.locator('.m-reveal-action').click(); await zp.locator('.m-answer:not(.is-hidden)').waitFor(); await zp.waitForFunction(()=>getComputedStyle(document.querySelector('.m-media-img')).transform==='matrix(1, 0, 0, 1, 0, 0)');
      state=await inspect(); check(`${q.qid}: full image and answer revealed`,state.transform==='matrix(1, 0, 0, 1, 0, 0)' && state.canEnlarge && state.alt===q.a && await zp.locator('.m-answer strong').textContent()===q.a,state);
      await zp.locator('.m-media-stage.can-enlarge').click(); await zp.locator('.m-lightbox').waitFor(); await zp.keyboard.press('Escape'); check(`${q.qid}: revealed lightbox opens and closes`,await zp.locator('.m-lightbox').count()===0);
      await zp.locator('.m-answer-toggle').click(); await zp.waitForFunction(s=>getComputedStyle(document.querySelector('.m-media-img')).transform.startsWith(`matrix(${s},`),scale); state=await inspect(); check(`${q.qid}: hide answer restores crop`,state.transform.startsWith(`matrix(${scale},`) && !state.canEnlarge && state.alt==='صورة السؤال',state);
      await zp.locator('.m-answer-toggle').click(); if(q.qid.endsWith('901')) await zp.locator('.m-question-card').screenshot({path:path.join(out,q.qid+'-after.png')});
      await zctx.close();
    }
    check('no uncaught JavaScript exceptions',errors.length===0,errors);
    await fs.writeFile(path.join(out,'browser-checks.json'),JSON.stringify({checks,sizes,errors},null,2));
    console.log(JSON.stringify({passed:checks.length,zoomCards:zoom.qs.length,errors},null,2));
  } finally { await browser.close(); }
})().catch(async error=>{await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({message:error.message,checks,errors},null,2));console.error(error.stack);process.exitCode=1;});
