import { ERSOMHA_CATEGORIES } from '../../online/shared.js';
export const ERSOMHA_DIFFICULTIES = Object.freeze({ easy: 'سهل', medium: 'متوسط', hard: 'تحدّي' });
export function normalizeErsomhaOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const categories = [...new Set(Array.isArray(value.categories) ? value.categories : [])].filter(id => ERSOMHA_CATEGORIES.some(category => category.id === id));
  return { cycles: value.cycles === 2 ? 2 : 1, drawSeconds: 60, difficulty: Object.hasOwn(ERSOMHA_DIFFICULTIES, value.difficulty) ? value.difficulty : 'medium', categories: categories.length === ERSOMHA_CATEGORIES.length ? [] : categories, allowReplay: value.allowReplay === true };
}
export function enoughErsomhaCategories(value) { return !value.categories?.length || value.categories.length >= 3; }
