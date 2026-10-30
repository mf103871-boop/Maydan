import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalD1} from '../server/local-d1.mjs';
import * as db from '../server/accounts/db.mjs';
import {issueSession,readSession,ROTATE_AFTER,rotations} from '../server/accounts/session.mjs';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const request=(token,path='/api/me')=>new Request('https://unit.test'+path,{headers:{authorization:'Bearer '+token}});
async function fixture(t,age=0){const raw=createLocalD1(),env={DB:raw},now=Date.now(),user=await db.createUser(env,{name:'اسم خاص',email:'owner@example.test'}),session=await issueSession(env,user.id,'web',now-age);t.after(()=>raw.close());return {raw,env,now,user,session};}
function wrapDB(raw,hook){return new Proxy(raw,{get(target,key){if(key==='prepare')return sql=>{const wrap=statement=>new Proxy(statement,{get(value,method){if(method==='bind')return(...args)=>wrap(value.bind(...args));if(['first','all','run'].includes(method))return async(...args)=>{await hook(sql,method);return value[method](...args);};const item=value[method];return typeof item==='function'?item.bind(value):item;}});return wrap(target.prepare(sql));};const value=target[key];return typeof value==='function'?value.bind(target):value;}});}
test('fresh bearer auth uses one joined primary read and returns no joined moderation aliases',async t=>{
 const f=await fixture(t),reads=[];f.env.DB=wrapDB(f.raw,(sql,method)=>{if(method==='first'||method==='all')reads.push(sql);});
 const found=await readSession(f.env,request(f.session.token));assert.equal(reads.length,1);assert.match(reads[0],/JOIN users/);assert.match(reads[0],/moderation_suspensions/);assert.equal(found.user.id,f.user.id);assert.deepEqual(Object.keys(found.user).sort(),['created_at','email','id','name']);assert.equal(Object.keys(found.session).some(key=>key.startsWith('principal_')),false);
});
test('the same Request object cannot cache authorization across explicit revocation',async t=>{
 const f=await fixture(t),req=request(f.session.token);await readSession(f.env,req);await db.revokeSession(f.env,f.session.id,Date.now());await assert.rejects(readSession(f.env,req),/AUTH_EXPIRED/);
});
test('suspended management access remains available while social and moderator surfaces are refused',async t=>{
 const f=await fixture(t);await f.raw.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at)VALUES(?,?,?,?,?)').bind(f.user.id,f.user.id,'إيقاف',f.now,f.now).run();
 for(const path of ['/api/me','/api/account','/api/auth/signout','/api/apple/transactions','/api/paddle/portal'])assert.equal((await readSession(f.env,request(f.session.token,path))).user.id,f.user.id);
 for(const path of ['/api/social/groups','/api/moderation'])await assert.rejects(readSession(f.env,request(f.session.token,path)),/ACCOUNT_SUSPENDED/);
});
test('a deleted owner cannot authenticate an orphaned session, and an incorrect secret remains rejected',async t=>{
 const f=await fixture(t);await assert.rejects(readSession(f.env,request(f.session.token.slice(0,-1)+(f.session.token.endsWith('A')?'B':'A'))),/AUTH_EXPIRED/);await f.raw.prepare('DELETE FROM users WHERE id=?').bind(f.user.id).run();await assert.rejects(readSession(f.env,request(f.session.token)),/AUTH_EXPIRED/);
});
for(const change of ['revoke','suspend','delete'])test(`a ${change} during last-seen persistence wins before auth returns`,async t=>{
 const f=await fixture(t,120000),entered=deferred(),gate=deferred();t.after(()=>gate.resolve());let armed=true;
 f.env.DB=wrapDB(f.raw,async(sql,method)=>{if(armed&&method==='run'&&/^UPDATE sessions SET last_seen/.test(sql)){armed=false;entered.resolve();await gate.promise;}});
 const pending=readSession(f.env,request(f.session.token,'/api/social/groups'));await entered.promise;
 if(change==='revoke')await db.revokeSession({DB:f.raw},f.session.id,Date.now());
 if(change==='suspend')await f.raw.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at)VALUES(?,?,?,?,?)').bind(f.user.id,f.user.id,'إيقاف',Date.now(),Date.now()).run();
 if(change==='delete')await f.raw.prepare('DELETE FROM users WHERE id=?').bind(f.user.id).run();gate.resolve();await assert.rejects(pending,change==='suspend'?/ACCOUNT_SUSPENDED/:/AUTH_EXPIRED/);
});
test('successful rotation carries a valid restricted replacement on403 without granting newly suspended access',async t=>{
 const f=await fixture(t,2*ROTATE_AFTER),base=f.raw.batch.bind(f.raw);f.env.DB=new Proxy(f.raw,{get(target,key){if(key==='batch')return async statements=>{const result=await base(statements);await f.raw.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at)VALUES(?,?,?,?,?)').bind(f.user.id,f.user.id,'إيقاف',Date.now(),Date.now()).run();return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const req=request(f.session.token,'/api/social/groups');await assert.rejects(readSession(f.env,req),/ACCOUNT_SUSPENDED/);const replacement=rotations.get(req);assert.ok(replacement?.token,'403 still carries the current valid token for account management');assert.equal((await readSession({DB:f.raw},request(replacement.token))).user.id,f.user.id);
});
for(const change of ['revoke','delete'])test(`a ${change} after the atomic rotation cannot expose a rejected replacement`,async t=>{
 const f=await fixture(t,2*ROTATE_AFTER),base=f.raw.batch.bind(f.raw);f.env.DB=new Proxy(f.raw,{get(target,key){if(key==='batch')return async statements=>{const result=await base(statements);if(change==='revoke')await f.raw.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND id!=?').bind(Date.now(),f.user.id,f.session.id).run();else await f.raw.prepare('DELETE FROM users WHERE id=?').bind(f.user.id).run();return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const req=request(f.session.token);await assert.rejects(readSession(f.env,req),/AUTH_EXPIRED/);assert.equal(rotations.has(req),false);
});
