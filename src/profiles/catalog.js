// Shared cosmetic and achievement rules: clients may choose earned rewards, never grant them.
export const PROFILE_THEMES = [
  { id: 'teal', label: 'فيروز ميدان', color: '#126d70', accent: '#a4ddd5', gradient: 'linear-gradient(125deg,#155e65,#469d94 62%,#b4ddbc)' },
  { id: 'violet', label: 'ليالي البنفسج', color: '#72509b', accent: '#d8c0ec', gradient: 'linear-gradient(125deg,#50377f,#9173b7 62%,#d9b6dc)' },
  { id: 'sunset', label: 'غروب دافئ', color: '#a65d43', accent: '#f3c3a0', gradient: 'linear-gradient(125deg,#934c4f,#d98961 62%,#f2cc86)' },
  { id: 'ocean', label: 'موج أزرق', color: '#306b96', accent: '#b6d8eb', gradient: 'linear-gradient(125deg,#244776,#548faf 62%,#a1d6d1)' },
  { id: 'forest', label: 'ظل الزيتون', color: '#526e48', accent: '#c4d5a4', gradient: 'linear-gradient(125deg,#385344,#7c9462 62%,#d3d2a1)' },
  { id: 'rose', label: 'ورد الشام', color: '#a25377', accent: '#efd0db', gradient: 'linear-gradient(125deg,#7b3f68,#bc7998 62%,#f1c8c6)' },
  { id: 'gold', label: 'رمل وذهب', color: '#907035', accent: '#e7d79f', gradient: 'linear-gradient(125deg,#7b5b35,#baa06a 62%,#ece0ae)' },
  { id: 'midnight', label: 'ليل ونجوم', color: '#465175', accent: '#c2cce9', gradient: 'linear-gradient(125deg,#26324c,#515d83 62%,#9c9fbd)' },
];
export const AVATAR_PRESETS = [
  { id: 'spark', label: 'نجمة', emoji: '✨' }, { id: 'falcon', label: 'صقر', emoji: '🦅' },
  { id: 'lion', label: 'أسد', emoji: '🦁' }, { id: 'fox', label: 'ثعلب', emoji: '🦊' },
  { id: 'owl', label: 'بومة', emoji: '🦉' }, { id: 'cat', label: 'قط', emoji: '🐱' },
  { id: 'rocket', label: 'صاروخ', emoji: '🚀' }, { id: 'controller', label: 'لاعب', emoji: '🎮' },
];
export const PROFILE_GAME_IDS = ['badeeha', 'beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina'];
export const EMPTY_STATS = Object.freeze({ localSessions: 0, onlineMatches: 0, onlineWins: 0, onlineDraws: 0, distinctGames: 0 });
export const ACHIEVEMENTS = [
  { id: 'welcome', label: 'أهلًا في الميدان', description: 'انضمّ إلى مجتمع ميدان.', icon: 'spark', metric: 'member', target: 1, titleId: 'member' },
  { id: 'identity', label: 'هذه شخصيتي', description: 'أضف نبذة وصورة أو شخصية لبروفايلك.', icon: 'person', metric: 'profileComplete', target: 1, titleId: 'distinctive' },
  { id: 'first-friend', label: 'الجمعة أحلى', description: 'أضف أول صديق بعد قبول الطلب.', icon: 'people', metric: 'friendCount', target: 1, titleId: 'companion' },
  { id: 'circle', label: 'شلّة ميدان', description: 'كوّن قائمة من خمسة أصدقاء.', icon: 'people', metric: 'friendCount', target: 5, titleId: 'social' },
  { id: 'host', label: 'أول جمعة', description: 'استضف جلسة مكتملة على جهاز واحد.', icon: 'home', metric: 'localSessions', target: 1, titleId: 'host' },
  { id: 'gatherings', label: 'صاحب الجمعة', description: 'استضف عشر جلسات مكتملة.', icon: 'home', metric: 'localSessions', target: 10, titleId: 'gatherer' },
  { id: 'explorer', label: 'حب الاستكشاف', description: 'أكمل جلسات في ثلاث ألعاب مختلفة.', icon: 'compass', metric: 'distinctGames', target: 3, titleId: 'explorer' },
  { id: 'all-games', label: 'جولة في الميدان', description: 'أكمل جلسة في كل ألعاب ميدان الست.', icon: 'compass', metric: 'distinctGames', target: 6, titleId: 'adventurer' },
  { id: 'online-start', label: 'وصلنا ببعض', description: 'أكمل أول مباراة أونلاين بحسابك.', icon: 'globe', metric: 'onlineMatches', target: 1, titleId: 'challenger' },
  { id: 'online-ten', label: 'على الموعد', description: 'أكمل عشر مباريات أونلاين.', icon: 'globe', metric: 'onlineMatches', target: 10, titleId: 'regular' },
  { id: 'first-win', label: 'طعم الفوز', description: 'حقق أول فوز منفرد في فبركة أونلاين.', icon: 'trophy', metric: 'onlineWins', target: 1, titleId: 'winner' },
  { id: 'five-wins', label: 'خمس انتصارات', description: 'حقق خمسة انتصارات في فبركة أونلاين.', icon: 'trophy', metric: 'onlineWins', target: 5, titleId: 'champion' },
  { id: 'twenty-five-wins', label: 'اسم في الميدان', description: 'حقق خمسة وعشرين انتصارًا في فبركة أونلاين.', icon: 'crown', metric: 'onlineWins', target: 25, titleId: 'legend' },
];
const titleNames = {
  member: 'عضو ميدان', distinctive: 'شخصية مميّزة', companion: 'رفيق ميدان', social: 'روح الشلّة',
  host: 'مضيف الجمعة', gatherer: 'صاحب الجمعة', explorer: 'مستكشف ميدان', adventurer: 'جوّال الميدان',
  challenger: 'جاهز للتحدي', regular: 'دايم على الموعد', winner: 'صاحب الانتصار', champion: 'بطل فبركة', legend: 'أسطورة فبركة',
};
export const TITLES = ACHIEVEMENTS.map(badge => ({ id: badge.titleId, label: titleNames[badge.titleId], badgeId: badge.id }));
export function achievementState({ stats = {}, friendCount = 0, profile = {} } = {}) {
  const metrics = { ...EMPTY_STATS, ...stats, friendCount, member: 1,
    profileComplete: profile.bio?.trim() && (profile.avatarUrl || (profile.avatarPreset && profile.avatarPreset !== 'spark')) ? 1 : 0 };
  const achievements = ACHIEVEMENTS.map(achievement => {
    const current = Math.max(0, Math.floor(Number(metrics[achievement.metric]) || 0));
    return { ...achievement, current, progress: Math.min(1, current / achievement.target), earned: current >= achievement.target };
  });
  return { achievements, earnedBadges: achievements.filter(item => item.earned).map(item => item.id),
    earnedTitles: achievements.filter(item => item.earned).map(item => item.titleId) };
}
export const profileTheme = id => PROFILE_THEMES.find(theme => theme.id === id) || PROFILE_THEMES[0];
export const avatarPreset = id => AVATAR_PRESETS.find(avatar => avatar.id === id) || AVATAR_PRESETS[0];
export const titleLabel = id => TITLES.find(title => title.id === id)?.label || '';
