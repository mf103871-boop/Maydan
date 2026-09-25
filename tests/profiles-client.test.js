import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfilesClient } from '../src/profiles/client.js';
import { profileAssetUrl } from '../src/profiles/identity.js';
import { rememberProfileReturn, consumeProfileReturn } from '../src/shared/account/return-path.js';
import { cropRect, imageDimensions, decodeProfileImage } from '../src/profiles/client-images.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const profile = (id='alice', revision=1) => ({id,revision,name:id,avatarUrl:null,coverUrl:null});
function setup(request, changed) {
  const client = new ProfilesClient({request, changed, server:()=> 'https://example.test'});
  client.userId='alice'; return client;
}
test('late profile reads and saves cannot restore another account after switching', async () => {
  for (const operation of ['read','save','start-session','complete-session']) {
    const response=deferred(); const client=setup(()=>response.promise);
    const task = operation==='read' ? client.loadProfile('bob') : operation==='save' ? client.saveProfile({name:'اسم جديد'}) : operation==='start-session' ? client.beginSession('beep') : client.completeSession('session');
    client.start(null); client.userId='charlie';
    response.resolve({profile:profile(),sessionId:'session'});
    await assert.rejects(task,{code:'STALE'},operation);
    assert.deepEqual(client.state.profiles,{}); assert.equal(client.state.mine,null); assert.equal(client.sessions.size,0);
  }
});
test('an older profile response cannot undo an image, award or statistics revision', async () => {
  const response=deferred(); const client=setup(()=>response.promise);
  const pending=client.loadProfile();
  client.apply({...profile('alice',4),name:'الجديد',stats:{onlineWins:1},earnedBadges:['first-win']});
  response.resolve({profile:{...profile('alice',3),name:'القديم',stats:{onlineWins:0}}});
  assert.equal((await pending).revision,4); assert.equal(client.state.mine.stats.onlineWins,1);
});
test('reads coalesce and a blocked profile is removed from the visible cache', async () => {
  let calls=0;const response=deferred();const client=setup(()=>{calls++;return response.promise;});
  client.apply(profile('bob'));
  const a=client.loadProfile('bob'); const b=client.loadProfile('bob');
  response.reject(Object.assign(new Error('blocked'),{code:'NOT_FOUND'}));
  await Promise.all([assert.rejects(a,{code:'NOT_FOUND'}),assert.rejects(b,{code:'NOT_FOUND'})]);
  assert.equal(calls,1);assert.equal(client.state.profiles.bob,undefined);assert.equal(client.state.loading.bob,false);
});
test('a successful profile save remains successful when follow-up refresh throws', async () => {
  const client=setup(async()=>({profile:profile('alice',2)}),()=>{throw new Error('refresh failed');});
  assert.equal((await client.saveProfile({name:'اسم جديد'})).revision,2);
  await new Promise(resolve=>setImmediate(resolve)); assert.equal(client.state.saving,false);
});
test('concurrent saves are rejected while failed saves preserve the last confirmed profile', async () => {
  const response=deferred();const client=setup(()=>response.promise);client.apply(profile());
  const first=client.saveProfile({name:'جديد'});
  await assert.rejects(client.saveProfile({name:'آخر'}),{code:'BUSY'});
  response.reject(Object.assign(new Error('conflict'),{code:'CONFLICT'}));
  await assert.rejects(first,{code:'CONFLICT'});assert.equal(client.state.mine.name,'alice');assert.equal(client.state.saving,false);
});
test('text and image writes preserve the editor revision even after a newer background read', async () => {
  const calls=[];const client=setup(async (path,options)=>{calls.push(options);return {profile:profile('alice',5)};});
  client.apply(profile('alice',5));
  await client.saveProfile({name:'اسم جديد',revision:2});await client.uploadImage('avatar','image',2);await client.removeImage('cover',2);
  assert.deepEqual(calls.map(call=>call.body.revision),[2,2,2]);
  assert.deepEqual(calls.map(call=>call.method),['PATCH','PUT','DELETE']);
});
test('completion immediately applies the earned award even while an older GET is pending', async () => {
  const response=deferred();const client=setup((path,options)=>options?.method==='POST'?Promise.resolve({counted:true,profile:{...profile('alice',6),earnedBadges:['host']}}):response.promise);
  const pending=client.loadProfile();await client.completeSession('session');
  response.resolve({profile:profile('alice',2)});await pending;
  assert.equal(client.state.mine.revision,6);assert.deepEqual(client.state.mine.earnedBadges,['host']);
});
test('profile images accept only the selected server and exact versioned image path', () => {
  const relative='/api/profiles/alice/images/avatar/'+'a'.repeat(64);const server='https://example.test';
  assert.equal(profileAssetUrl(relative,server),server+relative);
  for (const value of ['https://tracker.test'+relative,relative+'?tracking=1',relative+'#fragment','javascript:alert(1)','data:image/svg+xml,test','/api/profiles/alice','//tracker.test'+relative]) assert.equal(profileAssetUrl(value,server),null,value);
});
test('sign-in returns to the requested profile once, without accepting external or expired destinations', () => {
  const data=new Map();const storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  rememberProfileReturn(storage,'#/profile/alice',1000);assert.equal(consumeProfileReturn(storage,2000),'/profile/alice');assert.equal(consumeProfileReturn(storage,2001),'/');
  rememberProfileReturn(storage,'#/profile',1000);assert.equal(consumeProfileReturn(storage,1000+16*60*1000),'/');
  for(const hash of ['https://evil.test','#//evil.test','#/profile/../settings','#/profile/alice?redirect=evil','#/friends']) {rememberProfileReturn(storage,hash,1000);assert.equal(consumeProfileReturn(storage,2000),'/');}
});
test('avatar and cover cropping stays within the original image at every slider extreme', () => {
  for(const image of [{width:4000,height:3000},{width:400,height:1200},{width:512,height:512}]) {
    for(const kind of ['avatar','cover']) for(const zoom of [1,2,3]) for(const offsetX of [-1,0,1]) for(const offsetY of [-1,0,1]) {
      const rect=cropRect(image,{kind,zoom,offsetX,offsetY});
      assert.ok(rect.x>=0 && rect.y>=0);assert.ok(rect.x+rect.width<=image.width+1e-8);assert.ok(rect.y+rect.height<=image.height+1e-8);
      assert.equal(rect.width/rect.height,kind==='avatar'?1:3);
    }
  }
});
test('image preflight rejects SVG, animated WebP, oversized dimensions and oversized files before decoding', async () => {
  assert.throws(()=>imageDimensions(new TextEncoder().encode('<svg width="512" height="512"></svg>')));
  const webp=new Uint8Array(30); webp.set(new TextEncoder().encode('RIFF'),0);webp.set(new TextEncoder().encode('WEBPVP8X'),8);webp[20]=2;
  assert.throws(()=>imageDimensions(webp),/ثابتة/);
  const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10]);png.set(new TextEncoder().encode('IHDR'),12);
  new DataView(png.buffer).setUint32(16,16000);new DataView(png.buffer).setUint32(20,16000);
  await assert.rejects(decodeProfileImage({size:24,arrayBuffer:async()=>png.buffer}),/كبيرة/);
  await assert.rejects(decodeProfileImage({size:13*1024*1024}),/12/);
});
