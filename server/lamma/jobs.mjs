import { all, first, run, changed } from './common.mjs';
import { deliverPush } from './notifications.mjs';
import { providerRequest } from './provider.mjs';
import { json } from '../protocol.mjs';
export async function drainJobs(env,now=Date.now(),onlyRoom=null) {
  if(!env.DB) return;
  const rows=await all(env,`SELECT * FROM social_jobs WHERE due_at<=? AND lease_until<=? ${onlyRoom?"AND kind IN ('lk_remove','lk_delete') AND json_extract(payload,'$.room')=?":''} ORDER BY CASE kind WHEN 'lk_remove' THEN 0 WHEN 'lk_delete' THEN 1 WHEN 'push' THEN 3 ELSE 2 END,due_at LIMIT 30`,now,now,...(onlyRoom?[onlyRoom]:[]));
  for(const row of rows) {
    const lease=crypto.randomUUID();
    if(!changed(await run(env,'UPDATE social_jobs SET lease_id=?,lease_until=? WHERE id=? AND lease_until<=?',lease,now+60000,row.id,now))) continue;
    let done=false;
    try {
      const p=JSON.parse(row.payload);
      if(row.kind==='push') done=now-row.created_at>86400000 || await deliverPush(env,row)==='done';
      else if(row.kind==='call_expire') { await (await import('./calls.mjs')).sweepCalls(env);done=true; }
      else if(row.kind==='r2_delete') { if(env.SOCIAL_AUDIO&&!await first(env,'SELECT 1 FROM social_report_attachments ra JOIN social_reports r ON r.id=ra.report_id JOIN social_attachments a ON a.id=ra.attachment_id WHERE a.object_key=?',p.key)){await env.SOCIAL_AUDIO.delete(p.key);await run(env,'DELETE FROM social_attachments WHERE object_key=? AND deleted_at IS NOT NULL',p.key);done=true;} }
      else if(row.kind==='lk_remove') {
        // LiveKit rejects nbf strictly before the cutoff; include tokens issued
        // in this same second. Rejoining waits until that cutoff is valid.
        const cutoff=Math.floor(Date.now()/1000)+1;
        await providerRequest(env,'RemoveParticipant',{room:p.room,identity:p.identity,revoke_token_ts:cutoff});
        await run(env,'UPDATE social_call_participants SET revoked_before=MAX(revoked_before,?) WHERE user_id=? AND call_id IN (SELECT id FROM social_calls WHERE room_name=?)',cutoff,p.identity,p.room);
        done=true;
      }
      else if(row.kind==='lk_delete') { await providerRequest(env,'DeleteRoom',{room:p.room});done=true; }
    } catch { /* failure is retained, not logged with device tokens or content */ }
    if(done) await run(env,'DELETE FROM social_jobs WHERE id=? AND lease_id=?',row.id,lease);
    else await run(env,'UPDATE social_jobs SET attempts=attempts+1,due_at=?,lease_until=0,lease_id=NULL WHERE id=? AND lease_id=?',Date.now()+Math.min(3600000,10000*2**Math.min(row.attempts,8)),row.id,lease);
  }
}
export class LammaJobs {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async fetch(){const alarm=await this.ctx.storage.getAlarm();if(!alarm||alarm>Date.now()+1000)await this.ctx.storage.setAlarm(Date.now()+1);return json({ok:true});}
  async alarm(){await drainJobs(this.env);const next=await first(this.env,'SELECT MIN(MAX(due_at,lease_until)) AS at FROM social_jobs');if(next?.at)await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,next.at));}
}
