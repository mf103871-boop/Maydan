import React, { useEffect, useMemo, useState } from 'react';
import { DesignContext } from './context.js';
import { createDefaultDesign, designProfile, tokenStyle, validateDesignDocument } from './schema.js';

export function DesignProvider({ children, document: requested, profile: forcedProfile, editing=false, onSelect, assetUrls={} }) {
  const [profile,setProfile]=useState(()=>typeof window==='undefined'?'portrait':designProfile(innerWidth,innerHeight));
  useEffect(()=>{const resize=()=>setProfile(designProfile(innerWidth,innerHeight));window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  const document=useMemo(()=>{const result=validateDesignDocument(requested || createDefaultDesign());return result.ok?result.document:createDefaultDesign();},[requested]);
  useEffect(()=>{
    const root=window.document.documentElement,styles=tokenStyle(document.tokens);
    const previous=Object.fromEntries(Object.keys(styles).map(key=>[key,root.style.getPropertyValue(key)]));
    for(const[key,value]of Object.entries(styles))root.style.setProperty(key,value);
    return()=>{for(const[key,value]of Object.entries(previous))value?root.style.setProperty(key,value):root.style.removeProperty(key);};
  },[document.tokens]);
  const value=useMemo(()=>({document,profile:forcedProfile||profile,editing,onSelect,assetUrls}),[document,forcedProfile,profile,editing,onSelect,assetUrls]);
  return <DesignContext.Provider value={value}>{children}</DesignContext.Provider>;
}
