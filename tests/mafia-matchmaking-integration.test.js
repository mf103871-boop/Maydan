import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { RoomClient } from '../src/online/client.js';
import { deleteUser } from '../server/accounts/db.mjs';
import { selectRankedGroup,rankedRatingWindow } from '../server/mafia-matchmaking.mjs';
import { rankedCoordinator,settleRankedMatch,rankedRoomCommitted,closeRankedSeason } from '../server/mafia-ranked.mjs';
import { technicalAbort } from '../server/mafia-model.mjs';
import { fixture,query,rows,peopleFor,qualifyPeople,rankedEvent,seedQueue,interposeBatch,syntheticVars } from './mafia-matchmaking-integration-fixture.mjs';

const hasAssignment=statements=>statements.some(statement=>statement.sql.startsWith('INSERT INTO mafia_ranked_matches'));
const hasSettlement=statements=>statements.some(statement=>statement.sql.startsWith("UPDATE mafia_ranked_matches SET status='completed'"));
const size=async(env,table)=>(await query(env,`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
const join=async(env,person,extra={})=>(await rankedCoordinator(env,{operation:'join',actor:person.actor,body:{...person,...extra}})).json();

test('skill-window policy: exact widening boundaries, stable oldest priority, bilateral blocks and bounded candidate input',()=>{
  const now=1_000_000,row=(id,rating,wait)=>({user_id:id,rating,joined_at:now-wait});
  for(const [wait,range]of [[0,150],[29_999,150],[30_000,450],[299_999,2850],[300_000,3000],[900_000,3000]])assert.equal(rankedRatingWindow(now-wait,now),range);
  const old=row('oldest',0,300_000),tight=Array.from({length:8},(_,i)=>row(`new-${i}`,3000,i));
  const first=selectRankedGroup([...tight,old],[],now);
  assert.equal(first.members[0].user_id,'oldest','a tighter new group cannot skip an older viable anchor');
  assert.equal(first.ratingSpread,3000);
  assert.equal(selectRankedGroup([row('oldest',0,299_999),...tight],[],now).members[0].user_id,'new-7');
  for(const reverse of [false,true]) {
    const blocks=tight.map(peer=>reverse?{blocker_id:peer.user_id,blocked_id:'oldest'}:{blocker_id:'oldest',blocked_id:peer.user_id});
    assert.ok(selectRankedGroup([old,...tight],blocks,now).members.every(peer=>peer.user_id!=='oldest'));
  }
  const oldest64=Array.from({length:64},(_,i)=>row(`isolate-${i}`,0,300_000-i));
  const allBlocked=oldest64.flatMap((a,i)=>oldest64.slice(i+1).map(b=>({blocker_id:a.user_id,blocked_id:b.user_id})));
  assert.equal(selectRankedGroup([...oldest64,...tight],allBlocked,now),null,'newer candidates beyond the documented64limit are not silently considered');
  assert.equal(selectRankedGroup([...tight,{...tight[0]},{user_id:'bad',rating:NaN,joined_at:now}],[],now).members.length,8);
});

test('queue owns server ratings, private projection, continuous wait and revision-scoped cancellation',async t=>{
  const h=await fixture(t,{count:2});
  const state=await join(h.env,h.people[0],{rating:3000,rating_games:999,seasonId:'forged'});
  assert.equal(state.rating.rating,1000);assert.equal(state.rating.games,0);assert.equal(state.season.id,h.season);
  assert.equal(JSON.stringify(state).includes(h.people[1].accountId),false);
  const joinedAt=Date.now()-300_000;
  await query(h.env,'UPDATE mafia_ranked_queue SET joined_at=? WHERE user_id=?',joinedAt,h.people[0].accountId).run();
  const beat=await (await rankedCoordinator(h.env,{operation:'status',actor:h.people[0].actor,body:h.people[0]})).json();
  assert.equal(beat.queue.joinedAt,joinedAt);assert.equal(beat.matchmaking.currentRatingRange,3000);
  await rankedCoordinator(h.env,{operation:'cancel',actor:h.people[0].actor,body:{seatId:h.people[0].id,revision:'stale'}});
  assert.equal(await size(h.env,'mafia_ranked_queue'),1);assert.equal(await size(h.env,'mafia_match_leases'),1);
  await rankedCoordinator(h.env,{operation:'cancel',actor:h.people[0].actor,body:{seatId:h.people[0].id,revision:beat.queue.revision}});
  assert.equal(await size(h.env,'mafia_ranked_queue'),0);assert.equal(await size(h.env,'mafia_match_leases'),0);
  const rejoined=await join(h.env,h.people[0]);assert.equal(rejoined.matchmaking.currentRatingRange,150);assert.notEqual(rejoined.queue.revision,beat.queue.revision);
});

for(const race of ['block-forward','block-reverse','revision','revoked-session','deletion','suspension','activity','rating','cooldown','qualification','season','d1-failure'])test(`assignment atomic boundary rejects ${race} without partially moving eight reservations`,async t=>{
  const h=await fixture(t),p=h.people[0],q=h.people[1];
  await seedQueue(h.env,h.season,h.people);
  const restore=interposeBatch(h.env,hasAssignment,async(db,statements)=>{
    if(race.startsWith('block-'))await db.prepare('INSERT INTO social_blocks VALUES(?,?,?)').bind(race==='block-forward'?p.accountId:q.accountId,race==='block-forward'?q.accountId:p.accountId,Date.now()).run();
    if(race==='revision')await db.prepare("UPDATE mafia_ranked_queue SET queue_revision='changed' WHERE user_id=?").bind(p.accountId).run();
    if(race==='revoked-session')await db.prepare('UPDATE sessions SET revoked_at=0 WHERE id=?').bind(p.sessionId).run();
    if(race==='deletion')await db.prepare('INSERT INTO account_deletions VALUES(?,?,?)').bind(p.accountId,'synthetic-delete',Date.now()).run();
    if(race==='suspension')await db.prepare('INSERT INTO moderation_suspensions VALUES(?,?,?,?,?)').bind(p.accountId,'synthetic','fixture',Date.now(),Date.now()).run();
    if(race==='activity')await db.prepare('INSERT INTO mafia_seats VALUES(?,?,?,?,?,?)').bind(p.accountId,'other-room','123456','other-seat',Date.now()+60_000,Date.now()).run();
    if(race==='rating'||race==='cooldown')await db.prepare('INSERT INTO mafia_ranked_ratings(user_id,season_id,rating,games,cooldown_until,updated_at) VALUES(?,?,?,0,?,?)').bind(p.accountId,h.season,race==='rating'?1001:1000,race==='cooldown'?Date.now()+60_000:0,Date.now()).run();
    if(race==='qualification')await db.prepare('DELETE FROM mafia_progress_events WHERE user_id=?').bind(p.accountId).run();
    if(race==='season')await db.prepare("UPDATE mafia_ranked_seasons SET status='closing' WHERE id=?").bind(h.season).run();
    if(race==='d1-failure')statements.splice(2,0,db.prepare('INSERT INTO nonexistent_matchmaking_fixture VALUES(1)'));
  });
  await assert.rejects(rankedCoordinator(h.env,{operation:'status',actor:h.people[7].actor,body:h.people[7]}));
  assert.equal(restore(),true);assert.equal(await size(h.env,'mafia_ranked_matches'),0);
  assert.equal((await rows(h.env,'SELECT status FROM mafia_ranked_queue')).filter(row=>row.status==='queued').length,8);
  assert.ok((await rows(h.env,'SELECT match_id,room_key FROM mafia_match_leases')).every(row=>row.match_id==='queue'&&row.room_key===`ranked:queue:${h.season}`));
  assert.equal(await size(h.env,'mafia_ranked_atomic_guard'),0);assert.equal(h.calls.length,0);
});

test('delayed settlement is exactly once after a competing consumer, with unchanged v1 integer deltas',async t=>{
  const h=await fixture(t,{qualify:false}),event=await rankedEvent(h.env,h.season,h.people);
  await settleRankedMatch(h.env,{...event,notBefore:Date.now()+30_000});
  assert.equal(await size(h.env,'mafia_ranked_receipts'),0);
  const original=h.env.DB,restore=interposeBatch(h.env,hasSettlement,async()=>{
    await settleRankedMatch({...h.env,DB:original},event);
  });
  await settleRankedMatch(h.env,event);assert.equal(restore(),true);await settleRankedMatch(h.env,structuredClone(event));
  const ratings=await rows(h.env,'SELECT * FROM mafia_ranked_ratings');
  assert.equal(ratings.length,8);assert.ok(ratings.every(row=>row.games===1));assert.equal(await size(h.env,'mafia_ranked_receipts'),8);
  assert.equal((await rows(h.env,'SELECT delta FROM mafia_ranked_receipts')).reduce((sum,row)=>sum+row.delta,0),0);
  const changed=structuredClone(event);changed.results[0].won=false;
  await assert.rejects(settleRankedMatch(h.env,changed),{code:'MAFIA_RANKED_CONFLICT'});
});

for(const race of ['rating','d1-failure'])test(`settlement ${race} failure rolls back receipt, result ownership and all aggregates`,async t=>{
  const h=await fixture(t,{qualify:false}),event=await rankedEvent(h.env,h.season,h.people,{games:9});
  const restore=interposeBatch(h.env,hasSettlement,async(db,statements)=>{
    if(race==='rating')await db.prepare('UPDATE mafia_ranked_ratings SET rating=1001 WHERE user_id=?').bind(h.people[0].accountId).run();
    else statements.splice(4,0,db.prepare('INSERT INTO nonexistent_settlement_fixture VALUES(1)'));
  });
  await assert.rejects(settleRankedMatch(h.env,event));assert.equal(restore(),true);
  assert.equal(await size(h.env,'mafia_ranked_receipts'),0);assert.ok((await rows(h.env,'SELECT games FROM mafia_ranked_ratings')).every(row=>row.games===9));
  assert.equal((await query(h.env,'SELECT event_digest FROM mafia_ranked_matches WHERE match_key=?',event.ranked.key).first()).event_digest,null);
  await settleRankedMatch(h.env,event);assert.equal(await size(h.env,'mafia_ranked_receipts'),8);assert.ok((await rows(h.env,'SELECT games FROM mafia_ranked_ratings')).every(row=>row.games===10));
});

test('forfeits have a cooldown, natural elimination keeps the result, deletion cannot resurrect a participant',async t=>{
  const h=await fixture(t,{qualify:false}),event=await rankedEvent(h.env,h.season,h.people);
  event.results[0].forfeited=true;event.results[0].won=false;event.results[1].eliminatedAt=event.finishedAt-1000;
  await deleteUser(h.env,h.people[2].accountId);const before=Date.now();await settleRankedMatch(h.env,event);
  const forfeiter=await query(h.env,'SELECT * FROM mafia_ranked_ratings WHERE user_id=?',h.people[0].accountId).first();
  assert.ok(forfeiter.rating<=984);assert.equal(forfeiter.forfeits,1);assert.ok(forfeiter.cooldown_until>=before+900_000);
  assert.equal((await query(h.env,'SELECT wins FROM mafia_ranked_ratings WHERE user_id=?',h.people[1].accountId).first()).wins,1);
  assert.equal(await query(h.env,'SELECT * FROM mafia_ranked_receipts WHERE user_id=?',h.people[2].accountId).first(),null);
  assert.equal(await size(h.env,'mafia_ranked_receipts'),7);await settleRankedMatch(h.env,event);assert.equal(await size(h.env,'mafia_ranked_receipts'),7);
});

test('season closure waits for delayed settlement, then freezes one snapshot and preserves v1 history',async t=>{
  const h=await fixture(t,{qualify:false}),event=await rankedEvent(h.env,h.season,h.people,{games:9});
  h.env.MODERATOR_USER_IDS=h.people[0].accountId;
  await query(h.env,'UPDATE mafia_ranked_seasons SET ends_at=? WHERE id=?',Date.now()-1,h.season).run();
  await assert.rejects(closeRankedSeason(h.env,h.people[0].actor,h.season),{code:'MAFIA_RANKED_DRAINING'});
  assert.equal((await query(h.env,'SELECT status FROM mafia_ranked_seasons WHERE id=?',h.season).first()).status,'closing');
  await settleRankedMatch(h.env,event);await closeRankedSeason(h.env,h.people[0].actor,h.season);
  const snapshot=await rows(h.env,'SELECT * FROM mafia_ranked_season_snapshot ORDER BY user_id');assert.equal(snapshot.length,8);
  await closeRankedSeason(h.env,h.people[0].actor,h.season);await settleRankedMatch(h.env,event);
  assert.deepEqual(await rows(h.env,'SELECT * FROM mafia_ranked_season_snapshot ORDER BY user_id'),snapshot);
  assert.equal((await query(h.env,'SELECT rating_model FROM mafia_ranked_seasons WHERE id=?',h.season).first()).rating_model,'preview-elo-1');
});

test('technical cancellation has no rating receipt and clears assigned queue records',async t=>{
  const h=await fixture(t,{qualify:false}),event=await rankedEvent(h.env,h.season,h.people);
  await seedQueue(h.env,h.season,h.people);
  await query(h.env,"UPDATE mafia_ranked_queue SET status='assigned',match_key=?",event.ranked.key).run();
  await rankedRoomCommitted(h.env,{ranked:event.ranked,phase:'closed',technicalAbort:true,outcome:null});
  assert.equal((await query(h.env,'SELECT status FROM mafia_ranked_matches WHERE match_key=?',event.ranked.key).first()).status,'aborted');
  assert.equal(await size(h.env,'mafia_ranked_queue'),0);assert.equal(await size(h.env,'mafia_ranked_receipts'),0);assert.equal(await size(h.env,'mafia_ranked_ratings'),0);
});

test('eight authenticated socket clients reconnect to one match after the room/D1 acknowledgement window fails',{timeout:20_000},async t=>{
  const ORIGIN='http://localhost:3000',app=await startLocalServer({port:0,vars:syntheticVars()}),clients=[];
  t.after(async()=>{clients.forEach(client=>client.stop());await app.close();});
  const season=(await query(app.env,'SELECT id FROM mafia_ranked_seasons LIMIT 1').first()).id;
  await query(app.env,'UPDATE mafia_ranked_seasons SET starts_at=?,ends_at=? WHERE id=?',Date.now()-60_000,Date.now()+3_600_000,season).run();
  const people=await peopleFor(app.env,8);await qualifyPeople(app.env,people);
  async function api(person,path,body) {
    const response=await fetch(app.url+path,{method:body?'POST':'GET',headers:{origin:ORIGIN,authorization:`Bearer ${person.authorization}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  }
  for(const person of people.slice(0,7))assert.equal((await api(person,'/api/mafia/ranked/queue/join',person)).status,200);
  const db=app.env.DB,prepare=db.prepare.bind(db);let failOnce=true;
  db.prepare=sql=>{
    const statement=prepare(sql);
    if(!sql.startsWith("UPDATE mafia_ranked_matches SET status='playing'"))return statement;
    const wrap=value=>{const bind=value.bind.bind(value),run=value.run.bind(value);value.bind=(...args)=>wrap(bind(...args));value.run=async()=>{if(failOnce){failOnce=false;throw new Error('synthetic D1 acknowledgement loss');}return run();};return value;};
    return wrap(statement);
  };
  const failed=await api(people[7],'/api/mafia/ranked/queue/join',people[7]);assert.equal(failed.status,500,JSON.stringify(failed));db.prepare=prepare;
  const pending=await query(app.env,"SELECT * FROM mafia_ranked_matches WHERE status='creating'").first();assert.ok(pending);
  const durable=app.rooms.get(pending.room_code);assert.equal(durable.instance.room.participants.length,8);
  assert.equal((await api(people[7],'/api/mafia/ranked/queue/status',people[7])).status,200);
  assert.equal(await size(app.env,'mafia_ranked_matches'),1);assert.equal((await query(app.env,'SELECT status FROM mafia_ranked_matches').first()).status,'playing');
  class BrowserSocket extends WebSocket {constructor(url){super(url,{origin:ORIGIN});}}
  for(const person of people) {
    const state=(await api(person,'/api/mafia/ranked')).body;
    assert.equal(state.queue.code,pending.room_code);assert.notEqual(state.queue.seatId,person.id);
    const client=new RoomClient({server:app.url,code:state.queue.code,session:{id:state.queue.seatId,token:person.token},getAccountAuthorization:()=>`Bearer ${person.authorization}`,WebSocketImpl:BrowserSocket});
    clients.push(client);client.start();
  }
  const until=async condition=>{const end=Date.now()+5000;while(Date.now()<end){if(condition())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('ranked sockets did not authenticate/reconnect');};
  await until(()=>clients.every(client=>client.state?.members.filter(member=>member.connected).length===8));
  assert.ok(clients.every(client=>client.state.rulesetVersion===1&&client.state.ranked.rulesetVersion===1));
  const firstSeat=clients[0].session.id;clients[0].reconnectNow();await until(()=>clients[0].state?.you?.id===firstSeat&&clients[0].connectionStatus==='connected');
  assert.equal(durable.instance.room.participants.length,8);assert.equal(await size(app.env,'mafia_seats'),8);assert.equal(await size(app.env,'mafia_match_leases'),8);
  await durable.instance.serial(async()=>{const stopped=structuredClone(durable.instance.room);technicalAbort(stopped,Date.now(),'synthetic_test_cleanup');await durable.instance.commit(stopped);});
  assert.equal(await size(app.env,'mafia_ranked_receipts'),0);
});
