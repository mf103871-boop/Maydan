import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { GAMEPLAY_ENTRY_OFFERS } from '../src/shared/account/gameplay-policy.mjs';

// Actual Home, entry gate, RewardedOffer and Online directory components.
// The account/ad provider is an explicit local fixture: no Google request,
// server ticket settlement, native ad display or external account is involved.
test('Chromium/WebKit: card entry is read-only, opt-in, owner-safe and keeps free joining/recovery', {timeout:120000}, async()=>{
  let bundle;
  const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>';
  const traffic=[];
  const server=createServer((req,res)=>{
    traffic.push({method:req.method,url:req.url});
    if(req.url.startsWith('/api/')){res.setHeader('content-type','application/json');res.end(JSON.stringify({enabled:true,rooms:[],capabilities:{}}));return;}
    res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/bundle.js'?bundle:html);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{Home}from'./src/platform/screens/Home.jsx';import{GameEntry}from'./src/platform/screens/GameEntry.jsx';
    import{Entry}from'./src/online/Online.jsx';import{useRoute,navigate,back}from'./src/platform/router.js';
    import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';
    import{gameplayEntryOffer,ENTRY_POLICY}from'./src/shared/account/gameplay-policy.mjs';
    import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import platform from'./src/platform/platform.css';
    const noop=()=>{};const f=window.fixture={owner:'owner-a',premium:false,guestAccess:'trial',states:{},requests:[],attempts:0,ads:0,adResult:'rewarded',pending:[],delayOwner:null,error:false};
    const result=game=>{const offer=gameplayEntryOffer(game);return{game,offer:offer.id,policy:ENTRY_POLICY,group:'B',adsAvailable:true,attempt:null,access:'required',entryAccess:'required',modeAccess:Object.fromEntries(offer.modes.map(mode=>[mode,'required'])),...f.states[game]};};
    window.setFixture=patch=>{Object.assign(f,patch);window.repaint();};window.go=navigate;window.backGame=back;
    window.maydanRewardedLab=async()=>{f.ads++;if(f.adResult==='rewarded'){const game=f.lastGame,offer=gameplayEntryOffer(game);f.states[game]={access:'ticket',entryAccess:'ticket',modeAccess:Object.fromEntries(offer.modes.map(mode=>[mode,'ticket']))};}return{state:f.adResult,presented:true};};
    function App(){const[tick,setTick]=useState(0);window.repaint=()=>setTick(x=>x+1);const route=useRoute(),owner=f.owner;
      const account={...NULL_ACCOUNT,ready:true,signedIn:!!owner,user:owner?{id:owner,name:owner}:null,premium:f.premium,gameplayPolicy:ENTRY_POLICY,gameAccess:()=>f.guestAccess,
        authHeaders:()=>({}),openPaywall:()=>{f.paywall=true;},requestAuthenticated:async(path,options={})=>{
          f.requests.push({owner,path,options});if(path.startsWith('/api/rewarded/entry-status?')){const game=new URLSearchParams(path.split('?')[1]).get('game');f.lastGame=game;const value=structuredClone(result(game));if(f.delayOwner===owner)return new Promise(resolve=>f.pending.push(()=>resolve(value)));if(f.error)throw Error('local fixture offline');return value;}
          if(path==='/api/rewarded/attempt'){f.attempts++;f.lastGame=options.body.offer.replace('-entry-v2','');return{mode:'simulation',attemptId:'fixture-attempt',customData:'opaque-local-fixture-token'};}throw Error('Unexpected fixture account request');}};
      return <AccountContext.Provider value={account}><PlatformContext.Provider value={{sound:{play:noop,music:{scene:noop,releaseScene:noop}},haptics:{vibrate:noop},toast:noop,version:'entry-fixture'}}><style>{tokens+ui+platform}</style>
        {route.name==='home'?<Home/>:route.name==='game-entry'?<GameEntry id={route.params.id}/>:route.name==='online'?<Entry key={route.params.id+':'+route.params.joinOnly} initialGame={route.params.id} joinOnly={route.params.joinOnly==='1'} onJoined={noop}/>:<output data-testid="destination">{route.name+':'+route.params.id}</output>}
      </PlatformContext.Provider></AccountContext.Provider>;}
    createRoot(document.getElementById('root')).render(<App/>);`;
  try{
    const built=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',logLevel:'silent',
      loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl','.mp3':'dataurl'},define:{__MAYDAN_ROOMS_URL__:JSON.stringify(origin),__MAYDAN_REWARDED_SIMULATION__:'true',__MAYDAN_AUDIO_PREVIEW__:'false'}});
    bundle=built.outputFiles[0].contents;
    for(const [name,engine]of [['chromium',chromium],['webkit',webkit]]){
      const browser=await engine.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[],external=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin)||url.startsWith('data:'))return route.continue();external.push(url);return route.abort();});
      const home=async()=>{await page.evaluate(()=>window.go('/'));await page.locator('.home-game-row').first().waitFor();};
      const configure=patch=>page.evaluate(p=>window.setFixture(p),patch);
      const click=game=>page.locator('[data-design-id="game-card.'+game+'"]').click();
      const gate=()=>page.locator('[data-maydan-game-entry]');
      const state=(access,modes)=>({access,entryAccess:access,modeAccess:Object.fromEntries(modes.map(mode=>[mode,access]))});
      try{
        await page.goto(origin);await page.waitForFunction(()=>typeof window.setFixture==='function');
        for(const {game}of GAMEPLAY_ENTRY_OFFERS){await click(game);await gate().waitFor();await page.getByRole('button',{name:'شاهد إعلان والعب مباراة كاملة',exact:true}).waitFor();
          await page.getByText('تحتاج تذكرة لبدء مباراة جديدة في هذه اللعبة.',{exact:true}).waitFor();
          assert.equal(await page.getByRole('dialog').count(),0,name+': gate precedes mode picker');
          assert.equal(await page.evaluate(()=>fixture.attempts),0,'entering never auto-requests an ad');
          await page.getByRole('button',{name:'رجوع',exact:true}).click();await page.locator('.home-game-row').first().waitFor();}
        assert.equal(await page.evaluate(()=>fixture.requests.filter(r=>r.path.includes('local-start')).length),0);
        assert.ok(await page.evaluate(()=>fixture.requests.filter(r=>r.path.includes('entry-status')).every(r=>r.options.gameplayCapability===2)));

        await configure({owner:null,guestAccess:'trial'});await click('beep');await page.getByRole('dialog').waitFor();
        assert.equal(await gate().count(),0,'unused anonymous trial keeps immediate mode selection');
        await page.getByRole('dialog').getByRole('button',{name:'إغلاق',exact:true}).click();
        const guestReads=await page.evaluate(()=>fixture.requests.length),guestAttempts=await page.evaluate(()=>fixture.attempts);
        await configure({guestAccess:'locked'});await click('beep');await gate().waitFor();
        await page.getByRole('button',{name:'تسجيل الدخول للتجربة',exact:true}).waitFor();
        assert.equal(await page.getByRole('dialog').count(),0,'spent anonymous trial is gated before mode selection');
        assert.equal(await page.evaluate(()=>fixture.requests.length),guestReads,'anonymous entry never sends an authenticated status request');
        assert.equal(await page.evaluate(()=>fixture.attempts),guestAttempts,'anonymous entry never automatically requests an ad');
        await page.getByRole('button',{name:'تسجيل الدخول للتجربة',exact:true}).click();
        const signin=page.getByRole('dialog',{name:'تسجيل الدخول',exact:true});await signin.waitFor();
        assert.equal(await signin.getByRole('button',{name:'المتابعة بحساب Google',exact:true}).count(),1,'the real sign-in sheet is available');
        await signin.getByRole('button',{name:'إغلاق',exact:true}).click();
        await home();await click('badeeha');await page.getByRole('button',{name:'انضم إلى غرفة',exact:true}).click();
        await page.locator('.online-directory-heading').waitFor();await page.locator('[data-design-id="entry-join"]').click();
        await page.locator('[data-design-id="room-code"]').waitFor();
        assert.equal(await page.locator('[data-design-id="entry-create"]').count(),0,'spent guest still reaches free code joining, never host setup');
        await home();await configure({owner:'owner-a',guestAccess:'trial'});

        await configure({premium:true});await click('badeeha');await page.getByRole('dialog').waitFor();
        assert.equal(await gate().count(),0,'Plus retains immediate mode selection');await page.getByRole('dialog').getByRole('button',{name:'إغلاق',exact:true}).click();
        await configure({premium:false,states:{badeeha:state('trial',['local','online'])}});
        await click('badeeha');await page.getByRole('dialog').waitFor();
        await page.getByRole('dialog').locator('[data-design-id="local-mode"]').click();await page.locator('[data-testid="destination"]').waitFor();
        assert.ok(page.url().endsWith('#/game/badeeha?mode=local'));
        assert.equal(await page.evaluate(()=>fixture.requests.filter(r=>r.path.includes('local-start')).length),0,'setup navigation does not consume the trial');
        await page.goBack();await page.getByRole('dialog').waitFor();await page.evaluate(()=>window.backGame());await page.locator('.home-game-row').first().waitFor();

        await configure({states:{},adResult:'rewarded'});await click('mafia');await page.getByRole('button',{name:'شاهد إعلان والعب مباراة كاملة',exact:true}).click();
        await page.getByRole('button',{name:'اختر طريقة اللعب',exact:true}).waitFor();
        assert.equal(await page.getByRole('dialog').count(),0,'earned ticket waits for an explicit mode choice');
        assert.equal(await page.evaluate(()=>fixture.attempts),1);assert.equal(await page.evaluate(()=>fixture.ads),1);
        await page.getByRole('button',{name:'اختر طريقة اللعب',exact:true}).click();await page.getByRole('dialog').waitFor();
        await page.getByRole('dialog').getByRole('button',{name:'إغلاق',exact:true}).click();await page.locator('.home-game-row').first().waitFor();

        await configure({states:{badeeha:{access:'ticket',entryAccess:'required',modeAccess:{local:'ticket',online:'required'}}}});
        await click('badeeha');await page.getByRole('dialog').waitFor();await page.getByRole('dialog').locator('[data-design-id="online-mode"]').click();
        await page.getByText('تذكرتك السابقة مخصّصة لنمط آخر.',{exact:false}).waitFor();
        assert.equal(await page.getByRole('dialog').count(),0,'uncovered legacy mode returns to gate without a loop');
        assert.equal(await page.evaluate(()=>fixture.attempts),1,'legacy mode selection never auto-shows another ad');
        await page.getByRole('button',{name:'شاهد إعلان والعب مباراة كاملة',exact:true}).click();await page.getByRole('button',{name:'اختر طريقة اللعب',exact:true}).waitFor();
        await home();

        await configure({states:{},adResult:'skipped'});await click('beep');await page.getByRole('button',{name:'شاهد إعلان والعب مباراة كاملة',exact:true}).click();
        await page.getByText('أُغلق الإعلان قبل اكتماله، ولم تُمنح تذكرة.',{exact:false}).waitFor();
        assert.equal(await page.getByRole('button',{name:'اختر طريقة اللعب',exact:true}).count(),0);await home();

        await configure({owner:'owner-a',delayOwner:'owner-a',states:{beep:state('trial',['local'])}});await click('beep');
        await page.waitForFunction(()=>fixture.pending.length>0);await configure({owner:'owner-b',delayOwner:null,states:{}});
        await page.getByRole('button',{name:'شاهد إعلان والعب مباراة كاملة',exact:true}).waitFor();await page.evaluate(()=>fixture.pending.splice(0).forEach(resolve=>resolve()));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.equal(await page.getByRole('dialog').count(),0,'old-owner response cannot open the new-owner picker');await home();

        await click('mafia');await page.getByRole('button',{name:'انضم إلى غرفة',exact:true}).click();
        await page.locator('.mafia-directory-title').waitFor();
        assert.equal(await page.locator('[data-design-id="create-public-room"],[data-design-id="entry-create"]').count(),0,'join-only has no hosting action');
        await page.locator('[data-design-id="entry-join"]').click();await page.locator('[data-design-id="room-code"]').waitFor();
        assert.equal(await page.locator('[data-design-id="entry-create"]').count(),0);await home();

        await page.route('**/api/online/rooms/public?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:false,rooms:[]})}));
        for(const game of ['badeeha','fabraka','meenfina','ersomha']){
          await click(game);await page.getByRole('button',{name:'انضم إلى غرفة',exact:true}).click();
          await page.locator('[data-design-id="room-code"]').waitFor();
          assert.equal(await page.locator('[data-design-id="create-public-room"],[data-design-id="entry-create"],.online-public-create').count(),0,
            game+': switched-off list goes to join-by-code, never host setup');await home();
        }
        await page.unroute('**/api/online/rooms/public?*');

        await page.evaluate(()=>{const g={version:1,owner:'owner-b',offer:'beep-local',matchId:'offline-current-match',source:'ticket'};
          const prefix='maydan:environment:'+encodeURIComponent(location.origin)+':gameplay:beep:';
          localStorage.setItem(prefix+'match:'+g.matchId,JSON.stringify(g));localStorage.setItem('maydan:beep:session-v1',JSON.stringify({profileSession:{gameplayAccess:g}}));});
        await configure({error:true,states:{}});await click('beep');await page.getByRole('button',{name:'متابعة المباراة المحلية',exact:true}).waitFor();
        for(const [width,height]of [[320,640],[390,844],[844,390]]){await page.setViewportSize({width,height});
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+': entry layout has no horizontal overflow');
          const box=await page.getByRole('button',{name:'متابعة المباراة المحلية',exact:true}).boundingBox();assert.ok(box.height>=44);}
        await page.getByRole('button',{name:'متابعة المباراة المحلية',exact:true}).click();await page.locator('[data-testid="destination"]').waitFor();
        assert.ok(page.url().endsWith('#/play/beep?mode=local'));
        assert.equal(await page.evaluate(()=>fixture.requests.filter(r=>r.path.includes('local-start')).length),0);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        assert.deepEqual(errors,[],name+': page errors');assert.deepEqual(external,[],name+': test stays local');
      }finally{await browser.close();}
    }
    assert.equal(traffic.filter(r=>r.method==='POST').length,0,'directory/entry never creates a room automatically');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
