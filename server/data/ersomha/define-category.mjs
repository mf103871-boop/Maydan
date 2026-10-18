import { FAMILY_BY_ANSWER } from './families.mjs';
import { ERSOMHA_REVIEWED_IDS } from './independent-review-status.mjs';
// Authoring source stays on the server. Ordinals are permanent: never reorder or
// reuse a retired ID. An explicit family joins related depictions across packs.
export function defineCategory(id, label, groups) {
  let ordinal = 0;
  return { id, label, entries: Object.entries(groups).flatMap(([difficulty, raw]) => raw.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [answer, aliasText = '', visual, family, tier] = line.split('|').map((part) => part.trim());
    const conceptId = `ers-${id}-${String(++ordinal).padStart(3, '0')}`;
    return Object.freeze({ id: conceptId, conceptId, familyId: FAMILY_BY_ANSWER[answer] || family || conceptId, answer,
      aliases: Object.freeze(aliasText ? aliasText.split('؛').map((part) => part.trim()) : []), category: id, difficulty: tier || difficulty,
      visualNote: visual, review: Object.freeze({ language: 'reviewed', drawability: 'reviewed',
        independent: ERSOMHA_REVIEWED_IDS[conceptId] ? 'reviewed' : 'pending' }) });
  })) };
}
