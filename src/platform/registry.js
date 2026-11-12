// سجل الألعاب: كل لعبة وحدة مستقلة تصدّر manifest. الترتيب هنا هو ترتيب البطاقات في الرئيسية.
//
// لإضافة لعبة: أنشئ src/games/<id>/index.js يصدّر manifest (انظر README)، ثم استوردها هنا.
import badeeha from '../games/badeeha/index.js';
import beep from '../games/beep/index.js';
import mamnoo from '../games/mamnoo/index.js';
import jabeen from '../games/jabeen/index.js';
import fabraka from '../games/fabraka/index.js';
import meenfina from '../games/meenfina/index.js';
import ersomha from '../games/ersomha/index.js';

import mafia from '../games/mafia/index.js';
import { tr, gameName } from '../shared/i18n/core.js';

// Read copy at render time so a language switch preserves the mounted game and its state.
export const GAMES = [badeeha, mafia, ersomha, beep, mamnoo, jabeen, fabraka, meenfina].map(game => ({
  ...game,
  get name() { return gameName(game); },
  get tagline() { return tr(game.tagline); },
  get description() { return tr(game.description); },
  get duration() { return tr(game.duration); },
  get howToPlay() { return game.howToPlay.map(step => tr(step)); },
  get tags() { return game.tags.map(tag => tr(tag)); },
}));

export function getGame(id) {
  return GAMES.find((game) => game.id === id) || null;
}
