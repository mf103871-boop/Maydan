// بنك أسئلة «بَديهة» — يُولَّده `npm run bank:sort` من ملفات هذا المجلد؛ لا يُحرَّر يدويًا.
// الترتيب هو ترتيب الفئات في شاشة الاختيار (حقل order في bank-status.json).
// صيغة الحزمة وأنواع الأسئلة في docs/bank/SCHEMA.md.

import pack_general from './general.json' with { type: 'json' };
import pack_geo from './geo.json' with { type: 'json' };
import pack_capitals from './capitals.json' with { type: 'json' };
import pack_science from './science.json' with { type: 'json' };
import pack_animals from './animals.json' with { type: 'json' };
import pack_history from './history.json' with { type: 'json' };
import pack_food from './food.json' with { type: 'json' };

export const CATS = [pack_general, pack_geo, pack_capitals, pack_science, pack_animals, pack_history, pack_food];

export const CATEGORY_IDS = CATS.map((category) => category.id);
export const TOTAL_QUESTIONS = CATS.reduce((sum, category) => sum + category.qs.length, 0);
