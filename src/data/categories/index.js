// بنك أسئلة «بَديهة».
//
// البنك فارغ عمدًا: الحزم القديمة حُذفت، ويُعاد بناؤها حزمة حزمة.
// صيغة الحزمة وأنواع الأسئلة في docs/PACK_FORMAT.md.

export const CATS = [];

export const CATEGORY_IDS = CATS.map((category) => category.id);
export const TOTAL_QUESTIONS = CATS.reduce((sum, category) => sum + category.qs.length, 0);
