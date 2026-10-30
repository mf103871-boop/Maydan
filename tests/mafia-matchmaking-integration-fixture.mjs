// Synthetic, local fixtures only. These records never establish human play,
// production capacity, network performance, or physical-device acceptance.
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { persistMafiaProgress } from '../server/mafia-progression.mjs';
import { newCredentials } from '../src/online/client.js';
import { sha256 } from '../server/protocol.mjs';

export const PREVIEW_ORIGIN='https://maydan-mafia-preview.mf103871.workers.dev';
export const syntheticVars=()=>({APP_ORIGIN:PREVIEW_ORIGIN,MAFIA_ENABLED:'1',MAFIA_RANKED_ENABLED:'1',MAFIA_PROGRESS_ENABLED:'1'});
export const query=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
export const rows=async(env,sql,...args)=>(await query(env,sql,...args).all()).results;
export async function fixture(t,{db=createLocalD1(),count=8,qualify=true}={}) {
  const calls=[],env={...syntheticVars(),DB:db,ROOMS:{idFromName:name=>name,get:code=>({fetch:async request=>{
    calls.push({code,endpoint:new URL(request.url).pathname,body:await request.json()});
    return Response.json(new URL(request.url).pathname.endsWith('status')?{status:'playing'}:{ok:true});
  }})}};
  t.after(()=>db.close());
  const season=(await query(env,'SELECT * FROM mafia_ranked_seasons LIMIT 1').first()).id;
  await query(env,"UPDATE mafia_ranked_seasons SET starts_at=?,ends_at=?,status='open' WHERE id=?",Date.now()-3_600_000,Date.now()+3_600_000,season).run();
  const people=await peopleFor(env,count);
  if(qualify)await qualifyPeople(env,people);
  return {env,db,season,people,calls};
}
export async function peopleFor(env,count) {
  const people=[];
  for(let index=0;index<count;index++) {
    const user=await createUser(env,{name:`لاعب اختبار ${index}`}),session=await issueSession(env,user.id);
    people.push({...newCredentials(),accountId:user.id,sessionId:session.id,authorization:session.token,
      actor:{userId:user.id,sessionId:session.id},name:user.name,avatar:index%4,game:'mafia',capabilities:{mafia:2},settings:{mode:'classic',capacity:8,visibility:'public',voiceMode:'off'}});
  }
  return people;
}
export async function qualifyPeople(env,people) {
  const finishedAt=Date.now()-31_000;
  for(let index=0;index<10;index++)await persistMafiaProgress(env,{
    eventSchemaVersion:1,eventKind:'match_completed',source:'live',rewardPolicyVersion:1,
    key:`synthetic-qualification:${crypto.randomUUID()}`,eventId:`synthetic:${crypto.randomUUID()}`,rulesetVersion:1,
    startedAt:finishedAt-120_000,finishedAt,notBefore:finishedAt+30_000,visibility:'public',mode:'classic',capacity:8,participantCount:8,draw:false,
    results:people.map(person=>({userId:person.accountId,roleId:'citizen',initialFaction:'town',faction:'town',won:false,forfeited:false,eliminatedAt:null})),
  });
  await env.DB.batch(people.map(person=>query(env,'INSERT INTO mafia_ranked_understanding VALUES(?,1,?)',person.accountId,Date.now())));
}
export async function rankedEvent(env,season,people,{games=0,draw=false,winningFaction='town'}={}) {
  const key=crypto.randomUUID(),finishedAt=Date.now()-31_000;
  await query(env,"INSERT INTO mafia_ranked_matches(match_key,season_id,room_code,created_at,status) VALUES(?,?,?,?,'playing')",key,season,'654321',finishedAt-120_000).run();
  if(games)await env.DB.batch(people.map(person=>query(env,'INSERT INTO mafia_ranked_ratings(user_id,season_id,rating,games,updated_at) VALUES(?,?,1000,?,?)',person.accountId,season,games,Date.now())));
  return {key:`${key}:1`,ranked:{key,seasonId:season,ratingModel:'preview-elo-1'},rulesetVersion:1,mode:'classic',participantCount:8,
    startedAt:finishedAt-120_000,finishedAt,notBefore:finishedAt+30_000,draw,
    results:people.map((person,index)=>({userId:person.accountId,playerId:`seat-${index}`,roleId:index<6?'citizen':'mafia',initialFaction:index<6?'town':'mafia',faction:index<6?'town':'mafia',won:!draw&&(index<6?'town':'mafia')===winningFaction,forfeited:false,eliminatedAt:null}))};
}
export async function seedQueue(env,season,people) {
  const at=Date.now();
  for(const [index,person]of people.entries())await env.DB.batch([
    query(env,"INSERT INTO mafia_match_leases VALUES(?,?,'queue',?,?)",person.accountId,`ranked:queue:${season}`,at+120_000,at),
    query(env,"INSERT INTO mafia_ranked_queue(user_id,season_id,seat_id,token_hash,queue_revision,session_id,joined_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,'queued')",person.accountId,season,person.id,await sha256(person.token),`revision-${index}`,person.sessionId,at-100+index,at+120_000),
  ]);
}
export function interposeBatch(env,predicate,before) {
  const original=env.DB;
  let intercepted=false;
  env.DB={prepare:sql=>original.prepare(sql),batch:async statements=>{
    if(!intercepted&&predicate(statements)){intercepted=true;await before(original,statements);}
    return original.batch(statements);
  }};
  return ()=>{env.DB=original;return intercepted;};
}
