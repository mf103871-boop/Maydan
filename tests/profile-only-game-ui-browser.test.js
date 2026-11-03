// Production game/chat/reaction views with explicitly synthetic providers.
// No room, account, microphone, provider or purchase service is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { presentationCssPlugin } from '../scripts/presentation-css.mjs';

const cases=['home','setup.jabeen','setup.fabraka','badeeha.setup','beep.bomb.prompt','beep.bomb.over','mamnoo.play','mamnoo.over','jabeen.intro','jabeen.play','jabeen.review','jabeen.over','fabraka.local.write','fabraka.local.discussion','fabraka.local.over','meenfina.local.vote','meenfina.local.over','online.mafia.lobby','online.mafia.night','ersomha.draw.drawer','ersomha.over','online.badeeha.over','online.fabraka.over','online.meenfina.over'];
const output=path.resolve(process.env.PROFILE_ONLY_QA_OUT||'.cache/profile-only-game-ui');
// Real local PCM16 media, matching the existing voice e2e format. The Windows
// WebKit port rejects data: WAV despite playing the exact same bytes over HTTP.
const voice=Buffer.alloc(44+16000*2);voice.write('RIFF');voice.writeUInt32LE(voice.length-8,4);voice.write('WAVEfmt ',8);voice.writeUInt32LE(16,16);voice.writeUInt16LE(1,20);voice.writeUInt16LE(1,22);voice.writeUInt32LE(16000,24);voice.writeUInt32LE(32000,28);voice.writeUInt16LE(2,32);voice.writeUInt16LE(16,34);voice.write('data',36);voice.writeUInt32LE(voice.length-44,40);
const source=`import React,{useMemo,useState}from'react';import{createRoot}from'react-dom/client';import{PreviewProviders,PlatformDesignScene}from'./src/design/preview-platform.jsx';import{DesignScene}from'./src/design/preview-scenes.jsx';import{createDesignFixture}from'./src/design/screen-catalog.js';import{RoomChrome,RoomReactions}from'./src/online/Online.jsx';
function ReactionLab(){const[drawer,setDrawer]=useState(false);window.changeDrawer=setDrawer;const state={game:'ersomha',phase:'draw',draw:{drawerId:drawer?'me':'other'},members:[{id:'me',name:'أنا',connected:true},{id:'other',name:'صديق',connected:true}]};const client=useMemo(()=>({react:async emoji=>window.sentReactions.push(emoji),subscribeReactions:callback=>{window.oldReaction=()=>callback({id:'old-fixture-event',seatId:'other',emoji:'👏',reactionId:'sahra.sticker.1',at:1});return()=>{};}}),[]);return <RoomChrome state={state} code='123456' status='connected' onExit={()=>{}}><RoomReactions client={client} state={state} me={{id:'me'}} status='connected'/></RoomChrome>;}
function Harness(){const[id,setId]=useState('home');window.showProfileOnlyCase=setId;window.sentReactions=[];if(id==='reaction-test')return <PreviewProviders sceneId='online.chrome'><main data-case={id}><ReactionLab/></main></PreviewProviders>;const fixture=createDesignFixture(id),online=fixture.scene.mode==='online'||fixture.scene.game==='mafia'||fixture.scene.game==='ersomha',platform=['home','social.conversation','social.voice'].includes(id),content=platform?<PlatformDesignScene sceneId={id}/>:<DesignScene sceneId={id}/>;return <PreviewProviders key={id} sceneId={id} voiceFixtureUrl="/__fixture__/voice.wav"><main data-case={id} style={{padding:platform?0:12,maxWidth:600,margin:'0 auto'}}>{online&&fixture.state?<RoomChrome state={fixture.state} code='123456' status='connected' onExit={()=>{}}>{content}</RoomChrome>:content}</main></PreviewProviders>;}createRoot(document.getElementById('root')).render(<Harness/>);`;

for(const[name,engine]of[['chromium',chromium],['webkit',webkit]])test(`${name}: familiar game views and free chat/voice/reactions remain without council or extra Plus pickers`,{timeout:90000},async t=>{
  const result=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,metafile:true,format:'iife',jsx:'automatic',plugins:[presentationCssPlugin()],loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl'},define:{__MAYDAN_ROOMS_URL__:'"same-origin"',__MAYDAN_AUDIO_PREVIEW__:'false'},logLevel:'silent'});
  assert.equal(Object.keys(result.metafile.inputs).some(file=>/CouncilScene|CouncilGame|RoomLook|council-model|live-base/.test(file)),false,'removed experiments are outside the actual component graph');
  const publicRoot=path.resolve('public'),api=[],errors=[],requests=[];
  const server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://fixture').pathname;
    if(pathname==='/__fixture__/voice.wav'){res.writeHead(200,{'content-type':'audio/wav','content-length':voice.length,'accept-ranges':'bytes'});return res.end(voice);}
    if(pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(result.outputFiles[0].contents);}
    if(pathname.startsWith('/api/')){api.push(pathname);res.writeHead(404);return res.end('{}');}
    if(pathname.startsWith('/assets/')){const file=path.resolve(publicRoot,'.'+pathname);if(file.startsWith(publicRoot+path.sep))try{const bytes=await readFile(file);res.setHeader('content-type',file.endsWith('.webp')?'image/webp':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');return res.end(bytes);}catch{/* Real missing assets stay404. */}res.writeHead(404);return res.end();}
    res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await engine.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),origin=`http://127.0.0.1:${server.address().port}`;
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await page.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||url.protocol==='data:'?route.continue():route.abort();});
  await page.goto(origin);await page.waitForFunction(()=>typeof window.showProfileOnlyCase==='function');
  const banned='[data-council-render],[data-design-screen="council.scene"],.plus-room-atmosphere,.plus-room-entrance,[data-design-id="room-theme"],[data-design-id="council-skin"],.social-sticker-picker,.plus-room-stickers,.plus-setup-presets';
  const observations=[];
  async function show(id){await page.evaluate(id=>window.showProfileOnlyCase(id),id);await page.locator(`[data-case="${id}"]`).waitFor({state:'attached'});if(id==='ersomha.draw.drawer')await page.locator('canvas').first().waitFor();}
  for(const id of cases){await show(id);assert.equal(await page.locator(banned).count(),0,id);const size=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(size.scrollWidth<=size.width+1,id+JSON.stringify(size));observations.push({id,...size,council:false});}
  await show('reaction-test');const reactions=page.getByRole('group',{name:'تفاعل سريع'});assert.equal(await reactions.locator('button').count(),6);
  await reactions.getByRole('button',{name:'أرسل 😂',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.sentReactions),['😂']);
  await page.evaluate(()=>window.oldReaction());await page.locator('.plus-room-reaction-art').waitFor();assert.match(await page.locator('.plus-room-reaction-art').getAttribute('src'),/sahra-sticker-1\.svg/,'historical incoming stickers still display');
  await page.evaluate(()=>window.changeDrawer(true));await page.getByRole('group',{name:'التفاعل متوقف خلال دورك في الرسم'}).waitFor();assert.equal(await page.locator('.room-reactions button:disabled').count(),6,'drawing restrictions still apply to free reactions');
  await show('social.conversation');const input=page.getByRole('textbox',{name:'اكتب رسالة'});await input.fill('رسالة مجانية 😀');
  await page.getByRole('button',{name:'العودة للّمة',exact:true}).click();await page.locator('[data-design-id=friend-row] [data-design-id=friend-chat]').first().click();await input.waitFor();assert.equal(await input.inputValue(),'رسالة مجانية 😀','Back preserves the owner conversation draft');
  await page.getByRole('button',{name:'إرسال الرسالة',exact:true}).click();await page.locator('[role=log]').getByText('رسالة مجانية 😀',{exact:true}).waitFor();assert.equal(await input.inputValue(),'');
  await input.fill('مع لوحة المفاتيح');await input.focus();await page.setViewportSize({width:390,height:430});
  await page.waitForFunction(()=>{const box=document.querySelector('[data-design-id=composer]')?.getBoundingClientRect();return box&&box.bottom<=innerHeight+2&&box.height>40;});
  assert.equal(await input.inputValue(),'مع لوحة المفاتيح');assert.equal(await page.locator(banned).count(),0);
  await page.setViewportSize({width:390,height:844});await show('social.voice');await page.locator('[data-design-id=record]').waitFor();
  await page.getByRole('button',{name:'تشغيل الرسالة الصوتية',exact:true}).click();
  try{await page.waitForFunction(()=>[...document.querySelectorAll('.lamma-voice-message audio')].some(audio=>audio.currentTime>0&&!audio.error),null,{timeout:5000});}
  catch{const state=await page.locator('.lamma-voice-message audio').evaluate(audio=>({time:audio.currentTime,error:audio.error?.code,network:audio.networkState,ready:audio.readyState,paused:audio.paused,srcType:audio.src.split(';')[0],alert:audio.parentElement.querySelector('[role=alert]')?.textContent}));throw new Error('Fixture audio did not advance: '+JSON.stringify(state));}
  assert.equal(await page.locator(banned).count(),0);assert.equal(requests.some(url=>url.includes('/assets/council/v2/')),false);assert.deepEqual(api,[]);assert.deepEqual(errors,[]);
  await mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,`${name}-voice.png`),fullPage:true});await writeFile(path.join(output,`${name}.json`),JSON.stringify({engine:name,observations,freeReactions:6,historicalSticker:true,textAndUnicode:true,backAndDraft:true,shortViewportComposer:true,actualHTMLAudioAdvanced:true,syntheticProviders:true,physicalKeyboard:false,realMicrophone:false,api,pageErrors:errors},null,2));
});
