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
