// Tests the actual standalone owner-game artifact with disposable sessions and
// real design routes. No production credentials, host or external API is used.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { buildDesignPreview } from '../../scripts/design-preview-build.mjs';
import { startStudioLocal } from '../../scripts/studio-local.mjs';
import { createDefaultDesign } from '../../src/design/schema.js';

await mkdir('.cache',{recursive:true});
const directory=await mkdtemp(path.resolve('.cache/studio-play-build-'));
after(async()=>{assert.ok(directory.startsWith(path.resolve('.cache')+path.sep));await rm(directory,{recursive:true,force:true});});
const foreign='https://foreign-api.invalid';
const original=process.env.MAYDAN_ROOMS_URL;
const builds=[];
try{
  for(const mode of ['unset','foreign']){
    if(mode==='unset')delete process.env.MAYDAN_ROOMS_URL;else process.env.MAYDAN_ROOMS_URL=foreign;
    const outdir=path.join(directory,mode);
    await buildDesignPreview({outdir,version:'1.8'});
    const bytes=await readFile(path.join(outdir,'studio/play/index.html'));
    builds.push({mode,outdir,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
}finally{if(original===undefined)delete process.env.MAYDAN_ROOMS_URL;else process.env.MAYDAN_ROOMS_URL=original;}
// The game build is independent of a native/foreign API environment setting.
assert.equal(builds[0].sha256,builds[1].sha256);
console.log(`Standalone web play SHA-256: ${builds[0].sha256}`);

async function seedPrivatePreview(runtime){
  let token=runtime.sessions['studio-test-owner'].token;
  async function write(resource,method,body){
    const response=await fetch(runtime.origin+resource,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
    const rotated=response.headers.get('x-maydan-session');if(rotated)token=rotated;
    const result=await response.json();assert.ok(response.ok,`Disposable fixture setup failed: ${resource} (${response.status})`);return result;
  }
  const document=createDefaultDesign();document.screens.home={nodes:{title:{text:'نسخة المالك الخاصة'}}};
  const draft=await write('/api/design/draft','PUT',{document,expectedRevision:0});
  const created=await write('/api/design/versions','POST',{name:'Standalone web fixture',expectedRevision:draft.revision});
  await write('/api/design/preview','PUT',{versionId:created.version.id});
  return token;
}
async function fixturePage(browser,runtime,token){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage();
  const calls=[],external=[],errors=[];
  page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/'))calls.push({origin:url.origin,path:url.pathname,authenticated:!!request.headers().authorization});});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['http:','https:'].includes(url.protocol))return route.continue();
    if(url.origin!==runtime.origin){external.push({origin:url.origin,authenticated:!!request.headers().authorization});return route.abort();}
    if(url.pathname==='/api/me')return route.fulfill({contentType:'application/json',body:JSON.stringify({user:{id:'studio-test-owner',name:'مالك تجريبي'},premium:{active:false},trials:{},paddle:null})});
    if(url.pathname==='/api/billing/config')return route.fulfill({contentType:'application/json',body:'{"providers":{},"paddle":{}}'});
    return route.continue();
  });
  if(token)await context.addInitScript(value=>localStorage.setItem('maydan:account:session',JSON.stringify(value)),token);
  return{context,page,calls,external,errors};
}

for(const[name,engine]of[['chromium',chromium],['webkit',webkit]])test(`${name}: built owner game uses only its own host with unset/foreign API settings`,{timeout:90000},async()=>{
  const browser=await engine.launch({headless:true});
  try{
    for(const build of builds){
      const runtime=await startStudioLocal({assetsDir:build.outdir});
      try{
        const token=await seedPrivatePreview(runtime);
        {const fixture=await fixturePage(browser,runtime,token);const{context,page,calls,external,errors}=fixture;try{
          await page.goto(runtime.origin+'/api/studio/play/');
          await page.locator('[data-design-screen="home"] [data-design-id="title"]').filter({hasText:'نسخة المالك الخاصة'}).waitFor();
          assert.ok(calls.some(call=>call.path==='/api/design/me'&&call.authenticated&&call.origin===runtime.origin),`${build.mode}: owner gate must contact same-origin permission endpoint`);
          assert.ok(calls.some(call=>call.path==='/api/me'&&call.authenticated&&call.origin===runtime.origin),`${build.mode}: the real PlatformApp must load its account through the same resolver`);
          assert.ok(calls.some(call=>call.path==='/api/ui-config'&&call.authenticated&&call.origin===runtime.origin),`${build.mode}: real runtime must request owner-specific configuration`);
          assert.equal(await page.getByText('معاينة خاصة',{exact:false}).count()>0,true);
          assert.deepEqual(external,[],`${build.mode}: no owner credential or request can reach a foreign API`);assert.deepEqual(errors,[]);
        }finally{await context.close();}}
        {const{context,page,calls,external}=await fixturePage(browser,runtime,null);try{
          await page.goto(runtime.origin+'/api/studio/play/');await page.getByText('سجّل دخولك إلى ميدان بحساب الاستوديو، ثم افتح رابط التجربة مجددًا.',{exact:true}).waitFor();
          assert.equal(await page.locator('[data-design-screen="home"]').count(),0);assert.equal(calls.some(call=>call.path==='/api/design/me'),false);assert.deepEqual(external,[]);
        }finally{await context.close();}}
        {const{context,page,calls,external}=await fixturePage(browser,runtime,runtime.sessions['studio-test-player'].token);try{
          await page.goto(runtime.origin+'/api/studio/play/');await page.getByText('هذه الصفحة خاصة بحساب مالك الاستوديو.',{exact:true}).waitFor();
          assert.equal(await page.locator('[data-design-screen="home"]').count(),0);assert.ok(calls.some(call=>call.path==='/api/design/me'&&call.origin===runtime.origin));assert.equal(calls.some(call=>call.path==='/api/me'),false);assert.deepEqual(external,[]);
        }finally{await context.close();}}
      }finally{await runtime.close();}
    }
  }finally{await browser.close();}
});
