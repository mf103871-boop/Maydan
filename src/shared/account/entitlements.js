// منطق الاستحقاق النقي (بلا React ولا شبكة): يُختبر في Node ويُشارَك بين الواجهة والخادم منطقيًا.
import { TRIAL_GAMES, GRACE_MS, REFRESH_MS } from './config.js';

// me = { user, premium: { active, until, source, status, willRenew }, trials: { beep: true, ... }, serverTime }
// مشترك إن لم ينتهِ الاشتراك بعد (مع سماح GRACE_MS)؛ نتجاهل active وحده كي تحترم النسخة المخزّنة موعد الانتهاء.
export function isPremium(me, now = Date.now()) {
  const until = Number(me && me.premium && me.premium.until);
  if (!Number.isFinite(until) || until <= 0) return false;
  return until + GRACE_MS > now;
}

// Gameplay is free independently of the genuine subscription entitlement.
export function lockedPack() { return false; }

// التجربة متاحة للّعبة إن لم تُلعب لا على الخادم ولا محليًا (المشترك لا يحتاج تجربة).
export function trialAvailable() { return true; }

// اتحاد علامات التجارب (محلي + خادم): لا يمكن استعادة تجربة بتسجيل الدخول.
export function mergeTrials(a = {}, b = {}) {
  const out = {};
  for (const game of TRIAL_GAMES) if ((a && a[game]) || (b && b[game])) out[game] = true;
  return out;
}

export function shouldRefresh(fetchedAt, now = Date.now()) {
  return !Number.isFinite(fetchedAt) || now - fetchedAt > REFRESH_MS;
}

export function gameAccess() { return 'free'; }
