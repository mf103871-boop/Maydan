import questions from '../../data/games/fabraka/questions.json' with { type: 'json' };
import pictures from '../../data/games/fabraka/pictures.json' with { type: 'json' };
import personal from '../../data/games/fabraka/personal.json' with { type: 'json' };
import { normalizeOptions } from './logic.js';
import { getGameContent } from '../../data/game-content.js';
import { normalizeContentIdentity } from '../../shared/content-locale.mjs';
export { questions, pictures, personal };
export const categories = [...new Set(questions.map((q) => q.category))].sort((a, b) => a.localeCompare(b, 'ar'));
// كم سؤالًا يتبقى لكل موضوع في كل نمط أسئلة؟ الإعدادات تعتمد عليه كي لا تعرض
// تركيبة مسدودة (موضوع بلا «غرائب مختارة») ثم تطلب من اللاعبين حلًّا مستحيلًا.
export const categoryCounts = Object.fromEntries(categories.map((category) => {
  const inCategory = questions.filter((q) => q.category === category);
  return [category, { all: inCategory.length, curious: inCategory.filter((q) => q.curious).length }];
}));
export const getFabrakaContent = (locale = 'ar', version) => getGameContent('fabraka', locale, version);
export const categoryCount = (category, style, locale = 'ar', version) => getFabrakaContent(locale, version).categoryCounts[category]?.[style === 'all' ? 'all' : 'curious'] ?? 0;
// Old saved topic names can disappear with a bank replacement. Drop only those
// selections; retain the player's mode/timers and all separate history records.
export function normalizeContentOptions(raw, locale = raw?.contentLocale || 'ar', version = raw?.contentVersion) {
  const identity = normalizeContentIdentity({ contentLocale: locale, contentVersion: version });
  const options = normalizeOptions(raw);
  return { ...options, ...identity, categories: options.categories.filter((category) => categoryCount(category, options.style, identity.contentLocale, identity.contentVersion) > 0) };
}
