import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeSocial } from '../server/social/router.mjs';
import { errorResponse } from '../server/protocol.mjs';
import { enrichMessages, readBinaryAudio, MAX_AUDIO_BYTES } from '../server/lamma/media.mjs';

const clip = Uint8Array.from([0,0,0,20,102,116,121,112,77,52,65,32,0,0,0,0,109,52,97,32]);
function formFor(conversationId, clientId=crypto.randomUUID(), bytes=clip) {
  const form=new FormData();
  for(const [key,value] of Object.entries({scope:'direct',conversationId,clientId,durationMs:'1200'}))form.append(key,value);
  form.append('audio',new Blob([bytes],{type:'audio/mp4'}),'voice');return form;
}
async function fixture(t) {
  const DB=createLocalD1(),objects=new Map(),queries=[];let puts=0;
  t.after(()=>DB.close());
  const env={DB:{prepare(sql){queries.push(sql);return DB.prepare(sql);},batch:args=>DB.batch(args)},SOCIAL_AUDIO:{
    put:async(key,bytes)=>{puts++;objects.set(key,new Uint8Array(bytes));},
    get:async key=>objects.has(key)?{body:objects.get(key)}:null,
    delete:async key=>objects.delete(key),
  }};
  const query=(sql,...args)=>DB.prepare(sql).bind(...args);
  const user=async()=>{const u=await createUser(env,{name:'فحص الشبكة',email:`${crypto.randomUUID()}@example.test`});return {...u,token:(await issueSession(env,u.id)).token};};
  const api=async(u,path,method='GET',body)=>{
    const multipart=body instanceof FormData;
    let response;try{response=await routeSocial(new Request('https://test.local/api/social'+path,{method,headers:{authorization:'Bearer '+u.token,...(body===undefined||multipart?{}:{'content-type':'application/json'})},body:body===undefined?undefined:multipart?body:JSON.stringify(body)}),env);}catch(e){response=errorResponse(e);}
    return {status:response.status,body:response.headers.get('content-type')?.startsWith('application/json')?await response.json():new Uint8Array(await response.arrayBuffer())};
  };
  const friends=async(a,b)=>{const [low,high]=[a.id,b.id].sort(),id=crypto.randomUUID(),now=Date.now();await query("INSERT INTO social_friendships(id,user_low,user_high,requester_id,status,created_at,accepted_at) VALUES(?,?,?,?,'accepted',?,?)",crypto.randomUUID(),low,high,a.id,now,now).run();await query('INSERT INTO social_conversations(id,user_low,user_high,created_at) VALUES(?,?,?,?)',id,low,high,now).run();return id;};
  return {env,objects,queries,query,user,api,friends,puts:()=>puts};
}

test('binary uploads preserve bytes, JSON retry compatibility and private playback authorization',async t=>{
  const h=await fixture(t),a=await h.user(),b=await h.user(),outsider=await h.user(),conversationId=await h.friends(a,b),clientId=crypto.randomUUID();
  assert.equal((await h.api(a,'/capabilities')).body.binaryVoiceUpload,true);
  const uploaded=await h.api(a,'/attachments','POST',formFor(conversationId,clientId));
  assert.equal(uploaded.status,200,JSON.stringify(uploaded.body));const id=uploaded.body.attachment.id;
  assert.deepEqual([...h.objects.values()][0],clip);
  assert.equal((await h.query('SELECT content_hash FROM social_attachments WHERE id=?',id).first()).content_hash,'bin1:'+createHash('sha256').update(clip).digest('hex'));
  const legacyBody={scope:'direct',conversationId,clientId,mimeType:'audio/mp4',durationMs:1200,dataBase64:Buffer.from(clip).toString('base64')};
  assert.equal((await h.api(a,'/attachments','POST',legacyBody)).body.attachment.id,id);assert.equal(h.puts(),1);
  // A retry of a clip stored by an older server also retains its upload identity.
  await h.query('UPDATE social_attachments SET content_hash=? WHERE id=?',createHash('sha256').update(legacyBody.dataBase64).digest('hex'),id).run();
  assert.equal((await h.api(a,'/attachments','POST',formFor(conversationId,clientId))).status,200);assert.equal(h.puts(),1);
  const changed=clip.slice();changed[changed.length-1]^=1;
  assert.equal((await h.api(a,'/attachments','POST',formFor(conversationId,clientId,changed))).status,409);
  const message=await h.api(a,`/conversations/${conversationId}/messages`,'POST',{clientId,kind:'voice',attachmentId:id});assert.equal(message.status,200);
  h.queries.length=0;const played=await h.api(b,`/attachments/${id}/content`);assert.equal(played.status,200);assert.deepEqual(played.body,clip);
  assert.equal(h.queries.filter(sql=>sql.startsWith('SELECT a.* FROM social_attachments a')).length,2,'one complete authorization before and after R2');
  assert.equal((await h.api(outsider,`/attachments/${id}/content`)).status,404);
  assert.equal((await h.api(outsider,'/attachments','POST',formFor(conversationId))).status,404);
});

test('binary parser rejects duplicate/unknown fields, wrong signatures and oversized streaming bodies',async t=>{
  const h=await fixture(t),a=await h.user(),b=await h.user(),id=await h.friends(a,b);
  const duplicate=formFor(id);duplicate.append('scope','group');assert.equal((await h.api(a,'/attachments','POST',duplicate)).status,400);
  const extra=formFor(id);extra.append('another','ignored?');assert.equal((await h.api(a,'/attachments','POST',extra)).status,400);
  assert.equal((await h.api(a,'/attachments','POST',formFor(id,crypto.randomUUID(),new Uint8Array(20)))).status,400);
  assert.equal(h.objects.size,0);
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(MAX_AUDIO_BYTES+8193));},cancel(){cancelled=true;}});
  await assert.rejects(readBinaryAudio(new Request('https://test.local',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=test'},body:stream,duplex:'half'})),e=>e.status===413);
  assert.equal(cancelled,true);
  await assert.rejects(readBinaryAudio(new Request('https://test.local',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=test','content-length':String(MAX_AUDIO_BYTES+8193)},body:'x'})),e=>e.status===413);
});

test('history metadata is batched, bounded and deduplicated; deleted or incomplete audio stays absent',async t=>{
  const h=await fixture(t),messages=[];
  for(let i=0;i<103;i++){
    const id=`audio-${i}`;await h.query("INSERT INTO social_attachments(id,user_id,scope,conversation_id,client_id,object_key,mime_type,duration_ms,byte_length,content_hash,created_at,ready_at,deleted_at) VALUES(?,'sender','direct','conversation',?,?,'audio/mp4',1200,20,'digest',1,?,?)",id,id,id,i===101?null:1,i===102?2:null).run();messages.push({seq:i+1,attachmentId:id});
  }
  messages.push({...messages[0]},{seq:200,deletedAt:1,attachmentId:'private-never-queried'});
  h.queries.length=0;await enrichMessages(h.env,messages);
  assert.equal(h.queries.length,2);assert.ok(h.queries.every(sql=>(sql.match(/\?/g)||[]).length<=80));
  assert.equal(messages.filter(m=>m.attachment).length,102);
  assert.equal(messages[101].attachment,undefined);assert.equal(messages[102].attachment,undefined);
  assert.equal(messages.at(-1).attachment,undefined);
});

test('group history enriches a voice page once and group lists resolve latest visible messages in one query',async t=>{
  const h=await fixture(t),owner=await h.user(),blocked=await h.user(),allowed=await h.user(),now=Date.now(),groups=[];
  for(let i=0;i<12;i++){
    const id=crypto.randomUUID();groups.push(id);
    await h.query('INSERT INTO social_groups(id,name,owner_id,created_at,updated_at) VALUES(?,?,?,?,?)',id,`group ${i}`,owner.id,now,now).run();
    await h.query("INSERT INTO social_group_members(group_id,user_id,role,joined_at) VALUES(?,?,'owner',?)",id,owner.id,now).run();
    for(const sender of [allowed,blocked])await h.query("INSERT INTO social_group_messages(group_id,sender_id,client_id,kind,text,original_hash,created_at) VALUES(?,?,?,'text',?,'digest',?)",id,sender.id,crypto.randomUUID(),sender===blocked?'HIDDEN':'visible',now).run();
  }
  await h.query('INSERT INTO social_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)',owner.id,blocked.id,now).run();
  // The first group's latest visible message is before this membership window.
  await h.query('UPDATE social_group_members SET visible_after_seq=1000 WHERE group_id=? AND user_id=?',groups[0],owner.id).run();
  h.queries.length=0;const response=await h.api(owner,'/groups');assert.equal(response.status,200);
  assert.equal(response.body.groups.length,12);assert.equal(response.body.groups.find(g=>g.id===groups[0]).lastMessage,null);
  assert.equal(response.body.groups.filter(g=>g.lastMessage?.text==='visible').length,11);
  assert.equal(h.queries.filter(sql=>sql.startsWith('SELECT m.* FROM social_group_messages m JOIN social_group_members')).length,1);
  const form=formFor(groups[1]);form.set('scope','group');const upload=await h.api(owner,'/attachments','POST',form);assert.equal(upload.status,200);
  await h.api(owner,`/groups/${groups[1]}/messages`,'POST',{kind:'voice',clientId:crypto.randomUUID(),attachmentId:upload.body.attachment.id});
  h.queries.length=0;const history=await h.api(owner,`/groups/${groups[1]}/messages`);assert.equal(history.status,200);
  assert.ok(history.body.messages.some(m=>m.attachment?.id===upload.body.attachment.id));
  assert.equal(h.queries.filter(sql=>sql.startsWith('SELECT * FROM social_attachments WHERE id IN')).length,1);
});

test('a left group member cannot receive list metadata even while another member remains active',async t=>{
  const h=await fixture(t),owner=await h.user(),former=await h.user(),now=Date.now();
  const created=await h.api(owner,'/groups','POST',{name:'PRIVATE GROUP'}),id=created.body.group.id;
  await h.query("INSERT INTO social_group_members(group_id,user_id,role,joined_at,left_at) VALUES(?,?,'member',?,?)",id,former.id,now,now+1).run();
  await h.api(owner,`/groups/${id}/messages`,'POST',{clientId:crypto.randomUUID(),text:'PRIVATE MESSAGE'});
  const response=await h.api(former,'/groups');assert.equal(response.status,200);assert.deepEqual(response.body.groups,[]);
  assert.equal(JSON.stringify(response.body).includes('PRIVATE'),false);
});

test('leaving between group-list snapshot and last-message lookup never returns later private text',async t=>{
  const h=await fixture(t),owner=await h.user(),member=await h.user(),now=Date.now();
  const created=await h.api(owner,'/groups','POST',{name:'Group'}),id=created.body.group.id;
  await h.query("INSERT INTO social_group_members(group_id,user_id,role,joined_at) VALUES(?,?,'member',?)",id,member.id,now).run();
  await h.api(owner,`/groups/${id}/messages`,'POST',{clientId:crypto.randomUUID(),text:'PRIVATE MESSAGE'});
  const original=h.env.DB.prepare.bind(h.env.DB);let intercepted=false;
  h.env.DB.prepare=sql=>{
    const prepared=original(sql);if(!sql.startsWith('SELECT g.*,gm.role'))return prepared;
    return {bind(...args){const statement=prepared.bind(...args);return {async all(){const result=await statement.all();intercepted=true;await h.query('UPDATE social_group_members SET left_at=? WHERE group_id=? AND user_id=?',now+1,id,member.id).run();return result;}};}};
  };
  const response=await h.api(member,'/groups');assert.equal(intercepted,true);assert.equal(response.status,200);
  assert.equal(response.body.groups[0].lastMessage,null);assert.equal(JSON.stringify(response.body).includes('PRIVATE MESSAGE'),false);
});
