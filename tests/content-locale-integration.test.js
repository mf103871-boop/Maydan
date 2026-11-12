import test from 'node:test';
import assert from 'node:assert/strict';
import { rankedCoordinator } from '../server/mafia-ranked.mjs';
import { fixture, seedQueue, query, rows, interposeBatch, qualifyPeople } from './mafia-matchmaking-integration-fixture.mjs';
import * as game from '../server/game-model.mjs';
import { getCategories } from '../src/data/game-content.js';
import logic from '../src/games/badeeha/logic.js';

test('real D1 allocation separates interleaved English and Arabic queues before reserving seats', async t => {
  const h=await fixture(t,{count:16,qualify:false});await qualifyPeople(h.env,h.people.slice(0,8));await qualifyPeople(h.env,h.people.slice(8));await seedQueue(h.env,h.season,h.people);
  for(const [index,p]of h.people.entries())if(index%2)await query(h.env,"UPDATE mafia_ranked_queue SET content_locale='en' WHERE user_id=?",p.accountId).run();
  await rankedCoordinator(h.env,{operation:'status',actor:h.people[0].actor,body:h.people[0]});
  const assigned=await rows(h.env,"SELECT content_locale FROM mafia_ranked_queue WHERE status='assigned'");
  assert.equal(assigned.length,8);assert.equal(new Set(assigned.map(row=>row.content_locale)).size,1);
  assert.equal(h.calls.find(call=>call.endpoint==='/mafia-ranked-create').body.contentLocale,assigned[0].content_locale);
  assert.equal((await rows(h.env,"SELECT user_id FROM mafia_ranked_queue WHERE status='queued'")).length,8);
});

test('locale changes racing the D1 assignment cannot mix or partially reserve a match', async t => {
  const h=await fixture(t);await seedQueue(h.env,h.season,h.people);
  const restore=interposeBatch(h.env,statements=>statements.some(s=>s.sql.startsWith('INSERT INTO mafia_ranked_matches')),async db=>{
    await db.prepare("UPDATE mafia_ranked_queue SET content_locale='en' WHERE user_id=?").bind(h.people[0].accountId).run();
  });
  await assert.rejects(rankedCoordinator(h.env,{operation:'status',actor:h.people[7].actor,body:h.people[7]}));
  assert.equal(restore(),true);assert.equal((await rows(h.env,'SELECT * FROM mafia_ranked_matches')).length,0);
  assert.equal((await rows(h.env,"SELECT * FROM mafia_ranked_queue WHERE status='queued'")).length,8);
  assert.equal(h.calls.length,0);
});

test('English admission stop skips an older English queue and still allocates Arabic seats', async t => {
  const h=await fixture(t,{count:16,qualify:false});await qualifyPeople(h.env,h.people.slice(0,8));await qualifyPeople(h.env,h.people.slice(8));await seedQueue(h.env,h.season,h.people);
  for(const p of h.people.slice(0,8))await query(h.env,"UPDATE mafia_ranked_queue SET content_locale='en' WHERE user_id=?",p.accountId).run();
  h.env.ENGLISH_CONTENT_ENABLED='0';
  await rankedCoordinator(h.env,{operation:'status',actor:h.people[0].actor,body:h.people[0]});
  const assigned=await rows(h.env,"SELECT content_locale FROM mafia_ranked_queue WHERE status='assigned'");
  assert.equal(assigned.length,8);assert.ok(assigned.every(row=>row.content_locale==='ar'));
  assert.equal(h.calls.find(call=>call.endpoint==='/mafia-ranked-create').body.contentLocale,'ar');
});

test('English Badeeha uses real pinned question IDs, and revalidates a changed deck at start', () => {
  const CATS=getCategories('en'),categories=CATS.slice(0,6).map(c=>c.id),deck=logic.buildDeck(CATS,categories,{},logic.MODES.standard.tiers,30);
  const settings={mode:'standard',roundSize:30,timer:60,categories,deck:Object.fromEntries(Object.entries(deck).map(([id,questions])=>[id,questions.map(q=>({qid:q.qid,p:q.p}))]))};
  const people=[1,2].map(n=>({id:`test-seat-${n}`,name:`Team ${n}`,tokenHash:`secret-${n}`,avatar:n,capabilities:{badeeha:1,localizedContent:1}}));
  const now=Date.now(),room=game.createRoom('123456',{...people[0],game:'badeeha',settings,contentLocale:'en'},now);
  game.joinRoom(room,people[1],now);
  for(const player of people){game.connected(room,player.id,true,now);game.action(room,player.id,{type:'ready',ready:true,matchId:0},now);}
  const valid=structuredClone(room),first=room.settings.deck[categories[0]][0];first.qid='forged-question';
  assert.throws(()=>game.action(room,people[0].id,{type:'start',matchId:0},now),error=>error.code==='QUESTIONS');
  assert.equal(room.phase,'lobby');
  game.action(valid,people[0].id,{type:'start',matchId:0},now);assert.equal(valid.phase,'board');
  assert.equal(game.snapshot(valid,people[1].id,now).contentVersion,'new-en');
});
