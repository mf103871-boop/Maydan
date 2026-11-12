import { getGameContent } from '../src/data/game-content.js';
import { buildDeck, duoQuestion } from '../src/games/fabraka/logic.js';

export function buildFabrakaDeck(room) {
  const { questions, pictures, personal } = getGameContent('fabraka', room.contentLocale || 'ar', room.contentVersion);
  const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
  const duo = room.settings.mode !== 'friends' && room.members.filter((m) => !m.left).length === 2;
  return buildDeck({ questions: duo ? questions.filter(duoQuestion) : questions, pictures: duo ? pictures.filter(duoQuestion) : pictures, personal,
    options: room.settings, seen: Object.fromEntries((room.seenFacts || []).map((id, index) => [id, index + 1])), random });
}
