import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession, ROTATE_AFTER } from '../server/accounts/session.mjs';
import { routeProfiles, isPublicProfileImagePath } from '../server/profiles/router.mjs';
import * as profiles from '../server/profiles/db.mjs';
import * as social from '../server/social/db.mjs';
import { errorResponse } from '../server/protocol.mjs';
import { imageFromDataUrl, sanitizeJpeg, IMAGE_LIMITS } from '../server/profiles/images.mjs';

async function fixture(kind='avatar',color='#9962be',options={}) {
  const width=kind==='avatar'?64:192;const height=kind==='avatar'?64:64;
  const bytes=await sharp({create:{width,height,channels:3,background:color}}).jpeg({quality:80,...options}).toBuffer();
  return {bytes,dataUrl:`data:image/jpeg;base64,${bytes.toString('base64')}`};
}
async function setup(t) {
  const env={DB:createLocalD1()};t.after(()=>env.DB.close());
  async function user(name='لاعب تجربة') {
    const row=await createUser(env,{name,email:`private-${crypto.randomUUID()}@example.test`});
    const session=await issueSession(env,row.id);await profiles.ensurePlayerProfile(env,row.id);
    return {...row,token:session.token};
  }
  async function call(actor,path,method='GET',body) {
    const request=new Request(`https://maydan.test${path.startsWith('/api/')?path:'/api/profiles'+path}`,{method,
      headers:{...(actor?.token?{authorization:`Bearer ${actor.token}`} :{}),...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    let response;try{response=await routeProfiles(request,env)}catch(error){response=errorResponse(error)}
    return {status:response.status,headers:response.headers,body:response.headers.get('content-type')?.startsWith('image/')?
      new Uint8Array(await response.arrayBuffer()):await response.json()};
  }
  async function connect(a,b) {
    const r=await social.requestFriend(env,a.id,b.id,Date.now());await social.acceptRequest(env,b.id,r.id,Date.now());
    await profiles.awardProfileAchievements(env,a.id);await profiles.awardProfileAchievements(env,b.id);
  }
  return {env,user,call,connect};
}

test('profiles require sessions, preserve friend codes, rotate auth, and never reveal emails',async t=>{
  const {env,user,call}=await setup(t);const a=await user();const b=await user('private@example.test');
  const code=(await social.ensureProfile(env,a.id)).code;
  assert.equal((await call(null,'/me')).status,401);
  assert.equal((await call(null,`/${a.id}`)).status,401);
  assert.equal((await call(null,'/search?q=لاعب')).status,401);
  const p=(await call(a,'/me')).body.profile;
  assert.equal(p.code,code);assert.equal(p.relationship,'self');assert.deepEqual(p.earnedBadges,['welcome']);
  assert.deepEqual(p.stats,{localSessions:0,onlineMatches:0,onlineWins:0,onlineDraws:0,distinctGames:0});
  assert.equal(JSON.stringify(p).includes(a.email),false);assert.equal('email' in p,false);
  assert.equal((await call(a,`/${b.id}`)).body.profile.name,'لاعب ميدان');
  await env.DB.prepare('UPDATE users SET name=? WHERE id=?').bind('private＠example.test',b.id).run();
  assert.equal((await call(a,`/${b.id}`)).body.profile.name,'لاعب ميدان');
  await call(a,'/me','PATCH',{name:'اسم جديد',bio:'نبذة'});
  assert.equal((await call(a,'/me')).body.profile.code,code);
  assert.equal((await env.DB.prepare('SELECT name FROM users WHERE id=?').bind(a.id).first()).name,'اسم جديد');
  const old=await issueSession(env,a.id,'web',Date.now()-ROTATE_AFTER-1000);
  assert.match((await call({token:old.token},'/me')).headers.get('x-maydan-session'),/^mdn1\./);
});

test('owner-only writes reject guessed target IDs and strict validation rejects client-granted stats/rewards',async t=>{
  const {user,call}=await setup(t);const a=await user();const b=await user();
  const jpeg=await fixture();
  for(const [path,method,body] of [[`/${a.id}`,'PATCH',{name:'انتحال'}],[`/${a.id}/images/avatar`,'PUT',{dataUrl:jpeg.dataUrl}],[`/${a.id}/images/avatar`,'DELETE',{}]])
    assert.equal((await call(b,path,method,body)).status,404);
  for(const body of [{name:'أ'},{name:'😀'.repeat(33)},{name:'a@b.test'},{name:'a\u202eb'},
    {bio:'ن'.repeat(161)},{theme:'evil-url'},{avatarPreset:'javascript:alert(1)'},{stats:{onlineWins:999}},{earnedBadges:['first-win']},
    {avatarUrl:'https://attacker.test/1.jpg'},{featuredBadges:['welcome','welcome']},{featuredBadges:['a','b','c','d']},{revision:-1,name:'اسم'}])
    assert.equal((await call(a,'/me','PATCH',body)).status,400,JSON.stringify(body));
  assert.equal((await call(a,'/me','PATCH',{selectedTitle:'winner'})).status,403);
  assert.equal((await call(a,'/me','PATCH',{featuredBadges:['first-win']})).status,403);
  const accepted=await call(a,'/me','PATCH',{name:'😀'.repeat(32),bio:'ب'.repeat(160)});
  assert.equal(accepted.status,200);assert.equal(Array.from(accepted.body.profile.name).length,32);
});

test('earned profile and friendship awards persist after their prerequisites are removed',async t=>{
  const {user,call,connect,env}=await setup(t);const a=await user();const b=await user();
  const complete=(await call(a,'/me','PATCH',{bio:'أحب اللعب الجماعي',avatarPreset:'falcon'})).body.profile;
  assert.ok(complete.earnedBadges.includes('identity'));
  await connect(a,b);await social.removeFriend(env,a.id,b.id);
  const removed=(await call(a,'/me','PATCH',{bio:'',avatarPreset:'spark',selectedTitle:'companion',featuredBadges:['identity','first-friend']})).body.profile;
  assert.equal(removed.friendCount,0);assert.equal(removed.selectedTitle,'companion');
  assert.deepEqual(removed.featuredBadges,['identity','first-friend']);
  assert.equal(removed.achievements.find(a=>a.id==='first-friend').earned,true);
  assert.equal(removed.achievements.find(a=>a.id==='identity').progress,1);
});

test('profile and image revision guards reject stale writes without changing users.name or image data',async t=>{
  const {user,call,env}=await setup(t);const a=await user();
  const revision=(await call(a,'/me')).body.profile.revision;
  assert.equal((await call(a,'/me','PATCH',{name:'الاسم الأول',revision})).status,200);
  assert.equal((await call(a,'/me','PATCH',{name:'اسم متأخر',bio:'متأخر',revision})).status,409);
  assert.equal((await env.DB.prepare('SELECT name FROM users WHERE id=?').bind(a.id).first()).name,'الاسم الأول');
  const jpeg=await fixture();
  assert.equal((await call(a,'/me/images/avatar','PUT',{dataUrl:jpeg.dataUrl,revision})).status,409);
  assert.equal((await call(a,'/me')).body.profile.avatarUrl,null);
  const newest=(await call(a,'/me')).body.profile.revision;
  assert.equal((await call(a,'/me/images/avatar','PUT',{dataUrl:jpeg.dataUrl,revision:newest})).status,200);
  assert.equal((await call(a,'/me/images/avatar','DELETE',{revision:newest})).status,409);
  assert.ok((await call(a,'/me')).body.profile.avatarUrl);
});

test('images are sanitized JPEG bytes, public only at the current content version, and replace/delete atomically',async t=>{
  const {user,call,env}=await setup(t);const a=await user();
  const jpeg=await fixture();
  const marker=(kind,text)=>{const data=Buffer.from(text);return Buffer.concat([Buffer.from([255,kind,(data.length+2)>>8,(data.length+2)&255]),data])};
  const input=Buffer.concat([jpeg.bytes.subarray(0,2),marker(225,'Exif\0\0PRIVATE-GPS'),marker(254,'PRIVATE-COMMENT'),marker(237,'PRIVATE-XMP'),jpeg.bytes.subarray(2)]);
  const first=(await call(a,'/me/images/avatar','PUT',{dataUrl:`data:image/jpeg;base64,${input.toString('base64')}`})).body.profile;
  assert.match(first.avatarUrl,new RegExp(`^/api/profiles/${a.id}/images/avatar/[a-f0-9]{64}$`));
  assert.equal(isPublicProfileImagePath(first.avatarUrl),true);assert.equal(isPublicProfileImagePath('/api/profiles/me'),false);
  const image=await call(null,first.avatarUrl);
  assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'no-store');
  assert.equal(image.headers.get('x-content-type-options'),'nosniff');assert.equal(image.headers.get('content-type'),'image/jpeg');
  assert.equal(Buffer.from(image.body).includes(Buffer.from('PRIVATE')),false);
  const metadata=await sharp(image.body).metadata();assert.equal(metadata.width,64);assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);
  const retry=(await call(a,'/me/images/avatar','PUT',{dataUrl:jpeg.dataUrl})).body.profile;
  assert.equal(retry.avatarUrl,first.avatarUrl);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM player_images WHERE user_id=?').bind(a.id).first()).n,1);
  const changed=await fixture('avatar','#22aa44');
  const replacement=(await call(a,'/me/images/avatar','PUT',{dataUrl:changed.dataUrl})).body.profile;
  assert.notEqual(replacement.avatarUrl,first.avatarUrl);assert.equal((await call(null,first.avatarUrl)).status,404);
  await call(a,'/me/images/avatar','DELETE',{});assert.equal((await call(null,replacement.avatarUrl)).status,404);
  const custom=(await call(a,'/me/images/avatar','PUT',{dataUrl:jpeg.dataUrl})).body.profile;
  const preset=(await call(a,'/me','PATCH',{avatarPreset:'cat'})).body.profile;
  assert.equal(preset.avatarUrl,null);assert.equal((await call(null,custom.avatarUrl)).status,404);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM player_images WHERE user_id=?').bind(a.id).first()).n,0);
});

test('JPEG validation bounds dimensions, ratio, byte count, markers and compressed entropy',async()=>{
  const jpeg=await fixture();
  for(const dataUrl of ['https://remote.test/a.jpg','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,aGVsbG8=',
    'data:image/jpeg;base64,////','data:image/jpeg;base64,'+jpeg.bytes.subarray(0,-3).toString('base64'),
    'data:image/jpeg;base64,'+Buffer.concat([jpeg.bytes,Buffer.from('<script>')]).toString('base64')])
    await assert.rejects(imageFromDataUrl(dataUrl,'avatar'));
  const progressive=await fixture('avatar','#9962be',{progressive:true});await assert.rejects(imageFromDataUrl(progressive.dataUrl,'avatar'),{code:'IMAGE_INVALID'});
  const wrong=await sharp({create:{width:513,height:513,channels:3,background:'#777'}}).jpeg().toBuffer();
  await assert.rejects(imageFromDataUrl('data:image/jpeg;base64,'+wrong.toString('base64'),'avatar'),{code:'IMAGE_INVALID'});
  await assert.rejects(imageFromDataUrl(jpeg.dataUrl,'cover'),{code:'IMAGE_INVALID'});
  assert.throws(()=>sanitizeJpeg(new Uint8Array(IMAGE_LIMITS.avatar+1),'avatar'),{code:'IMAGE_TOO_LARGE'});
  const scan=jpeg.bytes.indexOf(Buffer.from([255,218]));const end=scan+2+jpeg.bytes.readUInt16BE(scan+2);
  const noEntropy=Buffer.concat([jpeg.bytes.subarray(0,end),Buffer.from([255,217])]);
  assert.throws(()=>sanitizeJpeg(noEntropy,'avatar'),{code:'IMAGE_INVALID'});
  const brokenEntropy=Buffer.concat([jpeg.bytes.subarray(0,end),Buffer.from([0,255,217])]);
  assert.throws(()=>sanitizeJpeg(brokenEntropy,'avatar'),{code:'IMAGE_INVALID'});
  const badLength=Buffer.from(jpeg.bytes);badLength[4]=255;badLength[5]=255;
  assert.throws(()=>sanitizeJpeg(badLength,'avatar'),{code:'IMAGE_INVALID'});
  for(const [width,height,kind] of [[17,17,'avatar'],[512,512,'avatar'],[1200,400,'cover']]) {
    const image=await sharp({create:{width,height,channels:3,background:'#577'}}).jpeg({chromaSubsampling:'4:4:4'}).toBuffer();
    const validated=sanitizeJpeg(image,kind);assert.equal((await sharp(validated.bytes).metadata()).width,width);
  }
});

test('profile visibility and search respect both block directions; presence is friends-only',async t=>{
  const {user,call,connect,env}=await setup(t);const a=await user('صديق أول');const b=await user('صديق آخر');
  await social.touchPresence(env,b.id,Date.now(),Date.now()+45000);
  const stranger=(await call(a,`/${b.id}`)).body.profile;assert.equal(stranger.relationship,'none');assert.equal('online' in stranger,false);assert.equal('lastActiveAt' in stranger,false);
  assert.equal((await call(a,`/search?q=${stranger.code.toLowerCase()}`)).body.users[0].id,b.id);
  assert.deepEqual((await call(a,'/search?q=%25_')).body.users,[]);
  assert.equal((await call(a,'/search?q=ص')).status,400);
  await connect(a,b);const friend=(await call(a,`/${b.id}`)).body.profile;assert.equal(friend.relationship,'friend');assert.equal(friend.online,true);
  await social.blockUser(env,b.id,a.id,Date.now());
  assert.equal((await call(a,`/${b.id}`)).status,404);assert.equal((await call(b,`/${a.id}`)).status,404);
  assert.deepEqual((await call(a,`/search?q=${stranger.code}`)).body.users,[]);
  assert.deepEqual((await call(b,'/search?q=صديق أول')).body.users,[]);
});

test('server-only online results deduplicate, distinguish wins/draws, grant awards, and advance revisions',async t=>{
  const {user,call,env}=await setup(t);const a=await user();const initial=(await call(a,'/me')).body.profile.revision;
  const event={userId:a.id,eventId:'online:room:1',game:'fabraka',won:true,draw:false,finishedAt:Date.now()};
  assert.equal(await profiles.recordOnlineResult(env,event),true);assert.equal(await profiles.recordOnlineResult(env,event),false);
  await profiles.recordOnlineResult(env,{...event,eventId:'online:room:2',won:false,draw:true});
  await profiles.recordOnlineResult(env,{...event,eventId:'online:room:3',game:'meenfina',won:false,draw:false});
  const p=(await call(a,'/me')).body.profile;assert.deepEqual(p.stats,{localSessions:0,onlineMatches:3,onlineWins:1,onlineDraws:1,distinctGames:2});
  assert.ok(p.revision>initial);assert.ok(p.earnedTitles.includes('winner'));
  await assert.rejects(profiles.recordOnlineResult(env,{...event,eventId:'online:bad',game:'meenfina'}),{code:'INVALID'});
  assert.equal((await call(a,'/me','PATCH',{onlineWins:999})).status,400);
  assert.equal((await call(a,'/me/results','POST',{game:'fabraka',won:true})).status,404);
  const retryRevision=(await call(a,'/me')).body.profile.revision;await profiles.recordOnlineResult(env,event);
  assert.equal((await call(a,'/me')).body.profile.revision,retryRevision);
});

test('local session completions are owned, start on the server, enforce duration, and never grant wins',async t=>{
  const {user,call,env}=await setup(t);const a=await user();const b=await user();
  assert.equal((await call(a,'/me/sessions','POST',{game:'fake'})).status,400);
  assert.equal((await call(a,'/me/sessions','POST',{game:'badeeha',won:true})).status,400);
  const started=await call(a,'/me/sessions','POST',{game:'badeeha'});assert.equal(started.status,200);
  const id=started.body.sessionId;
  assert.equal((await call(b,`/me/sessions/${id}/complete`,'POST',{})).status,404);
  assert.equal((await call(a,`/me/sessions/${id}/complete`,'POST',{})).body.error,'SESSION_TOO_SHORT');
  await env.DB.prepare('UPDATE player_sessions SET started_at=? WHERE id=?').bind(Date.now()-31000,id).run();
  assert.equal((await call(a,`/me/sessions/${id}/complete`,'POST',{wins:100})).status,400);
  const done=await call(a,`/me/sessions/${id}/complete`,'POST',{});assert.equal(done.status,200);assert.equal(done.body.counted,true);
  assert.equal((await call(a,`/me/sessions/${id}/complete`,'POST',{})).body.counted,false);
  assert.equal(done.body.profile.stats.localSessions,1);assert.equal(done.body.profile.stats.onlineWins,0);
  assert.ok(done.body.profile.earnedBadges.includes('host'));
});

test('local start and completion quotas each enforce 24 per UTC day',async t=>{
  const {user,env}=await setup(t);const a=await user();const now=Date.now();
  const midday=Math.floor(now/86400000)*86400000+43200000;
  for(let i=0;i<24;i++) {
    const id=await profiles.startLocalSession(env,a.id,'beep',midday-31000);
    assert.equal((await profiles.completeLocalSession(env,a.id,id,midday)).counted,true);
  }
  await assert.rejects(profiles.startLocalSession(env,a.id,'beep',midday),{code:'RATE_LIMIT'});
  const old=await profiles.startLocalSession(env,a.id,'beep',midday-86400000);
  await assert.rejects(profiles.completeLocalSession(env,a.id,old,midday),{code:'RATE_LIMIT'});
});

test('profile summaries batch without image bodies and cleanup participates in account rollback',async t=>{
  const {user,call,env}=await setup(t);const a=await user();const b=await user();const jpeg=await fixture();
  const p=(await call(a,'/me/images/avatar','PUT',{dataUrl:jpeg.dataUrl})).body.profile;
  const summaries=await profiles.profileSummaries(env,[a.id,b.id,a.id,'invalid/id']);
  assert.equal(summaries.size,2);assert.equal(summaries.get(a.id).avatarUrl,p.avatarUrl);assert.equal('data_base64' in summaries.get(a.id),false);
  await profiles.recordOnlineResult(env,{userId:a.id,eventId:'online:delete:1',game:'fabraka',won:true,draw:false,finishedAt:Date.now()});
  await profiles.startLocalSession(env,a.id,'jabeen');
  await assert.rejects(env.DB.batch([...profiles.profileDeleteStatements(env,a.id),env.DB.prepare('DELETE FROM missing_table')]));
  assert.equal((await call(null,p.avatarUrl)).status,200);
  await env.DB.prepare('INSERT INTO account_deletions VALUES(?,?,?)').bind(a.id,'deletion',Date.now()).run();
  assert.equal((await call(null,p.avatarUrl)).status,404);assert.equal((await call(b,`/${a.id}`)).status,404);
  assert.equal(await profiles.recordOnlineResult(env,{userId:a.id,eventId:'online:delete:2',game:'fabraka',won:true,draw:false,finishedAt:Date.now()}),false);
  await env.DB.batch([...profiles.profileDeleteStatements(env,a.id),env.DB.prepare('DELETE FROM users WHERE id=?').bind(a.id)]);
  for(const table of ['player_profiles','player_images','player_stats','player_events','player_sessions','player_achievements'])
    assert.equal((await env.DB.prepare(`SELECT COUNT(*) n FROM ${table} WHERE user_id=?`).bind(a.id).first()).n,0,table);
});
