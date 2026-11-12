// Full local product journey. Two isolated browser accounts, real local HTTP,
// WebSockets and drawing; no provider audio, production calls or human testers.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const origin=process.env.UI_REVIEW_ORIGIN||'http://127.0.0.1:4192',target=new URL(origin);
assert.ok(target.protocol==='http:'&&['127.0.0.1','localhost'].includes(target.hostname));
const output=path.resolve(process.env.E2E_OUTPUT_DIR||'.cache/playful-studio-journey');await mkdir(output,{recursive:true});
const post=async(route,body)=>{const response=await fetch(origin+route,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200,route);return response.json();};
const engines=process.env.E2E_ENGINE==='webkit'?[['webkit',webkit]]:process.env.E2E_ENGINE==='chromium'?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
const report={scope:'Isolated local product: English Draw It content, separate Arabic/English UI, real room/drawing transport. No real audio or human playtest.',engines:[]};
for(const [name,engine]of engines){
  const browser=await engine.launch({headless:true}),errors=[],external=[],states=[[],[]],contexts=[];
  try{
    for(const index of [0,1]){
      const auth=await post('/__preview__/login',{index:8+index});
      const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});context.setDefaultTimeout(20000);contexts.push(context);
      await context.route('**/*',route=>{const url=new URL(route.request().url());if(['data:','blob:'].includes(url.protocol)||url.origin===origin)return route.continue();external.push(url.origin);return route.abort();});
      await context.addInitScript(({auth,origin,locale})=>{
        if(location.origin!==origin||sessionStorage.getItem('journey-initialized'))return;
        const prefix=`maydan:environment:${encodeURIComponent(origin)}:account:`;
        localStorage.setItem(prefix+'session',JSON.stringify(auth.session.token));localStorage.setItem(prefix+'me',JSON.stringify({data:auth.me,fetchedAt:Date.now()}));
        localStorage.setItem('maydan:platform:settings',JSON.stringify({uiLocale:locale,soundOn:false,musicOn:false,reducedMotion:true,splashSeen:true}));sessionStorage.setItem('journey-initialized','1');
      },{auth,origin,locale:index?'ar':'en'});
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      page.on('websocket',socket=>socket.on('framereceived',event=>{try{const message=JSON.parse(event.payload);if(message.type==='state'&&message.state?.game==='ersomha')states[index].push(message.state);}catch{/* Other channel. */}}));
    }
    const [host,guest]=contexts.map(context=>context.pages()[0]);
    for(const [index,page]of [host,guest].entries()){
      await page.goto(origin+'/#/');await page.locator('button[data-game="ersomha"]').waitFor();
      await page.waitForFunction(locale=>document.documentElement.lang===locale,index?'ar':'en');
      await page.locator('button[data-game="ersomha"]').click();await page.locator('[data-design-id="online-mode"]').click();
      await page.locator('[data-design-id="create-public-room"]').waitFor();
    }
    await host.locator('[data-design-id="create-public-room"]').click();
    await host.locator('select[data-design-id="content-language"] option[value="en"]').waitFor({state:'attached'});
    await host.waitForFunction(()=>!document.querySelector('[data-design-id="content-language"] option[value="en"]').disabled);
    await host.locator('select[data-design-id="content-language"]').selectOption('en');
    await host.locator('[data-design-id="name-input"]').fill('Host EN');
    await host.locator('form [data-design-id="start"]').click();
    await host.locator('[data-design-screen="online.lobby"]').waitFor();
    const code=new URL(host.url()).hash.match(/room\/(\d{6})/)[1];
    await guest.locator('[data-design-id="entry-join"]').click();
    await guest.locator('input[inputmode="numeric"]').fill(code);
    await guest.locator('[data-design-id="name-input"]').fill('Guest AR');
    await guest.locator('form [data-design-id="start"]').click();await guest.locator('[data-design-screen="online.lobby"]').waitFor();
    for(const page of [host,guest]){const ready=page.locator('[data-design-id="ready"]');if(!(await ready.innerText()).includes('✓'))await ready.click();}
    await host.locator('[data-design-screen="online.lobby"] [data-design-id="start"]').click();
    let rounds=0;
    for(const drawerIndex of [0,1]){
      const drawer=drawerIndex?guest:host,guesser=drawerIndex?host:guest;
      const choice=drawer.locator('[data-design-id="word-choice"]').first();await choice.waitFor({timeout:20000});
      const answer=(await choice.locator('strong').innerText()).trim();assert.doesNotMatch(answer,/[\u0600-\u06ff]/u);
      assert.equal(await guesser.locator('[data-design-id="word-choice"]').count(),0);
      const before=states[1-drawerIndex].at(-1);assert.equal(before.contentLocale,'en');assert.equal(before.contentVersion,'new-en');assert.deepEqual(before.myChoices,[]);assert.equal(before.myWord,null);
      await choice.click();await drawer.locator('canvas.ers-board').waitFor();await guesser.locator('[data-design-id="guess-input"]').waitFor();
      assert.ok(!(await guesser.locator('[data-design-id="word-banner"]').innerText()).includes(answer));
      const privateState=states[1-drawerIndex].at(-1);assert.equal(privateState.myWord,null);assert.deepEqual(privateState.myChoices,[]);
      for(const forbidden of ['aliases','conceptId','familyId'])assert.ok(!JSON.stringify(privateState).includes(`"${forbidden}"`));
      // A visible canvas may still be receiving its authoritative initial sync.
      // The clear tool shares the exact draw-blocking condition (no mutation).
      await drawer.waitForFunction(()=>{const button=document.querySelector('[data-design-id="clear"]');return button&&!button.disabled;});
      const canvas=drawer.locator('canvas.ers-board');await canvas.click({trial:true});const box=await canvas.boundingBox();
      await drawer.mouse.move(box.x+box.width*.3,box.y+box.height*.35);await drawer.mouse.down();await drawer.mouse.move(box.x+box.width*.65,box.y+box.height*.65,{steps:8});await drawer.mouse.up();
      await guesser.waitForFunction(()=>{const c=document.querySelector('canvas.ers-board');return c&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0);});
      if(rounds===0)await guesser.screenshot({path:path.join(output,`${name}-arabic-ui-english-content-hidden.png`)});
      await guesser.locator('[data-design-id="guess-input"]').fill(answer);await guesser.locator('[data-design-id="guess-send"]').click();
      await guesser.locator('[data-design-id="results"]').waitFor();assert.equal((await guesser.locator('[data-design-id="word-banner"] strong').innerText()).trim(),answer);
      assert.ok(states.every(list=>list.at(-1).contentLocale==='en'&&list.at(-1).contentVersion==='new-en'));rounds++;
    }
    await host.locator('[data-design-screen="ersomha.over"]').waitFor({timeout:15000});await guest.locator('[data-design-screen="ersomha.over"]').waitFor();
    const finished=states[1].at(-1);assert.equal(finished.phase,'over');assert.equal(finished.cooperative.solvedTurns,2);
    const matchId=finished.matchId;
    // Simulate a saved UI preference being applied on reconnect; match identity
    // must come from the durable room, never the presentation preference.
    await guest.evaluate(()=>{const key='maydan:platform:settings',settings=JSON.parse(localStorage.getItem(key));localStorage.setItem(key,JSON.stringify({...settings,uiLocale:'en'}));});
    await guest.reload();await guest.waitForFunction(()=>document.documentElement.lang==='en');await guest.locator('[data-design-screen="ersomha.over"]').waitFor();
    assert.match((await guest.locator('[data-design-id="topbar"] h1').innerText()).trim(),/^Room \d{6}\s+Draw It$/u);
    assert.equal(states[1].at(-1).matchId,matchId);assert.equal(states[1].at(-1).contentLocale,'en');assert.equal(states[1].at(-1).contentVersion,'new-en');
    await guest.screenshot({path:path.join(output,`${name}-english-ui-restored-result.png`)});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    report.engines.push({engine:name,rounds,contentLocale:'en',contentVersion:'new-en',hostUi:'en',guestUiInitially:'ar',guestUiAfterReconnect:'en',privacy:true,remoteInk:true,durableMatchPreserved:true,pageErrors:errors.length,externalRequests:external.length});
  }catch(error){console.error(JSON.stringify({engine:name,pageErrors:errors,pages:await Promise.all(contexts.map(async(context,index)=>{const page=context.pages()[0];await page.screenshot({path:path.join(output,`${name}-failure-${index}.png`)});return{url:page.url(),buttons:await page.locator('button:visible').allTextContents(),fields:await page.locator('label:visible').allTextContents(),alerts:await page.locator('[role="alert"]:visible').allTextContents()};}))}));throw error;}
  finally{await Promise.all(contexts.map(context=>context.close()));await browser.close();}
}
await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
