import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {chromium,webkit} from 'playwright';
import {startUIReview} from '../scripts/ui-preview.mjs';
import {acceptTermsIfShown} from './helpers/terms-consent.mjs';

async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function geometry(page){return page.evaluate(()=>{
 const box=selector=>{const e=document.querySelector(selector);if(!e||!e.getClientRects().length)return null;const r=e.getBoundingClientRect(),style=getComputedStyle(e);if(style.visibility==='hidden')return null;const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {...r.toJSON(),hit:hit===e||e.contains(hit)};};
 return {close:box('.startup-background-close'),status:box('.startup-background'),launcher:box('.lamma-launcher'),menu:box('.menu-navigation'),reserved:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--startup-background-space'))||0};
});}

test('real app startup notice stays touchable above the launcher and menu without disrupting input', {timeout:150_000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'maydan-startup-overlay-'));
 const output=path.resolve('.cache/startup-overlay-browser');await mkdir(output,{recursive:true});
 let app;
 t.after(async()=>{if(app)await app.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true});});
 app=await startUIReview({port:await freePort(),apiPort:await freePort(),watchSource:false,assetRoot:directory});
 app.backend.env.MAFIA_ENABLED='0';app.backend.env.TERMS_ENFORCEMENT_ENABLED='1';
 const origin=new URL(app.url).origin,report=[];
 for(const [engineName,engine]of Object.entries({chromium,webkit})){
  const browser=await engine.launch({headless:true});
  try{for(const width of [360,393,430])await t.test(engineName+' '+width,async()=>{
   const context=await browser.newContext({viewport:{width,height:852},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(18000);
   try{
    await context.addInitScript(()=>{
      localStorage.setItem('maydan:platform:settings',JSON.stringify({uiLocale:'ar',soundOn:false,musicOn:false,reducedMotion:true}));
      const fetchNetwork=globalThis.fetch.bind(globalThis);
      globalThis.fetch=(input,options)=>{
        const url=new URL(input instanceof Request ? input.url : input,location.href);
        if(url.origin===location.origin&&url.pathname.endsWith('.webp'))return Promise.resolve(new Response('Isolated startup-cache failure',{status:503}));
        return fetchNetwork(input,options);
      };
    });
    // Only the programmatic cache fetch fails. DOM image loads remain real.
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin);await acceptTermsIfShown(page,{locale:'ar'});await page.locator('[data-design-screen="home"]').waitFor();
    const close=page.locator('.startup-background-close');await close.waitFor();
    await page.waitForFunction(()=>document.querySelector('.startup-background')?.getBoundingClientRect().bottom<=document.querySelector('.menu-navigation')?.getBoundingClientRect().top-7);
    const menu=await geometry(page);assert.ok(menu.close.width>=48&&menu.close.height>=48&&menu.close.hit);assert.ok(menu.status.bottom<=menu.menu.top-7);
    await close.tap();await page.locator('.startup-background').waitFor({state:'detached'});
    await page.getByRole('navigation').last().getByText('الأصدقاء',{exact:true}).tap();await page.waitForURL('**/#/friends');
    await page.goto(origin+'/?overlay-game=1#/play/badeeha');await page.locator('[data-design-screen="badeeha.setup"]').waitFor();await close.waitFor();
    const field=page.locator('[data-design-screen="badeeha.setup"] input').first();await field.focus();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.startup-background')).visibility==='hidden'&&parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--startup-background-space'))===0);
    await field.fill('فريق اللمّة');await field.press('Tab');await page.locator('[data-design-id="mode-choice"]').first().tap();
    await page.locator('[data-design-screen="badeeha.setup"] [data-design-id="round-size"]').filter({hasText:/^(٢٠|20)$/}).tap();
    for(let index=0;index<6;index++)await page.locator('[data-design-id="category-card"]').nth(index).tap();
    await page.locator('[data-design-screen="badeeha.setup"] [data-design-id="start"]').tap();await page.locator('[data-design-screen="badeeha.board"]').waitFor();
    await page.waitForFunction(()=>{const status=document.querySelector('.startup-background')?.getBoundingClientRect(),launcher=document.querySelector('.lamma-launcher')?.getBoundingClientRect();return status&&launcher&&status.bottom<=launcher.top-7;});
    const game=await geometry(page);assert.ok(game.close.width>=48&&game.close.height>=48&&game.close.hit);assert.ok(game.launcher.hit);assert.ok(game.status.bottom<=game.launcher.top-7);assert.ok(game.reserved>=game.status.height+8,'bottom gameplay reserves space for the notice');
    await page.screenshot({path:path.join(output,`${engineName}-${width}-before-close.png`)});
    await close.tap();await page.locator('.startup-background').waitFor({state:'detached'});
    await page.locator('.lamma-launcher').tap();await page.locator('.lamma-layer [role="dialog"]').waitFor();
    assert.deepEqual(errors,[]);report.push({engine:engineName,width,menu,game,realTouchClose:true,launcherStillOpens:true,inputSuppression:true,pageErrors:0});
   }finally{await context.close();}
  });}finally{await browser.close();}
 }
 await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,views:report,scope:'Actual application, real local account/Terms API and real Splash/SocialHost. Only startup cache transport fails. Input focus is tested, not a physical mobile keyboard.'},null,2)+'\n');
});
