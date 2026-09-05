// سجل الألعاب: كل لعبة وحدة مستقلة تصدّر manifest. الترتيب هنا هو ترتيب البطاقات في الرئيسية.
//
// لإضافة لعبة: أنشئ src/games/<id>/index.js يصدّر manifest (انظر README)، ثم استوردها هنا.
import badeeha from '../games/badeeha/index.js';

export const GAMES = [badeeha];

export function getGame(id) {
  return GAMES.find((game) => game.id === id) || null;
}
