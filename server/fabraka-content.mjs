import questions from '../src/data/games/fabraka/questions.json' with { type: 'json' };
import pictures from '../src/data/games/fabraka/pictures.json' with { type: 'json' };
import personal from '../src/data/games/fabraka/personal.json' with { type: 'json' };
import { buildDeck, duoQuestion } from '../src/games/fabraka/logic.js';

export function buildFabrakaDeck(room) {
  const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
  const duo = room.settings.mode !== 'friends' && room.members.filter((m) => !m.left).length === 2;
  return buildDeck({ questions: duo ? questions.filter(duoQuestion) : questions, pictures: duo ? pictures.filter(duoQuestion) : pictures, personal,
    options: room.settings, seen: Object.fromEntries((room.seenFacts || []).map((id, index) => [id, index + 1])), random });
}
