// منطق الاستحقاق النقي (بلا React ولا شبكة): يُختبر في Node ويُشارَك بين الواجهة والخادم منطقيًا.
import { FREE_PACKS, TRIAL_GAMES, GRACE_MS, REFRESH_MS } from './config.js';

// me = { user, premium: { active, until, source, status, willRenew }, trials: { beep: true, ... }, serverTime }
// مشترك إن لم ينتهِ الاشتراك بعد (مع سماح GRACE_MS)؛ نتجاهل active وحده كي تحترم النسخة المخزّنة موعد الانتهاء.
export function isPremium(me, now = Date.now()) {
  const until = Number(me && me.premium && me.premium.until);
  if (!Number.isFinite(until) || until <= 0) return false;
  return until + GRACE_MS > now;
}

// الحزمة مقفولة إن لم تكن ضمن المجانية والمستخدم غير مشترك.
export function lockedPack(id, premium) {
  return !premium && !FREE_PACKS.includes(id);
}

// التجربة متاحة للّعبة إن لم تُلعب لا على الخادم ولا محليًا (المشترك لا يحتاج تجربة).
export function trialAvailable(me, localTrials, game, premium = isPremium(me)) {
  if (premium) return true;
  if (!TRIAL_GAMES.includes(game)) return true;
  const server = !!(me && me.trials && me.trials[game]);
  const local = !!(localTrials && localTrials[game]);
  return !server && !local;
}

// اتحاد علامات التجارب (محلي + خادم): لا يمكن استعادة تجربة بتسجيل الدخول.
export function mergeTrials(a = {}, b = {}) {
  const out = {};
  for (const game of TRIAL_GAMES) if ((a && a[game]) || (b && b[game])) out[game] = true;
  return out;
}

export function shouldRefresh(fetchedAt, now = Date.now()) {
  return !Number.isFinite(fetchedAt) || now - fetchedAt > REFRESH_MS;
}

// حالة موحّدة للعرض: 'premium' | 'trial' | 'locked' لكل لعبة.
export function gameAccess(me, localTrials, game) {
  const premium = isPremium(me);
  if (premium) return 'premium';
  return trialAvailable(me, localTrials, game, false) ? 'trial' : 'locked';
}
