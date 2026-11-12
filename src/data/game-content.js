import { CATS } from './categories/index.js';
import beep from './games/beep/prompts.json' with { type: 'json' };
import mamnoo from './games/mamnoo/cards.json' with { type: 'json' };
import meenfina from './games/meenfina/statements.json' with { type: 'json' };
import questions from './games/fabraka/questions.json' with { type: 'json' };
import pictures from './games/fabraka/pictures.json' with { type: 'json' };
import personal from './games/fabraka/personal.json' with { type: 'json' };
import acting from './games/jabeen/acting.json' with { type: 'json' };
import animals from './games/jabeen/animals.json' with { type: 'json' };
import figures from './games/jabeen/figures.json' with { type: 'json' };
import food from './games/jabeen/food.json' with { type: 'json' };
import home from './games/jabeen/home.json' with { type: 'json' };
import jobs from './games/jabeen/jobs.json' with { type: 'json' };
import places from './games/jabeen/places.json' with { type: 'json' };
import proverbs from './games/jabeen/proverbs.json' with { type: 'json' };
import { ENGLISH_CONTENT, loadEnglishContent, hasEnglishContentPack } from './locales/en/index.js';
import { normalizeContentIdentity } from '../shared/content-locale.mjs';

const ARABIC_CONTENT = { badeeha: CATS, beep, mamnoo, meenfina,
  fabraka: { questions, pictures, personal },
  jabeen: [acting, animals, figures, food, home, jobs, places, proverbs] };
const cache = new Map();

export class ContentUnavailableError extends Error {
  constructor(gameId, locale, version) {
    super(`Content unavailable: ${gameId}/${locale}/${version}`);
    this.name = 'ContentUnavailableError';
    this.gameId = gameId;
    this.contentLocale = locale;
    this.contentVersion = version;
  }
}

function localizeItems(items, identity) {
  return items.map(item => ({ ...item, ...identity }));
}

function prepare(gameId, content, identity) {
  if (gameId === 'fabraka') {
    const text = identity.contentLocale === 'ar' ? content.questions : localizeItems(content.questions, identity);
    const categories = [...new Set(text.map(q => q.category))].sort((a, b) => a.localeCompare(b, identity.contentLocale));
    const categoryCounts = Object.fromEntries(categories.map(category => {
      const group = text.filter(q => q.category === category);
      return [category, { all: group.length, curious: group.filter(q => q.curious).length }];
    }));
    return { questions: text,
      pictures: identity.contentLocale === 'ar' ? content.pictures : localizeItems(content.pictures, identity),
      personal: identity.contentLocale === 'ar' ? content.personal : localizeItems(content.personal, identity),
      categories, categoryCounts, ...identity };
  }
  if (identity.contentLocale === 'ar') return content;
  if (gameId === 'badeeha') return content.map(category => ({ ...category, ...identity, qs: localizeItems(category.qs, identity) }));
  if (gameId === 'jabeen') return content.map(category => ({ ...category, ...identity, items: localizeItems(category.items, identity) }));
  return localizeItems(content, identity);
}

// A missing English pack is a release blocker, never an invitation to silently
// switch the room back to Arabic. Drawing words remain on the server only.
export function getGameContent(gameId, locale = 'ar', version) {
  const identity = normalizeContentIdentity({ contentLocale: locale, contentVersion: version });
  const key = `${gameId}:${identity.contentLocale}:${identity.contentVersion}`;
  if (cache.has(key)) return cache.get(key);
  const content = (identity.contentLocale === 'ar' ? ARABIC_CONTENT : ENGLISH_CONTENT)[gameId];
  if (!content) throw new ContentUnavailableError(gameId, identity.contentLocale, identity.contentVersion);
  const prepared = prepare(gameId, content, identity);
  cache.set(key, prepared);
  return prepared;
}

export function getCategories(locale = 'ar', version) {
  return getGameContent('badeeha', locale, version);
}

export { hasEnglishContentPack };
export async function loadGameContent(gameId, locale = 'ar', version) {
  const identity = normalizeContentIdentity({ contentLocale: locale, contentVersion: version });
  if (identity.contentLocale === 'en') await loadEnglishContent(gameId, identity.contentVersion);
  return getGameContent(gameId, identity.contentLocale, identity.contentVersion);
}
