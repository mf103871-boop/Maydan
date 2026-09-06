// عناوين الوسائط: كل سؤال يشير إلى ملفه باسم قصير، والحزمة تحدد المجلد.
//
//   { "type": "image", "media": "pepsi.webp" }   في حزمة logos
//     →  media/logos/pepsi.webp
//
// ويجوز أن يكون المرجع عنوانًا كاملًا (https://…) إن كانت الوسائط مستضافة خارجًا،
// أو مسارًا يبدأ بـ media/ إن أراد السؤال ملفًا من حزمة أخرى.
export const MEDIA_ROOT = 'media';

const ABSOLUTE = /^(https?:)?\/\//i;
const DATA_URI = /^data:/i;

export function isExternal(ref) {
  return ABSOLUTE.test(ref) || DATA_URI.test(ref);
}

// نسخ مجلدات الوسائط يحقنها البناء (بصمة محتوى كل مجلد)؛ تُلحق بالعنوان كـ ?v=
// فلا يعلق لاعبٌ على نسخة قديمة من ملف صُحِّح بالاسم نفسه. غيابها (اختبارات، تطوير) يعني بلا لاحقة.
const MEDIA_VERSIONS = typeof __MAYDAN_MEDIA_VERSIONS__ !== 'undefined' ? __MAYDAN_MEDIA_VERSIONS__ : {};

function withVersion(url) {
  const m = /^media\/([^/]+)\//.exec(url);
  const v = m && MEDIA_VERSIONS[m[1]];
  return v ? `${url}?v=${v}` : url;
}

export function resolveMedia(ref, packId) {
  const value = String(ref || '').trim();
  if (!value) return null;
  if (isExternal(value)) return value;
  if (value.startsWith(`${MEDIA_ROOT}/`)) return withVersion(value);
  if (!packId) return null;
  return withVersion(`${MEDIA_ROOT}/${packId}/${value.replace(/^\/+/, '')}`);
}

// السؤال قد يحمل ملفًا واحدًا أو عدة ملفات (مثل «اكتشف الفرق» بصورتين).
// المرجع إمّا نص («01.webp») أو كائن إسناد { src, type, title, sourceUrl, author, license, licenseUrl }.
export function mediaRef(entry) {
  if (entry && typeof entry === 'object') return String(entry.src || '').trim();
  return String(entry || '').trim();
}

export function mediaEntries(question) {
  if (!question || question.media == null) return [];
  return Array.isArray(question.media) ? question.media : [question.media];
}

export function questionMedia(question, packId) {
  return mediaEntries(question).map((entry) => resolveMedia(mediaRef(entry), packId)).filter(Boolean);
}

// بطاقات الإسناد لكل ملف في الحزم المعطاة (لشاشة «المصادر والتراخيص»).
export function collectCredits(categories) {
  const seen = new Map();
  for (const category of categories || []) {
    for (const question of category.qs || []) {
      for (const entry of mediaEntries(question)) {
        if (!entry || typeof entry !== 'object' || !entry.src) continue;
        const url = resolveMedia(entry.src, category.id);
        if (!url || seen.has(url)) continue;
        seen.set(url, {
          url,
          category: category.id,
          categoryName: category.name,
          type: entry.type || 'image',
          title: entry.title || '',
          sourceUrl: entry.sourceUrl || '',
          author: entry.author || '',
          license: entry.license || '',
          licenseUrl: entry.licenseUrl || '',
        });
      }
    }
  }
  return [...seen.values()];
}

export function deckMedia(deck, categories) {
  const urls = [];
  for (const [packId, questions] of Object.entries(deck || {})) {
    const known = (categories || []).some((c) => c.id === packId);
    if (!known && categories) continue;
    for (const question of questions) urls.push(...questionMedia(question, packId));
  }
  return [...new Set(urls)];
}

const IMAGE = /\.(webp|png|jpe?g|gif|avif|svg)(\?|$)/i;
const AUDIO = /\.(mp3|m4a|aac|ogg|opus|wav)(\?|$)/i;
const VIDEO = /\.(mp4|webm|mov)(\?|$)/i;

// نوع الملف يُشتق من الامتداد، ويُصحَّح بنوع السؤال حين يكون أدقّ.
export function mediaKind(url, questionType) {
  if (questionType === 'audio') return 'audio';
  if (questionType === 'video') return 'video';
  if (IMAGE.test(url)) return 'image';
  if (AUDIO.test(url)) return 'audio';
  if (VIDEO.test(url)) return 'video';
  return 'image';
}
