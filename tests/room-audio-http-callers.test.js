import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {post} from '../src/online/client.js';
import {normalizeCode,validCode,ROOM_CAPABILITIES} from '../src/online/shared.js';
import {createAudioEvents} from '../src/shared/fx/audio-events.js';
import {emitRoomReceipt} from '../src/shared/fx/room-audio.js';
import {ticketPolicyEnabled,gameplayOffer,badeehaFreeSelection,TICKET_POLICY,ENTRY_POLICY} from '../src/shared/account/gameplay-policy.mjs';
import {gameEntryPath} from '../src/platform/game-entry.mjs';
import {tr} from '../src/shared/i18n/core.js';
import {contentVersionFor} from '../src/shared/content-locale.mjs';

// Run actual async HTTP callers, without React/UI or a hosted account. Real post
// response handling and real semantic bus are retained; only transport/storage
// and navigation are controlled. No production request can leave this fixture.
const source=readFileSync(new URL('../src/online/Online.jsx',import.meta.url),'utf8');
function entryDeclaration(name){
  const line=source.split(/\r?\n/).find(line=>line.startsWith(`  const ${name} = `));
  assert.ok(line?.endsWith(';'),`actual ${name} declaration found`);
  return line;
}
function actualFunction(name,next,context){
  const start=source.indexOf(`  async function ${name}(`),end=source.indexOf(next.startsWith('const ')?`  ${next}`:`  async function ${next}(`,start);
  assert.ok(start>=0&&end>start,`actual ${name} caller found`);
  const declarations = name === 'submit' ? ['roomContentReady','topicsReady'] : name === 'joinPublicRoom' ? ['roomContentReady'] : [];
  const body = [...declarations.map(entryDeclaration),source.slice(start,end),`return ${name};`].join('\n');
  return new Function(...Object.keys(context),body)(...Object.values(context));
}
function fixture(gameplayPolicy=null){
  const played=[],requests=[],joined=[],writes=[],notices=[],navigations=[],preflights=[];
  const bus=createAudioEvents(cue=>{played.push(cue);return true;});
  const account={gameplayPolicy,user:{id:'owner'},authHeaders:()=>({Authorization:'Bearer synthetic-only'})};
  let settle,owner='owner',current=true;
  const transport=(url)=>{
    if (new URL(url).pathname==='/api/content/capabilities') {
      preflights.push(url);
      return Promise.resolve(Response.json(context.serverCapabilities || {}));
    }
    return new Promise(resolve=>{settle=resolve;});
  };
  const context={
    tr,contentLocale:'ar',contentVersionFor,preferredLocale:'ar',contentCapabilities:{},serverCapabilities:{},entryPack:{ready:true},
    busy:false,setError(){},name:'ضيف الاختبار',mode:'join',game:'meenfina',account,mafiaCreationBlocked:false,rewarded:false,joinOnly:false,gameEntryPath,
    normalizeCode,code:'123456',validCode,ROOM_CAPABILITIES,initialObserver:false,entryLifetime:{current:{generation:1}},
    ticketPolicyEnabled,gameplayOffer,badeehaFreeSelection,
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
  return{context,played,requests,joined,writes,notices,navigations,preflights,
    finish(ok=true){assert.ok(settle,'a real post has reached its injected transport');settle(new Response(JSON.stringify(ok?{code:'123456'}:{error:'FULL'}),{status:ok?200:409}));},
    switchOwner(){owner='other';context.entryAccountRef.current={...account,user:{id:'other'}};context.accountRef.current=context.entryAccountRef.current;},
    dispose(){current=false;},
  };
}
test('actual Entry HTTP join sounds only after accepted response with policy off/on; reject, late account and disposed entry stay silent',async()=>{
  for(const policy of [null,TICKET_POLICY,ENTRY_POLICY])for(const flow of ['create','join'])for(const mode of ['accepted','rejected','owner-changed','disposed']){
    const f=fixture(policy);f.context.mode=flow;const submit=actualFunction('submit','joinPublicRoom',f.context);
    const pending=submit({preventDefault(){}});assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,flow==='create'?'/api/rooms':'/api/rooms/123456/join');assert.deepEqual(f.played,[]);
    if(mode==='owner-changed')f.switchOwner();if(mode==='disposed')f.dispose();f.finish(mode!=='rejected');await pending;
    assert.deepEqual(f.played,mode==='accepted'?['pop']:[],mode);
    assert.equal(f.joined.length,mode==='accepted'?1:0,mode);
  }
});

test('join-only Entry redirects hosting to its game gate without HTTP admission or a success sound',async()=>{
  const f=fixture(ENTRY_POLICY);f.context.joinOnly=true;f.context.mode='create';
  const submit=actualFunction('submit','joinPublicRoom',f.context);
  await submit({preventDefault(){}});
  assert.deepEqual(f.requests,[]);assert.deepEqual(f.joined,[]);assert.deepEqual(f.played,[]);
  assert.deepEqual(f.navigations,[['/entry/meenfina']]);
});
test('actual public-directory admission uses the same accepted-owner gate, not the click or rejection',async()=>{
  for(const mode of ['accepted','rejected','owner-changed']){
    const f=fixture(),join=actualFunction('joinPublicRoom','const helpActions=',f.context);
    const pending=join('123456');assert.equal(f.requests.length,1);assert.deepEqual(f.played,[]);
    if(mode==='owner-changed')f.switchOwner();f.finish(mode!=='rejected');await pending;
    assert.deepEqual(f.played,mode==='accepted'?['pop']:[],mode);assert.equal(f.joined.length,mode==='accepted'?1:0);
  }
});
test('entry checks host and quick-match content while allowing an explicit room join to use the room language',async()=>{
  for(const phase of ['checking-capabilities','loading-pack','ready']){
    for(const flow of ['create','join','public-room','observe','quick-match']){
      const f=fixture(ENTRY_POLICY);
      Object.assign(f.context,{preferredLocale:'en',contentLocale:'en',game:'mafia',mafiaSettings:{},
        contentCapabilities:phase==='checking-capabilities'?null:{localizedContent:1,contentVersions:{en:'new-en'}},
        serverCapabilities:{localizedContent:1,contentVersions:{en:'new-en'}},
        entryPack:{ready:phase!=='loading-pack'},mode:flow==='create'?'create':'join'});
      const isForm=flow==='create'||flow==='join';
      const call=isForm?actualFunction('submit','joinPublicRoom',f.context):actualFunction('joinPublicRoom','const helpActions=',f.context);
      const pending=isForm?call({preventDefault(){}}):call(flow==='quick-match'?undefined:'123456',flow==='observe');
      assert.deepEqual(f.played,[],`${phase} ${flow} does not play on tap`);
      if(phase!=='ready'&&(flow==='create'||flow==='quick-match')){
        await pending;
        assert.deepEqual(f.requests,[]);assert.deepEqual(f.writes,[]);assert.deepEqual(f.joined,[]);
        continue;
      }
      assert.equal(f.requests.length,1,`${phase} ${flow} posts exactly once`);
      const expected=flow==='create'?'/api/rooms':flow==='quick-match'?'/api/matchmaking/join':flow==='observe'?'/api/rooms/123456/observe':'/api/rooms/123456/join';
      assert.equal(f.requests[0].path,expected);
      if(flow==='create')assert.equal(f.requests[0].body.contentVersion,'new-en');
      if(['join','public-room','observe'].includes(flow)){
        assert.equal(Object.hasOwn(f.requests[0].body,'contentLocale'),false);
        assert.equal(Object.hasOwn(f.requests[0].body,'community'),false);
        assert.deepEqual(f.preflights,[],`${flow} never probes the host's new-English capability`);
      }
      if (f.requests[0].body.contentLocale==='en') await new Promise(resolve=>setImmediate(resolve));
      f.finish();await pending;
      assert.deepEqual(f.played,['pop'],`${phase} ${flow} plays only on acceptance`);assert.equal(f.joined.length,1);
    }
  }
});

test('a server rollback blocks new English admission but not existing-room directory joins and observers',async()=>{
  for(const flow of ['create','quick-match','public-room','observe']){
    const f=fixture();
    Object.assign(f.context,{game:'mafia',mafiaSettings:{},mode:'create',preferredLocale:'en',contentLocale:'en',
      contentCapabilities:{localizedContent:1,contentVersions:{en:'new-en'}},entryPack:{ready:true},serverCapabilities:{}});
    const pending=flow==='create'?actualFunction('submit','joinPublicRoom',f.context)({preventDefault(){}}):
      actualFunction('joinPublicRoom','const helpActions=',f.context)(flow==='quick-match'?undefined:'123456',flow==='observe');
    const newMatch=flow==='create'||flow==='quick-match';
    if(!newMatch)f.finish();
    await pending;
    assert.equal(f.preflights.length,newMatch?1:0);assert.equal(f.joined.length,newMatch?0:1);
    assert.deepEqual(f.played,newMatch?[]:['pop']);
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
