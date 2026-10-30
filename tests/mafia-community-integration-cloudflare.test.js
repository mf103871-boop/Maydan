import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { migrationStatements } from '../server/local-d1.mjs';
import { issueSession } from '../server/accounts/session.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url)),ORIGIN='https://maydan-mafia-preview.mf103871.workers.dev';

test('community integration on real local workerd/D1: fixed roster, transactional rounds and permanent recognition', {timeout:60_000},async()=>{
  const temporaryRoot=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(temporaryRoot,'mafia-community-integration-'));let mf;
  try {
    const scriptPath=path.join(directory,'worker.mjs');
    await build({stdin:{resolveDir:ROOT,sourcefile:'community-integration-fixture.mjs',contents:`
      import {routeMafiaCommunity} from './server/mafia-community.mjs';
      import {persistMafiaProgress} from './server/mafia-progression.mjs';
      import {persistMafiaResult} from './server/mafia-results.mjs';
      let clock=Date.UTC(2026,10,1,12);Date.now=()=>clock;
      export default {async fetch(request,env){try{
        clock=Number(request.headers.get('x-fixture-clock'));const path=new URL(request.url).pathname;
        if(path==='/fixture/result'){
          const event=await request.json();await persistMafiaResult(env,event);await persistMafiaProgress(env,event);return Response.json({ok:true});
        }
        const actual=env.DB,mode=request.headers.get('x-fixture-race');
        if(mode)env={...env,DB:{prepare:sql=>actual.prepare(sql),batch:async statements=>{
          if(mode==='failure')return actual.batch([statements[0],actual.prepare('INSERT INTO missing_community_fixture VALUES(1)'),...statements.slice(1)]);
          if(mode==='membership')await actual.prepare('UPDATE social_group_members SET left_at=? WHERE user_id=?').bind(clock,request.headers.get('x-fixture-target')).run();
          return actual.batch(statements);
        }}};
        return await routeMafiaCommunity(request,env);
      }catch(error){return Response.json({error:error.code||'D1_FAILURE'},{status:error.status||500});}}};
    `},bundle:true,platform:'browser',format:'esm',outfile:scriptPath,logLevel:'silent'});
    mf=new Miniflare(convertV4MiniflareOptions({rootPath:directory,name:'mafia-community-integration-fixture',modules:true,scriptPath,
      compatibilityDate:'2026-09-01',d1Databases:{DB:'community-integration-fixture'},bindings:{APP_ORIGIN:ORIGIN,MAFIA_ENABLED:'1',MAFIA_COMMUNITY_ENABLED:'1',MAFIA_PROGRESS_ENABLED:'1'},cf:false}));
    await mf.ready;const db=await mf.getD1Database('DB');await db.exec(migrationStatements().join('\n'));
    let clock=Date.UTC(2026,10,1,12);
    const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
    const first=(sql,...args)=>db.prepare(sql).bind(...args).first();
    async function api(user,endpoint,body,method=body===undefined?'GET':'POST',headers={}) {
      const response=await mf.dispatchFetch(ORIGIN+endpoint,{method,headers:{'x-fixture-clock':String(clock),...(user?{authorization:`Bearer ${user.token}`} :{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:response.status,body:await response.json()};
    }
    const ok=result=>{assert.equal(result.status,200,JSON.stringify(result));return result.body;};
    const users=[];
    for(let index=0;index<8;index++){
      const id=crypto.randomUUID();await run('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)',id,'مشارك اختبار',clock,clock);
      const session=await issueSession({DB:db},id,'web',clock);users.push({id,token:session.token});
    }
    const group=crypto.randomUUID();await run('INSERT INTO social_groups(id,name,owner_id,created_at,updated_at) VALUES(?,?,?,?,?)',group,'مجلس محلي',users[0].id,clock-300_000,clock-300_000);
    for(const [index,user] of users.entries())await run('INSERT INTO social_group_members(group_id,user_id,role,joined_at) VALUES(?,?,?,?)',group,user.id,index===0?'owner':'member',clock-300_000);
    const base='/api/mafia/community';ok(await api(users[0],`${base}/clubs/${group}`,{motto:'مجلس تجريبي',revision:0},'PUT'));
    assert.ok((await api(users[1],`${base}/clubs/${group}`,{motto:'لا يملك الصلاحية',revision:1},'PUT')).status>=400);
    const startsAt=clock+16*60_000,id=ok(await api(users[0],`${base}/clubs/${group}/tournaments`,{title:'بطولة محلية',startsAt,clientId:'workerd-creation'})).tournament.id;
    for(const user of users)ok(await api(user,`${base}/tournaments/${id}/registration`,{},'PUT'));
    ok(await api(users[0],`${base}/tournaments/${id}`,{revision:0,action:'lock'},'PATCH'));
    clock=startsAt+180_000;
    for(let round=0;round<3;round++){
      const finishedAt=clock-31_000,draw=round===1,results=users.map((user,index)=>({userId:user.id,playerId:`seat-${index}`,roleId:index<2?'mafia':'citizen',initialFaction:index<2?'mafia':'town',faction:index<2?'mafia':'town',won:!draw&&index>=2,forfeited:false,eliminatedAt:null}));
      const event={eventSchemaVersion:1,eventKind:'match_completed',source:'live',rewardPolicyVersion:1,key:`edge-community:${crypto.randomUUID()}`,eventId:`online:${crypto.randomUUID()}`,roomCode:'ABCDEF',rulesetVersion:1,
        startedAt:finishedAt-120_000,finishedAt,notBefore:finishedAt+30_000,visibility:'private',mode:'classic',capacity:8,participantCount:8,draw,results};
      event.summary=JSON.stringify({mode:'classic',startedAt:event.startedAt,settings:{capacity:8,visibility:'private',voiceMode:'off'},outcome:{faction:draw?'draw':'town'},reveal:{players:results,events:[]}});
      ok(await api(null,'/fixture/result',event));
      const endpoint=`${base}/tournaments/${id}/matches`,body={matchKey:event.key};
      assert.equal((await api(users[0],endpoint,{...body,points:999})).status,400);
      if(round===0){
        assert.equal((await api(users[0],endpoint,body,'POST',{'x-fixture-race':'failure'})).status,500);
        assert.equal((await first('SELECT COUNT(*) n FROM mafia_tournament_matches WHERE tournament_id=?',id)).n,0);
        assert.equal((await first('SELECT COUNT(*) n FROM mafia_tournament_points WHERE tournament_id=?',id)).n,0);
      }
      if(round===1){
        assert.equal((await api(users[0],endpoint,body,'POST',{'x-fixture-race':'membership','x-fixture-target':users[7].id})).status,409);
        assert.equal((await first('SELECT COUNT(*) n FROM mafia_tournament_matches WHERE tournament_id=?',id)).n,1);
        assert.equal((await first('SELECT COUNT(*) n FROM mafia_tournament_points WHERE tournament_id=?',id)).n,8);
        await run('UPDATE social_group_members SET left_at=NULL WHERE group_id=? AND user_id=?',group,users[7].id);
      }
      ok(await api(users[0],endpoint,body));ok(await api(users[0],endpoint,body));clock+=180_000;
    }
    const closed=ok(await api(users[0],`${base}/tournaments/${id}`,{revision:1,action:'close'},'PATCH'));
    assert.equal(closed.tournament.state,'closed');assert.equal(closed.members.filter(row=>row.points===7&&row.place===1).length,6);
    assert.equal(closed.members.filter(row=>row.points===1&&row.place===2).length,2);
    ok(await api(users[0],`${base}/tournaments/${id}`,{revision:1,action:'close'},'PATCH'));
    assert.equal((await first('SELECT COUNT(*) n FROM mafia_tournament_awards WHERE tournament_id=?',id)).n,8);
    assert.equal((await first('SELECT COUNT(*) n FROM mafia_tournament_points WHERE tournament_id=?',id)).n,24);
  } finally {
    if(mf)await mf.dispose();
    assert.ok(path.relative(temporaryRoot,directory)&&!path.relative(temporaryRoot,directory).startsWith('..')&&!path.isAbsolute(path.relative(temporaryRoot,directory)));
    await rm(directory,{recursive:true,force:true});
  }
});
