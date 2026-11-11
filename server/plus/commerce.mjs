import * as catalog from '../../src/plus/catalog.js';
import { liveAccountSql } from '../moderation/access.mjs';
import { fail } from '../room-model.mjs';

const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:@-]{1,192}$/.test(value);
const clock = value => Number.isSafeInteger(value) && value > 0 && Number.isFinite(new Date(value).getTime());
const canonical = value => JSON.stringify(value,(_key,child)=>child&&typeof child==='object'&&!Array.isArray(child)?Object.fromEntries(Object.entries(child).sort(([a],[b])=>a.localeCompare(b))):child);
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))))].map(n => n.toString(16).padStart(2, '0')).join('');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
const orderFor = (env, event) => stmt(env, 'SELECT * FROM plus_commerce_orders WHERE provider=? AND environment=? AND external_id=?', event.provider, event.environment, event.transactionId).first();
const eventFor = (env, event) => stmt(env, 'SELECT * FROM plus_commerce_events WHERE provider=? AND environment=? AND event_id=?', event.provider, event.environment, event.eventId).first();

export function quoteOwnedOffer(inventory, offer, pricing) {
  if (!offer || offer.ownership !== 'permanent' || !Array.isArray(offer.itemIds) || !offer.itemIds.length) fail('INVALID', 400);
  const owned = new Set(inventory.ownedItemIds || inventory.grants?.map(g => g.itemId) || []);
  const itemIds = [...new Set(offer.itemIds)], alreadyOwned = itemIds.filter(item => owned.has(item)), missingItemIds = itemIds.filter(item => !owned.has(item));
  const localOnly = pricing?.currency === 'TEST' && Number.isSafeInteger(pricing.priceMinor) && pricing.priceMinor > 0;
  return { offerId: offer.id, ownership: 'permanent', itemIds, alreadyOwned, missingItemIds, allOwned: missingItemIds.length === 0,
    pricing: { configured: localOnly, currency: localOnly ? 'TEST' : null, amountMinor: localOnly ? Math.ceil(pricing.priceMinor * missingItemIds.length / itemIds.length) : null },
    purchasable: localOnly && missingItemIds.length > 0, localOnly };
}

export function paidMonthWindows(start, end, interval) {
  if (!clock(start) || !clock(end) || end <= start || !['monthly', 'yearly'].includes(interval) || end - start > (interval === 'monthly' ? 40 : 370) * 86400000) fail('INVALID', 400);
  const original = new Date(start), count = interval === 'monthly' ? 1 : 12, windows = [];
  for (let index = 0; index < count; index++) {
    const first = new Date(start);first.setUTCDate(1);first.setUTCMonth(original.getUTCMonth() + index);
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(original.getUTCDate(), days));
    if (first.getTime() < end) windows.push({ index, dueAt: first.getTime() });
  }
  return windows;
}

function normalizedVerifiedEvent(result, env) {
  if (result?.verified !== true || !exact(result.event, ['provider','environment','eventId','transactionId','userId','action','occurredAt','kind','offerId','itemIds','productId','paidStart','paidEnd','interval','paid','amountMinor','currency'])) fail('BILLING_UNVERIFIED', 403);
  const e = structuredClone(result.event);
  if (!['apple','paddle','local-test'].includes(e.provider) || !['production','sandbox','local-preview'].includes(e.environment) || ![e.eventId,e.transactionId,e.userId].every(id) || !clock(e.occurredAt) || !['paid','refunded','revoked'].includes(e.action)) fail('INVALID', 400);
  if (['kind','offerId','productId','interval','currency'].some(key=>e[key]!=null&&!id(e[key])) || ['paidStart','paidEnd'].some(key=>e[key]!=null&&!clock(e[key])) || e.paid!==undefined&&typeof e.paid!=='boolean') fail('INVALID',400);
  if(e.itemIds!==undefined){if(!Array.isArray(e.itemIds)||!e.itemIds.length||e.itemIds.length>32||e.itemIds.some(item=>!id(item)))fail('INVALID',400);e.itemIds=[...new Set(e.itemIds)].sort();}
  if (e.provider === 'local-test' ? env.PADDLE_ENV==='production' || env.PLUS_COMMERCE_LOCAL_PREVIEW !== '1' || e.environment !== 'local-preview' : e.environment === 'local-preview') fail('BILLING_UNVERIFIED', 403);
  if(e.provider==='local-test'&&e.action==='paid'&&e.currency!=='TEST')fail('BILLING_UNVERIFIED',403);
  if (env.PADDLE_ENV === 'production' && e.environment === 'sandbox') fail('BILLING_ENVIRONMENT', 403);
  if (e.action === 'paid' && (e.paid !== true || !Number.isSafeInteger(e.amountMinor) || e.amountMinor <= 0 || !/^(?:[A-Z]{3}|TEST)$/.test(e.currency || '') || !['purchase','subscription'].includes(e.kind))) fail('BILLING_UNVERIFIED', 403);
  if (e.action === 'paid' && e.kind === 'subscription') {
    if (!['plus.monthly','plus.yearly'].includes(e.productId) || e.interval !== (e.productId === 'plus.yearly' ? 'yearly' : 'monthly')) fail('INVALID', 400);
    paidMonthWindows(e.paidStart, e.paidEnd, e.interval);
  }
  return e;
}

// No HTTP endpoint can mint this verifier. The production adapter is deliberately
// unconfigured; the loopback-only preview server injects its synthetic verifier.
export function createCosmeticSettlement(verify, { drops } = {}) {
  if (typeof verify !== 'function') fail('NOT_CONFIGURED', 503);
  return async (env, input, now = Date.now()) => {
    if (!env.DB || !clock(now)) fail('INVALID', 400);
    const event = normalizedVerifiedEvent(await verify(input), env);
    const previous = await orderFor(env, event);
    if (previous && previous.user_id !== event.userId) fail('ALREADY_LINKED', 409);
    let items = [], fingerprint = null;
    if (event.action === 'paid') {
      if (event.kind === 'purchase') {
        const offer = catalog.getCosmeticOffer?.(event.offerId, { now });
        if (previous?.kind === 'purchase' && previous.offer_id === event.offerId) {
          items = JSON.parse(previous.item_ids_json);
          if(event.itemIds!==undefined&&canonical(event.itemIds)!==canonical(items))fail('CONFLICT',409);
        }
        else {
          if (!offer || offer.ownership !== 'permanent') fail('INVALID', 400);
          items = event.itemIds === undefined ? [...offer.itemIds] : event.itemIds;
          if (!Array.isArray(items) || !items.length || items.length > 32 || items.some(item => !offer.itemIds.includes(item))) fail('INVALID', 400);
          items = [...new Set(items)].sort();
        }
      }
      fingerprint = await sha({ userId:event.userId,provider:event.provider,environment:event.environment,transactionId:event.transactionId,kind:event.kind,offerId:event.offerId || null,items:JSON.stringify(items),productId:event.productId || null,paidStart:event.paidStart || null,paidEnd:event.paidEnd || null,interval:event.interval || null,amountMinor:event.amountMinor,currency:event.currency });
      if (previous?.identity_hash && previous.identity_hash !== fingerprint) fail('CONFLICT', 409);
    }
    const hash = await sha(event), priorEvent = await eventFor(env, event);
    if (priorEvent && (priorEvent.user_id !== event.userId || priorEvent.payload_hash !== hash)) fail('CONFLICT', 409);
    const orderId = previous?.id || crypto.randomUUID();
    const accepted = `EXISTS(SELECT 1 FROM plus_commerce_events ce WHERE ce.provider=? AND ce.environment=? AND ce.event_id=? AND ce.user_id=? AND ce.payload_hash=?)`;
    const acceptedArgs = [event.provider,event.environment,event.eventId,event.userId,hash];
    const owner = `provider=? AND environment=? AND external_id=? AND user_id=?`;
    const ownerArgs = [event.provider,event.environment,event.transactionId,event.userId];
    const statements = [
      stmt(env, `INSERT OR IGNORE INTO plus_commerce_events(provider,environment,event_id,user_id,external_id,event_type,payload_hash,occurred_at,processed_at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE ${liveAccountSql('?')} AND NOT EXISTS(SELECT 1 FROM plus_commerce_orders po WHERE po.provider=? AND po.environment=? AND po.external_id=?
          AND (po.user_id!=? OR (? IS NOT NULL AND po.identity_hash IS NOT NULL AND po.identity_hash!=?)))`, event.provider,event.environment,event.eventId,event.userId,event.transactionId,event.action,hash,event.occurredAt,now,event.userId,event.userId,...ownerArgs,fingerprint,fingerprint),
      stmt(env, `INSERT OR IGNORE INTO plus_commerce_orders(id,user_id,provider,environment,external_id,status,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,? WHERE ${accepted} AND ${liveAccountSql('?')}`, orderId,event.userId,event.provider,event.environment,event.transactionId,event.action === 'paid' ? 'paid' : event.action,now,now,...acceptedArgs,event.userId,event.userId),
    ];
    if (event.action === 'paid') {
      statements.push(stmt(env, `UPDATE plus_commerce_orders SET kind=?,offer_id=?,product_id=?,item_ids_json=?,paid_start=?,paid_end=?,billing_interval=?,amount_minor=?,currency=?,identity_hash=?,updated_at=?
        WHERE ${owner} AND identity_hash IS NULL AND ${accepted} AND ${liveAccountSql('plus_commerce_orders.user_id')}`,event.kind,event.offerId || null,event.productId || null,JSON.stringify(items),event.paidStart || null,event.paidEnd || null,event.interval || null,event.amountMinor,event.currency,fingerprint,now,...ownerArgs,...acceptedArgs));
      if (event.kind === 'purchase') statements.push(stmt(env, `INSERT OR IGNORE INTO plus_inventory_grants(id,user_id,item_id,source_type,source_id,order_id,granted_at)
        SELECT 'store:'||po.id||':'||j.value,po.user_id,j.value,'store',po.id,po.id,? FROM plus_commerce_orders po,json_each(po.item_ids_json) j
        WHERE po.provider=? AND po.environment=? AND po.external_id=? AND po.user_id=? AND po.identity_hash=? AND po.status='paid' AND ${accepted} AND ${liveAccountSql('po.user_id')}`,now,...ownerArgs,fingerprint,...acceptedArgs));
      else for (const window of paidMonthWindows(event.paidStart,event.paidEnd,event.interval)) statements.push(stmt(env, `INSERT OR IGNORE INTO plus_monthly_windows(id,user_id,order_id,window_index,due_at)
        SELECT 'monthly:'||po.id||':${window.index}',po.user_id,po.id,?,? FROM plus_commerce_orders po
        WHERE po.provider=? AND po.environment=? AND po.external_id=? AND po.user_id=? AND po.identity_hash=? AND po.status='paid' AND ${accepted} AND ${liveAccountSql('po.user_id')}`,window.index,window.dueAt,...ownerArgs,fingerprint,...acceptedArgs));
    } else {
      statements.push(stmt(env, `UPDATE plus_commerce_orders SET status=?,updated_at=? WHERE ${owner} AND ${accepted}`,event.action,now,...ownerArgs,...acceptedArgs));
      for (const table of ['plus_inventory_grants','plus_monthly_windows']) statements.push(stmt(env, `UPDATE ${table} SET revoked_at=COALESCE(revoked_at,?)
        WHERE user_id=? AND order_id IN(SELECT id FROM plus_commerce_orders WHERE ${owner}) AND ${accepted}`,now,event.userId,...ownerArgs,...acceptedArgs));
    }
    await env.DB.batch(statements);
    const settled = await orderFor(env,event), recorded = await eventFor(env,event);
    if(recorded&&(recorded.payload_hash!==hash||recorded.user_id!==event.userId))fail('CONFLICT',409);
    if (!settled || settled.user_id !== event.userId) fail(settled ? 'ALREADY_LINKED' : 'AUTH_EXPIRED', settled ? 409 : 401);
    if (!recorded || recorded.payload_hash !== hash || recorded.user_id !== event.userId || fingerprint && settled.identity_hash !== fingerprint) fail('CONFLICT',409);
    let monthlySync = event.kind==='subscription'?'complete':'not-applicable';
    if(event.kind==='subscription')try {const result=await settleMonthlyGrants(env,now,{drops});if(result.pending||result.morePossible)monthlySync='pending';} catch { monthlySync = 'pending'; }
    return { orderId:settled.id,status:settled.status,replayed:Boolean(priorEvent),monthlySync };
  };
}

export async function settleMonthlyGrants(env, now = Date.now(), { drops = catalog.MONTHLY_COSMETIC_DROPS || [], limit = 60 } = {}) {
  if (!env.DB || !clock(now) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('INVALID',400);
  const ready=drops.filter(drop=>{
    const item=catalog.getCosmetic(drop.itemId,{now});
    return /^\d{4}-\d{2}$/.test(drop.monthKey)&&drops.filter(d=>d.monthKey===drop.monthKey).length===1&&drop.availableFrom<=now&&drop.artReady!==false&&item&&item.artReady!==false&&!item.membershipOnly&&['frame','avatar'].includes(item.kind);
  });
  const readyMonths=JSON.stringify(ready.map(drop=>drop.monthKey));
  const unavailable=await stmt(env,`SELECT COUNT(*) AS n FROM plus_monthly_windows w JOIN plus_commerce_orders po ON po.id=w.order_id
    WHERE w.granted_at IS NULL AND w.revoked_at IS NULL AND po.status='paid' AND po.user_id=w.user_id AND w.due_at<=?
      AND strftime('%Y-%m',w.due_at/1000,'unixepoch') NOT IN(SELECT value FROM json_each(?)) AND ${liveAccountSql('w.user_id')}`,now,readyMonths).first();
  const rows = (await stmt(env, `SELECT w.* FROM plus_monthly_windows w JOIN plus_commerce_orders po ON po.id=w.order_id
    WHERE w.granted_at IS NULL AND w.revoked_at IS NULL AND po.status='paid' AND po.user_id=w.user_id AND w.due_at<=?
      AND strftime('%Y-%m',w.due_at/1000,'unixepoch') IN(SELECT value FROM json_each(?)) AND ${liveAccountSql('w.user_id')} ORDER BY w.due_at,w.id LIMIT ?`,now,readyMonths,limit).all()).results || [];
  let granted = 0, pending = Number(unavailable?.n||0);
  for (const row of rows) {
    const monthKey = new Date(row.due_at).toISOString().slice(0,7);
    const choices = drops.filter(d => d.monthKey === monthKey && d.availableFrom <= now && (d.availableUntil == null || row.due_at < d.availableUntil));
    const drop = choices.length === 1 ? choices[0] : null;
    const item = drop && catalog.getCosmetic(drop.itemId,{now});
    if (!drop || !id(drop.id) || !item || item.artReady===false || item.membershipOnly || !['frame','avatar'].includes(item.kind)) { pending++;continue; }
    const result = await env.DB.batch([
      stmt(env, `INSERT OR IGNORE INTO plus_inventory_grants(id,user_id,item_id,source_type,source_id,order_id,granted_at)
        SELECT w.id||':'||?,w.user_id,?,'monthly',w.id,w.order_id,? FROM plus_monthly_windows w JOIN plus_commerce_orders po ON po.id=w.order_id
        WHERE w.id=? AND w.user_id=? AND w.granted_at IS NULL AND w.revoked_at IS NULL AND po.status='paid' AND po.user_id=w.user_id AND w.due_at<=? AND ${liveAccountSql('w.user_id')}`,item.id,item.id,now,row.id,row.user_id,now),
      stmt(env, `UPDATE plus_monthly_windows SET item_id=?,drop_id=?,granted_at=? WHERE id=? AND user_id=? AND granted_at IS NULL AND revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM plus_inventory_grants pg JOIN plus_commerce_orders po ON po.id=pg.order_id WHERE pg.source_type='monthly' AND pg.source_id=plus_monthly_windows.id AND pg.item_id=? AND pg.revoked_at IS NULL AND po.status='paid')`,item.id,drop.id,now,row.id,row.user_id,item.id),
    ]);
    granted += Number(result[1]?.meta?.changes || 0);
  }
  return { examined:rows.length,granted,pending,morePossible:rows.length === limit };
}
