// This Node-only loopback lab is never imported by the application or Worker.
// Fake billing is deliberately outside routeRequest and cannot run remotely.
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUIReview } from './ui-preview.mjs';
import { requireSession, me } from '../server/accounts/session.mjs';
import { upsertSubscription } from '../server/accounts/db.mjs';
import { cosmeticsFor } from '../server/plus/access.mjs';
import { createCosmeticSettlement, quoteOwnedOffer, settleMonthlyGrants } from '../server/plus/commerce.mjs';
import { getCosmeticOffer, MONTHLY_COSMETIC_DROPS } from '../src/plus/catalog.js';
import { GRACE_MS } from '../src/shared/account/config.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SCENARIOS=['free','plus','owned','expired','refunded','annual'];
const inventoryOf=async(env,id)=>{const state=await cosmeticsFor(env,id,Date.now(),{includeMonthly:true});return {...state,ownedItemIds:[...new Set(state.grants.map(g=>g.itemId))]};};
const signature=value=>createHash('sha256').update(JSON.stringify([...value.ownedItemIds].sort())).digest('hex');
// The synthetic purchase has a fixed flat schema. Match the domain's normalized
// receipt hash before treating a lost write response as a committed checkout.
const receiptSignature=event=>createHash('sha256').update(JSON.stringify({...event,itemIds:[...new Set(event.itemIds)].sort()},(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)).digest('hex');
const checkoutPending=()=>Object.assign(Error(),{code:'CHECKOUT_PENDING',status:409});
const expiryDrops=()=>{const d=new Date();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-2);const monthKey=d.toISOString().slice(0,7);return MONTHLY_COSMETIC_DROPS.some(drop=>drop.monthKey===monthKey)?MONTHLY_COSMETIC_DROPS:[...MONTHLY_COSMETIC_DROPS,{id:'local-expired-gift',monthKey,itemId:'sahra.frame',availableFrom:0}];};

export async function startPlusPreview({port=4182,apiPort=8792,build=true,watchSource=true,requestHook=null,assetRoot}={}) {
  const quotes=new Map(),seeded=new Map(),lastPurchases=new Map();
  const checkoutQueues=new Map(),unresolvedCheckouts=new Map();
  async function serializedCheckout(userId,operation) {
    const previous=checkoutQueues.get(userId)||Promise.resolve();
    const result=previous.then(operation,operation);
    const tail=result.then(()=>{},()=>{}).finally(()=>{if(checkoutQueues.get(userId)===tail)checkoutQueues.delete(userId);});
    checkoutQueues.set(userId,tail);return result;
  }
  function committedCheckout(userId,record) {
    record.state='done';lastPurchases.set(userId,record.event);
    if(unresolvedCheckouts.get(userId)===record)unresolvedCheckouts.delete(userId);
  }
  async function reconcileCheckout(env,userId,record) {
    try {
      const event=record.event;
      const order=await env.DB.prepare('SELECT * FROM plus_commerce_orders WHERE provider=? AND environment=? AND external_id=?').bind(event.provider,event.environment,event.transactionId).first();
      const receipt=await env.DB.prepare('SELECT * FROM plus_commerce_events WHERE provider=? AND environment=? AND event_id=?').bind(event.provider,event.environment,event.eventId).first();
      if(!order||!receipt||order.user_id!==userId||order.kind!=='purchase'||order.offer_id!==event.offerId||!['paid','refunded','revoked'].includes(order.status)||order.amount_minor!==event.amountMinor||order.currency!==event.currency||
        JSON.stringify(JSON.parse(order.item_ids_json).sort())!==JSON.stringify([...new Set(event.itemIds)].sort())||receipt.user_id!==userId||receipt.external_id!==event.transactionId||receipt.event_type!=='paid'||receipt.payload_hash!==receiptSignature(event))return false;
      committedCheckout(userId,record);return true;
    } catch { return false; }
  }
  const settle=createCosmeticSettlement(async event=>({verified:true,event}),{drops:expiryDrops()});
  const eventBase=(userId,transactionId)=>({provider:'local-test',environment:'local-preview',eventId:randomUUID(),transactionId,userId,occurredAt:Date.now()});
  async function membership(env,userId,active=true) {
    const now=Date.now();
    await upsertSubscription(env,{source:'paddle',external_id:`local-plus-${userId}`,user_id:userId,product:'plus.monthly',status:active?'active':'canceled',until:active?now+30*86400000:now-GRACE_MS-86400000,will_renew:active?1:0,environment:'sandbox',occurred_at:now,updated_at:now});
  }
  async function seed(env,record,scenario) {
    const userId=record.me.user.id,now=Date.now();
    if(['plus','annual','expired'].includes(scenario)) {
      const start=new Date();start.setUTCDate(1);start.setUTCHours(0,0,0,0);
      if(scenario==='expired')start.setUTCMonth(start.getUTCMonth()-2);
      const end=new Date(start);end.setUTCMonth(end.getUTCMonth()+(scenario==='annual'?12:1));
      await settle(env,{...eventBase(userId,`local-membership-${userId}`),action:'paid',kind:'subscription',productId:scenario==='annual'?'plus.yearly':'plus.monthly',interval:scenario==='annual'?'yearly':'monthly',paidStart:start.getTime(),paidEnd:end.getTime(),paid:true,amountMinor:12000,currency:'TEST'},now);
      await membership(env,userId,scenario!=='expired');
      // Explicit synthetic profile/frame selections make expiry visible. The
      // current subscription never equips a room or replaces the player's photo.
      const selection={frameId:scenario==='expired'?'sahra.frame':'plus.signature.frame',profileSkinId:'sahra.profileSkin'};
      await env.DB.prepare('INSERT INTO plus_cosmetics(user_id,selection_json,revision,updated_at) VALUES(?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET selection_json=excluded.selection_json,revision=plus_cosmetics.revision+1,updated_at=excluded.updated_at').bind(userId,JSON.stringify(selection),now).run();
    }
    if(['owned','refunded'].includes(scenario)) {
      const offerId=scenario==='owned'?'sahra.bundle.permanent':'artist.bundle.permanent';
      const tx=`local-seed-purchase-${userId}`,event={...eventBase(userId,tx),action:'paid',kind:'purchase',offerId,paid:true,amountMinor:6000,currency:'TEST'};
      await settle(env,event);lastPurchases.set(userId,event);
      if(scenario==='refunded')await settle(env,{...eventBase(userId,tx),action:'refunded'});
      if(scenario==='owned') {
        const selection={frameId:'sahra.frame',avatarId:'sahra.avatar',coverId:'sahra.cover',nameColorId:'sahra.nameColor',roomThemeId:'sahra.roomTheme',entranceId:'sahra.entrance',badge:false};
        await env.DB.prepare('INSERT INTO plus_cosmetics(user_id,selection_json,revision,updated_at) VALUES(?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET selection_json=excluded.selection_json,revision=plus_cosmetics.revision+1,updated_at=excluded.updated_at').bind(userId,JSON.stringify(selection),now).run();
      }
    }
  }
  async function authenticated(req,url,env) {
    const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(typeof v==='string')headers.set(k,v);
    return (await requireSession(env,new Request(url,{headers}))).user.id;
  }
  const hook=async({req,res,url,backend,actor,bodyOf,json})=>{
    const lab=url.pathname.startsWith('/__plus_lab__/');
    try {
      if(url.pathname==='/plus-lab/'||url.pathname==='/plus-lab') {res.writeHead(200,{'content-type':'text/html;charset=utf-8','cache-control':'no-store'});res.end(await readFile(path.join(ROOT,'scripts/plus-preview/index.html')));return true;}
      if(['/plus-lab/lab.js','/plus-lab/lab.css'].includes(url.pathname)) {res.writeHead(200,{'content-type':url.pathname.endsWith('.js')?'text/javascript;charset=utf-8':'text/css;charset=utf-8','cache-control':'no-store'});res.end(await readFile(path.join(ROOT,'scripts/plus-preview',path.basename(url.pathname))));return true;}
      if(url.pathname==='/__plus_lab__/meta'&&req.method==='GET') {json(res,{localOnly:true,realPayments:false,persistence:'isolated in-memory database',scenarios:SCENARIOS,origin:url.origin});return true;}
      if(url.pathname==='/__plus_lab__/scenario'&&req.method==='POST') {
        const body=await bodyOf(req);if(!SCENARIOS.includes(body.scenario))throw Object.assign(Error(),{code:'INVALID'});
        const index=SCENARIOS.indexOf(body.scenario);
        // Reserve before awaiting: simultaneous tabs never mint a second gift.
        if(!seeded.has(index)) {const pending=(async()=>{const record=await actor(index);await seed(backend.env,record,body.scenario);return record;})();seeded.set(index,pending);}
        const record=await seeded.get(index),fresh=await actor(index);
        json(res,{...fresh,me:await me(backend.env,{id:record.me.user.id,name:record.me.user.name,email:record.me.user.email}),scenario:body.scenario,localOnly:true});return true;
      }
      if(url.pathname==='/__plus_lab__/action'&&req.method==='POST') {
        const userId=await authenticated(req,url,backend.env),body=await bodyOf(req),event=lastPurchases.get(userId);
        if(body.action==='expire')await membership(backend.env,userId,false);
        else if(body.action==='refund'&&event)await settle(backend.env,{...eventBase(userId,event.transactionId),action:'refunded'});
        else if(body.action==='replay'&&event)await settle(backend.env,event);
        else if(body.action==='settle-monthly')await settleMonthlyGrants(backend.env,Date.now(),{drops:expiryDrops()});
        else throw Object.assign(Error(),{code:'NO_TRANSACTION'});
        json(res,{localOnly:true,inventory:await inventoryOf(backend.env,userId)});return true;
      }
      if(['/api/me/cosmetics/quote','/api/me/cosmetics/checkout'].includes(url.pathname)&&req.method==='POST') {
        const userId=await authenticated(req,url,backend.env),body=await bodyOf(req);
        const offer=getCosmeticOffer(body.offerId);if(!offer)throw Object.assign(Error(),{code:'INVALID'});
        if(url.pathname.endsWith('/quote')) {
          const inventory=await inventoryOf(backend.env,userId);
          const quote=quoteOwnedOffer(inventory,offer,{priceMinor:offer.itemIds.length*1000,currency:'TEST'}),quoteId=randomUUID();
          quotes.set(quoteId,{userId,offerId:offer.id,signature:signature(inventory),expires:Date.now()+120000,quote,state:'open'});
          if(quotes.size>200)for(const [key,row]of quotes)if(row.expires<Date.now()&&['open','done'].includes(row.state))quotes.delete(key);
          json(res,{...quote,quoteId,localOnly:true,testNotice:'قيمة اختبار فقط؛ لا خصم ولا اتصال بمزوّد دفع.'});return true;
        }
        const record=quotes.get(body.quoteId);
        if(!record||record.userId!==userId||record.offerId!==offer.id)throw Object.assign(Error(),{code:'QUOTE_INVALID'});
        const result=await serializedCheckout(userId,async()=>{
          const unresolved=unresolvedCheckouts.get(userId);
          if(unresolved&&!await reconcileCheckout(backend.env,userId,unresolved))throw checkoutPending();
          // Another quote may have changed ownership while this request waited.
          // Check the account's authoritative inventory inside the same lease.
          let current;
          try {current=await inventoryOf(backend.env,userId);}
          catch(error){if(record.state==='done'||unresolvedCheckouts.has(userId))throw checkoutPending();throw error;}
          if(record.state==='done')return {localOnly:true,transactionId:record.event.transactionId,inventory:current,cosmetics:current};
          if(record.state!=='open'||record.expires<Date.now()||record.signature!==signature(current)||record.quote.allOwned)throw Object.assign(Error(),{code:'CONFLICT'});
          record.state='settling';
          const event={...eventBase(userId,body.quoteId),action:'paid',kind:'purchase',offerId:offer.id,itemIds:record.quote.missingItemIds,paid:true,amountMinor:record.quote.pricing.amountMinor,currency:'TEST'};
          record.event=event;unresolvedCheckouts.set(userId,record);
          try {await settle(backend.env,event);committedCheckout(userId,record);}
          catch {
            record.state='unknown';
            if(!await reconcileCheckout(backend.env,userId,record))throw checkoutPending();
          }
          let next;try {next=await inventoryOf(backend.env,userId);}catch {throw checkoutPending();}
          return {localOnly:true,transactionId:event.transactionId,inventory:next,cosmetics:next};
        });
        json(res,result);return true;
      }
      return false;
    } catch(error) {if(!lab&&!url.pathname.startsWith('/api/me/cosmetics/'))throw error;json(res,{error:error.code||'LOCAL_PREVIEW_ERROR',localOnly:true},error.status||409);return true;}
  };
  const app=await startUIReview({port,apiPort,build,watchSource,assetRoot,requestHook:async args => await hook(args) || Boolean(requestHook && await requestHook(args)),localVars:{PLUS_COMMERCE_LOCAL_PREVIEW:'1'}});
  const timer=setInterval(()=>void settleMonthlyGrants(app.backend.env,Date.now(),{drops:expiryDrops()}).catch(()=>{}),30000);timer.unref();
  return {...app,url:`http://127.0.0.1:${port}/plus-lab/`,close:async()=>{clearInterval(timer);await app.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=await startPlusPreview({port:Number(process.env.PLUS_REVIEW_PORT||4182),apiPort:Number(process.env.PLUS_REVIEW_API_PORT||8792),build:!process.argv.includes('--no-build')});
  console.log(`[plus-lab] ${app.url} — LOCAL ONLY; synthetic accounts, TEST transactions, no provider payments.`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
}
