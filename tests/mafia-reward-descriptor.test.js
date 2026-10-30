import test from 'node:test';
import assert from 'node:assert/strict';
import * as mafia from '../server/mafia-model.mjs';
import { bindSeatAccount,prepareRoomStats } from '../server/room-stats.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { Room } from '../server/room.mjs';
import { MemoryStorage } from '../server/local.mjs';

async function fixture(t,{policy=true}={}) {
  const now=Date.now()-100_000,DB=createLocalD1(),storage=new MemoryStorage();
  t.after(()=>DB.close());
  const person=n=>({id:`seat-${n}`,tokenHash:`token-${n}`,name:`لاعب ${n}`,avatar:n%4});
  const game=mafia.createRoom('123456',{...person(0),settings:{mode:'classic',capacity:6,visibility:'public',voiceMode:'off'}},now);
  for(let n=1;n<6;n++)mafia.joinRoom(game,person(n),now);
  for(let n=0;n<6;n++) {
    await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(`account-${n}`,`لاعب ${n}`,now,now).run();
    bindSeatAccount(game,`seat-${n}`,`account-${n}`);mafia.connected(game,`seat-${n}`,true,now);
    mafia.action(game,`seat-${n}`,{type:'ready',ready:true,matchId:game.matchId,phaseId:game.phaseId},now);
  }
  const before=structuredClone(game);let random=12;
  mafia.action(game,'seat-0',{type:'start',matchId:game.matchId,phaseId:game.phaseId},now,{randomWord:()=>random=(Math.imul(random,1664525)+1013904223)>>>0});
  Object.assign(game,{mafiaKey:'reward-fixture-room',protocol:2});
  prepareRoomStats(before,game,now,{mafiaProgressEnabled:policy});
  await storage.put('room',game);
  const ctx={storage,blockConcurrencyWhile:fn=>fn(),getWebSockets:()=>[]};
  const env={DB,MAFIA_ENABLED:'1',MAFIA_PROGRESS_ENABLED:'1'};
  const runtime=new Room(ctx,env);await runtime.ready;
  const over=structuredClone(game);
  Object.assign(over,{phase:'over',phaseId:game.phaseId+1,outcome:{faction:'town',endedAt:Date.now(),reason:'faction'},winners:game.participants.filter(id=>game.roleStates[id].faction==='town')});
  return {runtime,ctx,env,over};
}

test('the committed owner locator survives successful outbox drain and room restoration without exposing reward amounts',async t=>{
  const h=await fixture(t);await h.runtime.commit(h.over,{prepared:true});
  const event=h.runtime.mafiaResultOutbox[0],descriptor=h.runtime.stateFor('seat-0').rewardReceipt;
  assert.deepEqual(descriptor,{matchKey:event.key,notBefore:event.notBefore});
  assert.deepEqual(Object.keys(descriptor).sort(),['matchKey','notBefore']);
  assert.equal(h.runtime.stateFor('seat-1').rewardReceipt.matchKey,descriptor.matchKey);
  h.runtime.room.statsMatch.rewardReceipt.internalOnly='not-for-the-client';
  assert.deepEqual(h.runtime.stateFor('seat-0').rewardReceipt,descriptor);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) AS n FROM mafia_progress_events').first()).n,0);
  t.mock.method(Date,'now',()=>event.notBefore);
  await h.runtime.flushMafiaResults();assert.equal(h.runtime.mafiaResultOutbox.length,0);
  const restored=new Room(h.ctx,h.env);await restored.ready;
  assert.deepEqual(restored.stateFor('seat-0').rewardReceipt,descriptor);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) AS n FROM mafia_progress_events').first()).n,6);
  assert.doesNotMatch(JSON.stringify(mafia.publicSnapshot(restored.room)),/rewardReceipt|reward-fixture-room|notBefore/);
});

test('a locator is withheld from active state, spectators, replaced accounts and unmarked legacy matches',async t=>{
  const h=await fixture(t);await h.runtime.commit(h.over,{prepared:true});
  const ended=structuredClone(h.runtime.room);
  h.runtime.room.phase='discussion';assert.equal(h.runtime.stateFor('seat-0').rewardReceipt,undefined);
  h.runtime.room=structuredClone(ended);h.runtime.room.members[0].accountUserId='replacement';
  assert.equal(h.runtime.stateFor('seat-0').rewardReceipt,undefined);
  h.runtime.room=structuredClone(ended);h.runtime.room.members.push({id:'late-seat',name:'منتظر',accountUserId:'late-account',avatar:0,connected:true});
  assert.equal(h.runtime.stateFor('late-seat').rewardReceipt,undefined);
  h.runtime.room=structuredClone(ended);delete h.runtime.room.statsMatch.rewardPolicyVersion;
  assert.equal(h.runtime.stateFor('seat-0').rewardReceipt,undefined);
});

test('an old or technically aborted result never acquires a live reward locator',async t=>{
  const legacy=await fixture(t,{policy:false});await legacy.runtime.commit(legacy.over,{prepared:true});
  assert.equal(legacy.runtime.stateFor('seat-0').rewardReceipt,undefined);
  const cancelled=await fixture(t);cancelled.over.technicalAbort=true;
  await cancelled.runtime.commit(cancelled.over,{prepared:true});
  assert.equal(cancelled.runtime.stateFor('seat-0').rewardReceipt,undefined);
  assert.equal(cancelled.runtime.mafiaResultOutbox.length,0);
});
