import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { migrationStatements } from '../server/local-d1.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url)),ORIGIN='https://progress-fixture.test';

test('workerd/D1 progression: additive migration, concurrent quota, exactly-once claims, rollback and live SQL guards', {timeout:60000},async t=>{
  const tempRoot=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(tempRoot,'mafia-progress-edge-'));let mf;
  try {
    const scriptPath=path.join(directory,'worker.mjs');
    await build({stdin:{resolveDir:ROOT,sourcefile:'progress-edge-fixture.mjs',contents:`
      import {persistMafiaProgress,mafiaProgressStatements} from './server/mafia-progression.mjs';
      export default {async fetch(request,env){try{
        const event=await request.json(),actual=env.DB,race=request.headers.get('x-fixture-race');
        if(race){env={...env,DB:{prepare:sql=>actual.prepare(sql),batch:async statements=>{
          const id=event.results[0].userId;
          if(race==='delete')await actual.prepare('INSERT INTO account_deletions(user_id,attempt_id,created_at) VALUES(?,?,?)').bind(id,'edge-progress',Date.now()).run();
          if(race==='suspend')await actual.prepare('INSERT INTO moderation_suspensions VALUES(?,?,?,?,?)').bind(id,'fixture-mod','fixture',Date.now(),Date.now()).run();
          if(race==='fail')statements=[...statements.slice(0,3),actual.prepare('INSERT INTO missing_progress_fixture VALUES(1)'),...statements.slice(3)];
          return actual.batch(statements);
        }}};}
        if(new URL(request.url).pathname==='/legacy')await env.DB.batch(await mafiaProgressStatements(env,event,{legacy:true}));
        else await persistMafiaProgress(env,event);
        return Response.json({ok:true});
      }catch(error){return Response.json({error:error.code||'D1_FAILURE'},{status:error.status||500});}}};
    `},bundle:true,platform:'browser',format:'esm',outfile:scriptPath,logLevel:'silent'});
    mf=new Miniflare(convertV4MiniflareOptions({rootPath:directory,name:'mafia-progress-fixture',modules:true,scriptPath,
      compatibilityDate:'2026-09-01',d1Databases:{DB:'mafia-progress-fixture'},bindings:{MAFIA_PROGRESS_ENABLED:'1'},cf:false}));
    await mf.ready;const db=await mf.getD1Database('DB');
    const sql=migrationStatements(),newStatements=sql.filter(statement=>/CREATE (?:TABLE|INDEX) IF NOT EXISTS mafia_(?:progress|player_progress|role_progress)/.test(statement));
    assert.equal(newStatements.length,4);await db.exec(sql.filter(statement=>!newStatements.includes(statement)).join('\n'));
    async function person(){const id=crypto.randomUUID();await db.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(id,'fixture',Date.now(),Date.now()).run();return id;}
    const first=await person(),oldUser=await db.prepare('SELECT * FROM users WHERE id=?').bind(first).first();
    const row=id=>db.prepare('SELECT * FROM mafia_player_progress WHERE user_id=?').bind(id).first();
    const receipts=async id=>(await db.prepare('SELECT * FROM mafia_progress_events WHERE user_id=?').bind(id).all()).results;
    const event=(id,changes={})=>{const finishedAt=Date.now()-31_000;return {eventSchemaVersion:1,eventKind:'match_completed',source:'live',rewardPolicyVersion:1,
      key:`fixture:${crypto.randomUUID()}`,eventId:`online:${crypto.randomUUID()}`,rulesetVersion:1,
      startedAt:finishedAt-120_000,finishedAt,notBefore:finishedAt+30_000,visibility:'private',mode:'classic',capacity:6,participantCount:6,draw:false,
      results:[{userId:id,roleId:'investigator',initialFaction:'town',faction:'town',won:false,forfeited:false,eliminatedAt:null}],...changes};};
    const consume=async(value,race,endpoint='/consume')=>{
      const response=await mf.dispatchFetch(ORIGIN+endpoint,{method:'POST',headers:{'content-type':'application/json',...(race?{'x-fixture-race':race}:{})},body:JSON.stringify(value)});
      return {status:response.status,...await response.json()};
    };

    await t.test('0019 preserves prior account data and can be re-applied without changing progress',async()=>{
      await db.exec(newStatements.join('\n'));assert.deepEqual(await db.prepare('SELECT * FROM users WHERE id=?').bind(first).first(),oldUser);
      const definition=await db.prepare("SELECT sql FROM sqlite_master WHERE name='mafia_progress_events'").first();
      assert.match(definition.sql,/PRIMARY KEY\(user_id,match_key,event_kind\)/);
      await consume(event(first));const before=await row(first);await db.exec(newStatements.join('\n'));assert.deepEqual(await row(first),before);
    });
    await t.test('concurrent duplicate deliveries grant exactly three private rewards in atomic acceptance order',async()=>{
      const id=await person(),events=Array.from({length:4},()=>event(id));
      const replies=await Promise.all([...events,events[0],structuredClone(events[1])].map(value=>consume(value)));
      assert.ok(replies.every(reply=>reply.status===200),JSON.stringify(replies));
      const rows=await receipts(id);assert.equal(rows.length,4);assert.equal(rows.filter(receipt=>receipt.participation_granted).length,3);
      assert.ok(rows.every(receipt=>receipt.status==='processed'));
      assert.equal((await row(id)).total_xp,150);assert.equal((await row(id)).rewarded_matches,3);
      assert.equal((await db.prepare('SELECT qualified_matches FROM mafia_role_progress WHERE user_id=?').bind(id).first()).qualified_matches,3);
      const conflict=structuredClone(events[0]);conflict.results[0].won=true;
      assert.equal((await consume(conflict)).status,500);assert.equal((await row(id)).total_xp,150);
    });
    await t.test('a real D1 failure rolls back receipt and aggregates, and retry obtains the unconsumed quota',async()=>{
      const id=await person(),value=event(id);
      assert.equal((await consume(value,'fail')).status,500);assert.deepEqual(await receipts(id),[]);assert.equal(await row(id),null);
      assert.equal((await consume(value)).status,200);assert.equal((await consume(value)).status,200);
      assert.equal((await row(id)).total_xp,50);assert.equal((await receipts(id)).length,1);
    });
    await t.test('account deletion/suspension inserted at the batch boundary prevents all progress writes',async()=>{
      for(const race of ['delete','suspend']){
        const id=await person();assert.equal((await consume(event(id),race)).status,200);
        assert.deepEqual(await receipts(id),[]);assert.equal(await row(id),null);
        assert.equal(await db.prepare('SELECT 1 FROM mafia_role_progress WHERE user_id=?').bind(id).first(),null);
      }
    });
    await t.test('privacy delay rejects before writing; legacy copies never use the live quota or mastery',async()=>{
      const id=await person(),pending=event(id,{finishedAt:Date.now(),notBefore:Date.now()+30_100});
      assert.equal((await consume(pending)).status,503);assert.deepEqual(await receipts(id),[]);
      const old=event(id,{source:'legacy',rewardPolicyVersion:null,startedAt:null,visibility:null,mode:null,capacity:null,participantCount:null});
      assert.equal((await consume(old,undefined,'/legacy')).status,200);assert.equal((await consume(old,undefined,'/legacy')).status,200);
      const progress=await row(id);assert.equal(progress.total_xp,0);assert.equal(progress.rewarded_matches,0);assert.equal(progress.legacy_matches,1);
      assert.equal((await db.prepare('SELECT qualified_matches FROM mafia_role_progress WHERE user_id=?').bind(id).first()).qualified_matches,0);
    });
  } finally {
    if(mf)await mf.dispose();
    const relative=path.relative(tempRoot,path.resolve(directory));
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
    await rm(directory,{recursive:true,force:true});
  }
});
