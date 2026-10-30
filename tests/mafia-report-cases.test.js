import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { deleteUser } from '../server/accounts/db.mjs';
import { routeMafia } from '../server/mafia-router.mjs';
import { routeModeration } from '../server/moderation/router.mjs';
import { performAction,reportsOf } from '../server/moderation/db.mjs';
import { mafiaReportInput,privateMafiaReportEvidence,saveMafiaReportCase,ownMafiaReportCases,ownMafiaReportCase,mafiaReportReviewEvidence } from '../server/mafia-report-cases.mjs';
import { reviewMafiaPath } from '../src/moderation/client.js';
import {cleanup,reportRetentionMs} from '../server/accounts/cleanup.mjs';
import {cleanupMafia} from '../server/mafia-access.mjs';

const input=()=>({clientId:'report-attempt-1',targetId:'seat-target',matchId:7,reason:'رسائل مسيئة في المجلس',category:'harassment'});
const evidence=(scope='player')=>({reportedUserId:'target',game:'mafia',matchKey:'123456:incarnation:7',phase:'night',capturedAt:Date.now(),
  perspective:{scope,delayMs:scope==='observer'?30_000:0,channels:['forged']},
  messages:[{id:'message-1',playerId:'seat-target',text:'visible target message',at:Date.now()-40_000,channel:'public',role:'private-role'}],
  publicHistory:[{secret:'unseen-next-day'}],roleStates:{target:'mafia'},audio:'never-save-audio'});
async function fixture(){
  const DB=createLocalD1(),actors={},calls=[];
  for(const id of ['reporter','target','other','moderator']){
    await DB.prepare('INSERT INTO users(id,name,created_at,updated_at)VALUES(?,?,?,?)').bind(id,id,Date.now(),Date.now()).run();
  }
  const env={DB,MAFIA_ENABLED:'1',MODERATOR_USER_IDS:'moderator',ROOMS:{idFromName:id=>id,get:code=>({fetch:async request=>{
    const body=await request.json();calls.push({code,body});return Response.json(evidence(body.scope));
  }})}};
  for(const id of ['reporter','target','other','moderator']){const session=await issueSession(env,id);actors[id]={userId:id,sessionId:session.id,token:session.token};}
  return {env,DB,actors,calls};
}
function afterRead(DB,predicate,action){
  const prepare=DB.prepare.bind(DB);let fired=false;
  DB.prepare=sql=>{
    function wrap(statement){
      const bind=statement.bind.bind(statement);statement.bind=(...args)=>wrap(bind(...args));
      for(const method of ['first','all']){
        const read=statement[method].bind(statement);statement[method]=async(...args)=>{
          const result=await read(...args);if(!fired&&predicate(sql,method)){fired=true;await action();}return result;
        };
      }
      return statement;
    }
    return wrap(prepare(sql));
  };
  return ()=>assert.equal(fired,true,'race injection exercised the actual source read');
}
const safeKeys=['category','createdAt','id','matchId','roomCode','status'];

test('case input bounds category/reference; stored evidence projects actual channel perspective and drops secrets/audio',()=>{
  const canonical=mafiaReportInput('123456',{...input(),role:'invented',audio:'forged',token:'observer-token'});
  assert.equal(canonical.category,'harassment');assert.equal(canonical.audio,undefined);assert.equal(canonical.token,undefined);
  for(const change of [{category:'made-up'},{matchId:-1},{matchId:'7'},{clientId:'../../id'},{targetId:'x/y'},{reason:'x\u0000y'},{scope:'staff'}])assert.throws(()=>mafiaReportInput('123456',{...input(),...change}),e=>e.code==='INVALID');
  const raw=evidence(),safe=privateMafiaReportEvidence(raw,canonical);
  assert.deepEqual(safe.perspective,{scope:'player',delayMs:0,channels:['public']});
  for(const secret of ['private-role','unseen-next-day','roleStates','never-save-audio','reportedUserId'])assert.equal(JSON.stringify(safe).includes(secret),false);
  const observer=evidence('observer');observer.messages[0].channel='team';
  assert.throws(()=>privateMafiaReportEvidence(observer,{...canonical,scope:'observer'}),e=>e.code==='ROOM_UNAVAILABLE');
  assert.throws(()=>privateMafiaReportEvidence({...raw,matchKey:'123456:incarnation:8'},canonical),e=>e.code==='ROOM_UNAVAILABLE');
});

test('retry remains one durable case without refetch; changed request conflicts and database failure stays atomic',async()=>{
  const {env,DB,actors,calls}=await fixture();try{
    const first=await saveMafiaReportCase(env,actors.reporter,'123456',input());
    assert.deepEqual(await saveMafiaReportCase(env,actors.reporter,'123456',{...input(),token:'changed-ignored-credential'}),first);
    assert.equal(calls.length,1);assert.equal(calls[0].body.accountSessionId,actors.reporter.sessionId);
    await assert.rejects(saveMafiaReportCase(env,actors.reporter,'123456',{...input(),category:'cheating'}),e=>e.code==='CONFLICT');
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM mafia_reports').first()).n,1);
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM social_reports').first()).n,1);
    const saved=await DB.prepare('SELECT * FROM mafia_reports').first();assert.equal(saved.reported_id,'target');assert.equal(saved.reason,input().reason);
    for(const value of ['unseen-next-day','private-role','never-save-audio'])assert.equal(saved.evidence.includes(value),false);
    await DB.exec("CREATE TRIGGER injected_case_failure BEFORE INSERT ON social_reports WHEN NEW.id<>'"+first.reportId+"' BEGIN SELECT RAISE(ABORT,'injected rollback'); END;");
    await assert.rejects(saveMafiaReportCase(env,actors.reporter,'123456',{...input(),clientId:'report-attempt-2'}),/injected rollback/);
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM mafia_reports').first()).n,1);
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM mafia_progress_events').first()).n,0);
  }finally{DB.close();}
});

test('owner sees only their safe case status; the existing moderator queue reviews then resolves without automatic sanctions',async()=>{
  const {env,DB,actors}=await fixture();try{
    const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
    const own=await ownMafiaReportCases(env,actors.reporter);assert.equal(own.reports.length,1);assert.deepEqual(Object.keys(own.reports[0]).sort(),safeKeys);
    assert.equal(own.reports[0].status,'queued');assert.deepEqual((await ownMafiaReportCases(env,actors.other)).reports,[]);
    await assert.rejects(ownMafiaReportCase(env,actors.other,saved.reportId),e=>e.code==='NOT_FOUND');
    await assert.rejects(mafiaReportReviewEvidence(env,actors.reporter,saved.reportId),e=>e.code==='FORBIDDEN');
    const queue=await reportsOf(env,{before:Number.MAX_SAFE_INTEGER,limit:30});assert.equal(queue.reports[0].scope,'mafia');assert.equal(queue.reports[0].mafia.status,'queued');
    const start={action:'review_mafia_report',targetId:saved.reportId,reason:'مراجعة السياق قبل القرار',clientId:'start-review-1'};
    await performAction(env,actors.moderator,start);await performAction(env,actors.moderator,start);
    assert.equal((await ownMafiaReportCase(env,actors.reporter,saved.reportId)).status,'reviewing');
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM moderation_report_decisions').first()).n,0);
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM moderation_actions').first()).n,1);
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM moderation_suspensions').first()).n,0);
    const attachment=await mafiaReportReviewEvidence(env,actors.moderator,saved.reportId);assert.equal(attachment.perspective.scope,'player');assert.equal(attachment.messages[0].text,'visible target message');
    assert.equal(attachment.reportedUserId,undefined);assert.equal(attachment.audio,undefined);
    await performAction(env,actors.moderator,{action:'resolve_report',targetId:saved.reportId,clientId:'resolve-1',reason:'راجعنا البلاغ والسياق'});
    assert.equal((await ownMafiaReportCase(env,actors.reporter,saved.reportId)).status,'reviewed');
    assert.deepEqual(Object.keys(await ownMafiaReportCase(env,actors.reporter,saved.reportId)).sort(),safeKeys);
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM moderation_suspensions').first()).n,0);
  }finally{DB.close();}
});

test('authenticated routes fence status ownership, staff evidence and stale sessions; blocked peers retain reporting rights',async()=>{
  const {env,DB,actors}=await fixture();try{
    await DB.prepare('INSERT INTO social_blocks(blocker_id,blocked_id,created_at)VALUES(?,?,?)').bind('reporter','target',Date.now()).run();
    const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
    const ownPath=`https://test.local/api/me/mafia/reports/${saved.reportId}`;
    const get=(actor,url)=>new Request(url,{headers:{authorization:`Bearer ${actor.token}`}});
    assert.equal((await routeMafia(get(actors.reporter,ownPath),env,new URL(ownPath))).status,200);
    await assert.rejects(routeMafia(get(actors.other,ownPath),env,new URL(ownPath)),e=>e.code==='NOT_FOUND');
    const path=`https://test.local/api/moderation/reports/${saved.reportId}/mafia`;
    assert.equal((await routeModeration(get(actors.reporter,path),env)).status,403);
    const response=await routeModeration(get(actors.moderator,path),env);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    await DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now()-1,actors.reporter.sessionId).run();
    await assert.rejects(saveMafiaReportCase(env,actors.reporter,'123456',input()),e=>e.code==='AUTH');
  }finally{DB.close();}
});

for(const victim of ['reporter','target'])test(`deleting ${victim} during authorized evidence lookup cannot resurrect a case`,async()=>{
  const {env,DB,actors}=await fixture();try{
    env.ROOMS.get=()=>({fetch:async()=>{await deleteUser(env,victim);return Response.json(evidence());}});
    await assert.rejects(saveMafiaReportCase(env,actors.reporter,'123456',input()),e=>['AUTH','NOT_FOUND'].includes(e.code));
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM mafia_reports').first()).n,0);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM social_reports').first()).n,0);
  }finally{DB.close();}
});

for(const victim of ['reporter','target'])test(`actual deleteUser(${victim}) inside moderator evidence read returns no stale private attachment`,async()=>{
  const {env,DB,actors}=await fixture();try{
    const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
    const check=afterRead(DB,sql=>sql.startsWith('SELECT m.* FROM mafia_reports'),()=>deleteUser(env,victim));
    await assert.rejects(mafiaReportReviewEvidence(env,actors.moderator,saved.reportId),e=>e.code==='NOT_FOUND');check();
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM mafia_reports').first()).n,0);
  }finally{DB.close();}
});

test('moderator suspension/session revocation and permission removal during evidence read fail closed',async()=>{
  for(const mutation of ['suspend','revoke','permission']){
    const {env,DB,actors}=await fixture();try{
      const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
      const check=afterRead(DB,sql=>sql.startsWith('SELECT m.* FROM mafia_reports'),async()=>{
        if(mutation==='permission')env.MODERATOR_USER_IDS='';
        else if(mutation==='revoke')await DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now()-1,actors.moderator.sessionId).run();
        else await DB.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at)VALUES(?,?,?,?,?)').bind('moderator','moderator','test',Date.now(),Date.now()).run();
      });
      await assert.rejects(mafiaReportReviewEvidence(env,actors.moderator,saved.reportId),e=>['AUTH','FORBIDDEN'].includes(e.code));check();
    }finally{DB.close();}
  }
});

test('pending deletion hides review evidence; suspended target remains reviewable and reporter suspension cannot write',async()=>{
  const {env,DB,actors}=await fixture();try{
    const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
    await DB.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at)VALUES(?,?,?,?,?)').bind('target','moderator','test',Date.now(),Date.now()).run();
    assert.equal((await mafiaReportReviewEvidence(env,actors.moderator,saved.reportId)).messages.length,1);
    await DB.prepare('INSERT INTO account_deletions(user_id,attempt_id,created_at)VALUES(?,?,?)').bind('target','deleting-target',Date.now()).run();
    await assert.rejects(mafiaReportReviewEvidence(env,actors.moderator,saved.reportId),e=>e.code==='NOT_FOUND');
    await DB.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at)VALUES(?,?,?,?,?)').bind('reporter','moderator','test',Date.now(),Date.now()).run();
    await assert.rejects(saveMafiaReportCase(env,actors.reporter,'123456',input()),e=>e.code==='AUTH');
  }finally{DB.close();}
});

test('deletion during own list source read removes the stale row; review paths cannot redirect credentials',async()=>{
  const {env,DB,actors}=await fixture();try{
    await saveMafiaReportCase(env,actors.reporter,'123456',input());
    const check=afterRead(DB,(sql,method)=>sql.includes('r.rowid AS seq')&&method==='all',()=>deleteUser(env,'target'));
    assert.deepEqual((await ownMafiaReportCases(env,actors.reporter)).reports,[]);check();
  }finally{DB.close();}
  const valid=`/api/moderation/reports/${'a'.repeat(64)}/mafia`;assert.equal(reviewMafiaPath(valid),valid);
  for(const path of [`https://evil.test${valid}`,`//evil.test${valid}`,valid+'?token=x',valid+'/extra',valid.replace('aaaa','../'),null])assert.equal(reviewMafiaPath(path),null);
});

test('review write rechecks deletion, suspension, sessions and privileges after lookup and never reopens reviewed cases',async()=>{
  for(const mutation of ['target-delete','actor-delete','actor-deletion-intent','actor-suspend','actor-revoke','role-revoke']){
    const {env,DB,actors}=await fixture();try{
      const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
      const check=afterRead(DB,sql=>sql==='SELECT id FROM mafia_reports WHERE id=?',async()=>{
        if(mutation==='target-delete')await deleteUser(env,'target');
        if(mutation==='actor-delete')await deleteUser(env,'moderator');
        if(mutation==='actor-deletion-intent')await DB.prepare('INSERT INTO account_deletions(user_id,attempt_id,created_at)VALUES(?,?,?)').bind('moderator','deleting',Date.now()).run();
        if(mutation==='actor-suspend')await DB.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at)VALUES(?,?,?,?,?)').bind('moderator','moderator','test',Date.now(),Date.now()).run();
        if(mutation==='actor-revoke')await DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now()-1,actors.moderator.sessionId).run();
        if(mutation==='role-revoke')env.MODERATOR_USER_IDS='';
      });
      await assert.rejects(performAction(env,actors.moderator,{action:'review_mafia_report',targetId:saved.reportId,clientId:'race-review',reason:'نبدأ مراجعة البلاغ'}),e=>['CONFLICT','FORBIDDEN'].includes(e.code),mutation);check();
      assert.equal((await DB.prepare('SELECT COUNT(*) n FROM moderation_actions').first()).n,0);
    }finally{DB.close();}
  }
  const {env,DB,actors}=await fixture();try{
    const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
    await performAction(env,actors.moderator,{action:'resolve_report',targetId:saved.reportId,clientId:'close-first',reason:'اكتملت المراجعة'});
    await assert.rejects(performAction(env,actors.moderator,{action:'review_mafia_report',targetId:saved.reportId,clientId:'reopen-closed',reason:'محاولة بدء مراجعة لاحقة'}),e=>e.code==='CONFLICT');
    assert.equal((await ownMafiaReportCase(env,actors.reporter,saved.reportId)).status,'reviewed');
  }finally{DB.close();}
});

test('review authorization follows the write-time clock after a delayed source read',async t=>{
  const {env,DB,actors}=await fixture();const started=Date.now();let clock=started;
  t.mock.method(Date,'now',()=>clock);
  try{
    const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
    const check=afterRead(DB,sql=>sql==='SELECT id FROM mafia_reports WHERE id=?',async()=>{
      clock=started+10_000;
      await DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(started+5_000,actors.moderator.sessionId).run();
    });
    await assert.rejects(performAction(env,actors.moderator,{action:'review_mafia_report',targetId:saved.reportId,clientId:'delayed-revoke',reason:'مراجعة بعد تغير الجلسة'},started),e=>e.code==='CONFLICT');check();
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM moderation_actions').first()).n,0);
    assert.equal((await DB.prepare('SELECT review_started_at FROM mafia_reports WHERE id=?').bind(saved.reportId).first()).review_started_at,null);
  }finally{t.mock.restoreAll();DB.close();}
});

test('the database clock rejects an expired moderator session even when request time is stale',async t=>{
  const {env,DB,actors}=await fixture();const current=Date.now();
  try{
    const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
    await DB.prepare('UPDATE sessions SET expires_at=? WHERE id=?').bind(current-10_000,actors.moderator.sessionId).run();
    t.mock.method(Date,'now',()=>current-60_000);
    await assert.rejects(performAction(env,actors.moderator,{action:'review_mafia_report',targetId:saved.reportId,clientId:'stale-clock',reason:'مراجعة بجلسة منتهية'},current-60_000),e=>e.code==='CONFLICT');
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM moderation_actions').first()).n,0);
  }finally{t.mock.restoreAll();DB.close();}
});

test('database millisecond precision rejects exact expiry and revocation deadlines',async t=>{
  for(const column of ['expires_at','revoked_at']){
    const {env,DB,actors}=await fixture();const started=Date.parse('2026-10-30T12:00:00.000Z'),deadline=started+4;
    t.mock.method(Date,'now',()=>started);
    try{
      const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
      await DB.prepare(`UPDATE sessions SET ${column}=? WHERE id=?`).bind(deadline,actors.moderator.sessionId).run();
      DB.database.function('julianday',value=>{assert.equal(value,'now');return 2440587.5+deadline/86400000;});
      await assert.rejects(performAction(env,actors.moderator,{action:'review_mafia_report',targetId:saved.reportId,clientId:'exact-deadline',reason:'مراجعة عند انتهاء صلاحية الجلسة'},started),e=>e.code==='CONFLICT',column);
      assert.equal((await DB.prepare('SELECT COUNT(*) n FROM moderation_actions').first()).n,0);
      assert.equal((await DB.prepare('SELECT review_started_at FROM mafia_reports WHERE id=?').bind(saved.reportId).first()).review_started_at,null);
    }finally{t.mock.restoreAll();DB.close();}
  }
});

test('future session revocation keeps its existing grace period',async()=>{
  const {env,DB,actors}=await fixture();try{
    const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
    await DB.prepare('UPDATE sessions SET revoked_at=? WHERE id=?').bind(Date.now()+60_000,actors.moderator.sessionId).run();
    const result=await performAction(env,actors.moderator,{action:'review_mafia_report',targetId:saved.reportId,clientId:'future-revoke',reason:'مراجعة ضمن مهلة الجلسة'});
    assert.equal(result.ok,true);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM moderation_actions').first()).n,1);
  }finally{DB.close();}
});

test('legacy cases remain readable with unknown perspective, and case retention follows the existing report window',async()=>{
  const {env,DB,actors}=await fixture();try{
    const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
    const raw=evidence();delete raw.perspective;delete raw.messages[0].channel;
    await DB.prepare('UPDATE mafia_reports SET request_hash=NULL,match_id=NULL,evidence=? WHERE id=?').bind(JSON.stringify(raw),saved.reportId).run();
    const legacy=await mafiaReportReviewEvidence(env,actors.moderator,saved.reportId);
    assert.equal(legacy.perspective.scope,'unknown');assert.equal(legacy.messages[0].channel,'unknown');assert.equal(legacy.matchId,7);
    assert.equal(JSON.stringify(legacy).includes('never-save-audio'),false);
    assert.equal(reportRetentionMs(env),365*86_400_000);
    env.SOCIAL_REPORT_RETENTION_DAYS='30';const now=Date.now()+31*86_400_000;
    await cleanup(env,now);await cleanupMafia(env,now,reportRetentionMs(env));
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM mafia_reports').first()).n,0);
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM social_reports').first()).n,0);
    assert.equal((await DB.prepare('SELECT COUNT(*) n FROM users').first()).n,4);
  }finally{DB.close();}
});

test('delete-and-recreate ABA at one timestamp cannot return deleted evidence or acknowledge a changed retry',async t=>{
  const fixed=Date.now();t.mock.method(Date,'now',()=>fixed);
  for(const mode of ['review','retry']){
    const {env,DB,actors}=await fixture();try{
      const saved=await saveMafiaReportCase(env,actors.reporter,'123456',input());
      const source=mode==='review'?sql=>sql.startsWith('SELECT m.* FROM mafia_reports'):sql=>sql.startsWith('SELECT m.id,m.room_code,m.match_id,m.category,m.created_at,m.request_hash');
      const check=afterRead(DB,source,async()=>{
        await deleteUser(env,'target');
        env.ROOMS.get=()=>({fetch:async()=>{const raw=evidence();raw.reportedUserId='other';raw.messages[0].playerId='seat-other';raw.messages[0].text='replacement private message';return Response.json(raw);}});
        const recreated=await saveMafiaReportCase(env,actors.reporter,'123456',{...input(),targetId:'seat-other'});
        assert.equal(recreated.reportId,saved.reportId,'same user/client ID is deliberately reused after deletion');
      });
      await assert.rejects(mode==='review'?mafiaReportReviewEvidence(env,actors.moderator,saved.reportId):saveMafiaReportCase(env,actors.reporter,'123456',input()),e=>e.code===(mode==='review'?'NOT_FOUND':'CONFLICT'));check();
      assert.equal(await DB.prepare('SELECT id FROM users WHERE id=?').bind('target').first(),null);
      const current=await DB.prepare('SELECT * FROM mafia_reports WHERE id=?').bind(saved.reportId).first();assert.equal(current.created_at,fixed);assert.equal(current.reported_id,'other');assert.ok(current.evidence.includes('replacement private message'));
    }finally{DB.close();}
  }
});

test('source case check follows actor lookup, so deletion during that lookup returns no stale own status or successful ACK',async()=>{
  for(const mode of ['list','detail','retry','fresh']){
    const {env,DB,actors}=await fixture();try{
      const saved=mode==='fresh'?null:await saveMafiaReportCase(env,actors.reporter,'123456',input());let actorChecks=0;
      const check=afterRead(DB,sql=>sql.startsWith('SELECT 1 AS ok WHERE')&&++actorChecks===(['retry','fresh'].includes(mode)?2:1),()=>deleteUser(env,'target'));
      if(mode==='list')assert.deepEqual((await ownMafiaReportCases(env,actors.reporter)).reports,[]);
      else await assert.rejects(mode==='detail'?ownMafiaReportCase(env,actors.reporter,saved.reportId):saveMafiaReportCase(env,actors.reporter,'123456',input()),e=>e.code==='NOT_FOUND');
      check();assert.equal((await DB.prepare('SELECT COUNT(*) n FROM mafia_reports').first()).n,0);
    }finally{DB.close();}
  }
});
