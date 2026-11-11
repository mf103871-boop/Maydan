// Browser acceptance against the running loopback lab and its real local APIs.
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin='http://127.0.0.1:4182';
const out=path.resolve(process.argv[2]||'.cache/plus-live-review');
await mkdir(out,{recursive:true});
const checks=[],external=new Set(),errors=[];
const record=(name,details={})=>checks.push({name,...details});
for(const [engineName,engine]of [['chromium',chromium],['webkit',webkit]]) {
  const browser=await engine.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1180},reducedMotion:'reduce'});
    page.on('pageerror',error=>errors.push({engine:engineName,message:error.message}));
    page.on('request',request=>{const url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin)external.add(url.origin);});
    await page.goto(origin+'/plus-lab/');
    const app=page.frameLocator('#app');
    await app.locator('.store-hero').waitFor();
    const api=async(pathname)=>{
      const token=await page.evaluate(()=>JSON.parse(localStorage.getItem(`maydan:environment:${encodeURIComponent(location.origin)}:account:session`)));
      const response=await page.request.get(origin+pathname,{headers:{origin,authorization:`Bearer ${token}`}});
      assert.equal(response.status(),200,pathname);return response.json();
    };
    async function scenario(id) {
      const label={free:'مجاني',plus:'بلس فعّال',owned:'مقتنيات دائمة',expired:'بلس منتهي',annual:'اشتراك سنوي',refunded:'بعد الاسترداد'}[id];
      const navigation=page.waitForEvent('framenavigated',{predicate:frame=>!!frame.parentFrame()&&frame.url().startsWith(origin+'/#')});
      await page.getByRole('button',{name:label,exact:true}).click();await navigation;
      await app.locator('.store-hero').waitFor();
      await app.locator('.store-v2-notice.error').waitFor({state:'hidden'});
    }
    await page.locator('#app').screenshot({path:path.join(out,engineName+'-store.png')});
    const before=await api('/api/me/cosmetics/inventory');
    await app.locator('[data-design-id="collection-preview"]').click();
    await app.getByRole('dialog').waitFor();
    await app.locator('[data-name-card="sahra.nameColor"] bdi').first().waitFor();
    const ink=await app.locator('[data-name-card="sahra.nameColor"] bdi').first().evaluate(node=>getComputedStyle(node).color);
    assert.equal(ink,'rgb(48, 32, 63)');
    assert.equal((await api('/api/me/cosmetics/inventory')).revision,before.revision,'preview cannot equip');
    await page.locator('#app').screenshot({path:path.join(out,engineName+'-profile-preview.png')});
    for(const name of ['مقعد اللعب','الدردشة','بروفايلي']) {
      await app.getByRole('tab',{name,exact:true}).click();
      await app.getByRole('tabpanel').waitFor();
    }
    record(engineName+': original art in all three real preview surfaces; dark cream-card ink; preview leaves preferences unchanged');
    await app.getByRole('button',{name:'إغلاق',exact:true}).click();
    for(const [width,height]of [[320,740],[390,844],[430,900],[844,390]]) {
      await page.locator('#app').evaluate((node,size)=>{node.style.width=size[0]+'px';node.style.height=size[1]+'px';},[width,height]);
      const overflow=await app.locator('html').evaluate(node=>node.scrollWidth>node.clientWidth+1);
      assert.equal(overflow,false,`${engineName}:${width}`);
    }
    await page.locator('#app').evaluate(node=>{node.style.width='390px';node.style.height='844px';});
    record(engineName+': 320/390/430/844px without horizontal overflow');
    await scenario('owned');
    const owned=await api('/api/me/cosmetics/inventory');
    assert.equal(owned.plusActive,false);assert.equal(owned.ownedItemIds.length,6);assert.equal(owned.effective.badge,false);
    await page.getByRole('button',{name:'بروفايلي',exact:true}).click();
    await app.locator('[data-design-screen="profile"]').waitFor();
    assert.equal(await app.locator('.player-membership-badge').count(),0);
    await page.locator('#app').screenshot({path:path.join(out,engineName+'-owned-profile.png')});
    record(engineName+': permanent full outfit without Plus or membership badge');
    await page.getByRole('button',{name:'المتجر',exact:true}).click();await app.locator('.store-hero').waitFor();
    await scenario('expired');
    const expired=await api('/api/me/cosmetics/inventory');
    assert.equal(expired.plusActive,false);assert.ok(expired.ownedItemIds.includes('sahra.frame'));assert.equal(expired.effective.frameId,'sahra.frame');assert.equal(expired.effective.badge,false);
    record(engineName+': paid-period keepsake survives expired Plus, without its badge');
    await scenario('annual');
    const annual=await api('/api/me/cosmetics/inventory');
    assert.equal(annual.monthly.windows.length,12);
    assert.equal(annual.monthly.windows.filter(window=>window.status==='granted').length,1);
    record(engineName+': annual has 12 anchored windows and only the due month granted');
    await scenario('free');
    const initialFree=await api('/api/me/cosmetics/inventory');
    const purchaseCollection=engineName==='chromium'?'sahra':'artist';
    const purchaseLabel=engineName==='chromium'?'سهرة ميدان':'رسّام الشلّة';
    await app.locator('[data-design-id="collection"]').filter({hasText:purchaseLabel}).click();
    await app.locator(`[data-item-id="${purchaseCollection}.frame"] [data-design-id="item-preview"]`).click();
    await app.locator('[data-design-id="permanent-quote"]').click();
    await app.locator('[data-design-id="test-checkout-confirm"]').waitFor();
    await app.locator('[data-design-id="test-checkout-confirm"]').click();
    await app.getByText('اكتمل الاقتناء المحلي التجريبي.',{exact:false}).first().waitFor();
    assert.equal((await api('/api/me/cosmetics/inventory')).ownedItemIds.length,initialFree.ownedItemIds.length+1);
    await app.getByRole('button',{name:'إغلاق',exact:true}).click();
    await app.locator('[data-design-id="collection-preview"]').click();
    const quoteResponse=page.waitForResponse(response=>response.url()===origin+'/api/me/cosmetics/quote'&&response.request().method()==='POST');
    await app.locator('[data-design-id="permanent-quote"]').click();
    const quote=await (await quoteResponse).json();
    assert.deepEqual(quote.alreadyOwned,[purchaseCollection+'.frame']);assert.equal(quote.missingItemIds.length,5);assert.equal(quote.pricing.amountMinor,5000);
    await app.locator('[data-design-id="test-checkout-confirm"]').click();
    await app.getByText('اكتمل الاقتناء المحلي التجريبي.',{exact:false}).first().waitFor();
    assert.equal((await api('/api/me/cosmetics/inventory')).ownedItemIds.length,initialFree.ownedItemIds.length+6);
    await app.locator('[data-design-id="collection-use"]').click();
    await app.getByText('حُفظ مظهرك على حسابك.',{exact:false}).first().waitFor();
    assert.equal((await api('/api/me/cosmetics/inventory')).effective.badge,false);
    record(engineName+': real TEST quote/checkout/equip; partial bundle pays for five missing pieces only');
    for(const [button,count]of [['استرداد آخر قطعة',initialFree.ownedItemIds.length+1],['تكرار إشعار الشراء',initialFree.ownedItemIds.length+1]]) {
      await page.getByRole('button',{name:button,exact:true}).click();
      await app.locator('.store-hero').waitFor();
      await page.getByText(`تمت محاكاة «${button}»`,{exact:false}).waitFor();
      assert.equal((await api('/api/me/cosmetics/inventory')).ownedItemIds.length,count);
    }
    record(engineName+': refund revokes only last order; replay cannot reactivate it');
    await scenario('plus');
    await page.screenshot({path:path.join(out,engineName+'-lab.png'),fullPage:true});
  } finally {await browser.close();}
}
assert.deepEqual([...external],[],'review must not contact a live provider');
assert.deepEqual(errors,[],'no uncaught browser errors');
await writeFile(path.join(out,'LIVE-REVIEW.json'),JSON.stringify({localOnly:true,physicalIPhone:false,realPayments:false,checks,external:[...external],browserErrors:errors},null,2));
console.log(JSON.stringify({checks:checks.length,engines:2,external:0,browserErrors:0,output:out}));
