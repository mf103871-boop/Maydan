import { getCosmetic } from '../../src/plus/catalog.js';

const literal = value => "'" + value.replaceAll("'", "''") + "'";
export function permanentCosmeticSql(userAlias, itemId) {
  return `EXISTS(SELECT 1 FROM plus_inventory_grants pg JOIN plus_commerce_orders po ON po.id=pg.order_id
    WHERE pg.user_id=${userAlias} AND pg.item_id=${literal(itemId)} AND pg.revoked_at IS NULL AND po.user_id=pg.user_id AND po.status='paid')`;
}
// Used inside the same final SQL snapshot as live-account/subscription checks.
export const permanentGrantUnionSql = userAlias => `SELECT pg.item_id,NULL AS achievement_id,pg.granted_at,pg.source_type AS source,pg.source_id,pg.order_id
  FROM plus_inventory_grants pg JOIN plus_commerce_orders po ON po.id=pg.order_id
  WHERE pg.user_id=${userAlias} AND pg.revoked_at IS NULL AND po.user_id=pg.user_id AND po.status='paid'`;

export function permanentGrantView(grant, now = Date.now()) {
  const item=getCosmetic(grant?.itemId,{now});
  if (!['store', 'monthly'].includes(grant?.source) || !item || item.membershipOnly || typeof grant.sourceId !== 'string' || typeof grant.orderId !== 'string') return null;
  return { itemId: grant.itemId, source: grant.source, sourceId: grant.sourceId, orderId: grant.orderId, grantedAt: grant.grantedAt, ownership: 'permanent' };
}

export const monthlyWindowsProjectionSql = userAlias => `(SELECT json_group_array(json_object('id',m.id,'item_id',m.item_id,'due_at',m.due_at,'granted_at',m.granted_at,'revoked_at',m.revoked_at,'status',m.status))
  FROM (SELECT w.id,w.item_id,w.due_at,w.granted_at,w.revoked_at,o.status FROM plus_monthly_windows w JOIN plus_commerce_orders o ON o.id=w.order_id
    WHERE w.user_id=${userAlias} AND o.user_id=w.user_id ORDER BY w.due_at DESC,w.id LIMIT 120) m)`;
export function monthlyWindowViews(rows) {
  return rows.map(row => ({ id: row.id, itemId: row.item_id, dueAt: row.due_at, grantedAt: row.granted_at,
    status: row.revoked_at || row.status !== 'paid' ? 'revoked' : row.granted_at ? 'granted' : 'pending' }));
}
