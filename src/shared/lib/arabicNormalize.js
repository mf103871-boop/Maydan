// تطبيع النص العربي للمقارنة: NFKC أولًا (ﷲ → الله، ﻻ → لا، أشكال العرض → حروفها)، حذف
// محارف العرض الصفرية، إزالة التشكيل والتطويل، توحيد الألف والياء والتاء المربوطة والحروف
// الفارسية (ک ی)، حذف علامات الترقيم، وتوحيد المسافات. مُوحَّد للمشروع كله: «فبركة» لرفض
// الإجابات المكررة، و«بَديهة» لإبراز الخيار الصحيح، وbank:validate لكشف التكرار — فلا يقبل
// المدقّق سؤالًا ترفضه الواجهة أو العكس.
const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;
// ZWSP/ZWNJ/ZWJ/LRM/RLM، علامة ترتيب البايتات، وعلامة الحرف العربي: تلصقها لوحات المفاتيح والنسخ.
const INVISIBLE = /[​-‏⁠﻿؜]/g;
const PUNCT = /[،؛؟٪-٭۔.,;:!?'"“”‘’«»()\[\]{}\-–—_/\\|@#$%^&*+=~`<>…]/g;

const nfkc = (value) => {
  const text = String(value ?? '');
  try { return text.normalize('NFKC'); } catch { return text; }
};

function normalizeWord(word) {
  return word
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase();
}

// الكلمات مفصولة قبل التطبيع كي تبقى صورة الكلمة الأصلية (همزة البداية) متاحة لقرار «ال».
function words(input) {
  return nfkc(input).replace(INVISIBLE, '').replace(PUNCT, ' ').split(/\s+/).filter(Boolean);
}

export function arabicNormalize(input) {
  return words(input).map(normalizeWord).filter(Boolean).join(' ');
}

// أل التعريف في البداية لا تغيّر المعنى عند مقارنة الإجابات القصيرة — لكن ليس كل «ال» أداة
// تعريف: «ألوان» و«ألم» و«ألمانيا» تبدأ بهمزة أصلية، و«الله» و«إلى» و«الآن» كلمات بذاتها.
// تُحذف «ال» فقط حين تبدأ الكلمة الأصلية بألف بلا همزة، ويبقى بعدها ثلاثة أحرف فأكثر،
// ولا تكون من قائمة الاستثناء.
const ARTICLE_KEEP = new Set(['الله', 'اللهم', 'الي', 'الا', 'الان', 'اله', 'الهي', 'التي', 'الذي', 'الذين', 'اللاتي', 'اللواتي']);
function looseWord(word) {
  const normalized = normalizeWord(word);
  if (!normalized) return '';
  const article = /^(ال|ٱل)/.test(word) && !/^[أإآ]/.test(word);
  if (!article || normalized.length < 5 || ARTICLE_KEEP.has(normalized)) return normalized;
  return normalized.slice(2);
}

export function arabicNormalizeLoose(input) {
  return words(input).map(looseWord).filter(Boolean).join(' ');
}

export function sameText(a, b) {
  const x = arabicNormalizeLoose(a);
  const y = arabicNormalizeLoose(b);
  return x.length > 0 && x === y;
}
