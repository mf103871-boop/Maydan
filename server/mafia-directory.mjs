import { all, first, run } from './lamma/common.mjs';
import { fail } from './room-model.mjs';
export const DIRECTORY_KEY='mafia:directory:ar';
export const directoryStatus=room=>room.phase==='lobby'?'waiting':['over','closed'].includes(room.phase)?'finished':'playing';
export function directoryFilters(input={}) {
  const value={community:input.community||'ar',mode:input.mode||'all',voice:input.voice||'all',status:input.status||'all'};
  if(value.community!=='ar'||!['all','classic','shadow'].includes(value.mode)||!['all','optional','off'].includes(value.voice)||!['all','waiting','playing','finished'].includes(value.status))fail('INVALID');
  return value;
}
const filterKey=filters=>JSON.stringify(filters);
function decodeCursor(cursor,filters,userId,now){if(!cursor)return null;try{const c=JSON.parse(atob(cursor));if(c.v!==1||c.filters!==filterKey(filters)||c.owner!==userId||!Number.isSafeInteger(c.at)||now-c.at>120000||c.at>now||!Number.isSafeInteger(c.createdAt)||!/^\d{6}$/.test(c.code))throw Error();return c;}catch{fail('INVALID_CURSOR',400);}}
export async function listMafiaDirectory(env,userId,input={},now=Date.now(),{joinable=false}={}) {
  const filters=directoryFilters(input),cursor=decodeCursor(input.cursor,filters,userId,now),limit=20;
  const clauses=['r.expires_at>?','r.community=?'],values=[now,'ar'];
  if(joinable)clauses.push("r.status='waiting' AND r.players<r.capacity");
  for(const [field,column]of [['mode','mode'],['voice','voice_mode'],['status','status']])if(filters[field]!=='all'){clauses.push(`r.${column}=?`);values.push(filters[field]);}
  if(cursor){clauses.push('(r.created_at>? OR (r.created_at=? AND r.room_code>?))');values.push(cursor.createdAt,cursor.createdAt,cursor.code);}
  // The index is advisory. Include observer memberships in the same block test;
  // admission repeats it under the room's serial authority.
  clauses.push(`NOT EXISTS(SELECT 1 FROM (SELECT user_id FROM mafia_seats WHERE room_key=r.room_key AND expires_at>? UNION SELECT user_id FROM mafia_observer_memberships WHERE room_key=r.room_key AND expires_at>?) p JOIN social_blocks b ON (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocked_id=? AND b.blocker_id=p.user_id))`);
  values.push(now,now,userId,userId);
  const rows=await all(env,`SELECT room_code AS code,'mafia' AS game,mode,capacity,players,ready,host_name AS hostName,expires_at AS expiresAt,status,room_name AS roomName,community,voice_mode AS voiceMode,spectators,settings_revision AS settingsRevision,protocol,created_at AS createdAt,updated_at AS updatedAt FROM mafia_public_rooms r WHERE ${clauses.join(' AND ')} ORDER BY created_at,room_code LIMIT ?`,...values,limit+1);
  const more=rows.length>limit,rooms=rows.slice(0,limit).map(row=>({...row,full:row.players>=row.capacity})),last=rooms.at(-1);
  return {rooms,nextCursor:more?btoa(JSON.stringify({v:1,filters:filterKey(filters),owner:userId,at:cursor?.at||now,createdAt:last.createdAt,code:last.code})):null,serverNow:now};
}
export async function updateMafiaDirectory(env,room,now=Date.now()) {
  const members=room.members.filter(m=>!m.left),before=await first(env,'SELECT * FROM mafia_public_rooms WHERE room_key=?',room.mafiaKey);
  const visible=room.phase!=='closed'&&room.settings.visibility==='public'&&members.length>0;
  let changed=false;
  if(!visible){if(before){await run(env,'DELETE FROM mafia_public_rooms WHERE room_key=?',room.mafiaKey);changed=true;}}
  else {
    const host=members.find(m=>m.id===room.hostId),row={mode:room.settings.mode,capacity:room.settings.capacity,players:members.length,ready:members.filter(m=>m.ready).length,host_name:host?.name||'مضيف ميدان',status:directoryStatus(room),room_name:room.settings.roomName||`مجلس ${host?.name||'ميدان'}`,community:'ar',voice_mode:room.settings.voiceMode||'optional',spectators:Object.values(room.observers||{}).filter(o=>o.expiresAt>now).length,settings_revision:room.settingsRevision||0,protocol:room.protocol||1};
    changed=!before||Object.entries(row).some(([key,value])=>before[key]!==value);
    const keys=Object.keys(row);
    await run(env,`INSERT INTO mafia_public_rooms(room_key,room_code,${keys.join(',')},created_at,expires_at,updated_at) VALUES(${Array(keys.length+5).fill('?').join(',')}) ON CONFLICT(room_key) DO UPDATE SET ${keys.map(k=>`${k}=excluded.${k}`).join(',')},expires_at=excluded.expires_at,updated_at=excluded.updated_at`,room.mafiaKey,room.code,...Object.values(row),room.createdAt,Math.min(room.expiresAt,now+90000),changed?now:before.updated_at);
  }
  // Discovery notifications are advisory; the authenticated 15-second refetch
  // remains authoritative when this lightweight fanout object is unavailable.
  if(changed&&env.ROOMS){try{await env.ROOMS.get(env.ROOMS.idFromName(DIRECTORY_KEY)).fetch(new Request('https://internal/mafia-directory-invalidate',{method:'POST'}));}catch{/* polling fallback */}}
}
