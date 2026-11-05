import { json, readJson } from '../protocol.mjs';
import { fail } from '../room-model.mjs';
import { requireSession, withRotation } from '../accounts/session.mjs';
import { liveAccountSql } from '../moderation/access.mjs';
import { assertSocialAllowed, noMafiaMediaLeaseSql } from '../mafia-access.mjs';
import { notifyUsers } from '../social/realtime.mjs';
import { friendIds } from '../social/db.mjs';
import { ensurePlayerRow } from '../profiles/db.mjs';
import { PLUS_CATALOG_VERSION, availableCollections, availableItems, COSMETIC_OFFERS, getCosmeticOffer, getCosmetic, subscriptionIncludesItem } from '../../src/plus/catalog.js';
import { EMPTY_COSMETICS, statement, cosmeticsFor, normalizeSelection, plusActiveFor, plusAccessSql, cosmeticAccessSql } from './access.mjs';
import { PRESET_LIMIT, presetView } from './presets.mjs';
import { quoteOwnedOffer } from './commerce.mjs';

const revisionOf=v=>Number.isSafeInteger(v)&&v>=0?v:fail('INVALID',400);
const exactKeys=(body,keys)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))fail('INVALID',400);};
const ownPreset=(env,id,presetId)=>statement(env,`SELECT * FROM plus_setup_presets WHERE id=? AND user_id=? AND ${liveAccountSql('plus_setup_presets.user_id')}`,presetId,id).first();
const changed=r=>Number(r?.meta?.changes||0)>0;
async function notifyAppearance(env,id) {try{await notifyUsers(env,[id,...await friendIds(env,id)],{type:'refresh',reason:'profile',userId:id});}catch{/* write already committed */}}
export const isPlusPath=path=>path==='/api/cosmetics/catalog'||path==='/api/me/cosmetics'||['inventory','quote','checkout'].some(part=>path===`/api/me/cosmetics/${part}`)||path==='/api/me/setup-presets'||path.startsWith('/api/me/setup-presets/');
export async function routePlus(request,env,url=new URL(request.url),charge) {
  if(!isPlusPath(url.pathname))return null;
  const now=Date.now(),method=request.method;
  if(url.pathname==='/api/cosmetics/catalog'&&method==='GET') {
    if(charge)await charge('profileRead');
    return json({version:PLUS_CATALOG_VERSION,collections:availableCollections(now),items:availableItems(now),offers:COSMETIC_OFFERS.filter(offer=>offer.availableFrom<=now),commerce:{configured:false},serverTime:now});
  }
  if(!env.DB)fail('NOT_FOUND',404);
  if(charge)await charge(method==='GET'?'socialReadIP':'socialWriteIP');
  const auth=await requireSession(env,request),id=auth.user.id;
  if(charge)await charge(method==='GET'?'profileRead':'profileWrite','RATE_LIMIT',id);
  const response=await dispatch(request,env,url,id,now);
  return withRotation(response,auth.rotated);
}
async function dispatch(request,env,url,id,now) {
  const method=request.method,path=url.pathname;
  if(path==='/api/me/cosmetics/inventory'&&method==='GET') {
    const state=await cosmeticsFor(env,id,now,{includeMonthly:true});
    return json({...state,catalogVersion:PLUS_CATALOG_VERSION,ownedItemIds:[...new Set(state.grants.map(grant=>grant.itemId))],subscriptionItemIds:state.plusActive?availableItems(now).filter(subscriptionIncludesItem).map(item=>item.id):[]});
  }
  if(['/api/me/cosmetics/quote','/api/me/cosmetics/checkout'].includes(path)&&method==='POST') {
    await assertSocialAllowed(env,id);
    const body=await readJson(request,1024);exactKeys(body,['offerId']);
    const offer=getCosmeticOffer(body.offerId,{now});if(!offer)fail('INVALID',400);
    if(path.endsWith('/checkout'))fail('NOT_CONFIGURED',503);
    const state=await cosmeticsFor(env,id,now);
    return json(quoteOwnedOffer({ownedItemIds:state.grants.map(grant=>grant.itemId)},offer));
  }
  if(path==='/api/me/cosmetics') {
    if(method==='GET')return json({...await cosmeticsFor(env,id,now),catalogVersion:PLUS_CATALOG_VERSION});
    if(method==='PATCH') {
      await assertSocialAllowed(env,id);
      const body=await readJson(request,4096);exactKeys(body,['selection','revision']);
      const revision=revisionOf(body.revision),patch=normalizeSelection(body.selection,now);
      if(!Object.keys(patch).length)fail('INVALID',400);
      const previous=await cosmeticsFor(env,id,now);
      const requested=Object.entries(patch).filter(([key,value])=>key==='badge'?value===true:value!==null);
      const owned=new Set(previous.grants.map(grant=>grant.itemId));
      for (const [key,value] of requested) {
        const item = getCosmetic(value,{now});
        if (item?.entitlement === 'progression' && !owned.has(value)) fail('COSMETIC_LOCKED',403);
        if (key==='badge' ? !previous.plusActive : !(previous.plusActive && subscriptionIncludesItem(item) || !item?.membershipOnly && owned.has(value))) fail('PLUS_REQUIRED',402);
      }
      if(previous.revision!==revision)fail('CONFLICT',409);
      // A player can equip from the store before opening their profile once.
      await ensurePlayerRow(env,id,now);
      const preferred={...EMPTY_COSMETICS,...previous.preferred,...patch};
      const actor="'"+id.replaceAll("'","''")+"'";
      const grant=requested.map(([key,value])=>key==='badge'?plusAccessSql(env,actor,now):cosmeticAccessSql(env,actor,value,now)).join(' AND ')||'1';
      const result=await env.DB.batch([
        statement(env,`INSERT INTO plus_cosmetics(user_id,selection_json,revision,updated_at) SELECT ?,?,1,? WHERE ${liveAccountSql('?')} AND ${grant} AND ${noMafiaMediaLeaseSql('?',now)} AND (?=0 OR EXISTS(SELECT 1 FROM plus_cosmetics WHERE user_id=? AND revision=?)) ON CONFLICT(user_id) DO UPDATE SET selection_json=excluded.selection_json,revision=plus_cosmetics.revision+1,updated_at=excluded.updated_at WHERE plus_cosmetics.revision=?`,id,JSON.stringify(preferred),now,id,id,id,revision,id,revision,revision),
        statement(env,'UPDATE player_profiles SET revision=revision+1,updated_at=? WHERE user_id=? AND changes()>0',now,id),
      ]);
      if(!changed(result[0])){await assertSocialAllowed(env,id);fail('CONFLICT',409);}
      await notifyAppearance(env,id);
      return json({...await cosmeticsFor(env,id,now),catalogVersion:PLUS_CATALOG_VERSION});
    }
  }
  if(path==='/api/me/setup-presets') {
    if(method==='GET') {
      const rows=(await statement(env,`SELECT * FROM plus_setup_presets WHERE user_id=? AND ${liveAccountSql('plus_setup_presets.user_id')} ORDER BY updated_at DESC,id`,id).all()).results||[];
      return json({presets:rows.map(presetView),limit:PRESET_LIMIT,plusActive:await plusActiveFor(env,id,now),readOnly:true});
    }
    if(method==='POST') {
      fail('FEATURE_DISABLED',403);
    }
  }
  const match=/^\/api\/me\/setup-presets\/([A-Za-z0-9_-]{1,80})(\/apply)?$/.exec(path);
  if(match) {
    const current=await ownPreset(env,id,match[1]);if(!current)fail('NOT_FOUND',404);
    if(match[2]&&method==='POST') {
      fail('FEATURE_DISABLED',403);
    }
    if(!match[2]&&['PATCH','DELETE'].includes(method)) {
      const body=await readJson(request,8192);exactKeys(body,method==='DELETE'?['revision']:['revision','name','settings']);
      const revision=revisionOf(body.revision);if(revision!==current.revision)fail('CONFLICT',409);
      if(method==='DELETE') {
        const result=await statement(env,`DELETE FROM plus_setup_presets WHERE id=? AND user_id=? AND revision=? AND ${liveAccountSql('plus_setup_presets.user_id')}`,current.id,id,revision).run();
        if(!changed(result))fail('CONFLICT',409);return json({ok:true});
      }
      fail('FEATURE_DISABLED',403);
    }
  }
  fail('NOT_FOUND',404);
}
