import beep from './games/beep/prompts.json' with { type: 'json' };
import meenfina from './games/meenfina/statements.json' with { type: 'json' };
import mamnoo from './games/mamnoo/cards.json' with { type: 'json' };
import acting from './games/jabeen/acting.json' with { type: 'json' };
import animals from './games/jabeen/animals.json' with { type: 'json' };
import figures from './games/jabeen/figures.json' with { type: 'json' };
import food from './games/jabeen/food.json' with { type: 'json' };
import home from './games/jabeen/home.json' with { type: 'json' };
import jobs from './games/jabeen/jobs.json' with { type: 'json' };
import places from './games/jabeen/places.json' with { type: 'json' };
import proverbs from './games/jabeen/proverbs.json' with { type: 'json' };
import questions from './games/fabraka/questions.json' with { type: 'json' };
import pictures from './games/fabraka/pictures.json' with { type: 'json' };
import personal from './games/fabraka/personal.json' with { type: 'json' };
import { CATS as badeeha } from './categories/index.js';

// Packs enter this registry only once every approved source item is localized.
// Absence is explicit and must block release; there is no Arabic fallback.
export const ENGLISH_CONTENT = { badeeha, beep, meenfina, mamnoo,
  jabeen: [acting, animals, figures, food, home, jobs, places, proverbs],
  fabraka: { questions, pictures, personal } };
export const hasEnglishContentPack = gameId => Object.hasOwn(ENGLISH_CONTENT, gameId);
export async function loadEnglishContent(gameId, version = 'new-en') {
  if (version !== 'new-en') throw Object.assign(new Error('CONTENT_VERSION'), { code: 'CONTENT_VERSION' });
  if (!hasEnglishContentPack(gameId)) throw Object.assign(new Error('CONTENT_UNAVAILABLE'), { code: 'CONTENT_UNAVAILABLE' });
  return ENGLISH_CONTENT[gameId];
}
