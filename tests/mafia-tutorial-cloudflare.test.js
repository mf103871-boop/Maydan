import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { migrationStatements } from '../server/local-d1.mjs';
import { MAFIA_TUTORIAL_SCENARIO_VERSION as scenarioVersion, MAFIA_TUTORIAL_RULESET_VERSION as rulesetVersion } from '../src/games/mafia/tutorial/version.mjs';

const ORIGIN='https://tutorial.test',ENDPOINT='/api/me/tutorials/mafia';
const statusBody=status=>({scenarioVersion,rulesetVersion,status});

test('workerd/D1: tutorial migration and authenticated terminal status preserve accounts, monotonicity and live SQL guards', {timeout:60000}, async t=>{
  const tempRoot=path.resolve(os.tmpdir()),dir=await mkdtemp(path.join(tempRoot,'maydan-tutorial-edge-'));let mf;
  try {
    const scriptPath=path.join(dir,'worker.mjs');
    // The fixture only mints ordinary opaque sessions and interposes a real D1
    // write immediately before the production SQL. No production route is patched.
    await build({stdin:{resolveDir:process.cwd(),sourcefile:'tutorial-edge-test-entry.mjs',contents:`
      import {routeRequest,Room,RequestLimiter} from './server/worker.mjs';
      import {createUser} from './server/accounts/db.mjs';
      import {issueSession} from './server/accounts/session.mjs';
      import {json,errorResponse} from './server/protocol.mjs';
      export {Room,RequestLimiter};
      export default {async fetch(request,env,ctx){try{
        const url=new URL(request.url);
        if(url.pathname==='/__fixture/user'&&request.method==='POST'){
          const user=await createUser(env,{name:'اختبار التدريب',email:crypto.randomUUID()+'@example.test'});
          const a=await issueSession(env,user.id),b=await issueSession(env,user.id);
          return json({id:user.id,token:a.token,sessionId:a.id,secondToken:b.token});
        }
        const race=request.headers.get('x-fixture-race'),userId=request.headers.get('x-fixture-user');let fired=false;
        if(race&&url.pathname==='${ENDPOINT}'){
          const actual=env.DB;
          async function inject(sql){
            const matches=race.endsWith('-write')?sql.startsWith('INSERT INTO mafia_tutorial_status'):sql.startsWith('SELECT account_user.id');
            if(fired||!matches)return;fired=true;
            if(race.startsWith('delete-'))await actual.prepare('INSERT INTO account_deletions(user_id,attempt_id,created_at) VALUES(?,?,?)').bind(userId,'edge-race',Date.now()).run();
            else if(race.startsWith('suspend-'))await actual.prepare('INSERT INTO moderation_suspensions VALUES(?,?,?,?,?)').bind(userId,'fixture-moderator','test',Date.now(),Date.now()).run();
            else throw new Error('Unsupported fixture race');
          }
          const wrapped=new Proxy(actual,{get(target,key){
            if(key==='prepare')return sql=>{
              const wrap=statement=>new Proxy(statement,{get(stmt,method){
                if(method==='bind')return(...args)=>wrap(stmt.bind(...args));
                if(['first','all','raw','run'].includes(method))return async(...args)=>{await inject(sql);return stmt[method](...args);};
                const value=Reflect.get(stmt,method);return typeof value==='function'?value.bind(stmt):value;
              }});return wrap(target.prepare(sql));
            };
            const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
          }});
          env={...env,DB:wrapped};
        }
        const response=await routeRequest(request,env,ctx),headers=new Headers(response.headers);
        if(race)headers.set('x-fixture-race-fired',String(fired));
        return new Response(response.body,{status:response.status,headers});
      }catch(error){return errorResponse(error);}}};
    `},bundle:true,format:'esm',platform:'browser',outfile:scriptPath,logLevel:'silent'});
    mf=new Miniflare(convertV4MiniflareOptions({rootPath:dir,name:'tutorial-edge-test',modules:true,scriptPath,compatibilityDate:'2026-09-01',d1Databases:{DB:'tutorial-edge-test'},durableObjects:{ROOMS:{className:'Room',useSQLite:true},LIMITERS:{className:'RequestLimiter',useSQLite:true}},bindings:{ALLOWED_ORIGINS:ORIGIN},cf:false}));
    await mf.ready;const db=await mf.getD1Database('DB');
    const statements=migrationStatements(),migration=statements.filter(sql=>sql.startsWith('CREATE TABLE IF NOT EXISTS mafia_tutorial_status'));
    assert.equal(migration.length,1);await db.exec(statements.filter(sql=>!migration.includes(sql)).join('\n'));
    let address=0;
    async function person(){const response=await mf.dispatchFetch(ORIGIN+'/__fixture/user',{method:'POST'});assert.equal(response.status,200);return {...await response.json(),ip:`192.0.2.${++address}`};}
    async function api(person,body,{method=body===undefined?'GET':'PUT',pathname=ENDPOINT,headers={},raw=false,type='application/json'}={}){
      const response=await mf.dispatchFetch(ORIGIN+pathname,{method,headers:{origin:ORIGIN,'cf-connecting-ip':person?.ip||'192.0.2.250',...(person?{authorization:`Bearer ${person.token}`} : {}),...(body===undefined?{}:{'content-type':type}),...headers},...(body===undefined?{}:{body:raw?body:JSON.stringify(body)})});
      return {status:response.status,body:response.status===204?null:await response.json(),headers:response.headers};
    }
    const row=person=>db.prepare('SELECT * FROM mafia_tutorial_status WHERE user_id=?').bind(person.id).first();
    const tables=async()=> (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(r=>r.name);
    const dump=async names=>Promise.all(names.map(async name=>{assert.match(name,/^[a-zA-Z0-9_]+$/);return [name,(await db.prepare('SELECT * FROM '+name).all()).results];}));
    const beforeMigrationUser=await person(),names=await tables(),before=await dump(names);
    await t.test('0018 adds only its constrained table and preserves every prior D1 table and live session',async()=>{
      await db.exec(migration.join('\n'));
      assert.deepEqual(await dump(names),before);
      assert.deepEqual((await db.prepare('PRAGMA table_info(mafia_tutorial_status)').all()).results.map(r=>r.name),['user_id','scenario_version','ruleset_version','status','updated_at']);
      assert.equal((await api(beforeMigrationUser)).body.status,'unseen');
      const definition=await db.prepare("SELECT sql FROM sqlite_master WHERE name='mafia_tutorial_status'").first();
      assert.match(definition.sql,/REFERENCES users\(id\) ON DELETE CASCADE/);
      await assert.rejects(db.prepare('INSERT INTO mafia_tutorial_status VALUES(?,?,?,?,?)').bind(beforeMigrationUser.id,scenarioVersion,rulesetVersion,'unseen',Date.now()).run(),/CHECK constraint/);
      assert.equal(await row(beforeMigrationUser),null);
    });
    await t.test('real sessions authorize only their own status and fresh requests see fresh D1 rows',async()=>{
      const a=await person(),b=await person();
      assert.equal((await api(null)).status,401);assert.equal((await api(null,statusBody('completed'))).status,401);
      assert.equal((await api(a,undefined,{headers:{origin:'https://wrong.test'}})).status,403);
      const initial=await api(a);assert.equal(initial.status,200);assert.equal(initial.headers.get('cache-control'),'no-store');
      assert.deepEqual(initial.body,{tutorialId:'mafia',scenarioVersion,rulesetVersion,status:'unseen',updatedAt:null,outdated:false});
      assert.equal(await row(a),null);
      const saved=await api(a,statusBody('completed'));assert.equal(saved.status,200);assert.equal(saved.body.status,'completed');
      assert.deepEqual(Object.keys(saved.body).sort(),['tutorialId','scenarioVersion','rulesetVersion','status','updatedAt','outdated'].sort());
      assert.equal((await api(b,undefined,{pathname:ENDPOINT+'?userId='+a.id})).body.status,'unseen');
      await db.prepare('INSERT INTO mafia_tutorial_status VALUES(?,?,?,?,?)').bind(b.id,scenarioVersion,rulesetVersion,'skipped',1234).run();
      assert.equal((await api(b)).body.updatedAt,1234);
      await db.prepare("UPDATE mafia_tutorial_status SET status='completed',updated_at=2345 WHERE user_id=?").bind(b.id).run();
      assert.equal((await api(b)).body.updatedAt,2345,'subsequent reads do not reuse status from another request');
      assert.equal((await row(a)).updated_at,saved.body.updatedAt);
    });
    await t.test('concurrent devices preserve completion and idempotent retries preserve the exact timestamp',async()=>{
      const a=await person(),device2={...a,token:a.secondToken};
      assert.equal((await api(a,statusBody('skipped'))).body.status,'skipped');const skipped=await row(a);
      assert.equal((await api(device2,statusBody('skipped'))).body.updatedAt,skipped.updated_at);
      const replies=await Promise.all([api(a,statusBody('completed')),api(device2,statusBody('skipped')),api(device2,statusBody('completed')),api(a,statusBody('skipped'))]);
      assert.ok(replies.every(reply=>reply.status===200));const completed=await row(a);assert.equal(completed.status,'completed');
      for(const status of ['skipped','completed'])assert.equal((await api(device2,statusBody(status))).body.status,'completed');
      assert.deepEqual(await row(a),completed);
    });
    await t.test('the edge body parser rejects raw state, foreign owners, malformed data, size and version mismatches without writing',async()=>{
      const a=await person();
      for(const extra of ['userId','roles','progress','decisions','checkpoint','updatedAt','reward'])assert.equal((await api(a,{...statusBody('completed'),[extra]:'forged'})).status,400);
      for(const body of [null,[],{},statusBody('unseen'),{...statusBody('completed'),scenarioVersion:'1'},{...statusBody('completed'),rulesetVersion:1.5}])assert.equal((await api(a,body)).status,400);
      assert.equal((await api(a,{...statusBody('completed'),scenarioVersion:scenarioVersion+1})).status,409);
      assert.equal((await api(a,'{bad',{raw:true})).status,400);
      assert.equal((await api(a,' '.repeat(513),{raw:true})).status,413);
      assert.equal((await api(a,statusBody('completed'),{type:'text/plain'})).status,415);
      const method=await api(a,statusBody('completed'),{method:'POST'});assert.equal(method.status,405);assert.equal(method.headers.get('allow'),'GET, PUT');
      assert.equal(await row(a),null);
    });
    await t.test('newer stored completion survives a rolled-back server and does not impersonate current completion',async()=>{
      const a=await person();await db.prepare('INSERT INTO mafia_tutorial_status VALUES(?,?,?,?,?)').bind(a.id,scenarioVersion+1,rulesetVersion,'completed',999).run();
      const original=await row(a),read=await api(a);assert.equal(read.body.outdated,true);assert.equal(read.body.status,'unseen');assert.equal(read.body.updatedAt,null);
      assert.equal((await api(a,statusBody('skipped'))).status,409);assert.deepEqual(await row(a),original);
    });
    await t.test('actual account deletion removes its status, retains another account and refuses resurrection by a retired session',async()=>{
      const a=await person(),b=await person();await api(a,statusBody('completed'));await api(b,statusBody('skipped'));const other=await row(b);
      const deletion=await api(a,undefined,{method:'DELETE',pathname:'/api/account'});assert.equal(deletion.status,204);
      assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind(a.id).first(),null);assert.equal(await row(a),null);assert.deepEqual(await row(b),other);
      assert.equal((await api(a,statusBody('completed'))).status,401);assert.equal(await row(a),null);
    });
    await t.test('deletion reservations and revoked sessions are checked afresh before every request',async()=>{
      const a=await person(),b=await person();await api(a,statusBody('skipped'));const original=await row(a);
      await db.prepare('INSERT INTO account_deletions VALUES(?,?,?)').bind(a.id,'edge-existing',Date.now()).run();
      assert.equal((await api(a)).status,409);assert.equal((await api(a,statusBody('completed'))).status,409);assert.deepEqual(await row(a),original);
      assert.equal((await api(b)).status,200);await db.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now()-1000,b.sessionId).run();
      assert.equal((await api(b)).status,401);assert.equal((await api(b,statusBody('completed'))).status,401);assert.equal(await row(b),null);
    });
    for(const race of ['delete-write','suspend-write'])for(const existing of [false,true])await t.test(`${race}: real D1 rechecks after authentication before ${existing?'update':'insert'}`,async()=>{
      const a=await person();if(existing)await api(a,statusBody('skipped'));const original=await row(a);
      const response=await api(a,statusBody('completed'),{headers:{'x-fixture-race':race,'x-fixture-user':a.id}});
      assert.equal(response.headers.get('x-fixture-race-fired'),'true');assert.equal(response.status,409);assert.equal(response.body.error,'ACCOUNT_UNAVAILABLE');assert.deepEqual(await row(a),original);
    });
    for(const race of ['delete-read','suspend-read'])await t.test(`${race}: the status SELECT rejects a newly ineligible actor even when another account is eligible`,async()=>{
      const a=await person(),b=await person();await api(a,statusBody('completed'));await api(b,statusBody('skipped'));const other=await row(b);
      const response=await api(a,undefined,{headers:{'x-fixture-race':race,'x-fixture-user':a.id}});
      assert.equal(response.headers.get('x-fixture-race-fired'),'true');assert.equal(response.status,409);assert.equal(response.body.error,'ACCOUNT_UNAVAILABLE');assert.deepEqual(await row(b),other);
    });
    await t.test('status-only synchronization changes no game, reward, subscription, media or profile table',async()=>{
      const a=await person(),protectedNames=(await tables()).filter(name=>name!=='mafia_tutorial_status'),beforeStatus=await dump(protectedNames);
      assert.equal((await api(a,statusBody('completed'))).status,200);assert.equal((await api(a)).body.status,'completed');assert.deepEqual(await dump(protectedNames),beforeStatus);
    });
  } finally {
    if(mf)await mf.dispose();assert.equal(path.dirname(path.resolve(dir)),tempRoot);assert.match(path.basename(dir),/^maydan-tutorial-edge-/);await rm(dir,{recursive:true,force:true});
  }
});
