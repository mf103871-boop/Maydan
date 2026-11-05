// Synthetic display data. This module is used only by the loopback preview entry.
export const FIXTURE_STORAGE_KEY = 'maydan:progression-preview:v1';
export const REFERENCE_FRAME = 'progression.reference.equipped';
export const PREVIEW_ART = '/fixture-art/';
export const FENNEC = PREVIEW_ART + 'fennec.webp';
export const REFERENCE_HERO = PREVIEW_ART + 'profile-hero.webp';
export const REFERENCE_PLAYER = Object.freeze({
  name: 'ليان',
  bio: 'الناس واللعب والضحك\nهنا أجمل الحكايات',
  level: 50,
  xpIntoLevel: 3100,
  xpForNextLevel: 5000,
});
const titles = ['رحّالة الميدان', 'صديق الميدان', 'نجم الجلسات'];
export const EARNED_TITLES = Object.freeze(titles);
export const ACHIEVEMENTS = Object.freeze([
  { id: 'sample.explorer', label: 'مستكشف الميدان', art: 'achievement-explorer', detail: '٦ ألعاب مختلفة',
    condition: 'تُظهر العينة ست ألعاب مختلفة. الاسم والعدد هنا مثال عرض؛ القاعدة الحالية «حب الاستكشاف» مستقلة.',
    progress: '٦ ألعاب مختلفة في العينة', source: 'جلسات ومباريات مؤهلة بحسب مسارها', reward: 'شارة في المعاينة', date: 'غير مسجل في بيانات العرض' },
  { id: 'gatherings', label: 'صاحب الجمعة', art: 'achievement-host', detail: '٢٠ جلسة مستضافة',
    condition: 'شرط ميدان الحالي هو استضافة عشر جلسات مكتملة. استضافت ليان عشرين جلسة في بيانات العرض.',
    progress: '٢٠ جلسة مستضافة في العينة', source: 'استضافة مكتملة على جهاز واحد', reward: 'اللقب المكتسب والشارة', date: 'غير مسجل في بيانات العرض' },
  { id: 'sample.team', label: 'روح الفريق', art: 'achievement-team', detail: '٥٠ مباراة مؤهلة',
    condition: 'تُظهر العينة خمسين مباراة مؤهلة. شرط منح «روح الفريق» في اللعبة ما زال قرارًا معلقًا.',
    progress: '٥٠ مباراة مؤهلة في العينة', source: 'إحصاء عرض تجريبي', reward: 'شارة في المعاينة', date: 'غير مسجل في بيانات العرض' },
]);
export const TRACKS = Object.freeze([
  { game: 'badeeha', label: 'بديهة', grade: 6, maxGrade: 10, art: 'mastery-badeeha' },
  { game: 'mafia', label: 'مافيا', grade: 8, maxGrade: 10, art: 'mastery-mafia' },
]);
const frameTitles = [[1, 'بداية الرحلة'], [10, 'صديق الميدان'], [20, 'نجم الجلسات'],
  [30, 'صانع الأجواء'], [40, 'نجم الميدان'], [50, 'رحّالة الميدان']];
export const BOARD_FRAMES = Object.freeze(frameTitles.map(([level, title]) => ({
  id: 'progression.frame.' + level,
  title, level, type: 'frame', state: 'owned', source: 'محطة مستوى في المعاينة',
  previewSrc: PREVIEW_ART + 'frame-' + level + '-portrait.webp',
})));
export const NEXT_REWARD = Object.freeze({
  id: 'progression.frame.60', itemId: 'progression.frame.60', type: 'frame',
  title: 'إطار النجمة الشرقية', level: 60, state: 'locked', source: 'مكافأة بلوغ المستوى ٦٠',
});
export const EQUIPPED_REFERENCE = Object.freeze({
  id: REFERENCE_FRAME, title: 'إطار البروفايل في المرجع', type: 'frame',
  state: 'equipped', source: 'قطعة مجهزة مسبقًا في بيانات المقارنة',
});
export const SHOWCASE_OBJECTS = Object.freeze([
  { id: 'ornament-frame', title: 'إطار', type: 'frame', state: 'preview', detail: 'إطارات مميزة تعكس مسيرتك', art: 'ornament-frame', source: 'أصل زخرفي من لوحة v2' },
  { id: 'ornament-lantern', title: 'مقتنيات', type: 'collectible', state: 'preview', detail: 'مقتنيات فريدة ترافقك', art: 'ornament-lantern', source: 'أصل زخرفي من لوحة v2' },
  { id: 'ornament-gem', title: 'أوسمة', type: 'badge', state: 'preview', detail: 'أوسمة لإنجازاتك في اللعبة', art: 'ornament-gem', source: 'أصل زخرفي من لوحة v2' },
]);
export const INVENTORY = Object.freeze([...BOARD_FRAMES, EQUIPPED_REFERENCE, NEXT_REWARD, ...SHOWCASE_OBJECTS]);
const ownedFrames = new Set([REFERENCE_FRAME, ...BOARD_FRAMES.map(item => item.id)]);
const badges = new Set(ACHIEVEMENTS.map(badge => badge.id));
export const newFixtureState = () => ({ frame: REFERENCE_FRAME, previousFrame: null, title: titles[0], badges: [...badges] });

export function loadFixture(storage) {
  const initial = newFixtureState();
  try {
    const data = JSON.parse(storage?.getItem(FIXTURE_STORAGE_KEY) || 'null');
    if (!data || typeof data !== 'object') return initial;
    return {
      frame: ownedFrames.has(data.frame) ? data.frame : initial.frame,
      previousFrame: ownedFrames.has(data.previousFrame) ? data.previousFrame : initial.previousFrame,
      title: titles.includes(data.title) ? data.title : initial.title,
      badges: Array.isArray(data.badges) ? [...new Set(data.badges.filter(id => badges.has(id)))].slice(0, 3) : initial.badges,
    };
  } catch { return initial; }
}
export function saveFixture(storage, value) {
  try { storage?.setItem(FIXTURE_STORAGE_KEY, JSON.stringify(value)); } catch { /* The fixture remains usable in memory. */ }
}
export function equipFixture(state, frame) {
  return ownedFrames.has(frame) && state.frame !== frame ? { ...state, frame, previousFrame: state.frame } : state;
}
export function titleFixture(state, title) { return titles.includes(title) ? { ...state, title } : state; }
export function toggleFixtureBadge(state, id) {
  if (!badges.has(id)) return state;
  if (state.badges.includes(id)) return { ...state, badges: state.badges.filter(item => item !== id) };
  return state.badges.length < 3 ? { ...state, badges: [...state.badges, id] } : state;
}
export function moveFixtureBadge(state, id, direction) {
  const from = state.badges.indexOf(id);
  const to = from + direction;
  if (Math.abs(direction) !== 1 || from < 0 || to < 0 || to >= state.badges.length) return state;
  const next = [...state.badges];
  [next[from], next[to]] = [next[to], next[from]];
  return { ...state, badges: next };
}
