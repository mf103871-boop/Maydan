// Real local UI controls and normal transitions. No reducer injection or clock acceleration.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const origin=process.env.UI_REVIEW_ORIGIN||'http://127.0.0.1:4192';assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const output=path.resolve('.cache/english-local-games');await mkdir(output,{recursive:true});
const authResponse=await fetch(origin+'/__plus_lab__/scenario',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({scenario:'plus'})});assert.equal(authResponse.status,200);const auth=await authResponse.json();assert.equal(auth.localOnly,true);
const browser=await chromium.launch({headless:true}),report=[];
const games=process.env.E2E_GAMES?.split(',')||['beep','jabeen','meenfina','fabraka','mamnoo'];assert.ok(games.every(game=>['beep','jabeen','meenfina','fabraka','mamnoo'].includes(game)));
try{for(const game of games){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});context.setDefaultTimeout(20000);
  await context.addInitScript(({origin,auth})=>{if(location.origin!==origin||sessionStorage.getItem('local-game-journey'))return;const prefix=`maydan:environment:${encodeURIComponent(origin)}:account:`;localStorage.setItem(prefix+'session',JSON.stringify(auth.session.token));localStorage.setItem(prefix+'me',JSON.stringify({data:auth.me,fetchedAt:Date.now()}));localStorage.setItem('maydan:platform:settings',JSON.stringify({uiLocale:'en',soundOn:false,musicOn:false,reducedMotion:true,splashSeen:true}));sessionStorage.setItem('local-game-journey','1');},{origin,auth});
  const page=await context.newPage(),errors=[],packs=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const file=new URL(request.url()).pathname;if(/\/locale-en-[a-z]+-[A-Z0-9]+\.json$/.test(file))packs.push(file);});
  const select=id=>page.locator(`[data-design-id="${id}"]:visible`),phase=async()=>page.locator(`[data-design-screen^="${game}."]:visible`).last().getAttribute('data-design-screen');
  const english=async locator=>assert.doesNotMatch(await locator.innerText(),/[\u0600-\u06ff]/u,'English match must draw English authored content');
  const click=async id=>{await select(id).last().click();};
  try{
    await page.goto(origin+`/#/play/${game}?mode=local`);await page.locator('#local-content-locale').waitFor();await page.locator('#local-content-locale').selectOption('en');await page.locator(`[data-design-screen="setup.${game}"]`).waitFor();
    if(game==='mamnoo'){for(const [index,name]of ['Blue Team','Gold Team'].entries())await select('team-name').nth(index).fill(name);}
    else{for(const name of ['Mira','Omar','Sam']){await page.locator('[data-design-id="players-setup"] [data-design-id="add-player"]').click();const dialog=page.getByRole('dialog');await dialog.locator('[data-design-id="name-input"]').fill(name);await dialog.locator('[data-design-id="add-player"]').click();await dialog.waitFor({state:'hidden'});}}
    const rounds=select('setting-rounds');if(await rounds.count())await rounds.locator('button').first().click();
    if(game==='mamnoo')await select('setting-duration').locator('button').first().click();
    if(game==='jabeen')await page.locator('[data-design-screen="setup.jabeen"] .segment').first().locator('button').last().click();
    if(game==='fabraka'){await page.locator('.fab-pacing > summary').click();await select('setting-write-time').locator('button').first().click();await select('setting-discussion-time').locator('button').first().click();}
    await click('start');
    let steps=0,englishCards=0;
    while(!(await phase()).endsWith('.over')){
      assert.ok(++steps<180,'normal transitions must finish within a bounded number of UI actions');const state=await phase();
      if(game==='beep'){
        if(state.endsWith('.intro'))await click('start');
        else if(state.endsWith('.prompt')){await english(select('prompt'));englishCards++;await click('continue');}
        else if(state.endsWith('.judge'))await click('correct');
        else throw Error('Unexpected beep phase: '+state);
      }else if(game==='jabeen'){
        if(state.endsWith('.intro'))await click('start');
        else if(state.endsWith('.play')){if(await select('rotate').count())await click('continue');await english(select('word'));englishCards++;await click('correct');await click('continue');}
        else if(state.endsWith('.review'))await click('continue');
        else throw Error('Unexpected jabeen phase: '+state);
      }else if(game==='meenfina'){
        if(state.endsWith('.intro'))await click('start');
        else if(state.endsWith('.countdown'))await page.locator('[data-design-screen="meenfina.local.pick"]').waitFor();
        else if(state.endsWith('.pick')){await english(select('question'));englishCards++;await select('option').first().click();await click('submit');}
        else if(state.endsWith('.result'))await click('continue');
        else throw Error('Unexpected meenfina phase: '+state);
      }else if(game==='mamnoo'){
        if(state.endsWith('.intro'))await click('start');
        else if(state.endsWith('.play')){await english(select('word'));await english(select('options-list'));englishCards++;await click('correct');await click('skip');await click('wrong');await page.locator('[data-design-screen="mamnoo.roundEnd"]').waitFor({timeout:55000});}
        else if(state.endsWith('.roundEnd'))await click('continue');
        else throw Error('Unexpected mamnoo phase: '+state);
      }else{
        if(state.endsWith('.intro'))await click('start');
        else if(state.endsWith('.question')){await english(select('question'));englishCards++;await click('continue');}
        else if(state.endsWith('.write')){if(await select('privacy').count())await click('continue');else{await select('answer-input').fill(String(99900+steps));await click('submit');}}
        else if(state.endsWith('.vote')){if(await select('privacy').count())await click('continue');else{await page.locator('button.fab-opt:enabled').first().click();await click('submit');}}
        else if(state.endsWith('.discussion')||state.endsWith('.gather')||state.endsWith('.roundEnd'))await click('continue');
        else if(state.endsWith('.reveal'))await click('reveal');
        else throw Error('Unexpected fabraka phase: '+state);
      }
    }
    await select('podium').waitFor();assert.ok(englishCards>0);assert.ok(packs.some(file=>file.includes(`locale-en-${game}-`)));assert.deepEqual(errors,[]);
    assert.equal(await page.locator('#local-content-locale').count(),0,'results must not re-key a new match by changing content language outside Start');
    await page.screenshot({path:path.join(output,`${game}-english-completed.png`)});
    await click('options');await page.locator('#local-content-locale').waitFor();await page.locator('#local-content-locale').selectOption('ar');await page.locator(`[data-design-screen="setup.${game}"]`).waitFor();assert.equal(await page.locator(`[data-design-screen^="${game}."]`).count(),0,'changing content is permitted only in setup before the normal Start path');
    report.push({game,engine:'chromium',englishCards,normalUiSteps:steps,completed:true,pageErrors:0,acceleratedTimers:false,languageChangeRequiresSetup:true});await writeFile(path.join(output,`${game}-report.json`),JSON.stringify(report.at(-1),null,2));console.log(JSON.stringify(report.at(-1)));
  }catch(error){console.error({game,errors,phase:await phase().catch(()=>null),buttons:await page.locator('button:visible').allTextContents(),alerts:await page.locator('[role="alert"]:visible').allTextContents()});await page.screenshot({path:path.join(output,`${game}-failure.png`)});throw error;}
  finally{await context.close();}
}}finally{await browser.close();}
await writeFile(path.join(output,`report-${games.join('-')}.json`),JSON.stringify(report,null,2));
