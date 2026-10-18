// Two reviewed lexical homonyms, not duplicate concepts. Runtime comparison is
// still exact against the selected private card. Every additional concept or
// spelling requires a fresh explicit editorial decision and a test.
export const ERSOMHA_ACCEPTED_OVERLAPS = Object.freeze([
  Object.freeze({ normalizedText: 'زهره', conceptIds: Object.freeze(['ers-nature-018', 'ers-food-046']),
    reason: 'زهرة اسم النبات المزهر، وهي أيضًا اسم القرنبيط الشائع في بلاد الشام. الزهرة والقرنبيط رسمان مختلفان؛ لا نرفض لهجة صحيحة ولا نجعلهما عائلة بصرية واحدة.' }),
  Object.freeze({ normalizedText: 'مدرسه', conceptIds: Object.freeze(['ers-places-001', 'ers-jobs-003']),
    reason: 'مُدرّسة مهنة مؤنثة ومدرسة مبنى تعليمي؛ حذف التشكيل يجعل اللفظين متطابقين. الفئة والرسمة تحددان المعنى، ولا يُقبل هذا الاستثناء لأي مفهوم ثالث.' }),
]);
