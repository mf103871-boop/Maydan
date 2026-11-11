import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalD1} from '../server/local-d1.mjs';
import {drainJobs} from '../server/lamma/jobs.mjs';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}};
async function fixture(t){
 const DB=createLocalD1();t.after(()=>DB.close());
 const env={DB,LIVEKIT_URL:'wss://synthetic.livekit.cloud',LIVEKIT_API_KEY:'offline-key',LIVEKIT_API_SECRET:'offline-secret'};
 const query=(sql,...args)=>DB.prepare(sql).bind(...args),now=Date.now(),room='offline-ended-room';
 for(const [id,kind,payload]of [['remove','lk_remove',{room,identity:'offline-user'}],['delete','lk_delete',{room}]])
  await query('INSERT INTO social_jobs(id,kind,payload,created_at,due_at) VALUES(?,?,?,?,?)',id,kind,JSON.stringify(payload),now,now).run();
 return{env,query,now,room};
}
test('DeleteRoom waits while a same-room RemoveParticipant job is leased by another drainer',async t=>{
 const h=await fixture(t),entered=deferred(),release=deferred(),methods=[];let removalSettled=false,deletedBeforeRemoval=false;
 t.mock.method(globalThis,'fetch',async url=>{
  const method=new URL(url).pathname.split('/').at(-1);methods.push(method);
  if(method==='RemoveParticipant'){entered.resolve();await release.promise;removalSettled=true;}
  if(method==='DeleteRoom'&&!removalSettled)deletedBeforeRemoval=true;
  return Response.json({});
 });
 const first=drainJobs(h.env,h.now,h.room);await entered.promise;
 try{await drainJobs(h.env,h.now,h.room);assert.equal(deletedBeforeRemoval,false,'A second drainer deleted the room before the leased revocation completed');}
 finally{release.resolve();await first;}
 assert.equal(methods.filter(m=>m==='RemoveParticipant').length,1);
 assert.equal((await h.query("SELECT COUNT(*) AS n FROM social_jobs WHERE kind='lk_remove'").first()).n,0);
});
test('RemoveParticipant404 retains both jobs until a successful strict revocation retry',async t=>{
 const h=await fixture(t),methods=[];let removeStatus=404;
 t.mock.method(globalThis,'fetch',async url=>{const method=new URL(url).pathname.split('/').at(-1);methods.push(method);return Response.json({}, {status:method==='RemoveParticipant'?removeStatus:200});});
 await drainJobs(h.env,h.now,h.room);
 const removal=await h.query("SELECT attempts,lease_until FROM social_jobs WHERE id='remove'").first();
 assert.ok(removal,'A 404 response must not erase a strict revocation job');
 assert.equal(removal.attempts,1);assert.equal(removal.lease_until,0);
 assert.ok(await h.query("SELECT 1 FROM social_jobs WHERE id='delete'").first());
 assert.equal(methods.includes('DeleteRoom'),false,'Deletion cannot overtake an unsuccessful token revocation');
 removeStatus=200;await drainJobs(h.env,Date.now()+60000,h.room);
 assert.deepEqual(methods,['RemoveParticipant','RemoveParticipant','DeleteRoom']);
 assert.equal((await h.query('SELECT COUNT(*) AS n FROM social_jobs').first()).n,0);
});
test('confirmed participant revocation allows its room deletion in the same pass',async t=>{
 const h=await fixture(t),methods=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{methods.push(new URL(url).pathname.split('/').at(-1));if(methods.at(-1)==='RemoveParticipant')assert.ok(JSON.parse(options.body).revoke_token_ts>=Math.floor(h.now/1000)+1);return Response.json({});});
 await drainJobs(h.env,h.now,h.room);
 assert.deepEqual(methods,['RemoveParticipant','DeleteRoom']);
 assert.equal((await h.query('SELECT COUNT(*) AS n FROM social_jobs').first()).n,0);
});
