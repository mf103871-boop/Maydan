// Real Home + real capability hook and router, with only the HTTP service and
// account/platform context supplied by the fixture. No admission POSTs occur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

let bundle;
const compiled = () => bundle ||= build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{Home}from'./src/platform/screens/Home.jsx';import{PlatformContext}from'./src/platform/context.js';
import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{useRoute,navigate}from'./src/platform/router.js';
import{setUiLocale,untranslatedUiKeys}from'./src/shared/i18n/core.js';
import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import platformCSS from'./src/platform/platform.css';import studio from'./src/platform/playful-studio.css';
const noop=()=>{},platform={settings:{},version:'fixture',sound:{play:noop},haptics:{vibrate:noop}};
function App(){const[policy,setPolicy]=useState('game-entry-ticket-v2'),[revision,setRevision]=useState(0),route=useRoute();
window.fixture={locale:setUiLocale,missing:untranslatedUiKeys,go:navigate,setPolicy,setOrigin:value=>{window.__fixtureOrigin=value;setRevision(x=>x+1)}};
const account={...NULL_ACCOUNT,ready:true,signedIn:true,user:{id:'fixture-owner'},gameplayPolicy:policy,gameAccess:()=> 'ticket',premium:false};
return <AccountContext.Provider value={account}><PlatformContext.Provider value={platform}><style>{tokens+ui+platformCSS+studio}</style><div data-revision={revision}>{route.name==='home'?<Home/>:<output data-testid="destination">{route.name+':'+(route.params.id||'')}</output>}</div></PlatformContext.Provider></AccountContext.Provider>}
createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  loader: { '.css':'text', '.woff2':'dataurl', '.webp':'dataurl', '.mp3':'dataurl' }, logLevel:'silent',
  define: { __MAYDAN_ROOMS_URL__:'window.__fixtureOrigin', __MAYDAN_AUDIO_PREVIEW__:'false' } });

const root = 'https://maydan-home.test', a = 'https://maydan-production.test', b = 'https://maydan-preview.test';
const body = enabled => ({ enabled, capabilities:{ mafia:2 } });
async function fixture(engine, { clock = false } = {}) {
  const built = await compiled(), browser = await engine.launch({ headless:true });
  const page = await browser.newPage({ viewport:{width:390,height:844},reducedMotion:'reduce' });
  const errors=[],requests=[],pending=[],counts=new Map();let answer={status:200,body:body(false)},hold=true;
  page.on('pageerror', error=>errors.push(error.message));page.on('request',request=>requests.push({method:request.method(),url:request.url()}));
  await page.addInitScript(origin=>{window.__fixtureOrigin=origin;},a);
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===root) return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${built.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></html>`});
    if([a,b].includes(url.origin)&&url.pathname==='/api/mafia/capabilities'){
      counts.set(url.origin,(counts.get(url.origin)||0)+1);
      const respond=value=>route.fulfill({status:value.status,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify(value.body)}).catch(()=>{});
      if(hold){pending.push({origin:url.origin,respond});return;}
      return respond(answer);
    }
    return route.fulfill({status:200,body:''});
  });
  if (clock) await page.clock.install({ time: new Date() });
  await page.goto(root);await page.locator('[data-design-screen="home"]').waitFor();
  return {browser,page,errors,requests,pending,counts,setAnswer(value){answer=value;hold=false;},hold(){hold=true;},async release(origin,value){await page.waitForFunction(()=>true);const start=Date.now();while(!pending.some(row=>row.origin===origin)){assert.ok(Date.now()-start<5000);await page.waitForTimeout(10);}const index=pending.findIndex(row=>row.origin===origin);await pending.splice(index,1)[0].respond(value);}};
}
const noPlay=async page=>{assert.equal(await page.locator('[data-design-id="online-mode"],[data-design-id="local-mode"]').count(),0);assert.equal(await page.locator('[data-testid="destination"]').count(),0);assert.equal(await page.locator('button.game-card').count(),8);};

for(const[name,engine]of[['Chromium',chromium],['WebKit',webkit]]){
  test(`${name}: actual Home explains loading/disabled/error without tickets and enables only the validated service`,{timeout:60000},async t=>{
    const f=await fixture(engine);t.after(()=>f.browser.close());const{page}=f;
    await page.locator('button[data-game="mafia"]').click();await page.getByRole('status').filter({hasText:'جارٍ التحقق'}).waitFor();await noPlay(page);
    await f.release(a,{status:200,body:body(false)});await page.getByRole('status').filter({hasText:'غير متاحة حاليًا'}).waitFor();await noPlay(page);
    assert.equal(await page.locator('button[data-game="mafia"]').isEnabled(),true);
    await page.evaluate(()=>window.fixture.locale('en'));
    await page.getByRole('status').filter({hasText:'Currently unavailable'}).waitFor();
    assert.doesNotMatch(await page.locator('[data-design-screen="home.game-mode"]').innerText(),/[\u0600-\u06ff]/u);
    f.setAnswer({status:503,body:{error:'UNAVAILABLE'}});await page.locator('[data-design-id="availability-retry"]').click();
    await page.getByRole('status').filter({hasText:'Could not check availability'}).waitFor();await noPlay(page);
    f.setAnswer({status:200,body:{enabled:true,capabilities:{mafia:1}}});await page.locator('[data-design-id="availability-retry"]').click();
    await page.getByRole('status').filter({hasText:'Could not check availability'}).waitFor();await noPlay(page);
    f.setAnswer({status:200,body:body(true)});await page.locator('[data-design-id="availability-retry"]').click();
    await page.getByTestId('destination').filter({hasText:'game-entry:mafia'}).waitFor();
    await page.evaluate(()=>{window.fixture.setPolicy(null);window.fixture.go('/');});
    await page.locator('button[data-game="mafia"]').click();await page.locator('[data-design-id="online-mode"]').waitFor();
    assert.equal(await page.locator('[data-design-id="online-mode"]').isEnabled(),true);
    await page.locator('[data-design-id="online-mode"]').click();await page.getByTestId('destination').filter({hasText:'online:mafia'}).waitFor();
    assert.deepEqual(f.errors,[]);assert.equal(f.requests.filter(row=>row.method!=='GET').length,0);assert.deepEqual(await page.evaluate(()=>window.fixture.missing()),[]);
  });
  test(`${name}: actual Home never carries availability across origins or accepts a late old response`,{timeout:60000},async t=>{
    const f=await fixture(engine);t.after(()=>f.browser.close());const{page}=f;
    await page.evaluate(()=>window.fixture.setOrigin('https://maydan-preview.test'));
    await page.locator('button[data-game="mafia"]').click();await noPlay(page);
    await f.release(b,{status:200,body:body(false)});await page.getByRole('status').filter({hasText:'غير متاحة حاليًا'}).waitFor();
    await f.release(a,{status:200,body:body(true)});await noPlay(page);
    await page.evaluate(()=>window.fixture.setOrigin('https://maydan-production.test'));
    await page.getByRole('status').filter({hasText:'جارٍ التحقق'}).waitFor();await noPlay(page);
    await f.release(a,{status:200,body:body(false)});await page.getByRole('status').filter({hasText:'غير متاحة حاليًا'}).waitFor();
    const count=f.counts.get(a);await page.evaluate(()=>window.fixture.go('/settings'));await page.getByTestId('destination').waitFor();
    await page.evaluate(()=>window.fixture.go('/'));await page.locator('button[data-game="mafia"]').click();
    await page.getByRole('status').filter({hasText:'غير متاحة حاليًا'}).waitFor();assert.equal(f.counts.get(a),count,'short-lived cache avoids duplicate same-origin reads');
    assert.deepEqual(f.errors,[]);assert.equal(f.requests.filter(row=>row.method!=='GET').length,0);
  });
  test(`${name}: expired availability closes play options and a timed-out refresh stays closed`,{timeout:60000},async t=>{
    const f=await fixture(engine,{clock:true});t.after(()=>f.browser.close());const{page}=f;
    await page.evaluate(()=>window.fixture.setPolicy(null));
    await f.release(a,{status:200,body:body(true)});
    await page.locator('button[data-game="mafia"]').click();await page.locator('[data-design-id="online-mode"]').waitFor();
    f.hold();await page.clock.fastForward(30_001);
    await page.getByRole('status').filter({hasText:'جارٍ التحقق'}).waitFor();await noPlay(page);
    await page.clock.fastForward(8_001);
    await page.getByRole('status').filter({hasText:'تعذّر التحقق'}).waitFor();await noPlay(page);
    await f.release(a,{status:200,body:body(true)});await noPlay(page);
    f.setAnswer({status:200,body:body(false)});await page.locator('[data-design-id="availability-retry"]').click();
    await page.getByRole('status').filter({hasText:'غير متاحة حاليًا'}).waitFor();await noPlay(page);
    const requestCount=f.requests.length;await page.evaluate(()=>window.fixture.setOrigin('http://untrusted.example'));
    await page.getByRole('status').filter({hasText:'تعذّر التحقق'}).waitFor();await noPlay(page);
    assert.equal(f.requests.length,requestCount,'invalid configured origin is rejected before fetch');
    assert.deepEqual(f.errors,[]);assert.equal(f.requests.filter(row=>row.method!=='GET').length,0);
  });
}
