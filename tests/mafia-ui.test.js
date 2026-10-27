import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as mafia from '../server/mafia-model.mjs';
import { createDesignFixture } from '../src/design/screen-catalog.js';

let directory, render;
before(async () => {
  mkdirSync('.cache',{recursive:true}); directory=mkdtempSync(path.resolve('.cache/mafia-ui-'));
  await build({stdin:{contents:`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{MafiaMatch,MafiaDirectory,MafiaSettings}from'./src/online/Mafia.jsx';const c={match:MafiaMatch,directory:MafiaDirectory,settings:MafiaSettings};export const render=(name,p)=>renderToStaticMarkup(React.createElement(c[name],p)).replace(/<style>[\\s\\S]*?<\\/style>/g,'');`,resolveDir:process.cwd(),loader:'jsx'},outfile:path.join(directory,'renderer.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.js':'jsx','.css':'text','.webp':'dataurl','.woff2':'dataurl'},logLevel:'silent'});
  ({render}=await import(pathToFileURL(path.join(directory,'renderer.mjs'))));
});
after(()=>{if(directory){assert.ok(directory.startsWith(path.resolve('.cache')+path.sep));rmSync(directory,{recursive:true,force:true});}});
function fixture(scene='online.mafia.night') {const {state,me}=createDesignFixture(scene,{now:Date.now()});return{state,me,isHost:true,act:()=>true,accountId:'owner'};}

test('Mafia role is not mounted until its owner explicitly reveals it',()=>{
  const props=fixture();delete props.state.previewReveal;
  assert.doesNotMatch(render('match',props),/data-design-id="role-content"/);
  assert.doesNotMatch(render('match',props),/>المحقق</,'Collapsed card must not repeat its role in the ability heading');
  assert.match(render('match',props),/اكشف بطاقتي/);
  props.state.previewReveal=true;
  assert.match(render('match',props),/data-design-id="role-content"/);
  assert.match(render('match',props),/المحقق/);
});
test('late arrivals cannot obtain live chat, private role, reports or ability markup',()=>{
  const props=fixture();props.state.waiting=true;props.state.phase='waiting';
  props.state.chats.public=[{id:1,text:'SECRET_CURRENT_CHAT'}];props.state.you.reports=[{text:'SECRET_REPORT'}];
  const html=render('match',props);
  assert.match(html,/تدخل في المباراة التالية/);
  assert.doesNotMatch(html,/SECRET_|role-card|role-content|ability-submit|voice-join|message-input/);
});
test('eliminated players see observer notices and cannot submit night powers or votes',()=>{
  const props=fixture('online.mafia.nomination');props.me.alive=false;props.state.you.alive=false;
  const html=render('match',props);
  assert.match(html,/أنت الآن تتابع المجلس/);
  assert.doesNotMatch(html,/data-design-id="ability-submit"|data-design-id="target"/);
  assert.match(html,/مجلس المقصيين|حديث المقصيين|متابعة الأحياء/);
});
test('night chat uses team projection only; public text is not mixed into the secret channel',()=>{
  const props=fixture('online.mafia.night.mafia');props.state.chats={public:[{id:1,text:'PUBLIC_SENTINEL'}],team:[{id:2,playerId:props.me.id,text:'TEAM_SENTINEL'}],observers:[{id:3,text:'OBSERVER_SENTINEL'}]};
  const html=render('match',props);
  assert.match(html,/TEAM_SENTINEL/);assert.doesNotMatch(html,/PUBLIC_SENTINEL|OBSERVER_SENTINEL/);
});

test('quiet night voice explains automatic return and never promises an available microphone',()=>{
  const props=fixture();props.state.you.voice={canListen:false,canSpeak:false};
  props.voice={status:'silent',requested:true,muted:true,canPublish:false,onMute:()=>{},onLeave:()=>{}};
  const html=render('match',props);assert.match(html,/الليل هادئ الآن/);assert.match(html,/سيعود صوت المجلس تلقائيًا/);
  assert.match(html,/<button(?=[^>]*data-design-id="mute")(?=[^>]*disabled)[^>]*>/);assert.doesNotMatch(html,/الانضمام بالصوت|شغّل الميكروفون/);
});

test('a requested voice connection always offers an explicit cancel while connecting or recovering',()=>{
  for(const status of ['connecting','reconnecting']){
    const props=fixture();props.voice={status,requested:true,canPublish:true,onMute:()=>{},onLeave:()=>{}};
    const html=render('match',props);assert.match(html,/<button(?=[^>]*data-design-id="voice-leave")(?![^>]*disabled)[^>]*>/);
    assert.match(html,/<button(?=[^>]*data-design-id="mute")(?=[^>]*disabled)[^>]*>/);assert.doesNotMatch(html,/data-design-id="voice-join"/);
  }
});
test('confirmed daytime ballots cannot be resubmitted from the UI, including abstention',()=>{
  const props=fixture('online.mafia.nomination');props.state.you.nominationSubmitted=true;props.state.you.myNomination=null;
  assert.doesNotMatch(render('match',props),/ability-submit|data-design-id="abstain"/);
  props.state.phase='verdict';props.state.you.verdictSubmitted=true;props.state.you.myVerdict=false;
  assert.doesNotMatch(render('match',props),/verdict-yes|verdict-no/);
});
test('an unavailable public directory cannot create a room or falsely claim successful matchmaking',()=>{
  const html=render('directory',{enabled:false,rooms:[],mode:'classic'});
  assert.match(html,/غير متاحة حاليًا/);assert.match(html,/<button(?=[^>]*data-design-id="quick-join")(?=[^>]*disabled)[^>]*>/);
  assert.doesNotMatch(html,/تم الانضمام|مكانك محفوظ/);
});
test('recap displays server-revealed roles but never serializes private chats',()=>{
  const props=fixture('online.mafia.over');props.state.chats.team=[{text:'DO_NOT_PUBLISH_TEAM'}];
  const html=render('match',props);assert.match(html,/data-design-id="recap"/);assert.match(html,/المحقق/);assert.doesNotMatch(html,/DO_NOT_PUBLISH_TEAM/);
});
test('real authoritative snapshots for every room size render across all timed stages',()=>{
  for(let n=6;n<=12;n++){
    const now=Date.now(),input=i=>({id:`player-${i}`,name:`لاعب ${i}`,avatar:i%4,tokenHash:`hash-${i}`});
    const room=mafia.createRoom('123456',{...input(0),settings:{mode:n>8?'shadow':'classic',capacity:n,visibility:'private'}},now);
    for(let i=1;i<n;i++)mafia.joinRoom(room,input(i),now);
    for(let i=0;i<n;i++){mafia.connected(room,`player-${i}`,true,now);mafia.action(room,`player-${i}`,{type:'ready',ready:true,matchId:room.matchId,phaseId:room.phaseId},now);}
    mafia.action(room,room.hostId,{type:'start',matchId:room.matchId,phaseId:room.phaseId},now,{randomWord:()=>0});
    for(let step=0;step<6;step++){
      for(const member of room.members){const state=mafia.snapshot(room,member.id,now),html=render('match',{state,me:state.members.find(m=>m.id===member.id),accountId:member.id});assert.ok(html.includes('مافيا ميدان'));assert.doesNotMatch(html,/undefined|\[object Object\]/);}
      if(room.deadlineAt)mafia.tick(room,room.deadlineAt);
    }
  }
});

test('private reports explain conversion, failed recruitment and consumed defense without inventing a failure cause',()=>{
  const props=fixture('online.mafia.clues');props.state.previewTab='clues';props.state.you.reports=[{id:1,type:'converted',faction:'shadow'},{id:2,type:'recruitment',success:false},{id:3,type:'shield_used'},{id:4,type:'no_result'}];
  const html=render('match',props);assert.match(html,/انضممت إلى رابطة الظل/);assert.match(html,/لا يُكشف سبب الفشل/);assert.match(html,/استُهلكت الحماية الوحيدة/);assert.match(html,/تعذّر النتيجة/);assert.doesNotMatch(html,/لاعب: رابطة الظل/);
});


test('noir public room cards expose only the received directory and preserve verified enablement',()=>{
  const props={enabled:true,mode:'classic',rooms:[{code:'123456',hostName:'ليان',mode:'classic',capacity:8,players:5,ready:2}],onCreate:()=>{}};
  const html=render('directory',props);assert.match(html,/الغرف العامة/);assert.match(html,/data-room-code="123456"/);assert.match(html,/مجلس ليان/);assert.match(html,/data-design-id="create-public-room"/);
  for(const loading of [true,false]){const blocked=render('directory',{...props,disabled:true,loading});assert.match(blocked,/<select(?=[^>]*data-design-id="directory-mode")(?=[^>]*disabled)/);assert.match(blocked,/<button(?=[^>]*data-design-id="refresh")(?=[^>]*disabled)/);}
});
test('integrated Mafia controls retain audio recovery and identify the exact owned replacement',()=>{
  const props=fixture('online.mafia.discussion');props.state.mafiaVoice={callId:'owned-call'};props.voice={status:'connected',requested:true,muted:true,canPublish:true,audioBlocked:true,onResume:()=>{},onLeave:()=>{}};
  const html=render('match',props);assert.match(html,/data-mafia-call-controls="owned-call"/);assert.match(html,/data-mafia-controls-ready="true"/);assert.match(html,/data-design-id="voice-resume"/);assert.match(html,/اضغط لاستعادة الصوت/);
  props.voice.onLeave=undefined;assert.match(render('match',props),/data-mafia-controls-ready="false"/);
});
test('narrative public events and messages sort by their server times and escape user text',()=>{
  const props=fixture('online.mafia.discussion');props.state.log=[{id:'late',type:'dawn',at:30,text:'LATE_EVENT'}];props.state.chats={public:[{id:'early',at:10,playerId:props.me.id,text:'<script>EARLY_MESSAGE</script>'}],team:[{id:'private',text:'PRIVATE_SENTINEL'}]};
  const html=render('match',props);assert.ok(html.indexOf('EARLY_MESSAGE')<html.indexOf('LATE_EVENT'));assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|PRIVATE_SENTINEL/);assert.match(html,/data-design-id="player-rail"/);
});
test('an account mismatch never renders another player private card, actions or reports',()=>{
  const props=fixture('online.mafia.clues');props.state.previewReveal=true;props.state.previewTab='clues';props.state.you.id='different-owner';props.state.you.reports=[{text:'OTHER_OWNER_SECRET'}];
  const html=render('match',props);assert.doesNotMatch(html,/role-card|role-content|ability-submit|OTHER_OWNER_SECRET/);
});
