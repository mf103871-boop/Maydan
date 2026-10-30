import test from 'node:test';
import assert from 'node:assert/strict';
import { CallMedia } from '../src/social/media.js';
import { MafiaVoiceSession } from '../src/social/mafia-voice-session.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const snapshot=(epoch,phase)=>({game:'mafia',code:'123456',phase,you:{id:'seat',roleId:'citizen'},members:[{id:'seat',alive:true}],mafiaVoice:{callId:'match-call',mediaEpoch:epoch,canPublish:phase!=='night'}});

function sdkFixture(){
  const rooms=[],connections=[];
  const events=Object.fromEntries(['ParticipantConnected','ParticipantDisconnected','ActiveSpeakersChanged','TrackMuted','TrackUnmuted','LocalTrackPublished','LocalTrackUnpublished','TrackSubscribed','TrackUnsubscribed','Reconnecting','Reconnected','Disconnected'].map(name=>[name,name]));
  class Room{
    constructor(){this.handlers=new Map();this.remoteParticipants=new Map();this.localParticipant={identity:'self',name:'أنت',isMicrophoneEnabled:false,setMicrophoneEnabled:async enabled=>{this.localParticipant.isMicrophoneEnabled=enabled;}};rooms.push(this);}
    on(name,handler){this.handlers.set(name,handler);return this;}
    emit(name,...args){this.handlers.get(name)?.(...args);}
    async connect(url,token){connections.push({url,token});}
    async disconnect(){this.emit('Disconnected');}
  }
  return{rooms,connections,sdk:{Room,RoomEvent:events,Track:{Kind:{Audio:'audio'}}}};
}

function fixture(t){
  const transport=sdkFixture(),requests=[],updates=[];let session,active,terminalStops=0;
  const server={epoch:2,quiet:false,hold:false,release:null,failure:null};
  const media=new CallMedia(state=>{
    updates.push({...state});session?.mediaChanged(state);
    // The provider's terminal-call condition must never observe the deliberate
    // server transport retirement as a user hang-up.
    if(active&&state.callId===active.id&&state.ended){terminalStops++;void session.stop();}
  },{loadSDK:async()=>transport.sdk});
  media.setAccount('account');
  session=new MafiaVoiceSession({media,deviceId:async()=>'device',setCall:call=>{active=call;},request:async(_code,body)=>{
    requests.push({...body});if(body.operation==='leave')return{};
    if(server.hold){server.hold=false;await new Promise(resolve=>{server.release=resolve;});}
    if(server.failure)throw Object.assign(new Error(server.failure),{code:server.failure});
    return{call:{id:'match-call',scope:'mafia',conversationId:'123456',voiceSessionId:body.voiceSessionId},voiceSessionId:body.voiceSessionId,
      mediaEpoch:server.epoch,canPublish:!server.quiet,quiet:server.quiet,unchanged:body.knownEpoch===server.epoch,
      ...(body.knownEpoch===server.epoch?{}:{connection:server.quiet?null:{url:'wss://fixture.invalid',token:`fresh-epoch-${server.epoch}`}})};
  }});
  session.configure(snapshot(2,'opening'));
  t.after(async()=>{server.release?.();await session.stop({notify:false});await media.dispose();});
  return{...transport,media,session,server,requests,updates,get terminalStops(){return terminalStops;}};
}

test('provider retirement before the phase snapshot preserves one requested call through day, quiet night, and next day',async t=>{
  const f=fixture(t);await f.session.start();await f.session.mute(false);
  const nonce=f.session.voiceSessionId,oldRoom=f.rooms[0];
  assert.equal(f.media.state.connected,true);assert.equal(oldRoom.localParticipant.isMicrophoneEnabled,true);
  f.server.hold=true;oldRoom.emit('Disconnected');await tick();
  assert.equal(f.terminalStops,0);assert.equal(f.session.state.requested,true);
  assert.equal(f.media.state.ended,false);assert.equal(f.media.state.muted,true);assert.equal(f.media.state.canPublish,false);
  assert.deepEqual(f.media.state.participants,[]);assert.equal(f.session.state.status,'reconnecting');
  assert.equal(f.connections.length,1,'the retired token must never reconnect while fresh authorization is pending');
  assert.equal(f.requests.at(-1).knownEpoch,-1);
  f.server.epoch=3;f.server.quiet=true;f.session.configure(snapshot(3,'night'));f.server.release();await f.session.pending;
  assert.equal(f.session.state.status,'silent');assert.equal(f.session.state.requested,true);assert.equal(f.connections.length,1);
  await assert.rejects(f.session.mute(false),/مغلق/);
  f.server.epoch=4;f.server.quiet=false;f.session.configure(snapshot(4,'discussion'));await f.session.pending;
  assert.equal(f.session.state.status,'connected');assert.equal(f.media.state.connected,true);
  assert.deepEqual(f.connections.map(value=>value.token),['fresh-epoch-2','fresh-epoch-4']);
  assert.equal(f.requests.filter(value=>value.operation==='join').length,1,'next day never asks the player to join again');
  assert.ok(f.requests.every(value=>value.voiceSessionId===nonce));assert.equal(f.terminalStops,0);
  const state=f.media.state;oldRoom.emit('Disconnected');oldRoom.emit('Reconnected');assert.equal(f.media.state,state,'late retired SDK events cannot repaint or terminate the new audience');
});

test('an AUTH rejection during transport recovery ends the requested call without reconnecting an old token',async t=>{
  const f=fixture(t);await f.session.start();f.server.failure='AUTH';f.rooms[0].emit('Disconnected');await tick();await tick();
  assert.equal(f.session.state.requested,false);assert.equal(f.session.state.status,'off');assert.equal(f.connections.length,1);
  assert.equal(f.media.state.connected,false);assert.deepEqual(f.session.state.participants,[]);
});

test('an unchanged reply already in flight is discarded after provider retirement and immediately refetched with a fresh grant',async t=>{
  const f=fixture(t);await f.session.start();f.server.hold=true;const pending=f.session.sync();await tick();
  assert.equal(f.requests.at(-1).knownEpoch,2);f.rooms[0].emit('Disconnected');await tick();
  f.server.release();await pending;
  assert.deepEqual(f.requests.map(value=>value.knownEpoch),[-1,2,-1]);
  assert.equal(f.session.state.status,'connected');assert.equal(f.terminalStops,0);assert.equal(f.connections.length,2);
  assert.ok(f.connections.every(value=>typeof value.token==='string'),'no tokenless transition from unchanged:true');
});

test('definitive server denials stop recovery rather than repeatedly retrying an inaccessible call',async t=>{
  for(const code of ['NOT_FOUND','CALL_NOT_FOUND','CALL_FORBIDDEN','FORBIDDEN','BLOCKED','CALL_ANSWERED']){
    const f=fixture(t);await f.session.start();f.server.failure=code;f.rooms[0].emit('Disconnected');await tick();await tick();
    assert.equal(f.session.state.requested,false,code);assert.equal(f.connections.length,1,code);await f.media.dispose();
  }
});

test('a voluntary leave fences a recovery response and cannot silently reconnect',async t=>{
  const f=fixture(t);await f.session.start();f.server.hold=true;f.rooms[0].emit('Disconnected');await tick();
  const recovery=f.session.pending;await f.session.stop();f.server.epoch=3;f.server.release();await recovery;
  assert.equal(f.session.state.requested,false);assert.equal(f.connections.length,1);assert.equal(f.media.state.connected,false);
});

test('ordinary social call disconnection remains terminal',async t=>{
  const f=sdkFixture(),media=new CallMedia(()=>{},{loadSDK:async()=>f.sdk});media.setAccount('account');t.after(()=>media.dispose());
  await media.connect({call:{id:'social',scope:'direct'},connection:{url:'wss://fixture.invalid',token:'social-token'}},{muted:true});
  f.rooms[0].emit('Disconnected');assert.equal(media.state.ended,true);assert.equal(media.state.connected,false);assert.equal(media.state.authorizationRequired,false);
});
