// إعدادات «ميدان بلس»: ما هو مجاني، وما يُعدّ تجربة، ومعرّفات المنتجات. الأسعار تُقرأ من المتاجر وقت العرض.
// FREE_PACKS = أول عشر حزم بترتيب bank-status (يثبّته tests/account-gating.test.js).
export const FREE_PACKS = ['general', 'geo', 'capitals', 'science', 'animals', 'history', 'food', 'fruitsveg', 'sports', 'football'];
export const TRIAL_GAMES = ['beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina'];
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
export const LEGAL_UPDATED = '2026-09-16';
export const LEGAL_ROUTES = { terms: '#/terms', privacy: '#/privacy' };

// رموز الهدايا: بصمات SHA-256 للرموز بعد التطبيع (src/shared/account/redeem.js)، لا الرموز نفسها.
// الخادم يقبل بصمات إضافية من السرّ REDEEM_CODE_HASHES (قائمة مفصولة بفواصل) دون نشر جديد.
export const REDEEM_CODE_HASHES = ['548e90ecbc3856ce0006f82a5a2127625ddcebb85a72827cf9bb0c223b28fc2e'];
// مدة التفعيل بالرمز على الحساب (فعليًا دائم).
export const PROMO_DURATION_MS = 100 * 365 * 86_400_000;
// قواعد App Store (3.1.1) تمنع فتح المحتوى بمفاتيح داخل التطبيق، فالزر مخفي على iOS؛
// الحساب المفعَّل بالرمز على الويب يفتح المحتوى على iOS عبر /api/me كأي اشتراك آخر.
export const REDEEM_ON_IOS = false;
