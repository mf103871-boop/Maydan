import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {post} from '../src/online/client.js';
import {normalizeCode,validCode,ROOM_CAPABILITIES} from '../src/online/shared.js';
import {createAudioEvents} from '../src/shared/fx/audio-events.js';
import {emitRoomReceipt} from '../src/shared/fx/room-audio.js';

// Run actual async HTTP callers, without React/UI or a hosted account. Real post
// response handling and real semantic bus are retained; only transport/storage
// and navigation are controlled. No production request can leave this fixture.
const source=readFileSync(new URL('../src/online/Online.jsx',import.meta.url),'utf8');
function actualFunction(name,next,context){
  const start=source.indexOf(`  async function ${name}(`),end=source.indexOf(next.startsWith('const ')?`  ${next}`:`  async function ${next}(`,start);
  assert.ok(start>=0&&end>start,`actual ${name} caller found`);
  return new Function(...Object.keys(context),`${source.slice(start,end)}\nreturn ${name};`)(...Object.values(context));
}
function fixture(){
  const played=[],requests=[],joined=[],writes=[],notices=[],navigations=[];
  const bus=createAudioEvents(cue=>{played.push(cue);return true;});
  const account={user:{id:'owner'},authHeaders:()=>({Authorization:'Bearer synthetic-only'})};
  let settle,owner='owner',current=true;
  const transport=()=>new Promise(resolve=>{settle=resolve;});
  const context={
    busy:false,setError(){},name:'ضيف الاختبار',mode:'join',game:'meenfina',account,mafiaCreationBlocked:false,rewarded:false,
    normalizeCode,code:'123456',validCode,ROOM_CAPABILITIES,initialObserver:false,entryLifetime:{current:{generation:1}},
    setBusy(){},SERVER:'http://localhost:3000',readSaved:()=>({id:'seat',token:'synthetic-only'}),
    credentialsRef:{current:null},newCredentials(){throw new Error('unexpected credentials');},deviceId:()=> 'synthetic-device',roomVisibility:'private',
    directoryMode:'basic',directoryVoice:'off',setDirectoryRefresh(){},
    save:(...args)=>{writes.push(args.slice(1));return true;},avatar:0,rounds:3,
    post:async(server,path,body,options)=>{requests.push({path,body});return post(server,path,body,{...options,fetchImpl:transport});},
    requestCurrent:(value,generation)=>current&&owner===value&&generation===1,
    socialJoinFallbackKey:()=> 'synthetic-fallback',emitRoomReceipt,platform:{sound:bus},sound:bus,
    entryAccountRef:{current:account},onJoined:(...args)=>joined.push(args),
    exitTarget:'/online',observerSession:false,session:{id:'seat',token:'synthetic-only'},
    accountRef:{current:account},clearCurrent:()=>writes.push(['clearCurrent']),toast:text=>notices.push(text),
    eventAudio:{current:{dispose(){}}},clientRef:{current:{stop(){}}},setExitGuard(){},
    onLeft(){},navigate:(...args)=>navigations.push(args),
  };
  return{context,played,requests,joined,writes,notices,navigations,
    finish(ok=true){assert.ok(settle,'a real post has reached its injected transport');settle(new Response(JSON.stringify(ok?{code:'123456'}:{error:'FULL'}),{status:ok?200:409}));},
    switchOwner(){owner='other';context.entryAccountRef.current={...account,user:{id:'other'}};context.accountRef.current=context.entryAccountRef.current;},
    dispose(){current=false;},
  };
}
test('actual Entry HTTP join sounds only after accepted response; reject, late account and disposed entry stay silent',async()=>{
  for(const flow of ['create','join'])for(const mode of ['accepted','rejected','owner-changed','disposed']){
    const f=fixture();f.context.mode=flow;const submit=actualFunction('submit','joinPublicRoom',f.context);
    const pending=submit({preventDefault(){}});assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,flow==='create'?'/api/rooms':'/api/rooms/123456/join');assert.deepEqual(f.played,[]);
    if(mode==='owner-changed')f.switchOwner();if(mode==='disposed')f.dispose();f.finish(mode!=='rejected');await pending;
    assert.deepEqual(f.played,mode==='accepted'?['pop']:[],mode);
    assert.equal(f.joined.length,mode==='accepted'?1:0,mode);
  }
});
test('actual public-directory admission uses the same accepted-owner gate, not the click or rejection',async()=>{
  for(const mode of ['accepted','rejected','owner-changed']){
    const f=fixture(),join=actualFunction('joinPublicRoom','const helpActions=',f.context);
    const pending=join('123456');assert.equal(f.requests.length,1);assert.deepEqual(f.played,[]);
    if(mode==='owner-changed')f.switchOwner();f.finish(mode!=='rejected');await pending;
    assert.deepEqual(f.played,mode==='accepted'?['pop']:[],mode);assert.equal(f.joined.length,mode==='accepted'?1:0);
  }
});
test('actual confirmed HTTP leave sounds once; failed leave has no exit success or victory',async()=>{
  for(const accepted of [true,false]){
    const f=fixture(),leave=actualFunction('leave','promoteObserver',f.context);
    const pending=leave();assert.deepEqual(f.played,[]);assert.equal(f.requests[0].path,'/api/rooms/123456/leave');
    f.finish(accepted);await pending;assert.deepEqual(f.played,accepted?['pass']:[]);
    assert.equal(f.navigations.length,1,'existing navigation semantics unchanged');
    assert.equal(f.notices.length,accepted?0:1,'failed transport keeps its existing reserved-seat notice');
  }
});
