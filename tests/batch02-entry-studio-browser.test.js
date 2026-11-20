// Actual Home/Details/GameEntry/RewardedOffer/router/navigation; account,
// social presence and rewarded availability are synthetic local fixtures.
// No live account, provider ad, reward settlement or match is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { getNodeDefinition } from '../src/design/registry.js';

const output = process.env.BATCH02_ENTRY_EVIDENCE_DIR || path.resolve('.cache/batch02-entry-studio');
await mkdir(output, { recursive:true });
const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{Home}from'./src/platform/screens/Home.jsx';import{GameDetails}from'./src/platform/screens/GameDetails.jsx';import{GameEntry}from'./src/platform/screens/GameEntry.jsx';
import{AccountContext,NULL_ACCOUNT}from'./src/shared/account/context.js';import{PlatformContext}from'./src/platform/context.js';import{SocialContext}from'./src/social/SocialProvider.jsx';
import{BottomNavigation,MenuScrollRestoration}from'./src/platform/BottomNavigation.jsx';import{CallViewport}from'./src/social/CallViewport.jsx';import{PlusStyles}from'./src/plus/PlusStyles.jsx';import{useRoute,navigate}from'./src/platform/router.js';import{BrandFonts}from'./src/shared/brand/art.jsx';import{useI18n}from'./src/shared/i18n/react.jsx';import{setUiLocale,untranslatedUiKeys}from'./src/shared/i18n/core.js';
import{gameplayEntryOffer,ENTRY_POLICY}from'./src/shared/account/gameplay-policy.mjs';
import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import brand from'./src/shared/brand/brand.css';import platformCSS from'./src/platform/platform.css';import studioCSS from'./src/platform/playful-studio.css';
const noop=()=>{},f=window.fixture={ready:true,policy:null,access:'required',error:false,requests:[],attempts:0,friends:true,owner:'demo-owner',go:navigate,locale:setUiLocale,missing:untranslatedUiKeys};
setUiLocale(new URLSearchParams(location.search).get('locale')||'ar');
window.maydanRewardedLab=async()=>({state:'skipped',presented:true});
function App(){const[,setTick]=useState(0),route=useRoute();useI18n();f.set=patch=>{Object.assign(f,patch);setTick(x=>x+1)};
const account={...NULL_ACCOUNT,ready:f.ready,signedIn:true,user:{id:f.owner,name:'Lina',avatarPreset:'human-01',theme:'teal'},gameplayPolicy:f.policy,gameAccess:()=> 'trial',premium:false,authHeaders:()=>({}),openPaywall:()=>{f.paywall=true;},requestAuthenticated:async(url,options={})=>{f.requests.push({url,method:options.method||'GET'});if(url.startsWith('/api/rewarded/entry-status?')){if(f.error)throw Error('Synthetic unavailable check');const id=new URLSearchParams(url.split('?')[1]).get('game'),offer=gameplayEntryOffer(id);return{game:id,offer:offer.id,policy:ENTRY_POLICY,group:'B',adsAvailable:true,attempt:null,access:f.access,entryAccess:f.access,modeAccess:Object.fromEntries(offer.modes.map(mode=>[mode,f.access]))};}if(url==='/api/rewarded/attempt'){f.attempts++;return{mode:'simulation',attemptId:'synthetic-attempt',customData:'synthetic-only'}}throw Error('Unexpected fixture request '+url);}};
const social={incoming:[{id:'request1'}],outgoing:[],unreadCount:0,friends:f.friends?[1,2,3].map((n)=>({id:'friend'+n,name:['Noor','Omar','Sara'][n-1],avatarPreset:'human-0'+(n+1),theme:'teal',online:true})):[]};
return <AccountContext.Provider value={account}><PlatformContext.Provider value={{settings:{reducedMotion:true},sound:{play:noop,emit:noop,music:{scene:noop,releaseScene:noop}},haptics:{vibrate:noop},version:'local-review'}}><SocialContext.Provider value={social}><BrandFonts/><PlusStyles/><style>{tokens+ui+brand+platformCSS+studioCSS}</style><CallViewport>{route.name==='home'?<Home/>:route.name==='game'?<GameDetails id={route.params.id} mode={route.params.mode}/>:route.name==='game-entry'?<GameEntry id={route.params.id}/>:<output data-testid="destination">{route.path}</output>}</CallViewport><MenuScrollRestoration route={route}/><BottomNavigation route={route}/></SocialContext.Provider></PlatformContext.Provider></AccountContext.Provider>}
createRoot(document.getElementById('root')).render(<App/>);`;
const built = await build({ stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',logLevel:'silent',loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl','.mp3':'dataurl'},define:{__MAYDAN_ROOMS_URL__:'"same-origin"',__MAYDAN_REWARDED_SIMULATION__:'true',__MAYDAN_AUDIO_PREVIEW__:'false'} });
const server = createServer((req,res)=>{
 if(req.url.startsWith('/api/mafia/capabilities')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({enabled:false,capabilities:{mafia:2}}));return;}
 if(req.url==='/bundle.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(built.outputFiles[0].contents);return;}
 res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
test.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
const settle=page=>page.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});

for(const[name,engine]of[['chromium',chromium],['webkit',webkit]])for(const locale of['ar','en'])test(`${name}/${locale}: approved entry surfaces, real routing, rights separation and accessible reflow`,{timeout:90000},async()=>{
 const browser=await engine.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[],external=[],states=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||['data:','blob:'].includes(u.protocol))return r.continue();external.push(u.origin+u.pathname);return r.abort();});
 const save=async label=>{await settle(page);await page.screenshot({path:path.join(output,`${name}-${locale}-${label}.png`)});};
 const inspect=async label=>{await settle(page);const data=await page.evaluate(()=>{
  const rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
  const active=document.querySelector('[role=dialog]')||document.querySelector('.call-game-viewport');
  const controls=[...active.querySelectorAll('button,input,summary,a[href]')].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  const rgb=s=>{const m=s.match(/rgba?\(([^)]+)\)/);return m?m[1].split(',').map(Number):null;};
  const luminance=v=>v.slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
  const contrast=[...active.querySelectorAll('.home-game-copy .name,.home-game-capability,.studio-home-friends h2,.game-mode-choice strong,.game-mode-choice small,.instruction-copy strong,.instruction-copy>span,.rewarded-entry-header h2,.rewarded-entry-status,.game-entry-recovery p,.btn')].filter(el=>el.getClientRects().length&&!el.disabled&&!el.closest(':disabled')).map(el=>{const fg=rgb(getComputedStyle(el).color);let bg=[255,248,240],samples=[];for(let n=el;n;n=n.parentElement){const st=getComputedStyle(n),c=rgb(st.backgroundColor);if(st.backgroundImage!=='none'){samples=[...st.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(m=>rgb(m[0]));if(samples.length)break;}if(c&&(c.length===3||c[3]===1)){bg=c;break;}}if(!samples.length)samples=[bg];return{text:el.textContent.trim().slice(0,90),ratios:samples.map(b=>{const a=luminance(fg),z=luminance(b);return(Math.max(a,z)+.05)/(Math.min(a,z)+.05);})};});
  const primaries=[...active.querySelectorAll('.btn-primary,.btn-accent')].filter(el=>el.getClientRects().length).map(el=>({id:el.dataset.designId,...rect(el)}));
  return{entryNodes:[...document.querySelectorAll('[data-design-screen="game.entry"] [data-design-id]')].filter(node=>node.closest('[data-design-screen]')?.dataset.designScreen==='game.entry').map(node=>node.dataset.designId),contrast,primaries,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,controls:controls.map(el=>({id:el.dataset.designId||el.id||el.className,...rect(el),fontSize:getComputedStyle(el).fontSize,disabled:el.disabled})),cards:[...document.querySelectorAll('button.home-game-row')].map(el=>({game:el.dataset.game,...rect(el)})),rootFont:getComputedStyle(document.documentElement).fontSize};
 });for(const id of data.entryNodes)assert.ok(getNodeDefinition('game.entry',id),'entry semantic control registered: '+id);assert.ok(data.scrollWidth<=data.width+1,label+' horizontal overflow '+JSON.stringify(data));for(const c of data.controls)assert.ok(c.width>=47.9&&c.height>=47.9,label+' target '+JSON.stringify(c));for(const c of data.contrast)assert.ok(c.ratios.every(r=>r>=4.5),label+' contrast '+JSON.stringify(c));for(const c of data.primaries)assert.ok(c.height>=51.9,label+' primary52 '+JSON.stringify(c));states.push({label,...data});return data;};
 try{
  await page.goto(origin+'/?locale='+locale);await page.locator('.home-game-row').first().waitFor();
  for (const width of [360,390,430]) {
   await page.setViewportSize({width,height:844});
   const {cards} = await inspect('home-'+width);
   assert.equal(cards.length,8);
   const draw=cards.find(c=>c.game==='ersomha'), b=cards.find(c=>c.game==='badeeha'), mafia=cards.find(c=>c.game==='mafia');
   assert.ok(draw.width>b.width*1.8 && Math.abs(b.y-mafia.y)<1 && b.y>=draw.y+draw.height);
   assert.ok(locale==='ar'?b.x>mafia.x:b.x<mafia.x,'game cards follow logical direction');
   const artwork = await page.locator('.home-game-row').evaluateAll(rows => rows.map(row => {
    const card=row.getBoundingClientRect(), copy=row.querySelector('.home-game-copy').getBoundingClientRect();
    const img=row.querySelector('img'), art=img.getBoundingClientRect();
    const start=getComputedStyle(row).direction==='rtl'?card.right-copy.right:copy.left-card.left;
    return {game:row.dataset.game, loaded:img.naturalWidth>0, start,
     belowText:art.top>=copy.bottom-1, inside:art.left>=card.left-1 && art.right<=card.right+1 &&
      art.top>=card.top-1 && art.bottom<=card.bottom+1};
   }));
   for (const item of artwork) {
    assert.ok(item.loaded,'artwork loaded for '+item.game);
    if (item.game==='ersomha' || item.game==='meenfina') {
     assert.ok(item.start>=0 && item.start<=28,'banner copy aligned to the start: '+item.game);
    } else {
     assert.ok(item.inside && item.belowText,'artwork fits below the title: '+item.game+' at '+width);
    }
   }
  }
  await page.setViewportSize({width:390,height:844});await save('home');
  assert.equal(await page.locator('.studio-home-friends button').count(),3);await page.locator('[data-design-id="online-friend"]').first().click();await page.getByTestId('destination').waitFor();assert.equal(new URL(page.url()).hash,'#/friends/friend1');await page.evaluate(()=>fixture.go('/'));
  await page.locator('[data-design-id="requests-open"]').click();await page.getByTestId('destination').waitFor();assert.equal(new URL(page.url()).hash,'#/friends');await page.evaluate(()=>fixture.go('/'));
  await page.locator('[data-design-id="home-search-open"]').click();await page.locator('#home-game-search').fill('does-not-exist');await page.locator('.home-no-games').waitFor();assert.equal(await page.locator('.home-game-row').count(),0);await page.locator('[data-design-id="home-search-open"]').click();assert.equal(await page.locator('.home-game-row').count(),8);
  await page.evaluate(()=>fixture.set({friends:false}));await page.locator('.studio-home-friends').waitFor({state:'detached'});assert.equal(await page.locator('.studio-home-friends').count(),0);await page.evaluate(()=>fixture.set({friends:true}));
  await page.locator('button[data-game="badeeha"]').click();await page.locator('[data-design-id="local-mode"]').waitFor();await inspect('mode');await save('mode');assert.equal(await page.locator('.menu-navigation').isVisible(),false);await page.locator('[data-design-id="local-mode"]').click();await page.locator('[data-design-screen="game-details"]').waitFor();assert.equal(new URL(page.url()).hash,'#/game/badeeha?mode=local');
  await page.evaluate(()=>fixture.go('/game/ersomha?mode=online'));await page.locator('.instruction-hero').waitFor();await inspect('instructions');await save('instructions');
  const instructionAction=page.locator('[data-design-id=skip-instructions]');await page.mouse.move(190,500);await page.mouse.wheel(0,450);await page.waitForFunction(()=>{const b=document.querySelector("[data-design-id=skip-instructions]").getBoundingClientRect(),n=document.querySelector(".menu-navigation").getBoundingClientRect();return b.top>=0&&b.bottom<=n.top;});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const instructionBottom=await instructionAction.evaluate(button=>{const b=button.getBoundingClientRect(),nav=document.querySelector('.menu-navigation')?.getBoundingClientRect();return{button:b.toJSON(),nav:nav?.toJSON()||null,hit:button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),scrollY};});assert.ok(instructionBottom.hit,'normal scroll exposes the instruction action');assert.ok(instructionBottom.button.bottom<=(instructionBottom.nav?.top??844)+.5,'full instruction action stays above navigation after normal scroll');states.push({label:'instructions-bottom-scroll',...instructionBottom});await page.screenshot({path:path.join(output,`${name}-${locale}-instructions-bottom.png`)});
  await page.locator('.instruction-facts summary').click();assert.equal(await page.locator('.instruction-full-rules li').count(),5);assert.match(await page.locator('.instruction-full-rules').innerText(),locale==='ar'?/مخفيًا/:/hidden/i);await page.locator('[data-design-id="skip-instructions"]').click();await page.getByTestId('destination').waitFor();assert.equal(new URL(page.url()).hash,'#/online/ersomha?mode=online');
  await page.evaluate(()=>fixture.go('/'));await page.locator('button[data-game="mafia"]').click();await page.locator('[data-design-id="availability-retry"]').waitFor();assert.equal(await page.locator('[data-design-id="online-mode"]').count(),0);await inspect('mafia-unavailable');await save('mafia-unavailable');await page.locator('[data-design-id="close"]').click();
  await page.evaluate(()=>{fixture.set({policy:'game-entry-ticket-v2',ready:false});fixture.go('/entry/badeeha');});await page.locator('[data-design-id="join-room"]').click();await page.getByTestId('destination').waitFor();assert.equal(new URL(page.url()).hash,'#/online/badeeha?mode=online&joinOnly=1');
  await page.evaluate(()=>{fixture.set({ready:true,policy:'game-entry-ticket-v2',access:'required'});fixture.go('/entry/badeeha');});await page.locator('[data-design-id="entry-watch-ad"]').waitFor();assert.equal(await page.locator('[data-design-id="join-room"]').count(),1);await inspect('ticket-required');await save('ticket-required');await page.locator('[data-design-id="join-room"]').click();await page.getByTestId('destination').waitFor();assert.equal(new URL(page.url()).hash,'#/online/badeeha?mode=online&joinOnly=1');await page.evaluate(()=>fixture.go('/entry/badeeha'));await page.locator('[data-design-id="entry-watch-ad"]').waitFor();assert.equal(await page.evaluate(()=>fixture.attempts),0);await page.locator('[data-design-id="entry-plus"]').click();assert.equal(await page.evaluate(()=>fixture.paywall),true);await page.locator('[data-design-id="entry-recheck"]').click();assert.equal(await page.evaluate(()=>fixture.attempts),0);
  await page.evaluate(()=>{fixture.go('/');fixture.set({access:'ticket'});});await page.locator('.home-game-row').first().waitFor();await page.locator('button[data-game="badeeha"]').click();await page.locator('[data-design-id="entry-ready"]').waitFor();assert.equal(await page.locator('.rewarded-entry-card [data-design-id="join-room"]').count(),1);await inspect('ticket-confirmed');await save('ticket-confirmed');assert.equal(await page.locator('[data-design-id="entry-watch-ad"]').count(),0);assert.equal(await page.evaluate(()=>fixture.requests.some(r=>r.method!=='GET')),false);
  await page.locator('[data-design-id="entry-ready"]').click();await page.locator('[data-design-id="online-mode"]').click();await page.getByTestId('destination').waitFor();assert.equal(new URL(page.url()).hash,'#/online/badeeha?mode=online');assert.equal(await page.evaluate(()=>fixture.requests.some(r=>r.method!=='GET')),false);
  await page.evaluate(()=>{fixture.go('/');fixture.set({error:true});const g={version:1,owner:'demo-owner',offer:'badeeha-local',matchId:'synthetic-current-match',source:'ticket'},prefix='maydan:environment:'+encodeURIComponent(location.origin)+':gameplay:badeeha:';localStorage.setItem(prefix+'match:'+g.matchId,JSON.stringify(g));localStorage.setItem('maydan:badeeha:active-game-v2',JSON.stringify({profileSession:{gameplayAccess:g}}));});await page.locator('.home-game-row').first().waitFor();await page.locator('button[data-game="badeeha"]').click();await page.locator('[data-design-id="resume-local"]').waitFor();await page.locator('.rewarded-entry-status[data-state="error"]').waitFor();assert.equal(await page.locator('.rewarded-entry-card.is-recovery .rewarded-entry-art').count(),0);assert.equal(await page.locator('.rewarded-entry-card.is-recovery').count(),1);await inspect('recovery-check-error');await save('recovery-check-error');
  for(const width of[360,430]){await page.setViewportSize({width,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');await inspect('recovery-text200-'+width);}
  await page.locator('[data-design-id="resume-local"]').click();await page.getByTestId('destination').waitFor();assert.equal(new URL(page.url()).hash,'#/play/badeeha?mode=local');
  await page.setViewportSize({width:360,height:844});await page.evaluate(()=>{fixture.set({policy:null,error:false});fixture.go('/');});await page.locator('.home-game-row').first().waitFor();await inspect('home-text200');await page.locator('button[data-game="badeeha"]').click();await page.locator('[data-design-id="local-mode"]').waitFor();await inspect('mode-text200');await page.locator('[data-design-id="local-mode"]').click();await page.locator('.instruction-hero').waitFor();await inspect('instructions-text200');await page.locator('[data-design-id="skip-instructions"]').click();await page.getByTestId('destination').waitFor();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(await page.evaluate(()=>fixture.missing()),[]);
 }catch(e){await page.screenshot({path:path.join(output,`${name}-${locale}-failure.png`)});throw e;}finally{await writeFile(path.join(output,`${name}-${locale}.json`),JSON.stringify({name,locale,states,errors,external,bundleSHA256:createHash('sha256').update(built.outputFiles[0].contents).digest('hex'),fixtureOnly:true,limits:['No real ad or billing provider','Account/social HTTP are synthetic','No device or live match acceptance']},null,2));await browser.close();}
});
