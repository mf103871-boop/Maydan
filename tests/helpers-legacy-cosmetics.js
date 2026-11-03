// Test-only persisted historical licenses. No public grant endpoint or provider.
export async function seedLegacyCosmeticLicense(env, userId, itemIds, now = Date.now()) {
  const orderId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO plus_commerce_orders(id,user_id,provider,environment,external_id,kind,item_ids_json,status,created_at,updated_at)
      VALUES(?,?,'fixture-history','local-preview',?,'purchase',?,'paid',?,?)`).bind(orderId,userId,orderId,JSON.stringify(itemIds),now,now),
    ...itemIds.map(itemId=>env.DB.prepare(`INSERT INTO plus_inventory_grants(id,user_id,item_id,source_type,source_id,order_id,granted_at)
      VALUES(?,?,?,'store',?,?,?)`).bind(crypto.randomUUID(),userId,itemId,orderId,orderId,now)),
  ]);
  return orderId;
}
