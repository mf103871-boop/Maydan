// تطبيع النص العربي للمقارنة: إزالة التشكيل والتطويل، توحيد الألف والياء والتاء المربوطة،
// حذف علامات الترقيم، وتوحيد المسافات. يُستخدم لرفض الإجابات المكررة في «فبركة».
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const PUNCT = /[،؛؟٪-٭۔.,;:!?'"«»()\[\]{}\-_/\\|@#$%^&*+=~`<>]/g;

export function arabicNormalize(input) {
  return String(input ?? '')
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PUNCT, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// أل التعريف في البداية لا تغيّر المعنى عند مقارنة الإجابات القصيرة.
export function arabicNormalizeLoose(input) {
  return arabicNormalize(input)
    .split(' ')
    .map((word) => (word.length > 3 && word.startsWith('ال') ? word.slice(2) : word))
    .join(' ');
}

export function sameText(a, b) {
  const x = arabicNormalizeLoose(a);
  const y = arabicNormalizeLoose(b);
  return x.length > 0 && x === y;
}
