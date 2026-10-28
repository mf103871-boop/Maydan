import { premiumActive, premiumOf } from '../accounts/entitlements.mjs';
import { liveAccountSql } from '../moderation/access.mjs';
import { getCosmetic } from '../../src/plus/catalog.js';
import { fail } from '../room-model.mjs';
import { GRACE_MS } from '../../src/shared/account/config.js';

export const EMPTY_COSMETICS = Object.freeze({ frameId: null, avatarId: null, coverId: null, nameColorId: null, roomThemeId: null, badge: false });
const fields = Object.freeze({ frameId: 'frame', avatarId: 'avatar', coverId: 'cover', nameColorId: 'nameColor', roomThemeId: 'roomTheme' });
const live = liveAccountSql;
// Only code-controlled aliases/time/environment fragments enter this predicate.
// Repeat entitlement checks inside writes so expiry/revocation cannot race a save.
export function plusAccessSql(env,userAlias,now=Date.now()) {
  const production=env.PADDLE_ENV==='production';
  const apple=production&&env.APPLE_ALLOW_SANDBOX_ENTITLEMENTS!=='1'?" AND (s.source!='apple' OR lower(COALESCE(s.environment,''))!='sandbox')":'';
  return `EXISTS(SELECT 1 FROM subscriptions s WHERE s.user_id=${userAlias} AND lower(COALESCE(s.status,'')) NOT IN ('revoked','refunded') AND s.until>0 AND s.until+${GRACE_MS}>${Math.floor(now)} AND (s.source!='paddle' OR s.environment='${production?'production':'sandbox'}')${apple})`;
}
export const statement = (env,sql,...args) => env.DB.prepare(sql).bind(...args);
const all = async(env,sql,...args)=>(await statement(env,sql,...args).all()).results||[];

export async function plusActiveFor(env,userId,now=Date.now()) {
  if (!env.DB || !userId) return false;
  const rows = await all(env,`SELECT s.* FROM subscriptions s WHERE s.user_id=? AND ${live('s.user_id')}`,userId);
  return premiumActive(premiumOf(rows,now,env),now);
}
export async function requirePlus(env,userId,now=Date.now()) {
  if (!await plusActiveFor(env,userId,now)) fail('PLUS_REQUIRED',402);
}
export function normalizeSelection(selection,now=Date.now()) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection) || Object.keys(selection).some(k=>!Object.hasOwn(fields,k)&&k!=='badge')) fail('INVALID',400);
  const result={};
  for(const [key,kind] of Object.entries(fields)) if(Object.hasOwn(selection,key)) {
    const id=selection[key];
    if(id!==null && !getCosmetic(id,{kind,now})) fail('INVALID',400);
    result[key]=id;
  }
  if(Object.hasOwn(selection,'badge')) {if(typeof selection.badge!=='boolean')fail('INVALID',400);result.badge=selection.badge;}
  return result;
}
export function effectiveSelection(preferred,eligible,now=Date.now()) {
  const result={...EMPTY_COSMETICS};
  if(!eligible)return result;
  for(const [key,kind] of Object.entries(fields)) if(getCosmetic(preferred?.[key],{kind,now}))result[key]=preferred[key];
  result.badge=preferred?.badge===true;
  return result;
}
export async function cosmeticsFor(env,userId,now=Date.now()) {
  const [row,eligible]=await Promise.all([
    statement(env,`SELECT selection_json,revision FROM plus_cosmetics WHERE user_id=? AND ${live('plus_cosmetics.user_id')}`,userId).first(),
    plusActiveFor(env,userId,now),
  ]);
  let stored={};try{stored=JSON.parse(row?.selection_json||'{}');}catch{/* retain safe defaults */}
  const preferred={...EMPTY_COSMETICS,...stored};
  return {preferred,effective:effectiveSelection(preferred,eligible,now),revision:row?.revision||0,eligible,plusActive:eligible,serverTime:now};
}
export async function effectiveCosmetics(env,userId,now=Date.now()) {
  if(!env.DB||!userId)return {...EMPTY_COSMETICS};
  return (await cosmeticsFor(env,userId,now)).effective;
}
// Bounded batched lookups keep friend/group lists from doing two queries per avatar.
export async function effectiveCosmeticsMany(env,userIds,now=Date.now()) {
  const result=new Map(),ids=[...new Set(userIds)].filter(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(id));
  if(!env.DB)return result;
  for(let offset=0;offset<ids.length;offset+=80){
    const batch=ids.slice(offset,offset+80),marks=batch.map(()=>'?').join(',');
    const [preferences,subscriptions]=await Promise.all([
      all(env,`SELECT user_id,selection_json FROM plus_cosmetics WHERE user_id IN (${marks}) AND ${live('plus_cosmetics.user_id')}`,...batch),
      all(env,`SELECT s.* FROM subscriptions s WHERE s.user_id IN (${marks}) AND ${live('s.user_id')}`,...batch),
    ]);
    const byId=new Map(preferences.map(r=>[r.user_id,r]));
    for(const id of batch){let preferred={};try{preferred=JSON.parse(byId.get(id)?.selection_json||'{}');}catch{/* defaults */}
      result.set(id,effectiveSelection(preferred,premiumActive(premiumOf(subscriptions.filter(s=>s.user_id===id),now,env),now),now));}
  }
  return result;
}
