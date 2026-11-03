// Actual room client, semantic bus and game components; only the socket/provider
// boundary is synthetic. No account, microphone, media service or remote room.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium,webkit} from 'playwright';
import {presentationCssPlugin} from '../scripts/presentation-css.mjs';

const fixtureSource=`import React from 'react';import{createRoot}from'react-dom/client';
import{PreviewProviders}from'./src/design/preview-platform.jsx';import{createDesignFixture}from'./src/design/screen-catalog.js';
import{PlatformContext,usePlatform}from'./src/platform/context.js';import{BadeehaMatch}from'./src/online/Badeeha.jsx';import{FabrakaMatch}from'./src/online/Fabraka.jsx';import{ErsomhaMatch}from'./src/online/Ersomha.jsx';
import{createAudioEvents}from'./src/shared/fx/audio-events.js';import{createRoomAudioAdapter,bindRoomAudioCommands}from'./src/shared/fx/room-audio.js';import{RoomClient}from'./src/online/client.js';import{GAME_PROTOCOLS}from'./src/online/shared.js';
import{MafiaLobby}from'./src/online/Mafia.jsx';
const root=createRoot(document.getElementById('root'));let client,audio,fixture,current,kind,serial=0;window.sounds=[];window.direct=[];window.rejections=[];
const bus=createAudioEvents((cue,options)=>{if(options.guard())window.sounds.push(cue);return true;});
const sound={emit:(...args)=>bus.emit(...args),play:name=>window.direct.push(name),music:{setSuppressed(){},setDucking(){},scene(){},releaseScene(){}},setSuppressed(){},setDucking(){}};
class Socket{static latest;constructor(){this.readyState=1;this.sent=[];Socket.latest=this;}send(data){this.sent.push(JSON.parse(data));}close(){this.readyState=3;}receive(data){this.onmessage({data:JSON.stringify(data)});}}
const context={ownerId:'browser-owner',seatId:'design-player-1',code:'123456'};
function View(){const platform=usePlatform();const Component=kind==='badeeha'?BadeehaMatch:kind==='fabraka'?FabrakaMatch:kind==='mafia'?MafiaLobby:ErsomhaMatch;const act=async(type,fields)=>{if(kind==='mafia')return true;try{await client.command(type,fields);return true;}catch(error){window.rejections.push(error.code);return false;}};if(window.semanticMafia)act.audioAccepted=true;const props={state:current,me:fixture.me,isHost:true,disabled:false,clockOffset:0,status:'connected',drawerReady:true,client,act};return <PlatformContext.Provider value={{...platform,sound}}><div data-case={kind} data-revision={current.revision}><Component {...props}/></div></PlatformContext.Provider>;}
function paint(){root.render(<PreviewProviders sceneId={'online.'+kind+'.reveal'}><View/></PreviewProviders>);}
function snapshot(extra={}){const state={...current,...extra,_designPreview:false,serverNow:Date.now(),protocol:GAME_PROTOCOLS[kind],code:'123456'};Socket.latest.receive({type:'state',state});}
window.roomAudioCase=(game,phase='reveal')=>{audio?.dispose();client?.stop();kind=game;fixture=createDesignFixture(game==='ersomha'?'ersomha.draw.drawer':'online.'+game+'.'+phase,{now:Date.now()});current={...fixture.state,revision:1,code:'123456',_designPreview:false};window.sounds=[];window.direct=[];window.rejections=[];bus.reset('fixture-'+ ++serial);
 audio=createRoomAudioAdapter(sound);client=new RoomClient({server:location.origin,code:'123456',session:{id:context.seatId,token:'isolated-fixture'},WebSocketImpl:Socket,onStatus:status=>audio.connection(status,context),onState:state=>{audio.update(state,{...context,receivedAt:Date.now()});current=state;paint();}});bindRoomAudioCommands(client,audio);client.start();Socket.latest.onopen();snapshot();};
window.pushRoomAudio=(extra)=>snapshot({...extra,revision:extra.revision??current.revision+1});
window.lastCommand=()=>Socket.latest.sent.filter(value=>value.type!=='auth').at(-1);
window.ackRoomAudio=(ok=true)=>{const command=window.lastCommand();Socket.latest.receive({type:'ack',requestId:command.requestId,ok,...(!ok?{error:'STALE'}:{})});};
window.disconnectRoomAudio=()=>{audio.connection('reconnecting',context);audio.connection('connected',context);};
window.hideRoomAudio=()=>audio.suspend();window.closeRoomAudio=()=>{audio?.dispose();client?.stop();root.unmount();};
window.showMafiaReady=semantic=>{audio?.dispose();client?.stop();kind='mafia';window.semanticMafia=semantic;fixture=createDesignFixture('online.mafia.lobby',{now:Date.now()});current=fixture.state;paint();};
window.roomAudioCase('badeeha','reveal');`;

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(`${name}: real game mounts stay silent; live public transitions and matching ACK sound once`,{timeout:90_000},async t=>{
  const bundle=await build({stdin:{contents:fixtureSource,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',plugins:[presentationCssPlugin()],loader:{'.js':'jsx','.css':'text','.json':'json','.webp':'dataurl','.png':'dataurl','.woff2':'dataurl'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  const publicRoot=path.resolve('public'),errors=[],requests=[];
  const server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://fixture').pathname;
    if(pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.outputFiles[0].contents);}
    if(pathname.startsWith('/assets/')){const file=path.resolve(publicRoot,'.'+pathname);if(file.startsWith(publicRoot+path.sep))try{const bytes=await readFile(file);res.setHeader('content-type',file.endsWith('.webp')?'image/webp':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');return res.end(bytes);}catch{/* Missing assets remain404. */}res.writeHead(404);return res.end();}
    res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await engine.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:844}}),origin=`http://127.0.0.1:${server.address().port}`;
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin||route.request().url().startsWith('data:')?route.continue():route.abort());
  await page.goto(origin);await page.locator('[data-case=badeeha]').waitFor();await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(()=>({semantic:window.sounds,direct:window.direct})),{semantic:[],direct:[]},'initial historical reveal never plays');
  await page.evaluate(()=>window.roomAudioCase('badeeha','question'));await page.locator('[data-case=badeeha] [data-design-id=reveal]').waitFor();
  assert.equal(await page.locator('[data-design-id=reveal]').getAttribute('data-sound'),'none');
  await page.locator('[data-design-id=reveal]').click();assert.equal((await page.evaluate(()=>window.lastCommand())).type,'reveal');
  await page.evaluate(()=>window.ackRoomAudio(false));assert.deepEqual(await page.evaluate(()=>window.sounds),[],'rejected action has no success');
  await page.locator('[data-design-id=reveal]').click();await page.evaluate(()=>{window.pushRoomAudio({phase:'reveal',deadlineAt:null});window.ackRoomAudio(true);});
  await page.locator('[data-design-id=answer]').waitFor();assert.deepEqual(await page.evaluate(()=>window.sounds),['reveal'],'public projection alone owns reveal');
  assert.deepEqual(await page.evaluate(()=>window.direct),[]);
  await page.evaluate(()=>{window.disconnectRoomAudio();window.pushRoomAudio({revision:20});});await page.waitForTimeout(50);
  assert.equal((await page.evaluate(()=>window.sounds)).filter(cue=>cue==='reveal').length,1,'reconnected retained reveal remains history');
  await page.evaluate(()=>window.roomAudioCase('fabraka','reveal'));await page.locator('[data-case=fabraka]').waitFor();await page.waitForTimeout(100);assert.deepEqual(await page.evaluate(()=>window.sounds),[]);assert.deepEqual(await page.evaluate(()=>window.direct),[],'no mount drumroll');
  await page.evaluate(()=>window.pushRoomAudio({reveal:{shown:true,options:[{id:'public-option',text:'خيار معلن'}]}}));await page.waitForTimeout(50);assert.deepEqual(await page.evaluate(()=>window.sounds),['reveal']);
  await page.evaluate(()=>{window.hideRoomAudio();window.pushRoomAudio({phase:'discussion'});});await page.waitForTimeout(50);assert.deepEqual(await page.evaluate(()=>window.sounds),['reveal'],'background restore baselines new phase');
  await page.evaluate(()=>window.roomAudioCase('ersomha'));await page.locator('[data-case=ersomha] canvas').waitFor();
  await page.evaluate(()=>window.pushRoomAudio({guessedIds:['design-player-3','design-player-2','design-player-4']}));await page.waitForTimeout(150);assert.deepEqual(await page.evaluate(()=>window.sounds),['correct'],'multiple public guesses coalesce');
  await page.evaluate(()=>window.pushRoomAudio({publicWord:{letters:[{index:0,char:'ق'}],wordLengths:[4]}}));await page.waitForTimeout(30);assert.deepEqual(await page.evaluate(()=>window.sounds),['correct','pop']);
  await page.evaluate(()=>window.showMafiaReady(false));await page.locator('[data-case=mafia] [data-design-id=ready]').waitFor();
  assert.equal(await page.locator('[data-case=mafia] [data-design-id=ready]').getAttribute('data-sound'),null,'local shared tutorial action keeps its existing tap');
  await page.evaluate(()=>window.showMafiaReady(true));await page.waitForFunction(()=>document.querySelector('[data-case=mafia] [data-design-id=ready]')?.getAttribute('data-sound')==='none');
  assert.equal(await page.locator('[data-case=mafia] [data-design-id=start]').getAttribute('data-sound'),'none','network shared action uses its accepted/public owner');
  assert.deepEqual(errors,[]);assert.equal(requests.some(value=>value.startsWith('/api/')),false,'only fixture socket/public asset reads');
  const output=process.env.ROOM_AUDIO_QA_OUT;if(output){await mkdir(output,{recursive:true});await writeFile(path.join(output,`${name}.json`),JSON.stringify({engine:name,actualComponents:['BadeehaMatch','FabrakaMatch','ErsomhaMatch'],actualRoomClient:true,actualSemanticBus:true,transportOnlySynthetic:true,initialHistorySilent:true,matchingAck:true,rejectedSilent:true,reconnectHistorySilent:true,coalescedGuesses:true,privateFieldsNotSoundInputs:true,errors,requests},null,2));}
  await page.evaluate(()=>window.closeRoomAudio());
});
