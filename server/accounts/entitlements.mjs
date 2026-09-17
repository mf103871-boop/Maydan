// منطق الاستحقاق على الخادم: نقي بلا شبكة ولا قاعدة بيانات كي يُختبر وحده.
// العميل يملك نسخته في src/shared/account/entitlements.js؛ هذه هي التي تبني me.
import { GRACE_MS } from '../../src/shared/account/config.js';
import { inBillingEnvironment } from './billing-environment.mjs';

const REVOKED = new Set(['revoked', 'refunded']);

// أفضل اشتراك = الأبعد انتهاءً بين ما لم يُلغَ قسرًا؛ صفّان (آبل وPaddle) لا يتزاحمان.
// اشتراك مدفوع ما زال ساريًا يتقدّم على رمز الهدية (100 سنة) كي يبقى مصدره وتجديده
// ظاهرين في /api/me وتظهر «إدارة الاشتراك»؛ الرمز احتياط حين ينقضي المدفوع.
export function premiumOf(subscriptions = [], now = Date.now(), env = {}) {
  let best = null;
  let paid = null;
  for (const row of subscriptions) {
    if (!inBillingEnvironment(env, row)) continue;
    if (REVOKED.has(String(row.status || '').toLowerCase())) continue;
    const until = Number(row.until) || 0;
    if (!best || until > (Number(best.until) || 0)) best = row;
    if (row.source !== 'promo' && until > now && (!paid || until > (Number(paid.until) || 0))) paid = row;
  }
  if (paid) best = paid;
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

export function meResponse({ user, subscriptions = [], trials = {}, now = Date.now(), env = {} }) {
  return {
    user: { id: user.id, name: user.name || null, email: user.email || null },
    premium: premiumOf(subscriptions, now, env),
    trials,
    serverTime: now,
  };
}
