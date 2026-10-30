import test from 'node:test';
import assert from 'node:assert/strict';
import { mafiaTimelineScope, mergeMafiaTimeline, readMafiaTimeline, pageMafiaTimeline } from '../src/games/mafia/timeline.js';
import { createMafiaEventEffects } from '../src/games/mafia/event-effects.js';
import { createMafiaVisualFixture } from '../src/games/mafia/preview-fixtures.js';
import { createMafiaCountdownAudio,createMafiaPhaseAudio,createMafiaPublicAudio } from '../src/games/mafia/audio.js';

const state = (phaseId=1, phase='discussion') => ({code:'LOCAL',matchId:1,phaseId,phase,serverNow:10_000,log:[]});

test('dense timeline paginates mounted rows without silently dropping received events or messages', () => {
  const events=Array.from({length:80},(_,id)=>({id,at:id,type:'dawn'}));
  const messages=Array.from({length:120},(_,id)=>({id,at:100+id,text:`message-${id}`}));
  const archive=mergeMafiaTimeline(null,{scope:'owner:room:match',channel:'public',events,messages});
  const all=readMafiaTimeline(archive,'public');
  assert.equal(all.length,200);assert.equal(archive.events.length,80);
  const first=pageMafiaTimeline(all,40);assert.equal(first.rows.length,40);assert.equal(first.earlier,160);
  assert.equal(pageMafiaTimeline(all,240).rows.length,200);assert.equal(pageMafiaTimeline(all,240).earlier,0);
  assert.equal(all.filter(row=>row.value.text==='message-0').length,1);
});

test('overlapping server retention windows merge idempotently while preserving earlier authorized history', () => {
  const events=Array.from({length:256},(_,id)=>({id:id+1,at:id,type:'dawn'}));
  let archive=mergeMafiaTimeline(null,{scope:'same',channel:'public',events});
  const duplicate=mergeMafiaTimeline(archive,{scope:'same',channel:'public',events});assert.equal(duplicate,archive);
  archive=mergeMafiaTimeline(archive,{scope:'same',channel:'public',events:[...events.slice(100),{id:257,at:999,type:'night_started'}]});
  assert.equal(readMafiaTimeline(archive,'public').length,257);assert.equal(archive.events[0].value.id,1);
});

test('account, room, match and observer scopes erase previous private timeline buckets', () => {
  const base=state();let cache=mergeMafiaTimeline(null,{scope:mafiaTimelineScope(base,'a'),channel:'team:mafia',messages:[{id:'team:1',text:'PRIVATE_A'}]});
  cache=mergeMafiaTimeline(cache,{scope:mafiaTimelineScope(base,'a'),channel:'team:shadow',messages:[{id:'team:1',text:'PRIVATE_SHADOW'}]});
  assert.deepEqual(readMafiaTimeline(cache,'team:shadow').map(row=>row.value.text),['PRIVATE_SHADOW']);
  for(const [next,owner] of [[base,'b'],[{...base,code:'OTHER'},'a'],[{...base,matchId:2},'a'],[{...base,scope:'observer'},'a']]) {
    const reset=mergeMafiaTimeline(cache,{scope:mafiaTimelineScope(next,owner),channel:'public',events:[],messages:[]});
    assert.deepEqual(readMafiaTimeline(reset,'team:mafia'),[]);assert.deepEqual(readMafiaTimeline(reset,'public'),[]);
  }
});

test('channel-local opaque ids and zero-valued event ids never collide across messages/events', () => {
  const cache=mergeMafiaTimeline(null,{scope:'same',channel:'public',events:[{id:0,at:1,type:'dawn'}],messages:[{id:0,at:1,text:'public'}]});
  assert.equal(new Set(readMafiaTimeline(cache,'public').map(row=>row.key)).size,2);
});

test('visual effects consume initial history silently, deduplicate server events and coalesce a burst to one overlay', () => {
  const fx=createMafiaEventEffects({now:()=>10_000}), initial=state();initial.log=[{id:1,type:'eliminated',reason:'night',at:10_000}];
  assert.equal(fx.update(initial,{ownerId:'a'}),null);
  const next={...initial,log:[...initial.log,{id:2,type:'eliminated',reason:'night',at:10_000},{id:3,type:'faction_revealed',at:10_000}]};
  const effect=fx.update(next,{ownerId:'a'});assert.equal(effect.kind,'reveal');assert.equal(effect.durationMs,1600);
  assert.equal(fx.update(next,{ownerId:'a'}),null);
  assert.equal(fx.update({...next,deadlineAt:12_000},{ownerId:'a'}),null);
});

test('visual effects cannot replay across account/room switches, reconnect, old events or background restoration', () => {
  const fx=createMafiaEventEffects();fx.update(state(),{ownerId:'a'});
  const night=state(2,'night');assert.equal(fx.update(night,{ownerId:'a'}).kind,'night');
  assert.equal(fx.update(night,{ownerId:'b'}),null);
  assert.equal(fx.update({...night,code:'OTHER'},{ownerId:'b'}),null);
  fx.update(state(3,'dawn'),{ownerId:'b',connected:false});
  assert.equal(fx.update(state(4,'discussion'),{ownerId:'b',connected:true}),null);
  fx.suspend();assert.equal(fx.update(state(5,'night'),{ownerId:'b'}),null);
  assert.equal(fx.update({...state(5,'night'),log:[{id:900,type:'eliminated',at:1,reason:'night'}]},{ownerId:'b'}),null);
});

test('visual effects never inspect private role, report, target, team messages or replay state', () => {
  const fx=createMafiaEventEffects();
  for(const [id,phase] of [[1,'night'],[2,'dawn'],[3,'defense'],[4,'verdict']]) {
    const value=state(id,phase);
    for(const field of ['you','roleStates','privateEvents','chats','replay'])Object.defineProperty(value,field,{get(){throw Error('Private read '+field);}});
    const effect=fx.update(value,{ownerId:'a'});
    if(id>1)assert.ok(effect);else assert.equal(effect,null);
  }
});

test('local visual fixtures clearly disclose synthetic players and reveal other roles only after ending', () => {
  for(const kind of ['discussion','night','dawn','defense','nomination','elimination','reveal','ending']) {
    const {state:view,me,effect}=createMafiaVisualFixture(kind,{now:123_000});
    assert.equal(view.members.length,12);assert.equal(view.you.id,me.id);assert.equal(view.code,'LOCAL_DISPLAY_ONLY');
    assert.ok(view.members.every(player=>player.name.includes('عرض')&&!Object.hasOwn(player,'roleId')));
    assert.match(effect.caption,/عرض محلية/);assert.equal(Boolean(view.replay),kind==='ending');
  }
});

test('clock warning uses the supplied server clock once per phase and never repeats on a timer render', () => {
  const fx=createMafiaEventEffects(),value=state();
  assert.equal(fx.update(value,{remaining:30}),null);
  assert.equal(fx.update(value,{remaining:10}).kind,'clock');
  assert.equal(fx.update(value,{remaining:9}),null);
  assert.equal(fx.update(value,{remaining:9}),null);
  assert.equal(fx.update({...value,phaseId:2},{remaining:8}).kind,'discussion');
  assert.equal(fx.update({...value,phaseId:2},{remaining:7}),null);
});

test('countdown ticks reuse the shared sound bus, with no catch-up or revival after background/disposal', () => {
  const calls=[],clock=createMafiaCountdownAudio({play:(cue,options)=>calls.push({cue,...options})}),value=state();
  clock.update(value,{remaining:20});clock.update(value,{remaining:5});
  assert.equal(calls.length,1);assert.equal(calls[0].cue,'tick');assert.equal(calls[0].guard(),true);
  clock.update(value,{remaining:5});assert.equal(calls.length,1);
  clock.update(value,{remaining:5,hidden:true});assert.equal(calls[0].guard(),false);
  clock.update(value,{remaining:5});assert.equal(calls[0].guard(),false);assert.equal(calls.length,1);
  clock.update(value,{remaining:2});assert.equal(calls.length,2,'dropped seconds produce one tick, not a backlog');
  clock.dispose();assert.equal(calls[1].guard(),false);clock.update(value,{remaining:1});assert.equal(calls.length,2);
});

test('phase and public audio cancel old account/room cues and silently consume a new reconnect phase', () => {
  const calls=[],sound={play:(name,options)=>calls.push({name,...options}),stopCues(){},emit:(name,options)=>calls.push({name,...options})};
  const phases=createMafiaPhaseAudio(sound),events=createMafiaPublicAudio(sound,{now:()=>10_000});
  phases.update(state(),{ownerId:'a'});phases.update(state(2,'night'),{ownerId:'a'});assert.equal(calls.length,1);assert.equal(calls[0].guard(),true);
  phases.update(state(2,'night'),{ownerId:'b'});assert.equal(calls.length,1);assert.equal(calls[0].guard(),false);
  phases.update(state(3,'dawn'),{ownerId:'b'});const dawn=calls.at(-1);assert.equal(dawn.guard(),true);
  phases.update({...state(3,'dawn'),code:'ANOTHER'},{ownerId:'b'});assert.equal(dawn.guard(),false);
  phases.update(state(3,'dawn'),{ownerId:'b',hidden:true});const count=calls.length;
  phases.update(state(4,'night'),{ownerId:'b'});assert.equal(calls.length,count);
  events.update(state(),{ownerId:'a'});events.update({...state(),log:[{id:1,type:'eliminated',reason:'night',at:10_000}]},{ownerId:'a'});
  const published=calls.at(-1);assert.equal(published.guard(),true);
  events.update({...state(),log:[{id:1,type:'eliminated',reason:'night',at:10_000}]},{ownerId:'b'});assert.equal(published.guard(),false);
});
