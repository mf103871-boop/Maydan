// بنك أسئلة «بَديهة».
//
// البنك فارغ عمدًا: الحزم القديمة حُذفت، ويُعاد بناؤها حزمة حزمة.
// لإضافة حزمة: أنشئ `<id>.json` بالشكل
//   { "id": "...", "name": "...", "icon": "🎬", "qs": [ { "p": 200, "q": "...", "a": "...", "qid": "..." }, ... ] }
// ثم استوردها هنا وأضفها إلى المصفوفة. الاختبارات تفرض على كل حزمة:
// 24 سؤالًا على الأقل، وأسئلة في كل شريحة من 200 إلى 1000، ومعرّفات (qid) فريدة.

export const CATS = [];

export const CATEGORY_IDS = CATS.map((category) => category.id);
export const TOTAL_QUESTIONS = CATS.reduce((sum, category) => sum + category.qs.length, 0);
