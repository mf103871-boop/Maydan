import { arabicNormalize } from '../../shared/lib/arabicNormalize.js';

// A ten-percent presentation adjustment is not a measured ten-percent increase
// in correct answers. Keep the editorial bank, question IDs and rewards intact.
export const HIGH_TIER_ASSISTANCE = 0.10;
export function questionAssistance(question) {
  if (![600, 800, 1000].includes(question?.p)) return null;
  const answers = [question.a, ...(question.alt || [])].filter((a) => typeof a === 'string' && a.trim());
  const topic = String(question.topic || '').trim();
  const normalizedTopic = arabicNormalize(topic);
  const leaks = answers.some((a) => {
    const normalized = arabicNormalize(a);
    return normalized && normalizedTopic.includes(normalized);
  });
  // These two legacy packs had mechanically assigned topics (e.g. a lion in
  // "sport"). Never turn unreviewed editorial metadata into a misleading clue.
  const unreviewedTopic = /^(blur|silhouette)-/.test(String(question.qid || ''));
  const context = topic && !leaks && !unreviewedTopic ? topic : '';
  const supportsShape = !question.type || ['plain', 'code', 'common', 'complete', 'emoji', 'hints', 'image', 'audio', 'video'].includes(question.type);
  const words = String(question.a || '').trim().split(/\s+/u).filter(Boolean).length;
  const shape = supportsShape && words > 0
    ? (words === 1 ? 'الإجابة الأساسية كلمة واحدة' : words === 2 ? 'الإجابة الأساسية كلمتان' : `الإجابة الأساسية ${words.toLocaleString('ar')} كلمات`)
    : '';
  return { context, shape, amount: HIGH_TIER_ASSISTANCE };
}
