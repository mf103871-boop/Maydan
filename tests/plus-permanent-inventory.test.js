import test from 'node:test';
import assert from 'node:assert/strict';
import { localEnvironment } from '../server/local.mjs';
import { routeRequest } from '../server/worker.mjs';
import { createUser, deleteUser, upsertSubscription } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { cosmeticsFor, effectiveCosmetics, canUseCosmetic } from '../server/plus/access.mjs';
import { createCosmeticSettlement, paidMonthWindows, settleMonthlyGrants, quoteOwnedOffer } from '../server/plus/commerce.mjs';
import { selectRoomAppearance, prepareRoomAppearance } from '../server/plus/room-appearance.mjs';
import { getCosmeticOffer } from '../src/plus/catalog.js';

const ORIGIN='http://localhost:3000';
const JAN=Date.UTC(2027,0,31,12,15), FEB=Date.UTC(2027,1,28,12,15), MAR=Date.UTC(2027,2,31,12,15);
const wait=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
async function setup(t,vars={}) {
  const runtime=localEnvironment({vars:{PLUS_COMMERCE_LOCAL_PREVIEW:'1',...vars}}),env=runtime.env;t.after(()=>runtime.dispose());
  const user=await createUser(env,{name:'تجربة المخزون',email:crypto.randomUUID()+'@example.test'}),session=await issueSession(env,user.id);
  const verified=async event=>({verified:true,event});
  const settle=createCosmeticSettlement(verified);
  const count=async table=>(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
  async function api(path,body,method=body===undefined?'GET':'POST',token=session.token) {
    const res=await routeRequest(new Request(ORIGIN+path,{method,headers:{origin:ORIGIN,authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
    return {status:res.status,body:await res.json()};
  }
  const paid=(changes={})=>({provider:'local-test',environment:'local-preview',eventId:crypto.randomUUID(),transactionId:crypto.randomUUID(),userId:user.id,action:'paid',occurredAt:JAN,kind:'purchase',offerId:'sahra.frame.permanent',paid:true,amountMinor:100,currency:'TEST',...changes});
  const refund=e=>({provider:e.provider,environment:e.environment,eventId:crypto.randomUUID(),transactionId:e.transactionId,userId:e.userId,action:'refunded',occurredAt:MAR});
  const sub=(changes={})=>paid({kind:'subscription',offerId:undefined,productId:'plus.yearly',interval:'yearly',paidStart:JAN,paidEnd:Date.UTC(2028,0,31,12,15),...changes});
  return {env,user,api,settle,paid,refund,sub,count};
}

test('live quote is informational, checkout is unconfigured, no public endpoint can assert a grant',async t=>{
  const h=await setup(t);
  const quote=await h.api('/api/me/cosmetics/quote',{offerId:'sahra.frame.permanent'});assert.equal(quote.status,200);assert.equal(quote.body.pricing.configured,false);assert.equal(quote.body.pricing.amountMinor,null);
  const checkout=await h.api('/api/me/cosmetics/checkout',{offerId:'sahra.frame.permanent'});assert.equal(checkout.status,503);assert.equal(checkout.body.error,'NOT_CONFIGURED');
  assert.equal((await h.api('/api/me/cosmetics/checkout',{offerId:'sahra.frame.permanent',verified:true,itemIds:['sahra.frame']})).status,400);
  assert.equal((await h.api('/api/me/cosmetics/grant',{itemId:'sahra.frame'})).status,404);
  assert.equal(await h.count('plus_inventory_grants'),0);
  assert.throws(()=>createCosmeticSettlement(),{code:'NOT_CONFIGURED'});
  await assert.rejects(()=>createCosmeticSettlement(async event=>({verified:false,event}))(h.env,h.paid(),JAN),{code:'BILLING_UNVERIFIED'});
});

test('permanent frame/name/entrance/theme equip survives expiry while membership badge cannot be forged',async t=>{
  const h=await setup(t);await h.settle(h.env,h.paid({offerId:'sahra.bundle.permanent'}),JAN);
  const result=await h.api('/api/me/cosmetics',{selection:{frameId:'sahra.frame',nameColorId:'sahra.nameColor',entranceId:'sahra.entrance',roomThemeId:'sahra.roomTheme'},revision:0},'PATCH');
  assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.plusActive,false);assert.equal(result.body.effective.frameId,'sahra.frame');assert.equal(result.body.effective.entranceId,'sahra.entrance');assert.equal(result.body.effective.badge,false);
  assert.equal((await h.api('/api/me/cosmetics',{selection:{badge:true},revision:1},'PATCH')).status,402);
  assert.equal((await h.api('/api/me/cosmetics',{selection:{frameId:'plus.signature.frame'},revision:1},'PATCH')).status,402);
  const room={hostId:'seat',members:[{id:'seat',accountUserId:h.user.id}],phase:'lobby'};
  await selectRoomAppearance(h.env,room,'seat','sahra.roomTheme',JAN);assert.equal(room.appearance.themeId,'sahra.roomTheme');
  await prepareRoomAppearance(h.env,null,room,MAR);assert.equal(room.appearance.themeId,'sahra.roomTheme');
});

test('simultaneous restore/replay grants once and event body collisions cannot change ownership',async t=>{
  const h=await setup(t),e=h.paid();const results=await Promise.all(Array.from({length:6},()=>h.settle(h.env,e,JAN)));
  assert.equal(new Set(results.map(r=>r.orderId)).size,1);assert.equal(await h.count('plus_commerce_orders'),1);assert.equal(await h.count('plus_inventory_grants'),1);
  await h.settle(h.env,{...e,eventId:crypto.randomUUID()},JAN);assert.equal(await h.count('plus_inventory_grants'),1);
  await assert.rejects(()=>h.settle(h.env,{...e,offerId:'artist.frame.permanent'},JAN),{code:'CONFLICT'});
  assert.equal((await cosmeticsFor(h.env,h.user.id,JAN)).grants[0].itemId,'sahra.frame');
});

test('two accounts racing the same verified transaction have one canonical owner and no losing-user event',async t=>{
  const h=await setup(t),b=await createUser(h.env,{name:'ثاني',email:'other@example.test'}),e=h.paid();
  const outcomes=await Promise.allSettled([h.settle(h.env,e,JAN),h.settle(h.env,{...e,eventId:crypto.randomUUID(),userId:b.id},JAN)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'ALREADY_LINKED');
  const order=await h.env.DB.prepare('SELECT user_id FROM plus_commerce_orders').first();const loser=order.user_id===b.id?h.user.id:b.id;
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) AS n FROM plus_commerce_events WHERE user_id=?').bind(loser).first()).n,0);
  assert.equal((await cosmeticsFor(h.env,loser,JAN)).grants.length,0);
});

test('refund reverses only its order; a separate paid license remains and old restores never resurrect it',async t=>{
  const h=await setup(t),a=h.paid(),b=h.paid();await h.settle(h.env,a,JAN);await h.settle(h.env,b,JAN);
  await h.settle(h.env,h.refund(a),MAR);assert.equal((await cosmeticsFor(h.env,h.user.id,MAR)).grants.length,1);
  await h.settle(h.env,h.refund(b),MAR);assert.equal((await cosmeticsFor(h.env,h.user.id,MAR)).grants.length,0);
  await h.settle(h.env,{...a,eventId:crypto.randomUUID()},MAR);assert.equal((await cosmeticsFor(h.env,h.user.id,MAR)).grants.length,0);
  await h.settle(h.env,h.paid(),MAR);assert.equal((await cosmeticsFor(h.env,h.user.id,MAR)).grants.length,1);
});

test('refund arriving before original paid event leaves a terminal tombstone',async t=>{
  const h=await setup(t),e=h.paid();await h.settle(h.env,h.refund(e),JAN);await h.settle(h.env,e,MAR);
  assert.equal(await h.count('plus_commerce_orders'),1);assert.equal(await h.count('plus_inventory_grants'),0);
  assert.equal((await h.env.DB.prepare('SELECT status FROM plus_commerce_orders').first()).status,'refunded');
});

test('refunding a store order preserves an independently earned achievement license for the same item',async t=>{
  const h=await setup(t),e=h.paid({offerId:'noir.frame.permanent'});await h.settle(h.env,e,JAN);
  await h.env.DB.prepare('INSERT INTO mafia_achievements(user_id,achievement_id,earned_at,earned_match_key) VALUES(?,?,?,?)').bind(h.user.id,'mafia_first_qualified',JAN,'fixture-earned').run();
  await h.env.DB.prepare('INSERT INTO mafia_cosmetic_grants(user_id,item_id,source,achievement_id,granted_at) VALUES(?,?,?,?,?)').bind(h.user.id,'noir.frame','mafia_achievement','mafia_first_qualified',JAN).run();
  assert.equal((await h.api('/api/me/cosmetics',{selection:{frameId:'noir.frame'},revision:0},'PATCH')).status,200);
  await h.settle(h.env,h.refund(e),MAR);
  const state=await cosmeticsFor(h.env,h.user.id,MAR);assert.equal(state.grants.length,1);assert.equal(state.grants[0].source,'mafia_achievement');assert.equal(state.effective.frameId,'noir.frame');assert.equal(state.effective.badge,false);
});

test('annual calendar windows preserve Jan31 anchor, leap day and each original time of day',()=>{
  const windows=paidMonthWindows(JAN,Date.UTC(2028,0,31,12,15),'yearly');assert.equal(windows.length,12);assert.equal(windows[1].dueAt,FEB);assert.equal(windows[2].dueAt,MAR);
  const leap=paidMonthWindows(Date.UTC(2028,0,31,12,15),Date.UTC(2029,0,31,12,15),'yearly');assert.equal(leap[1].dueAt,Date.UTC(2028,1,29,12,15));assert.equal(leap[2].dueAt,Date.UTC(2028,2,31,12,15));
  assert.equal(paidMonthWindows(JAN,FEB,'monthly').length,1);
});

const schedule=()=>Array.from({length:12},(_,i)=>({id:'fixture-2027-'+(i+1),monthKey:'2027-'+String(i+1).padStart(2,'0'),itemId:'olive.frame',availableFrom:Date.UTC(2027,i,1),availableUntil:Date.UTC(2027,i+1,1)}));
test('annual paid period grants monthly without login, no early delivery and no restore duplication',async t=>{
  const h=await setup(t),drops=schedule(),settle=createCosmeticSettlement(async event=>({verified:true,event}),{drops}),e=h.sub();
  await settle(h.env,e,JAN);assert.equal(await h.count('plus_monthly_windows'),12);assert.equal(await h.count('plus_inventory_grants'),1);
  await settle(h.env,{...e,eventId:crypto.randomUUID()},JAN);assert.equal(await h.count('plus_inventory_grants'),1);
  await settleMonthlyGrants(h.env,FEB-1,{drops});assert.equal(await h.count('plus_inventory_grants'),1);
  await settleMonthlyGrants(h.env,MAR,{drops});assert.equal(await h.count('plus_inventory_grants'),3);
  await settleMonthlyGrants(h.env,Date.UTC(2028,0,31),{drops});assert.equal(await h.count('plus_inventory_grants'),12);
  assert.equal((await cosmeticsFor(h.env,h.user.id,Date.UTC(2028,0,31))).plusActive,false,'permanent reward does not fabricate subscription');
});

test('missing exact month/art remains pending and does not starve later configured months',async t=>{
  const h=await setup(t),drops=schedule(),settle=createCosmeticSettlement(async event=>({verified:true,event}),{drops:[{...drops[0],artReady:false},drops[2]]});
  const first=await settle(h.env,h.sub(),JAN);assert.equal(first.monthlySync,'pending');assert.equal(await h.count('plus_inventory_grants'),0);
  const result=await settleMonthlyGrants(h.env,MAR,{drops:[{...drops[0],artReady:false},drops[2]],limit:1});assert.equal(result.pending,2);assert.equal(await h.count('plus_inventory_grants'),1);
  const windows=(await h.env.DB.prepare('SELECT window_index,granted_at FROM plus_monthly_windows ORDER BY window_index').all()).results;
  assert.equal(windows[0].granted_at,null);assert.equal(windows[1].granted_at,null);assert.ok(windows[2].granted_at);
});

test('refund racing a due-month query prevents late grant and cancels all future windows',async t=>{
  const h=await setup(t),drops=schedule(),settle=createCosmeticSettlement(async event=>({verified:true,event}),{drops}),e=h.sub();await settle(h.env,e,JAN);
  const held=wait(),release=wait(),prepare=h.env.DB.prepare.bind(h.env.DB);let once=true;
  h.env.DB.prepare=sql=>{const s=prepare(sql);if(once&&sql.includes('SELECT w.* FROM plus_monthly_windows')){const bind=s.bind.bind(s);s.bind=(...args)=>{const b=bind(...args),all=b.all.bind(b);b.all=async()=>{const result=await all();once=false;held.resolve();await release.promise;return result;};return b;};}return s;};
  const job=settleMonthlyGrants(h.env,MAR,{drops});await held.promise;await settle(h.env,h.refund(e),MAR);release.resolve();await job;
  assert.equal((await cosmeticsFor(h.env,h.user.id,MAR)).grants.length,0);assert.equal((await h.env.DB.prepare('SELECT COUNT(*) AS n FROM plus_inventory_grants WHERE revoked_at IS NULL').first()).n,0);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) AS n FROM plus_monthly_windows WHERE revoked_at IS NULL').first()).n,0);
});

test('D1 batch failure rolls back event/order/grant together and permits exact event recovery',async t=>{
  const h=await setup(t),e=h.paid();await h.env.DB.exec("CREATE TRIGGER inventory_test_failure BEFORE INSERT ON plus_inventory_grants BEGIN SELECT RAISE(ABORT,'fixture'); END;");
  await assert.rejects(()=>h.settle(h.env,e,JAN));assert.equal(await h.count('plus_commerce_orders'),0);assert.equal(await h.count('plus_commerce_events'),0);
  await h.env.DB.exec('DROP TRIGGER inventory_test_failure;');await h.settle(h.env,e,JAN);assert.equal(await h.count('plus_inventory_grants'),1);
});

test('partial bundle quote charges TEST pricing only for missing permanent items, never subscription loans',()=>{
  const offer=getCosmeticOffer('sahra.bundle.permanent'),owned=[offer.itemIds[0],offer.itemIds[1]];
  const quote=quoteOwnedOffer({ownedItemIds:owned},offer,{currency:'TEST',priceMinor:600});assert.equal(quote.pricing.amountMinor,400);assert.deepEqual(quote.alreadyOwned,owned);assert.equal(quote.localOnly,true);
  assert.equal(quoteOwnedOffer({ownedItemIds:offer.itemIds},offer,{currency:'TEST',priceMinor:600}).purchasable,false);
  assert.equal(quoteOwnedOffer({subscriptionItemIds:offer.itemIds},offer,{currency:'TEST',priceMinor:600}).pricing.amountMinor,600);
  assert.equal(quoteOwnedOffer({ownedItemIds:owned},offer,{currency:'USD',priceMinor:600}).pricing.configured,false);
});

test('account deletion during verified-provider await cannot create an orphan ledger or license',async t=>{
  const h=await setup(t),held=wait(),release=wait(),e=h.paid();const settle=createCosmeticSettlement(async event=>{held.resolve();await release.promise;return {verified:true,event};});
  const pending=settle(h.env,e,JAN);await held.promise;await deleteUser(h.env,h.user.id);release.resolve();await assert.rejects(()=>pending,{code:'AUTH_EXPIRED'});
  for(const table of ['plus_commerce_orders','plus_commerce_events','plus_inventory_grants','plus_monthly_windows'])assert.equal(await h.count(table),0);
});

test('account deletion removes inventory, monthly windows and transaction ledgers',async t=>{
  const h=await setup(t);await h.settle(h.env,h.paid(),JAN);await h.settle(h.env,h.sub(),JAN);await deleteUser(h.env,h.user.id);
  for(const table of ['plus_commerce_orders','plus_commerce_events','plus_inventory_grants','plus_monthly_windows'])assert.equal(await h.count(table),0);
});

test('inventory is private; order refunds between license read and equip SQL cannot authorize a stale save',async t=>{
  const h=await setup(t),e=h.paid();await h.settle(h.env,e,JAN);
  const b=await createUser(h.env,{name:'غير المالك',email:'b@example.test'}),session=await issueSession(h.env,b.id);
  assert.equal((await h.api('/api/me/cosmetics/inventory',undefined,'GET',session.token)).body.ownedItemIds.length,0);
  const owned=await h.api('/api/me/cosmetics/inventory');assert.deepEqual(owned.body.ownedItemIds,['sahra.frame']);assert.equal(owned.body.grants[0].ownership,'permanent');
  const held=wait(),release=wait(),batch=h.env.DB.batch.bind(h.env.DB);let once=true;
  h.env.DB.batch=async statements=>{if(once&&statements.some(s=>s.sql.includes('INSERT INTO plus_cosmetics'))){once=false;held.resolve();await release.promise;}return batch(statements);};
  const pending=h.api('/api/me/cosmetics',{selection:{frameId:'sahra.frame'},revision:0},'PATCH');await held.promise;await h.settle(h.env,h.refund(e),MAR);release.resolve();assert.equal((await pending).status,409);
  assert.equal((await effectiveCosmetics(h.env,h.user.id,MAR)).frameId,null);assert.equal(await canUseCosmetic(h.env,h.user.id,'sahra.frame',MAR),false);
});

test('new members get signature defaults only without stored choices; expiration removes membership identity',async t=>{
  const h=await setup(t);await upsertSubscription(h.env,{source:'promo',external_id:'member-fixture',user_id:h.user.id,product:'plus.monthly',status:'active',until:Date.now()+86400000,will_renew:false,environment:'promo',occurred_at:Date.now()});
  const current=await h.api('/api/me/cosmetics');assert.equal(current.body.effective.frameId,'plus.signature.frame');assert.equal(current.body.effective.badge,true);
  assert.equal((await h.api('/api/me/cosmetics',{selection:{frameId:null,badge:false},revision:0},'PATCH')).status,200);
  assert.equal((await h.api('/api/me/cosmetics')).body.effective.frameId,null,'stored free choice is never overridden');
  const expired=await cosmeticsFor(h.env,h.user.id,Date.now()+10*86400000);assert.equal(expired.plusActive,false);assert.equal(expired.effective.badge,false);
});

test('concurrent event-id collision with a different transaction records one immutable event and order',async t=>{
  const h=await setup(t),e=h.paid(),prepare=h.env.DB.prepare.bind(h.env.DB),barrier=wait();let reads=0;
  h.env.DB.prepare=sql=>{const s=prepare(sql);if(sql.startsWith('SELECT * FROM plus_commerce_events')){const bind=s.bind.bind(s);s.bind=(...args)=>{const b=bind(...args),first=b.first.bind(b);b.first=async()=>{const result=await first();if(reads<2){reads++;if(reads===2)barrier.resolve();await barrier.promise;}return result;};return b;};}return s;};
  const result=await Promise.allSettled([h.settle(h.env,e,JAN),h.settle(h.env,{...e,transactionId:crypto.randomUUID()},JAN)]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.code,'CONFLICT');
  assert.equal(await h.count('plus_commerce_events'),1);assert.equal(await h.count('plus_commerce_orders'),1);assert.equal(await h.count('plus_inventory_grants'),1);
});

test('invalid dates and malformed nested item claims fail before a payment ledger write',async t=>{
  const h=await setup(t);assert.throws(()=>paidMonthWindows(Number.MAX_SAFE_INTEGER-1000,Number.MAX_SAFE_INTEGER,'yearly'),{code:'INVALID'});
  for(const changes of [{itemIds:[{id:'sahra.frame'}]},{offerId:{id:'sahra.frame.permanent'}},{currency:'USD'},{paidStart:Number.MAX_SAFE_INTEGER}])await assert.rejects(()=>h.settle(h.env,h.paid(changes),JAN));
  assert.equal(await h.count('plus_commerce_events'),0);
});

test('unpaid/trial events and non-test environments cannot mint monthly rewards',async t=>{
  const h=await setup(t);for(const changes of [{paid:false},{amountMinor:0},{currency:'UNTRUSTED'},{provider:'unknown'},{environment:'production'}])await assert.rejects(()=>h.settle(h.env,h.sub(changes),JAN));
  const prod={...h.env,PADDLE_ENV:'production',PLUS_COMMERCE_LOCAL_PREVIEW:undefined};
  await assert.rejects(()=>h.settle(prod,h.sub(),JAN),{code:'BILLING_UNVERIFIED'});
  await assert.rejects(()=>h.settle({...prod,PLUS_COMMERCE_LOCAL_PREVIEW:'1'},h.sub(),JAN),{code:'BILLING_UNVERIFIED'});
  await assert.rejects(()=>h.settle(prod,h.sub({provider:'apple',environment:'sandbox',currency:'USD'}),JAN),{code:'BILLING_ENVIRONMENT'});
  assert.equal(await h.count('plus_commerce_orders'),0);
});
