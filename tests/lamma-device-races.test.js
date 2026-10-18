import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser, revokeSession } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeSocial } from '../server/social/router.mjs';
import { registerDevice } from '../server/lamma/notifications.mjs';

async function fixture(t) {
  const DB=createLocalD1(),env={DB};t.after(()=>DB.close());
  const user=async(createdAt=Date.now())=>{
    const account=await createUser(env,{name:'Device race test',email:`${crypto.randomUUID()}@example.test`});
    const session=await issueSession(env,account.id,'ios',createdAt);
    return {...account,token:session.token,sid:session.id};
  };
  const api=(account,method,body,path='/devices')=>routeSocial(new Request(`https://test.local/api/social${path}`,{
    method,headers:{authorization:`Bearer ${account.token}`,...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})}),env);
  const rows=async()=> (await DB.prepare('SELECT * FROM social_devices ORDER BY kind').all()).results;
  return {DB,env,user,api,rows};
}

// Pause after routeSocial has authenticated the request, before the device write.
// Other requests still use the actual SQLite database/transaction implementation.
function pauseNextDeviceRead(h) {
  let release,ready,paused=false;
  const gate=new Promise(resolve=>{release=resolve;});
  const reached=new Promise(resolve=>{ready=resolve;});
  h.env.DB={
    prepare(sql) {
      const statement=h.DB.prepare(sql);
      if(!paused&&sql.startsWith('SELECT COUNT(DISTINCT device_id)')) {
        paused=true;const bind=statement.bind.bind(statement);
        statement.bind=(...args)=>{
          const bound=bind(...args),first=bound.first.bind(bound);
          bound.first=async(...rest)=>{ready();await gate;return first(...rest);};
          return bound;
        };
      }
      return statement;
    },
    batch: h.DB.batch.bind(h.DB),
  };
  return {reached,release};
}
const device=(kind='apns',overrides={})=>({deviceId:'same-installation',kind,environment:'production',token:(kind==='apns'?'a':'b').repeat(64),...overrides});

for(const revoke of [false,true]) test(`delayed ${revoke?'revoked':'still-valid'} account cannot reclaim a switched installation`,async t=>{
  const h=await fixture(t),now=Date.now(),a=await h.user(now-1000),b=await h.user(now);
  for(const kind of ['apns','voip'])assert.equal((await h.api(a,'PUT',device(kind))).status,200);
  const pause=pauseNextDeviceRead(h),late=h.api(a,'PUT',device());
  await pause.reached;
  try {
    for(const kind of ['apns','voip'])assert.equal((await h.api(b,'PUT',device(kind))).status,200);
    if(revoke)await revokeSession(h.env,a.sid,Date.now());
  } finally {pause.release();}
  assert.equal((await late).status,200); // Idempotent legacy response remains compatible.
  const rows=await h.rows();assert.equal(rows.length,2);
  for(const row of rows){assert.equal(row.user_id,b.id);assert.equal(row.session_id,b.sid);}
});

for(const invalidation of ['expires_at','revoked_at'])test(`write-time ${invalidation} or wrong-owner sessions cannot displace a valid device registration`,async t=>{
  const h=await fixture(t),now=Date.now(),a=await h.user(now),b=await h.user(now-1000);
  assert.equal((await h.api(b,'PUT',device())).status,200);
  const pause=pauseNextDeviceRead(h),late=h.api(a,'PUT',device());await pause.reached;
  // Invalidate AFTER HTTP authentication but before the SQL write. Use an
  // unambiguously past timestamp, not a 1ms boundary between Node and SQLite
  // clocks (their independently sampled Windows clocks can differ slightly).
  try {await h.DB.prepare(`UPDATE sessions SET ${invalidation}=0 WHERE id=?`).bind(a.sid).run();}
  finally {pause.release();}
  assert.equal((await late).status,200);
  await registerDevice(h.env,a.id,b.sid,device());
  assert.equal((await h.rows())[0].user_id,b.id);
});

test('same APNs token cannot be reclaimed through a different installation ID by an older session',async t=>{
  const h=await fixture(t),now=Date.now(),a=await h.user(now-1000),b=await h.user(now);
  assert.equal((await h.api(b,'PUT',device('apns',{deviceId:'new-installation',token:'c'.repeat(512)}))).status,200);
  assert.equal((await h.api(a,'PUT',device('apns',{token:'c'.repeat(512)}))).status,200);
  const rows=await h.rows();assert.equal(rows.length,1);assert.equal(rows[0].user_id,b.id);assert.equal(rows[0].device_id,'new-installation');
});

test('equal-timestamp sessions keep the first claim instead of replacing another account',async t=>{
  const h=await fixture(t),now=Date.now(),a=await h.user(now),b=await h.user(now);
  assert.equal((await h.api(b,'PUT',device())).status,200);
  assert.equal((await h.api(a,'PUT',device())).status,200);
  assert.equal((await h.rows())[0].user_id,b.id);
  assert.equal((await h.api(b,'PUT',device('apns',{token:'d'.repeat(64)}))).status,200);
  assert.equal((await h.rows())[0].token,'d'.repeat(64));
});

test('retiring DELETE cannot erase a newer login of the same account, but current logout removes both token kinds',async t=>{
  const h=await fixture(t),a=await h.user(Date.now()-1000);
  const fresh=await issueSession(h.env,a.id,'ios'),current={...a,token:fresh.token,sid:fresh.id};
  for(const kind of ['apns','voip'])assert.equal((await h.api(current,'PUT',device(kind))).status,200);
  assert.equal((await h.api(a,'DELETE',null,'/devices/same-installation')).status,200);
  assert.equal((await h.rows()).length,2);
  assert.equal((await h.api(current,'DELETE',null,'/devices/same-installation')).status,200);
  assert.equal((await h.rows()).length,0);
});

test('a rotated/newer current session can remove its older device registration',async t=>{
  const h=await fixture(t),a=await h.user(Date.now()-1000);
  assert.equal((await h.api(a,'PUT',device())).status,200);
  const newer=await issueSession(h.env,a.id,'ios');
  assert.equal((await h.api({...a,token:newer.token},'DELETE',null,'/devices/same-installation')).status,200);
  assert.equal((await h.rows()).length,0);
});
