import test from 'node:test';
import assert from 'node:assert/strict';
import * as beep from '../src/games/beep/logic.js';
import * as mamnoo from '../src/games/mamnoo/logic.js';
import * as jabeen from '../src/games/jabeen/logic.js';
import * as meenfina from '../src/games/meenfina/logic.js';
const players = [{id:'a',name:'أحمد'},{id:'b',name:'سارة'}];
const prompt = {id:'prompt',text:'سؤال'};

test('beep completion distinguishes completed turns and bomb elimination from manual or empty-deck exits',()=>{
  let s=beep.initialState(players,{mode:'three',rounds:3});
  assert.equal(beep.reduce(s,{type:'END'}).completed,false);
  assert.equal(beep.reduce(s,{type:'BEGIN',prompt:null}).completed,false);
  while(s.phase!=='over') {
    s=beep.reduce(s,{type:'BEGIN',prompt}); s=beep.reduce(s,{type:'FINISH'}); s=beep.reduce(s,{type:'JUDGE',ok:true});
  }
  assert.equal(s.completed,true); assert.equal(s.history.length,6);
  s=beep.initialState(players,{mode:'bomb'});
  for(let n=0;n<30&&s.phase!=='over';n++) {
    if(s.phase==='intro') s=beep.reduce(s,{type:'BEGIN',prompt});
    s=beep.reduce(s,{type:'EXPLODE'});
    if(s.phase==='boom') s=beep.reduce(s,{type:'CONTINUE'});
  }
  assert.equal(s.phase,'over'); assert.equal(s.completed,true);
});

test('mamnoo records only after every team has played every scheduled round',()=>{
  let s=mamnoo.initialState(players,{rounds:2});
  assert.equal(mamnoo.reduce(s,{type:'END'}).completed,false);
  assert.equal(mamnoo.reduce(s,{type:'BEGIN',card:null}).completed,false);
  let turns=0;
  while(s.phase!=='over') {
    s=mamnoo.reduce(s,{type:'BEGIN',card:{id:'c',word:'كلمة'}});
    s=mamnoo.reduce(s,{type:'TIME_UP'}); assert.equal(s.completed,false);
    s=mamnoo.reduce(s,{type:'NEXT'}); turns++;
  }
  assert.equal(turns,4); assert.equal(s.completed,true);
});

test('jabeen requires all entrants to confirm their round; an empty content run earns nothing',()=>{
  const initial=()=>jabeen.initialState(players,{id:'animals',items:[]},{});
  assert.equal(jabeen.reduce(initial(),{type:'END'}).completed,false);
  let s=initial();
  for(let n=0;n<2;n++) {
    s=jabeen.reduce(s,{type:'BEGIN',item:{id:`item-${n}`,text:'حيوان'}});
    s=jabeen.reduce(s,{type:'ANSWER',ok:true,item:null});
    s=jabeen.reduce(s,{type:'CONFIRM'});
  }
  assert.equal(s.phase,'over'); assert.equal(s.completed,true);
  s=initial(); for(let n=0;n<2;n++) {s=jabeen.reduce(s,{type:'BEGIN',item:null});s=jabeen.reduce(s,{type:'CONFIRM'});}
  assert.equal(s.phase,'over'); assert.equal(s.completed,false);
});

test('meenfina natural completion remains distinct from ending early or running out of statements',()=>{
  let s=meenfina.initialState(players,{mode:'point',rounds:5});
  assert.equal(meenfina.reduce(s,{type:'END'}).completed,false);
  assert.equal(meenfina.reduce(s,{type:'BEGIN',statement:null}).completed,false);
  for(let n=0;n<5;n++) {
    s=meenfina.reduce(s,{type:'BEGIN',statement:{id:`s${n}`,text:'عبارة',tag:'مرح'}});
    s=meenfina.reduce(s,{type:'COUNTDOWN_DONE'}); s=meenfina.reduce(s,{type:'SKIP_STATEMENT'});
    assert.equal(s.completed,false); s=meenfina.reduce(s,{type:'NEXT'});
  }
  assert.equal(s.phase,'over'); assert.equal(s.completed,true);
});
