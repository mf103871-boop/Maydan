import test from 'node:test';
import assert from 'node:assert/strict';
import { localEnvironment } from '../server/local.mjs';
import { routeRequest } from '../server/worker.mjs';
import { createUser, upsertSubscription, deleteUser, addTrial } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { roomGate, consumeRoomTrial, recheckMafiaHost } from '../server/accounts/router.mjs';
import { effectiveCosmetics, plusActiveFor, plusAccessSql } from '../server/plus/access.mjs';
import { normalizePresetSettings } from '../server/plus/presets.mjs';
import { profileFor, ensurePlayerProfile, profileSummaries } from '../server/profiles/db.mjs';
import { availableCollections } from '../src/plus/catalog.js';
import { normalizeSelection } from '../server/plus/access.mjs';
import { GRACE_MS } from '../src/shared/account/config.js';

const ORIGIN='http://localhost:3000';
async function setup(t,vars={}) {
  const runtime=localEnvironment({vars}),env=runtime.env;t.after(()=>runtime.dispose());
  async function person(name='لاعب') {const user=await createUser(env,{name,email:`${crypto.randomUUID()}@example.test`}),session=await issueSession(env,user.id);return {...user,token:session.token};}
  async function api(user,path,body,method=body===undefined?'GET':'POST') {
    const request=new Request(ORIGIN+path,{method,headers:{origin:ORIGIN,...(user?{authorization:`Bearer ${user.token}`}:{ }),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const response=await routeRequest(request,env);return {status:response.status,body:await response.json()};
  }
  async function grant(user,{until=Date.now()+86400000,status='active',source='promo',environment='promo'}={}) {
    await upsertSubscription(env,{source,external_id:`test-${user.id}`,user_id:user.id,product:'plus.monthly',status,until,will_renew:false,environment,occurred_at:Date.now()});
  }
  return {env,person,api,grant};
}
test('catalog stays public while cosmetics are account-private and server Plus gated',async t=>{
  const h=await setup(t),a=await h.person(),b=await h.person();
  const catalog=await h.api(null,'/api/cosmetics/catalog');assert.equal(catalog.status,200);assert.equal(catalog.body.collections.length,availableCollections(catalog.body.serverTime).length);
  assert.equal((await h.api(null,'/api/me/cosmetics')).status,401);
  const initial=await h.api(a,'/api/me/cosmetics');assert.equal(initial.body.eligible,false);assert.equal(initial.body.revision,0);
  assert.equal((await h.api(a,'/api/me/cosmetics',{selection:{frameId:'sahra.frame'},revision:0},'PATCH')).status,402);
  await h.grant(a);
  const saved=await h.api(a,'/api/me/cosmetics',{selection:{frameId:'sahra.frame',avatarId:'artist.avatar',badge:true},revision:0},'PATCH');
  assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.effective.frameId,'sahra.frame');assert.equal(saved.body.revision,1);
  assert.equal((await h.api(b,'/api/me/cosmetics')).body.preferred.frameId,null);
  assert.equal((await h.api(a,'/api/me/cosmetics',{selection:{frameId:'sahra.avatar'},revision:1},'PATCH')).status,400);
  assert.throws(()=>normalizeSelection({frameId:'olive.frame'},Date.UTC(2026,9,28)),{code:'INVALID'});
  assert.equal((await h.api(a,'/api/me/cosmetics',{selection:{frameId:'sahra.frame',url:'https://evil.test'},revision:1},'PATCH')).status,400);
});
test('expiry preserves preference, public fallback and old revisions cannot overwrite it',async t=>{
  const h=await setup(t),a=await h.person();await h.grant(a);await ensurePlayerProfile(h.env,a.id);
  assert.equal((await h.api(a,'/api/me/cosmetics',{selection:{coverId:'noir.cover',nameColorId:'noir.nameColor',badge:true},revision:0},'PATCH')).status,200);
  const saves=await Promise.all(['artist.frame','sahra.frame'].map(frameId=>h.api(a,'/api/me/cosmetics',{selection:{frameId},revision:1},'PATCH')));
  assert.deepEqual(saves.map(r=>r.status).sort(),[200,409]);
  const before=await h.api(a,'/api/me/cosmetics');
  await h.grant(a,{until:Date.now()-GRACE_MS-1000,status:'expired'});
  const expired=await h.api(a,'/api/me/cosmetics');assert.equal(expired.body.effective.coverId,null);assert.equal(expired.body.preferred.coverId,'noir.cover');
  assert.equal((await profileFor(h.env,a.id,a.id)).cosmetics.coverId,null);
  assert.equal((await profileSummaries(h.env,[a.id])).get(a.id).cosmetics.badge,false);
  const clear=await h.api(a,'/api/me/cosmetics',{selection:{frameId:null,coverId:null,badge:false},revision:before.body.revision},'PATCH');assert.equal(clear.status,200);
  assert.equal((await h.api(a,'/api/me/cosmetics',{selection:{badge:true},revision:clear.body.revision},'PATCH')).status,402);
  await h.grant(a);assert.equal((await effectiveCosmetics(h.env,a.id)).nameColorId,'noir.nameColor');
});
test('billing environment, refunds and live-account guard also protect cosmetic SQL writes',async t=>{
  const h=await setup(t,{PADDLE_ENV:'production'}),a=await h.person();
  await h.grant(a,{source:'apple',environment:'Sandbox'});assert.equal(await plusActiveFor(h.env,a.id),false);
  const sql=()=>h.env.DB.prepare(`SELECT ${plusAccessSql(h.env,'?',Date.now())} AS eligible`).bind(a.id).first();assert.equal((await sql()).eligible,0);
  h.env.APPLE_ALLOW_SANDBOX_ENTITLEMENTS='1';assert.equal(await plusActiveFor(h.env,a.id),true);assert.equal((await sql()).eligible,1);
  await h.grant(a,{source:'apple',environment:'Sandbox',status:'refunded'});assert.equal(await plusActiveFor(h.env,a.id),false);assert.equal((await sql()).eligible,0);
});
test('presets whitelist all eight games and reject words, roles, decks and replay consent',()=>{
  const values={badeeha:{mode:'expert',roundSize:20,timer:30,categories:['general','geo','capitals','science','animals','history']},beep:{mode:'bomb',seconds:7,rounds:3},mamnoo:{seconds:90,rounds:4},jabeen:{categoryId:'animals',control:'touch',seconds:45},meenfina:{mode:'secret',rounds:12},fabraka:{mode:'mixed',rounds:5,writeSeconds:30},ersomha:{mode:'cooperative',cycles:2,difficulty:'easy'},mafia:{mode:'shadow',capacity:12,visibility:'public'}};
  for(const [game,settings] of Object.entries(values)) {
    assert.ok(normalizePresetSettings(game,settings));
    for(const key of ['deck','words','roles','players','token','allowReplay'])assert.throws(()=>normalizePresetSettings(game,{...settings,[key]:[]}),{code:'INVALID'});
  }
  assert.throws(()=>normalizePresetSettings('mafia',{mode:'classic',capacity:12}),{code:'INVALID'});
  assert.throws(()=>normalizePresetSettings('badeeha',{categories:['unknown']}),{code:'INVALID'});
});
test('preset limit is atomic; apply requires Plus; list/delete survive expiry',async t=>{
  const h=await setup(t),a=await h.person(),b=await h.person();await h.grant(a);
  const results=await Promise.all(Array.from({length:12},(_,n)=>h.api(a,'/api/me/setup-presets',{name:`جلسة ${n}`,game:'ersomha',settings:{difficulty:'easy',cycles:1}})));
  assert.equal(results.filter(r=>r.status===201).length,10,JSON.stringify(results));assert.equal(results.filter(r=>r.body.error==='PRESET_LIMIT').length,2);
  const list=await h.api(a,'/api/me/setup-presets');assert.equal(list.body.presets.length,10);
  const p=list.body.presets[0],path=`/api/me/setup-presets/${p.id}`;
  assert.equal((await h.api(b,path+'/apply',{})).status,404);
  const applied=await h.api(a,path+'/apply',{});assert.equal(applied.status,200);assert.equal(applied.body.game,'ersomha');assert.equal('allowReplay' in applied.body.settings,false);
  const update=await h.api(a,path,{revision:p.revision,name:'الاسم الجديد'},'PATCH');assert.equal(update.status,200);
  assert.equal((await h.api(a,path,{revision:p.revision},'DELETE')).status,409);
  await h.grant(a,{status:'revoked'});
  assert.equal((await h.api(a,path+'/apply',{})).status,402);
  assert.equal((await h.api(a,'/api/me/setup-presets')).body.presets.length,10);
  assert.equal((await h.api(a,path,{revision:update.body.preset.revision},'DELETE')).status,200);
});
test('gameplay is free for spent trials without fabricating Plus or losing room account identity',async t=>{
  const h=await setup(t),a=await h.person();
  for(const game of ['beep','mamnoo','jabeen','fabraka','meenfina','ersomha','mafia'])await addTrial(h.env,a.id,game);
  const request=new Request(ORIGIN+'/api/rooms',{headers:{authorization:`Bearer ${a.token}`}});
  for(const game of ['badeeha','beep','mamnoo','jabeen','fabraka','meenfina','ersomha','mafia']) {
    const gate=await roomGate(request,h.env,{game});assert.equal(gate.userId,a.id);assert.equal(gate.gameplay,'free');assert.notEqual(gate.premium,true);
    await consumeRoomTrial(h.env,gate,'ignored');
  }
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) AS n FROM trials WHERE user_id=?').bind(a.id).first()).n,7,'historical trials are preserved');
  const me=await h.api(a,'/api/me');assert.equal(me.body.premium.active,false);assert.equal(me.body.gameplay.access,'free');assert.equal(me.body.plus.cosmetics,false);
  const room={hostId:'seat',members:[{id:'seat',accountUserId:a.id}]};await recheckMafiaHost(h.env,room);assert.equal(room.roomTrialGate.userId,a.id);
  await assert.rejects(()=>roomGate(new Request(ORIGIN+'/api/rooms'),h.env,{game:'mafia'}),{code:'AUTH_REQUIRED'});
});
test('legacy trial endpoints are no-op and new Plus records are removed by account deletion',async t=>{
  const h=await setup(t),a=await h.person();await h.grant(a);
  assert.equal((await h.api(a,'/api/trials/beep',{})).status,200);
  assert.equal((await h.api(a,'/api/trials/merge',{games:['mafia','ersomha']})).status,200);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) AS n FROM trials WHERE user_id=?').bind(a.id).first()).n,0);
  await h.api(a,'/api/me/cosmetics',{selection:{badge:true},revision:0},'PATCH');
  await h.api(a,'/api/me/setup-presets',{name:'سهرتي',game:'mafia',settings:{mode:'classic',capacity:6}});
  await deleteUser(h.env,a.id);
  for(const table of ['plus_cosmetics','plus_setup_presets'])assert.equal((await h.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`).bind(a.id).first()).n,0);
});
