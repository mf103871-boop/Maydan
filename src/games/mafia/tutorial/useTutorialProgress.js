import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../../../shared/account/context.js';
import { resolveAccountServer } from '../../../shared/account/api.js';
import { validateTutorialProgress } from './adapter.mjs';
import { tutorialOwner, readTutorialRecord, saveTutorialRecord, createTutorialStatusSync } from './progress.js';

export function tutorialStorage() { try { return globalThis.localStorage; } catch { return null; } }
export function validatedProgress(value) { try { return validateTutorialProgress(value); } catch { return null; } }
export function useTutorialProgress({ loadStatus = false } = {}) {
  const account = useAccount();
  const server = resolveAccountServer();
  const owner = tutorialOwner(account, server);
  const current = useRef({ owner: null, account, generation: 0 });
  if(current.current.owner!==owner)current.current={owner,account,generation:current.current.generation+1};else current.current.account=account;
  const generation=current.current.generation;
  const [view,setView] = useState({ owner: null, record: null, checked: false, autoStartVerified: false });
  const recordRef = useRef(null), syncRef = useRef(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    let alive = true;
    const read = () => recordRef.current?.owner === owner ? recordRef.current : readTutorialRecord(tutorialStorage(),owner,validatedProgress);
    const write = record => {
      if (!alive || (current.current.owner !== owner || current.current.generation !== generation)) return;
      recordRef.current = record;
      saveTutorialRecord(tutorialStorage(),owner,record);
      setView(old=>({ ...old,owner,generation,record }));
    };
    const record = readTutorialRecord(tutorialStorage(),owner,validatedProgress);
    recordRef.current = record;
    setView({owner,generation,record,checked:!loadStatus || !current.current.account.signedIn,autoStartVerified:!current.current.account.signedIn});
    const sync = createTutorialStatusSync({owner,request:(...args)=>current.current.account.requestAuthenticated(...args),isCurrent:value=>alive&&current.current.generation===generation&&current.current.owner===value,read,write});
    syncRef.current = sync;
    const publishPending = () => {
      if (!alive || current.current.generation!==generation || current.current.owner!==owner || !current.current.account.signedIn || !server || globalThis.navigator?.onLine===false) return;
      const status = read().pendingStatus;
      if (status) void sync.publish(status);
    };
    publishPending();
    let gateClosed=false;
    const finish = verified => { if(gateClosed)return;gateClosed=true;if(alive&&current.current.generation===generation&&current.current.owner===owner)setView(old=>({...old,checked:true,autoStartVerified:!current.current.account.signedIn || verified===true})); };
    const timer=setTimeout(()=>finish(false),1500);
    if(loadStatus&&server&&current.current.account.signedIn&&globalThis.navigator?.onLine!==false) void sync.load().then(result=>finish(Boolean(result))); else finish(false);
    globalThis.window?.addEventListener('online',publishPending);
    return()=>{alive=false;active.current=false;clearTimeout(timer);sync.dispose();globalThis.window?.removeEventListener('online',publishPending);if(syncRef.current===sync)syncRef.current=null;};
  },[owner,loadStatus,server,generation]);
  const update = (patch, expectedOwner = owner) => {
    if (!active.current || !expectedOwner || (current.current.owner!==expectedOwner || current.current.generation!==generation)) return false;
    const previous = recordRef.current;
    if(previous?.owner!==expectedOwner)return false;
    const record={...previous,...patch,owner:expectedOwner};
    // A completed lesson stays completed when replayed or left later.
    if(previous.status==='completed')record.status='completed';
    recordRef.current=record;
    const saved=saveTutorialRecord(tutorialStorage(),expectedOwner,record);
    setView(old=>({...old,owner:expectedOwner,record}));
    return saved;
  };
  const isCurrentOwner = expectedOwner => active.current && current.current.generation===generation && current.current.owner===expectedOwner && recordRef.current?.owner===expectedOwner;
  const mark = (status, expectedOwner = owner) => {
    if(!isCurrentOwner(expectedOwner))return false;
    if(!['completed','skipped'].includes(status))return false;
    const actual=recordRef.current?.status==='completed'?'completed':status;
    update({status:actual,pendingStatus:actual},expectedOwner);
    if(isCurrentOwner(expectedOwner) && server && current.current.account.signedIn && globalThis.navigator?.onLine!==false)void syncRef.current?.publish(actual);
    return true;
  };
  const safe=view.owner===owner && view.generation===generation ? view : {owner,record:null,checked:false,autoStartVerified:false};
  return {...safe,owner,server,account,update,mark,isCurrentOwner};
}
