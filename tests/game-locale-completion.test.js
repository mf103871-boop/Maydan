// Complete synthetic matches against real engines and public/private owning
// loaders. These are not browser, human balance, transport or device claims.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import * as game from '../server/game-model.mjs';
import * as mafia from '../server/mafia-model.mjs';
import { Room, meenfinaDeck } from '../server/room.mjs';
import { MemoryStorage } from '../server/local.mjs';
import { buildFabrakaDeck } from '../server/fabraka-content.mjs';
import { buildErsomhaChoices } from '../server/ersomha-content.mjs';
import { setErsomhaChoices } from '../server/ersomha-model.mjs';
import { rankedCoordinator } from '../server/mafia-ranked.mjs';
import { fixture as rankedFixture, seedQueue, query } from './mafia-matchmaking-integration-fixture.mjs';
import { getCategories, getGameContent } from '../src/data/game-content.js';
import badeeha from '../src/games/badeeha/logic.js';
import { contentVersionFor } from '../src/shared/content-locale.mjs';
import { seeded } from './helpers.js';
import { stampContentIdentity, readSavedContentIdentity } from '../src/shared/lib/content-storage.js';
import * as beep from '../src/games/beep/logic.js';
import * as meen from '../src/games/meenfina/logic.js';
import * as forehead from '../src/games/jabeen/logic.js';
import * as forbidden from '../src/games/mamnoo/logic.js';
import * as bluff from '../src/games/fabraka/logic.js';

const cases=[];
function complete(gameId,scope,mode,locale,run){
  const name=`complete ${scope} ${gameId}/${mode}/${locale} with pinned real content and recovery`;
  test(name,async t=>{const row={game:gameId,scope,mode,contentLocale:locale,contentVersion:contentVersionFor(locale),type:scope==='local'?'real-engine-simulation':'authoritative-model-simulation',test:name,status:'running',completed:false};cases.push(row);try{Object.assign(row,await run(t),{status:'passed',completed:true});}catch(error){row.status='failed';row.error=error.code||error.name;throw error;}});
}
after(async()=>{if(process.env.MAYDAN_GAME_MATRIX_REPORT)await writeFile(process.env.MAYDAN_GAME_MATRIX_REPORT,JSON.stringify({scope:'Synthetic complete engine matches. No human/device/transport acceptance.',cases},null,2));});
const identity=locale=>({contentLocale:locale,contentVersion:contentVersionFor(locale)});
const assertText=(text,locale)=>{assert.equal(typeof text,'string');assert.ok(text.length>0);if(locale==='en')assert.ok(!/\p{Script=Arabic}/u.test(text),'English authored content contains Arabic script');};
const people=Array.from({length:12},(_,n)=>({id:String(n+1).padStart(32,'0'),name:`Player ${n+1}`,avatar:n%4,emoji:'🦊',color:'#118d96',tokenHash:String(n+1).padStart(64,'0'),capabilities:{localizedContent:1,badeeha:1,mafia:2}}));
function roomFixture(gameId,locale,settings={},count=3){
  let room=game.createRoom('123456',{...people[0],game:gameId,...identity(locale),settings,rounds:5},Date.now()),now=Date.now();
  for(const player of people.slice(1,count))game.joinRoom(room,player,now);
  const act=(id,type,fields={},deck)=>game.action(room,id,{type,matchId:room.matchId,phaseId:room.phaseId,round:room.round,...fields},now,deck);
  for(const player of people.slice(0,count)){game.connected(room,player.id,true,now);act(player.id,'ready',{ready:true});}
  const view=id=>game.snapshot(room,id||people[0].id,now);
  const recover=()=>{const before=people.slice(0,count).map(p=>view(p.id));room=JSON.parse(JSON.stringify(room));assert.deepEqual(people.slice(0,count).map(p=>view(p.id)),before);for(const snapshot of before){assert.equal(snapshot.contentLocale,locale);assert.equal(snapshot.contentVersion,contentVersionFor(locale));}};
  return{get room(){return room;},act,view,recover,setNow:value=>{now=value;},get now(){return now;}};
}

for(const locale of ['ar','en'])for(const mode of Object.keys(badeeha.MODES))complete('badeeha','online',mode,locale,()=>{
  const cats=getCategories(locale),selected=cats.slice(0,6).map(c=>c.id),deck=badeeha.buildDeck(cats,selected,{},badeeha.MODES[mode].tiers,20,seeded(41));
  const settings={mode,roundSize:20,timer:30,categories:selected,deck:Object.fromEntries(Object.entries(deck).map(([id,qs])=>[id,qs.map(q=>({qid:q.qid,p:q.p}))]))};
  const f=roomFixture('badeeha',locale,settings,2);f.act(people[0].id,'start');let answered=0,total=0;
  while(f.room.phase!=='over'){
    const categoryId=selected.find(id=>f.room.settings.deck[id].some(q=>!f.room.used[q.qid]));const index=f.room.settings.deck[categoryId].findIndex(q=>!f.room.used[q.qid]);
    f.act(f.room.participants[f.room.turn],'open',{categoryId,index});const {qid,p}=f.room.current;
    const question=cats.find(c=>c.id===categoryId).qs.find(q=>q.qid===qid);assert.ok(question);assertText(question.q,locale);
    const guest=f.view(people[1].id);assert.deepEqual(Object.keys(guest.current).sort(),['categoryId','index','p','qid']);assert.ok(!Object.hasOwn(guest.current,'a'));
    assert.throws(()=>f.act(people[1].id,'reveal'),e=>e.code==='HOST_ONLY');
    if(answered===5)f.recover();
    f.act(people[0].id,'reveal');const winner=f.room.participants[f.room.turn];f.act(people[0].id,'judge',{teamId:winner});answered++;total+=p;
  }
  assert.equal(answered,20);assert.equal(Object.values(f.room.scores).reduce((a,b)=>a+b,0),total);assert.equal(Object.keys(f.room.used).length,20);
  assert.equal(f.room.reason,null);return{questions:answered,recovery:true,hostJudgingEnforced:true,questionIdsResolved:true};
});

for(const locale of ['ar','en'])for(const mode of ['classic','mixed','pictures','friends'])complete('fabraka','online',mode,locale,()=>{
  const f=roomFixture('fabraka',locale,{mode,rounds:3,friendCycles:1,writeSeconds:0,discussionSeconds:0,funnyVote:false},3),deck=buildFabrakaDeck(f.room);
  assert.ok(deck.length>=3);for(const question of deck)assertText(question.text,locale);
  f.act(people[0].id,'start',{},deck);let rounds=0;
  while(f.room.phase!=='over'){
    assert.ok(rounds<3);const truthOwner=f.view().truthHostId;
    if(mode==='friends'){
      assert.throws(()=>f.act(people.find(p=>p.id!==truthOwner).id,'truth',{text:'private truth'}),e=>e.code==='TRUTH_OWNER');
      f.act(truthOwner,'truth',{text:locale==='en'?'pasta':'معكرونة',aliases:locale==='en'?['noodles']:['مكرونة']});
      assert.equal(f.view(people.find(p=>p.id!==truthOwner).id).myTruth,null);
    }
    const active=people.slice(0,3).filter(p=>p.id!==truthOwner);
    for(const [i,player]of active.entries()){
      assert.ok(!Object.hasOwn(f.view(player.id).question,'answer'));
      f.act(player.id,'lie',{text:locale==='en'?`fiction ${rounds} ${i}`:`فبركة ${rounds} ${i}`});
    }
    assert.equal(f.room.phase,'vote');f.recover();
    for(const player of active){const options=f.view(player.id).options;assert.ok(options.every(o=>!Object.hasOwn(o,'truth')&&!Object.hasOwn(o,'owners')));const own=options.find(o=>o.mine);assert.ok(own);assert.throws(()=>f.act(player.id,'vote',{optionId:own.id}),e=>e.code==='OWN_ANSWER');f.act(player.id,'vote',{optionId:options.find(o=>!o.mine).id});}
    while(f.room.phase==='reveal')f.act(people[0].id,f.room.fab.groupShown?'next_reveal':'reveal');
    assert.equal(f.room.phase,'result');assertText(f.view().question.answer,locale);assertText(f.view().question.explanation,locale);rounds++;f.act(people[0].id,'next');
  }
  assert.equal(rounds,3);assert.ok(f.view().members.every(p=>Number.isFinite(p.score)));return{rounds,recovery:true,secretProjection:true,ownVoteRejected:true};
});

for(const locale of ['ar','en'])complete('meenfina','online','secret',locale,()=>{
  const f=roomFixture('meenfina',locale),deck=meenfinaDeck(f.room);f.act(people[0].id,'start',{},deck);let rounds=0;
  while(f.room.phase!=='over'){
    assertText(f.view().question.text,locale);f.act(people[0].id,'vote',{targetId:people[1].id});
    assert.deepEqual(f.view(people[2].id).counts,{});assert.throws(()=>f.act(people[0].id,'vote',{targetId:people[2].id}),e=>e.code==='VOTED');
    f.recover();for(const player of people.slice(1,3))f.act(player.id,'vote',{targetId:people[1].id});assert.equal(f.room.phase,'result');rounds++;f.act(people[0].id,'next');
  }
  assert.equal(rounds,5);assert.equal(f.room.scores[people[1].id],5);for(const player of f.view().members)assertText(player.title,locale);return{rounds,recovery:true,privateVote:true};
});

for(const locale of ['ar','en'])for(const mode of ['cooperative','competitive'])for(const difficulty of ['easy','medium','hard'])complete('ersomha','online',`${mode}/${difficulty}`,locale,()=>{
  const count=mode==='cooperative'?2:3,f=roomFixture('ersomha',locale,{difficulty,cycles:1},count),families=[],concepts=[];f.act(people[0].id,'start');
  assert.equal(f.room.settings.mode,mode);let rounds=0;
  while(f.room.phase!=='over'){
    const choices=buildErsomhaChoices({...identity(locale),difficulty,excludedFamilyIds:families,excludedConceptIds:concepts,random:seeded(16+rounds)});assert.equal(choices.length,3);
    for(const choice of choices){assertText(choice.answer,locale);assert.equal(choice.difficulty,difficulty);assert.ok(!families.includes(choice.familyId));}
    setErsomhaChoices(f.room,choices,f.now);families.push(...choices.map(c=>c.familyId));concepts.push(...choices.map(c=>c.conceptId));
    const drawer=f.room.draw.drawerId,guessers=f.room.participants.filter(id=>id!==drawer),card=choices[0];
    for(const id of guessers){const view=f.view(id);assert.deepEqual(view.myChoices,[]);assert.equal(view.myWord,null);assert.ok(!JSON.stringify(view).includes('"conceptId"'));assert.ok(!JSON.stringify(view).includes('"aliases"'));}
    assert.throws(()=>f.act(guessers[0],'select_word',{choiceId:card.id}),e=>e.code==='ERSOMHA_DRAWER_ONLY');
    f.act(drawer,'select_word',{choiceId:card.id});f.recover();assert.throws(()=>f.act(drawer,'guess',{text:card.answer}),e=>e.code==='ERSOMHA_GUESSER_ONLY');
    f.setNow(f.now+1000);for(const id of guessers)f.act(id,'guess',{text:locale==='en'?card.answer.toUpperCase():card.answer});
    assert.equal(f.room.phase,'result');assert.equal(f.view().revealedWord,card.answer);rounds++;
    const end=f.room.deadlineAt;game.tick(f.room,end);f.setNow(end);
  }
  assert.equal(rounds,count);assert.equal(f.room.reason,null);
  if(mode==='cooperative'){assert.equal(f.view().cooperative.completedTurns,count);assert.equal(f.view().cooperative.solvedTurns,count);}
  else {assert.equal(f.view().cooperative,null);assert.ok(Object.values(f.room.scores).every(score=>score===400));}
  return{turns:rounds,difficulty,recovery:true,privateProjection:true,drawerPermissions:true,uniqueFamilies:families.length,transport:'not exercised',drawingRaster:'not exercised'};
});

function finishMafia(f,seed=78){
  let steps=0,commands=0;const random=seeded(seed);
  while(f.room.phase!=='over'){
    assert.ok(steps++<100,'a full match must terminate');f.setNow(f.room.deadlineAt-1);
    const alive=f.room.participants.filter(id=>f.room.roleStates[id].alive),nominee=alive[Math.floor(random()*alive.length)];
    for(const id of alive)for(const action of f.view(id).you.actions){
      let fields;
      if(action.type==='verdict')fields={approve:true};
      else if(action.type==='herald')continue;
      else if(action.count===2){if(action.targets.length<2)continue;fields={targetIds:action.targets.slice(0,2)};}
      else{if(!action.targets.length)continue;fields={targetId:action.type==='nominate'&&action.targets.includes(nominee)?nominee:action.targets[Math.floor(random()*action.targets.length)]};}
      const observer=alive.find(other=>other!==id&&!(action.type==='mafia_vote'&&f.room.roleStates[other].faction==='mafia'));
      const before=observer&&f.view(observer);f.act(id,action.type,fields);if(observer)assert.deepEqual(f.view(observer),before,'unrelated seats must not learn private choices');commands++;
    }
    f.recover();const deadline=f.room.deadlineAt;game.tick(f.room,deadline);f.setNow(deadline);
  }
  assert.ok(f.room.outcome);assert.equal(mafia.matchResults(f.room).length,f.room.participants.length);return{phaseTransitions:steps,commands,recovery:true,privateProjection:true,outcome:f.room.outcome.faction};
}
for(const locale of ['ar','en'])for(const mode of ['classic','shadow'])complete('mafia','online',mode,locale,()=>{
  const f=roomFixture('mafia',locale,{mode,capacity:mode==='shadow'?9:8,voiceMode:'off'},mode==='shadow'?9:8);f.act(people[0].id,'start');assert.equal(f.room.settings.community,locale);return finishMafia(f);
});
for(const locale of ['ar','en'])complete('mafia','online','ranked',locale,async t=>{
  const h=await rankedFixture(t);await seedQueue(h.env,h.season,h.people);
  await query(h.env,'UPDATE mafia_ranked_queue SET content_locale=?',locale).run();
  await rankedCoordinator(h.env,{operation:'status',actor:h.people[0].actor,body:h.people[0]});
  const allocation=h.calls.find(call=>call.endpoint==='/mafia-ranked-create');assert.ok(allocation);assert.equal(allocation.body.contentLocale,locale);
  const storage=new MemoryStorage();t.after(()=>storage.dispose());const owner=new Room({storage,blockConcurrencyWhile:fn=>fn(),getWebSockets:()=>[]},h.env);await owner.ready;
  const response=await owner.createRankedMatch(allocation.body);assert.equal(response.status,201);let state=JSON.parse(JSON.stringify(owner.room)),now=Date.now();
  for(const id of state.participants)game.connected(state,id,true,now);
  const f={get room(){return state;},get now(){return now;},setNow:value=>{now=value;},view:id=>game.snapshot(state,id||state.hostId,now),act:(id,type,fields={})=>game.action(state,id,{type,matchId:state.matchId,phaseId:state.phaseId,...fields},now),recover:()=>{const views=state.participants.map(id=>game.snapshot(state,id,now));state=JSON.parse(JSON.stringify(state));assert.deepEqual(state.participants.map(id=>game.snapshot(state,id,now)),views);assert.equal(state.contentLocale,locale);}};
  const result=finishMafia(f);assert.equal(state.ranked.key,allocation.body.key);assert.equal(state.settings.community,locale);
  return{...result,type:'real-D1-allocation-and-Room-create-then-authoritative-model-simulation',ratingSettlement:'not asserted by this case'};
});

function restoreLocal(module,state,fields,locale,extra){const snapshot=stampContentIdentity(module.sessionSnapshot({...fields,state}),identity(locale));assert.deepEqual(readSavedContentIdentity(snapshot),identity(locale));const restored=module.restoreSession(JSON.parse(JSON.stringify(snapshot)),extra);assert.ok(restored,'actual saved state must restore');assert.deepEqual(restored.state,state);return restored.state;}
for(const locale of ['ar','en'])for(const mode of ['three','bomb'])complete('beep','local',mode,locale,()=>{
  const settings=beep.normalizeOptions({mode,rounds:3}),source=beep.createPromptSource(getGameContent('beep',locale),{random:seeded(3)});let state=beep.initialState(people.slice(0,3),settings,{random:seeded(4)}),turns=0;
  while(state.phase!=='over'){
    assert.ok(turns++<100);if(state.phase==='intro'){const prompt=mode==='bomb'?source.next(...beep.bombPromptArgs(state.history.length)):source.next(state.round,state.rounds);assertText(prompt.text,locale);state=beep.reduce(state,{type:'BEGIN',prompt});}
    state=restoreLocal(beep,state,{players:people.slice(0,3),settings,seed:3,cursor:source.cursor,timeLeft:null},locale);
    if(mode==='three'){state=beep.reduce(state,{type:'FINISH'});state=beep.reduce(state,{type:'JUDGE',ok:true});}
    else{state=beep.reduce(state,{type:'EXPLODE'});if(state.phase!=='over')state=beep.reduce(state,{type:'CONTINUE',bombSeconds:25});}
  }
  assert.equal(state.completed,true);assert.equal(beep.standings(state).length,3);if(mode==='three')assert.equal(state.history.length,9);else assert.equal(Object.values(state.lives).filter(x=>x>0).length,1);return{turns,recovery:true,timers:'synthetic expiry actions'};
});
for(const locale of ['ar','en'])for(const mode of ['point','secret'])complete('meenfina','local',mode,locale,()=>{
  const players=people.slice(0,3),settings=meen.normalizeOptions({mode,rounds:5}),source=meen.createStatementSource(getGameContent('meenfina',locale),{random:seeded(8)});let state=meen.initialState(players,settings),rounds=0;
  while(state.phase!=='over'){
    const statement=source.next();assertText(statement.text,locale);state=meen.reduce(state,{type:'BEGIN',statement});state=restoreLocal(meen,state,{players,settings,seed:8,cursor:source.cursor},locale);
    if(mode==='point'){state=meen.reduce(state,{type:'COUNTDOWN_DONE'});state=meen.reduce(state,{type:'PICK',playerIds:[players[0].id]});}
    else for(const player of players){void player;state=meen.reduce(state,{type:'VOTE',targetId:players[0].id});}
    assert.equal(state.phase,'result');state=meen.reduce(state,{type:'NEXT'});rounds++;
  }
  assert.equal(rounds,5);assert.equal(state.scores[players[0].id],5);assertText(meen.standings(state,locale)[0].title,locale);return{rounds,recovery:true};
});
for(const locale of ['ar','en'])for(const mode of ['individual','teams'])complete('jabeen','local',mode,locale,()=>{
  const entrants=people.slice(0,mode==='teams'?2:3),categories=getGameContent('jabeen',locale),category=categories[0],settings=forehead.normalizeOptions({control:'auto',seconds:45},categories),source=forehead.createItemSource(category,{random:seeded(12)});let state=forehead.initialState(entrants,category,settings),turns=0;
  while(state.phase!=='over'){
    const item=source.next();assertText(item.text,locale);state=forehead.reduce(state,{type:'BEGIN',item});state=restoreLocal(forehead,state,{players:entrants,settings,seed:12,cursor:source.cursor,timeLeft:45},locale,categories);
    for(const angle of [60,-40]){const decision=forehead.tiltDecision(angle,true,0);assert.ok(decision);state=forehead.reduce(state,{type:'ANSWER',ok:decision==='correct',item:source.next()});}
    state=forehead.reduce(state,{type:'TIME_UP'});state=forehead.reduce(state,{type:'TOGGLE_RESULT',index:1});state=forehead.reduce(state,{type:'CONFIRM'});turns++;
  }
  assert.equal(state.completed,true);assert.equal(turns,entrants.length);assert.ok(Object.values(state.scores).every(score=>score===2));return{turns,recovery:true,controls:'synthetic tilt decisions; physical sensor not exercised'};
});
for(const locale of ['ar','en'])complete('mamnoo','local','standard',locale,()=>{
  const teams=people.slice(0,2),settings=forbidden.normalizeOptions({rounds:2,seconds:45}),source=forbidden.createCardSource(getGameContent('mamnoo',locale),{random:seeded(6)});let state=forbidden.initialState(teams,settings),turns=0;
  while(state.phase!=='over'){
    const card=source.next();assertText(card.word,locale);for(const word of card.forbidden)assertText(word,locale);state=forbidden.reduce(state,{type:'BEGIN',card});state=restoreLocal(forbidden,state,{teams,settings,seed:6,cursor:source.cursor,timeLeft:45},locale);
    state=forbidden.reduce(state,{type:'CORRECT',card:source.next()});state=forbidden.reduce(state,{type:'SKIP',card:source.next()});state=forbidden.reduce(state,{type:'BUZZ',card:source.next()});state=forbidden.reduce(state,{type:'TIME_UP'});state=forbidden.reduce(state,{type:'NEXT'});turns++;
  }
  assert.equal(turns,4);assert.equal(state.completed,true);assert.ok(Object.values(state.scores).every(score=>score===0));return{turns,recovery:true,timers:'synthetic expiry actions'};
});
for(const locale of ['ar','en'])for(const mode of ['classic','mixed','pictures','friends'])complete('fabraka','local',mode,locale,()=>{
  const content=getGameContent('fabraka',locale),settings=bluff.normalizeOptions({mode,rounds:3,friendCycles:1,writeSeconds:0,discussionSeconds:0,...identity(locale)}),deck=bluff.buildDeck({...content,options:settings,random:seeded(20)});let state=bluff.initialState(people.slice(0,3),settings,{deck,seed:20}),steps=0,recoveries=0;
  const dispatch=action=>{state=bluff.reduce(state,{round:state.round,key:bluff.turnKey(state),playerId:bluff.currentActor(state)?.id,...action});};
  while(state.phase!=='over'){
    assert.ok(steps++<150);let action;
    if(state.phase==='intro')action={type:'BEGIN'};
    else if(state.phase==='question'){assertText(state.question.text,locale);action={type:'START_WRITING'};}
    else if(['host','write','vote'].includes(state.phase)&&!state.ready)action={type:'READY'};
    else if(state.phase==='host'||state.phase==='write'){
      dispatch({type:'DRAFT',text:locale==='en'?`fiction ${steps}`:`فبركة ${steps}`});
      const snapshot=stampContentIdentity(state,identity(locale)),restored=bluff.restoreSession(JSON.parse(JSON.stringify(snapshot)));assert.ok(restored);assert.equal(restored.draft,state.draft);assert.equal(restored.ready,false);assert.deepEqual(readSavedContentIdentity(restored),identity(locale));state=restored;dispatch({type:'READY'});recoveries++;action={type:state.phase==='host'?'SUBMIT_TRUTH':'SUBMIT_LIE'};
    }else if(state.phase==='vote')action={type:'VOTE',optionId:state.options.find(option=>bluff.canVoteFor(state,bluff.currentActor(state).id,option.id)).id};
    else if(state.phase==='discussion')action={type:'START_VOTE'};
    else if(state.phase==='gather')action={type:'START_REVEAL'};
    else if(state.phase==='reveal')action={type:state.revealed?'REVEAL_NEXT':'REVEAL'};
    else if(state.phase==='roundEnd')action={type:'NEXT_ROUND'};
    else throw Error('UNEXPECTED_PHASE');
    dispatch(action);
  }
  assert.equal(state.history.length,3);assert.equal(state.round,3);assert.ok(recoveries>=6);return{rounds:3,steps,recoveries,closedPrivacyOnRestore:true};
});
