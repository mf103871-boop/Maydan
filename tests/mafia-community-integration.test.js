import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeMafiaCommunity, mafiaCommunityDeleteStatements } from '../server/mafia-community.mjs';
import { persistMafiaProgress, mafiaProgressStatements } from '../server/mafia-progression.mjs';
import { persistMafiaResult } from '../server/mafia-results.mjs';
import { readMafiaProgress } from '../server/mafia-profile.mjs';
import { readMafiaCosmeticGrants } from '../server/mafia-achievements.mjs';
import { MAFIA_COMMUNITY_SEASON as season } from '../src/online/mafia-community-shared.js';

// Synthetic accounts and server-owned result envelopes exercise the public
// authority boundary; no deployed service, participant or paid resource is used.
async function setup(t) {
  let clock=Date.UTC(2026,10,1,12);t.mock.method(Date,'now',()=>clock);
  const env={DB:createLocalD1(),APP_ORIGIN:'https://maydan-mafia-preview.mf103871.workers.dev',MAFIA_ENABLED:'1',MAFIA_COMMUNITY_ENABLED:'1',MAFIA_PROGRESS_ENABLED:'1'};
  t.after(()=>env.DB.close());
  const run=(sql,...args)=>env.DB.prepare(sql).bind(...args).run();
  const first=(sql,...args)=>env.DB.prepare(sql).bind(...args).first();
  const all=async(sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results;
  async function person() {const user=await createUser(env,{name:'لاعب الاختبار'}),session=await issueSession(env,user.id);return {...user,token:session.token,sessionId:session.id};}
  async function api(user,path='',body,method=body===undefined?'GET':'POST') {
    try {
      const request=new Request(env.APP_ORIGIN+'/api/mafia/community'+path,{method,
        headers:{authorization:`Bearer ${user.token}`,...(body===undefined?{}:{'content-type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      const response=await routeMafiaCommunity(request,env);
      return {status:response.status,body:await response.json()};
    } catch(error) {return {status:error.status||500,body:{error:error.code||error.message}};}
  }
  async function group(people) {
    const id=crypto.randomUUID(),joinedAt=clock-300_000;
    await run('INSERT INTO social_groups(id,name,owner_id,created_at,updated_at) VALUES(?,?,?,?,?)',id,'مجلس الاختبار',people[0].id,joinedAt,joinedAt);
    for(const [index,user] of people.entries())await run('INSERT INTO social_group_members(group_id,user_id,role,joined_at) VALUES(?,?,?,?)',id,user.id,index===0?'owner':'member',joinedAt);
    return id;
  }
  async function club(people) {const id=await group(people);const result=await api(people[0],`/clubs/${id}`,{motto:'مجلس الأصحاب',revision:0},'PUT');assert.equal(result.status,200,JSON.stringify(result));return id;}
  function event(people,changes={}) {
    const finishedAt=clock-31_000,results=people.map((user,index)=>({userId:user.id,playerId:`seat-${index}`,roleId:index<2?'mafia':'citizen',initialFaction:index<2?'mafia':'town',faction:index<2?'mafia':'town',won:!changes.draw&&index>=2,forfeited:false,eliminatedAt:null}));
    return {eventSchemaVersion:1,eventKind:'match_completed',source:'live',rewardPolicyVersion:1,
      key:`community:${crypto.randomUUID()}`,eventId:`online:${crypto.randomUUID()}`,roomCode:'ABCDEF',rulesetVersion:1,
      startedAt:finishedAt-120_000,finishedAt,notBefore:finishedAt+30_000,visibility:'public',mode:'classic',capacity:8,participantCount:8,draw:false,results,...changes};
  }
  async function result(people,changes={}) {
    const value=event(people,changes);
    const summary={mode:value.mode,startedAt:value.startedAt,settings:{capacity:value.capacity,visibility:value.visibility,voiceMode:'off'},outcome:{faction:value.draw?'draw':'town'},reveal:{players:value.results,events:[]}};
    value.summary=JSON.stringify(summary);
    await persistMafiaResult(env,value);await persistMafiaProgress(env,value);return value;
  }
  async function tournament(people,manager=people[0]) {
    const g=await club(people),startsAt=clock+16*60_000;
    const created=await api(manager,`/clubs/${g}/tournaments`,{title:'بطولة المجلس',startsAt,clientId:'create-event'});
    assert.equal(created.status,200,JSON.stringify(created));const id=created.body.tournament.id;
    for(const user of people.slice(0,8))assert.equal((await api(user,`/tournaments/${id}/registration`,{},'PUT')).status,200);
    return {id,g,startsAt};
  }
  const lock=async(user,id,revision=0)=>api(user,`/tournaments/${id}`,{action:'lock',revision},'PATCH');
  const tick=ms=>clock+=ms;
  return {env,run,first,all,person,api,group,club,event,result,tournament,lock,tick,now:()=>clock,setClock:value=>clock=value};
}
const people=async(h,count=8)=>Promise.all(Array.from({length:count},()=>h.person()));
const ok=result=>{assert.equal(result.status,200,JSON.stringify(result));return result.body;};
const rejected=result=>assert.ok(result.status>=400,JSON.stringify(result));

test('community is unavailable outside the exact isolated preview and its explicit feature flags',async t=>{
  const h=await setup(t),user=await h.person();ok(await h.api(user));
  for(const [field,value] of [['APP_ORIGIN','https://maydan-game.mf103871.workers.dev'],['MAFIA_ENABLED','0'],['MAFIA_COMMUNITY_ENABLED','0']]){
    const before=h.env[field];h.env[field]=value;
    assert.equal((await h.api(user)).body.error,'MAFIA_COMMUNITY_DISABLED');h.env[field]=before;
  }
});

test('community season consumes only qualified public window receipts and grants a permanent free license once',async t=>{
  const h=await setup(t),user=await h.person();
  for(let n=0;n<19;n++)await persistMafiaProgress(h.env,h.event([user]));
  await persistMafiaProgress(h.env,h.event([user],{visibility:'private'}));
  const forfeited=h.event([user]);forfeited.results[0].forfeited=true;await persistMafiaProgress(h.env,forfeited);
  const legacy=h.event([user],{source:'legacy',rewardPolicyVersion:null,startedAt:null,visibility:null});
  await h.env.DB.batch(await mafiaProgressStatements(h.env,legacy,{legacy:true}));
  const outside=h.event([user],{startedAt:season.startsAt-120_001,finishedAt:season.startsAt-1,notBefore:season.startsAt+29_999});
  await persistMafiaProgress(h.env,outside);
  let view=ok(await h.api(user));assert.equal(view.season.completed,19);assert.equal(view.season.canClaim,false);
  rejected(await h.api(user,'/season/claim',{}));
  const pending=h.event([user],{finishedAt:h.now()-29_999,notBefore:h.now()+1});
  await assert.rejects(persistMafiaProgress(h.env,pending),{code:'MAFIA_PROGRESS_PENDING'});
  h.tick(1);await persistMafiaProgress(h.env,pending);
  view=ok(await h.api(user));assert.equal(view.season.completed,20);assert.equal(view.season.canClaim,true);
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_achievements WHERE user_id=? AND achievement_id=?',user.id,season.achievementId)).n,0,'normal progression cannot award the special season metric');
  await h.env.DB.exec('DELETE FROM mafia_history; DELETE FROM mafia_results;');h.setClock(season.endsAt+1);
  ok(await h.api(user,'/season/claim',{}));ok(await h.api(user,'/season/claim',{}));
  const grants=await readMafiaCosmeticGrants(h.env,user.id,h.now());assert.equal(grants.filter(x=>x.itemId==='noir.avatar').length,1);
  const profile=await readMafiaProgress(h.env,user.id);assert.ok(profile.grants.some(x=>x.itemId==='noir.avatar'));
  await h.run('UPDATE mafia_cosmetic_grants SET revoked_at=? WHERE user_id=? AND item_id=?',h.now(),user.id,'noir.avatar');
  ok(await h.api(user,'/season/claim',{}));assert.ok(!(await readMafiaCosmeticGrants(h.env,user.id,h.now())).some(x=>x.itemId==='noir.avatar'));
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_achievements WHERE user_id=? AND achievement_id=?',user.id,season.achievementId)).n,1);
});

test('season boundaries are half-open even after the season closes; training cannot mint a qualifying receipt',async t=>{
  const h=await setup(t),user=await h.person();h.setClock(season.endsAt+31_001);
  for(const finishedAt of [season.startsAt-1,season.startsAt,season.endsAt-1,season.endsAt]){
    await persistMafiaProgress(h.env,h.event([user],{startedAt:finishedAt-120_000,finishedAt,notBefore:finishedAt+30_000}));
  }
  assert.equal(ok(await h.api(user)).season.completed,2);
  for(const marker of ['tutorial','observer','technicalAbort']){
    await assert.rejects(persistMafiaProgress(h.env,h.event([user],{[marker]:true})),{code:'MAFIA_PROGRESS_INVALID'});
  }
  assert.equal(ok(await h.api(user)).season.completed,2);
});

test('a failed free-season license write rolls back the achievement too and an exact retry grants once',async t=>{
  const h=await setup(t),user=await h.person();for(let n=0;n<20;n++)await persistMafiaProgress(h.env,h.event([user]));
  const batch=h.env.DB.batch.bind(h.env.DB),failure=t.mock.method(h.env.DB,'batch',statements=>batch([statements[0],h.env.DB.prepare('INSERT INTO missing_season_grant VALUES(1)'),...statements.slice(1)]));
  rejected(await h.api(user,'/season/claim',{}));failure.mock.restore();
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_achievements WHERE user_id=? AND achievement_id=?',user.id,season.achievementId)).n,0);
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_cosmetic_grants WHERE user_id=? AND item_id=?',user.id,'noir.avatar')).n,0);
  ok(await h.api(user,'/season/claim',{}));ok(await h.api(user,'/season/claim',{}));
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_cosmetic_grants WHERE user_id=? AND item_id=?',user.id,'noir.avatar')).n,1);
});

test('club authority follows group roles, revisions and current membership; closure removes reads',async t=>{
  const h=await setup(t),[owner,member,other]=await people(h,3),g=await h.club([owner,member]);
  rejected(await h.api(member,`/clubs/${g}`,{motto:'تغيير',revision:1},'PUT'));
  rejected(await h.api(other,`/clubs/${g}`));
  await h.run("UPDATE social_group_members SET role='admin' WHERE group_id=? AND user_id=?",g,member.id);
  const updated=ok(await h.api(member,`/clubs/${g}`,{motto:'مجلس جديد',revision:1},'PUT'));assert.equal(updated.club.revision,2);
  assert.equal((await h.api(owner,`/clubs/${g}`,{motto:'نسخة قديمة',revision:1},'PUT')).status,409);
  await h.run('UPDATE social_group_members SET left_at=? WHERE group_id=? AND user_id=?',h.now(),g,member.id);
  rejected(await h.api(member,`/clubs/${g}`));
  await h.run('UPDATE social_groups SET closed_at=? WHERE id=?',h.now(),g);rejected(await h.api(owner,`/clubs/${g}`));
});

test('club credits bind one receipt to one club and reset contribution at the membership boundary',async t=>{
  const h=await setup(t),[a,b,c]=await people(h,3),g=await h.club([a,b,c]),other=await h.club([a,b,c]);
  h.tick(180_000);
  for(let index=0;index<3;index++)await persistMafiaProgress(h.env,h.event([a]));
  for(let index=0;index<17;index++)await persistMafiaProgress(h.env,h.event([b]));
  let view=ok(await h.api(a,`/clubs/${g}/credit`,{}));assert.equal(view.mission.own,3);assert.equal(view.mission.total,3);assert.equal(view.mission.claimed,false);
  view=ok(await h.api(b,`/clubs/${g}/credit`,{}));assert.equal(view.mission.total,20);
  view=ok(await h.api(a,`/clubs/${g}/credit`,{}));assert.equal(view.mission.claimed,true);
  assert.ok((await readMafiaCosmeticGrants(h.env,a.id,h.now())).some(x=>x.itemId==='noir.roomTheme'));
  assert.equal(ok(await h.api(a,`/clubs/${other}/credit`,{})).mission.total,0);
  await h.run('UPDATE social_group_members SET left_at=?,joined_at=? WHERE group_id=? AND user_id=?',null,h.now()+1,g,b.id);h.tick(2);
  view=ok(await h.api(a,`/clubs/${g}`));assert.equal(view.mission.total,3,'old membership credits cannot follow rejoining');
  assert.equal(view.mission.claimed,true,'earned licenses survive another member leaving');
  assert.equal(ok(await h.api(b,`/clubs/${g}/credit`,{})).mission.own,0);
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_club_credits WHERE user_id=?',b.id)).n,17,'permanent keys cannot be credited elsewhere');
});

test('community reads and reward writes reject live-match, observer, session and deletion races',async t=>{
  const h=await setup(t),user=await h.person();
  for(let index=0;index<20;index++)await persistMafiaProgress(h.env,h.event([user]));
  await h.run('INSERT INTO mafia_match_leases VALUES(?,?,?,?,?)',user.id,'match-key','match-id',h.now()+180_000,h.now());
  assert.equal((await h.api(user)).body.error,'MAFIA_SOCIAL_LOCKED');await h.run('DELETE FROM mafia_match_leases');
  await h.run('INSERT INTO mafia_observer_memberships VALUES(?,?,?,?,?,?)',user.id,'observed-match','ABCDEF','observer-seat',h.now(),h.now()+180_000);
  assert.equal((await h.api(user)).body.error,'MAFIA_SOCIAL_LOCKED');await h.run('DELETE FROM mafia_observer_memberships');
  await h.run('INSERT INTO mafia_media_leases VALUES(?,?,?,?,?)',user.id,'voice-match','voice-call',h.now()+180_000,h.now());
  assert.equal((await h.api(user)).body.error,'MAFIA_SOCIAL_LOCKED');await h.run('DELETE FROM mafia_media_leases');
  await h.run('UPDATE sessions SET revoked_at=? WHERE id=?',h.now(),user.sessionId);rejected(await h.api(user,'/season/claim',{}));
  await h.run('UPDATE sessions SET revoked_at=NULL WHERE id=?',user.sessionId);
  const batch=h.env.DB.batch.bind(h.env.DB);let injected=false;
  t.mock.method(h.env.DB,'batch',async statements=>{
    if(!injected){injected=true;await h.run('INSERT INTO account_deletions(user_id,attempt_id,created_at) VALUES(?,?,?)',user.id,'delete-at-claim',h.now());}
    return batch(statements);
  });
  rejected(await h.api(user,'/season/claim',{}));
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_achievements WHERE user_id=? AND achievement_id=?',user.id,season.achievementId)).n,0);
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_cosmetic_grants WHERE user_id=? AND item_id=?',user.id,'noir.avatar')).n,0);
});

test('tournaments require self-registration, exactly eight current accounts and an immutable roster',async t=>{
  const h=await setup(t),users=await people(h,9),g=await h.club(users),startsAt=h.now()+16*60_000,body={title:'بطولة المجلس',startsAt,clientId:'create-retry'};
  const created=ok(await h.api(users[0],`/clubs/${g}/tournaments`,body)),id=created.tournament.id;
  assert.equal(ok(await h.api(users[0],`/clubs/${g}/tournaments`,body)).tournament.id,id);
  assert.equal((await h.api(users[0],`/clubs/${g}/tournaments`,{...body,title:'مختلف'})).status,409);
  rejected(await h.api(users[1],`/clubs/${g}/tournaments`,{...body,clientId:'member-creates'}));
  rejected(await h.api(users[0],`/tournaments/${id}/registration`,{userId:users[1].id},'PUT'));
  for(const user of users.slice(0,7))ok(await h.api(user,`/tournaments/${id}/registration`,{},'PUT'));
  rejected(await h.lock(users[0],id));ok(await h.api(users[7],`/tournaments/${id}/registration`,{},'PUT'));
  assert.equal((await h.api(users[8],`/tournaments/${id}/registration`,{},'PUT')).body.error,'FULL');
  const locked=ok(await h.lock(users[0],id));assert.equal(locked.tournament.state,'locked');assert.equal(locked.members.length,8);
  rejected(await h.api(users[0],`/tournaments/${id}/registration`,undefined,'DELETE'));
  rejected(await h.api(users[8],`/tournaments/${id}/registration`,{},'PUT'));
  rejected(await h.api(users[1],`/tournaments/${id}`,{action:'cancel',revision:1},'PATCH'));
  assert.equal(ok(await h.api(users[0],`/tournaments/${id}`)).members.length,8);
});

test('three delayed authoritative rounds close atomically with fixed points, ties and idempotent recognition',async t=>{
  const h=await setup(t),users=await people(h),{id,startsAt}=await h.tournament(users);ok(await h.lock(users[0],id));h.setClock(startsAt+180_000);
  const keys=[];
  for(let round=0;round<3;round++){
    const value=await h.result(users,{visibility:'private',draw:round===1});keys.push(value.key);
    rejected(await h.api(users[0],`/tournaments/${id}/matches`,{matchKey:value.key,winner:users[0].id,points:999}));
    const accepted=ok(await h.api(users[0],`/tournaments/${id}/matches`,{matchKey:value.key}));assert.equal(accepted.matches.length,round+1);
    ok(await h.api(users[0],`/tournaments/${id}/matches`,{matchKey:value.key}));h.tick(180_000);
  }
  const beforeXp=await h.all('SELECT user_id,total_xp FROM mafia_player_progress ORDER BY user_id');
  const closed=ok(await h.api(users[0],`/tournaments/${id}`,{action:'close',revision:1},'PATCH'));
  assert.equal(closed.tournament.state,'closed');assert.equal(closed.matches.length,3);
  assert.equal(closed.members.filter(row=>row.points===7&&row.place===1).length,6);
  assert.equal(closed.members.filter(row=>row.points===1&&row.place===2).length,2);
  ok(await h.api(users[0],`/tournaments/${id}`,{action:'close',revision:1},'PATCH'));
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_awards WHERE tournament_id=?',id)).n,8);
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_points WHERE tournament_id=?',id)).n,24);
  assert.deepEqual(await h.all('SELECT user_id,total_xp FROM mafia_player_progress ORDER BY user_id'),beforeXp,'recognition cannot manufacture XP');
  const fourth=await h.result(users,{visibility:'private'});rejected(await h.api(users[0],`/tournaments/${id}/matches`,{matchKey:fourth.key}));
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_matches WHERE tournament_id=?',id)).n,3);
  const others=await h.all('SELECT user_id,points,place FROM mafia_tournament_awards WHERE tournament_id=? AND user_id!=? ORDER BY user_id',id,users[0].id);
  await h.env.DB.batch(mafiaCommunityDeleteStatements(h.env,users[0].id));
  assert.equal(ok(await h.api(users[1],`/tournaments/${id}`)).tournament.state,'closed');
  assert.deepEqual(await h.all('SELECT user_id,points,place FROM mafia_tournament_awards WHERE tournament_id=? ORDER BY user_id',id),others,'deletion does not erase other participants’ closed recognition');
});

test('tournament scheduling bounds and the three-open-event ceiling are enforced before admitting another event',async t=>{
  const h=await setup(t),users=await people(h,2),g=await h.club(users),path=`/clubs/${g}/tournaments`;
  for(const startsAt of [h.now()+15*60_000-1,h.now()+7*86_400_000+1])rejected(await h.api(users[0],path,{title:'موعد غير صالح',startsAt,clientId:crypto.randomUUID()}));
  const ids=[];
  for(let index=0;index<3;index++)ids.push(ok(await h.api(users[0],path,{title:'موعد صالح',startsAt:h.now()+15*60_000,clientId:`event-limit-${index}`})).tournament.id);
  assert.equal((await h.api(users[0],path,{title:'حدث زائد',startsAt:h.now()+7*86_400_000,clientId:'event-limit-over'})).body.error,'TOURNAMENT_LIMIT');
  ok(await h.api(users[0],`/tournaments/${ids[0]}`,{revision:0,action:'cancel'},'PATCH'));
  ok(await h.api(users[0],path,{title:'الموعد الأبعد',startsAt:h.now()+7*86_400_000,clientId:'event-after-cancel'}));
});

test('one authoritative match cannot become a round in two events, even for the same fixed account set',async t=>{
  const h=await setup(t),users=await people(h),{id,g,startsAt}=await h.tournament(users);
  const second=ok(await h.api(users[0],`/clubs/${g}/tournaments`,{title:'حدث ثان',startsAt,clientId:'second-event'})).tournament.id;
  for(const user of users)ok(await h.api(user,`/tournaments/${second}/registration`,{},'PUT'));
  ok(await h.lock(users[0],id));ok(await h.lock(users[0],second));h.setClock(startsAt+180_000);
  const value=await h.result(users,{visibility:'private'});ok(await h.api(users[0],`/tournaments/${id}/matches`,{matchKey:value.key}));
  rejected(await h.api(users[0],`/tournaments/${second}/matches`,{matchKey:value.key}));
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_matches WHERE match_key=?',value.key)).n,1);
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_points WHERE tournament_id=?',second)).n,0);
});

test('round acceptance and all eight point writes roll back together, and a membership race cannot partially award points',async t=>{
  const h=await setup(t),users=await people(h),{id,g,startsAt}=await h.tournament(users);ok(await h.lock(users[0],id));h.setClock(startsAt+180_000);
  const value=await h.result(users,{visibility:'private'}),batch=h.env.DB.batch.bind(h.env.DB);
  const fault=t.mock.method(h.env.DB,'batch',statements=>batch([statements[0],h.env.DB.prepare('INSERT INTO missing_community_transaction VALUES(1)'),...statements.slice(1)]));
  rejected(await h.api(users[0],`/tournaments/${id}/matches`,{matchKey:value.key}));fault.mock.restore();
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_matches WHERE tournament_id=?',id)).n,0);
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_points WHERE tournament_id=?',id)).n,0);
  ok(await h.api(users[0],`/tournaments/${id}/matches`,{matchKey:value.key}));
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_points WHERE tournament_id=?',id)).n,8);
  const other=await h.result(users,{visibility:'private'});
  t.mock.method(h.env.DB,'batch',async statements=>{await h.run('UPDATE social_group_members SET left_at=? WHERE group_id=? AND user_id=?',h.now(),g,users[7].id);return batch(statements);});
  rejected(await h.api(users[0],`/tournaments/${id}/matches`,{matchKey:other.key}));
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_matches WHERE tournament_id=?',id)).n,1);
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_points WHERE tournament_id=?',id)).n,8);
});

test('a pre-freeze membership change needs explicit withdrawal and fresh registration before lock',async t=>{
  const h=await setup(t),users=await people(h),{id,g}=await h.tournament(users);h.tick(2);
  await h.run('UPDATE social_group_members SET joined_at=? WHERE group_id=? AND user_id=?',h.now(),g,users[7].id);
  rejected(await h.lock(users[0],id));
  ok(await h.api(users[7],`/tournaments/${id}/registration`,undefined,'DELETE'));
  ok(await h.api(users[7],`/tournaments/${id}/registration`,{},'PUT'));
  assert.equal(ok(await h.lock(users[0],id)).tournament.state,'locked');
});

test('tournament rounds reject delayed, forged-participant, forfeit, voice and unsupported records without points',async t=>{
  const h=await setup(t),users=await people(h),outsider=await h.person(),{id,startsAt}=await h.tournament(users);ok(await h.lock(users[0],id));h.setClock(startsAt+180_000);
  const attempts=[];
  attempts.push(await h.result([...users.slice(0,7),outsider],{visibility:'private'}));
  const forfeited=h.event(users,{visibility:'private'});forfeited.results[4].forfeited=true;attempts.push(await h.result(users,{...forfeited}));
  const voice=await h.result(users,{visibility:'private'});let summary=JSON.parse(voice.summary);summary.settings.voiceMode='optional';await h.run('UPDATE mafia_history SET summary=? WHERE match_key=?',JSON.stringify(summary),voice.key);attempts.push(voice);
  const recent=h.event(users,{visibility:'private',finishedAt:h.now()-29_999,notBefore:h.now()+1});
  await assert.rejects(persistMafiaProgress(h.env,recent),{code:'MAFIA_PROGRESS_PENDING'});attempts.push(recent);
  const unsupported=await h.result(users,{visibility:'private'});await h.run('UPDATE mafia_history SET ruleset_version=2 WHERE match_key=?',unsupported.key);attempts.push(unsupported);
  const wrongStart=await h.result(users,{visibility:'private'});summary=JSON.parse(wrongStart.summary);summary.startedAt++;await h.run('UPDATE mafia_history SET summary=? WHERE match_key=?',JSON.stringify(summary),wrongStart.key);attempts.push(wrongStart);
  for(const value of attempts)rejected(await h.api(users[0],`/tournaments/${id}/matches`,{matchKey:value.key}));
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_matches WHERE tournament_id=?',id)).n,0);
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_points WHERE tournament_id=?',id)).n,0);
});

test('a group manager cannot submit another player’s private history by guessing its match key',async t=>{
  const h=await setup(t),users=await people(h,9),{id,g,startsAt}=await h.tournament(users);await h.run("UPDATE social_group_members SET role='admin' WHERE group_id=? AND user_id=?",g,users[8].id);
  ok(await h.lock(users[0],id));h.setClock(startsAt+180_000);const value=await h.result(users.slice(0,8),{visibility:'private'});
  rejected(await h.api(users[8],`/tournaments/${id}/matches`,{matchKey:value.key}));
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_matches WHERE tournament_id=?',id)).n,0);
  ok(await h.api(users[0],`/tournaments/${id}/matches`,{matchKey:value.key}));
});

test('a rejoined account cannot revive a frozen tournament membership or reuse a registration from its prior membership',async t=>{
  const h=await setup(t),users=await people(h),{id,g,startsAt}=await h.tournament(users);ok(await h.lock(users[0],id));
  h.tick(1);await h.run('UPDATE social_group_members SET left_at=? WHERE group_id=? AND user_id=?',h.now(),g,users[7].id);h.tick(1);
  await h.run('UPDATE social_group_members SET left_at=NULL,joined_at=? WHERE group_id=? AND user_id=?',h.now(),g,users[7].id);
  h.setClock(startsAt+180_000);const value=await h.result(users,{visibility:'private'});
  rejected(await h.api(users[0],`/tournaments/${id}/matches`,{matchKey:value.key}));
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_matches WHERE tournament_id=?',id)).n,0);
});

test('account deletion cancels an open frozen event and removes only that account’s community records',async t=>{
  const h=await setup(t),users=await people(h),{id}=await h.tournament(users);ok(await h.lock(users[0],id));
  await h.env.DB.batch(mafiaCommunityDeleteStatements(h.env,users[0].id));
  const current=ok(await h.api(users[1],`/tournaments/${id}`));assert.equal(current.tournament.state,'cancelled');assert.equal(current.members.length,7);
  assert.equal((await h.first('SELECT created_by FROM mafia_tournaments WHERE id=?',id)).created_by,null);
  assert.equal((await h.first('SELECT COUNT(*) n FROM mafia_tournament_members WHERE user_id=?',users[0].id)).n,0);
});
