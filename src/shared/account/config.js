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
