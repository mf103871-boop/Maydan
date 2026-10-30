import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {MafiaProgressClient,getMafiaProgress,getMafiaReward,patchPreferences} from '../src/profiles/mafia-client.js';
import {getMafiaAchievement} from '../src/profiles/mafia-catalog.js';

const profile=(revision=0)=>({available:true,revision,preferences:{visibility:'private',representativeRoleId:null},
  progress:{totalXp:300,level:2,xpInLevel:50,xpPerLevel:250,rewardedMatches:6,legacyMatches:9},
  roles:[{roleId:'investigator',qualifiedMatches:3,wins:2,draws:1,legacyMatches:4,mastery:1,representativeUnlocked:true},
    {roleId:'leader',qualifiedMatches:999,wins:1,draws:0,legacyMatches:0,mastery:0,representativeUnlocked:false}],
  achievements:[{id:'mafia_first_qualified',earnedAt:1}],grants:[{itemId:'noir.frame',source:'mafia_achievement'}]});
const session=id=>({server:'https://fixture.test',viewerId:id,targetId:'me',auth:{Authorization:`Bearer fake-${id}`}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const root=process.cwd(),cache=path.join(root,'.cache');await mkdir(cache,{recursive:true});
const dir=await mkdtemp(path.join(cache,'mafia-progress-ui-'));
after(async()=>{assert.equal(path.dirname(dir),cache);await rm(dir,{recursive:true,force:true});});
await build({stdin:{resolveDir:root,loader:'jsx',contents:`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{MafiaProgressView}from'./src/profiles/mafia-panel.jsx';export const render=props=>renderToStaticMarkup(React.createElement(MafiaProgressView,props)).replace(/<style>[\\s\\S]*?<\\/style>/g,'');`},outfile:path.join(dir,'render.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'text'},logLevel:'silent'});
const {render}=await import(pathToFileURL(path.join(dir,'render.mjs')));

test('mafia HTTP functions pin canonical routes, snapshot auth, JSON writes and uncached omitted credentials',async()=>{
  const calls=[],fetchImpl=async(url,options)=>{calls.push({url,options});return Response.json({available:false});};
  const auth={Authorization:'Bearer fixture'};
  await getMafiaProgress('https://fixture.test/',auth,'me',{fetchImpl});
  await getMafiaProgress('https://fixture.test',auth,'friend',{fetchImpl});
  await getMafiaReward('https://fixture.test',auth,'room:match-1',{fetchImpl});
  await patchPreferences('https://fixture.test',auth,{revision:2,visibility:'friends',representativeRoleId:null},{fetchImpl});
  assert.deepEqual(calls.map(call=>new URL(call.url).pathname),['/api/me/mafia/progress','/api/profiles/friend/mafia','/api/me/mafia/rewards/room%3Amatch-1','/api/me/mafia/preferences']);
  assert.ok(calls.every(({options})=>options.credentials==='omit'&&options.cache==='no-store'&&options.headers.Authorization==='Bearer fixture'));
  assert.equal(calls[3].options.method,'PATCH');assert.equal(JSON.parse(calls[3].options.body).revision,2);
  await assert.rejects(getMafiaReward('https://fixture.test',auth,'../match',{fetchImpl}),{code:'INVALID'});
  await assert.rejects(getMafiaProgress('https://fixture.test',auth,'../friend',{fetchImpl}),{code:'INVALID'});
});

test('abort remains active through response body consumption and sanitizes transport/server failures',async()=>{
  const pending=deferred(),controller=new AbortController();
  const task=getMafiaProgress('https://fixture.test',{},'me',{signal:controller.signal,fetchImpl:async()=>({ok:true,json:()=>pending.promise})});
  controller.abort();pending.resolve(profile());await assert.rejects(task,{code:'ABORTED'});
  await assert.rejects(getMafiaReward('https://fixture.test',{},'key',{fetchImpl:async()=>Response.json({error:'MAFIA_SOCIAL_LOCKED'},{status:409})}),{code:'MAFIA_SOCIAL_LOCKED'});
  await assert.rejects(getMafiaProgress('https://fixture.test',{},'me',{fetchImpl:async()=>{throw new Error('SECRET_TRANSPORT');}}),error=>error.code==='NETWORK'&&!error.message.includes('SECRET'));
});

test('invalid server URLs reject before any request can send account authorization',async()=>{
  let calls=0;const options={fetchImpl:async()=>{calls++;return Response.json({available:false});}},auth={Authorization:'Bearer fixture-only'};
  for(const server of ['', 'not-a-url','http://remote.example','https://name:password@fixture.test','https://fixture.test/path',
    'https://fixture.test?redirect=elsewhere','https://fixture.test#fragment','javascript:alert(1)','//fixture.test']){
    await assert.rejects(getMafiaProgress(server,auth,'me',options),{code:'CONFIG'});
    await assert.rejects(getMafiaReward(server,auth,'room:match',options),{code:'CONFIG'});
    await assert.rejects(patchPreferences(server,auth,{revision:0,visibility:'private'},options),{code:'CONFIG'});
  }
  assert.equal(calls,0);
  await getMafiaProgress('http://127.0.0.1:3000/',auth,'me',options);assert.equal(calls,1,'explicit loopback remains available for isolated local tests');
});

test('A-B-A account fence and same-account logout cancel late reads without restoring cached progress',async()=>{
  const responses=[deferred(),deferred(),deferred()],signals=[];let index=0;
  const client=new MafiaProgressClient({get:(_server,_auth,_id,{signal})=>{signals.push(signal);return responses[index++].promise;}});
  client.start(session('a'));const first=client.load();client.start(session('b'));const second=client.load();client.start(session('a'));const third=client.load();
  responses[0].resolve(profile(99));responses[1].resolve(profile(99));responses[2].resolve(profile(1));
  await assert.rejects(first,{code:'STALE'});await assert.rejects(second,{code:'STALE'});await third;
  assert.equal(signals[0].aborted,true);assert.equal(signals[1].aborted,true);assert.equal(client.state.data.revision,1);
  client.start(null);assert.equal(client.state.data,null);assert.equal(client.state.error,null);
});

test('pre-save GET cannot undo PATCH; concurrent saves fail and revision conflict preserves the draft base',async()=>{
  const read=deferred(),write=deferred(),client=new MafiaProgressClient({get:()=>read.promise,patch:()=>write.promise});
  client.start(session('a'));const pending=client.load(),save=client.save({revision:0,visibility:'public'});
  await assert.rejects(client.save({revision:0}),{code:'BUSY'});write.resolve(profile(2));await save;
  read.resolve(profile(1));await assert.rejects(pending,{code:'STALE'});assert.equal(client.state.data.revision,2);
  client.patch=async()=>{throw Object.assign(new Error('conflict'),{code:'CONFLICT'});};
  await assert.rejects(client.save({revision:2}),{code:'CONFLICT'});assert.equal(client.state.data.revision,2);assert.equal(client.state.saving,false);
});

test('a late preference PATCH from the first A cannot mutate a new A session or its busy state',async()=>{
  const write=deferred(),client=new MafiaProgressClient({get:async()=>profile(1),patch:()=>write.promise});
  client.start(session('a'));await client.load();const pending=client.save({revision:1,visibility:'public'});
  client.start(session('b'));client.start({...session('a'),auth:{Authorization:'Bearer new-a'}});await client.load();
  write.resolve({...profile(8),preferences:{visibility:'public',representativeRoleId:'leader'}});
  await assert.rejects(pending,{code:'STALE'});assert.equal(client.state.data.revision,1);
  assert.equal(client.state.data.preferences.visibility,'private');assert.equal(client.state.saving,false);
});

test('refresh clears previously visible public information and unavailable/blocked/error responses cannot retain it',async()=>{
  const client=new MafiaProgressClient({get:async()=>profile()});client.start({...session('a'),targetId:'friend'});await client.load();
  const response=deferred();client.get=()=>response.promise;const pending=client.load();assert.equal(client.state.data,null);
  response.resolve({available:false});await pending;assert.deepEqual(client.state.data,{available:false});
  client.get=async()=>{throw Object.assign(new Error('hidden'),{code:'NOT_FOUND'});};
  await assert.rejects(client.load(),{code:'NOT_FOUND'});assert.equal(client.state.data,null);
  client.get=async()=>({available:true,roles:[],progress:{totalXp:Infinity}});
  await assert.rejects(client.load(),{code:'NETWORK'});assert.equal(client.state.data,null);
});

test('progress panel separates qualified samples and imported history, derives no entitlement from inflated counters',()=>{
  const html=render({owner:true,state:{data:profile()}});
  for(const text of ['المستوى','XP','عينة مؤهلة','العينة صغيرة','سجل سابق منفصل','دون XP أو إتقان','الدور الممثل','اختيار ثابت لبروفايلك',getMafiaAchievement('mafia_first_qualified').label,'إطار ليلة مافيا','إنجاز مافيا'])assert.ok(html.includes(text),text);
  assert.match(html,/aria-label="خبرة المستوى في مافيا" aria-valuemin="0" aria-valuemax="250" aria-valuenow="50"/);
  assert.match(html,/<option value="leader" disabled/);assert.match(html,/<option value="private" selected/);
  assert.doesNotMatch(html,/دورك الحالي|فريقك الحالي|fake-|Bearer|noir\.frame/);
  const publicHTML=render({owner:false,state:{data:profile()}});assert.doesNotMatch(publicHTML,/حفظ إعدادات|مكافآتك الدائمة/);
});

test('loading, hidden, match-locked and errors conceal stale stats; preference conflict remains actionable',()=>{
  for(const state of [{loading:true,data:profile()},{data:{available:false}},{data:{available:false,preferencesLocked:true}},{error:'NETWORK'}]){
    const html=render({owner:true,state});assert.doesNotMatch(html,/عينة مؤهلة|المستوى|المحقق|سجل سابق منفصل|حفظ إعدادات/);
  }
  assert.match(render({owner:true,state:{data:profile(),error:'CONFLICT'}}),/أعد التحميل وراجع اختياراتك/);
  assert.match(render({owner:true,state:{data:{available:false,preferencesLocked:true}}}),/بعد انتهاء مباراة مافيا أو المشاهدة/);
});
