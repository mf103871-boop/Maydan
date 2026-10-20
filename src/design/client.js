import { validateDesignDocument, createDefaultDesign } from './schema.js';
const CACHE='maydan:design:published:v1';
export function readPublishedDesign(storage=globalThis.localStorage) {
  try{const raw=JSON.parse(storage.getItem(CACHE));if(raw?.channel!=='published')return null;const result=normalizeDesignConfig(raw);return result?.channel==='published'?result:null;}catch{return null;}
}
export function savePublishedDesign(value,storage=globalThis.localStorage) {
  if(value?.channel!=='published' || !validateDesignDocument(value.document).ok)return false;
  const normalized=normalizeDesignConfig(value);if(!normalized)return false;
  try{storage.setItem(CACHE,JSON.stringify(normalized));return true;}catch{return false;}
}
export function normalizeDesignConfig(value) {
  if(!value || !['published','preview','default'].includes(value.channel))return null;
  if(value.channel==='default' && !value.document)return {channel:'default',versionId:null,document:createDefaultDesign()};
  if(value.channel!=='default' && (typeof value.versionId!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.versionId)))return null;
  const result=validateDesignDocument(value.document);
  return result.ok?{channel:value.channel,versionId:value.versionId||null,document:result.document}:null;
}
export function clearPublishedDesign(storage=globalThis.localStorage) {try{storage.removeItem(CACHE);}catch{/* memory-only fallback */}}
export function designChangeSafe({route,call=false,focused=false,modal=false}) {return !['play','online','room'].includes(route) && !call && !focused && !modal;}
