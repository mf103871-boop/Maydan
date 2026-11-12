import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {migrationStatements} from '../server/local-d1.mjs';
import {issueSession} from '../server/accounts/session.mjs';

test('workerd and D1 enforce creator auth, atomic duplicate suppression and private aggregate projection', {timeout:60_000}, async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'maydan-creator-'));
  let worker;
  t.after(async()=>{if(worker)await worker.dispose();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true});});
  const scriptPath=path.join(directory,'worker.mjs');
  await build({stdin:{resolveDir:process.cwd(),sourcefile:'creator-runtime-fixture.mjs',contents:`
    import {routeCreator} from './server/creator/router.mjs';
    import {errorResponse,json} from './server/protocol.mjs';
    export default {async fetch(request,env){
      let writes=0,reads=0,batches=0;
      const DB={prepare(sql){const statement=env.DB.prepare(sql);
        if(request.headers.get('x-fixture-revoke-after-read')==='1'&&sql==='SELECT last_seen_at FROM creator_presence WHERE user_id=?')return{bind(...args){const bound=statement.bind(...args);return{async first(){
          await new Promise(resolve=>setTimeout(resolve,12));
          await env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=?').bind(Date.now(),args[0]).run();return bound.first();
        }};}};return statement;},async batch(statements){const results=await env.DB.batch(statements);batches++;for(const result of results){writes+=result.meta.rows_written;reads+=result.meta.rows_read;}return results;}};
      let response;try{response=await routeCreator(request,{...env,DB})||json({error:'NOT_FOUND'},404);}catch(error){response=errorResponse(error);}
      const headers=new Headers(response.headers);headers.set('x-fixture-batch-writes',String(writes));headers.set('x-fixture-batch-reads',String(reads));headers.set('x-fixture-batches',String(batches));
      return new Response(response.body,{status:response.status,headers});
    }};`},bundle:true,format:'esm',platform:'browser',outfile:scriptPath,logLevel:'silent'});
  worker=new Miniflare(convertV4MiniflareOptions({rootPath:directory,name:'creator-runtime',modules:true,scriptPath,compatibilityDate:'2026-09-01',d1Databases:{DB:'creator-tests'},bindings:{APP_ORIGIN:'https://maydan-game.mf103871.workers.dev'},cf:false,port:0,host:'127.0.0.1'}));
  const server=(await worker.ready).origin,DB=await worker.getD1Database('DB'),now=Date.now();
  for(const sql of migrationStatements())await DB.prepare(sql).run();
  for(const id of ['creator','ordinary'])await DB.prepare('INSERT INTO users(id,name,email,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,'private-'+id,'same-private@example.test',now,now).run();
  const tokens={};for(const id of ['creator','ordinary'])tokens[id]=(await issueSession({DB},id,'web',now)).token;
  await DB.prepare('INSERT INTO creator_access(user_id,enabled,created_at,updated_at) VALUES(?,1,?,?)').bind('creator',now,now).run();
  async function request(endpoint,token,body,headers={}){const response=await fetch(server+endpoint,{method:body?'POST':'GET',headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});return {response,data:await response.json()};}
  assert.equal((await request('/api/creator/analytics')).response.status,401);
  assert.equal((await request('/api/creator/analytics',tokens.ordinary)).response.status,403);
  const hint={game:'beep',mode:'local',screen:'game-playing'};
  assert.equal((await request('/api/creator/presence',tokens.ordinary,{...hint,userId:'creator',chat:'not accepted'})).response.status,400);
  const duplicate=await Promise.all([request('/api/creator/presence',tokens.ordinary,hint),request('/api/creator/presence',tokens.ordinary,hint)]);
  assert.ok(duplicate.every(item=>item.response.status===200));
  assert.equal(duplicate.filter(item=>item.data.accepted).length,1);
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM creator_presence').first('n'),1);
  assert.equal(await DB.prepare('SELECT unique_players FROM creator_daily').first('unique_players'),1);
  assert.equal(await DB.prepare('SELECT unique_players FROM creator_hourly').first('unique_players'),1);
  const repeat=await request('/api/creator/presence',tokens.ordinary,hint);
  assert.equal(repeat.data.accepted,false);assert.equal(repeat.response.headers.get('x-fixture-batch-writes'),'0');assert.equal(repeat.response.headers.get('x-fixture-batches'),'0');
  // Advance only this fixture's last heartbeat; it is now eligible within the
  // same hour/sample window. Aggregates and deduplication must not be rewritten.
  await DB.prepare('UPDATE creator_presence SET last_seen_at=? WHERE user_id=?').bind(Date.now()-31_000,'ordinary').run();
  const steady=await request('/api/creator/presence',tokens.ordinary,hint);
  assert.equal(steady.data.accepted,true);
  assert.ok(Number(steady.response.headers.get('x-fixture-batch-writes'))<=3,'steady heartbeat only writes the presence row and its seen index');
  await request('/api/creator/presence',tokens.creator,{game:null,mode:'none',screen:'creator'});
  const report=await request('/api/creator/analytics',tokens.creator);
  assert.equal(report.response.status,200);assert.equal(report.data.environment.id,'production');
  assert.equal(report.data.summary.onlinePlayers,2);assert.equal(report.data.summary.todayPlayers,2);
  assert.deepEqual(report.data.byGame,[{game:'beep',mode:'local',count:1,membershipVerified:0}]);
  assert.equal(report.data.summary.registeredAccountsTotal,2);
  assert.doesNotMatch(JSON.stringify(report.data),/private-|same-private@example|userId|sessionId|secret_hash|room_code|chat/);
  await DB.prepare('UPDATE creator_access SET enabled=0 WHERE user_id=?').bind('creator').run();
  assert.equal((await request('/api/creator/analytics',tokens.creator)).response.status,403);
  const beforeRace=Date.now()-31_000;
  await DB.prepare('UPDATE creator_presence SET last_seen_at=? WHERE user_id=?').bind(beforeRace,'ordinary').run();
  const raced=await request('/api/creator/presence',tokens.ordinary,hint,{'x-fixture-revoke-after-read':'1'});
  assert.equal(raced.response.status,401);assert.equal(raced.data.error,'AUTH_EXPIRED');
  assert.equal(await DB.prepare('SELECT last_seen_at FROM creator_presence WHERE user_id=?').bind('ordinary').first('last_seen_at'),beforeRace,'D1 clock prevents extending a heartbeat after revocation during the request');
  assert.equal((await request('/api/creator/presence',tokens.ordinary,hint)).response.status,401);
  const admitted=duplicate.find(item=>item.data.accepted);
  t.diagnostic(JSON.stringify({engine:'workerd',database:'D1',firstPulseBatchWrites:Number(admitted.response.headers.get('x-fixture-batch-writes')),firstPulseBatchReads:Number(admitted.response.headers.get('x-fixture-batch-reads')),steadyPulseBatchWrites:Number(steady.response.headers.get('x-fixture-batch-writes')),throttledPulseBatchWrites:0,authenticatedUniqueUsers:2,privateFieldsReturned:false,remoteServices:false}));
});
