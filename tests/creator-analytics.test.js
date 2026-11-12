import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession, readSession, ROTATE_AFTER } from '../server/accounts/session.mjs';
import { errorResponse } from '../server/protocol.mjs';
import { getCreatorCapabilities, assertCurrentActor } from '../server/creator/access.mjs';
import { creatorAnalytics, recordPresence, pruneCreatorAnalytics, deleteCreatorAccountStatements } from '../server/creator/db.mjs';
import { routeCreator } from '../server/creator/router.mjs';
import { presenceOf, localPeriod, dayStart, MAX_PRESENCE_ROWS } from '../server/creator/model.mjs';

const HOME = {game:null,mode:'none',screen:'home'};
const PLAY = {game:'beep',mode:'local',screen:'game-playing'};
async function fixture(t) {
  const DB = createLocalD1(), env = {DB,APP_ORIGIN:'https://maydan-mafia-preview.mf103871.workers.dev'}, now = Date.now();
  t.after(()=>DB.close());
  const owner = await createUser(env,{name:'private owner name',email:'same@example.test',now});
  const other = await createUser(env,{name:'private other name',email:'same@example.test',now});
  const sessions = await Promise.all([owner,other].map(user=>issueSession(env,user.id,'web',now)));
  const actors = await Promise.all([owner,other].map(async(user,n)=>({userId:user.id,sessionId:sessions[n].id,secretHash:await DB.prepare('SELECT secret_hash FROM sessions WHERE id=?').bind(sessions[n].id).first('secret_hash')})));
  const grant = () => DB.prepare('INSERT INTO creator_access(user_id,enabled,created_at,updated_at) VALUES(?,1,?,?)').bind(owner.id,now,now).run();
  return {DB,env,now,owner,other,sessions,actors,grant};
}
async function request(env,token,path='/api/creator/analytics',body,charge) {
  const req = new Request('https://local.test'+path,{method:body?'POST':'GET',headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let response;
  try { response = await routeCreator(req,env,new URL(req.url),charge); } catch (error) { response = errorResponse(error); }
  return {response,data:await response.json()};
}

test('creator migration grants nobody; capability uses server user ID, never matching email',async t=>{
  const {DB,env,owner,other,grant}=await fixture(t);
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM creator_access').first('n'),0);
  assert.deepEqual(await getCreatorCapabilities(env,owner.id),{enabled:false,analytics:false,presence:true,heartbeatSeconds:30,onlineWindowSeconds:90});
  await grant();
  assert.equal((await getCreatorCapabilities(env,owner.id)).enabled,true);
  assert.equal((await getCreatorCapabilities(env,other.id)).enabled,false);
  await DB.prepare('UPDATE creator_access SET enabled=0').run();
  assert.equal((await getCreatorCapabilities(env,owner.id)).enabled,false);
});

test('capability fails closed only for absent schema; real database failures remain visible',async t=>{
  const {DB,env,owner}=await fixture(t);
  await DB.exec('DROP TABLE creator_access');
  assert.equal((await getCreatorCapabilities(env,owner.id)).presence,false);
  const broken={DB:{prepare(){throw new Error('database transport unavailable');}}};
  await assert.rejects(getCreatorCapabilities(broken,owner.id),/transport unavailable/);
});

test('analytics authenticates, authorizes and returns an explicit empty aggregate without PII',async t=>{
  const {env,sessions,grant}=await fixture(t);
  assert.equal((await request(env)).response.status,401);
  assert.equal((await request(env,sessions[1].token)).response.status,403);
  await grant();
  const {response,data}=await request(env,sessions[0].token);
  assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(data.collection.status,'not-started'); assert.equal(data.metricsStartedAt,null);
  assert.equal(data.summary.registeredAccountsTotal,2); assert.equal(data.summary.todayPlayers,0);
  assert.equal(data.environment.id,'preview'); assert.equal(data.daily.length,7);
  assert.ok(data.daily.every(row=>!row.tracked));
  assert.doesNotMatch(JSON.stringify(data),/same@example|private owner|private other|sessionId|userId|room_code/);
});

test('presence accepts only the three enumerated hints and takes limiter identity from auth',async t=>{
  const {env,sessions,actors}=await fixture(t), charged=[];
  for (const extra of [{userId:'forged'},{email:'same@example.test'},{role:'mafia'},{chat:'private'},{timestamp:Date.now()}]) {
    const result=await request(env,sessions[1].token,'/api/creator/presence',{...HOME,...extra});
    assert.equal(result.response.status,400);
  }
  const result=await request(env,sessions[1].token,'/api/creator/presence',HOME,(...args)=>charged.push(args));
  assert.equal(result.response.status,200); assert.equal(result.data.accepted,true);
  assert.deepEqual(charged,[['creatorPresenceIP'],['creatorPresence','RATE_LIMIT',actors[1].userId]]);
  assert.throws(()=>presenceOf({game:'mafia',mode:'local',screen:'game-playing'}));
  assert.throws(()=>presenceOf({game:'beep',mode:'online',screen:'game-playing'}));
  assert.throws(()=>presenceOf({game:'beep',mode:'local',screen:'profile'}));
});

test('parallel tabs and sessions count a signed person once and throttle actual stored heartbeats',async t=>{
  const {env,DB,now,actors,grant,owner}=await fixture(t); await grant();
  const second=await issueSession(env,owner.id,'ios',now);
  const secondActor={userId:owner.id,sessionId:second.id,secretHash:await env.DB.prepare('SELECT secret_hash FROM sessions WHERE id=?').bind(second.id).first('secret_hash')};
  const results=await Promise.all([actors[0],secondActor,actors[0]].map(actor=>recordPresence(env,actor,PLAY,now)));
  assert.equal(results.filter(row=>row.accepted).length,1);
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM creator_presence').first('n'),1);
  assert.equal((await creatorAnalytics(env,actors[0],now)).summary.todayPlayers,1);
  assert.equal((await recordPresence(env,actors[0],HOME,now+29_000)).accepted,false);
  assert.equal(await DB.prepare('SELECT last_seen_at FROM creator_presence').first('last_seen_at'),now);
  assert.equal((await recordPresence(env,actors[0],HOME,now+30_000)).accepted,true);
});

test('online TTL is ninety seconds; daily and hourly uniqueness are independent and peak is sampled',async t=>{
  const {env,now,actors,grant}=await fixture(t); await grant();
  await recordPresence(env,actors[0],PLAY,now);
  await recordPresence(env,actors[1],HOME,now+60_000);
  let report=await creatorAnalytics(env,actors[0],now+60_000);
  assert.equal(report.summary.onlinePlayers,2); assert.equal(report.summary.todayPlayers,2);
  assert.equal(report.summary.todayPeakOnline,2); assert.equal(report.byGame[0].count,1);
  assert.equal((await creatorAnalytics(env,actors[0],now+90_000)).summary.onlinePlayers,1);
  assert.equal((await creatorAnalytics(env,actors[0],now+150_000)).summary.onlinePlayers,0);
  await recordPresence(env,actors[0],PLAY,now+3600_000);
  report=await creatorAnalytics(env,actors[0],now+3600_000);
  const day=localPeriod(now).day;
  if(localPeriod(now+3600_000).day===day)assert.equal(report.summary.todayPlayers,2);
  assert.equal(report.hourly.filter(row=>row.uniquePlayers).reduce((sum,row)=>sum+row.uniquePlayers,0),3);
  assert.equal(report.summary.lifetimeUniquePlayers,null);
});

test('Amman calendar boundaries come from the server, including seven-day zero versus not-tracked coverage',async t=>{
  const {env,actors,grant}=await fixture(t); await grant();
  const next=dayStart('2026-11-14');
  assert.equal(new Date(next).toISOString(),'2026-11-13T21:00:00.000Z');
  assert.deepEqual(localPeriod(next-1),{day:'2026-11-13',hour:23});
  assert.deepEqual(localPeriod(next),{day:'2026-11-14',hour:0});
  await recordPresence(env,actors[0],HOME,next-60_000);
  await recordPresence(env,actors[0],PLAY,next);
  const report=await creatorAnalytics(env,actors[0],next);
  assert.equal(report.summary.todayPlayers,1);
  assert.equal(report.daily.at(-2).uniquePlayers,1); assert.equal(report.daily.at(-1).uniquePlayers,1);
  assert.equal(report.daily[0].tracked,false); assert.equal(report.daily.at(-1).tracked,true);
});

test('membership evidence checks a server seat but never publishes a room, identity or role',async t=>{
  const {env,DB,now,actors,grant}=await fixture(t); await grant();
  await DB.prepare('INSERT INTO mafia_seats(user_id,room_key,room_code,seat_id,expires_at,updated_at) VALUES(?,?,?,?,?,?)').bind(actors[0].userId,'secret-room','654321','private-seat',now+600_000,now).run();
  const hint={game:'mafia',mode:'online',screen:'game-lobby'};
  await recordPresence(env,actors[0],hint,now); await recordPresence(env,actors[1],hint,now);
  const report=await creatorAnalytics(env,actors[0],now);
  assert.deepEqual(report.byGame,[{game:'mafia',mode:'online',count:2,membershipVerified:1}]);
  const output=JSON.stringify(report);
  for(const value of ['secret-room','654321','private-seat',actors[0].userId,actors[1].userId,'same@example.test'])assert.ok(!output.includes(value));
});

test('revocation between authentication and the SQL write cannot extend presence',async t=>{
  const {env,DB,now,actors}=await fixture(t);
  await recordPresence(env,actors[0],HOME,now);
  await DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(now+1,actors[0].sessionId).run();
  await assert.rejects(recordPresence(env,actors[0],PLAY,now+30_000),error=>error.code==='AUTH_EXPIRED');
  assert.equal(await DB.prepare('SELECT last_seen_at FROM creator_presence').first('last_seen_at'),now);
});

for(const field of ['revoked_at','expires_at','secret_hash'])test(`${field} after captured time during a delayed presence read blocks the actual write`,async t=>{
  const {env,DB,actors}=await fixture(t),previous=Date.now()-31_000;
  await recordPresence(env,actors[0],HOME,previous);
  let changedAt=0;
  const racing={...env,DB:{batch:values=>DB.batch(values),prepare(sql){const statement=DB.prepare(sql);
    if(sql==='SELECT last_seen_at FROM creator_presence WHERE user_id=?'&&!changedAt)return{bind(...args){const bound=statement.bind(...args);return{async first(){
      await new Promise(resolve=>setTimeout(resolve,12));changedAt=Date.now();
      await DB.prepare(`UPDATE sessions SET ${field}=? WHERE id=?`).bind(field==='secret_hash'?'changed-session-secret':changedAt,actors[0].sessionId).run();return bound.first();
    }};}};return statement;}}};
  const captured=Date.now();
  await assert.rejects(recordPresence(racing,actors[0],PLAY,captured),error=>error.code==='AUTH_EXPIRED');
  assert.ok(changedAt>captured,'the session change occurs after the request captured its time');
  assert.equal(await DB.prepare('SELECT last_seen_at FROM creator_presence').first('last_seen_at'),previous);
  assert.equal(await DB.prepare('SELECT screen FROM creator_presence').first('screen'),'home');
});

test('concurrent real session rotation gets one fresh snapshot retry and counts the heartbeat once',async t=>{
  const {env,DB,actors,sessions}=await fixture(t),previous=Date.now()-31_000;
  await recordPresence(env,actors[0],HOME,previous);
  await DB.prepare('UPDATE sessions SET last_seen=? WHERE id=?').bind(Date.now()-ROTATE_AFTER-1,actors[0].sessionId).run();
  let rotated=null,batches=0;
  const racing={...env,DB:{async batch(values){batches++;return DB.batch(values);},prepare(sql){const statement=DB.prepare(sql);
    if(sql==='SELECT last_seen_at FROM creator_presence WHERE user_id=?'&&!rotated)return{bind(...args){const bound=statement.bind(...args);return{async first(){
      const auth=await readSession(env,new Request('https://local.test/api/creator/presence',{headers:{authorization:'Bearer '+sessions[0].token}}));
      rotated=auth.rotated;assert.ok(rotated,'the real session service rotated the old token into grace');return bound.first();
    }};}};return statement;}}};
  const result=await recordPresence(racing,actors[0],PLAY);
  assert.equal(result.accepted,true);assert.equal(batches,2,'one rejected snapshot followed by exactly one successful retry');
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM creator_presence').first('n'),1);
  assert.equal(await DB.prepare('SELECT unique_players FROM creator_daily').first('unique_players'),1);
  assert.equal(await DB.prepare('SELECT screen FROM creator_presence').first('screen'),'game-playing');
  assert.ok((await readSession(env,new Request('https://local.test/api/creator/presence',{headers:{authorization:'Bearer '+rotated.token}}))).user);
});

test('creator read authorization uses database milliseconds and preserves a future rotation grace',async t=>{
  const {env,DB,actors}=await fixture(t);
  // Both timestamps deliberately share a second. Whole-second SQL would treat
  // the later revocation as future and incorrectly authorize this old request.
  await new Promise(resolve=>setTimeout(resolve,5));
  const captured=Math.floor(Date.now()/1000)*1000,revoked=captured+1;
  await DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(revoked,actors[0].sessionId).run();
  await assert.rejects(assertCurrentActor(env,actors[0],captured),error=>error.code==='AUTH_EXPIRED');
  const grace=Date.now()+60_000;
  await DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(grace,actors[0].sessionId).run();
  await assertCurrentActor(env,actors[0],Date.now());
  await assert.rejects(assertCurrentActor(env,actors[0],grace),error=>error.code==='AUTH_EXPIRED');
});

test('revoking creator access during report reads fails the final authorization fence',async t=>{
  const {env,DB,now,actors,grant}=await fixture(t); await grant();
  let revoked=false;
  const racing={...env,DB:{prepare(sql){const statement=DB.prepare(sql);if(sql.startsWith('SELECT started_at'))return {bind(...args){const bound=statement.bind(...args);return {async first(){await DB.prepare('UPDATE creator_access SET enabled=0').run();revoked=true;return bound.first();}};}};return statement;}}};
  await assert.rejects(creatorAnalytics(racing,actors[0],now),error=>error.code==='FORBIDDEN');
  assert.equal(revoked,true);
});

test('a failed metric statement rolls back heartbeat and counters together',async t=>{
  const {env,DB,now,actors}=await fixture(t);
  await DB.exec("CREATE TRIGGER creator_test_failure BEFORE INSERT ON creator_hourly BEGIN SELECT RAISE(ABORT,'fixture transaction failure'); END;");
  await assert.rejects(recordPresence(env,actors[0],PLAY,now),/fixture transaction failure/);
  for(const table of ['creator_presence','creator_daily','creator_daily_users','creator_state'])assert.equal(await DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n'),0);
});

test('presence capacity is bounded and explicitly marks analytics as limited',async t=>{
  const {env,DB,now,actors,grant}=await fixture(t); await grant();
  await DB.exec(`WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v+1 FROM n WHERE v<${MAX_PRESENCE_ROWS}) INSERT INTO users(id,created_at,updated_at) SELECT 'cap-'||v,0,0 FROM n;`);
  await DB.prepare("INSERT INTO creator_presence(user_id,last_seen_at,pulse_id,game,mode,screen,membership_verified) SELECT id,?,'fixture',NULL,'none','home',0 FROM users WHERE id LIKE 'cap-%'").bind(now).run();
  const result=await recordPresence(env,actors[0],HOME,now);
  assert.equal(result.accepted,false); assert.equal(result.reason,'capacity');
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM creator_presence').first('n'),MAX_PRESENCE_ROWS);
  assert.equal((await creatorAnalytics(env,actors[0],now)).collection.status,'limited');
});

test('retention and account cleanup remove identifying activity without erasing anonymous history',async t=>{
  const {env,DB,now,actors,grant}=await fixture(t); await grant();
  await recordPresence(env,actors[0],PLAY,now);
  await DB.batch(deleteCreatorAccountStatements(env,actors[0].userId));
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM creator_presence').first('n'),0);
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM creator_daily_users').first('n'),0);
  assert.equal(await DB.prepare('SELECT unique_players FROM creator_daily').first('unique_players'),1);
  await recordPresence(env,actors[1],HOME,now);
  await pruneCreatorAnalytics(env,now+9*86400_000);
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM creator_presence').first('n'),0);
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM creator_daily_users').first('n'),0);
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM creator_hourly').first('n'),0);
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM creator_daily').first('n'),1);
});
