// سجل الألعاب: كل لعبة وحدة مستقلة تصدّر manifest. الترتيب هنا هو ترتيب البطاقات في الرئيسية.
//
// لإضافة لعبة: أنشئ src/games/<id>/index.js يصدّر manifest (انظر README)، ثم استوردها هنا.
import badeeha from '../games/badeeha/index.js';
import beep from '../games/beep/index.js';
import mamnoo from '../games/mamnoo/index.js';
import jabeen from '../games/jabeen/index.js';
import fabraka from '../games/fabraka/index.js';
import meenfina from '../games/meenfina/index.js';

export const GAMES = [badeeha, beep, mamnoo, jabeen, fabraka, meenfina];

export function getGame(id) {
  return GAMES.find((game) => game.id === id) || null;
}
