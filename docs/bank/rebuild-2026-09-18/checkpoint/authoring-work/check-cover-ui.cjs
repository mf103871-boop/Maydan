const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const repo='C:/Users/user/Desktop/maydan';
const requireRepo=createRequire(path.join(repo,'package.json'));
const { chromium }=requireRepo('playwright');
const { build }=requireRepo('esbuild');
(async()=>{
 const {esbuildOptions,renderHtml}=await import(pathToFileURL(path.join(repo,'scripts/lib.mjs')).href);
 const bundle=await build(esbuildOptions({media:{'badeeha-covers':'abcdef12'},version:'test-covers'}));
 const html=await renderHtml(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,{version:'test-covers'});
 const fixture=await fs.readFile(path.join(repo,'public/media/fabraka-v3/fab3-001.webp'));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const checks=[];
 const check=(name,value)=>{assert.ok(value,name);checks.push({name,ok:true});};
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ar',serviceWorkers:'block',reducedMotion:'reduce'});
  let releaseFirst;
  const holdFirst=new Promise(resolve=>{releaseFirst=resolve});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(!['GET','HEAD'].includes(route.request().method())) return route.abort();
   if(u.pathname==='/') return route.fulfill({contentType:'text/html',body:html});
   if(u.pathname.startsWith('/media/badeeha-covers/')) {
    if(u.pathname.endsWith('/geo.webp')) return route.fulfill({status:404,body:'fixture missing cover'});
    if(u.pathname.endsWith('/general.webp')) await holdFirst;
    return route.fulfill({contentType:'image/webp',body:fixture});
   }
   if(u.pathname==='/api/billing/config') return route.fulfill({contentType:'application/json',body:'{"checkoutEnabled":false}'});
   return route.fulfill({status:404,body:'not part of cover fixture'});
  });
  await page.goto('https://covers.test/#/play/badeeha',{waitUntil:'load'});
  await page.locator('.m-hero-cta').click();
  const cards=page.locator('.m-category-pick');
  await cards.first().scrollIntoViewIfNeeded();
  check('78 category choices preserved',await cards.count()===78);
  const first=cards.nth(0).locator('.m-category-cover');
  await first.locator('img').waitFor();
  check('old icon remains visible while image is pending',await first.getAttribute('data-state')==='loading' && await first.locator('.m-category-cover-fallback').isVisible());
  const before=await first.boundingBox();
  releaseFirst();
  await first.locator('img').waitFor();
  await page.waitForFunction(()=>document.querySelector('.m-category-cover').dataset.state==='ready');
  const after=await first.boundingBox();
  check('image completion preserves reserved 4:3 layout',Math.abs(before.height-after.height)<1 && Math.abs(after.width/after.height-4/3)<0.025);
  await page.waitForFunction(()=>document.querySelectorAll('.m-category-cover')[1].dataset.state==='fallback');
  check('missing individual cover falls back without a broken image',await cards.nth(1).locator('img').count()===0 && await cards.nth(1).locator('.m-category-cover-fallback').isVisible());
  await cards.first().locator('.m-category-main').click();
  check('image cover preserves selection state',await cards.first().locator('.m-category-main').getAttribute('aria-pressed')==='true');
  await cards.first().locator('.m-favorite').click();
  check('favorite control stays independent of selection',await cards.first().locator('.m-favorite').getAttribute('aria-pressed')==='true' && await cards.first().locator('.m-category-main').getAttribute('aria-pressed')==='true');
  const sizes=[];
  for(const width of [320,360,390,430,768,1440]){
   await page.setViewportSize({width,height:844});
   const size=await page.evaluate(()=>({width:innerWidth,columns:getComputedStyle(document.querySelector('.m-category-picker')).gridTemplateColumns.split(' ').length,overflow:document.documentElement.scrollWidth>innerWidth,button:document.querySelector('.m-favorite').getBoundingClientRect().width}));
   check(`layout at ${width}px`,!size.overflow && size.columns===(width<600?2:width<900?3:5) && size.button>=47);
   sizes.push(size);
  }
  await page.setViewportSize({width:390,height:844});
  await cards.first().scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'cover-ui-fixture-phone.png'),animations:'disabled'});
  await page.locator('.m-search input').fill('يوتيوبرز');
  check('long-name category remains searchable',await cards.count()===1 && await cards.locator('b').textContent()==='يوتيوبرز وصنّاع محتوى');
  check('cover imagery is decorative',await cards.locator('img').getAttribute('alt')==='');
  check('no JavaScript exceptions',errors.length===0);
  await fs.writeFile(path.join(__dirname,'cover-ui-check.json'),JSON.stringify({fixture:'Local code built in memory; unrelated existing WebP used only to test loading. No generated cover or external API was called.',checks,sizes,errors},null,2));
  console.log(JSON.stringify({passed:checks.length,checks,sizes},null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
