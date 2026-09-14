import questions from '../../data/games/fabraka/questions.json';
import pictures from '../../data/games/fabraka/pictures.json';
import personal from '../../data/games/fabraka/personal.json';
export { questions, pictures, personal };
export const categories = [...new Set(questions.map((q) => q.category))].sort((a, b) => a.localeCompare(b, 'ar'));
// كم سؤالًا يتبقى لكل موضوع في كل نمط أسئلة؟ الإعدادات تعتمد عليه كي لا تعرض
// تركيبة مسدودة (موضوع بلا «غرائب مختارة») ثم تطلب من اللاعبين حلًّا مستحيلًا.
export const categoryCounts = Object.fromEntries(categories.map((category) => {
  const inCategory = questions.filter((q) => q.category === category);
  return [category, { all: inCategory.length, curious: inCategory.filter((q) => q.curious).length }];
}));
export const categoryCount = (category, style) => categoryCounts[category]?.[style === 'all' ? 'all' : 'curious'] ?? 0;
