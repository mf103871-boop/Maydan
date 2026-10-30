import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { deleteUser } from '../server/accounts/db.mjs';
import { persistMafiaResult } from '../server/mafia-results.mjs';
import { persistMafiaProgress } from '../server/mafia-progression.mjs';

async function fixture(t) {
  const env={DB:createLocalD1(),MAFIA_PROGRESS_ENABLED:'1'};t.after(()=>env.DB.close());
  const results=Array.from({length:6},(_,index)=>({userId:`legacy-user-${index}`,playerId:`legacy-seat-${index}`,
    roleId:'citizen',initialFaction:'town',faction:'town',won:true,forfeited:false,eliminatedAt:null}));
  for(const result of results)await env.DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)')
    .bind(result.userId,'synthetic legacy account',1,1).run();
  // Exact old envelope shape: no participantCount, eventId, schema, source or
  // reward-policy fields. The full reveal is the remaining completeness proof.
  const event={key:`legacy-room:${crypto.randomUUID()}`,roomCode:'123456',rulesetVersion:1,finishedAt:Date.now()-60_000,draw:false,
    summary:JSON.stringify({mode:'classic',outcome:{faction:'town'},history:[],
      reveal:{players:results.map(({userId: _userId,...player})=>player),events:[]}}),results};
  const history=()=>env.DB.prepare('SELECT summary FROM mafia_history WHERE match_key=?').bind(event.key).first();
  const individual=async()=> (await env.DB.prepare('SELECT user_id FROM mafia_results WHERE match_key=? ORDER BY user_id').bind(event.key).all()).results;
  return {env,event,history,individual};
}

test('a complete old outbox remains compatible but cannot resurrect the reveal after actual account deletion',async t=>{
  const h=await fixture(t);
  await persistMafiaResult(h.env,h.event);await persistMafiaProgress(h.env,h.event);
  assert.ok(await h.history());assert.equal((await h.individual()).length,6);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM mafia_progress_events').first()).n,0,'legacy outbox never acquires XP policy');
  await deleteUser(h.env,h.event.results[0].userId);
  assert.equal(await h.history(),null);assert.equal((await h.individual()).length,5);
  await persistMafiaResult(h.env,h.event);assert.equal(await h.history(),null);
  assert.equal((await h.individual()).length,5);
});

test('an old outbox missing a participant mapping never treats its remaining IDs as proof of completeness',async t=>{
  const h=await fixture(t);
  await persistMafiaResult(h.env,h.event);await deleteUser(h.env,h.event.results[0].userId);
  const incomplete={...h.event,results:h.event.results.slice(1)};
  assert.equal(JSON.parse(incomplete.summary).reveal.players.length,6);assert.equal(incomplete.results.length,5);
  await persistMafiaResult(h.env,incomplete);
  assert.equal(await h.history(),null,'missing participantCount must not fall back to remaining IDs and resurrect deleted-person reveal');
  assert.equal((await h.individual()).length,5,'other players retain independent live-account results');
});

test('legacy reveal proof must identify every seat exactly once and agree with any declared participant count',async t=>{
  for(const mutation of [
    event=>{event.results[0].playerId=event.results[1].playerId;},
    event=>{const summary=JSON.parse(event.summary);summary.reveal.players[0].playerId=summary.reveal.players[1].playerId;event.summary=JSON.stringify(summary);},
    event=>{event.participantCount=5;},
    event=>{event.summary='not JSON';},
    event=>{event.summary=JSON.stringify({mode:'classic'});},
  ]) {
    const h=await fixture(t);mutation(h.event);
    await persistMafiaResult(h.env,h.event);
    assert.equal(await h.history(),null);
    assert.equal((await h.individual()).length,6,'fail-closed shared reveal does not erase independent result rows');
  }
});
