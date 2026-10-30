import {useEffect,useRef,useState} from 'react';
import {useAccount} from '../../../../shared/account/context.js';
import {resolveAccountServer} from '../../../../shared/account/api.js';
import {tutorialOwner} from '../progress.js';
import {createMafiaLab,validateMafiaLabProgress} from './adapter.mjs';
import {LAB_VERSION,MAFIA_LABS,labRuleset} from './scenarios.mjs';

const PREFIX='maydan:mafia-labs:',memory=new Map();
const storage=()=>{try{return globalThis.localStorage;}catch{return null;}};
export const labStorageKey=(owner,courseId)=>PREFIX+encodeURIComponent(owner)+':'+courseId;
export function readLabRecord(store,owner,courseId) {
  const empty={owner,courseId,status:'unseen',progress:null};
  if(!owner||!Object.hasOwn(MAFIA_LABS,courseId))return empty;
  try{
    let raw;try{raw=store?.getItem(labStorageKey(owner,courseId));}catch{/* memory only */}raw||=memory.get(labStorageKey(owner,courseId));
    if(!raw)return empty;if(raw.length>20_000)return {...empty,invalid:true};const {owner:storedOwner,...value}=JSON.parse(raw);
    if(storedOwner!==owner||value.courseId!==courseId)return {...empty,invalid:true};
    if(value.courseVersion!==LAB_VERSION||value.rulesetVersion!==labRuleset(courseId))return {...empty,outdated:true};
    const lab=createMafiaLab({courseId,progress:value}),{status,restoreStatus}=lab.getState(),progress=lab.exportProgress();lab.dispose();
    if(restoreStatus!=='restored')return {...empty,invalid:true};
    return {...empty,status:status==='completed'?'completed':'in-progress',progress};
  }catch{return {...empty,invalid:true};}
}
export function saveLabRecord(store,owner,courseId,progress) {
  if(!owner||progress?.courseId!==courseId)return false;const valid=validateMafiaLabProgress(progress);if(!valid)return false;
  const data=JSON.stringify({owner,...valid});
  if(data.length>20_000)return false;const key=labStorageKey(owner,courseId);memory.set(key,data);
  try{store?.setItem(key,data);return Boolean(store);}catch{return false;}
}
export function clearDeletedMafiaLabs({userId,server,storage:store}={}) {
  if(!userId)return;try{const owner=new URL(server).origin+'|'+userId;for(const id of Object.keys(MAFIA_LABS)){const key=labStorageKey(owner,id);memory.delete(key);try{(store||storage())?.removeItem(key);}catch{/* best effort */}}}catch{/* successful deletion must remain successful */}
}
// Deliberately does not use useTutorialProgress/createTutorialStatusSync: even
// completion and exit stay local and never mark the original lesson complete.
export function useLabProgress(courseId) {
  const account=useAccount(),owner=tutorialOwner(account,resolveAccountServer());
  const current=useRef({key:null,generation:0});const key=(owner||'')+'|'+courseId;
  if(current.current.key!==key)current.current={key,generation:current.current.generation+1};
  const generation=current.current.generation,[view,setView]=useState({key:null,record:null}),alive=useRef(false);
  useEffect(()=>{alive.current=true;setView({key,generation,record:readLabRecord(storage(),owner,courseId)});return()=>{alive.current=false;};},[key,generation,owner,courseId]);
  const isCurrentOwner=expected=>alive.current&&expected===owner&&current.current.key===key&&current.current.generation===generation;
  const update=({progress},expected)=>{if(!isCurrentOwner(expected))return false;const saved=saveLabRecord(storage(),owner,courseId,progress);return saved;};
  return {owner,generation,record:owner&&view.key===key&&view.generation===generation?view.record:null,update,isCurrentOwner,mark:(_status,expected)=>isCurrentOwner(expected)};
}
