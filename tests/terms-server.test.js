import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import * as db from '../server/accounts/db.mjs';
import { issueSession, ROTATE_AFTER } from '../server/accounts/session.mjs';
import { handleLegalRequest, legalStatus, requireCurrentTerms, termsPageResponse, termsDeleteStatements } from '../server/legal/terms.mjs';
import { termsIdentity, TERMS_VERSION } from '../src/shared/legal/terms.js';
const origin='https://terms.example.test';
const payload=locale=>({...termsIdentity(locale),accepted:true});
const request=(path,body,token,headers={})=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function fixture(t){const raw=createLocalD1(),env={DB:raw,SESSION_SECRET:'fixture-secret-only'},user=await db.createUser(env,{name:'Terms owner',email:'terms@example.test'}),session=await issueSession(env,user.id);t.after(()=>raw.close());return{raw,env,user,session};}
const rejects=(promise,code,status)=>assert.rejects(promise,error=>error.code===code&&(!status||error.status===status));
test('anonymous status cannot invent acceptance; explicit guest acceptance issues proof without a database row',async t=>{
 const f=await fixture(t),status=await(await handleLegalRequest(request('/api/legal/status'),f.env)).json();assert.equal(status.required,true);assert.equal(status.acceptance,null);
 await rejects(requireCurrentTerms(f.env,null,{request:request('/api/rooms')}),'TERMS_REQUIRED',403);
 const result=await(await handleLegalRequest(request('/api/legal/accept',payload('en')),f.env)).json();assert.equal(result.required,false);assert.ok(result.guestReceipt);
 const guest=request('/api/rooms',undefined,null,{'x-maydan-terms':result.guestReceipt});assert.equal((await requireCurrentTerms(f.env,null,{request:guest})).locale,'en');
 assert.equal((await f.raw.prepare('SELECT COUNT(*) AS n FROM legal_terms_acceptances').first()).n,0);
 await rejects(requireCurrentTerms(f.env,f.user.id,{request:guest}),'TERMS_REQUIRED');
});
test('signed acceptance persists server time, is idempotent, and does not replace the first language/time',async t=>{
 const f=await fixture(t),before=Date.now(); const first=await(await handleLegalRequest(request('/api/legal/accept',payload('ar'),f.session.token),f.env)).json();
 assert.equal(first.required,false);assert.ok(first.acceptance.acceptedAt>=before&&first.acceptance.acceptedAt<=Date.now());assert.equal(first.guestReceipt,undefined);
 const second=await(await handleLegalRequest(request('/api/legal/accept',payload('en'),f.session.token),f.env)).json();assert.deepEqual(second.acceptance,first.acceptance);
 assert.equal((await legalStatus(f.env,f.user.id)).required,false);assert.equal((await requireCurrentTerms(f.env,f.user.id)).locale,'ar');
 const other=await db.createUser(f.env,{name:'Other',email:'other@example.test'});assert.equal((await legalStatus(f.env,other.id)).required,true);
});
test('old versions require fresh acceptance and explicit account cleanup removes all versions',async t=>{
 const f=await fixture(t);await f.raw.prepare('INSERT INTO legal_terms_acceptances VALUES(?,?,?,?,?)').bind(f.user.id,'old','old-hash','ar',Date.now()-1000).run();
 assert.equal((await legalStatus(f.env,f.user.id)).required,true);await handleLegalRequest(request('/api/legal/accept',payload('en'),f.session.token),f.env);
 assert.equal((await f.raw.prepare('SELECT COUNT(*) AS n FROM legal_terms_acceptances').first()).n,2);
 await f.raw.batch(termsDeleteStatements(f.env,f.user.id));assert.equal((await legalStatus(f.env,f.user.id)).required,true);
});
test('only the current explicit four-field payload is accepted; client timestamps and stale hashes are rejected',async t=>{
 const f=await fixture(t);
 for(const input of [{...payload('ar'),accepted:false},{...payload('ar'),accepted:'true'},{...payload('ar'),acceptedAt:1},{...payload('ar'),userId:f.user.id}])await rejects(handleLegalRequest(request('/api/legal/accept',input,f.session.token),f.env),'INVALID',400);
 for(const input of [{...payload('ar'),termsVersion:'old'},{...payload('ar'),documentHash:'x'},{...payload('ar'),locale:'fr'}])await rejects(handleLegalRequest(request('/api/legal/accept',input,f.session.token),f.env),'TERMS_VERSION_CHANGED',409);
 await rejects(handleLegalRequest(request('/api/legal/accept',{...payload('ar'),extra:'x'.repeat(700)},f.session.token),f.env),'INVALID',413);
 assert.equal((await legalStatus(f.env,f.user.id)).required,true);
});
test('revoked or malformed bearer cannot silently receive a guest receipt',async t=>{
 const f=await fixture(t);await db.revokeSession(f.env,f.session.id,Date.now());
 for(const token of [f.session.token,'malformed'])await rejects(handleLegalRequest(request('/api/legal/accept',payload('ar'),token),f.env),'AUTH_EXPIRED');
});
test('suspended owners can read and accept terms without restoring their playing access',async t=>{
 const f=await fixture(t),now=Date.now();await f.raw.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at)VALUES(?,?,?,?,?)').bind(f.user.id,f.user.id,'fixture suspension',now,now).run();
 assert.equal((await(await handleLegalRequest(request('/api/legal/status',undefined,f.session.token),f.env)).json()).required,true);
 assert.equal((await(await handleLegalRequest(request('/api/legal/accept',payload('ar'),f.session.token),f.env)).json()).required,false);
 assert.ok(await f.raw.prepare('SELECT user_id FROM moderation_suspensions WHERE user_id=?').bind(f.user.id).first());
});
test('concurrent explicit requests preserve exactly one first acceptance',async t=>{
 const f=await fixture(t);const results=await Promise.all(['ar','en'].map(async locale=>(await handleLegalRequest(request('/api/legal/accept',payload(locale),f.session.token),f.env)).json()));
 assert.deepEqual(results[0].acceptance,results[1].acceptance);assert.equal((await f.raw.prepare('SELECT COUNT(*) AS n FROM legal_terms_acceptances').first()).n,1);
});
test('a rotated session remains eligible during its intentional five-minute grace',async t=>{
 const f=await fixture(t),replacement=await issueSession(f.env,f.user.id);await f.raw.prepare('UPDATE sessions SET revoked_at=?,replaced_by=? WHERE id=?').bind(Date.now()+300_000,replacement.id,f.session.id).run();
 assert.equal((await(await handleLegalRequest(request('/api/legal/accept',payload('ar'),f.session.token),f.env)).json()).required,false);
});
test('rotation during the initial authentication retries with its fresh snapshot and returns the replacement token',async t=>{
 const f=await fixture(t);await f.raw.prepare('UPDATE sessions SET last_seen=? WHERE id=?').bind(Date.now()-ROTATE_AFTER-1000,f.session.id).run();
 const response=await handleLegalRequest(request('/api/legal/accept',payload('en'),f.session.token),f.env);assert.equal(response.status,200);assert.match(response.headers.get('x-maydan-session'),/^mdn1\./);
 assert.equal((await response.json()).required,false);assert.equal((await f.raw.prepare('SELECT COUNT(*) AS n FROM legal_terms_acceptances').first()).n,1);
});
for(const race of ['revoke','expire','delete','deleting'])test(`${race} between authentication and insert cannot produce an account acceptance`,async t=>{
 const f=await fixture(t),prepare=f.raw.prepare.bind(f.raw);let armed=true;
 f.env.DB={prepare(sql){const statement=prepare(sql);return {bind(...values){const bound=statement.bind(...values);return {first:()=>bound.first(),async run(){if(armed&&sql.startsWith('INSERT INTO legal_terms_acceptances')){armed=false;if(race==='revoke'||race==='expire'){await new Promise(resolve=>setTimeout(resolve,8));assert.ok(Date.now()>values[3],'expiry/revocation must occur after the acceptance timestamp was bound');if(race==='revoke')await db.revokeSession({DB:f.raw},f.session.id,Date.now());else await prepare('UPDATE sessions SET expires_at=? WHERE id=?').bind(Date.now(),f.session.id).run();}else if(race==='delete')await prepare('DELETE FROM users WHERE id=?').bind(f.user.id).run();else await prepare('INSERT INTO account_deletions VALUES(?,?,?)').bind(f.user.id,'deletion',Date.now()).run();}return bound.run();}};}};}};
 await assert.rejects(handleLegalRequest(request('/api/legal/accept',payload('ar'),f.session.token),f.env),error=>['AUTH_EXPIRED','TERMS_VERSION_CHANGED'].includes(error.code));
 assert.equal((await prepare('SELECT COUNT(*) AS n FROM legal_terms_acceptances WHERE terms_version=?').bind(TERMS_VERSION).first()).n,0);
});
test('public bilingual terms have no executable script, support HEAD and reject arbitrary locales/methods',async()=>{
 for(const locale of ['ar','en']){const response=termsPageResponse('GET',locale),html=await response.text();assert.equal(response.status,200);assert.equal(response.headers.get('content-language'),locale);assert.match(html,new RegExp(`<html lang="${locale}" dir="${locale==='ar'?'rtl':'ltr'}"`));assert.ok(html.includes('mf103871@gmail.com'));assert.doesNotMatch(html,/<script|<form|onload=/);assert.equal(await termsPageResponse('HEAD',locale).text(),'');assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);}
 assert.equal(termsPageResponse('GET','<script>').status,400);assert.equal(termsPageResponse('POST','ar').status,405);
});
