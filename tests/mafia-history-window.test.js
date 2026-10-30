import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalD1} from '../server/local-d1.mjs';
import {readMafiaHistory} from '../server/mafia-profile.mjs';

const DAY=86_400_000,NOW=Date.now(),LOWER=NOW-30*DAY;
async function fixture(){
  const DB=createLocalD1(),env={DB};
  for(const id of ['owner','other'])await DB.prepare('INSERT INTO users(id,name,created_at,updated_at)VALUES(?,?,?,?)').bind(id,id,NOW,NOW).run();
  const insert=(key,finishedAt,{user='owner',won=0,draw=0}={})=>DB.prepare(`INSERT INTO mafia_results(user_id,match_key,role_id,initial_faction,faction,won,draw,forfeited,finished_at)
    VALUES(?,?,'citizen','town','town',?,?,0,?)`).bind(user,key,won,draw,finishedAt).run();
  return {DB,env,insert};
}
const totals=stats=>stats.reduce((sum,row)=>({matches:sum.matches+row.matches,wins:sum.wins+row.wins,draws:sum.draws+row.draws}),{matches:0,wins:0,draws:0});

test('SQLite history counts use the same exclusive 30-day floor and inclusive upper bound as matches without changing permanent progress',async()=>{
  const {DB,env,insert}=await fixture();try{
    await insert('boundary:expired',LOWER-1,{won:1});await insert('boundary:floor',LOWER,{draw:1});
    await insert('boundary:inside',LOWER+1);await insert('boundary:upper',NOW,{won:1});await insert('boundary:future',NOW+1,{draw:1});
    await insert('boundary:other-account',NOW,{user:'other',won:1});
    await DB.prepare('INSERT INTO mafia_player_progress(user_id,total_xp,rewarded_matches,legacy_matches,updated_at)VALUES(?,2500,20,7,?)').bind('owner',NOW).run();
    await DB.prepare("INSERT INTO mafia_role_progress(user_id,role_id,qualified_matches,wins,draws,legacy_matches,updated_at)VALUES(?,'citizen',12,8,1,4,?)").bind('owner',NOW).run();
    const before={player:await DB.prepare('SELECT * FROM mafia_player_progress WHERE user_id=?').bind('owner').first(),role:await DB.prepare('SELECT * FROM mafia_role_progress WHERE user_id=?').bind('owner').first()};
    const result=await readMafiaHistory(env,'owner',new URLSearchParams(),NOW);
    assert.deepEqual(result.matches.map(row=>row.matchKey),['boundary:upper','boundary:inside']);
    assert.deepEqual(totals(result.stats),{matches:2,wins:1,draws:0});assert.equal(result.nextCursor,null);
    assert.deepEqual({player:await DB.prepare('SELECT * FROM mafia_player_progress WHERE user_id=?').bind('owner').first(),role:await DB.prepare('SELECT * FROM mafia_role_progress WHERE user_id=?').bind('owner').first()},before);
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM mafia_results').first()).n,6,'window reads must not depend on cron or delete archived rows');
  }finally{DB.close();}
});

test('SQLite cursor pages keep the frozen upper time while the retention floor rolls, excluding arrivals after it and delayed expired outbox rows',async()=>{
  const {DB,env,insert}=await fixture();try{
    await insert('snapshot:newest',NOW,{won:1});await insert('snapshot:z',NOW-1000,{draw:1});await insert('snapshot:a',NOW-1000,{won:1});
    await insert('snapshot:middle',NOW-2000);await insert('snapshot:older',NOW-3000,{won:1});await insert('snapshot:aging',LOWER+1,{won:1});
    await insert('snapshot:already-expired',LOWER-1,{won:1});
    const first=await readMafiaHistory(env,'owner',new URLSearchParams({limit:'2'}),NOW);
    assert.deepEqual(first.matches.map(row=>row.matchKey),['snapshot:newest','snapshot:z']);assert.ok(first.nextCursor);
    assert.deepEqual(totals(first.stats),{matches:6,wins:4,draws:1});
    // Both rows genuinely arrive after page one. One finished after its upper
    // time; the other is an expired result written by a delayed consumer.
    await insert('snapshot:arrived-after-page-one',NOW+1,{won:1});await insert('snapshot:delayed-expired',LOWER-100_000,{draw:1});
    const later=NOW+1000,second=await readMafiaHistory(env,'owner',new URLSearchParams({limit:'2',cursor:first.nextCursor}),later);
    assert.deepEqual(second.matches.map(row=>row.matchKey),['snapshot:a','snapshot:middle']);assert.ok(second.nextCursor);
    assert.deepEqual(totals(second.stats),{matches:5,wins:3,draws:1});assert.equal(JSON.parse(atob(second.nextCursor)).at,NOW);
    const third=await readMafiaHistory(env,'owner',new URLSearchParams({limit:'2',cursor:second.nextCursor}),later);
    assert.deepEqual(third.matches.map(row=>row.matchKey),['snapshot:older']);assert.equal(third.nextCursor,null);assert.deepEqual(third.stats,second.stats);
    const keys=[...first.matches,...second.matches,...third.matches].map(row=>row.matchKey);assert.equal(new Set(keys).size,5);
    assert.equal(keys.some(key=>key.includes('expired')||key.includes('arrived-after')||key.includes('aging')),false);
    const refreshed=await readMafiaHistory(env,'owner',new URLSearchParams(),later);
    assert.equal(refreshed.matches[0].matchKey,'snapshot:arrived-after-page-one');assert.deepEqual(totals(refreshed.stats),{matches:6,wins:4,draws:1});
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM mafia_results WHERE user_id=?').bind('owner').first()).n,9);
  }finally{DB.close();}
});
