import test from 'node:test';
import assert from 'node:assert/strict';
import { presetSettings } from '../src/plus/preset-settings.js';

const confidential = { deck:['question-id'], questionIds:['q1'], words:['secret'], roles:{1:'mafia'}, players:[{id:'person'}], roomCode:'123456', token:'secret', allowReplay:true, state:{answer:'secret'} };
test('saved setups across all eight games contain options, never identity, generated content or replay consent', () => {
  const setups={badeeha:{mode:'family',roundSize:3,timerLength:30,categories:['a','b','c','d','e','f']},beep:{mode:'classic',seconds:10,rounds:8},mamnoo:{seconds:60,rounds:5},jabeen:{seconds:60,categoryId:'animals',control:'touch'},meenfina:{mode:'normal',rounds:6},fabraka:{rounds:5,mode:'classic',style:'mixed',categories:['general'],writeSeconds:40,discussionSeconds:30,funnyVote:true,finalDouble:false,friendCycles:1},ersomha:{cycles:1,drawSeconds:60,difficulty:'easy',categories:['animals']},mafia:{mode:'shadow',capacity:10,visibility:'public'}};
  for(const [game,settings] of Object.entries(setups)) {
    const result=presetSettings(game,{...settings,...confidential});
    for(const key of Object.keys(confidential)) assert.equal(Object.hasOwn(result,key),false,`${game} leaked ${key}`);
    const expected=game==='badeeha'?{mode:'family',roundSize:3,timer:30,categories:settings.categories}:settings;
    assert.deepEqual(result,expected,game);
    if(result.categories){result.categories.push('not-in-original');assert.equal(settings.categories.includes('not-in-original'),false);}
  }
  assert.deepEqual(presetSettings('unregistered',confidential),{});
});
