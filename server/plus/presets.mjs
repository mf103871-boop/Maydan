import { fail, hasInvisible } from '../room-model.mjs';
import { objectionableText } from '../moderation/filter.mjs';
import { normalizeMafiaSettings } from '../../src/online/mafia-shared.js';
import { ERSOMHA_CATEGORIES, BADEEHA_TIMERS } from '../../src/online/shared.js';
import { normalizeOptions as fabrakaOptions, DEFAULT_OPTIONS as FABRAKA_DEFAULTS, ROUNDS as FABRAKA_ROUNDS, MODES as FABRAKA_MODES } from '../../src/games/fabraka/logic.js';
import { SECONDS as BEEP_SECONDS, ROUNDS as BEEP_ROUNDS, MODES as BEEP_MODES } from '../../src/games/beep/logic.js';
import { SECONDS as MAMNOO_SECONDS, ROUNDS as MAMNOO_ROUNDS } from '../../src/games/mamnoo/logic.js';
import { SECONDS as JABEEN_SECONDS } from '../../src/games/jabeen/logic.js';
import { ROUNDS as MEENFINA_ROUNDS, MODES as MEENFINA_MODES } from '../../src/games/meenfina/logic.js';
import BadeehaLogic from '../../src/games/badeeha/logic.js';
import bankStatus from '../../src/data/bank-status.json' with { type: 'json' };
import { categories as fabrakaCategories, categoryCount } from '../../src/games/fabraka/content.js';

export const PRESET_SCHEMA_VERSION=1;
export const PRESET_LIMIT=10;
export function presetName(value) {
  if(typeof value!=='string')fail('INVALID',400);
  const name=value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(!name||Array.from(name).length>40||hasInvisible(name))fail('INVALID',400);
  if(objectionableText(name))fail('CONTENT_REJECTED',422);
  return name;
}
const pick=(v,values,fallback)=>v===undefined?fallback:values.includes(v)?v:fail('INVALID',400);
const bool=(v,fallback)=>v===undefined?fallback:typeof v==='boolean'?v:fail('INVALID',400);
function keys(raw,allowed) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!allowed.includes(k)))fail('INVALID',400);
}
function categories(raw,known,{min=0,max=100}={}) {
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>max||(raw.length&&raw.length<min)||new Set(raw).size!==raw.length||raw.some(k=>typeof k!=='string'||!known.includes(k)))fail('INVALID',400);
  return [...raw];
}
// Explicit per-game schemas contain setup choices only. No decks, answers,
// account/seat identities, room credentials, replay consent or game state.
export function normalizePresetSettings(game,raw) {
  switch(game){
    case 'badeeha': {
      keys(raw,['mode','roundSize','timer','categories']);
      const selected=categories(raw.categories,Object.keys(bankStatus.categories),{min:6,max:6});
      return {mode:pick(raw.mode,Object.keys(BadeehaLogic.MODES),'standard'),roundSize:pick(raw.roundSize,BadeehaLogic.ROUND_SIZES,30),timer:pick(raw.timer,BADEEHA_TIMERS,60),categories:selected};
    }
    case 'beep': keys(raw,['mode','seconds','rounds']);return {mode:pick(raw.mode,BEEP_MODES,'three'),seconds:pick(raw.seconds,BEEP_SECONDS,5),rounds:pick(raw.rounds,BEEP_ROUNDS,5)};
    case 'mamnoo': keys(raw,['seconds','rounds']);return {seconds:pick(raw.seconds,MAMNOO_SECONDS,60),rounds:pick(raw.rounds,MAMNOO_ROUNDS,3)};
    case 'jabeen': keys(raw,['seconds','categoryId','control']);return {seconds:pick(raw.seconds,JABEEN_SECONDS,60),categoryId:pick(raw.categoryId,['acting','animals','figures','food','home','jobs','places','proverbs'],'acting'),control:pick(raw.control,['auto','touch'],'auto')};
    case 'meenfina': keys(raw,['mode','rounds']);return {mode:pick(raw.mode,MEENFINA_MODES,'point'),rounds:pick(raw.rounds,MEENFINA_ROUNDS,8)};
    case 'fabraka': {
      keys(raw,Object.keys(FABRAKA_DEFAULTS));
      pick(raw.mode,FABRAKA_MODES,'classic');pick(raw.rounds,FABRAKA_ROUNDS,3);pick(raw.style,['all','curious'],'curious');
      pick(raw.writeSeconds,[0,30,45],45);pick(raw.discussionSeconds,[0,15,20],20);pick(raw.friendCycles,[1,2],1);bool(raw.funnyVote,true);bool(raw.finalDouble,false);
      categories(raw.categories,fabrakaCategories);
      if(raw.categories?.some(c=>categoryCount(c,raw.style||'curious')===0))fail('INVALID',400);
      return fabrakaOptions(raw);
    }
    case 'ersomha': {
      keys(raw,['mode','cycles','difficulty','categories','drawSeconds']);
      return {mode:pick(raw.mode,['competitive','cooperative'],'competitive'),cycles:pick(raw.cycles,[1,2],1),difficulty:pick(raw.difficulty,['easy','medium','hard'],'easy'),categories:categories(raw.categories,ERSOMHA_CATEGORIES.map(c=>c.id),{min:3,max:12}),drawSeconds:pick(raw.drawSeconds,[60],60)};
    }
    case 'mafia': {
      keys(raw,['mode','capacity','visibility','roomName','voiceMode','community']);const result=normalizeMafiaSettings(raw);if(!result)fail('INVALID',400);if(objectionableText(result.roomName))fail('CONTENT_REJECTED',422);return result;
    }
    default: fail('INVALID',400);
  }
}
export const presetView=row=>({id:row.id,name:row.name,game:row.game,schemaVersion:row.schema_version,settings:JSON.parse(row.settings_json),revision:row.revision,updatedAt:row.updated_at});
