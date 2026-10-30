import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium,webkit} from 'playwright';

let server,origin;
const source=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{MafiaMatchView,MafiaDirectory}from'./src/online/Mafia.jsx';import{createMafiaVisualFixture}from'./src/games/mafia/preview-fixtures.js';import ui from'./src/shared/ui/ui.css';
function App(){const initial=createMafiaVisualFixture('discussion');const[p,set]=useState({...initial,accountId:'local-owner'});window.commands??=[];window.change=(patch)=>flushSync(()=>set(old=>({...old,...patch,state:{...old.state,...patch.state}})));window.show=(kind,extra={})=>flushSync(()=>set({...createMafiaVisualFixture(kind),accountId:'local-owner',...extra}));return <><style>{ui}</style>{p.directory?<MafiaDirectory enabled rooms={[{code:'123456',roomName:'عرض محلي',players:3,capacity:8,mode:'classic',voiceMode:'off'}]} disabled={p.directoryDisabled} footer={null} onCreate={()=>{}}/>:<MafiaMatchView {...p} isHost voice={{simulated:true,status:'off',onJoin:()=>window.commands.push({type:'simulated-voice'})}} act={(type,fields)=>{window.commands.push({type,...fields});return true;}} onSafety={()=>{}}/>}</>;}createRoot(document.getElementById('root')).render(<App/>);`;

before(async()=>{
  const result=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl'},logLevel:'silent'});
  const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;height:100%;width:100%}body{font-family:Arial,sans-serif}*{box-sizing:border-box}</style><div id="root"></div><script src="/bundle.js"></script></html>';
  server=createServer(async(request,response)=>{
    if(request.url==='/bundle.js'){response.setHeader('content-type','text/javascript');response.end(result.outputFiles[0].contents);return;}
    if(request.url==='/'){response.setHeader('content-type','text/html;charset=utf-8');response.end(html);return;}
    const file=path.resolve('public','.'+new URL(request.url,'http://local').pathname);
    if(file.startsWith(path.resolve('public')+path.sep))try{response.end(await readFile(file));return;}catch{/* no other files */}
    response.writeHead(204);response.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));});

for(const[name,engine]of[['chromium',chromium],['webkit',webkit]])test(`dense Mafia ${name}: layout, history anchor, decisions, private cover and event identity`,async()=>{
  const browser=await engine.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
  try{
    await page.goto(origin);await page.locator('[data-design-id="message-input"]').waitFor();
    for(const[width,height]of[[360,640],[390,844],[430,932],[844,390],[1024,768]]) {
      await page.setViewportSize({width,height});
      const geometry=await page.evaluate(()=>{
        const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
        return{overflow:document.documentElement.scrollWidth>innerWidth+1,composer:rect('[data-design-id="composer"]'),timer:rect('[data-design-id="timer"]'),timeline:rect('[data-design-id="messages"]'),seats:[...document.querySelectorAll('[data-design-id="player-seat"]')].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))};
      });
      assert.equal(geometry.overflow,false,`${name} ${width} no horizontal page overflow`);assert.equal(geometry.seats.length,12);
      assert.ok(geometry.seats.every(seat=>seat.width>=44&&seat.height>=44));assert.ok(geometry.composer.bottom<=height+1&&geometry.composer.y>=0);
      assert.ok(geometry.timer.y>=0&&geometry.timer.bottom<=height);assert.ok(geometry.timeline.height>=65,`${name} ${width} timeline remains readable`);
    }
    await page.setViewportSize({width:320,height:568});
    await page.evaluate(()=>{document.documentElement.dataset.callDockActive='true';});
    const reserved=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,seats:[...document.querySelectorAll('[data-design-id="player-seat"]')].map(el=>el.getBoundingClientRect().width)}));
    assert.equal(reserved.overflow,false,'floating call clearance cannot create horizontal overflow');assert.ok(reserved.seats.every(width=>width>=44),'reserved call space preserves all seat touch targets');
    await page.evaluate(()=>{delete document.documentElement.dataset.callDockActive;});
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-design-id="message-input"]').fill('كتابة عربية دون تكبير');
    await page.setViewportSize({width:390,height:420});
    const keyboard=await page.locator('[data-design-id="composer"]').boundingBox();assert.ok(keyboard.y>=0&&keyboard.y+keyboard.height<=420);
    await page.locator('[data-design-id="player-seat"]').last().scrollIntoViewIfNeeded();
    assert.ok(await page.locator('[data-design-id="player-seat"]').last().isVisible(),'all12 seats remain reachable beside a shortened viewport');
    assert.equal(await page.locator('[data-design-id="message-input"]').evaluate(el=>getComputedStyle(el).fontSize),'16px');
    await page.locator('[data-design-id="message-input"]').evaluate(el=>el.blur());await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>window.change({state:{phase:'night',phaseId:2,serverNow:Date.now()}}));
    await page.locator('[data-event-kind="night"]').waitFor();assert.equal(await page.locator('[data-design-id="event-overlay"]').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.evaluate(()=>window.change({connection:'reconnecting',state:{phase:'dawn',phaseId:3}}));
    await page.evaluate(()=>window.change({connection:'connected',state:{phase:'discussion',phaseId:4}}));
    assert.equal(await page.locator('[data-design-id="event-overlay"]').count(),0,'a reconnect transition never replays its history');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>{const now=Date.now();window.change({state:{matchId:202,chats:{public:Array.from({length:125},(_,i)=>({id:'history-'+i,at:now-30_000+i*100,playerId:'local-display-2',text:'الرسالة رقم '+i})),team:[],observers:[]}}});});
    const messages=page.locator('[data-design-id="messages"]');await page.locator('[data-design-id="load-older"]').waitFor();
    await messages.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
    await page.locator('[data-design-id="load-older"]').click();
    const anchor=await messages.evaluate(el=>{const bounds=el.getBoundingClientRect();const row=[...el.querySelectorAll('[data-timeline-id]')].find(item=>item.getBoundingClientRect().top>=bounds.top&&item.getBoundingClientRect().bottom<=bounds.bottom);return{key:row?.dataset.timelineId,top:row?.getBoundingClientRect().top,scroll:el.scrollTop};});
    await page.evaluate(()=>window.change({state:{chats:{public:[...Array.from({length:125},(_,i)=>({id:'history-'+i,at:Date.now()-30_000+i*100,playerId:'local-display-2',text:'الرسالة رقم '+i})),{id:'new-message',at:Date.now(),playerId:'local-display-2',text:'NEW_VISIBLE_MESSAGE'}],team:[],observers:[]}}}));
    await page.locator('[data-design-id="new-messages"]').waitFor();
    const afterAnchor=await page.locator(`[data-timeline-id="${anchor.key}"]`).boundingBox();assert.ok(Math.abs(afterAnchor.y-anchor.top)<=2,'new messages preserve the reading anchor '+JSON.stringify({anchor,afterAnchor,scroll:await messages.evaluate(el=>el.scrollTop)}));
    while(await page.locator('[data-design-id="load-older"]').count())await page.locator('[data-design-id="load-older"]').click();
    assert.ok(await page.locator('[data-timeline-id="message:history-0"]').count(),'earliest received message can be loaded');
    await page.evaluate(()=>window.show('nomination'));await page.locator('[data-design-id="action-open"]').click();
    await page.locator('[data-design-id="player-seat"][data-player-id="local-display-2"]').click();
    assert.equal(await page.evaluate(()=>window.commands.length),0,'selecting a player never submits a decision');
    await page.locator('[data-design-id="ability-submit"]').click();assert.equal(await page.evaluate(()=>window.commands.length),0,'confirmation retains the final choice');
    await page.locator('[data-design-id="confirm"]').click();assert.equal(await page.evaluate(()=>window.commands.at(-1).type),'nominate');
    await page.evaluate(()=>window.show('discussion'));
    await page.locator('[data-design-id="role-toggle"]').click();await page.locator('[data-design-id="role-content"]').waitFor();
    assert.equal(await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));return document.querySelectorAll('[data-design-id="role-content"]').length;}),0);
    await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await page.locator('[data-design-id="role-toggle"]').waitFor();assert.equal(await page.locator('[data-design-id="role-content"]').count(),0);
    await page.evaluate(()=>window.change({state:{phase:'night',phaseId:11,serverNow:Date.now(),deadlineAt:Date.now()+35_000}}));
    await page.locator('[data-event-kind="night"]').waitFor();assert.equal(await page.locator('[data-design-id="event-overlay"]').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
    await page.evaluate(()=>window.change({accountId:'different-local-owner'}));assert.equal(await page.locator('[data-design-id="event-overlay"]').count(),0,'account switch drops the previous overlay immediately');
    await page.evaluate(()=>window.change({state:{chats:{public:[{id:'ending-sentinel',playerId:'local-display-2',text:'ENDING_HISTORY_SENTINEL',at:Date.now()}],team:[],observers:[]}}}));
    await page.evaluate(()=>window.change({state:{phase:'over',phaseId:12,reason:'faction',outcome:{faction:'town'},chats:{public:[],team:[],observers:[]}}}));
    await page.locator('[data-event-kind="ending"]').waitFor();
    await page.locator('[data-design-id="timeline-toggle"]').click();assert.ok(await page.getByText('ENDING_HISTORY_SENTINEL',{exact:true}).isVisible(),'ending retains the same received timeline cache');
    assert.equal(await page.locator('[data-design-id="message-input"]').count(),0,'finished matches never offer new composing');
    await page.evaluate(()=>window.change({directory:true,directoryDisabled:true}));
    await page.getByRole('button',{name:'خيارات الغرف والمساعدة'}).click();
    await page.locator('[data-design-id="directory-mode"]').waitFor();assert.equal(await page.locator('[data-design-id="directory-mode"]').isDisabled(),true);
    assert.equal(await page.locator('[data-design-id="create-public-room"]').isDisabled(),true);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const directory=path.resolve('.cache/mafia-dense-browser');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,name+'-passed.json'),JSON.stringify({engine:name,viewports:5,all12Seats:true,historyAnchor:true,confirmation:true,pagehidePrivacy:true,eventIdentity:true,externalRequests:0},null,2));
  }finally{await context.close();await browser.close();}
});
