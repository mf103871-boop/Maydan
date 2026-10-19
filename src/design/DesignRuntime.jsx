import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DesignProvider } from './DesignProvider.jsx';
import { useAccount } from '../shared/account/context.js';
import { resolveAccountServer,request } from '../shared/account/api.js';
import { useLamma } from '../social/LammaProvider.jsx';
import { useRoute } from '../platform/router.js';
import { createDefaultDesign } from './schema.js';
import { readPublishedDesign,savePublishedDesign,clearPublishedDesign,normalizeDesignConfig,designChangeSafe } from './client.js';
import { loadDesignImages } from './images.js';

const empty={channel:'default',versionId:null,document:createDefaultDesign(),assetUrls:{}};
const textFocused=()=>!!document.activeElement?.matches?.('input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true]');
export function DesignRuntime({children}) {
  const account=useAccount(),lamma=useLamma(),route=useRoute();
  const owner=account.ready && account.signedIn?account.user?.id||null:null;
  const [display,setDisplay]=useState(()=>({...empty,...readPublishedDesign()}));
  const [pending,setPending]=useState(null),[tick,setTick]=useState(0);
  const currentOwner=useRef(owner),generation=useRef(0),accountRef=useRef(account),batches=useRef(new Map()),ignoredPreview=useRef(null),batchSequence=useRef(0),latestPending=useRef(null),preparedBatches=useRef(new Set());
  accountRef.current=account;
  const releasePrepared=ready=>{
    if(!ready?._key)return;
    preparedBatches.current.delete(ready._key);
    const urls=batches.current.get(ready._key);
    urls?.forEach(url=>URL.revokeObjectURL(url));batches.current.delete(ready._key);
  };
  const queuePending=ready=>{
    // Passive effects from an older render may run before this state commits.
    // Publish the identity first so they cannot clear it or revoke its images.
    latestPending.current=ready;
    if(ready?._key)preparedBatches.current.delete(ready._key);
    setPending(ready);
  };
  const owned=display.channel!=='preview' || display.owner===owner;
  const safeDisplay=useMemo(()=>owned?display:{...empty,...readPublishedDesign()},[owned,display]);
  useEffect(()=>{
    currentOwner.current=owner;const epoch=++generation.current;
    queuePending(null);setDisplay(previous=>previous.channel==='preview'?({...empty,...readPublishedDesign()}):previous);
    let busy=false,seen=null;
    const current=()=>epoch===generation.current && currentOwner.current===owner;
    const read=(path,raw=false)=>owner?accountRef.current.requestAuthenticated(path,{raw}):request(path,{raw});
    const imageCache=async()=>{try{return await caches.open('maydan-design-published-v1');}catch{return undefined;}};
    async function prepare(config,cacheOnly=false) {
      const images=await loadDesignImages(config,{origin:resolveAccountServer(),read,cache:config.channel==='published'?await imageCache():undefined,current,cacheOnly});
      if(!images)return null;
      if(!current()){images.objectURLs.forEach(url=>URL.revokeObjectURL(url));return null;}
      const key=`${epoch}:${++batchSequence.current}`;
      batches.current.set(key,images.objectURLs);
      // Keep a finished batch alive across the await between prepare() and its
      // caller deciding whether to enqueue or discard it.
      preparedBatches.current.add(key);
      return {...config,owner,assetUrls:images.assetUrls,_key:key};
    }
    async function hydrateCached() {
      const cached=readPublishedDesign();
      if(!cached)return;
      let ready;
      try{ready=await prepare(cached,true);if(ready && current() && !seen){queuePending(ready);ready=null;}}catch{/* Offline image storage is optional. */}
      finally{releasePrepared(ready);}
    }
    async function refresh() {
      if(busy || document.visibilityState==='hidden' || !resolveAccountServer())return;
      busy=true;
      let ready;
      try{
        const config=normalizeDesignConfig(await read('/api/ui-config?schemaVersion=1&registryVersion=1'));
        if(!config || !current())return;
        if(config.channel==='preview' && ignoredPreview.current?.owner===owner && ignoredPreview.current?.versionId===config.versionId)return;
        if(config.channel!=='preview')ignoredPreview.current=null;
        if(config.channel==='default')clearPublishedDesign();
        const key=`${owner||'guest'}:${config.channel}:${config.versionId||'default'}`;
        if(seen===key)return;
        ready=await prepare(config);
        if(!ready || !current())return;
        if(config.channel==='preview' && ignoredPreview.current?.owner===owner && ignoredPreview.current?.versionId===config.versionId)return;
        if(config.channel==='published')savePublishedDesign(config);
        seen=key;queuePending(ready);ready=null;
      }catch{/* Design outages never block startup, games or accounts. */}
      finally{releasePrepared(ready);busy=false;}
    }
    void hydrateCached().finally(refresh);const interval=setInterval(refresh,60_000);
    window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{if(generation.current===epoch)generation.current=epoch+1;clearInterval(interval);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[owner]);
  useEffect(()=>{
    if(latestPending.current===safeDisplay && pending!==safeDisplay)latestPending.current=null;
    const keep=new Set([safeDisplay._key,pending?._key,latestPending.current?._key,...preparedBatches.current]);
    for(const[key,urls]of batches.current)if(!keep.has(key)){urls.forEach(url=>URL.revokeObjectURL(url));batches.current.delete(key);}
  },[safeDisplay,pending]);
  useEffect(()=>()=>{for(const urls of batches.current.values())urls.forEach(url=>URL.revokeObjectURL(url));batches.current.clear();preparedBatches.current.clear();latestPending.current=null;},[]);
  useEffect(()=>{
    const changed=()=>setTick(value=>value+1);
    const observer=new MutationObserver(changed);observer.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('focusin',changed);document.addEventListener('focusout',changed);
    return()=>{observer.disconnect();document.removeEventListener('focusin',changed);document.removeEventListener('focusout',changed);};
  },[]);
  useEffect(()=>{
    if(!pending || latestPending.current!==pending || pending.owner!==currentOwner.current)return;
    const modal=[...document.querySelectorAll('[aria-modal=true]')].some(node=>node.getClientRects().length);
    if(designChangeSafe({route:route.name,call:!!lamma?.activeCall,focused:textFocused(),modal})) {
      setDisplay(previous=>latestPending.current===pending && pending.owner===currentOwner.current?pending:previous);
      setPending(previous=>previous===pending?null:previous);
    }
  },[pending,route.name,lamma?.activeCall,tick]);
  async function exitPreview(){
    const intent={owner,versionId:safeDisplay.versionId},epoch=generation.current,cached=readPublishedDesign();
    ignoredPreview.current=intent;
    queuePending({...empty,...cached,owner});
    async function hydratePublished(){
      if(!cached)return;
      const current=()=>generation.current===epoch && currentOwner.current===owner && ignoredPreview.current===intent;
      try{
        let cache;try{cache=await caches.open('maydan-design-published-v1');}catch{/* restricted storage */}
        const images=await loadDesignImages(cached,{origin:resolveAccountServer(),cache,cacheOnly:true,current});
        if(!images)return;
        if(!current()){images.objectURLs.forEach(url=>URL.revokeObjectURL(url));return;}
        const key=`${epoch}:${++batchSequence.current}`;
        batches.current.set(key,images.objectURLs);queuePending({...cached,owner,assetUrls:images.assetUrls,_key:key});
      }catch{/* The bundled design still works if optional cached pictures are unavailable. */}
    }
    void hydratePublished();
    try{await account.requestAuthenticated('/api/design/preview',{method:'DELETE'});}catch{/* Public design remains available offline. */}
  }
  return <DesignProvider document={safeDisplay.document} assetUrls={safeDisplay.assetUrls||{}}>
    {children}
    {safeDisplay.channel==='preview' && <aside style={{position:'fixed',insetInlineStart:8,top:'max(6px, env(safe-area-inset-top))',zIndex:390,background:'#352547',color:'white',borderRadius:12,padding:'4px 10px',fontSize:12}} aria-label="معاينة تصميم خاصة">معاينة خاصة <button type="button" onClick={exitPreview} disabled={!!pending && pending.channel!=='preview'} style={{color:'white',fontSize:12,minHeight:44,padding:'0 8px'}}>{pending && pending.channel!=='preview'?'العودة عند انتهاء اللعب أو المكالمة':'العودة للتصميم المنشور'}</button></aside>}
  </DesignProvider>;
}
