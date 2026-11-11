import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';
import {GAMEPLAY_ENTRY_OFFERS} from '../src/shared/account/gameplay-policy.mjs';

test('Chromium/WebKit: entry eligibility stays explicit, revocable and current across all eight games', {timeout:120000}, async()=>{
  const text=(await readFile('tests/game-entry-browser.test.js','utf8')).replaceAll('\r\n','\n');
  const marker='  const entry=`',start=text.indexOf(marker),end=text.indexOf('`;\n  try{',start);
  assert.ok(start>=0&&end>start);const entry=text.slice(start+marker.length,end);
  const ticketArt=await readFile('public/media/game-entry/match-ticket-v1.webp');
  let bundle;const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>';
  const server=createServer((req,res)=>{if(new URL(req.url,'http://fixture.invalid').pathname==='/media/game-entry/match-ticket-v1.webp'){res.setHeader('content-type','image/webp');res.end(ticketArt);return;}res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/bundle.js'?bundle:html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    const built=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',logLevel:'silent',loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl','.mp3':'dataurl'},define:{__MAYDAN_ROOMS_URL__:JSON.stringify(origin),__MAYDAN_GAMEPLAY_POLICY__:JSON.stringify('game-entry-ticket-v2'),__MAYDAN_REWARDED_SIMULATION__:'true',__MAYDAN_AUDIO_PREVIEW__:'false'}});bundle=built.outputFiles[0].contents;
    const proofs=[];
    for(const [name,engine]of [['chromium',chromium],['webkit',webkit]]){
      const browser=await engine.launch({headless:true});
      try{
        const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());
        const settled=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const configure=patch=>page.evaluate(p=>window.setFixture(p),patch);
        const home=async()=>{await page.evaluate(()=>window.go('/'));await page.locator('.home-game-row').first().waitFor();};
        const state=(access,modes)=>({access,entryAccess:access,modeAccess:Object.fromEntries(modes.map(mode=>[mode,access]))});
        const choose=()=>page.getByRole('button',{name:'اختر طريقة اللعب',exact:true});
        const ad=()=>page.getByRole('button',{name:'شاهد إعلان والعب مباراة كاملة',exact:true});
        await page.goto(origin);await page.waitForFunction(()=>typeof window.setFixture==='function');
        await page.evaluate(()=>{window.setFixture({policy:null,billing:null,ready:true});window.go('/entry/beep');});
        await page.locator('[data-maydan-game-entry]').waitFor();
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const initialPicker=await page.getByRole('dialog').count();
        await page.evaluate(()=>window.setFixture({policy:'game-entry-ticket-v2',states:{}}));
        await page.getByRole('button',{name:'شاهد إعلان والعب مباراة كاملة',exact:true}).waitFor();
        const afterV2Picker=await page.getByRole('dialog').count();
        proofs.push({name,initialPicker,afterV2Picker});
        await page.waitForFunction(()=>document.querySelector('.rewarded-entry-art img')?.naturalWidth>0);
        for(const {game,modes}of GAMEPLAY_ENTRY_OFFERS){
          await home();await configure({policy:'game-entry-ticket-v2',billing:null,ready:true,premium:false,states:{[game]:state('trial',modes)}});
          await page.locator('[data-design-id="game-card.'+game+'"]').click();await choose().waitFor();await settled();
          assert.equal(await page.getByRole('dialog').count(),0,name+': '+game+' trial waits for explicit Continue');
          await choose().click();await page.getByRole('dialog').waitFor();
          await configure({states:{}});await page.getByRole('dialog').locator('[data-design-id="'+modes[0]+'-mode"]').click();
          await ad().waitFor();assert.equal(await page.getByRole('dialog').count(),0,name+': '+game+' revoked access closes the picker');
          assert.ok(page.url().includes('#/entry/'+game));assert.equal(await page.locator('[data-testid="destination"]').count(),0);
        }
        assert.equal(await page.evaluate(()=>fixture.attempts),0,'status/selection/return never auto-shows an ad');

        await home();await configure({states:{beep:state('ticket',['local'])}});await page.locator('[data-design-id="game-card.beep"]').click();
        await choose().click();await page.getByRole('dialog').waitFor();
        const reads=await page.evaluate(()=>fixture.requests.length);await page.evaluate(()=>{fixture.states={};window.dispatchEvent(new Event('focus'));});
        await ad().waitFor();assert.equal(await page.getByRole('dialog').count(),0,'foreground invalidates open eligibility');
        assert.ok(await page.evaluate(previous=>fixture.requests.length>previous,reads));

        // Latest issued read wins in either completion order, not whichever
        // response happens to arrive last from the network.
        for(const [oldAccess,newAccess]of [['ticket','required'],['required','ticket']]){
          await home();await configure({delayOwner:'owner-a',states:{beep:state(oldAccess,['local'])}});
          await page.locator('[data-design-id="game-card.beep"]').click();await page.waitForFunction(()=>fixture.pending.length>0);
          await configure({delayOwner:null,states:{beep:state(newAccess,['local'])}});
          await page.getByRole('button',{name:'تحقّق من تذكرتي',exact:true}).click();
          if(newAccess==='ticket')await choose().waitFor();else await ad().waitFor();
          await page.evaluate(()=>fixture.pending.splice(0).forEach(resolve=>resolve()));await settled();
          assert.equal(await choose().count(),newAccess==='ticket'?1:0,'late '+oldAccess+' cannot replace newer '+newAccess);
          assert.equal(await page.getByRole('dialog').count(),0,'late eligibility never navigates automatically');
        }

        await home();await configure({delayOwner:null,states:{beep:state('ticket',['local'])}});await page.locator('[data-design-id="game-card.beep"]').click();await choose().click();
        await configure({delayOwner:'owner-a'});await page.getByRole('dialog').locator('[data-design-id="local-mode"]').click();await page.waitForFunction(()=>fixture.pending.length===1);
        await configure({delayOwner:null});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await choose().waitFor();await choose().click();
        await configure({delayOwner:'owner-a'});await page.getByRole('dialog').locator('[data-design-id="local-mode"]').click();await page.waitForFunction(()=>fixture.pending.length===2);
        await page.evaluate(()=>fixture.pending.shift()());await settled();
        assert.equal(await page.getByRole('dialog').locator('[data-design-id="local-mode"]').isDisabled(),true,'an older select cannot unlock the newer generation');
        await page.evaluate(()=>{fixture.delayOwner=null;fixture.pending.splice(0).forEach(resolve=>resolve());});await page.locator('[data-testid="destination"]').waitFor();

        await home();await configure({premium:true,states:{}});await page.locator('[data-design-id="game-card.beep"]').click();await page.getByRole('dialog').waitFor();
        await configure({premium:false});await ad().waitFor();assert.equal(await page.getByRole('dialog').count(),0,'cached Plus picker closes after expiry');
        await configure({ready:false});await page.getByText('جارٍ التحقق من أهلية المباراة…',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);
        await configure({ready:true,states:{beep:state('trial',['local'])}});await choose().waitFor();assert.equal(await page.getByRole('dialog').count(),0);

        await home();await configure({states:{},holdAd:true,adResult:'rewarded'});await page.locator('[data-design-id="game-card.beep"]').click();await ad().click();
        await page.waitForFunction(()=>fixture.adPending.length===1);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        await page.evaluate(()=>{fixture.holdAd=false;fixture.adPending.splice(0).forEach(resolve=>resolve());});await choose().waitFor();await settled();
        assert.equal(await page.getByRole('dialog').count(),0,'ad callback after foreground still waits for Continue');

        await home();await configure({states:{},holdAd:true});await page.locator('[data-design-id="game-card.beep"]').click();await ad().click();
        await page.waitForFunction(()=>fixture.adPending.length===1);await configure({owner:'owner-b',states:{},holdAd:false});
        await ad().waitFor();await page.evaluate(()=>fixture.adPending.splice(0).forEach(resolve=>resolve()));await settled();
        assert.equal(await choose().count(),0,'old-account ad completion cannot grant new-account eligibility');assert.equal(await page.getByRole('dialog').count(),0);

        for(const [width,height]of [[320,640],[390,844],[844,390]]){await page.setViewportSize({width,height});await settled();
          const art=page.locator('.rewarded-entry-art img');assert.ok(await art.evaluate(node=>node.naturalWidth>0));assert.ok(await art.isVisible());
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+': ticket art has no overflow at'+width);}
        await configure({policy:null,billing:{gameplay:{access:'free'}}});await page.getByRole('dialog').waitFor();
        assert.deepEqual(errors,[],name+': browser errors');
      }finally{await browser.close();}
    }
    assert.deepEqual(proofs,[{name:'chromium',initialPicker:0,afterV2Picker:0},{name:'webkit',initialPicker:0,afterV2Picker:0}],
      'null policy must not become free permission or survive v2 denial');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
