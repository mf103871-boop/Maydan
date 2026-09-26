import { fail } from '../room-model.mjs';
import { sha256 } from '../protocol.mjs';
import { publicName, imageUrl } from '../profiles/model.mjs';
import { approvedImageSql, isModerator } from './access.mjs';
import { profileAchievementStatements } from '../profiles/db.mjs';

const stmt=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const first=(env,sql,...args)=>stmt(env,sql,...args).first();
const all=async(env,sql,...args)=>(await stmt(env,sql,...args).all()).results||[];
const accountExists=alias=>`EXISTS(SELECT 1 FROM users u WHERE u.id=${alias}) AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=${alias})`;
export function pageOf(params) {
  const before=params.has('before')?Number(params.get('before')):Number.MAX_SAFE_INTEGER;
  const limit=params.has('limit')?Number(params.get('limit')):30;
  if(!Number.isSafeInteger(before)||before<1||!Number.isInteger(limit)||limit<1||limit>50) fail('INVALID',400);
  return {before,limit};
}
function page(rows,limit,key) {
  const more=rows.length>limit;const list=rows.slice(0,limit);
  return {[key]:list,nextBefore:more?list.at(-1).seq:null};
}
export async function reportsOf(env,{before,limit},status='open') {
  if(!['open','resolved'].includes(status)) fail('INVALID',400);
  const rows=await all(env,`SELECT r.*,r.rowid AS seq,d.resolved_at,d.reason AS resolution,u.name,p.bio,p.revision,s.code,
    EXISTS(SELECT 1 FROM moderation_suspensions ms WHERE ms.user_id=r.reported_id) AS suspended,
    CASE WHEN ${approvedImageSql('p','avatar')} THEN p.avatar_version END AS avatar_version,
    CASE WHEN ${approvedImageSql('p','cover')} THEN p.cover_version END AS cover_version
    FROM social_reports r LEFT JOIN moderation_report_decisions d ON d.report_id=r.id
    JOIN users u ON u.id=r.reported_id LEFT JOIN player_profiles p ON p.user_id=r.reported_id
    LEFT JOIN social_profiles s ON s.user_id=r.reported_id
    WHERE r.rowid<? AND d.report_id IS ${status==='open'?'':'NOT '}NULL ORDER BY r.rowid DESC LIMIT ?`,before,limit+1);
  return page(rows.map(r=>({id:r.id,seq:r.seq,reporterId:r.reporter_id,reportedUser:{id:r.reported_id,name:publicName(r.name),
    code:r.code,bio:r.bio||'',revision:r.revision||0,suspended:!!r.suspended,avatarVersion:r.avatar_version,coverVersion:r.cover_version,
    avatarUrl:imageUrl(r.reported_id,'avatar',r.avatar_version),coverUrl:imageUrl(r.reported_id,'cover',r.cover_version)},
    messageSeq:r.message_seq,messageText:r.message_text,reason:r.reason,createdAt:r.created_at,resolvedAt:r.resolved_at,resolution:r.resolution})),limit,'reports');
}
export async function imagesOf(env,{before,limit}) {
  const rows=await all(env,`SELECT r.seq,r.id,r.user_id,r.kind,r.version,r.created_at,u.name,s.code
    FROM moderation_image_reviews r JOIN users u ON u.id=r.user_id LEFT JOIN social_profiles s ON s.user_id=r.user_id
    WHERE r.status='pending' AND r.seq<? AND ${accountExists('r.user_id')} ORDER BY r.seq DESC LIMIT ?`,before,limit+1);
  return page(rows.map(r=>({id:r.id,seq:r.seq,user:{id:r.user_id,name:publicName(r.name),code:r.code},kind:r.kind,
    version:r.version,createdAt:r.created_at,previewUrl:`/api/moderation/images/${r.id}/${r.version}`})),limit,'images');
}
export async function auditOf(env,{before,limit}) {
  const rows=await all(env,`SELECT seq,id,actor_id,action,target_id,subject_user_id,reason,report_id,created_at
    FROM moderation_actions WHERE seq<? ORDER BY seq DESC LIMIT ?`,before,limit+1);
  return page(rows.map(r=>({id:r.id,seq:r.seq,actorId:r.actor_id,action:r.action,targetId:r.target_id,
    subjectUserId:r.subject_user_id,reason:r.reason,reportId:r.report_id,createdAt:r.created_at})),limit,'actions');
}
export const reviewImage=(env,id,version)=>first(env,`SELECT r.data_base64,r.byte_length FROM moderation_image_reviews r
  WHERE r.id=? AND r.version=? AND ${accountExists('r.user_id')}`,id,version);

const ACTIONS=new Set(['resolve_report','remove_message','clear_profile_text','remove_image','suspend_user','restore_user','approve_image','reject_image']);
export function actionOf(body) {
  if(!body || typeof body!=='object' || Array.isArray(body)) fail('INVALID',400);
  const allowed=new Set(['clientId','action','targetId','reason','reportId','field','kind','version','revision']);
  if(Object.keys(body).some(k=>!allowed.has(k)) || !ACTIONS.has(body.action) || !/^[A-Za-z0-9_-]{8,80}$/.test(body.clientId||'')
    || !/^[A-Za-z0-9_-]{1,100}$/.test(body.targetId||'') || typeof body.reason!=='string') fail('INVALID',400);
  const reason=body.reason.trim();
  if(Array.from(reason).length<3 || Array.from(reason).length>500 || /[\u0000-\u0008\u000e-\u001f\u007f]/u.test(reason)) fail('INVALID',400);
  const value={clientId:body.clientId,action:body.action,targetId:body.targetId,reason};
  if(body.reportId!==undefined){if(!/^[A-Za-z0-9_-]{1,100}$/.test(body.reportId))fail('INVALID',400);value.reportId=body.reportId;}
  if(body.action==='clear_profile_text') {
    if(!['name','bio','all'].includes(body.field)||!Number.isSafeInteger(body.revision)||body.revision<0)fail('INVALID',400);
    value.field=body.field;value.revision=body.revision;
  } else if(body.field!==undefined||body.revision!==undefined) fail('INVALID',400);
  if(body.action==='remove_image') {if(!['avatar','cover'].includes(body.kind))fail('INVALID',400);value.kind=body.kind;}
  else if(body.kind!==undefined)fail('INVALID',400);
  if(['remove_image','approve_image','reject_image'].includes(body.action)) {
    if(!/^[a-f0-9]{64}$/.test(body.version||''))fail('INVALID',400);value.version=body.version;
  } else if(body.version!==undefined)fail('INVALID',400);
  if(body.action==='remove_message' && (!/^[1-9]\d*$/.test(body.targetId)||!Number.isSafeInteger(Number(body.targetId)))) fail('INVALID',400);
  return value;
}
export async function performAction(env,actor,body,now=Date.now()) {
  if(!isModerator(env,actor.userId))fail('FORBIDDEN',403);
  const input=actionOf(body);const hash=await sha256(JSON.stringify(input));
  const prior=await first(env,'SELECT id,request_hash FROM moderation_actions WHERE actor_id=? AND client_id=?',actor.userId,input.clientId);
  if(prior){if(prior.request_hash!==hash)fail('CONFLICT',409);return {ok:true,actionId:prior.id};}
  const {action,targetId,reason,reportId}=input;let subject=targetId;let guard;let args=[];let snapshot='NULL';let related=[];let image;
  if(action==='resolve_report') {
    const report=await first(env,'SELECT reported_id FROM social_reports WHERE id=?',targetId);if(!report)fail('NOT_FOUND',404);
    subject=report.reported_id;guard='EXISTS(SELECT 1 FROM social_reports WHERE id=?)';args=[targetId];
  } else if(action==='remove_message') {
    const message=await first(env,`SELECT m.sender_id,c.user_low,c.user_high FROM social_messages m JOIN social_conversations c ON c.id=m.conversation_id WHERE m.seq=?`,Number(targetId));
    if(!message)fail('NOT_FOUND',404);subject=message.sender_id;related=[message.user_low,message.user_high];
    guard='EXISTS(SELECT 1 FROM social_messages WHERE seq=? AND deleted_at IS NULL)';args=[Number(targetId)];
    snapshot=`(SELECT json_object('text',text,'conversationId',conversation_id) FROM social_messages WHERE seq=${Number(targetId)})`;
  } else if(['approve_image','reject_image'].includes(action)) {
    image=await first(env,'SELECT user_id,kind FROM moderation_image_reviews WHERE id=? AND version=? AND status=\'pending\'',targetId,input.version);
    if(!image)fail('CONFLICT',409);subject=image.user_id;
    guard="EXISTS(SELECT 1 FROM moderation_image_reviews WHERE id=? AND version=? AND status='pending')";args=[targetId,input.version];
  } else {
    if(!await first(env,`SELECT id FROM users WHERE id=? AND ${accountExists('users.id')}`,subject))fail('NOT_FOUND',404);
    if(action==='suspend_user' && isModerator(env,subject))fail('FORBIDDEN',403);
    if(action==='clear_profile_text') {
      guard='EXISTS(SELECT 1 FROM player_profiles WHERE user_id=? AND revision=?)';args=[subject,input.revision];
      snapshot="(SELECT json_object('name',u.name,'bio',p.bio) FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.id=?)";
    } else if(action==='remove_image') {
      guard='EXISTS(SELECT 1 FROM moderation_image_approvals WHERE user_id=? AND kind=? AND version=? AND hidden_at IS NULL)';args=[subject,input.kind,input.version];
    } else {guard='1';}
  }
  const id=crypto.randomUUID();const newAction='EXISTS(SELECT 1 FROM moderation_actions WHERE id=?)';
  const snapshotArgs=action==='clear_profile_text'?[subject]:[];
  const sqlGuard=`${guard} AND ${accountExists('?')}
    AND EXISTS(SELECT 1 FROM sessions s WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND (s.revoked_at IS NULL OR s.revoked_at>?))
    AND NOT EXISTS(SELECT 1 FROM moderation_suspensions WHERE user_id=?)
    ${reportId?'AND EXISTS(SELECT 1 FROM social_reports WHERE id=? AND reported_id=?)':''}`;
  const statements=[stmt(env,`INSERT OR IGNORE INTO moderation_actions(id,actor_id,client_id,request_hash,action,target_id,subject_user_id,reason,report_id,snapshot_json,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,${snapshot},? WHERE ${sqlGuard}`,
    id,actor.userId,input.clientId,hash,action,targetId,subject,reason,reportId||null,...snapshotArgs,now,
    ...args,subject,subject,actor.sessionId,actor.userId,now,now,actor.userId,...(reportId?[reportId,subject]:[]))];
  const run=(sql,...values)=>statements.push(stmt(env,sql,...values,id));
  if(action==='remove_message')run(`UPDATE social_messages SET deleted_at=?,edited_at=? WHERE seq=? AND ${newAction}`,now,now,Number(targetId));
  if(action==='clear_profile_text') {
    if(['name','all'].includes(input.field))run(`UPDATE users SET name='لاعب ميدان',updated_at=? WHERE id=? AND ${newAction}`,now,subject);
    if(['bio','all'].includes(input.field))run(`UPDATE player_profiles SET bio='' WHERE user_id=? AND ${newAction}`,subject);
  }
  if(action==='remove_image')run(`UPDATE moderation_image_approvals SET hidden_at=?,reason=? WHERE user_id=? AND kind=? AND version=? AND ${newAction}`,now,reason,subject,input.kind,input.version);
  if(action==='suspend_user') {
    run(`INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at) SELECT ?,?,?,?,? WHERE ${newAction}
      ON CONFLICT(user_id) DO UPDATE SET actor_id=excluded.actor_id,reason=excluded.reason,updated_at=excluded.updated_at`,subject,actor.userId,reason,now,now);
    run(`UPDATE sessions SET revoked_at=? WHERE user_id=? AND ${newAction}`,now,subject);
    run(`DELETE FROM auth_codes WHERE user_id=? AND ${newAction}`,subject);
    run(`UPDATE social_profiles SET online_until=0 WHERE user_id=? AND ${newAction}`,subject);
  }
  if(action==='restore_user')run(`DELETE FROM moderation_suspensions WHERE user_id=? AND ${newAction}`,subject);
  if(action==='reject_image')run(`UPDATE moderation_image_reviews SET status='rejected',reviewed_at=?,reviewer_id=?,note=? WHERE id=? AND version=? AND ${newAction}`,now,actor.userId,reason,targetId,input.version);
  if(action==='approve_image') {
    run(`INSERT INTO player_images(user_id,kind,version,data_base64,width,height,byte_length,updated_at)
      SELECT user_id,kind,version,data_base64,width,height,byte_length,? FROM moderation_image_reviews WHERE id=? AND version=? AND ${newAction}
      ON CONFLICT(user_id,kind) DO UPDATE SET version=excluded.version,data_base64=excluded.data_base64,width=excluded.width,height=excluded.height,byte_length=excluded.byte_length,updated_at=excluded.updated_at`,now,targetId,input.version);
    run(`INSERT INTO moderation_image_approvals(user_id,kind,version,approved_at,moderator_id)
      SELECT ?,?,?,?,? WHERE ${newAction} ON CONFLICT(user_id,kind) DO UPDATE SET version=excluded.version,approved_at=excluded.approved_at,moderator_id=excluded.moderator_id,hidden_at=NULL,reason=NULL`,subject,image.kind,input.version,now,actor.userId);
    run(`UPDATE player_profiles SET ${image.kind}_version=? WHERE user_id=? AND ${newAction}`,input.version,subject);
    run(`DELETE FROM moderation_image_reviews WHERE id=? AND version=? AND ${newAction}`,targetId,input.version);
  }
  if(action!=='resolve_report')run(`UPDATE player_profiles SET revision=revision+1,updated_at=? WHERE user_id=? AND ${newAction}`,now,subject);
  const resolvedReport=action==='resolve_report'?targetId:reportId;
  if(resolvedReport)run(`INSERT INTO moderation_report_decisions(report_id,action_id,actor_id,reason,resolved_at)
    SELECT ?,?,?,?,? WHERE ${newAction} ON CONFLICT(report_id) DO UPDATE SET action_id=excluded.action_id,actor_id=excluded.actor_id,reason=excluded.reason,resolved_at=excluded.resolved_at`,resolvedReport,id,actor.userId,reason,now);
  if(action==='approve_image')statements.push(...profileAchievementStatements(env,subject,now));
  await env.DB.batch(statements);
  const saved=await first(env,'SELECT id,request_hash FROM moderation_actions WHERE actor_id=? AND client_id=?',actor.userId,input.clientId);
  if(!saved || saved.request_hash!==hash)fail('CONFLICT',409);
  return {ok:true,actionId:saved.id,subjectUserId:subject,relatedUsers:related,action};
}
export function moderationDeleteStatements(env,userId) {
  return [stmt(env,'DELETE FROM moderation_report_decisions WHERE report_id IN (SELECT id FROM social_reports WHERE reporter_id=? OR reported_id=?)',userId,userId),
    stmt(env,'DELETE FROM moderation_actions WHERE actor_id=? OR subject_user_id=? OR report_id IN (SELECT id FROM social_reports WHERE reporter_id=? OR reported_id=?)',userId,userId,userId,userId),
    stmt(env,'DELETE FROM moderation_suspensions WHERE user_id=? OR actor_id=?',userId,userId)];
}
