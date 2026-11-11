// Ordinary local game entry points, not the separate Rewarded demo URLs.
// Uses loopback mock accounts and simulated ads only; never calls AdMob.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startRewardedPreview } from '../../scripts/rewarded-preview/server.mjs';
import { installSession } from '../../scripts/e2e/plus-session.mjs';
import { TICKET_POLICY } from '../../src/shared/account/gameplay-policy.mjs';

const app = await startRewardedPreview({ port: 4193, apiPort: 8803 });
app.backend.env.GAMEPLAY_ACCESS_POLICY = TICKET_POLICY;
const origin = new URL(app.url).origin;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const claims = async game => (await app.backend.env.DB.prepare('SELECT source,state,match_id FROM rewarded_match_claims WHERE offer=? ORDER BY updated_at,match_id').bind(`${game}-local`).all()).results;
const button = (page, text) => page.getByRole('button', { name: text, exact: true });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const actor = await (await fetch(origin + '/__rewarded_lab__/actor', { method: 'POST', headers: { origin, 'content-type':'application/json' }, body: JSON.stringify({ group:'B' }) })).json();
  await installSession(context,actor.token);
  await context.addInitScript(() => {
    localStorage.setItem('maydan:platform:settings',JSON.stringify({ splashSeen:true,soundOn:false,musicOn:false,hapticsOn:false }));
    localStorage.setItem('maydan:platform:startup-cache-unavailable',JSON.stringify(Date.now()));
    localStorage.setItem('maydan:platform:roster',JSON.stringify(['أول','ثان','ثالث'].map((name,index)=>({id:`p-${index}`,name,emoji:'😎',color:'#663399'}))));
  });
  page = await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
  for (const game of ['beep','mamnoo','jabeen','fabraka','meenfina','badeeha']) {
    const path = origin + '/#/play/' + game;
    await page.goto(path);
    if(game==='beep')await page.route('**/api/rewarded/local-start',async route=>{
      const committed=await route.fetch(); assert.equal(committed.status(),200); await route.abort();
    },{times:1});
    if (game === 'badeeha') {
      await page.locator('.m-category-main').first().waitFor();
      for (const index of [0,1,2,3,4,10]) await page.locator('.m-category-main').nth(index).click();
      await page.locator('.m-sticky-action').click();
      await page.locator('.m-board-grid').waitFor();
    } else {
      await page.locator('[data-design-screen^="play-setup"] [data-design-id="start"]').last().click();
      if(game==='beep') {
        await page.getByText(/قد يكون بدء المباراة تأكد بالفعل/).waitFor();
        await button(page,'تحقّق وابدأ المباراة').click();
      }
      await page.locator('[data-design-screen^="play-setup"]').waitFor({state:'detached'});
    }
    assert.equal((await claims(game)).length,1,game+' spends its first trial only at real start');
    assert.equal((await claims(game))[0].source,'trial');
    await page.reload();
    const resume = button(page,game==='badeeha'?'متابعة':'استئناف اللعبة المحفوظة');
    await resume.click();
    if (game === 'badeeha') await page.locator('.m-board-grid').waitFor();
    else await page.locator('[data-design-screen^="play-setup"]').waitFor({state:'detached'});
    assert.equal((await claims(game)).length,1,game+' resume retains its original full-match claim');
    await page.reload();
    if (game==='badeeha') {
      // Restored setup deliberately starts a fresh board with its selections.
      await page.locator('.m-category-main').first().waitFor();
      for (const index of [0,1,2,3,4,10]) {
        const choice=page.locator('.m-category-main').nth(index);
        if(await choice.getAttribute('aria-pressed')!=='true')await choice.click();
      }
      await page.locator('.m-sticky-action').click();
    } else await page.locator('[data-design-screen^="play-setup"] [data-design-id="start"]').last().click();
    const gate = page.getByRole('region',{name:/بدء مباراة/});
    await gate.waitFor();
    await page.getByText('انتهت التجربة المجانية لهذا التحدّي.',{exact:true}).waitFor();
    assert.equal((await claims(game)).length,1,game+' second match stays gated');
    assert.equal(await page.getByRole('dialog',{name:'إعلان اختباري'}).count(),0,'no automatic ad');
    await button(page,'ارجع للمحتوى المجاني').click();
    await gate.waitFor({state:'detached'});
    console.log('PASS ordinary local '+game+': first full-match trial, saved resume, next-start gate, free exit');
  }
  assert.deepEqual(errors,[]);
} catch(error) {
  console.error(page?.url(),await page?.locator('body').innerText(),errors);
  throw error;
} finally { await browser.close(); await app.close(); }
