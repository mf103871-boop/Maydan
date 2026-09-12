import questions from '../../data/games/fabraka/questions.json';
import pictures from '../../data/games/fabraka/pictures.json';
import personal from '../../data/games/fabraka/personal.json';
export { questions, pictures, personal };
export const categories = [...new Set(questions.map((q) => q.category))].sort((a, b) => a.localeCompare(b, 'ar'));
