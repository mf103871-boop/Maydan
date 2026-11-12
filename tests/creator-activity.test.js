import test from 'node:test';
import assert from 'node:assert/strict';
import { creatorActivity } from '../src/creator/activity.js';
import { presenceOf } from '../server/creator/model.mjs';
const dom=(game,phase)=>({querySelector:()=>({getAttribute:key=>key==='data-creator-game'?game:phase})});
test('operational activity reports only public game navigation and preserves online-only modes',()=>{
  for(const game of ['badeeha','beep','mamnoo','jabeen','fabraka','meenfina','ersomha','mafia']) {
    for(const name of ['game-entry','play']) {
      const value=creatorActivity({name,params:{id:game}},null);
      assert.deepEqual(presenceOf(value),value);
      assert.deepEqual(Object.keys(value).sort(),['game','mode','screen']);
    }
  }
  assert.equal(creatorActivity({name:'room',params:{id:'123456'}},null),null);
  assert.deepEqual(creatorActivity({name:'room',params:{id:'123456'}},dom('mafia','lobby')),{game:'mafia',mode:'online',screen:'game-lobby'});
  assert.deepEqual(creatorActivity({name:'play',params:{id:'beep'}},dom('beep','setup')),{game:'beep',mode:'local',screen:'game-setup'});
  assert.deepEqual(creatorActivity({name:'room',params:{id:'123456'}},dom('ersomha','ended')),{game:'ersomha',mode:'online',screen:'game-results'});
});
