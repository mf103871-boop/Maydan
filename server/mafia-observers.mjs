import { publicSnapshot } from './mafia-model.mjs';
import { fail } from './room-model.mjs';
import { all,first,run,stmt } from './lamma/common.mjs';
import { liveAccountSql } from './moderation/access.mjs';
export const OBSERVER_DELAY=30000,OBSERVER_CAP=16,OBSERVER_LEASE=180000;
const STORAGE_CHUNK=128*1024;
const STREAM_LIMIT=4*1024*1024,encodedSize=value=>new TextEncoder().encode(JSON.stringify(value)).length;
export async function loadObserverStream(storage){const manifest=await storage.get('mafia:observer-stream');if(!manifest)return {stream:null,chunks:0};if(!Number.isInteger(manifest.chunks))return {stream:manifest,chunks:0};const parts=await Promise.all(Array.from({length:manifest.chunks},(_,i)=>storage.get(`mafia:observer:${i}`)));const size=parts.reduce((n,p)=>n+p.length,0),bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return {stream:JSON.parse(new TextDecoder().decode(bytes)),chunks:manifest.chunks};}
export async function saveObserverStream(storage,stream,previousChunks=0){const bytes=new TextEncoder().encode(JSON.stringify(stream)),chunks=Math.ceil(bytes.length/STORAGE_CHUNK);for(let i=0;i<chunks;i++)await storage.put(`mafia:observer:${i}`,bytes.slice(i*STORAGE_CHUNK,(i+1)*STORAGE_CHUNK));for(let i=chunks;i<previousChunks;i++)await storage.put(`mafia:observer:${i}`,null);await storage.put('mafia:observer-stream',{schemaVersion:2,chunks});return chunks;}
const clone=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function reportSubjects(room){const excluded=new Set(room.mafiaEvidenceExcludedSeats||[]);return Object.fromEntries(room.members.filter(m=>m.accountUserId&&!excluded.has(m.id)).map(m=>[m.id,m.accountUserId]));}
function subjectMaps(stream){return [stream?.latestSubjects,stream?.visibleSubjects,...(stream?.pending||[]).map(e=>e.subjects),...Object.values(stream?.endBuffers||{}).map(e=>e.subjects)].filter(Boolean);}
export function observerEvidenceAccounts(stream){return [...new Set(subjectMaps(stream).flatMap(map=>Object.values(map)))];}
export function dropObserverEvidenceAccounts(previous,accountIds){
  const removed=new Set(accountIds);if(!previous||!observerEvidenceAccounts(previous).some(id=>removed.has(id)))return previous;
  const stream=clone(previous);for(const map of subjectMaps(stream))for(const [seatId,accountId]of Object.entries(map))if(removed.has(accountId))delete map[seatId];
  stream.sizeBytes=encodedSize(stream)+32;return stream;
}
function arrayPatch(before,after){let drop=0;while(drop<before.length&&before[drop]?.id!==after[0]?.id)drop++;const kept=before.slice(drop);if(kept.every((item,i)=>same(item,after[i])))return {drop,add:after.slice(kept.length)};return {drop:before.length,add:after};}
function diff(before,after){const set={},arrays={};for(const [key,value]of Object.entries(after)){if(key==='log') {if(!same(before?.log||[],value))arrays.log=arrayPatch(before?.log||[],value);}else if(key==='chats'){if(!same(before?.chats?.public||[],value.public))arrays.chat=arrayPatch(before?.chats?.public||[],value.public);}else if(!same(before?.[key],value))set[key]=value;}return {set,arrays};}
function apply(view,patch){const result={...(view||{}),...clone(patch.set)};for(const [key,p]of Object.entries(patch.arrays)){if(key==='log')result.log=[...(result.log||[]).slice(p.drop),...clone(p.add)];else result.chats={public:[...(result.chats?.public||[]).slice(p.drop),...clone(p.add)],team:[],observers:[]};}return result;}
export function advanceObserverStream(previous,room,now=Date.now()) {
  const next=room?publicSnapshot(room):null,patch=next?diff(previous?.latest,next):null,changed=patch&&(Object.keys(patch.set).length||Object.keys(patch.arrays).length);
  const initializeSubjects=room&&previous?.subjectsVersion!==1;
  if(previous?.schemaVersion===2&&previous.sizeBytes<=STREAM_LIMIT&&Object.keys(previous.endBuffers||{}).length<=4&&Object.keys(previous.ends||{}).length<=8&&!initializeSubjects&&!changed&&!(previous.pending[0]?.releaseAt<=now))return previous;
  const stream=clone(previous||{schemaVersion:2,seq:0,visible:null,visibleAt:null,latest:null,pending:[],ends:{},endBuffers:{}});stream.schemaVersion=2;
  stream.endBuffers||={};
  // Account identifiers belong only to this private evidence checkpoint. They
  // are never included in a public patch, observer response or completed replay.
  if(initializeSubjects){const subjects=reportSubjects(room);stream.subjectsVersion=1;stream.latestSubjects=clone(subjects);stream.visibleSubjects=clone(subjects);for(const event of [...stream.pending,...Object.values(stream.endBuffers)])event.subjects=clone(subjects);}
  for(const key of Object.keys(stream.endBuffers).sort((a,b)=>Number(b)-Number(a)).slice(4))delete stream.endBuffers[key];
  for(const key of Object.keys(stream.ends).sort((a,b)=>Number(b)-Number(a)).slice(8))delete stream.ends[key];
  while(stream.pending[0]?.releaseAt<=now){const event=stream.pending.shift();stream.visible=apply(stream.visible,event.patch);if(event.subjects)stream.visibleSubjects=clone(event.subjects);stream.visibleAt=event.at;stream.visibleSeq=event.seq;}
  if(changed){const subjects=reportSubjects(room),event={seq:++stream.seq,at:now,releaseAt:now+OBSERVER_DELAY,patch};if(!same(stream.latestSubjects,subjects))event.subjects=clone(subjects);stream.pending.push(event);stream.latest=next;stream.latestSubjects=subjects;if(['over','closed'].includes(room.phase)&&room.outcome&&!stream.ends[room.matchId]){stream.ends[room.matchId]=event.releaseAt;stream.endBuffers[room.matchId]={view:next,subjects:clone(subjects),at:now,releaseAt:event.releaseAt};const ids=Object.keys(stream.endBuffers);for(const old of ids.slice(0,-4))delete stream.endBuffers[old];}}
  const retained=new Set(Object.keys(stream.endBuffers));for(const key of Object.keys(stream.ends))if(!retained.has(key)&&Number(key)<(room?.matchId||0)-4)delete stream.ends[key];
  // Storage uses 128KiB UTF-8 chunks, not one oversized DO value. Under abnormal
  // backlog spectators resynchronize from a fresh, fully delayed checkpoint;
  // this never aborts a live match or exposes a newer-than-30-second projection.
  if(stream.pending.length>4096||encodedSize(stream)>STREAM_LIMIT){let checkpoint=room?publicSnapshot(room):stream.latest;if(checkpoint&&encodedSize(checkpoint)>1024*1024)checkpoint=null;stream.visible=null;stream.visibleAt=null;stream.visibleSubjects={};stream.latest=checkpoint;stream.pending=checkpoint?[{seq:++stream.seq,at:now,releaseAt:now+OBSERVER_DELAY,patch:diff(null,checkpoint),subjects:clone(stream.latestSubjects||{})}]:[];stream.resynchronizedAt=now;for(const key of Object.keys(stream.endBuffers).sort((a,b)=>Number(a)-Number(b))){if(encodedSize(stream)<=STREAM_LIMIT)break;delete stream.endBuffers[key];}}
  stream.sizeBytes=encodedSize(stream)+32;
  return stream;
}
export const observerNextAlarm=stream=>stream?.pending?.[0]?.releaseAt??Infinity;
export function observerEvidenceAccount(stream,targetId,now=Date.now()){
  const delayed=stream?.visible,ending=delayed?.phase==='lobby'?stream?.endBuffers?.[delayed.matchId]:null;
  const releasedEnding=ending?.releaseAt<=now,view=releasedEnding?ending.view:delayed,subjects=releasedEnding?ending.subjects:stream?.visibleSubjects;
  return view?.members?.some(m=>m.id===targetId)?subjects?.[targetId]||null:null;
}
export function observerCanPromote(room,stream,observer,now=Date.now()) {
  if(room.phase!=='lobby'||room.members.filter(m=>!m.left).length>=room.settings.capacity)return false;
  const match=Math.max(observer.matchAtJoin||0,room.matchId||0);
  return match===0?Boolean(stream?.visible):Boolean(stream?.ends?.[match]&&stream.ends[match]<=now);
}
export function observerView(room,stream,observer,now=Date.now()) {
  const delayed=stream?.visible,ending=delayed?.phase==='lobby'?stream?.endBuffers?.[delayed.matchId]:null;
  const visible=ending?.releaseAt<=now?ending.view:stream?.visible;
  // This is only a delayed offer. The promotion POST rechecks the live room.
  // A live boolean/revision here would itself reveal a new phase or roster early.
  const offer=Boolean(delayed&&observerCanPromote(delayed,stream,{...observer,matchAtJoin:delayed.matchId||0},now));
  const state=visible?clone(visible):{protocol:room.protocol||2,game:'mafia',code:room.code,phase:'waiting',matchId:0,round:null,deadlineAt:null,members:[],participants:[],log:[],chats:{public:[],team:[],observers:[]},outcome:null,replay:null};
  if(state.deadlineAt!=null)state.deadlineAt+=OBSERVER_DELAY;
  return {...state,scope:'observer',delayed:true,delayMs:OBSERVER_DELAY,you:null,serverNow:now,revision:stream?.visibleSeq||0,
    observer:{id:observer.id,delayMs:OBSERVER_DELAY,viewTime:ending?.releaseAt<=now?ending.at:stream?.visibleAt??null,canPromote:offer,...(offer?{promotionSettingsRevision:delayed.settingsRevision||0}:{}),completedMatches:Object.values(stream?.endBuffers||{}).filter(e=>e.releaseAt<=now).map(e=>({matchId:e.view.matchId,outcome:e.view.outcome,replay:e.view.replay}))},
    mafiaVoice:{available:false,callId:null,quiet:true,canPublish:false}};
}
export async function assertObserverAdmission(env,room,userId,now=Date.now()) {
  if(room.settings.visibility!=='public')fail('OBSERVER_PRIVATE',403);
  if(!await first(env,`SELECT 1 WHERE ${liveAccountSql('?')}`,userId,userId))fail('AUTH',401);
  const peers=[...room.members.filter(m=>!m.left).map(m=>m.accountUserId),...Object.values(room.observers||{}).filter(o=>o.expiresAt>now).map(o=>o.accountUserId)].filter(id=>id&&id!==userId);
  if(peers.length&&await first(env,`SELECT 1 FROM social_blocks WHERE (blocker_id=? AND blocked_id IN (${peers.map(()=>'?')})) OR (blocked_id=? AND blocker_id IN (${peers.map(()=>'?')})) LIMIT 1`,userId,...peers,userId,...peers))fail('MAFIA_BLOCKED',409);
}
export async function claimObserver(env,room,observer,now=Date.now()) {
  await assertObserverAdmission(env,room,observer.accountUserId,now);
  const free=`NOT EXISTS(SELECT 1 FROM mafia_seats WHERE user_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM mafia_media_leases WHERE user_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM mafia_match_leases WHERE user_id=? AND expires_at>?) AND ${liveAccountSql('?')}`;
  await run(env,`INSERT INTO mafia_observer_memberships(user_id,room_key,room_code,observer_id,joined_at,expires_at) SELECT ?,?,?,?,?,? WHERE ${free} ON CONFLICT(user_id) DO UPDATE SET room_key=excluded.room_key,room_code=excluded.room_code,observer_id=excluded.observer_id,joined_at=excluded.joined_at,expires_at=excluded.expires_at WHERE mafia_observer_memberships.expires_at<=? OR (mafia_observer_memberships.room_key=excluded.room_key AND mafia_observer_memberships.observer_id=excluded.observer_id)`,observer.accountUserId,room.mafiaKey,room.code,observer.id,observer.joinedAt,now+OBSERVER_LEASE,...[observer.accountUserId,now,observer.accountUserId,now,observer.accountUserId,now,observer.accountUserId,observer.accountUserId],now);
  if(!await first(env,'SELECT 1 FROM mafia_observer_memberships WHERE user_id=? AND room_key=? AND observer_id=? AND expires_at>?',observer.accountUserId,room.mafiaKey,observer.id,now))fail('MAFIA_ACTIVE_ELSEWHERE',409);
}
export async function releaseObserver(env,room,observer){await run(env,'DELETE FROM mafia_observer_memberships WHERE user_id=? AND room_key=? AND observer_id=?',observer.accountUserId,room.mafiaKey,observer.id);}
export async function promoteObserverClaim(env,room,observer,seat,now=Date.now()) {
  await assertObserverAdmission(env,room,observer.accountUserId,now);
  // Reserve the seat before releasing observer ownership, in one D1 transaction.
  // A lost DO commit is recovered only by retrying these exact fresh credentials.
  await env.DB.batch([
    stmt(env,`INSERT INTO mafia_seats(user_id,room_key,room_code,seat_id,expires_at,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM mafia_observer_memberships WHERE user_id=? AND room_key=? AND observer_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM mafia_match_leases WHERE user_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM mafia_media_leases WHERE user_id=? AND expires_at>?) AND ${liveAccountSql('?')} ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at,updated_at=excluded.updated_at WHERE mafia_seats.room_key=excluded.room_key AND mafia_seats.seat_id=excluded.seat_id`,observer.accountUserId,room.mafiaKey,room.code,seat.id,now+OBSERVER_LEASE,now,observer.accountUserId,room.mafiaKey,observer.id,now,observer.accountUserId,now,observer.accountUserId,now,observer.accountUserId,observer.accountUserId),
    stmt(env,'DELETE FROM mafia_observer_memberships WHERE user_id=? AND room_key=? AND observer_id=? AND EXISTS(SELECT 1 FROM mafia_seats WHERE user_id=? AND room_key=? AND seat_id=? AND expires_at>?)',observer.accountUserId,room.mafiaKey,observer.id,observer.accountUserId,room.mafiaKey,seat.id,now),
  ]);
  if(!await first(env,'SELECT 1 FROM mafia_seats WHERE user_id=? AND room_key=? AND seat_id=? AND expires_at>?',observer.accountUserId,room.mafiaKey,seat.id,now))fail('MAFIA_ACTIVE_ELSEWHERE',409);
}
export async function observerAuthorizations(env,room,observers,now=Date.now()) {
  if(!observers.length)return [];
  return all(env,`SELECT o.observer_id FROM mafia_observer_memberships o JOIN sessions s ON s.user_id=o.user_id WHERE o.room_key=? AND o.expires_at>? AND s.expires_at>? AND (s.revoked_at IS NULL OR s.revoked_at>?) AND ${liveAccountSql('s.user_id')} AND (${observers.map(()=>'(o.observer_id=? AND s.id=?)').join(' OR ')})`,room.mafiaKey,now,now,now,...observers.flatMap(o=>[o.id,o.accountSessionId]));
}
