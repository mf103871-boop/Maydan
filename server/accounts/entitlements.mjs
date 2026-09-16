// منطق الاستحقاق على الخادم: نقي بلا شبكة ولا قاعدة بيانات كي يُختبر وحده.
// العميل يملك نسخته في src/shared/account/entitlements.js؛ هذه هي التي تبني me.
import { GRACE_MS } from '../../src/shared/account/config.js';

const REVOKED = new Set(['revoked', 'refunded']);

// أفضل اشتراك = الأبعد انتهاءً بين ما لم يُلغَ قسرًا؛ صفّان (آبل وPaddle) لا يتزاحمان.
export function premiumOf(subscriptions = [], now = Date.now()) {
  let best = null;
  for (const row of subscriptions) {
    if (REVOKED.has(String(row.status || '').toLowerCase())) continue;
    if (!best || (Number(row.until) || 0) > (Number(best.until) || 0)) best = row;
  }
  if (!best) return { active: false, until: 0, source: null, status: null, willRenew: false };
  const until = Number(best.until) || 0;
  return {
    active: until > now,
    until,
    source: best.source || null,
    status: best.status || null,
    willRenew: !!(best.will_renew ?? best.willRenew),
  };
}

// السماح يغطي تأخر إشعار التجديد؛ بوابة الغرف تستعمله كي لا نقفل على مشترك دافع.
export function premiumActive(premium, now = Date.now()) {
  const until = Number(premium && premium.until) || 0;
  return until > 0 && until + GRACE_MS > now;
}

export function meResponse({ user, subscriptions = [], trials = {}, now = Date.now() }) {
  return {
    user: { id: user.id, name: user.name || null, email: user.email || null },
    premium: premiumOf(subscriptions, now),
    trials,
    serverTime: now,
  };
}
