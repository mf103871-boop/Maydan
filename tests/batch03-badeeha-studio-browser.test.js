// Actual React presentation and authoritative game-model actions over loopback.
// Synthetic room members/accounts only; this is not WebSocket/auth/provider QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import * as game from '../server/game-model.mjs';
import { getCategories } from '../src/data/game-content.js';
import logic from '../src/games/badeeha/logic.js';

const output=process.env.BATCH03_BADEEHA_EVIDENCE_DIR||path.resolve('.cache/batch03-badeeha-studio');
await mkdir(output,{recursive:true});
const rooms=new Map();
let renderRevision=0;
function reset(id,{locale='ar',type='text',count=2,phase='question',uploaded=false,framed=false,longNames=false,guestIdentity=false}={}) {
  const cats=getCategories(locale),category=type==='text'?cats.find(c=>c.id==='science'):cats.find(c=>c.qs.some(q=>q.type===type));
  const selected=[category,...cats.filter(c=>c.id!==category.id).slice(0,5)];
  const deck=Object.fromEntries(selected.map(c=>[c.id,[]]));
  const chosen=type==='text'?category.qs.find(q=>q.p===400)||category.qs[0]:category.qs.find(q=>q.type===type);
  deck[category.id].push({qid:logic.questionId(category.id,chosen,category.qs.indexOf(chosen)),p:chosen.p});
  for(let n=1;n<20;n++){const c=selected[n%6],q=c.qs.find((q,i)=>!Object.values(deck).flat().some(x=>x.qid===logic.questionId(c.id,q,i)));deck[c.id].push({qid:logic.questionId(c.id,q,c.qs.indexOf(q)),p:q.p});}
  const now=Date.now(),members=Array.from({length:count},(_,i)=>({id:String(i+1).padStart(32,'0'),tokenHash:String(i+1).repeat(64),name:longNames?'Blue Comet Team No '+(i+1):locale==='ar'?['فريق ليان','فريق عمر','فريق نور','فريق سارة'][i]:['Layan team','Omar team','Noor team','Sara team'][i],avatar:i,capabilities:{localizedContent:1}}));
  const room=game.createRoom('482761',{...members[0],game:'badeeha',contentLocale:locale,settings:{mode:'standard',roundSize:20,timer:60,categories:selected.map(c=>c.id),deck}},now);
  for(const m of members.slice(1))game.joinRoom(room,m,now);
  const act=(index,type,fields={})=>game.action(room,members[index].id,{type,matchId:room.matchId,round:room.round,...fields},Date.now());
  members.forEach((m,i)=>{game.connected(room,m.id,true,now);act(i,'ready',{ready:true});});act(0,'start');
  const first={categoryId:category.id,index:0};
  if(phase!=='board'){act(0,'open',first);if(['reveal','over'].includes(phase))act(0,'reveal');}
  if(phase==='over'){
    act(0,'judge',{teamId:members[0].id});
    while(room.phase==='board'){
      let cell;for(const [categoryId,cells]of Object.entries(room.settings.deck)){const index=cells.findIndex(c=>!room.used[c.qid]);if(index>=0){cell={categoryId,index};break;}}
      if(!cell)break;act(0,'open',cell);act(0,'reveal');act(0,'judge',{teamId:members[room.round%count].id});
    }
  }
  const profiles=guestIdentity?{}:Object.fromEntries(members.map((m,i)=>[m.id,{avatarPreset:['human-01','human-02','human-04','human-03'][i],theme:'teal',...(framed&&i===0?{cosmetics:{frameId:'artist.frame'}}:{}),...(uploaded&&i===0?{avatarUrl:'/api/profiles/demo/images/avatar/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}:{})}]));
  // A late spectator joins through the model after start and cannot act as a team.
  const spectator={id:'9'.repeat(32),tokenHash:'9'.repeat(64),name:'Observer',avatar:3,capabilities:{localizedContent:1}};
  if(count<4)game.joinRoom(room,spectator,Date.now());
  const fixture={room,members,profiles,spectator,chosen,first,actions:[]};rooms.set(id,fixture);return fixture;
}
function view(id,role='host'){
  const f=rooms.get(id),me=role==='host'?f.members[0]:role==='guest'?f.members[1]:f.spectator,state=game.snapshot(f.room,me.id,Date.now());
  state.members=state.members.map(m=>({...m,...(f.profiles[m.id]?{profile:f.profiles[m.id]}:{})}));
  return{renderRevision:++renderRevision,state,me:state.members.find(m=>m.id===me.id),isHost:me.id===state.hostId,spectating:!state.participants.includes(me.id),actions:f.actions};
}
const source=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{BadeehaMatch}from'./src/online/Badeeha.jsx';import{RoomChrome}from'./src/online/Online.jsx';
import{PlatformContext}from'./src/platform/context.js';import{BrandFonts}from'./src/shared/brand/art.jsx';import{PlusStyles}from'./src/plus/PlusStyles.jsx';import{useI18n}from'./src/shared/i18n/react.jsx';import{setUiLocale,untranslatedUiKeys}from'./src/shared/i18n/core.js';
import tokens from'./src/shared/theme/tokens.css';import ui from'./src/shared/ui/ui.css';import brand from'./src/shared/brand/brand.css';import platformCSS from'./src/platform/platform.css';import studioCSS from'./src/platform/playful-studio.css';import onlineCSS from'./src/online/online.css';
const params=new URLSearchParams(location.search),id=params.get('id');setUiLocale(params.get('locale'));const noop=()=>{},f=window.fixture={role:'host',disabled:false,missing:untranslatedUiKeys};
function App(){const[data,setData]=useState(null),[disabled,setDisabled]=useState(false);const{locale}=useI18n();f.reload=async()=>{const next=await(await fetch('/fixture/view?id='+id+'&role='+f.role)).json();setData(next);return next.renderRevision;};f.roleAs=async role=>{f.role=role;return f.reload()};f.disable=value=>setDisabled(value);f.locale=setUiLocale;
f.reset=async options=>{const response=await fetch('/fixture/reset?id='+id,{method:'POST',body:JSON.stringify(options)});if(!response.ok)throw Error('Invalid fixture '+response.status+' '+JSON.stringify(await response.json()));f.role='host';return f.reload()};
const act=async(type,fields={})=>{const r=await fetch('/fixture/action?id='+id+'&role='+f.role,{method:'POST',body:JSON.stringify({type,...fields})});if(!r.ok)throw Error('Unexpected game rejection '+r.status);await f.reload();};f.act=act;f.data=data;
React.useEffect(()=>{f.reload()},[]);return <PlatformContext.Provider value={{settings:{reducedMotion:true},sound:{play:noop,emit:noop,music:{scene:noop,releaseScene:noop}},haptics:{vibrate:noop}}}><BrandFonts/><PlusStyles/><style>{tokens+ui+brand+platformCSS+studioCSS+onlineCSS}</style><style>{'body{margin:0;background:#FFF8F0} .fixture-room{padding:20px;max-width:720px;margin:auto} .fixture-room-header{text-align:center;margin-bottom:16px;color:#352139}.fixture-room-header h1{font-size:28px;margin:0}.fixture-room-header p{font-size:14px;margin:4px 0}'}</style><main className="fixture-room online-screen" dir={locale==='ar'?'rtl':'ltr'}>{data&&<><RoomChrome state={data.state} code={data.state.code} status="connected" disabled={disabled} onExit={()=>{f.exited=true;}} onReconnect={()=>{f.reconnected=true;}}><BadeehaMatch {...data} disabled={disabled} act={act} clockOffset={0}/></RoomChrome></>}</main></PlatformContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);`;
const built=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',logLevel:'silent',loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl','.mp3':'dataurl'},define:{__MAYDAN_ROOMS_URL__:'"same-origin"',__MAYDAN_AUDIO_PREVIEW__:'false'}});
let releaseAudioFailure;
let pendingAudioFailure;
const server=createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost'),id=u.searchParams.get('id'),role=u.searchParams.get('role')||'host';
  if(u.pathname.startsWith('/media/sound/') && u.pathname.endsWith('.mp3')){
    await pendingAudioFailure;
    res.writeHead(404,{'cache-control':'no-store','content-length':'0'});res.end();return;
  }
  if(u.pathname==='/bundle.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(built.outputFiles[0].contents);return;}
  if(u.pathname.startsWith('/fixture/')){let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
    if(u.pathname==='/fixture/reset')reset(id,body);
    if(u.pathname==='/fixture/action'){const f=rooms.get(id),me=role==='host'?f.members[0]:role==='guest'?f.members[1]:f.spectator;game.action(f.room,me.id,{...body,matchId:f.room.matchId,round:f.room.round},Date.now());f.actions.push({role,...body});}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(view(id,role)));return;}
  if(u.pathname==='/api/profiles/demo/images/avatar/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'){res.writeHead(200,{'content-type':'image/png'});res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=','base64'));return;}
  res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>');
}catch(error){res.writeHead(error.status||400,{'content-type':'application/json'});res.end(JSON.stringify({error:error.code||error.message}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
test.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
const settle=page=>page.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});

for(const[name,engine]of[['chromium',chromium],['webkit',webkit]])for(const locale of['ar','en'])test(`${name}/${locale}: Badeeha roles, live judge/replay and approved layout`,{timeout:120000},async()=>{
 const id=name+'-'+locale;reset(id,{locale});const browser=await engine.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[],external=[],states=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin||['data:','blob:'].includes(u.protocol))return route.continue();external.push(u.origin+u.pathname);return route.abort();});
 const inspect=async label=>{await settle(page);const d=await page.evaluate(()=>{
   const root=document.querySelector('.badeeha-studio'),rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
   const targets=[...root.querySelectorAll('button,summary,a[href]')].filter(e=>e.getClientRects().length).map(e=>({id:e.dataset.designId,...rect(e),primary:e.classList.contains('btn-primary'),disabled:e.disabled}));
   const rgb=s=>{const m=s.match(/rgba?\(([^)]+)\)/);return m?m[1].split(',').map(Number):null;};const lum=v=>v.slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
   const contrast=[...root.querySelectorAll('.bs-score-copy b,.bs-score-copy strong,.bs-turn-strip>strong,.bs-category>strong,.bs-points,.m-question-text,.m-statement,.bs-prompt,.bs-answer,.bs-tool b,.bs-status,.bs-judge h2,.bs-results-podium h1,.bs-podium-block>strong,.bs-podium-block>b,.bs-statistics b,.bs-statistics>div>span:last-child,.bs-replay-notice,.btn')].filter(e=>e.getClientRects().length&&!e.disabled).map(e=>{const fg=rgb(getComputedStyle(e).color);let samples=[[255,248,240]];for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n),c=rgb(s.backgroundColor),gs=[...s.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(m=>rgb(m[0]));if(gs.length){samples=gs;break;}if(c&&(c.length===3||c[3]===1)){samples=[c];break;}}return{text:e.textContent.slice(0,65),font:parseFloat(getComputedStyle(e).fontSize),weight:getComputedStyle(e).fontWeight,ratios:samples.map(b=>(Math.max(lum(fg),lum(b))+.05)/(Math.min(lum(fg),lum(b))+.05))};});
   const header=document.querySelector('.online-room-chrome>.studio-play-header'),title=header.querySelector('h1'),exit=header.querySelector('[data-design-id=exit]'),connection=header.querySelector('.online-connection');return{header:{title:rect(title),exit:rect(exit),connection:rect(connection)},targets,contrast,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,scoreboards:root.querySelectorAll('[data-design-id=scoreboard]').length,phase:root.dataset.designScreen,fonts:document.fonts.status};
 });assert.ok(d.scrollWidth<=d.width+1,label+' overflow '+JSON.stringify(d));assert.ok(d.header.exit.width>=47.9&&d.header.exit.height>=47.9,label+' exit48');assert.ok(Math.abs(d.header.title.x+d.header.title.width/2-d.width/2)<1,label+' title centered');assert.ok(d.header.exit.x+d.header.exit.width<=d.header.title.x+1||d.header.exit.x>=d.header.title.x+d.header.title.width-1||d.header.exit.y>=d.header.title.y+d.header.title.height-1||d.header.title.y>=d.header.exit.y+d.header.exit.height-1,label+' exit/title do not overlap in either layout');for(const t of d.targets){assert.ok(t.width>=47.9&&t.height>=47.9,label+' target '+JSON.stringify(t));if(t.primary)assert.ok(t.height>=51.9,label+' primary52');}for(const c of d.contrast){assert.ok(c.ratios.every(r=>r>=4.5),label+' contrast '+JSON.stringify(c));assert.ok(c.font>=14,label+' font '+JSON.stringify(c));}states.push({label,...d});return d;};
 const save=async label=>{await page.evaluate(()=>window.scrollTo(0,0));await settle(page);await page.screenshot({path:path.join(output,`${id}-${label}.png`)});};
 const resetPage=async options=>{const revision=await page.evaluate(options=>fixture.reset(options),{locale,...options});await page.waitForFunction(revision=>fixture.data?.renderRevision===revision,revision);};
 const asRole=async role=>{const revision=await page.evaluate(role=>fixture.roleAs(role),role);await page.waitForFunction(revision=>fixture.data?.renderRevision===revision,revision);};
 try{
  await page.goto(origin+'/?id='+id+'&locale='+locale);await page.locator('.bs-question').waitFor();
  for(const width of[360,390,430]){await page.setViewportSize({width,height:844});assert.equal((await inspect('question-'+width)).scoreboards,1);if(width===390)await save('question');}
  assert.equal(await page.locator('[data-design-id=answer]').count(),0);assert.equal(await page.locator('[data-design-id=judge]').count(),0);assert.equal(await page.locator('[data-design-id=tool]').count(),3);
  const original=await page.evaluate(()=>fixture.data.state),answer=rooms.get(id).chosen.a;assert.ok(!(await page.locator('.badeeha-studio').innerText()).includes(answer),'unrevealed answer must not be exposed by layout');
  await page.locator('[data-design-id=tool]').last().click();await page.waitForFunction(()=>fixture.data.state.effect.double);assert.equal(await page.locator('[data-design-id=tool]').last().isDisabled(),true);
  await page.locator('[data-design-id=tool]').nth(1).click();await page.waitForFunction(()=>fixture.data.state.effect.two);await page.locator('[data-design-id=tool]').first().click();await page.waitForFunction(()=>!fixture.data.state.teams[0].tools.time);assert.equal(await page.evaluate(()=>fixture.data.state.deadlineAt),original.deadlineAt+30000);
  await asRole('guest');await page.locator('[data-design-id=reveal]').waitFor({state:'detached'});assert.equal(await page.locator('[data-design-id=tool]').count(),0);
  const rejected=await page.evaluate(async()=>{const r=await fetch('/fixture/action?id='+new URLSearchParams(location.search).get('id')+'&role=guest',{method:'POST',body:JSON.stringify({type:'reveal'})});return{status:r.status,body:await r.json()};});assert.notEqual(rejected.status,200);assert.equal(rooms.get(id).room.phase,'question');
  await asRole('spectator');assert.equal(await page.locator('[data-design-id=reveal],[data-design-id=tool],[data-design-id=hint]').count(),0);await inspect('spectator-question');
  await asRole('host');await page.locator('[data-design-id=reveal]').waitFor();await page.evaluate(()=>fixture.disable(true));await page.waitForFunction(()=>document.querySelector('[data-design-id=reveal]').disabled);await page.evaluate(()=>fixture.disable(false));
  await page.locator('[data-design-id=reveal]').click();await page.locator('.bs-reveal').waitFor();assert.match(await page.locator('[data-design-id=answer]').innerText(),new RegExp(answer.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.equal(await page.locator('[data-design-id=timer]').count(),0);assert.equal(await page.locator('[data-design-id=tool]').count(),0);
  for(const width of[360,390,430]){await page.setViewportSize({width,height:844});assert.equal((await inspect('reveal-'+width)).scoreboards,1);if(width===390)await save('reveal');}
  await asRole('guest');await page.locator('[data-design-id=judge]').waitFor({state:'detached'});assert.equal(await page.locator('[data-design-id=answer]').count(),1);await asRole('host');await page.locator('[data-design-id=judge-team]').first().click();await page.locator('[data-design-id=board]').waitFor();
  assert.equal(await page.evaluate(()=>fixture.data.state.teams[0].score),original.current.p*2);assert.equal(await page.evaluate(()=>fixture.data.state.round),2);
  await page.evaluate(first=>fixture.act('open',first),{categoryId:original.current.categoryId,index:1});await page.locator('.bs-question').waitFor();await page.locator('[data-design-id=reveal]').click();await page.locator('.bs-reveal').waitFor();const second=await page.evaluate(()=>fixture.data.state.current.p);await page.locator('[data-design-id=judge-team]').first().click();await page.locator('[data-design-id=board]').waitFor();assert.equal(await page.evaluate(()=>fixture.data.state.teams[0].score),original.current.p*2+second);assert.equal(await page.evaluate(()=>fixture.data.state.teams[0].steals),1);
  await resetPage({phase:'over'});await page.locator('.bs-over').waitFor();assert.equal(await page.locator('[data-design-id=scoreboard]').count(),0);assert.equal(await page.evaluate(()=>fixture.data.state.round),20);
  for(const width of[360,390,430]){await page.setViewportSize({width,height:844});await inspect('over-'+width);if(width===390)await save('over');}
  const finished=await page.evaluate(()=>fixture.data.state);await asRole('guest');await page.locator('[data-design-id=restart]').waitFor({state:'detached'});await asRole('host');await page.locator('[data-design-id=restart]').click();await page.waitForFunction(()=>fixture.data.state.phase==='lobby');assert.deepEqual(await page.evaluate(()=>fixture.data.state.settings.deck),finished.settings.deck);assert.equal(await page.evaluate(()=>fixture.data.state.matchId),finished.matchId+1);
  for(const phase of['question','reveal','over']){await resetPage({phase});await page.locator('.bs-'+phase).waitFor();await page.setViewportSize({width:360,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');await inspect(phase+'-text200');await page.evaluate(()=>document.documentElement.style.fontSize='');}
  // WebKit can postpone loading until a user gesture. Hold the missing file
  // until Play is clicked, then return a genuine HTTP error to the audio element.
  pendingAudioFailure=new Promise(resolve=>{releaseAudioFailure=resolve;});
  try {
    await resetPage({type:'audio'});
    await page.locator('[data-design-id="audio-play"]').click();
  } finally { releaseAudioFailure(); }
  const retry=page.locator('[data-design-id="media-retry"]');
  await retry.waitFor();
  const retryResponse=page.waitForResponse(r=>new URL(r.url()).pathname.startsWith('/media/sound/')&&r.request().resourceType()==='fetch');
  await retry.click();
  assert.equal((await retryResponse).status(),404);
  await retry.waitFor();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-design-id="media-retry"]')).backgroundColor==='rgb(8, 121, 109)');
  assert.equal(await retry.evaluate(button=>getComputedStyle(button).color),'rgb(255, 255, 255)');
  await resetPage({type:'hints'});await page.locator('[data-design-id=hint]').waitFor();await page.locator('[data-design-id=hint]').click();await page.waitForFunction(()=>fixture.data.state.hintsUsed===1);await inspect('hint-open');await asRole('guest');assert.equal(await page.locator('[data-design-id=hint]').count(),0);
  await resetPage({count:4,longNames:true});await page.locator('.bs-question').waitFor();await inspect('four-long-names');assert.equal(await page.locator('.bs-score').count(),4);
  await resetPage({uploaded:true});await page.locator('.bs-score img[src*="/api/profiles/demo/images/avatar/"]').waitFor();await settle(page);assert.ok(await page.locator('.bs-score img[src*="/api/profiles/demo/images/avatar/"]').evaluate(img=>img.complete&&img.naturalWidth>0));assert.equal(await page.locator('.bs-score [data-avatar-presentation=avatar]').count(),1,'uploaded identity keeps its original circular presentation');await inspect('uploaded-avatar');
  await resetPage({framed:true});await page.locator('.bs-score .is-framed').waitFor();assert.equal(await page.locator('.bs-score .is-framed').getAttribute('data-avatar-presentation'),'avatar','equipped frames preserve their portrait and ownership');
  await resetPage({});assert.equal(await page.locator('.bs-score [data-avatar-presentation=cutout]').count(),2,'saved transparent presets use the approved free portrait composition');
  await resetPage({guestIdentity:true});await page.locator('.bs-score .clay-avatar').first().waitFor();assert.deepEqual(await page.locator('.bs-score .clay-avatar').evaluateAll(nodes=>nodes.map(n=>n.dataset.index)),['0','1']);
  await page.emulateMedia({reducedMotion:'no-preference'});await resetPage({phase:'over'});await page.locator('.bs-over').waitFor();assert.equal(await page.locator('.bs-trophy').evaluate(el=>getComputedStyle(el).animationDuration),'0.7s');states.push({label:'result-motion-normal',duration:700});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches &&
    getComputedStyle(document.querySelector('.bs-trophy')).animationName === 'none');await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>document.documentElement.dataset.reducedMotion='true');assert.equal(await page.locator('.bs-trophy').evaluate(el=>getComputedStyle(el).animationName),'none');await page.evaluate(()=>delete document.documentElement.dataset.reducedMotion);
  for(const motion of['normal','os','manual']){await resetPage({});await page.emulateMedia({reducedMotion:motion==='os'?'reduce':'no-preference'});await page.evaluate(m=>{if(m==='manual')document.documentElement.dataset.reducedMotion='true';else delete document.documentElement.dataset.reducedMotion},motion);const tool=page.locator('[data-design-id=tool]').first();await tool.scrollIntoViewIfNeeded();const box=await tool.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(120);const pressed=await tool.evaluate(el=>({transform:getComputedStyle(el).transform,duration:getComputedStyle(el).transitionDuration}));await page.mouse.move(1,1);await page.mouse.up();const released=await tool.evaluate(el=>getComputedStyle(el).transitionDuration);if(motion==='normal'){assert.notEqual(pressed.transform,'none');assert.match(pressed.duration,/0.09s/);assert.match(released,/0.14s/);}else assert.equal(pressed.transform,'none');states.push({label:'button-motion-'+motion,...pressed,released});}
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>delete document.documentElement.dataset.reducedMotion);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(await page.evaluate(()=>fixture.missing()),[]);
 }catch(e){await page.screenshot({path:path.join(output,`${id}-failure.png`)});throw e;}finally{await writeFile(path.join(output,`${id}.json`),JSON.stringify({name,locale,states,errors,external,bundleSHA256:createHash('sha256').update(built.outputFiles[0].contents).digest('hex'),fixtureOnly:true,serverModel:true,limits:['Synthetic identities and HTTP adapter; no real account, WebSocket or device','Actual RoomChrome with local state; not a full platform-shell capture','No production flags or content enabled']},null,2));await browser.close();}
});
