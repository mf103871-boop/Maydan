import { premiumActive, premiumOf } from '../accounts/entitlements.mjs';
import { liveAccountSql } from '../moderation/access.mjs';
import { getCosmetic } from '../../src/plus/catalog.js';
import { fail } from '../room-model.mjs';
import { GRACE_MS } from '../../src/shared/account/config.js';
import { mafiaCosmeticGrantSql } from '../mafia-achievements.mjs';
import { getMafiaAchievement } from '../../src/profiles/mafia-catalog.js';

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
export function cosmeticAccessSql(env,userAlias,itemId,now=Date.now()) {
  return getCosmetic(itemId,{now}) ? `(${plusAccessSql(env,userAlias,now)} OR ${mafiaCosmeticGrantSql(userAlias,itemId,now)})` : '0';
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
export function effectiveSelection(preferred,eligible,now=Date.now(),grants=[]) {
  const result={...EMPTY_COSMETICS};
  const owned=new Set(grants.map(grant=>grant.itemId));
  for(const [key,kind] of Object.entries(fields)) if((eligible||owned.has(preferred?.[key]))&&getCosmetic(preferred?.[key],{kind,now}))result[key]=preferred[key];
  result.badge=eligible&&preferred?.badge===true;
  return result;
}
async function cosmeticSnapshots(env,ids,now) {
  const read=selected=>all(env,`SELECT u.id AS user_id,c.selection_json,c.revision,
    ${plusAccessSql(env,'u.id',now)} AS plus_active,
    (SELECT json_group_array(json_object('itemId',g.item_id,'achievementId',g.achievement_id,'grantedAt',g.granted_at,'source',g.source))
      FROM mafia_cosmetic_grants g WHERE g.user_id=u.id AND g.source='mafia_achievement' AND g.revoked_at IS NULL) AS grants_json
    FROM users u LEFT JOIN plus_cosmetics c ON c.user_id=u.id
    WHERE u.id IN (${selected.map(()=>'?').join(',')}) AND ${live('u.id')}`,...selected);
  // Independent source lookups used to retain a license after deletion during
  // their awaits. Re-read the candidate accounts at the return boundary: life,
  // current selection, Plus and licenses must come from one final SQL snapshot.
  // The final projection supersedes every value read before that boundary.
  const candidates=await read(ids);
  return candidates.length?read(candidates.map(row=>row.user_id)):[];
}
function cosmeticView(row,now) {
  let stored={},grants=[];
  try{stored=JSON.parse(row?.selection_json||'{}');}catch{/* safe defaults */}
  try{grants=JSON.parse(row?.grants_json||'[]');}catch{/* safe defaults */}
  grants=grants.filter(grant=>getMafiaAchievement(grant.achievementId)?.cosmeticItemId===grant.itemId&&getCosmetic(grant.itemId,{now}));
  const preferred={...EMPTY_COSMETICS,...stored},eligible=Boolean(row?.plus_active);
  return {preferred,effective:effectiveSelection(preferred,eligible,now,grants),grants,revision:row?.revision||0,eligible:eligible||grants.length>0,plusActive:eligible,serverTime:now};
}
export async function cosmeticsFor(env,userId,now=Date.now()) {
  if(!env.DB||!userId)return cosmeticView(null,now);
  const [row]=await cosmeticSnapshots(env,[userId],now);
  return cosmeticView(row,now);
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
    const batch=ids.slice(offset,offset+80),rows=await cosmeticSnapshots(env,batch,now),byId=new Map(rows.map(row=>[row.user_id,row]));
    for(const id of batch)result.set(id,cosmeticView(byId.get(id),now).effective);
  }
  return result;
}
