const error = code => Object.assign(new Error(code), { code });
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
export const mafiaProgressScope = ({server='',viewerId='',targetId='me',sessionEpoch=0}={}) =>
  [server,viewerId,targetId,sessionEpoch].join('\u0000');

async function call(server,auth,path,{method='GET',body,signal,fetchImpl=globalThis.fetch,timeout=15000}={}) {
  const base=validateServerUrl(server);
  if(!base)throw error('CONFIG');
  if(typeof fetchImpl!=='function')throw error('OFFLINE');
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,timeout);
  try {
    const response=await fetchImpl(base+path,{method,headers:{...auth,...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal,credentials:'omit',cache:'no-store'});
    let data;try{data=await response.json();}catch{throw error('NETWORK');}
    if(controller.signal.aborted)throw error('ABORTED');
    if(!response.ok)throw error(typeof data?.error==='string'?data.error:'NETWORK');
    if(!data || typeof data!=='object' || Array.isArray(data))throw error('NETWORK');
    return data;
  } catch(cause) {
    if(controller.signal.aborted || cause?.name==='AbortError')throw error('ABORTED');
    throw cause?.code?cause:error('NETWORK');
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function getMafiaProgress(server,auth,userId='me',options={}) {
  if(userId!=='me'&&!validId(userId))return Promise.reject(error('INVALID'));
  return call(server,auth,userId==='me'?'/api/me/mafia/progress':`/api/profiles/${encodeURIComponent(userId)}/mafia`,options);
}
export function getMafiaReward(server,auth,matchKey,options={}) {
  if(typeof matchKey!=='string'||! /^[A-Za-z0-9:_-]{1,180}$/.test(matchKey))return Promise.reject(error('INVALID'));
  return call(server,auth,`/api/me/mafia/rewards/${encodeURIComponent(matchKey)}`,options);
}
export const patchPreferences=(server,auth,body,options={})=>call(server,auth,'/api/me/mafia/preferences',{...options,method:'PATCH',body});
export const patchMafiaPreferences=patchPreferences;
const initial=scope=>({scope,data:null,loading:false,saving:false,error:null});

// Memory only. Epoch fences survive A -> B -> A and logout/relogin; a request
// generation prevents pre-save reads from undoing confirmed preference writes.
export class MafiaProgressClient {
  constructor({get=getMafiaProgress,patch=patchPreferences}={}) {
    this.get=get;this.patch=patch;this.listeners=new Set();this.epoch=0;this.generation=0;this.state=initial('');
  }
  subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
  getSnapshot=()=>this.state;
  update(next){this.state={...this.state,...next};for(const listener of this.listeners)listener();}
  start(session){
    this.controller?.abort();this.epoch++;this.generation++;this.session=session||null;this.confirmed=null;
    this.update(initial(session?mafiaProgressScope(session):''));
  }
  async perform(write,body) {
    if(!this.session?.viewerId)throw error('AUTH_REQUIRED');
    if(this.state.saving)throw error('BUSY');
    this.controller?.abort();const controller=new AbortController();this.controller=controller;
    const epoch=this.epoch,generation=++this.generation,session=this.session;
    this.update({loading:!write,saving:write,error:null,...(!write?{data:null}:{})});
    const current=()=>epoch===this.epoch&&generation===this.generation&&!controller.signal.aborted;
    try {
      const options={signal:controller.signal};
      const data=write?await this.patch(session.server,session.auth,body,options):await this.get(session.server,session.auth,session.targetId,options);
      if(!current())throw error('STALE');
      if(data.available!==false&&data.available!==true)throw error('NETWORK');
      if(data.available&&(!data.progress||!Array.isArray(data.roles)))throw error('NETWORK');
      if(data.available&&(['totalXp','level','xpInLevel','xpPerLevel','rewardedMatches','legacyMatches'].some(key=>!Number.isSafeInteger(data.progress[key])||data.progress[key]<0)
        ||data.progress.level<1||data.progress.xpPerLevel<1||data.progress.xpInLevel>=data.progress.xpPerLevel))throw error('NETWORK');
      if(data.available&&this.confirmed&&Number(data.revision)<Number(this.confirmed.revision))throw error('STALE');
      this.confirmed=data.available?data:null;this.update({data});return data;
    } catch(cause) {
      if(!current())throw error('STALE');
      this.update({error:cause.code||'NETWORK',...(!write?{data:null}:{})});throw cause;
    } finally {if(current())this.update({loading:false,saving:false});}
  }
  load(){return this.perform(false);}
  save(body){return this.perform(true,body);}
}
import {validateServerUrl} from '../online/shared.js';
