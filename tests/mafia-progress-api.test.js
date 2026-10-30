import test from 'node:test';
import assert from 'node:assert/strict';
import { localEnvironment } from '../server/local.mjs';
import { routeRequest } from '../server/worker.mjs';
import { createUser, reserveAccountDeletion, deleteUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { persistMafiaProgress } from '../server/mafia-progression.mjs';
import { MAFIA_ROLES } from '../src/online/mafia-shared.js';

async function setup(t) {
  const runtime=localEnvironment({vars:{MAFIA_ENABLED:'1',MAFIA_PROGRESS_ENABLED:'1'}}),env=runtime.env;t.after(()=>runtime.dispose());
  async function person(){const user=await createUser(env,{name:'Synthetic Mafia profile'}),session=await issueSession(env,user.id);return {...user,token:session.token};}
  async function api(user,path,body,method=body===undefined?'GET':'PATCH') {
    const response=await routeRequest(new Request('http://localhost:3000'+path,{method,headers:{origin:'http://localhost:3000',...(user?{authorization:`Bearer ${user.token}`} : {}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
    return {status:response.status,body:await response.json(),headers:response.headers};
  }
  async function award(user,{roleId='citizen',key=`mafia:${crypto.randomUUID()}`,won=false,finishedAt=Date.now()-60_000}={}) {
    const role=MAFIA_ROLES[roleId],event={eventSchemaVersion:1,eventKind:'match_completed',source:'live',rewardPolicyVersion:1,key,eventId:`online:${crypto.randomUUID()}`,
      rulesetVersion:1,startedAt:finishedAt-180_000,finishedAt,notBefore:finishedAt+30_000,mode:'classic',visibility:'public',capacity:8,participantCount:6,draw:false,
      results:[{userId:user.id,playerId:'synthetic-seat',roleId,initialFaction:role.faction,faction:role.faction,won,forfeited:false,eliminatedAt:null}]};
    await persistMafiaProgress(env,event);return event;
  }
  async function lock(user,kind) {
    const now=Date.now();
    if(kind==='media')await env.DB.prepare('INSERT INTO mafia_media_leases(user_id,room_key,call_id,expires_at,updated_at) VALUES(?,?,?,?,?)').bind(user.id,'test-room','test-call',now+120_000,now).run();
    else if(kind==='match')await env.DB.prepare('INSERT INTO mafia_match_leases(user_id,room_key,match_id,expires_at,updated_at) VALUES(?,?,?,?,?)').bind(user.id,'test-room','1',now+120_000,now).run();
    else await env.DB.prepare('INSERT INTO mafia_observer_memberships(user_id,room_key,room_code,observer_id,joined_at,expires_at) VALUES(?,?,?,?,?,?)').bind(user.id,'test-room','123456','test-observer',now,now+120_000).run();
  }
  return {env,person,api,award,lock};
}
const owner='/api/me/mafia/progress',preferences='/api/me/mafia/preferences';

test('public catalog is anonymous, complete and public-only; authenticated reads are default private and read-only',async t=>{
  const h=await setup(t),a=await h.person();
  const catalog=await h.api(null,'/api/mafia/catalog');assert.equal(catalog.status,200);assert.equal(catalog.body.roles.length,12);
  assert.equal(catalog.body.catalogVersion,1);assert.deepEqual(catalog.body.progression.masteryThresholds,[1,5,15,40,100]);
  for(const role of catalog.body.roles)assert.equal(role.guide.example,MAFIA_ROLES[role.id].guide.example);
  assert.doesNotMatch(JSON.stringify(catalog.body),/userId|tokenHash|nightAction|teamVotes/);
  assert.equal((await h.api(null,owner)).status,401);
  const response=await h.api(a,owner);assert.equal(response.status,200);assert.equal(response.body.available,true);
  assert.equal(response.body.revision,0);assert.deepEqual(response.body.preferences,{visibility:'private',representativeRoleId:null});
  assert.deepEqual(response.body.progress,{totalXp:0,level:1,xpInLevel:0,xpPerLevel:250,rewardedMatches:0,legacyMatches:0});
  assert.equal(response.body.roles.length,12);assert.ok(response.body.roles.every(role=>!role.representativeUnlocked));
  assert.deepEqual(response.body.achievements,[]);assert.deepEqual(response.body.grants,[]);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM mafia_profile_preferences').first()).n,0);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM mafia_progress_events').first()).n,0);
  assert.equal(response.headers.get('cache-control'),'no-store');
  delete h.env.MAFIA_PROGRESS_ENABLED;assert.deepEqual((await h.api(a,owner)).body,{available:false});
});

test('only server-qualified roles unlock a stable representative; optimistic revision and exact keys protect writes',async t=>{
  const h=await setup(t),a=await h.person();
  for(const bad of [{revision:0,totalXp:9},{revision:0,userId:a.id,visibility:'public'},{visibility:'public'},{revision:-1,visibility:'public'},{revision:0,visibility:'everyone'},{revision:0,representativeRoleId:'__proto__'}])assert.equal((await h.api(a,preferences,bad)).status,400);
  assert.equal((await h.api(a,preferences,{revision:0,representativeRoleId:'citizen'})).body.error,'MAFIA_ROLE_LOCKED');
  await h.award(a,{roleId:'doctor'});
  const state=(await h.api(a,owner)).body,doctor=state.roles.find(role=>role.roleId==='doctor');
  assert.equal(doctor.qualifiedMatches,1);assert.equal(doctor.mastery,1);assert.equal(doctor.representativeUnlocked,true);
  const saved=await h.api(a,preferences,{revision:0,visibility:'public',representativeRoleId:'doctor'});
  assert.equal(saved.status,200);assert.equal(saved.body.revision,1);assert.equal(saved.body.preferences.representativeRoleId,'doctor');
  assert.equal((await h.api(a,preferences,{revision:0,visibility:'private'})).body.error,'CONFLICT');
  const concurrent=await Promise.all([h.api(a,preferences,{revision:1,visibility:'friends'}),h.api(a,preferences,{revision:1,visibility:'private'})]);
  assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,409]);
  assert.equal((await h.api(a,owner)).body.revision,2);
  assert.equal((await h.api(a,owner)).body.preferences.representativeRoleId,'doctor','representative is a saved historical choice, never inferred from a live role');
});

test('public progress obeys private/friends/public, bilateral blocks and live-account privacy without grants',async t=>{
  const h=await setup(t),a=await h.person(),b=await h.person(),c=await h.person();await h.award(a);
  const path=`/api/profiles/${a.id}/mafia`;
  assert.deepEqual((await h.api(b,path)).body,{available:false});
  await h.api(a,preferences,{revision:0,visibility:'friends'});
  assert.deepEqual((await h.api(b,path)).body,{available:false});
  const [low,high]=[a.id,b.id].sort();
  await h.env.DB.prepare("INSERT INTO social_friendships(id,user_low,user_high,requester_id,status,created_at) VALUES(?,?,?,?,?,?)").bind('fixture-friend',low,high,b.id,'accepted',Date.now()).run();
  const visible=await h.api(b,path);assert.equal(visible.body.available,true);assert.equal(visible.body.progress.totalXp,50);
  assert.ok(visible.body.achievements.length>=1);assert.equal('grants' in visible.body,false);assert.equal('revision' in visible.body,false);
  assert.deepEqual((await h.api(c,path)).body,{available:false});
  await h.api(a,preferences,{revision:1,visibility:'public'});assert.equal((await h.api(c,path)).body.available,true);
  for(const [blocker,blocked]of[[a,b],[b,a]]) {
    await h.env.DB.prepare('INSERT INTO social_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)').bind(blocker.id,blocked.id,Date.now()).run();
    assert.deepEqual((await h.api(b,path)).body,{available:false});
    await h.env.DB.prepare('DELETE FROM social_blocks').run();
  }
  await reserveAccountDeletion(h.env,a.id,'delete-profile');assert.deepEqual((await h.api(b,path)).body,{available:false});
});

for(const kind of ['media','match','observer'])test(`${kind} leases suppress viewer/target progress and fence preference writes`,async t=>{
  const h=await setup(t),a=await h.person(),b=await h.person();await h.award(a);await h.api(a,preferences,{revision:0,visibility:'public'});
  await h.lock(b,kind);assert.deepEqual((await h.api(b,`/api/profiles/${a.id}/mafia`)).body,{available:false});
  assert.deepEqual((await h.api(b,owner)).body,{available:false,preferencesLocked:true});
  assert.equal((await h.api(b,'/api/mafia/history')).status,kind==='observer'?409:200,'history keeps its observer-only lock contract');
  assert.equal((await h.api(b,preferences,{revision:0,visibility:'public'})).body.error,'MAFIA_SOCIAL_LOCKED');
  await h.lock(a,kind);assert.deepEqual((await h.api(a,owner)).body,{available:false,preferencesLocked:true});
});

test('a lobby/over seat does not hide earned progress after leases release',async t=>{
  const h=await setup(t),a=await h.person();await h.award(a);
  await h.env.DB.prepare('INSERT INTO mafia_seats(user_id,room_key,room_code,seat_id,expires_at,updated_at) VALUES(?,?,?,?,?,?)').bind(a.id,'test-room','123456','owned-seat',Date.now()+120_000,Date.now()).run();
  assert.equal((await h.api(a,owner)).body.available,true);
  assert.equal((await h.api(a,preferences,{revision:0,visibility:'public'})).status,200);
});

for(const existing of [false,true])test(`a match lease acquired between preference precheck and SQL prevents ${existing?'update':'insert'} and revision changes`,async t=>{
  const h=await setup(t),a=await h.person(),prepare=h.env.DB.prepare.bind(h.env.DB);let raced=false;
  if(existing)assert.equal((await h.api(a,preferences,{revision:0,visibility:'friends'})).status,200);
  t.mock.method(h.env.DB,'prepare',sql=>{
    const statement=prepare(sql);if(!sql.startsWith('INSERT INTO mafia_profile_preferences'))return statement;
    return {bind(...args){const bound=statement.bind(...args);return {run:async()=>{if(!raced){raced=true;await h.lock(a,'match');}return bound.run();}};}};
  });
  const result=await h.api(a,preferences,{revision:existing?1:0,visibility:'public'});
  assert.equal(raced,true);assert.equal(result.status,409);assert.equal(result.body.error,'MAFIA_SOCIAL_LOCKED');
  const saved=await prepare('SELECT visibility,revision FROM mafia_profile_preferences WHERE user_id=?').bind(a.id).first();
  assert.deepEqual(saved,existing?{visibility:'friends',revision:1}:null);
});

test('a public-profile read is suppressed if a match starts after its first authorization snapshot',async t=>{
  const h=await setup(t),a=await h.person(),b=await h.person();await h.award(a);await h.api(a,preferences,{revision:0,visibility:'public'});
  const prepare=h.env.DB.prepare.bind(h.env.DB);let raced=false;
  t.mock.method(h.env.DB,'prepare',sql=>{
    const statement=prepare(sql);if(!sql.includes('FROM users target JOIN users viewer'))return statement;
    return {bind(...args){const bound=statement.bind(...args);return {first:async()=>{const row=await bound.first();if(!raced){raced=true;await h.lock(a,'match');}return row;}};}};
  });
  assert.deepEqual((await h.api(b,`/api/profiles/${a.id}/mafia`)).body,{available:false});assert.equal(raced,true);
});

test('owner reward receipts are uniformly pending for missing/other/early data and reveal only processed facts after 30 seconds',async t=>{
  const h=await setup(t),a=await h.person(),b=await h.person(),event=await h.award(a,{won:true});
  const path='/api/me/mafia/rewards/'+encodeURIComponent(event.key);
  assert.equal((await h.api(null,path)).status,401);assert.deepEqual((await h.api(b,path)).body,{status:'pending'});
  assert.deepEqual((await h.api(a,'/api/me/mafia/rewards/missing-match')).body,{status:'pending'});
  // Even a receipt populated early by an operator/fixture cannot bypass the read gate.
  await h.env.DB.prepare('UPDATE mafia_progress_events SET finished_at=? WHERE user_id=?').bind(Date.now(),a.id).run();
  const boundary=Date.now();t.mock.method(Date,'now',()=>boundary+29_000);
  assert.deepEqual((await h.api(a,path)).body,{status:'pending'});
  t.mock.method(Date,'now',()=>boundary+30_001);
  const done=await h.api(a,path);assert.equal(done.body.status,'processed');assert.equal(done.body.xpAwarded,70);assert.equal(done.body.roleId,'citizen');
  assert.equal(done.body.participationGranted,true);assert.ok(done.body.achievements.length>=1);assert.ok(done.body.grants.length>=1);
  assert.doesNotMatch(JSON.stringify(done.body),/userId|event_digest|claim_token|room_key|tokenHash/);
  assert.equal(done.headers.get('cache-control'),'no-store');
  await h.lock(a,'observer');assert.deepEqual((await h.api(a,path)).body,{status:'pending'});
});

test('deletion after a receipt SELECT cannot return cached reward facts after the award lookup',async t=>{
  const h=await setup(t),a=await h.person(),event=await h.award(a,{won:true}),prepare=h.env.DB.prepare.bind(h.env.DB);let removed=false;
  t.mock.method(h.env.DB,'prepare',sql=>{
    const statement=prepare(sql);if(!sql.includes('SELECT match_key AS matchKey,xp_awarded'))return statement;
    return {bind(...args){const bound=statement.bind(...args);return {first:async()=>{const row=await bound.first();if(!removed){removed=true;await deleteUser(h.env,a.id);}return row;}};}};
  });
  const response=await h.api(a,'/api/me/mafia/rewards/'+encodeURIComponent(event.key));
  assert.equal(removed,true);assert.equal(response.status,200);assert.deepEqual(response.body,{status:'pending'});
  assert.equal(await prepare('SELECT id FROM users WHERE id=?').bind(a.id).first(),null);
  assert.equal((await prepare('SELECT COUNT(*) n FROM mafia_progress_events WHERE user_id=?').bind(a.id).first()).n,0);
});

test('history pagination is stable across equal timestamps and concurrent new matches, while retaining the original result fields',async t=>{
  const h=await setup(t),a=await h.person(),b=await h.person(),finish=Date.now()-60_000;
  for(let n=0;n<55;n++)await h.env.DB.prepare('INSERT INTO mafia_results(user_id,match_key,role_id,initial_faction,faction,won,draw,forfeited,finished_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(a.id,`page:${String(n).padStart(3,'0')}`,'citizen','town','town',0,0,0,finish).run();
  const first=await h.api(a,'/api/mafia/history');assert.equal(first.body.matches.length,50);assert.ok(first.body.nextCursor);
  assert.deepEqual(Object.keys(first.body.matches[0]).sort(),['matchKey','roleId','faction','initialFaction','won','draw','forfeited','finishedAt'].sort());
  await h.env.DB.prepare('INSERT INTO mafia_results VALUES(?,?,?,?,?,?,?,?,?)').bind(a.id,'new-after-page','citizen','town','town',0,0,0,Date.now()+1).run();
  const second=await h.api(a,'/api/mafia/history?cursor='+encodeURIComponent(first.body.nextCursor));assert.equal(second.body.matches.length,5);assert.equal(second.body.nextCursor,null);
  assert.equal(new Set([...first.body.matches,...second.body.matches].map(match=>match.matchKey)).size,55);
  assert.equal(second.body.stats[0].matches,55,'aggregate covers the frozen time window, independent of page position');
  assert.equal((await h.api(b,'/api/mafia/history?cursor='+encodeURIComponent(first.body.nextCursor))).status,400);
  assert.equal((await h.api(a,'/api/mafia/history?limit=2')).body.matches.length,2);
  for(const query of ['limit=51','limit=0','cursor=garbage'])assert.equal((await h.api(a,'/api/mafia/history?'+query)).status,400);
  await deleteUser(h.env,a.id);assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM mafia_profile_preferences WHERE user_id=?').bind(a.id).first()).n,0);
});

for(const mutation of ['observer','delete'])test(`history discards a snapshot when ${mutation} happens between matches and stats queries`,async t=>{
  const h=await setup(t),a=await h.person(),prepare=h.env.DB.prepare.bind(h.env.DB);let raced=false;
  await h.env.DB.prepare('INSERT INTO mafia_results(user_id,match_key,role_id,initial_faction,faction,won,draw,forfeited,finished_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(a.id,'history-race:1','citizen','town','town',0,0,0,Date.now()-60_000).run();
  t.mock.method(h.env.DB,'prepare',sql=>{
    const statement=prepare(sql);
    if(!sql.includes('FROM mafia_results WHERE user_id=? AND finished_at>'))return statement;
    return {bind(...args){const bound=statement.bind(...args);return {all:async()=>{
      const rows=await bound.all();
      if(!raced){raced=true;if(mutation==='observer')await h.lock(a,'observer');else await deleteUser(h.env,a.id);}
      return rows;
    }};}};
  });
  const response=await h.api(a,'/api/mafia/history');
  assert.equal(raced,true);assert.equal(response.status,mutation==='observer'?409:404);
  assert.deepEqual(response.body,{error:mutation==='observer'?'MAFIA_OBSERVER_ACTIVE':'NOT_FOUND'});
  assert.equal('matches' in response.body,false);assert.equal('stats' in response.body,false);
});
