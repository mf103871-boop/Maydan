import { json, readJson } from '../protocol.mjs';
import { fail } from '../room-model.mjs';
import { requireSession, withRotation } from '../accounts/session.mjs';
import { liveAccountSql } from '../moderation/access.mjs';
import { assertSocialAllowed, noMafiaMediaLeaseSql } from '../mafia-access.mjs';
import { notifyUsers } from '../social/realtime.mjs';
import { friendIds } from '../social/db.mjs';
import { ensurePlayerRow } from '../profiles/db.mjs';
import { PLUS_CATALOG_VERSION, availableCollections, availableItems } from '../../src/plus/catalog.js';
import { EMPTY_COSMETICS, statement, cosmeticsFor, normalizeSelection, plusActiveFor, requirePlus, plusAccessSql } from './access.mjs';
import { PRESET_LIMIT, PRESET_SCHEMA_VERSION, normalizePresetSettings, presetName, presetView } from './presets.mjs';

const revisionOf=v=>Number.isSafeInteger(v)&&v>=0?v:fail('INVALID',400);
const exactKeys=(body,keys)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))fail('INVALID',400);};
const ownPreset=(env,id,presetId)=>statement(env,`SELECT * FROM plus_setup_presets WHERE id=? AND user_id=? AND ${liveAccountSql('plus_setup_presets.user_id')}`,presetId,id).first();
const changed=r=>Number(r?.meta?.changes||0)>0;
async function notifyAppearance(env,id) {try{await notifyUsers(env,[id,...await friendIds(env,id)],{type:'refresh',reason:'profile',userId:id});}catch{/* write already committed */}}
export const isPlusPath=path=>path==='/api/cosmetics/catalog'||path==='/api/me/cosmetics'||path==='/api/me/setup-presets'||path.startsWith('/api/me/setup-presets/');
export async function routePlus(request,env,url=new URL(request.url),charge) {
  if(!isPlusPath(url.pathname))return null;
  const now=Date.now(),method=request.method;
  if(url.pathname==='/api/cosmetics/catalog'&&method==='GET') {
    if(charge)await charge('profileRead');
    return json({version:PLUS_CATALOG_VERSION,collections:availableCollections(now),items:availableItems(now),serverTime:now});
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
  if(path==='/api/me/cosmetics') {
    if(method==='GET')return json({...await cosmeticsFor(env,id,now),catalogVersion:PLUS_CATALOG_VERSION});
    if(method==='PATCH') {
      await assertSocialAllowed(env,id);
      const body=await readJson(request,4096);exactKeys(body,['selection','revision']);
      const revision=revisionOf(body.revision),patch=normalizeSelection(body.selection,now);
      if(!Object.keys(patch).length)fail('INVALID',400);
      const paid=Object.entries(patch).some(([key,value])=>key==='badge'?value===true:value!==null);
      if(paid)await requirePlus(env,id,now);
      const previous=await cosmeticsFor(env,id,now);
      if(previous.revision!==revision)fail('CONFLICT',409);
      // A player can equip from the store before opening their profile once.
      await ensurePlayerRow(env,id,now);
      const preferred={...EMPTY_COSMETICS,...previous.preferred,...patch};
      const grant=paid?plusAccessSql(env,"'"+id.replaceAll("'","''")+"'",now):'1';
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
      return json({presets:rows.map(presetView),limit:PRESET_LIMIT,plusActive:await plusActiveFor(env,id,now)});
    }
    if(method==='POST') {
      const body=await readJson(request,8192);exactKeys(body,['name','game','settings']);
      const name=presetName(body.name),settings=normalizePresetSettings(body.game,body.settings);
      await requirePlus(env,id,now);
      const presetId=crypto.randomUUID();
      const result=await statement(env,`INSERT INTO plus_setup_presets(id,user_id,name,game,schema_version,settings_json,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${liveAccountSql('?')} AND ${plusAccessSql(env,'?',now)} AND (SELECT COUNT(*) FROM plus_setup_presets WHERE user_id=?)<${PRESET_LIMIT}`,presetId,id,name,body.game,PRESET_SCHEMA_VERSION,JSON.stringify(settings),now,now,id,id,id,id).run();
      if(!changed(result)){await requirePlus(env,id,now);fail('PRESET_LIMIT',409);}
      return json({preset:presetView(await ownPreset(env,id,presetId))},201);
    }
  }
  const match=/^\/api\/me\/setup-presets\/([A-Za-z0-9_-]{1,80})(\/apply)?$/.exec(path);
  if(match) {
    const current=await ownPreset(env,id,match[1]);if(!current)fail('NOT_FOUND',404);
    if(match[2]&&method==='POST') {
      const body=request.body?await readJson(request,1024):{};exactKeys(body,[]);
      await requirePlus(env,id,now);
      if(current.schema_version!==PRESET_SCHEMA_VERSION)fail('UPDATE_REQUIRED',409);
      const preset={...presetView(current),settings:normalizePresetSettings(current.game,JSON.parse(current.settings_json))};
      return json({preset,game:preset.game,settings:preset.settings});
    }
    if(!match[2]&&['PATCH','DELETE'].includes(method)) {
      const body=await readJson(request,8192);exactKeys(body,method==='DELETE'?['revision']:['revision','name','settings']);
      const revision=revisionOf(body.revision);if(revision!==current.revision)fail('CONFLICT',409);
      if(method==='DELETE') {
        const result=await statement(env,`DELETE FROM plus_setup_presets WHERE id=? AND user_id=? AND revision=? AND ${liveAccountSql('plus_setup_presets.user_id')}`,current.id,id,revision).run();
        if(!changed(result))fail('CONFLICT',409);return json({ok:true});
      }
      if(!Object.hasOwn(body,'name')&&!Object.hasOwn(body,'settings'))fail('INVALID',400);
      const name=Object.hasOwn(body,'name')?presetName(body.name):current.name;
      const settings=Object.hasOwn(body,'settings')?normalizePresetSettings(current.game,body.settings):normalizePresetSettings(current.game,JSON.parse(current.settings_json));
      await requirePlus(env,id,now);
      const result=await statement(env,`UPDATE plus_setup_presets SET name=?,settings_json=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=? AND ${liveAccountSql('plus_setup_presets.user_id')} AND ${plusAccessSql(env,'plus_setup_presets.user_id',now)}`,name,JSON.stringify(settings),now,current.id,id,revision).run();
      if(!changed(result))fail('CONFLICT',409);
      return json({preset:presetView(await ownPreset(env,id,current.id))});
    }
  }
  fail('NOT_FOUND',404);
}
