// Real outer Worker, authentication, legal module and local SQLite/D1 adapter.
// The room/limiter bindings are transport spies: these assertions cover admission
// boundaries and forwarded identity, not an actual live WebSocket or match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeRequest } from '../server/worker.mjs';
import { termsIdentity } from '../src/shared/legal/terms.js';
import { MAFIA_PROTOCOL } from '../src/online/shared.js';

const origin='https://maydan-mafia-preview.mf103871.workers.dev';
const credentials={id:'a'.repeat(32),token:'b'.repeat(64)};
const hint={game:'beep',mode:'local',screen:'game-playing'};
const admissions=[['/api/rooms',{...credentials,game:'meenfina',name:'Fixture'}],['/api/rooms/123456/join',credentials],
  ['/api/matchmaking/join',{...credentials,game:'mafia',capabilities:{mafia:MAFIA_PROTOCOL}}],['/api/mafia/ranked/queue/join',credentials],['/api/creator/presence',hint],
  ['/api/rooms/123456/observe',credentials],['/api/rooms/123456/observe/promote',credentials]];
async function fixture(t,flag='1'){
  const DB=createLocalD1();t.after(()=>DB.close());const forwarded=[],charged=[];
  const env={DB,SESSION_SECRET:'terms-worker-fixture-only',APP_ORIGIN:origin,ALLOWED_ORIGINS:origin,TERMS_ENFORCEMENT_ENABLED:flag,
    MAFIA_ENABLED:'1',MAFIA_RANKED_ENABLED:'1',
    LIMITERS:{idFromName:id=>id,get:id=>({async fetch(request){charged.push({id,...await request.json()});return Response.json({ok:true});}})},
    ROOMS:{idFromName:id=>id,get:id=>({async fetch(request){const entry={id,url:request.url,method:request.method,body:request.method==='POST'?await request.json():null};forwarded.push(entry);return Response.json({fixtureRoom:true});}})}};
  const user=await createUser(env,{name:'Terms owner',email:'fixture-owner@example.test'}),session=await issueSession(env,user.id);
  const call=async(path,{body,token=session.token,method=body===undefined?'GET':'POST',headers={}}={})=>{
    const response=await routeRequest(new Request(origin+path,{method,headers:{origin,...(token?{authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
    return{status:response.status,headers:response.headers,data:response.status===204?null:await response.json()};
  };
  const accept=async(token=session.token,locale='en')=>call('/api/legal/accept',{token,body:{...termsIdentity(locale),accepted:true}});
  return{DB,env,user,session,call,accept,forwarded,charged};
}

test('enabled Worker rejects all new-use boundaries before room allocation, queue forwarding or presence writes',async t=>{
  const f=await fixture(t);
  for(const token of [f.session.token,null])for(const[path,body]of admissions){
    const response=await f.call(path,{token,body});assert.equal(response.status,403,path);assert.equal(response.data.error,'TERMS_REQUIRED',path);
  }
  assert.equal(f.forwarded.length,0);assert.equal(f.charged.length,0);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM creator_presence').first()).n,0);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM legal_terms_acceptances').first()).n,0);
});

test('real explicit account acceptance opens intended admissions while preserving authenticated identity and game policy',async t=>{
  const f=await fixture(t),accepted=await f.accept();assert.equal(accepted.status,200);assert.equal(accepted.data.required,false);
  assert.equal(accepted.headers.get('cache-control'),'no-store');
  for(const[path,body]of admissions){
    const response=await f.call(path,{body:{...body,...(path==='/api/rooms'?{accountUserId:'spoofed'}:{})}});
    if(path==='/api/matchmaking/join'){assert.equal(response.status,409);assert.equal(response.data.error,'MAFIA_NO_ROOMS');}
    else assert.equal(response.status,200,path+': '+JSON.stringify(response.data));
  }
  const create=f.forwarded.find(entry=>new URL(entry.url).pathname==='/create');assert.equal(create.body.accountUserId,f.user.id);
  const join=f.forwarded.find(entry=>new URL(entry.url).pathname==='/123456/join');assert.equal(join.body.accountUserId,f.user.id);
  const ranked=f.forwarded.find(entry=>entry.id==='mafia-ranked-preview-v1');assert.equal(ranked.body.operation,'join');assert.equal(ranked.body.actor.userId,f.user.id);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM creator_presence').first()).n,1);
});

test('a guest receipt admits legacy guest rooms but never substitutes for account terms or authenticated Mafia',async t=>{
  const f=await fixture(t),accepted=await f.accept(null,'ar');assert.equal(accepted.status,200);assert.ok(accepted.data.guestReceipt);
  const headers={'x-maydan-terms':accepted.data.guestReceipt};
  for(const[path,body]of admissions.slice(0,2)){assert.equal((await f.call(path,{token:null,body,headers})).status,200);}
  assert.equal(f.forwarded[0].body.accountUserId,null);assert.equal(f.forwarded[1].body.accountUserId,null);
  const signed=await f.call('/api/creator/presence',{body:hint,headers});assert.equal(signed.status,403);assert.equal(signed.data.error,'TERMS_REQUIRED');
  const mafia=await f.call('/api/matchmaking/join',{token:null,body:admissions[2][1],headers});assert.equal(mafia.status,401);assert.equal(mafia.data.error,'AUTH_REQUIRED');
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM legal_terms_acceptances').first()).n,0);
});

test('origin and receipt cryptographic checks remain enforced in the outer Worker',async t=>{
  const f=await fixture(t),accepted=await f.accept(null),receipt=accepted.data.guestReceipt;
  const foreign=await f.call('/api/legal/accept',{token:null,body:{...termsIdentity('ar'),accepted:true},headers:{origin:'https://other.example.test'}});
  assert.equal(foreign.status,403);assert.equal(foreign.data.error,'ORIGIN');
  const tampered=await f.call('/api/rooms',{token:null,body:admissions[0][1],headers:{'x-maydan-terms':receipt.slice(0,-1)+(receipt.endsWith('0')?'1':'0')}});
  assert.equal(tampered.status,403);assert.equal(tampered.data.error,'TERMS_REQUIRED');assert.equal(f.forwarded.length,0);
  const preflight=await f.call('/api/rooms',{token:null,method:'OPTIONS'});assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-headers'),/X-Maydan-Terms/);
});

test('existing room transport, leave and ranked cancel/status stay outside the new-admission terms gate',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('/api/rooms/123456/socket')).status,200);
  assert.equal((await f.call('/api/rooms/123456/leave',{body:credentials})).status,200);
  assert.equal((await f.call('/api/rooms/123456/observe/leave',{body:credentials})).status,200);
  for(const operation of ['status','cancel'])assert.equal((await f.call('/api/mafia/ranked/queue/'+operation,{body:credentials})).status,200);
  assert.equal(f.forwarded.length,5);assert.equal(f.forwarded[0].method,'GET');
  assert.match(f.forwarded[2].url,/mafia-observe-leave/);
  assert.deepEqual(f.forwarded.slice(3).map(entry=>entry.body.operation),['status','cancel']);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM legal_terms_acceptances').first()).n,0);
});

test('account management, reporting, blocking and deletion remain usable without agreement',async t=>{
  const f=await fixture(t),other=await createUser(f.env,{name:'Safety target',email:'fixture-target@example.test'});
  const me=await f.call('/api/me');assert.equal(me.status,200);assert.equal(me.data.legal.required,true);
  assert.equal((await f.call('/api/moderation/me')).status,200);
  assert.equal((await f.call('/api/social/blocks',{body:{userId:other.id}})).status,200);
  assert.equal((await f.call('/api/social/reports',{body:{userId:other.id,reason:'Fixture safety report'}})).status,200);
  assert.equal((await f.call('/api/account',{method:'DELETE'})).status,204);
  assert.equal(await f.DB.prepare('SELECT id FROM users WHERE id=?').bind(f.user.id).first(),null);
});

test('disabled legacy rollout preserves admission but still requires explicit terms for new analytics collection',async t=>{
  const f=await fixture(t,'0');
  for(const[path,body]of admissions){const result=await f.call(path,{body});
    if(path==='/api/matchmaking/join')assert.equal(result.data.error,'MAFIA_NO_ROOMS');
    else if(path==='/api/creator/presence'){assert.equal(result.status,403);assert.equal(result.data.error,'TERMS_REQUIRED');}
    else assert.equal(result.status,200,path);
  }
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM legal_terms_acceptances').first()).n,0);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM creator_presence').first()).n,0);
  await f.accept();assert.equal((await f.call('/api/creator/presence',{body:hint})).status,200);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM creator_presence').first()).n,1);
});
