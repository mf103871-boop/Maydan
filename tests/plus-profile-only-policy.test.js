import test from 'node:test';
import assert from 'node:assert/strict';
import { localEnvironment } from '../server/local.mjs';
import { createUser, upsertSubscription } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeRequest } from '../server/worker.mjs';
import { cosmeticsFor, canUseCosmetic } from '../server/plus/access.mjs';
import { prepareRoomAppearance } from '../server/plus/room-appearance.mjs';
import { subscriptionIncludesKind, getCosmetic } from '../src/plus/catalog.js';
import { seedLegacyCosmeticLicense } from './helpers-legacy-cosmetics.js';
import { GRACE_MS } from '../src/shared/account/config.js';

async function setup(t) {
  const runtime=localEnvironment(),env=runtime.env;t.after(()=>runtime.dispose());
  const person=async()=>{const user=await createUser(env,{name:'حساب سياسة محلية'}),session=await issueSession(env,user.id);return{...user,token:session.token};};
  const api=async(user,path,body,method=body?'PATCH':'GET')=>{
    const response=await routeRequest(new Request('http://localhost:3000'+path,{method,headers:{origin:'http://localhost:3000',authorization:'Bearer '+user.token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
    return{status:response.status,body:await response.json()};
  };
  const subscription=async(user,active=true)=>upsertSubscription(env,{source:'promo',external_id:'narrow-'+user.id,user_id:user.id,product:'plus.monthly',status:active?'active':'expired',until:active?Date.now()+86400000:Date.now()-GRACE_MS-1000,environment:'promo',occurred_at:Date.now()});
  return{env,person,api,subscription};
}

test('server subscription capabilities and inventory expose only profile skin and frame, never forged extra slots',async t=>{
  const h=await setup(t),user=await h.person();
  assert.equal((await h.api(user,'/api/me')).body.premium.active,false);
  assert.deepEqual((await h.api(user,'/api/me/cosmetics/inventory')).body.subscriptionItemIds,[]);
  await h.subscription(user);
  const me=(await h.api(user,'/api/me')).body;
  assert.deepEqual(me.plus,{cosmetics:true,presets:false,stickers:false});assert.equal(me.gameplay.access,'free');
  const inventory=(await h.api(user,'/api/me/cosmetics/inventory')).body;
  assert.ok(inventory.subscriptionItemIds.length>0);
  assert.ok(inventory.subscriptionItemIds.every(id=>subscriptionIncludesKind(getCosmetic(id).kind)));
  const saved=await h.api(user,'/api/me/cosmetics',{revision:0,selection:{frameId:'sahra.frame',profileSkinId:'sahra.profileSkin'}});
  assert.equal(saved.status,200);assert.equal(saved.body.effective.profileSkinId,'sahra.profileSkin');
  for(const [slot,id] of Object.entries({avatarId:'artist.avatar',coverId:'noir.cover',nameColorId:'sahra.nameColor',roomThemeId:'sahra.roomTheme',entranceId:'sahra.entrance',councilSkinId:'sahra.councilSkin'})) {
    assert.equal((await h.api(user,'/api/me/cosmetics',{revision:1,selection:{[slot]:id}})).status,402,slot);
    assert.equal((await h.api(user,'/api/me/cosmetics')).body.revision,1,'rejected claims do not write');
  }
  assert.equal((await h.api(user,'/api/me/cosmetics',{revision:1,selection:{avatarId:'artist.avatar'},ownedItemIds:['artist.avatar']})).status,400);
});

test('retired preferences stay stored while permanent licenses remain usable without membership or a badge',async t=>{
  const h=await setup(t),user=await h.person(),other=await h.person();await h.subscription(user);
  const old={avatarId:'artist.avatar',coverId:'noir.cover',roomThemeId:'sahra.roomTheme',councilSkinId:'sahra.councilSkin'};
  await h.env.DB.prepare('INSERT INTO plus_cosmetics(user_id,selection_json,revision,updated_at) VALUES(?,?,0,?)').bind(user.id,JSON.stringify(old),Date.now()).run();
  const state=await cosmeticsFor(h.env,user.id);assert.equal(state.preferred.avatarId,'artist.avatar');assert.equal(state.effective.avatarId,null);assert.equal(state.effective.councilSkinId,null);
  await h.api(user,'/api/me/cosmetics',{revision:0,selection:{profileSkinId:'sahra.profileSkin',frameId:'sahra.frame'}});
  for(const [key,value]of Object.entries(old))assert.equal((await cosmeticsFor(h.env,user.id)).preferred[key],value);
  await h.subscription(user,false);
  const orderId=await seedLegacyCosmeticLicense(h.env,user.id,['artist.avatar','sahra.roomTheme','sahra.frame']);
  assert.equal((await h.api(user,'/api/me/cosmetics',{revision:1,selection:{avatarId:'artist.avatar',roomThemeId:'sahra.roomTheme',frameId:'sahra.frame'}})).status,200);
  const owned=await cosmeticsFor(h.env,user.id);assert.equal(owned.plusActive,false);assert.equal(owned.effective.avatarId,'artist.avatar');assert.equal(owned.effective.frameId,'sahra.frame');assert.equal(owned.effective.badge,false);assert.equal(owned.effective.profileSkinId,null);
  assert.equal(await canUseCosmetic(h.env,other.id,'artist.avatar'),false,'another account cannot borrow the license');
  assert.equal((await h.api(other,'/api/me/cosmetics',{revision:0,selection:{avatarId:'artist.avatar'}})).status,402);
  await h.env.DB.prepare("UPDATE plus_commerce_orders SET status='refunded' WHERE id=?").bind(orderId).run();
  assert.equal((await cosmeticsFor(h.env,user.id)).effective.avatarId,null);assert.equal((await cosmeticsFor(h.env,user.id)).preferred.avatarId,'artist.avatar');
});

test('membership cannot paint a room; a real historical theme is independent and a saved Council choice stays inert',async t=>{
  const h=await setup(t),user=await h.person();await h.subscription(user);
  const choice={hostId:'seat',themeId:'sahra.roomTheme',councilSkinId:'sahra.councilSkin'};
  const room={phase:'lobby',hostId:'seat',members:[{id:'seat',accountUserId:user.id}],appearanceChoice:{...choice}};
  await prepareRoomAppearance(h.env,null,room);assert.equal(room.appearance,null);assert.deepEqual(room.appearanceChoice,choice);
  await seedLegacyCosmeticLicense(h.env,user.id,['sahra.roomTheme']);
  await prepareRoomAppearance(h.env,null,room);assert.equal(room.appearance.themeId,'sahra.roomTheme');assert.equal(room.appearance.councilSkinId,undefined);assert.deepEqual(room.appearanceChoice,choice);
});

test('an active member cannot use membership to bypass a permanent-license refund racing a retired-slot write',async t=>{
  const h=await setup(t),user=await h.person();await h.subscription(user);
  const orderId=await seedLegacyCosmeticLicense(h.env,user.id,['artist.avatar']);
  const batch=h.env.DB.batch.bind(h.env.DB);let refunded=false;
  h.env.DB.batch=async statements=>{
    if(!refunded&&statements.some(statement=>statement.sql.includes('INSERT INTO plus_cosmetics'))) {
      refunded=true;
      await h.env.DB.prepare("UPDATE plus_commerce_orders SET status='refunded' WHERE id=?").bind(orderId).run();
    }
    return batch(statements);
  };
  const attempted=await h.api(user,'/api/me/cosmetics',{revision:0,selection:{avatarId:'artist.avatar'}});
  assert.equal(refunded,true);assert.equal(attempted.status,409);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM plus_cosmetics WHERE user_id=?').bind(user.id).first()).n,0);
  const state=await cosmeticsFor(h.env,user.id);assert.equal(state.plusActive,true);assert.equal(state.effective.avatarId,null);
});
