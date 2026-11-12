// Real local preview/API journey. Synthetic Plus fixtures, never checkout.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const origin=process.env.UI_REVIEW_ORIGIN||'http://127.0.0.1:4192',url=new URL(origin);
assert.ok(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname));
const output=path.resolve('.cache/playful-store-journey');await mkdir(output,{recursive:true});
const report=[];
for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true});
  try{for(const scenario of ['plus','owned']){
    const response=await fetch(origin+'/__plus_lab__/scenario',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({scenario})});assert.equal(response.status,200);
    const auth=await response.json();assert.equal(auth.localOnly,true);
    const read=async route=>{const result=await fetch(origin+route,{headers:{origin,authorization:`Bearer ${auth.session.token}`}});assert.equal(result.status,200);return result.json();};
    const before=await read('/api/me/cosmetics'),inventoryBefore=await read('/api/me/cosmetics/inventory');
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});context.setDefaultTimeout(20000);
    await context.addInitScript(({origin,auth})=>{if(location.origin!==origin||sessionStorage.getItem('store-journey'))return;const prefix=`maydan:environment:${encodeURIComponent(origin)}:account:`;localStorage.setItem(prefix+'session',JSON.stringify(auth.session.token));localStorage.setItem(prefix+'me',JSON.stringify({data:auth.me,fetchedAt:Date.now()}));localStorage.setItem('maydan:platform:settings',JSON.stringify({uiLocale:'en',soundOn:false,musicOn:false,reducedMotion:true,splashSeen:true}));sessionStorage.setItem('store-journey','1');},{origin,auth});
    const page=await context.newPage(),errors=[],writes=[],outside=[];page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(['data:','blob:'].includes(u.protocol)||u.origin===origin)return route.continue();outside.push(u.origin);return route.abort();});
    page.on('request',request=>{if(request.method()!=='GET'&&request.url().includes('/api/me/cosmetics'))writes.push({path:new URL(request.url()).pathname,body:request.postDataJSON()});});
    try{
      await page.goto(origin+'/#/store');await page.locator('[data-design-id="store-product"]').first().waitFor();
      const item=scenario==='owned'?'sahra.frame':before.effective.frameId==='artist.frame'?'noir.frame':'artist.frame';
      const card=page.locator(`[data-item-id="${item}"]`);
      if(scenario==='owned'){
        assert.equal(before.plusActive,false);await card.locator('.owned').waitFor();
        if(before.effective.frameId===item){await page.locator('[data-design-id="store-reset"]').click();await page.waitForResponse(r=>r.request().method()==='GET'&&r.url().endsWith('/api/me/cosmetics/inventory'));}
      }
      const mutationCount=writes.length,previewBefore=await read('/api/me/cosmetics');
      await card.locator('[data-design-id="item-preview"]').click();const dialog=page.getByRole('dialog');await dialog.waitFor();
      assert.equal(writes.length,mutationCount,'preview must not mutate');const previewAfter=await read('/api/me/cosmetics');for(const field of ['revision','preferred','effective','grants'])assert.deepEqual(previewAfter[field],previewBefore[field]);
      const saved=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith('/api/me/cosmetics'));
      await dialog.locator('[data-design-id="item-use"]').click();const accepted=await saved;assert.equal(accepted.status(),200);const patched=await accepted.json();assert.equal(patched.effective.frameId,item);
      await dialog.getByRole('button',{name:'Equipped',exact:true}).waitFor();
      await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'});
      await page.locator('[data-design-id="store-tab-library"]').click();await card.locator('[data-design-id="item-use"]').waitFor();
      assert.equal(await card.locator('[data-design-id="item-use"]').isDisabled(),true);assert.match(await card.getAttribute('class'),/is-equipped/);
      const after=await read('/api/me/cosmetics'),inventoryAfter=await read('/api/me/cosmetics/inventory');assert.equal(after.preferred.frameId,item);assert.equal(after.effective.frameId,item);
      assert.deepEqual(inventoryAfter.ownedItemIds,inventoryBefore.ownedItemIds,'equipping must not mint or remove permanent ownership');
      await page.reload();await page.locator(`[data-item-id="${item}"].is-equipped`).waitFor();
      assert.deepEqual(writes.at(-1).body.selection,{frameId:item});assert.ok(writes.every(w=>w.path==='/api/me/cosmetics'));assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
      await page.screenshot({path:path.join(output,`${engineName}-${scenario}-equipped.png`)});
      report.push({engine:engineName,scenario,previewReadOnly:true,equipped:item,serverReadback:true,ownershipPreserved:true,reloadPreserved:true,pageErrors:0,checkoutRequests:0});
    }catch(error){console.error({engineName,scenario,errors,buttons:await page.locator('button:visible').allTextContents(),alerts:await page.locator('[role="alert"]:visible').allTextContents()});throw error;}
    finally{await context.close();}
  }}finally{await browser.close();}
}
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
