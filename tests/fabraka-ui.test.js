// Privacy regressions at the rendered markup boundary. The engine tests cover
// transitions; these ensure private data never reaches a closed/pass-phone view.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { initialState, reduce, currentActor, turnKey, TRUTH_ID } from '../src/games/fabraka/logic.js';

const root=process.cwd();
mkdirSync(path.join(root,'.cache'),{recursive:true});
const temp=mkdtempSync(path.join(root,'.cache','fabraka-ui-'));
after(()=>rmSync(temp,{recursive:true,force:true}));
await build({stdin:{contents:`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {Game,SetupOptions,Results} from './src/games/fabraka/Game.jsx'; import {Illustration} from './src/games/fabraka/Illustration.jsx'; export const game=p=>renderToStaticMarkup(React.createElement(Game,p)); export const setup=p=>renderToStaticMarkup(React.createElement(SetupOptions,p)); export const results=p=>renderToStaticMarkup(React.createElement(Results,p)); export const picture=q=>renderToStaticMarkup(React.createElement(Illustration,{question:q}));`,resolveDir:root,loader:'jsx'},outfile:path.join(temp,'render.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'text','.webp':'dataurl','.woff2':'dataurl'},logLevel:'silent'});
const render=await import(pathToFileURL(path.join(temp,'render.mjs')));
const noop=()=>{};
const api={storage:{get:(_k,fallback)=>fallback,set:()=>true},sound:{play:noop},haptics:{vibrate:noop},confetti:{fire:noop},setInGame:noop};
const players=[{id:'a',name:'PLAYER_A'},{id:'b',name:'PLAYER_B'},{id:'c',name:'PLAYER_C'}];
const deck=Array.from({length:24},(_,i)=>({id:`q${i}`,text:`سؤال ${i}: ___.`,answer:'CORRECT_TOKEN',aliases:[],decoys:['HOUSE_ONE','HOUSE_TWO','HOUSE_THREE'],explanation:'EXPLANATION_TOKEN',kind:'text',sourceUrl:'https://example.com/fabraka-answer'}));
const make=opts=>initialState(players,{writeSeconds:0,discussionSeconds:20,...opts},{deck,seed:1});
const go=(s,type,extra={})=>reduce(s,{type,round:s.round,key:turnKey(s),playerId:currentActor(s)?.id,...extra});
const html=s=>render.game({api,players,savedSession:s,onExit:noop}).replace(/<style>[\s\S]*?<\/style>/g,'');
function written(){let s=go(go(make(),'BEGIN'),'START_WRITING');for(let i=0;i<3;i++){s=go(s,'READY');s=go(s,'DRAFT',{text:`LIE_TOKEN_${i}`});s=go(s,'SUBMIT_LIE');}return s;}

test('restoring a private writing/host/voting screen cannot render drafts or answers',()=>{
  let write=go(go(make(),'BEGIN'),'START_WRITING');write=go(write,'READY');write=go(write,'DRAFT',{text:'PRIVATE_DRAFT_TOKEN'});
  let host=go(make({mode:'friends'}),'BEGIN');host=go(host,'READY');host=go(host,'DRAFT',{text:'PRIVATE_DRAFT_TOKEN'});
  let vote=go(written(),'START_VOTE');vote=go(vote,'READY');
  for(const s of [write,host,vote]){
    const markup=html(s);assert.match(markup,/privacy-gate/);assert.doesNotMatch(markup,/<input|PRIVATE_DRAFT_TOKEN|CORRECT_TOKEN|LIE_TOKEN_|EXPLANATION_TOKEN|fabraka-answer/);
  }
});

test('public discussion lists answers anonymously with no truth/source markers',()=>{
  const markup=html(written());
  assert.match(markup,/CORRECT_TOKEN/);assert.match(markup,/LIE_TOKEN_0/);
  assert.doesNotMatch(markup,/PLAYER_[ABC]|is-truth|__truth__|EXPLANATION_TOKEN|fabraka-answer|إجابتك/);
  assert.match(markup,/role="timer"/);
});

test('reveal only exposes attribution on request and explanation at the final reveal',()=>{
  let s=go(written(),'START_VOTE');
  while(s.phase==='vote'){s=go(s,'READY');s=go(s,'VOTE',{optionId:TRUTH_ID});}
  s=go(s,'START_REVEAL');
  assert.doesNotMatch(html(s),/PLAYER_[ABC]|is-truth|EXPLANATION_TOKEN|fabraka-answer/);
  while(s.revealIndex<s.revealGroups.length-1){s=go(s,'REVEAL');s=go(s,'REVEAL_NEXT');}
  assert.doesNotMatch(html(s),/is-truth|EXPLANATION_TOKEN|fabraka-answer/);
  s=go(s,'REVEAL');const markup=html(s);
  assert.match(markup,/fab-reveal-card is-truth/);assert.match(markup,/EXPLANATION_TOKEN/);assert.match(markup,/https:\/\/example.com\/fabraka-answer/);
});

test('every picture uses neutral local artwork with accessible text and no answer/source label',()=>{
  const pictures=JSON.parse(readFileSync('src/data/games/fabraka/pictures.json','utf8'));
  assert.equal(new Set(pictures.map(q=>q.image)).size,pictures.length);
  for(const q of pictures){
    const markup=render.picture(q);
    assert.match(q.image,/^media\/fabraka-v3\/fab3-\d{3}\.webp$/);
    assert.match(markup,/<img[^>]*alt="[^"]+"/);assert.match(markup,/تكبير صورة الأداة/);
    assert.ok(!markup.includes(q.answer),q.id);assert.ok(!markup.includes(q.sourceUrl),q.id);
    assert.doesNotMatch(markup,/<svg|<script|<text|<a /);
  }
});

test('unknown or external picture URLs fail visibly without rendering remote content',()=>{
  for(const image of ['https://example.test/answer.webp','media/fabraka-v3/../answer.webp','media/fabraka-v3/the-answer.webp']) {
    const markup=render.picture({image,answer:'SECRET'});
    assert.match(markup,/role="alert"/);assert.doesNotMatch(markup,/<img|SECRET/);
  }
});

test('retired saved rounds explain the update without offering resume or deleting storage',()=>{
  const old={...make(),contentVersion:2};let writes=0;
  const storage={get:(key,fallback)=>key==='session-v2'?old:fallback,set:()=>{writes++;return true;}};
  const markup=render.setup({storage,api:{...api,storage}});
  assert.match(markup,/الجلسة القديمة غير قابلة للاستئناف/);
  assert.doesNotMatch(markup,/استئناف اللعبة المحفوظة/);
  assert.equal(writes,0);
});

test('retired topic filters do not strand a saved setup with zero available questions',()=>{
  const storage={get:(key,fallback)=>key==='options'?{categories:['موضوع محذوف'],writeSeconds:30}:fallback,set:()=>true};
  const markup=render.setup({storage,api:{...api,storage}});
  assert.doesNotMatch(markup,/المتاح 0|مواضيع محذوفة|موضوع محذوف/);
  assert.match(markup,/سؤالًا متاحًا/);
});

test('setup exposes all modes, timing, categories, laugh award, and the tutorial',()=>{
  const markup=render.setup({storage:api.storage,api});
  for(const value of ['حقائق','مزيج','صور','أصحابنا','وقت الكتابة','وقت النقاش','أكثر كذبة مضحكة','تعليمية','المواضيع']) assert.ok(markup.includes(value),value);
});

test('the results screen fills the blank instead of printing the ___ placeholder',()=>{
  const state={players,settings:{funnyVote:true},
    scores:{a:1500,b:500,c:0},
    stats:{a:{truths:1,fooled:1,laughs:0},b:{truths:0,fooled:1,laughs:1},c:{truths:0,fooled:0,laughs:0}},
    history:[{round:1,question:'يبلغ العدد ___ وحدة.',answer:'ANSWER_TOKEN',
      highlights:[{text:'LIE_TOKEN',owners:['b'],fooled:1,laughs:1}]}]};
  const markup=render.results({state});
  assert.match(markup,/LIE_TOKEN/);
  assert.match(markup,/class="blank">ANSWER_TOKEN</);
  assert.doesNotMatch(markup,/___/);
});
