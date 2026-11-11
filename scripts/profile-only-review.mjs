// Exercises the real loopback app and account/room APIs with synthetic users.
import {chromium,webkit} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {getCosmetic,subscriptionIncludesKind} from '../src/plus/catalog.js';
const origin='http://127.0.0.1:4182',out=path.resolve(process.argv[2]||'.cache/profile-only-review');
await mkdir(out,{recursive:true});const checks=[],errors=[],external=new Set(),councilRequests=[];
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
  const browser=await engine.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1180}});
  try {
    page.on('pageerror',e=>errors.push({engine:name,message:e.message}));
    page.on('request',request=>{const url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin)external.add(url.origin);if(url.pathname.startsWith('/assets/council/'))councilRequests.push(url.pathname);});
    await page.goto(origin+'/plus-lab/');const app=page.frameLocator('#app');
    const store=()=>app.locator('.store-profile-only');await store().waitFor();
    const api=async route=>{const token=await page.evaluate(()=>JSON.parse(localStorage.getItem(`maydan:environment:${encodeURIComponent(location.origin)}:account:session`)));const r=await page.request.get(origin+route,{headers:{origin,authorization:'Bearer '+token}});assert.equal(r.status(),200,route);return r.json();};
    const size=async(w,h)=>{await page.locator('#app').evaluate((node,[width,height])=>{node.style.width=width+'px';node.style.height=height+'px';},[w,h]);assert.equal(await app.locator('html').evaluate(node=>node.clientWidth),w);};
    const scenario=async label=>{await page.getByRole('button',{name:'المتجر',exact:true}).click();await store().waitFor();const nav=page.waitForEvent('framenavigated',{predicate:f=>!!f.parentFrame()&&f.url().startsWith(origin+'/#')});await page.getByRole('button',{name:label,exact:true}).click();await nav;await store().waitFor();await app.locator('.store-product').first().waitFor();};
    for(const [label,premium] of [['مجاني',false],['بلس فعّال',true],['بلس منتهي',false],['مقتنيات دائمة',false]]) {
      await scenario(label);const inventory=await api('/api/me/cosmetics/inventory');assert.equal(inventory.plusActive,premium);
      const ids=await app.locator('.store-product').evaluateAll(nodes=>nodes.map(node=>node.dataset.itemId));assert.ok(ids.length>1);for(const id of ids)assert.ok(subscriptionIncludesKind(getCosmetic(id)?.kind),id);
      assert.equal(await app.getByRole('tab',{name:'جلساتي',exact:true}).count(),0);
      assert.equal(inventory.effective.councilSkinId,null);
      await page.getByRole('button',{name:'بروفايلي',exact:true}).click();await app.locator('.profile-screen').waitFor();
      assert.equal(await app.locator('.profile-screen').getAttribute('data-profile-skin'),premium?'sahra':'base');
      for(const [w,h] of [[320,740],[390,844],[430,900],[844,390]]){await size(w,h);assert.equal(await app.locator('html').evaluate(node=>node.scrollWidth>node.clientWidth+1),false);}
      await size(390,844);await page.locator('#app').screenshot({path:path.join(out,`${name}-${premium?'plus':label==='مجاني'?'free':label==='مقتنيات دائمة'?'owned':'expired'}-profile.png`)});
      checks.push({engine:name,scenario:label,profileOnlyProducts:ids.length,profile:premium?'sahra':'base',viewports:4});
    }
    await scenario('بلس فعّال');await size(390,844);const before=await api('/api/me/cosmetics/inventory');const profileBefore=(await api('/api/profiles/me')).profile;assert.ok(profileBefore?.id);
    const skin=app.locator('.store-product[data-item-id="sahra.profileSkin"]');await skin.getByRole('button',{name:'معاينة',exact:true}).click();const dialog=app.getByRole('dialog');await dialog.waitFor();assert.equal(await dialog.getByRole('tab').count(),0);assert.equal(await app.locator('.council-scene,.council-compact').count(),0);
    assert.equal((await api('/api/me/cosmetics/inventory')).revision,before.revision);await page.locator('#app').screenshot({path:path.join(out,name+'-profile-preview.png')});await dialog.getByRole('button',{name:'إغلاق',exact:true}).click();
    const frameId=(await app.locator('.store-product').evaluateAll(nodes=>nodes.map(node=>node.dataset.itemId))).find(id=>getCosmetic(id)?.kind==='frame'&&id!==before.effective.frameId);assert.ok(frameId);const frame=app.locator(`.store-product[data-item-id="${frameId}"]`);await frame.getByRole('button',{name:'استخدام',exact:true}).click();await app.locator(`.store-product[data-item-id="${frameId}"].is-equipped`).waitFor();const equipped=await api('/api/me/cosmetics/inventory');assert.equal(equipped.effective.profileSkinId,'sahra.profileSkin');assert.equal(equipped.effective.frameId,frameId);
    const profileAfter=(await api('/api/profiles/me')).profile;assert.equal(profileAfter.id,profileBefore.id);for(const field of ['avatarUrl','avatarPreset','avatarId'])assert.deepEqual(profileAfter[field],profileBefore[field],field);
    checks.push({engine:name,previewDidNotSave:true,independentFrame:true,photoUnchanged:true});
    await scenario('مجاني');await size(390,844);await page.locator('#app').evaluate(node=>{node.src='/#/online/meenfina?mode=online';});await app.locator('[data-design-id=entry-create],[data-design-id=create-public-room]').first().click();await app.getByRole('button',{name:'أنشئ الغرفة',exact:true}).click();await app.locator('.online-connection.connected').waitFor();
    assert.equal(await app.locator('.council-scene,.council-compact,.council-character,.plus-room-atmosphere').count(),0);assert.equal(await app.locator('[data-design-id="room-theme"],[data-design-id="council-skin"]').count(),0);await page.locator('#app').screenshot({path:path.join(out,name+'-restored-room.png')});
    await page.getByRole('button',{name:'المتجر',exact:true}).click();await app.getByRole('dialog').waitFor();await app.getByRole('button',{name:'الخروج',exact:true}).click();await store().waitFor();checks.push({engine:name,freeRoomCreated:true,originalLobby:true,exitGuard:true});
  } catch(error) {await page.screenshot({path:path.join(out,name+'-failure.png')});throw error;}
  finally {await browser.close();}
}
assert.deepEqual(errors,[]);assert.deepEqual([...external],[]);assert.deepEqual(councilRequests,[]);
await writeFile(path.join(out,'PROFILE-ONLY-BROWSER-REVIEW.json'),JSON.stringify({localOnly:true,physicalIPhone:false,liveProviderVoice:false,checks,errors,external:[...external],councilRequests},null,2));console.log(JSON.stringify({checks:checks.length,errors:0,councilRequests:0,out}));
