import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { migrationSql } from '../server/local-d1.mjs';
import { makeMafiaRatingPolicy,canonicalMafiaRatingValue } from '../server/mafia-rating-policy.mjs';
import { mafiaRatingSHA256 } from '../server/mafia-rating-calibration.mjs';
import { query,rows,peopleFor,rankedEvent,syntheticVars } from './mafia-matchmaking-integration-fixture.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));

test('workerd/D1: transaction-time policy binding, concurrent result delivery and failed-batch rollback',{timeout:60_000},async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'maydan-ranked-policy-edge-'));let mf;
  try {
    const scriptPath=path.join(directory,'worker.mjs');
    await build({stdin:{resolveDir:ROOT,sourcefile:'ranked-policy-integration-fixture.mjs',contents:`
      import {bindMafiaSeasonRatingPolicy} from './server/mafia-rating-policy-store.mjs';
      import {settleRankedMatch} from './server/mafia-ranked.mjs';
      export default {async fetch(request,env){try{
        const input=await request.json(),actual=env.DB;
        if(input.race)env={...env,DB:{prepare:sql=>actual.prepare(sql),batch:async statements=>{
          if(input.race==='season-start'){
            await new Promise(resolve=>setTimeout(resolve,20));
            const clock=await actual.prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS at").first();
            await actual.prepare('UPDATE mafia_ranked_seasons SET starts_at=? WHERE id=?').bind(clock.at-1,input.body.seasonId).run();
          }
          if(input.race==='fail')statements.splice(3,0,actual.prepare('INSERT INTO nonexistent_ranked_edge_fixture VALUES(1)'));
          return actual.batch(statements);
        }}};
        const value=input.operation==='bind'?await bindMafiaSeasonRatingPolicy(env,input.actor,input.body):await settleRankedMatch(env,input.event);
        return Response.json({ok:true,value});
      }catch(error){return Response.json({error:error.code||'D1_FAILURE'},{status:error.status||500});}}};
    `},bundle:true,platform:'browser',format:'esm',outfile:scriptPath,logLevel:'silent'});
    mf=new Miniflare(convertV4MiniflareOptions({rootPath:directory,name:'mafia-ranked-policy-fixture',modules:true,scriptPath,compatibilityDate:'2026-09-01',
      d1Databases:{DB:'mafia-ranked-policy-fixture'},bindings:{...syntheticVars(),MODERATOR_USER_IDS:'synthetic-reviewer'},cf:false}));
    await mf.ready;const DB=await mf.getD1Database('DB'),env={...syntheticVars(),DB};await DB.exec(migrationSql());
    const at=Date.now(),actor={userId:'synthetic-reviewer',sessionId:'ffeeddccbbaa9988'};
    await query(env,"INSERT INTO users(id,name,created_at,updated_at) VALUES(?,'synthetic reviewer',?,?)",actor.userId,at,at).run();
    await query(env,"INSERT INTO sessions(id,user_id,secret_hash,client,created_at,last_seen,expires_at) VALUES(?,?,?,'web',?,?,?)",actor.sessionId,actor.userId,'a'.repeat(64),at,at,at+3_600_000).run();
    const policy=makeMafiaRatingPolicy(0.5,'b'.repeat(64)),id=await mafiaRatingSHA256(policy);
    // A synthetic immutable policy fixture tests binding; no publication or
    // human-evidence acceptance is claimed by this fabricated database row.
    await query(env,"INSERT INTO mafia_rating_policies VALUES(?,?,'{}',?,?,'reviewed-supplied-evidence',?,?)",id,canonicalMafiaRatingValue(policy),'c'.repeat(64),'b'.repeat(64),at,actor.userId).run();
    const dispatch=async input=>{const response=await mf.dispatchFetch('https://ranked-policy.test/consume',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};};

    await t.test('SQLite clock is available and a season crossing the D1-write boundary cannot be rebound',async()=>{
      const now=await query(env,"SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS at").first();assert.ok(Number.isSafeInteger(now.at));assert.ok(Math.abs(now.at-Date.now())<5000);
      await query(env,"INSERT INTO mafia_ranked_seasons(id,starts_at,ends_at,ruleset_version,rating_model,reward_policy,status) VALUES('future-clock',?,?,1,'preview-elo-1',1,'open')",Date.now()+60_000,Date.now()+3_600_000).run();
      const response=await dispatch({operation:'bind',actor,body:{seasonId:'future-clock',policyId:id},race:'season-start'});
      assert.equal(response.status,409,JSON.stringify(response));assert.equal(response.body.error,'MAFIA_RATING_SEASON_FIXED');
      assert.equal(await query(env,"SELECT 1 FROM mafia_ranked_season_policy WHERE season_id='future-clock'").first(),null);
    });

    await t.test('valid future binding survives a same-policy retry once its season has begun',async()=>{
      await query(env,"INSERT INTO mafia_ranked_seasons(id,starts_at,ends_at,ruleset_version,rating_model,reward_policy,status) VALUES('future-good',?,?,1,'preview-elo-1',1,'open')",Date.now()+60_000,Date.now()+3_600_000).run();
      const input={operation:'bind',actor,body:{seasonId:'future-good',policyId:id}},first=await dispatch(input);assert.equal(first.status,200,JSON.stringify(first));
      await query(env,"UPDATE mafia_ranked_seasons SET starts_at=? WHERE id='future-good'",Date.now()-1).run();
      assert.deepEqual(await dispatch(input),first);assert.equal((await rows(env,"SELECT * FROM mafia_ranked_season_policy WHERE season_id='future-good'")).length,1);
    });

    await t.test('simultaneous consumers receive one committed ownership token and eight receipts',async()=>{
      const people=await peopleFor(env,8),season=(await query(env,'SELECT id FROM mafia_ranked_seasons WHERE id LIKE ?','preview-%').first()).id,event=await rankedEvent(env,season,people);
      const responses=await Promise.all(Array.from({length:4},()=>dispatch({operation:'settle',event})));
      assert.ok(responses.every(response=>response.status===200),JSON.stringify(responses));
      assert.equal((await rows(env,'SELECT * FROM mafia_ranked_receipts WHERE match_key=?',event.ranked.key)).length,8);
      assert.ok((await rows(env,'SELECT games FROM mafia_ranked_ratings WHERE season_id=?',season)).every(row=>row.games===1));
    });

    await t.test('failed SQL after ownership reservation rolls everything back and leaves a retryable result',async()=>{
      const people=await peopleFor(env,8),season=(await query(env,'SELECT id FROM mafia_ranked_seasons WHERE id LIKE ?','preview-%').first()).id,event=await rankedEvent(env,season,people);
      assert.equal((await dispatch({operation:'settle',event,race:'fail'})).status,500);
      assert.equal((await rows(env,'SELECT * FROM mafia_ranked_receipts WHERE match_key=?',event.ranked.key)).length,0);
      assert.equal((await query(env,'SELECT event_digest FROM mafia_ranked_matches WHERE match_key=?',event.ranked.key).first()).event_digest,null);
      assert.equal((await dispatch({operation:'settle',event})).status,200);
      assert.equal((await rows(env,'SELECT * FROM mafia_ranked_receipts WHERE match_key=?',event.ranked.key)).length,8);
    });
  } finally {
    if(mf)await mf.dispose();const relative=path.relative(os.tmpdir(),directory);
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await rm(directory,{recursive:true,force:true});
  }
});
