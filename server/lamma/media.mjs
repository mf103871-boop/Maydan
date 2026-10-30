import { fail } from '../room-model.mjs';
import { sha256 } from '../protocol.mjs';
import { clientIdOf,userId } from '../social/model.mjs';
import { all,first,run,stmt,ident,scopeOf,scopeAllowed,requireScope,unblocked,cleanText,live } from './common.mjs';
import { job,wakeJobs } from './notifications.mjs';
import { getCosmetic } from '../../src/plus/catalog.js';
import { plusActiveFor } from '../plus/access.mjs';
import { timed } from '../performance.mjs';
export const MAX_AUDIO_BYTES=3*1024*1024;
export const MAX_AUDIO_MS=120000;
export const attachmentView=r=>({id:r.id,mimeType:r.mime_type,durationMs:r.duration_ms,byteLength:r.byte_length,url:`/api/social/attachments/${r.id}/content`});
function validateAudio(body,bytes){
  const mime=String(body.mimeType||'').toLowerCase().split(';')[0].trim();
  if(!['audio/mp4','audio/x-m4a','audio/aac','audio/webm','audio/ogg','audio/wav'].includes(mime)||!Number.isInteger(body.durationMs)||body.durationMs<100||body.durationMs>MAX_AUDIO_MS||!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>MAX_AUDIO_BYTES)fail('AUDIO_INVALID',400);
  const ascii=(at,n)=>String.fromCharCode(...bytes.slice(at,at+n));
  const valid=mime==='audio/webm'?bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3:mime==='audio/ogg'?ascii(0,4)==='OggS':mime==='audio/wav'?ascii(0,4)==='RIFF'&&ascii(8,4)==='WAVE':mime==='audio/aac'?bytes[0]===255&&(bytes[1]&246)===240:ascii(4,4)==='ftyp';
  if(!valid)fail('AUDIO_INVALID',400);return {bytes,mime:mime==='audio/x-m4a'?'audio/mp4':mime};
}
function decodeAudio(body){
  if(typeof body.dataBase64!=='string'||body.dataBase64.length>Math.ceil(MAX_AUDIO_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.dataBase64))fail('AUDIO_INVALID',400);
  let bytes;try{bytes=Uint8Array.from(atob(body.dataBase64),c=>c.charCodeAt(0));}catch{fail('AUDIO_INVALID',400);}
  return validateAudio(body,bytes);
}
function base64Bytes(bytes){let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);}
async function binaryHash(bytes){return 'bin1:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
// Binary uploads retain the existing authenticated endpoint. Bound the entire
// multipart envelope before parsing it; no unbounded request.formData() buffering.
export async function readBinaryAudio(request){
  const max=MAX_AUDIO_BYTES+8192,type=request.headers.get('content-type')||'';
  if(!/^multipart\/form-data;\s*boundary=/i.test(type)||type.length>256)fail('INVALID',415);
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>max))fail('TOO_LARGE',413);
  const reader=request.body?.getReader();if(!reader)fail('AUDIO_INVALID',400);
  const chunks=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){await reader.cancel();fail('TOO_LARGE',413);}chunks.push(value);}
  const envelope=new Uint8Array(length);let offset=0;for(const chunk of chunks){envelope.set(chunk,offset);offset+=chunk.byteLength;}
  let form;try{form=await new Response(envelope,{headers:{'content-type':type}}).formData();}catch{fail('AUDIO_INVALID',400);}
  const keys=['scope','conversationId','clientId','durationMs','audio'];
  if([...form.keys()].length!==keys.length||keys.some(key=>form.getAll(key).length!==1))fail('AUDIO_INVALID',400);
  const fields=Object.fromEntries(keys.slice(0,-1).map(key=>[key,form.get(key)]));
  if(Object.values(fields).some(value=>typeof value!=='string'||value.length>128)||!/^\d+$/.test(fields.durationMs))fail('AUDIO_INVALID',400);
  const clip=form.get('audio');if(!(clip instanceof Blob)||clip.size>MAX_AUDIO_BYTES||clip.size<12)fail('AUDIO_INVALID',400);
  return {body:{...fields,durationMs:Number(fields.durationMs),mimeType:clip.type},bytes:new Uint8Array(await clip.arrayBuffer())};
}
export async function uploadAttachment(env,id,body,inputBytes){
  if(!env.SOCIAL_AUDIO)fail('AUDIO_UNAVAILABLE',503);
  const scope=scopeOf(body.scope),conversationId=userId(body.conversationId),clientId=clientIdOf(body.clientId);
  await requireScope(env,id,scope,conversationId);
  const {bytes,mime}=inputBytes===undefined?decodeAudio(body):validateAudio(body,inputBytes),hash=await binaryHash(bytes),attachmentId=await sha256(`${id}:${clientId}`),key=`voice/${attachmentId}`;
  const now=Date.now();
  await run(env,`INSERT OR IGNORE INTO social_attachments(id,user_id,scope,conversation_id,client_id,object_key,mime_type,duration_ms,byte_length,content_hash,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${scopeAllowed(scope,ident(conversationId),ident(id))} AND COALESCE((SELECT SUM(byte_length) FROM social_attachments WHERE user_id=? AND created_at>?),0)+?<=31457280`,attachmentId,id,scope,conversationId,clientId,key,mime,body.durationMs,bytes.length,hash,now,id,now-86400000,bytes.length);
  const row=await first(env,'SELECT * FROM social_attachments WHERE id=?',attachmentId);
  if(!row)fail('RATE_LIMIT',429);
  const sameHash=row.content_hash===hash||(!row.content_hash.startsWith('bin1:')&&row.content_hash===await sha256(body.dataBase64??base64Bytes(bytes)));
  if(row.deleted_at||!sameHash||row.scope!==scope||row.conversation_id!==conversationId||row.duration_ms!==body.durationMs||row.mime_type!==mime)fail('CONFLICT',409);
  if(!row.ready_at){
    await timed(env,'r2_put',()=>env.SOCIAL_AUDIO.put(key,bytes,{httpMetadata:{contentType:mime},customMetadata:{attachmentId}}));
    await run(env,`UPDATE social_attachments SET ready_at=? WHERE id=? AND deleted_at IS NULL AND ${scopeAllowed(scope,ident(conversationId),ident(id))}`,Date.now(),attachmentId);
    const ready=await first(env,'SELECT ready_at,deleted_at FROM social_attachments WHERE id=?',attachmentId);
    if(!ready?.ready_at||ready.deleted_at){await env.DB.batch([job(env,`audio-${attachmentId}`,'r2_delete',{key})]);await wakeJobs(env);fail('NOT_FOUND',404);}
  }
  return {attachment:attachmentView(row)};
}
export function attachmentGuard(scope,conversationId,id,attachmentId){return `EXISTS(SELECT 1 FROM social_attachments a WHERE a.id=${ident(attachmentId)} AND a.user_id=${ident(id)} AND a.scope='${scopeOf(scope)}' AND a.conversation_id=${ident(conversationId)} AND a.deleted_at IS NULL AND a.ready_at IS NOT NULL AND a.message_seq IS NULL)`;}
export async function messageContent(env,id,scope,conversationId,body){
  const kind=body.kind||'text';
  if(kind==='text')return {kind,text:cleanText(body.text,2000),attachmentId:null,roomInvitationId:null};
  if(kind==='sticker') {
    if(Object.keys(body).some(key=>!['kind','stickerId','clientId'].includes(key))||typeof body.stickerId!=='string')fail('INVALID',400);
    const clientId=clientIdOf(body.clientId);
    await requireScope(env,id,scope,conversationId);
    const table=scope==='group'?'social_group_messages':'social_messages',column=scope==='group'?'group_id':'conversation_id';
    const prior=await first(env,`SELECT * FROM ${table} WHERE sender_id=? AND client_id=?`,id,clientId);
    if(prior) {
      if(prior[column]!==conversationId||prior.kind!=='sticker'||prior.sticker_id!==body.stickerId)fail('CONFLICT',409);
      // A lost acknowledgement remains retryable after expiry, or after the
      // catalogue changes. This branch never grants permission to a new send.
      return {kind,text:prior.text,attachmentId:null,roomInvitationId:null,stickerId:prior.sticker_id,stickerVersion:prior.sticker_version};
    }
    const sticker=getCosmetic(body.stickerId,{kind:'sticker'});
    if(!sticker)fail('INVALID',400);
    if(!await plusActiveFor(env,id))fail('PLUS_REQUIRED',403);
    return {kind,text:`ملصق: ${sticker.label} — حدّث التطبيق لعرضه`,attachmentId:null,roomInvitationId:null,stickerId:sticker.id,stickerVersion:sticker.version};
  }
  if(kind!=='voice')fail('INVALID',400);
  const attachmentId=userId(body.attachmentId),a=await first(env,'SELECT * FROM social_attachments WHERE id=? AND user_id=? AND scope=? AND conversation_id=? AND ready_at IS NOT NULL AND deleted_at IS NULL',attachmentId,id,scope,conversationId);
  if(!a)fail('NOT_FOUND',404);
  return {kind,text:'رسالة صوتية — حدّث التطبيق للاستماع',attachmentId,roomInvitationId:null};
}
export async function enrichMessages(env,messages){
  const visible=messages.filter(m=>m&&!m.deletedAt);
  const lookup=async(field,table,suffix='')=>{
    const ids=[...new Set(visible.map(m=>m[field]).filter(Boolean))],found=new Map();
    // Stay below D1's bound-parameter limit, including larger history pages.
    for(let at=0;at<ids.length;at+=80){const batch=ids.slice(at,at+80);for(const row of await all(env,`SELECT * FROM ${table} WHERE id IN (${batch.map(()=>'?').join(',')})${suffix}`,...batch))found.set(row.id,row);}
    return found;
  };
  const [attachments,invites]=await Promise.all([
    lookup('attachmentId','social_attachments',' AND deleted_at IS NULL AND ready_at IS NOT NULL'),
    lookup('roomInvitationId','social_room_invites'),
  ]);
  for(const m of visible){
    if(m.kind==='sticker'&&m.stickerId){const item=getCosmetic(m.stickerId,{kind:'sticker',now:Number.MAX_SAFE_INTEGER});if(item&&item.version===m.stickerVersion)m.sticker={id:item.id,version:item.version,label:item.label,assetUrl:item.assetUrl};}
    if(m.attachmentId){delete m.attachment;const a=attachments.get(m.attachmentId);if(a)m.attachment=attachmentView(a);}
    if(m.roomInvitationId){delete m.roomInvitation;const r=invites.get(m.roomInvitationId);if(r)m.roomInvitation={id:r.id,roomCode:r.room_code,game:r.game,expiresAt:r.expires_at,status:r.expires_at>Date.now()?'pending':'expired'};}
  }
  return messages;
}
async function authorizedAttachment(env,id,attachmentId){
  const actor=ident(id);
  // One authorization snapshot covers ownership, friendship/membership, blocks,
  // join history and message deletion. Call it again after awaiting R2 below.
  const a=await first(env,`SELECT a.* FROM social_attachments a WHERE a.id=? AND a.ready_at IS NOT NULL AND a.deleted_at IS NULL AND ${unblocked(actor,'a.user_id')} AND ${live('a.user_id')} AND (
    (a.scope='direct' AND ${scopeAllowed('direct','a.conversation_id',actor)} AND ((a.message_seq IS NULL AND a.user_id=${actor}) OR EXISTS(SELECT 1 FROM social_messages m WHERE m.seq=a.message_seq AND m.conversation_id=a.conversation_id AND m.attachment_id=a.id AND m.deleted_at IS NULL))) OR
    (a.scope='group' AND ${scopeAllowed('group','a.conversation_id',actor)} AND ((a.message_seq IS NULL AND a.user_id=${actor}) OR EXISTS(SELECT 1 FROM social_group_messages m JOIN social_group_members gm ON gm.group_id=m.group_id AND gm.user_id=${actor} WHERE m.seq=a.message_seq AND m.group_id=a.conversation_id AND m.attachment_id=a.id AND m.deleted_at IS NULL AND gm.left_at IS NULL AND m.seq>gm.visible_after_seq)))
  )`,attachmentId);
  if(!a)fail('NOT_FOUND',404);return a;
}
export async function audioResponse(env,id,attachmentId,request){
  if(!env.SOCIAL_AUDIO)fail('AUDIO_UNAVAILABLE',503);const a=await authorizedAttachment(env,id,userId(attachmentId));
  let range=null;const raw=request.headers.get('range');if(raw){const m=/^bytes=(\d+)-(\d*)$/.exec(raw);if(!m)fail('INVALID',416);const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),a.byte_length-1):a.byte_length-1;if(start>end||start>=a.byte_length)fail('INVALID',416);range={offset:start,length:end-start+1};}
  const object=await timed(env,'r2_get',()=>env.SOCIAL_AUDIO.get(a.object_key,range?{range}:undefined));if(!object)fail('NOT_FOUND',404);
  // R2 can await network IO while a block/removal/delete commits in D1.
  await authorizedAttachment(env,id,a.id);
  return new Response(object.body,{status:range?206:200,headers:{'content-type':a.mime_type,'content-length':String(range?range.length:a.byte_length),'cache-control':'private, no-store','x-content-type-options':'nosniff','accept-ranges':'bytes',...(range?{'content-range':`bytes ${range.offset}-${range.offset+range.length-1}/${a.byte_length}`}:{})}});
}
export async function deleteAttachment(env,id,attachmentId){const a=await first(env,'SELECT * FROM social_attachments WHERE id=? AND user_id=? AND message_seq IS NULL',userId(attachmentId),id);if(!a)fail('NOT_FOUND',404);await env.DB.batch([stmt(env,'UPDATE social_attachments SET deleted_at=? WHERE id=? AND message_seq IS NULL',Date.now(),a.id),job(env,`audio-${a.id}`,'r2_delete',{key:a.object_key},null,Date.now(),`EXISTS(SELECT 1 FROM social_attachments WHERE id=${ident(a.id)} AND deleted_at IS NOT NULL)`)]);await wakeJobs(env);return {ok:true};}
export async function collectDeletedAudio(env){const rows=await all(env,'SELECT * FROM social_attachments WHERE deleted_at IS NOT NULL LIMIT 100');if(rows.length)await env.DB.batch(rows.map(a=>job(env,`audio-${a.id}`,'r2_delete',{key:a.object_key})));await wakeJobs(env);}
export async function reportAudioResponse(env,reportId){if(!env.SOCIAL_AUDIO)fail('AUDIO_UNAVAILABLE',503);const lookup=()=>first(env,'SELECT a.* FROM social_report_attachments ra JOIN social_reports r ON r.id=ra.report_id JOIN social_attachments a ON a.id=ra.attachment_id WHERE ra.report_id=?',reportId);const a=await lookup();if(!a)fail('NOT_FOUND',404);const object=await env.SOCIAL_AUDIO.get(a.object_key);if(!object||!await lookup())fail('NOT_FOUND',404);return new Response(object.body,{headers:{'content-type':a.mime_type,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-length':String(a.byte_length)}});}
