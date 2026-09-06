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

export function resolveMedia(ref, packId) {
  const value = String(ref || '').trim();
  if (!value) return null;
  if (isExternal(value)) return value;
  if (value.startsWith(`${MEDIA_ROOT}/`)) return value;
  if (!packId) return null;
  return `${MEDIA_ROOT}/${packId}/${value.replace(/^\/+/, '')}`;
}

// السؤال قد يحمل ملفًا واحدًا أو عدة ملفات (مثل «اكتشف الفرق» بصورتين).
export function questionMedia(question, packId) {
  if (!question || !question.media) return [];
  const refs = Array.isArray(question.media) ? question.media : [question.media];
  return refs.map((ref) => resolveMedia(ref, packId)).filter(Boolean);
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
