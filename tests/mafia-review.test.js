import test from 'node:test';
import assert from 'node:assert/strict';
import * as mafia from '../server/mafia-model.mjs';
import {prepareRoomStats,bindSeatAccount} from '../server/room-stats.mjs';
import {prepareMafiaResult,persistMafiaResult} from '../server/mafia-results.mjs';
import {projectMafiaReview,readMafiaReview} from '../server/mafia-review.mjs';
import {createLocalD1} from '../server/local-d1.mjs';
import {deleteUser,reserveAccountDeletion} from '../server/accounts/db.mjs';
import {MAFIA_MAX_MATCH_MS} from '../src/online/mafia-shared.js';
import {localEnvironment} from '../server/local.mjs';
import {routeRequest} from '../server/worker.mjs';
import {issueSession} from '../server/accounts/session.mjs';

const NOW=1800000000000,DAY=86400000,SECRET='PRIVATE_NAME_CHAT_MEDIA_TOKEN_SENTINEL';
const account=n=>`review-account-${n}`;
function started(seed) {
  const person=n=>({id:`private-seat-${n}`,tokenHash:SECRET,name:`عضو سري ${n}`,avatar:0});
  const room=mafia.createRoom('123456',{...person(0),settings:{mode:'shadow',capacity:12,visibility:'public',voiceMode:'off'}},NOW);
  for(let n=1;n<12;n++)mafia.joinRoom(room,person(n),NOW);
  for(let n=0;n<12;n++) {
    bindSeatAccount(room,`private-seat-${n}`,account(n));mafia.connected(room,`private-seat-${n}`,true,NOW);
    mafia.action(room,`private-seat-${n}`,{type:'ready',ready:true,matchId:room.matchId,phaseId:room.phaseId},NOW);
  }
  const previous=structuredClone(room);let random=seed;
  mafia.action(room,'private-seat-0',{type:'start',matchId:room.matchId,phaseId:room.phaseId},NOW,{randomWord:()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return random>>>0;}});
  room.mafiaKey='review-fixture';prepareRoomStats(previous,room,NOW,{mafiaProgressEnabled:true});return room;
}
function canonicalEvent() {
  let room;
  for(let seed=1;seed<=256;seed++) {
    const candidate=started(seed),roles=Object.values(candidate.roleStates).map(state=>state.roleId);
    if(['guard','herald','analyst'].every(role=>roles.includes(role))){room=candidate;break;}
  }
  assert.ok(room,'bounded seed search finds all relevant public mechanics');
  const role=id=>room.participants.find(seat=>room.roleStates[seat].roleId===id);
  const step=()=>{const at=room.deadlineAt;assert.ok(at);mafia.tick(room,at);return at+1;};
  const until=phase=>{for(let n=0;n<10&&room.phase!==phase;n++)step();assert.equal(room.phase,phase);};
  const command=(id,type,fields={})=>mafia.action(room,id,{type,...fields,matchId:room.matchId,phaseId:room.phaseId},room.deadlineAt-1);
  until('night');
  for(const id of room.participants.filter(seat=>room.roleStates[seat].faction==='mafia'))command(id,'mafia_vote',{targetId:role('guard')});
  command(role('investigator'),'night_action',{targetId:role('mafia')});
  const targets=mafia.snapshot(room,role('analyst'),room.deadlineAt-1).you.actions.find(action=>action.type==='night_action').targets.slice(0,2);
  command(role('analyst'),'night_action',{targetIds:targets});
  step();until('discussion');command(role('herald'),'herald');until('nomination');
  const nominee=role('mafia');
  for(const id of room.participants.filter(seat=>room.roleStates[seat].alive))command(id,'nominate',{targetId:nominee});
  until('verdict');for(const id of room.participants.filter(seat=>room.roleStates[seat].alive))command(id,'verdict',{approve:true});
  step();assert.equal(room.phase,'night');assert.equal(room.round,2);
  command(role('leader'),'night_action',{targetId:role('citizen')});step();
  mafia.tick(room,room.startedAt+MAFIA_MAX_MATCH_MS);
  assert.equal(room.phase,'over');assert.equal(room.outcome.faction,'draw');
  const event=prepareMafiaResult(room,NOW+MAFIA_MAX_MATCH_MS);
  assert.ok(event);return {room,event};
}
const canonical=canonicalEvent();
const rowFor=event=>({summary:event.summary,finishedAt:event.finishedAt,rulesetVersion:event.rulesetVersion});
const modify=(row,fn)=>{const value=JSON.parse(row.summary);fn(value);return {...row,summary:JSON.stringify(value)};};

test('canonical engine archive projects all nine audit types to anonymous seats with accurate conversion, shield and ballots',()=>{
  const {event,room}=canonical,review=projectMafiaReview(rowFor(event)),summary=JSON.parse(event.summary);
  assert.equal(review.available,true);assert.equal(review.players.length,12);assert.equal(review.outcome,'draw');assert.equal(review.rulesetVersion,1);
  assert.deepEqual(new Set(review.events.map(item=>item.type)),new Set(['roles','night_action','attack_vote','shield_used','converted','verdict_votes','eliminated','nomination_vote','extended']));
  assert.deepEqual(review.players,summary.reveal.players.map((player,index)=>({seat:index+1,roleId:player.roleId,initialFaction:player.initialFaction,faction:player.faction,won:player.won,forfeited:player.forfeited})));
  const seat=id=>room.participants.indexOf(id)+1,converted=summary.reveal.events.find(item=>item.type==='converted');
  assert.deepEqual(review.events.find(item=>item.type==='converted'),{type:'converted',round:converted.round,elapsedSeconds:Math.floor((converted.at-NOW)/1000),actorSeat:seat(converted.playerId),recruiterSeat:seat(converted.recruiterId),roleId:converted.roleId});
  const analyst=review.events.find(item=>item.type==='night_action'&&item.roleId==='analyst');assert.equal(analyst.targetSeats.length,2);
  const votes=review.events.find(item=>item.type==='verdict_votes');assert.equal(votes.votes.length,12);assert.ok(votes.votes.every(vote=>vote.approve===true));
  const serialized=JSON.stringify(review);assert.doesNotMatch(serialized,/private-seat-|review-account-|123456|review-fixture|SENTINEL|playerId|userId|targetId|recruiterId|nomineeId|assignments|history|chat|media|token|name/);
  assert.equal(review.earlierEventsOmitted,0);assert.equal(review.retentionDays,30);
});

test('projection uses a strict allowlist, maps only known seats and truncates the latest 500 valid events',()=>{
  const base=rowFor(canonical.event),summary=JSON.parse(base.summary),id=summary.reveal.players[0].playerId,other=summary.reveal.players[1].playerId;
  for(const player of summary.reveal.players)Object.assign(player,{name:SECRET,accountUserId:SECRET,avatarUrl:SECRET});
  summary.chats={public:[SECRET]};summary.media=SECRET;
  summary.reveal.events=Array.from({length:550},(_,index)=>({type:'night_action',at:NOW+index*1000,round:index,playerId:id,targetId:other,targetIds:[id,id,other,SECRET,{}],roleId:'analyst',chat:SECRET,token:SECRET}));
  summary.reveal.events.push({type:'chat',text:SECRET,at:NOW},{type:'eliminated',at:-1},{type:'extended',at:base.finishedAt+1});
  const review=projectMafiaReview({...base,summary:JSON.stringify(summary)});
  assert.equal(review.events.length,500);assert.equal(review.earlierEventsOmitted,50);assert.equal(review.events[0].round,50);assert.equal(review.events.at(-1).round,549);
  assert.deepEqual(review.events[0].targetSeats,[1,2]);assert.equal(review.events[0].actorSeat,1);assert.equal(review.events[0].targetSeat,2);
  assert.ok(!JSON.stringify(review).includes(SECRET));
  const odd=modify(base,s=>{s.reveal.events=[{type:'verdict_votes',at:NOW,round:Infinity,playerId:SECRET,targetId:SECRET,targetIds:[SECRET],roleId:'__proto__',reason:SECRET,votes:{[id]:true,[other]:'true',[SECRET]:true}}];});
  assert.deepEqual(projectMafiaReview(odd).events,[{type:'verdict_votes',round:0,elapsedSeconds:0,targetSeats:[],votes:[{seat:1,approve:true}]}]);
});

test('malformed/unsupported/oversized archives fail closed and cannot expand parsing work beyond the input limit',t=>{
  const base=rowFor(canonical.event),bad=[null,{}, {...base,rulesetVersion:2},{...base,summary:'['},{...base,summary:'[]'},
    modify(base,s=>{delete s.reveal;}),modify(base,s=>{s.outcome.faction='other';}),modify(base,s=>{s.reveal.players=[];}),
    modify(base,s=>{s.reveal.players.push(s.reveal.players[0]);}),modify(base,s=>{s.reveal.players[1].playerId=s.reveal.players[0].playerId;}),
    modify(base,s=>{s.reveal.players[0].roleId='__proto__';}),modify(base,s=>{s.reveal.players[0].faction='other';}),
    modify(base,s=>{s.reveal.events=Array(5001).fill({});}),modify(base,s=>{s.privateText='ش'.repeat(270000);})];
  for(const row of bad)assert.equal(projectMafiaReview(row),null);
  for(const finishedAt of [undefined,null,'1800000000000',-1,NaN,Infinity])assert.equal(projectMafiaReview({...base,finishedAt}),null);
  const encode=TextEncoder.prototype.encode;
  t.mock.method(TextEncoder.prototype,'encode',function(value){assert.ok(value.length<=524288,'character preflight must happen before allocation');return encode.call(this,value);});
  assert.equal(projectMafiaReview({...base,summary:'x'.repeat(524289)}),null);
});

async function fixture(t) {
  const DB=createLocalD1();t.after(()=>DB.close());const env={DB};let now=canonical.event.notBefore;
  t.mock.method(Date,'now',()=>now);
  for(let n=0;n<13;n++)await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(account(n),SECRET,NOW,NOW).run();
  const event=structuredClone(canonical.event);await persistMafiaResult(env,event);
  const read=(id=account(0),key=event.key)=>readMafiaReview(env,id,key,now);
  const observer=()=>DB.prepare('INSERT INTO mafia_observer_memberships(user_id,room_key,room_code,observer_id,joined_at,expires_at) VALUES(?,?,?,?,?,?)').bind(account(0),'other-room','654321','observer-seat',now,now+120000).run();
  return {DB,env,event,read,observer,at:value=>{now=value;},now:()=>now};
}
function afterFirstArchive(t,f,mutate) {
  const prepare=f.DB.prepare.bind(f.DB);let raced=false;
  t.mock.method(f.DB,'prepare',sql=>{
    const statement=prepare(sql);if(!sql.includes('FROM mafia_history h JOIN mafia_results r'))return statement;
    return {bind(...args){const bound=statement.bind(...args);return {first:async()=>{const row=await bound.first();if(!raced){raced=true;await mutate();}return row;}};}};
  });return ()=>raced;
}

test('read requires the owner result row, is read-only, and returns one unavailable shape for missing or foreign history',async t=>{
  const f=await fixture(t),before=f.DB.database.prepare('SELECT COUNT(*) AS n FROM mafia_results').get();
  assert.equal((await f.read()).available,true);assert.deepEqual(await f.read(account(12)),{available:false});assert.deepEqual(await f.read(account(0),'missing-match'),{available:false});
  assert.deepEqual(await readMafiaReview({},account(0),f.event.key),{available:false});
  for(const key of ['',"x' OR 1=1",'../path','a'.repeat(181),'a/b','%2F'])await assert.rejects(f.read(account(0),key),{code:'INVALID',status:400});
  assert.deepEqual(f.DB.database.prepare('SELECT COUNT(*) AS n FROM mafia_results').get(),before);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM mafia_progress_events').first()).n,0);
});

test('the exact 30-second release and 30-day expiry are enforced independently of archive presence',async t=>{
  const f=await fixture(t),finished=f.event.finishedAt;
  f.at(finished+29999);assert.deepEqual(await f.read(),{available:false});
  f.at(finished+30000);assert.equal((await f.read()).available,true);
  f.at(finished+30*DAY-1);assert.equal((await f.read()).available,true);
  f.at(finished+30*DAY);assert.deepEqual(await f.read(),{available:false});
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM mafia_history').first()).n,1,'read expiry must work even when retention cleanup has not run');
});

test('only a live observer lease blocks historical review; expired observers and current seat/match/media leases preserve history compatibility',async t=>{
  const f=await fixture(t);await f.observer();assert.deepEqual(await f.read(),{available:false});
  await f.DB.prepare('UPDATE mafia_observer_memberships SET expires_at=?').bind(f.now()).run();
  await f.DB.prepare('INSERT INTO mafia_match_leases(user_id,room_key,match_id,expires_at,updated_at) VALUES(?,?,?,?,?)').bind(account(0),'other-room','9',f.now()+120000,f.now()).run();
  await f.DB.prepare('INSERT INTO mafia_media_leases(user_id,room_key,call_id,expires_at,updated_at) VALUES(?,?,?,?,?)').bind(account(0),'other-room','private-call',f.now()+120000,f.now()).run();
  assert.equal((await f.read()).available,true);
});

const mutations={
  observer:f=>f.observer(),
  suspension:f=>f.DB.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at) VALUES(?,?,?,?,?)').bind(account(0),'moderator',SECRET,f.now(),f.now()).run(),
  pendingDeletion:f=>reserveAccountDeletion(f.env,account(0),'delete-attempt',f.now()),
  deleteViewer:f=>deleteUser(f.env,account(0)),
  deleteOtherParticipant:f=>deleteUser(f.env,account(1)),
  removeOwnerResult:f=>f.DB.prepare('DELETE FROM mafia_results WHERE user_id=? AND match_key=?').bind(account(0),f.event.key).run(),
  replaceSummary:f=>f.DB.prepare('UPDATE mafia_history SET summary=?').bind(JSON.stringify({...JSON.parse(f.event.summary),mode:'classic'})).run(),
  replaceFinish:f=>f.DB.prepare('UPDATE mafia_history SET finished_at=finished_at-1').run(),
  replaceRules:f=>f.DB.prepare('UPDATE mafia_history SET ruleset_version=2').run(),
};
for(const [name,mutate] of Object.entries(mutations))test(`final authorization suppresses a captured projection after ${name} between SELECTs`,async t=>{
  const f=await fixture(t),raced=afterFirstArchive(t,f,()=>mutate(f));
  assert.deepEqual(await f.read(),{available:false});assert.equal(raced(),true);
  if(name==='deleteOtherParticipant')assert.ok(await f.DB.prepare('SELECT 1 AS ok FROM users WHERE id=?').bind(account(0)).first());
});

test('final authorization rechecks actual time if retention expires during lookup',async t=>{
  const f=await fixture(t);f.at(f.event.finishedAt+30*DAY-1);
  const raced=afterFirstArchive(t,f,()=>f.at(f.now()+2));assert.deepEqual(await f.read(),{available:false});assert.equal(raced(),true);
});

test('final authorization rechecks the 30-second release if the clock rolls back during lookup',async t=>{
  const f=await fixture(t),raced=afterFirstArchive(t,f,()=>f.at(f.event.finishedAt+29999));
  assert.deepEqual(await f.read(),{available:false});assert.equal(raced(),true);
});

test('the HTTP review route is owner-authenticated, GET-only, no-store, delayed, and does not write progression',async t=>{
  const runtime=localEnvironment({vars:{MAFIA_ENABLED:'1'}});t.after(()=>runtime.dispose());const env=runtime.env;
  let now=canonical.event.notBefore;t.mock.method(Date,'now',()=>now);
  for(let n=0;n<13;n++)await env.DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(account(n),'عضو اختبار',NOW,NOW).run();
  await persistMafiaResult(env,canonical.event);
  const owner=await issueSession(env,account(0)),outside=await issueSession(env,account(12));
  const base='/api/mafia/history/'+encodeURIComponent(canonical.event.key);
  async function api(session,path=base,method='GET') {
    const response=await routeRequest(new Request('http://localhost:3000'+path,{method,headers:{origin:'http://localhost:3000',...(session?{authorization:`Bearer ${session.token}`}:{})}}),env);
    assert.equal(response.headers.get('cache-control'),'no-store');return {status:response.status,body:await response.json()};
  }
  assert.equal((await api(null)).status,401);assert.deepEqual(await api(outside),{status:200,body:{available:false}});
  const valid=await api(owner);assert.equal(valid.status,200);assert.equal(valid.body.available,true);assert.equal(valid.body.players.length,12);
  assert.doesNotMatch(JSON.stringify(valid.body),/private-seat-|review-account-|SENTINEL|playerId|userId|summary|history|chat|media|token|name/);
  now=canonical.event.finishedAt+29999;assert.deepEqual(await api(owner),{status:200,body:{available:false}});
  now=canonical.event.notBefore;assert.equal((await api(owner,base,'POST')).status,404);
  assert.equal((await api(owner,'/api/mafia/history/%2F')).status,400);assert.equal((await api(owner,'/api/mafia/history/%')).status,400);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM mafia_results').first()).n,12);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM mafia_progress_events').first()).n,0);
});
