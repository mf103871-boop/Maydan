// بنك أسئلة «بَديهة» — يُولَّده `npm run bank:sort` من ملفات هذا المجلد؛ لا يُحرَّر يدويًا.
// الترتيب هو ترتيب الفئات في شاشة الاختيار (حقل order في bank-status.json).
// صيغة الحزمة وأنواع الأسئلة في docs/bank/SCHEMA.md.

export const NO_CATEGORIES_YET = true;

export const CATS = [];

export const CATEGORY_IDS = CATS.map((category) => category.id);
export const TOTAL_QUESTIONS = CATS.reduce((sum, category) => sum + category.qs.length, 0);
