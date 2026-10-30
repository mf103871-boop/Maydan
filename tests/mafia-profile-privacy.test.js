import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { localEnvironment } from '../server/local.mjs';
import { routeRequest } from '../server/worker.mjs';
import { createUser, upsertSubscription } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { ensurePlayerProfile } from '../server/profiles/db.mjs';
import { SocialHub } from '../server/social/realtime.mjs';

async function setup(t) {
  const runtime=localEnvironment({vars:{MAFIA_ENABLED:'1'}}),env=runtime.env;
  t.after(()=>runtime.dispose());
  const notifications=[];
  env.SOCIAL_HUB={idFromName:id=>id,get:id=>({fetch:async request=>{
    notifications.push({recipient:id,...await request.json()});return new Response('{}');
  }})};
  async function person(plus=false) {
    const user=await createUser(env,{name:'لاعب اختبار',email:`${crypto.randomUUID()}@example.test`});
    const session=await issueSession(env,user.id);await ensurePlayerProfile(env,user.id);
    if(plus)await upsertSubscription(env,{source:'promo',external_id:`test-${user.id}`,user_id:user.id,
      product:'plus.monthly',status:'active',until:Date.now()+86400000,will_renew:false,environment:'promo',occurred_at:Date.now()});
    return {...user,token:session.token,sessionId:session.id};
  }
  async function api(user,path,body,method=body===undefined?'GET':'POST') {
    const response=await routeRequest(new Request('http://localhost:3000'+path,{method,
      headers:{origin:'http://localhost:3000',authorization:`Bearer ${user.token}`,...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
    return {status:response.status,body:response.status===204?null:response.headers.get('content-type')?.startsWith('image/')?new Uint8Array(await response.arrayBuffer()):await response.json()};
  }
  const lock=user=>env.DB.prepare('INSERT OR REPLACE INTO mafia_media_leases(user_id,room_key,call_id,expires_at,updated_at) VALUES(?,?,?,?,?)')
    .bind(user.id,'owned-match','owned-call',Number.MAX_SAFE_INTEGER,Date.now()).run();
  const unlock=user=>env.DB.prepare('DELETE FROM mafia_media_leases WHERE user_id=?').bind(user.id).run();
  const row=user=>env.DB.prepare('SELECT * FROM player_profiles WHERE user_id=?').bind(user.id).first();
  return {env,person,api,lock,unlock,row,notifications};
}
const assertLocked=result=>{assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.body.error,'MAFIA_SOCIAL_LOCKED');};

test('active Mafia blocks public cosmetic/profile edits including clear and image deletion, while reads and safety remain available',async t=>{
  const h=await setup(t),a=await h.person(true),b=await h.person();
  assert.equal((await h.api(a,'/api/me/cosmetics',{selection:{frameId:'sahra.frame',badge:true},revision:0},'PATCH')).status,200);
  const before=await h.row(a);await h.lock(a);h.notifications.length=0;
  // Disabling new matches must not unlock players still in an existing match.
  h.env.MAFIA_ENABLED='0';
  for(const selection of [{frameId:'artist.frame'},{frameId:null,badge:false},{badge:true}])
    assertLocked(await h.api(a,'/api/me/cosmetics',{selection,revision:1},'PATCH'));
  assertLocked(await h.api(a,'/api/profiles/me',{name:'اسم إشارة',bio:'إشارة',theme:'violet',avatarPreset:'fox',revision:before.revision},'PATCH'));
  for(const kind of ['avatar','cover'])assertLocked(await h.api(a,`/api/profiles/me/images/${kind}`,{revision:before.revision},'DELETE'));
  assert.deepEqual(await h.row(a),before);assert.deepEqual(h.notifications,[]);
  assert.equal((await h.api(a,'/api/me/cosmetics')).body.effective.frameId,'sahra.frame');
  assert.equal((await h.api(b,`/api/profiles/${a.id}`)).body.profile.cosmetics.frameId,'sahra.frame');
  assert.equal((await h.api(a,'/api/social/reports',{userId:b.id,reason:'بلاغ اختبار خاص'})).status,200);
  await h.unlock(a);
  assert.equal((await h.api(a,'/api/me/cosmetics',{selection:{frameId:null,badge:false},revision:1},'PATCH')).status,200);
  assert.equal((await h.api(a,'/api/profiles/me',{theme:'violet'},'PATCH')).status,200);
  const deleting=await h.person();await h.lock(deleting);
  assert.equal((await h.api(deleting,'/api/account',{},'DELETE')).status,204);
  assert.equal(await h.env.DB.prepare('SELECT 1 FROM users WHERE id=?').bind(deleting.id).first(),null);
});

for(const existing of [false,true])test(`D1 lease acquisition between cosmetics check and ${existing?'update':'insert'} prevents the public mutation`,async t=>{
  const h=await setup(t),a=await h.person(true);
  if(existing)assert.equal((await h.api(a,'/api/me/cosmetics',{selection:{frameId:'sahra.frame'},revision:0},'PATCH')).status,200);
  const before=await h.row(a);h.notifications.length=0;
  const batch=h.env.DB.batch.bind(h.env.DB);let intercepted=false;
  t.mock.method(h.env.DB,'batch',async statements=>{
    if(!intercepted&&statements[0]?.sql.startsWith('INSERT INTO plus_cosmetics')){intercepted=true;await h.lock(a);}
    return batch(statements);
  });
  assertLocked(await h.api(a,'/api/me/cosmetics',{selection:{frameId:'artist.frame'},revision:existing?1:0},'PATCH'));
  assert.equal(intercepted,true);assert.deepEqual(await h.row(a),before);assert.deepEqual(h.notifications,[]);
  const selection=(await h.api(a,'/api/me/cosmetics')).body;
  assert.equal(selection.revision,existing?1:0);assert.equal(selection.preferred.frameId,existing?'sahra.frame':null);
});

for(const image of [false,true])test(`D1 start/write race also fences ${image?'public image deletion':'legacy identity changes'} and dependent writes`,async t=>{
  const h=await setup(t),a=await h.person();
  if(image) {
    await h.env.DB.prepare('UPDATE player_profiles SET avatar_version=? WHERE user_id=?').bind('a'.repeat(64),a.id).run();
    await h.env.DB.prepare('INSERT INTO player_images(user_id,kind,version,data_base64,width,height,byte_length,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(a.id,'avatar','a'.repeat(64),'owned-image',1,1,1,Date.now()).run();
  }
  const before=await h.row(a);const batch=h.env.DB.batch.bind(h.env.DB);let intercepted=false;
  t.mock.method(h.env.DB,'batch',async statements=>{
    if(!intercepted&&statements[0]?.sql.startsWith('UPDATE player_profiles SET')&&statements[0].sql.includes('last_mutation=')){intercepted=true;await h.lock(a);}
    return batch(statements);
  });
  const result=image?await h.api(a,'/api/profiles/me/images/avatar',{revision:before.revision},'DELETE')
    :await h.api(a,'/api/profiles/me',{name:'إشارة جديدة',bio:'رسالة',theme:'violet',avatarPreset:'fox',revision:before.revision},'PATCH');
  assertLocked(result);assert.equal(intercepted,true);assert.deepEqual(await h.row(a),before);assert.deepEqual(h.notifications,[]);
  assert.equal((await h.env.DB.prepare('SELECT name FROM users WHERE id=?').bind(a.id).first()).name,a.name);
  if(image)assert.ok(await h.env.DB.prepare('SELECT 1 FROM player_images WHERE user_id=?').bind(a.id).first());
});

test('private moderated image upload and owner preview stay available during a Mafia lease',async t=>{
  const h=await setup(t),a=await h.person(),b=await h.person();await h.lock(a);
  const bytes=await sharp({create:{width:64,height:64,channels:3,background:'#8866aa'}}).jpeg().toBuffer();
  const submitted=await h.api(a,'/api/profiles/me/images/avatar',{dataUrl:`data:image/jpeg;base64,${bytes.toString('base64')}`},'PUT');
  assert.equal(submitted.status,200,JSON.stringify(submitted));
  assert.equal(submitted.body.profile.avatarUrl,null);
  const pending=submitted.body.profile.imageReviews.avatar;
  assert.equal(pending.status,'pending');assert.equal((await h.api(a,pending.previewUrl)).status,200);
  assert.equal((await h.api(b,pending.previewUrl)).status,404);
  const publicProfile=(await h.api(b,`/api/profiles/${a.id}`)).body.profile;
  assert.equal(publicProfile.avatarUrl,null);assert.equal('imageReviews' in publicProfile,false);
});

test('actual D1-backed receiving hub drops queued profile refresh when either participant enters Mafia, preserving safety invalidation',async t=>{
  const h=await setup(t),sender=await h.person(),recipient=await h.person(),messages=[];
  let data={userId:recipient.id,lastActiveAt:Date.now(),tickets:{},typingAt:0,typingCount:0};
  const ws={readyState:1,attachment:{sessionId:recipient.sessionId,validUntil:Date.now()+60000,seenAt:Date.now()},
    deserializeAttachment(){return this.attachment;},serializeAttachment(value){this.attachment=value;},
    send(value){messages.push(JSON.parse(value));},close(){this.readyState=3;}};
  const ctx={blockConcurrencyWhile:task=>task(),getWebSockets:()=>[ws],storage:{get:async()=>structuredClone(data),put:async(_key,value)=>{data=structuredClone(value);},setAlarm:async()=>{},deleteAlarm:async()=>{}}};
  const hub=new SocialHub(ctx,h.env);await hub.ready;
  // Keep real hub authentication, queue and D1 lease reads; presence is unrelated.
  hub.presence=async()=>{};
  const notify=event=>hub.fetch(new Request('https://social.internal/notify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:recipient.id,event})}));
  const event={type:'refresh',reason:'profile',userId:sender.id};
  for(const locked of [sender,recipient]) {
    let release;hub.queue=new Promise(resolve=>{release=resolve;});
    const queued=notify(event);await h.lock(locked);release();
    assert.equal((await queued).status,200);assert.deepEqual(messages,[]);
    await h.unlock(locked);
  }
  await notify(event);assert.deepEqual(messages,[event]);messages.length=0;
  await h.lock(recipient);
  for(const safe of [{type:'refresh',reason:'safety'},{type:'refresh',reason:'moderation'},{type:'refresh'},{type:'group',reason:'deleted',groupId:'owned-group'}]) {
    await notify(safe);assert.deepEqual(messages.pop(),safe);
  }
  await notify({type:'session_revoked',sessionId:recipient.sessionId});assert.equal(ws.readyState,3);
});
