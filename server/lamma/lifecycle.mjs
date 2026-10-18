import { all,run,stmt,ident,live } from './common.mjs';
import { job,wakeJobs } from './notifications.mjs';
import { sweepCalls,revokeInvalidCalls } from './calls.mjs';
export function lammaDeleteStatements(env,id,now=Date.now()){
  const u=ident(id), direct=`SELECT id FROM social_conversations WHERE user_low=${u} OR user_high=${u}`;
  return [
    stmt(env,'DELETE FROM social_report_attachments WHERE report_id IN (SELECT id FROM social_reports WHERE reporter_id=? OR reported_id=?)',id,id),
    stmt(env,`INSERT OR IGNORE INTO social_jobs(id,kind,payload,created_at,due_at) SELECT 'audio-'||id,'r2_delete',json_object('key',object_key),?,? FROM social_attachments WHERE user_id=${u} OR (scope='direct' AND conversation_id IN (${direct}))`,now,now),
    stmt(env,`DELETE FROM social_attachments WHERE user_id=${u} OR (scope='direct' AND conversation_id IN (${direct}))`),
    stmt(env,`INSERT OR IGNORE INTO social_jobs(id,kind,payload,created_at,due_at) SELECT 'lk-remove-delete-'||c.id||'-'||p.user_id,'lk_remove',json_object('room',c.room_name,'identity',p.user_id),?,? FROM social_calls c JOIN social_call_participants p ON p.call_id=c.id WHERE p.user_id=${u} AND p.state='active'`,now,now),
    stmt(env,`INSERT OR IGNORE INTO social_jobs(id,kind,payload,created_at,due_at) SELECT 'lk-remove-deleted-direct-'||c.id||'-'||p.user_id,'lk_remove',json_object('room',c.room_name,'identity',p.user_id),?,? FROM social_calls c JOIN social_call_participants p ON p.call_id=c.id WHERE c.scope='direct' AND c.conversation_id IN (${direct})`,now,now),
    stmt(env,`UPDATE social_call_participants SET state='left',left_at=? WHERE user_id=${u}`,now),
    stmt(env,`INSERT OR IGNORE INTO social_jobs(id,kind,payload,created_at,due_at) SELECT 'lk-delete-'||id,'lk_delete',json_object('room',room_name),?,? FROM social_calls WHERE scope='direct' AND conversation_id IN (${direct})`,now,now),
    stmt(env,`DELETE FROM social_call_participants WHERE user_id=${u} OR call_id IN (SELECT id FROM social_calls WHERE scope='direct' AND conversation_id IN (${direct}))`),
    stmt(env,`DELETE FROM social_calls WHERE scope='direct' AND conversation_id IN (${direct})`),
    stmt(env,"UPDATE social_calls SET initiator_id='deleted' WHERE initiator_id=?",id),
    stmt(env,`UPDATE social_groups SET owner_id=COALESCE((SELECT x.user_id FROM social_group_members x WHERE x.group_id=social_groups.id AND x.user_id!=${u} AND x.left_at IS NULL AND ${live('x.user_id')} ORDER BY CASE WHEN x.role='admin' THEN 0 ELSE 1 END,x.joined_at,x.user_id LIMIT 1),owner_id) WHERE owner_id=${u}`),
    stmt(env,`UPDATE social_group_members SET role='owner' WHERE user_id!=${u} AND left_at IS NULL AND user_id=(SELECT owner_id FROM social_groups WHERE id=group_id)`),
    stmt(env,'DELETE FROM social_group_members WHERE user_id=?',id),
    stmt(env,'UPDATE social_groups SET closed_at=? WHERE closed_at IS NULL AND NOT EXISTS(SELECT 1 FROM social_group_members WHERE group_id=social_groups.id AND left_at IS NULL)',now),
    stmt(env,"UPDATE social_group_messages SET text='',attachment_id=NULL,room_invite_id=NULL,sender_id='deleted',deleted_at=? WHERE sender_id=?",now,id),
    ...['social_group_invites','social_group_reports'].map(table=>stmt(env,`DELETE FROM ${table} WHERE ${table==='social_group_invites'?'user_id=? OR inviter_id=?':'reporter_id=? OR reported_id=?'}`,id,id)),
    ...['social_devices','social_preferences','social_mutes','social_room_invite_responses'].map(table=>stmt(env,`DELETE FROM ${table} WHERE user_id=?`,id)),
    stmt(env,'DELETE FROM social_jobs WHERE user_id=?',id),
    stmt(env,'DELETE FROM social_room_invites WHERE inviter_id=?',id),
  ];
}
export async function cleanupLamma(env,now=Date.now(),retentionMs=365*86400000,reportRetentionMs=365*86400000){if(!env.DB)return;await sweepCalls(env,now);await revokeInvalidCalls(env);
  await env.DB.batch([stmt(env,'UPDATE social_attachments SET deleted_at=COALESCE(deleted_at,?) WHERE created_at<? OR (message_seq IS NULL AND created_at<?)',now,now-retentionMs,now-86400000),stmt(env,'DELETE FROM social_group_messages WHERE created_at<?',now-retentionMs),stmt(env,'DELETE FROM social_group_reports WHERE created_at<?',now-reportRetentionMs),stmt(env,"UPDATE social_group_invites SET status='cancelled' WHERE status='pending' AND expires_at<?",now),stmt(env,'DELETE FROM social_room_invites WHERE expires_at<?',now-86400000),stmt(env,'DELETE FROM social_room_invite_responses WHERE NOT EXISTS(SELECT 1 FROM social_room_invites i WHERE i.id=invite_id)'),stmt(env,'DELETE FROM social_devices WHERE NOT EXISTS(SELECT 1 FROM sessions s WHERE s.id=session_id AND s.user_id=social_devices.user_id AND s.expires_at>? AND (s.revoked_at IS NULL OR s.revoked_at>?))',now,now)]);
  const audio=await all(env,'SELECT * FROM social_attachments WHERE deleted_at IS NOT NULL LIMIT 200');if(audio.length)await env.DB.batch(audio.map(a=>job(env,`audio-${a.id}`,'r2_delete',{key:a.object_key})));
  await run(env,'DELETE FROM social_report_attachments WHERE NOT EXISTS(SELECT 1 FROM social_reports r WHERE r.id=report_id)');
  await run(env,'DELETE FROM social_attachments WHERE deleted_at<? AND NOT EXISTS(SELECT 1 FROM social_jobs j WHERE j.id=\'audio-\'||social_attachments.id)',now-86400000);await wakeJobs(env);
}
