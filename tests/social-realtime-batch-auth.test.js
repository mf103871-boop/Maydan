import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalD1} from '../server/local-d1.mjs';
import {createUser} from '../server/accounts/db.mjs';
import {issueSession} from '../server/accounts/session.mjs';
import {SocialHub} from '../server/social/realtime.mjs';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function fixture(t,count=1){
 const raw=createLocalD1(),env={DB:raw},now=Date.now(),owner=await createUser(env),peer=await createUser(env),sessions=[],sockets=[],observed={auth:[],saves:0},received=[];t.after(()=>raw.close());
 const query=(sql,...args)=>raw.prepare(sql).bind(...args);const [low,high]=[owner.id,peer.id].sort(),conversation=crypto.randomUUID(),group=crypto.randomUUID();
 await query("INSERT INTO social_friendships(id,user_low,user_high,requester_id,status,created_at,accepted_at)VALUES(?,?,?,?,'accepted',?,?)",crypto.randomUUID(),low,high,owner.id,now,now).run();await query('INSERT INTO social_conversations(id,user_low,user_high,created_at)VALUES(?,?,?,?)',conversation,low,high,now).run();
 await query('INSERT INTO social_groups(id,name,owner_id,created_at,updated_at)VALUES(?,?,?,?,?)',group,'فحص',peer.id,now,now).run();for(const u of [owner,peer])await query("INSERT INTO social_group_members(group_id,user_id,role,joined_at)VALUES(?,?,'member',?)",group,u.id,now).run();
 await query("INSERT INTO social_messages(conversation_id,sender_id,client_id,text,original_hash,created_at)VALUES(?,?,?,?,'hash',?)",conversation,peer.id,crypto.randomUUID(),'خاص',now).run();const dm=(await query('SELECT MAX(seq)AS seq FROM social_messages').first()).seq;
 await query("INSERT INTO social_group_messages(group_id,sender_id,client_id,kind,text,original_hash,created_at)VALUES(?,?,?,'text',?,'hash',?)",group,peer.id,crypto.randomUUID(),'رسالة شلة',now).run();const gm=(await query('SELECT MAX(seq)AS seq FROM social_group_messages').first()).seq;
 for(let i=0;i<count;i++){const s=await issueSession(env,owner.id);sessions.push(s);sockets.push({readyState:1,data:{sessionId:s.id,seenAt:now,validUntil:now+3600000,windowAt:now,count:0},deserializeAttachment(){return structuredClone(this.data);},serializeAttachment(value){this.data=structuredClone(value);},send(value){received.push({socket:i,event:JSON.parse(value)});},close(code){this.readyState=3;this.code=code;}});}
 const state={userId:owner.id,lastActiveAt:now,tickets:{},onlineBroadcast:true,presenceWrittenAt:now};
 const ctx={storage:{async get(){return structuredClone(state);},async put(){observed.saves++;if(observed.beforeSave)await observed.beforeSave();},async setAlarm(){},async deleteAlarm(){},async deleteAll(){}},getWebSockets:()=>sockets,blockConcurrencyWhile:fn=>fn(),waitUntil(){}};
 env.DB=new Proxy(raw,{get(target,key){if(key==='prepare')return sql=>{if(/SELECT s.id,s.expires_at,s.revoked_at,CASE/.test(sql))observed.auth.push(sql);return target.prepare(sql);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const hub=new SocialHub(ctx,env);await hub.ready;const notify=event=>hub.fetch(new Request('https://social.internal/notify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:owner.id,event})}));
 return {raw,env,query,owner,peer,conversation,group,dm,gm,hub,notify,sessions,sockets,observed,received};
}
test('sixteen sockets authorize in two bounded D1 snapshots rather than sixteen serial session lookups',async t=>{
 const h=await fixture(t,16);for(let i=4;i<16;i++)h.sockets[i].data.sessionId=h.sessions[i%4].id;
 const event={type:'refresh',reason:'test'};assert.equal((await h.notify(event)).status,200);assert.equal(h.received.length,16);assert.equal(h.observed.auth.length,2);for(const sql of h.observed.auth)assert.equal(sql.match(/s.id IN \(([^)]+)\)/)[1].split(',').length,4);
});
for(const change of ['block','remove','revoke','suspend','delete','mafia'])test(`final recipient snapshot rejects ${change} committed during the durable save`,async t=>{
 const h=await fixture(t),entered=deferred(),gate=deferred();t.after(()=>gate.resolve());let armed=true;
 h.observed.beforeSave=async()=>{if(armed&&h.observed.auth.length){armed=false;entered.resolve();await gate.promise;}};
 const event={type:'group',reason:'message',groupId:h.group,messageSeq:h.gm},pending=h.notify(event);await entered.promise;
 if(change==='block')await h.query('INSERT INTO social_blocks(blocker_id,blocked_id,created_at)VALUES(?,?,?)',h.owner.id,h.peer.id,Date.now()).run();
 if(change==='remove')await h.query('UPDATE social_group_members SET left_at=? WHERE group_id=? AND user_id=?',Date.now(),h.group,h.owner.id).run();
 if(change==='revoke')await h.query('UPDATE sessions SET revoked_at=? WHERE id=?',Date.now(),h.sessions[0].id).run();
 if(change==='suspend')await h.query('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at)VALUES(?,?,?,?,?)',h.owner.id,h.owner.id,'إيقاف',Date.now(),Date.now()).run();
 if(change==='delete')await h.query('DELETE FROM users WHERE id=?',h.owner.id).run();
 if(change==='mafia')await h.query('INSERT INTO mafia_match_leases(user_id,room_key,match_id,expires_at,updated_at)VALUES(?,?,?,?,?)',h.owner.id,'room','match',Date.now()+60000,Date.now()).run();
 gate.resolve();await pending;assert.deepEqual(h.received,[]);if(['revoke','suspend','delete'].includes(change))assert.equal(h.sockets[0].readyState,3);
});
test('direct events cannot borrow an unrelated authorized conversation, and deleted notices still invalidate',async t=>{
 const h=await fixture(t),outsider=await createUser({DB:h.raw}),foreign=crypto.randomUUID(),pair=[h.peer.id,outsider.id].sort();await h.query('INSERT INTO social_conversations(id,user_low,user_high,created_at)VALUES(?,?,?,?)',foreign,...pair,Date.now()).run();await h.query("INSERT INTO social_messages(conversation_id,sender_id,client_id,text,original_hash,created_at)VALUES(?,?,?,?,'hash',?)",foreign,h.peer.id,crypto.randomUUID(),'غير مخول',Date.now()).run();const seq=(await h.query('SELECT MAX(seq)AS seq FROM social_messages').first()).seq;
 await h.notify({type:'message',conversationId:foreign,messageSeq:seq});assert.deepEqual(h.received,[]);
 const own={type:'message',conversationId:h.conversation,messageSeq:h.dm};await h.notify(own);assert.deepEqual(h.received.map(x=>x.event),[own]);h.received.length=0;
 await h.query('UPDATE social_group_members SET left_at=? WHERE group_id=? AND user_id=?',Date.now(),h.group,h.owner.id).run();const deleted={type:'group',reason:'deleted',groupId:h.group,messageSeq:h.gm};await h.notify(deleted);assert.deepEqual(h.received.map(x=>x.event),[deleted]);
});
test('group history threshold and sender block are honored in the joined snapshot',async t=>{
 const h=await fixture(t),event={type:'group',reason:'message',groupId:h.group,messageSeq:h.gm};await h.query('UPDATE social_group_members SET visible_after_seq=? WHERE group_id=? AND user_id=?',h.gm,h.group,h.owner.id).run();await h.notify(event);assert.deepEqual(h.received,[]);await h.query('UPDATE social_group_members SET visible_after_seq=0 WHERE group_id=? AND user_id=?',h.group,h.owner.id).run();await h.notify(event);assert.equal(h.received.length,1);
 h.received.length=0;for(const pair of [[h.owner.id,h.peer.id],[h.peer.id,h.owner.id]]){await h.query('DELETE FROM social_blocks').run();await h.query('INSERT INTO social_blocks(blocker_id,blocked_id,created_at)VALUES(?,?,?)',...pair,Date.now()).run();await h.notify(event);assert.deepEqual(h.received,[]);}
});
test('the final snapshot also respects sender Mafia locks for typing and appearance',async t=>{
 const h=await fixture(t);await h.query('INSERT INTO mafia_match_leases(user_id,room_key,match_id,expires_at,updated_at)VALUES(?,?,?,?,?)',h.peer.id,'room','match',Date.now()+60000,Date.now()).run();for(const event of [{type:'typing',userId:h.peer.id,active:true},{type:'refresh',reason:'profile',userId:h.peer.id}])await h.notify(event);assert.deepEqual(h.received,[]);assert.equal(h.sockets[0].readyState,1);
});
test('a close or owner forget during a pending batch cannot revive the old attachment',async t=>{
 const h=await fixture(t,2),gate=deferred(),entered=deferred();t.after(()=>gate.resolve());const original=h.hub.authorizationSnapshot.bind(h.hub);let armed=true;
 h.hub.authorizationSnapshot=async(...args)=>{const snapshot=await original(...args);if(armed){armed=false;entered.resolve();await gate.promise;}return snapshot;};const pending=h.notify({type:'refresh',reason:'test'});await entered.promise;h.hub.close(h.sockets[0]);gate.resolve();await pending;assert.equal(h.sockets[0].data.closed,true);assert.equal(h.sockets[0].readyState,3);assert.deepEqual(h.received.map(x=>x.socket),[1]);
 const next=deferred(),ready=deferred();armed=true;h.hub.authorizationSnapshot=async(...args)=>{const snapshot=await original(...args);if(armed){armed=false;ready.resolve();await next.promise;}return snapshot;};const other=h.notify({type:'refresh',reason:'after-forget'});await ready.promise;await h.hub.forget();next.resolve();await other;assert.equal(h.hub.state.userId,null);assert.equal(h.received.some(x=>x.event.reason==='after-forget'),false);
});
test('heartbeat expiry while a D1 snapshot is pending cannot revive or deliver to a silent socket',async t=>{
 const h=await fixture(t),gate=deferred(),entered=deferred(),started=Date.now();t.after(()=>gate.resolve());let now=started,armed=true;h.hub.now=()=>now;
 const original=h.hub.authorizationSnapshot.bind(h.hub);h.hub.authorizationSnapshot=async(...args)=>{const snapshot=await original(...args);if(armed){armed=false;entered.resolve();await gate.promise;}return snapshot;};
 const pending=h.notify({type:'refresh',reason:'after-delay'});await entered.promise;now=started+45001;gate.resolve();await pending;assert.equal(h.sockets[0].code,4408);assert.deepEqual(h.received,[]);
});
