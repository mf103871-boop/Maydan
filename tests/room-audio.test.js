import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoomAudioAdapter,bindRoomAudioCommands,emitRoomReceipt} from '../src/shared/fx/room-audio.js';
import {RoomClient} from '../src/online/client.js';
import {createAudioEvents} from '../src/shared/fx/audio-events.js';
import {createSemanticAudioClock} from './helpers/semantic-audio-clock.js';

function fixture(){
  let time=1000, available=true;const calls=[],timers=new Map();let seq=0;
  const audio=createRoomAudioAdapter({emit:(type,options)=>{calls.push({type,...options});return true;}},{now:()=>time,available:()=>available,schedule:fn=>{timers.set(++seq,fn);return seq;},cancel:id=>timers.delete(id)});
  const context={ownerId:'owner',seatId:'a',code:'123456'};
  audio.connection('connected',context);
  return{audio,context,calls,flush(){const tasks=[...timers.values()];timers.clear();for(const fn of tasks)fn();},advance(ms){time+=ms;},available(value){available=value;},update(state,extra={}){return audio.update(state,{...context,...extra});}};
}
const members=[{id:'a',ready:true,connected:true,left:false},{id:'b',ready:false,connected:true,left:false}];
const state=(revision,extra={})=>({game:'fabraka',code:'123456',matchId:1,round:1,phase:'lobby',revision,hostId:'a',members,...extra});

test('initial, duplicate, history, revision gaps and delayed snapshots are consumed without invented events',()=>{
  const f=fixture();f.update(state(1,{phase:'reveal',reveal:{shown:true,options:[{id:'x'}]}}));f.flush();assert.equal(f.calls.length,0);
  f.update(state(1,{phase:'discussion'}));f.update(state(0));f.update(state(5,{phase:'write'}));f.flush();assert.equal(f.calls.length,0);
  f.update(state(6,{phase:'discussion'}),{receivedAt:1});f.update(state(7,{phase:'vote'}));f.flush();assert.equal(f.calls.length,0);
});
test('one lobby batch prioritizes all-ready over readiness, then immediate start cancels its pending cue',()=>{
  const f=fixture();f.update(state(1));
  const ready=members.map(member=>({...member,ready:true}));
  assert.equal(f.update(state(2,{members:ready})),'room.all-ready');
  assert.equal(f.update(state(3,{phase:'write',members:ready})),'room.started');f.flush();
  assert.deepEqual(f.calls.map(call=>call.type),['room.started']);
});
test('real membership changes coalesce; connected status and reserved seats do not look like leave/join',()=>{
  const f=fixture();f.update(state(1));
  f.update(state(2,{members:members.map(member=>({...member,connected:false}))}));f.flush();assert.equal(f.calls.length,0);
  const added=[...members,{id:'c',ready:false,connected:true}];
  f.update(state(3,{members:added}));f.update(state(4,{members:[...added,{id:'d',connected:true}]}));f.flush();
  assert.deepEqual(f.calls.map(call=>call.type),['room.members']);
});
test('all-ready follows actual public minima and excludes spectators, including Mafia ruleset2 and Meenfina',()=>{
  const roster=count=>Array.from({length:count},(_,index)=>({id:String(index),connected:true,ready:true}));
  for(const [game,rulesetVersion,mode,count,expected] of [['mafia',2,'basic',6,false],['mafia',2,'basic',8,true],['mafia',1,'shadow',8,false],['mafia',1,'shadow',9,true],['meenfina',1,undefined,2,false],['meenfina',1,undefined,3,true],['fabraka',1,'friends',2,false],['fabraka',1,'friends',3,true]]){
    const f=fixture(),ready=roster(count),waiting=ready.map((member,index)=>index===0?{...member,ready:false}:member);
    const extra={game,rulesetVersion,settings:{mode}};
    f.update(state(1,{...extra,members:waiting}));f.update(state(2,{...extra,members:ready}));f.flush();
    assert.equal(f.calls.some(call=>call.type==='room.all-ready'),expected,JSON.stringify({game,rulesetVersion,mode,count}));
  }
  const f=fixture(),ready=roster(8),spectator={id:'watcher',spectator:true,ready:false,connected:false};
  f.update(state(1,{game:'mafia',rulesetVersion:2,members:[...ready.map((member,index)=>index===0?{...member,ready:false}:member),spectator]}));
  f.update(state(2,{game:'mafia',rulesetVersion:2,members:[...ready,spectator]}));f.flush();assert.equal(f.calls.at(-1).type,'room.all-ready');
});
test('connection loss and restore are once-only; the reconnected state is silent history',()=>{
  const f=fixture();f.update(state(1,{phase:'write'}));
  f.audio.connection('reconnecting',f.context);f.audio.connection('reconnecting',f.context);
  f.audio.connection('connected',f.context);f.update(state(20,{phase:'reveal',reveal:{shown:true,options:[{id:'old'}]}}));f.flush();
  assert.deepEqual(f.calls.map(call=>call.type),['room.connection-lost','room.connection-restored']);
});
test('pending decode and batched events lose their guard across owner, room, phase, hidden, suspend and disposal',()=>{
  for(const change of ['owner','room','phase','hidden','suspend','dispose']){
    const f=fixture();f.update(state(1,{phase:'write'}));f.update(state(2,{phase:'discussion'}));
    const guard=f.calls[0].guard;assert.equal(guard(),true);
    if(change==='owner')f.update(state(3),{ownerId:'other'});
    else if(change==='room')f.update(state(3,{code:'654321'}),{code:'654321'});
    else if(change==='phase')f.update(state(3,{phase:'vote'}));
    else if(change==='hidden')f.update(state(3,{phase:'discussion'}),{hidden:true});
    else f.audio[change]();
    assert.equal(guard(),false,change);
  }
});
test('ACK requires an owned real ticket and matching request; rejection, duplication, old phase and snapshot priority stay silent',()=>{
  const f=fixture();f.update(state(1,{phase:'write'}));
  const a=f.audio.capture('lie','r1');assert.equal(f.audio.accepted(a,{ok:false,requestId:'r1'}),false);
  const b=f.audio.capture('truth','r2');assert.equal(f.audio.accepted(b,{ok:true,requestId:'other'}),false);
  assert.equal(f.audio.accepted({...b},{ok:true,requestId:'r2'}),false);
  const c=f.audio.capture('lie','r3');assert.equal(f.audio.accepted(c,{ok:true,requestId:'r3'}),true);
  assert.equal(f.audio.accepted(c,{ok:true,requestId:'r3'}),false);
  const d=f.audio.capture('lie','r4');f.update(state(2,{phase:'discussion'}));
  assert.equal(f.audio.accepted(d,{ok:true,requestId:'r4'}),false);
  assert.deepEqual(f.calls.map(call=>call.type),['ui.confirm','game.turn']);
});
test('a new owner/room with lower revision gets its own ACK while tickets from the previous scope remain invalid',()=>{
  const f=fixture();f.update(state(89,{phase:'write'}));const old=f.audio.capture('lie','old');f.update(state(90,{phase:'discussion'}));
  const next={ownerId:'other',seatId:'b',code:'654321'};
  f.audio.connection('connected',next);f.audio.update(state(1,{code:'654321',phase:'write'}),next);
  assert.equal(f.audio.accepted(old,{ok:true,requestId:'old'}),false);
  const ticket=f.audio.capture('lie','new');assert.ok(ticket);assert.equal(f.audio.accepted(ticket,{ok:true,requestId:'new'}),true);
  assert.equal(f.calls.at(-1).type,'ui.confirm');
});
test('a snapshot from another room cannot satisfy this room audio scope',()=>{
  const f=fixture();f.update(state(1,{phase:'write'}));f.update(state(2,{code:'wrong',phase:'discussion'}));f.update(state(3,{phase:'vote'}));
  assert.equal(f.calls.length,0);
});
test('accepted Mafia ability/vote feedback is neutral across secret roles and never inspects reports or outcomes',()=>{
  const results=[];
  for(const role of ['doctor','mafia','shadow_leader']){
    const f=fixture();const value=state(1,{game:'mafia',phase:'night',phaseId:'night1'});
    for(const key of ['you','reports','nightAction','audit','replay'])Object.defineProperty(value,key,{get(){throw new Error('private input:'+role);}});
    f.update(value);const ticket=f.audio.capture('night_action','own-choice');
    assert.equal(f.audio.accepted(ticket,{ok:true,requestId:'own-choice'}),true);
    results.push(f.calls.map(call=>call.type));
  }
  assert.deepEqual(results,[['ui.confirm'],['ui.confirm'],['ui.confirm']]);
});
test('public draw guesses coalesce, public hints work and no private word/choices/truth/report is inspected',()=>{
  const f=fixture();
  const draw=(revision,extra={})=>state(revision,{game:'ersomha',phase:'draw',guessedIds:[],...extra});
  for(const revision of [1,2,3]){
    const value=draw(revision,{guessedIds:revision===1?[]:revision===2?['b']:['b','c']});
    for(const key of ['myWord','myChoices','you','reports','truth'])Object.defineProperty(value,key,{get(){throw new Error('secret getter');}});
    f.update(value);
  }
  f.flush();assert.deepEqual(f.calls.map(call=>call.type),['draw.correct']);
  f.update(draw(4,{guessedIds:['b','c'],publicWord:{letters:[{}]}}));
  assert.equal(f.calls.at(-1).type,'game.hint');
});
function semanticFixture() {
  const clock=createSemanticAudioClock(),plays=[],context={ownerId:'owner',seatId:'a',code:'123456'};
  const bus=createAudioEvents((cue,options)=>{plays.push({cue,...options});return true;},{now:clock.now});
  const audio=createRoomAudioAdapter(bus,clock);
  audio.connection('connected',context);
  const draw=(revision,extra={})=>state(revision,{game:'ersomha',phase:'draw',guessedIds:[],...extra});
  const update=(revision,extra={},options={})=>audio.update(draw(revision,extra),{...context,receivedAt:clock.now(),...options});
  update(1);
  return {clock,plays,audio,bus,context,update,correct:()=>plays.filter(play=>play.cue==='correct')};
}
test('real semantic bus coalesces two draw snapshots at 100ms, with no early or duplicate playback',()=>{
  const f=semanticFixture();
  f.update(2,{guessedIds:['b']});f.clock.advance(50);
  f.update(3,{guessedIds:['b','c']});assert.equal(f.clock.pending(),1);
  f.clock.advance(99);assert.deepEqual(f.plays,[]);
  f.clock.advance(1);assert.equal(f.correct().length,1);assert.equal(f.correct()[0].guard(),true);
  f.clock.advance(100);assert.equal(f.correct().length,1);assert.equal(f.clock.pending(),0);
});
test('real semantic bus rejects an expired coalescing callback and a snapshot already delayed at receipt',()=>{
  for(const delay of [1000,1001]) {
    const f=semanticFixture();f.update(2,{guessedIds:['b']});
    f.clock.elapse(delay);f.clock.flushLate();
    assert.equal(f.correct().length,delay===1000?1:0,'the unchanged 1000ms TTL boundary is enforced');
  }
  const f=semanticFixture();f.update(2,{guessedIds:['b']},{receivedAt:f.clock.now()-401});
  f.clock.advance(100);assert.deepEqual(f.plays,[]);assert.equal(f.clock.pending(),0);
});
test('real semantic bus invalidates queued and decoded draw cues on privacy, identity and phase changes',()=>{
  const changes={
    owner:f=>f.update(3,{guessedIds:['b']},{ownerId:'other'}),
    room:f=>f.update(3,{guessedIds:['b'],code:'654321'},{code:'654321'}),
    phase:f=>f.update(3,{phase:'reveal',guessedIds:['b']}),
    hidden:f=>f.update(3,{guessedIds:['b']},{hidden:true}),
    preview:f=>f.update(3,{guessedIds:['b']},{preview:true}),
    suspend:f=>f.audio.suspend(),
    dispose:f=>f.audio.dispose(),
    disconnect:f=>f.audio.connection('reconnecting',f.context),
  };
  for(const [name,change] of Object.entries(changes)) {
    const queued=semanticFixture();queued.update(2,{guessedIds:['b']});change(queued);queued.clock.advance(100);
    assert.equal(queued.correct().length,0,name+' cancels the pending batch');
    const decoded=semanticFixture();decoded.update(2,{guessedIds:['b']});decoded.clock.advance(100);
    const guard=decoded.correct()[0].guard;assert.equal(guard(),true);change(decoded);
    assert.equal(guard(),false,name+' fences a deferred sample decode');
  }
  const expired=semanticFixture();expired.update(2,{guessedIds:['b']});expired.clock.advance(100);
  const guard=expired.correct()[0].guard;expired.clock.elapse(900);assert.equal(guard(),true);
  expired.clock.elapse(1);assert.equal(guard(),false,'decode expiry uses original snapshot time');
});
test('a coincident lower-priority hint cannot replace pending correct feedback',()=>{
  const f=fixture(),draw=(revision,extra={})=>state(revision,{game:'ersomha',phase:'draw',guessedIds:[],...extra});
  f.update(draw(1));f.update(draw(2,{guessedIds:['b']}));f.update(draw(3,{guessedIds:['b'],publicWord:{letters:[{}]}}));f.flush();
  assert.deepEqual(f.calls.map(call=>call.type),['draw.correct']);
});
test('a hidden/preview duplicate consumes and invalidates a queued cue before foregrounding the same revision',()=>{
  for(const field of ['hidden','preview']){
    const f=fixture();f.update(state(1,{phase:'write'}));f.update(state(2,{phase:'discussion'}));const guard=f.calls[0].guard;
    f.update(state(2,{phase:'discussion'}),{[field]:true});f.update(state(2,{phase:'discussion'}),{[field]:false});assert.equal(guard(),false);
    assert.equal(f.calls.length,1);
  }
});
test('Badeeha/Fabraka public reveal does not replay initial state and results/finals/Mafia remain with their existing owners',()=>{
  for(const game of ['badeeha','fabraka']){
    const f=fixture();f.update(state(1,{game,phase:'reveal',reveal:{shown:true,options:[{id:'old'}]},verdict:{qid:'old',teamId:'a'}}));
    assert.equal(f.calls.length,0);
    f.update(state(2,{game,phase:'question'}));f.calls.length=0;
    const value=state(3,{game,phase:'reveal',reveal:{shown:true,options:[{id:'new',get truth(){throw new Error('truth not needed');}}]}});
    f.update(value);assert.equal(f.calls.at(-1).type,'game.reveal');
    f.update(state(4,{game,phase:'result'}));f.update(state(5,{game,phase:'over'}));assert.equal(f.calls.length,1);
  }
  const f=fixture();f.update(state(1,{game:'mafia',phase:'opening'}));f.update(state(2,{game:'mafia',phase:'night'}));f.update(state(3,{game:'mafia',phase:'dawn'}));assert.equal(f.calls.length,0);
});

class Socket{static current;constructor(){this.readyState=1;this.sent=[];Socket.current=this;}send(data){this.sent.push(JSON.parse(data));}close(){this.readyState=3;}receive(value){this.onmessage({data:JSON.stringify(value)});}}
test('actual RoomClient command preserves Promise/then/await, immutable local requestId, unchanged wire and matching ACK only',async()=>{
  const f=fixture(),client=new RoomClient({server:'http://localhost',code:'123456',session:{id:'a',token:'fixture'},WebSocketImpl:Socket,onState:value=>f.update(value)});
  client.start();const socket=Socket.current;socket.onopen();socket.receive({type:'state',state:state(1,{game:'meenfina',protocol:1,phase:'vote',serverNow:1000})});
  const unbind=bindRoomAudioCommands(client,f.audio);
  try{
    const promise=client.command('vote',{targetId:'b'});assert.ok(promise instanceof Promise);
    const id=promise.requestId;assert.equal(typeof id,'string');assert.throws(()=>{promise.requestId='forged';},TypeError);
    assert.deepEqual(Object.keys(promise),[]);assert.equal(Object.getOwnPropertyDescriptor(promise,'requestId').configurable,false);
    const wire=socket.sent.at(-1);assert.equal(wire.requestId,id);assert.deepEqual(Object.keys(wire).sort(),['matchId','requestId','round','targetId','type']);
    socket.receive({type:'ack',requestId:'other',ok:true});assert.equal(f.calls.length,0);
    let thenValue;promise.then(value=>{thenValue=value;});socket.receive({type:'ack',requestId:id,ok:true});
    const value=await promise;assert.equal(value,thenValue);assert.equal(value.requestId,id);assert.deepEqual(f.calls.map(call=>call.type),['ui.confirm']);
    const rejected=client.command('vote',{targetId:null});socket.receive({type:'ack',requestId:rejected.requestId,ok:false,error:'STALE'});await assert.rejects(rejected,error=>error.code==='STALE');assert.equal(f.calls.length,1);
    for(const type of ['drawing_batch','drawing_sync','guess','chat','start','reveal']){
      const p=client.command(type);socket.receive({type:'ack',requestId:p.requestId,ok:true});await p;
    }
    assert.equal(f.calls.length,1,'continuous/phase-owned paths never gain a generic acceptance cue');
  }finally{unbind();client.stop();f.audio.dispose();}
});
test('HTTP receipt helper requires confirmed caller ownership and permits only admission/exit',()=>{
  const calls=[],sound={emit:(...args)=>{calls.push(args);return true;}};
  assert.equal(emitRoomReceipt(sound,'room.admitted',{id:'i',guard:()=>false}),false);
  assert.equal(emitRoomReceipt(sound,'game.complete',{id:'i',guard:()=>true}),false);
  assert.equal(emitRoomReceipt(sound,'room.admitted',{id:'i',guard:()=>true}),true);
  assert.equal(emitRoomReceipt(sound,'room.exit',{id:'e',guard:()=>true}),true);
  assert.equal(calls.length,2);
  assert.equal(emitRoomReceipt({emit(){throw new Error('decode failure');}},'room.exit',{id:'safe',guard:()=>true}),false,'audio failure cannot block successful navigation');
});
