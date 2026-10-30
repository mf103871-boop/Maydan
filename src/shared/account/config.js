// إعدادات بلس للتخصيص ومعرّفات منتجاته. الأسعار الحقيقية تُقرأ من المتجر وقت العرض.
// Legacy identifiers retained for older clients and trial history; all gameplay is free.
export const FREE_PACKS = ['general', 'geo', 'capitals', 'science', 'animals', 'history', 'food', 'fruitsveg', 'sports', 'football'];
export const TRIAL_GAMES = ['beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina', 'ersomha', 'mafia'];
export const PRODUCTS = { monthly: 'plus.monthly', yearly: 'plus.yearly' };
export const PLUS_NAME = 'ميدان بلس';
// سماح بعد انتهاء الاشتراك: يغطي تأخر الإشعارات وفترة السماح في المتاجر.
export const GRACE_MS = 3 * 24 * 60 * 60 * 1000;
// تحديث /api/me في الخلفية بعد هذه المدة من آخر جلب.
export const REFRESH_MS = 10 * 60 * 1000;
// مهلة مصادقة رمز الدخول لمرة واحدة (ثوانٍ) — تُطابق الخادم.
export const AUTH_CODE_TTL_S = 60;

// الصفحات القانونية: بريد الدعم (فارغ = الإحالة إلى صفحة الدعم في المتجر) وتاريخ آخر تحديث.
export const SUPPORT_EMAIL = 'mf103871@gmail.com';
export const LEGAL_UPDATED = '2026-10-28';
export const LEGAL_ROUTES = { terms: '#/terms', privacy: '#/privacy' };
// وجهة عرض ثابتة وموثوقة، لا تغيّر خادم API ولا تسمح للمعاينة باستعمال جلسة الموقع.
export const PUBLIC_SITE_ORIGIN = 'https://maydan-game.mf103871.workers.dev';
export const PUBLISHED_SETTINGS_URL = `${PUBLIC_SITE_ORIGIN}/#/settings`;

// Older servers return one provider map. New ones distinguish native Apple
// from its separately configured web redirect, without exposing credentials.
export const signInProviders = (billing, platform) => billing?.providerPlatforms?.[platform === 'ios' ? 'ios' : 'web'] || billing?.providers || null;

// لا رموز قبول في العميل. الخادم يقرأ بصمات الرموز من السرّ REDEEM_CODE_HASHES فقط.
export const REDEEM_CODE_HASHES = []; // القبول على الخادم فقط؛ لا مفاتيح عامة داخل الحزمة.
// مدة التفعيل بالرمز على الحساب (فعليًا دائم).
export const PROMO_DURATION_MS = 100 * 365 * 86_400_000;
// قواعد App Store (3.1.1) تمنع فتح المحتوى بمفاتيح داخل التطبيق، فالزر مخفي على iOS؛
// الحساب المفعَّل بالرمز على الويب يفتح المحتوى على iOS عبر /api/me كأي اشتراك آخر.
export const REDEEM_ON_IOS = false;
