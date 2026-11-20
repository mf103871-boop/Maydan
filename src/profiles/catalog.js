// Shared cosmetic and achievement rules: clients may choose earned rewards, never grant them.
export const PROFILE_THEMES = [
  { id: 'teal', label: 'فيروز ميدان', color: '#126d70', accent: '#a4ddd5', gradient: 'linear-gradient(160deg,#4ae0cf,#09b4a5 62%,#079689)' },
  { id: 'violet', label: 'ليالي البنفسج', color: '#72509b', accent: '#d8c0ec', gradient: 'linear-gradient(160deg,#cf96e5,#b374cf 62%,#965bb5)' },
  { id: 'sunset', label: 'غروب دافئ', color: '#a65d43', accent: '#f3c3a0', gradient: 'linear-gradient(160deg,#ffac90,#ff8a70 62%,#ee785f)' },
  { id: 'ocean', label: 'موج أزرق', color: '#306b96', accent: '#b6d8eb', gradient: 'linear-gradient(160deg,#91d8f7,#55b7e9 62%,#419bd1)' },
  { id: 'forest', label: 'ظل الزيتون', color: '#526e48', accent: '#c4d5a4', gradient: 'linear-gradient(160deg,#a9c588,#85a569 62%,#6d8d55)' },
  { id: 'rose', label: 'ورد الشام', color: '#a25377', accent: '#efd0db', gradient: 'linear-gradient(160deg,#ffa4c5,#f774a5 62%,#df5d91)' },
  { id: 'gold', label: 'رمل وذهب', color: '#907035', accent: '#e7d79f', gradient: 'linear-gradient(160deg,#ffda85,#ffc35c 62%,#edab3c)' },
  { id: 'midnight', label: 'ليل ونجوم', color: '#465175', accent: '#c2cce9', gradient: 'linear-gradient(160deg,#6384b0,#365b8a 62%,#29466d)' },
];
export const AVATAR_PRESETS = [
  { id: 'spark', label: 'نجمة', emoji: '✨' }, { id: 'falcon', label: 'صقر', emoji: '🦅' },
  { id: 'lion', label: 'أسد', emoji: '🦁' }, { id: 'fox', label: 'ثعلب', emoji: '🦊' },
  { id: 'owl', label: 'بومة', emoji: '🦉' }, { id: 'cat', label: 'قط', emoji: '🐱' },
  { id: 'rocket', label: 'صاروخ', emoji: '🚀' }, { id: 'controller', label: 'لاعب', emoji: '🎮' },
  { id: 'human-01', label: 'ليان' }, { id: 'human-02', label: 'عمر' },
  { id: 'human-03', label: 'سارة' }, { id: 'human-04', label: 'نور' },
];
export const PROFILE_GAME_IDS = ['badeeha', 'beep', 'mamnoo', 'jabeen', 'fabraka', 'meenfina', 'ersomha'];
export const EMPTY_STATS = Object.freeze({ localSessions: 0, onlineMatches: 0, onlineWins: 0, onlineDraws: 0, distinctGames: 0 });
export const ACHIEVEMENTS = [
  { id: 'welcome', label: 'أهلًا في الميدان', description: 'انضمّ إلى مجتمع ميدان.', icon: 'spark', metric: 'member', target: 1, titleId: 'member' },
  { id: 'identity', label: 'هذه شخصيتي', description: 'أضف نبذة وصورة أو شخصية لبروفايلك.', icon: 'person', metric: 'profileComplete', target: 1, titleId: 'distinctive' },
  { id: 'first-friend', label: 'الجمعة أحلى', description: 'أضف أول صديق بعد قبول الطلب.', icon: 'people', metric: 'friendCount', target: 1, titleId: 'companion' },
  { id: 'circle', label: 'شلّة ميدان', description: 'كوّن قائمة من خمسة أصدقاء.', icon: 'people', metric: 'friendCount', target: 5, titleId: 'social' },
  { id: 'host', label: 'أول جمعة', description: 'استضف جلسة مكتملة على جهاز واحد.', icon: 'home', metric: 'localSessions', target: 1, titleId: 'host' },
  { id: 'gatherings', label: 'صاحب الجمعة', description: 'استضف عشر جلسات مكتملة.', icon: 'home', metric: 'localSessions', target: 10, titleId: 'gatherer' },
  { id: 'explorer', label: 'حب الاستكشاف', description: 'أكمل جلسات في ثلاث ألعاب مختلفة.', icon: 'compass', metric: 'distinctGames', target: 3, titleId: 'explorer' },
  { id: 'all-games', label: 'جولة في الميدان', description: 'أكمل جلسة في ست ألعاب مختلفة من ميدان.', icon: 'compass', metric: 'distinctGames', target: 6, titleId: 'adventurer' },
  { id: 'online-start', label: 'وصلنا ببعض', description: 'أكمل أول مباراة أونلاين بحسابك.', icon: 'globe', metric: 'onlineMatches', target: 1, titleId: 'challenger' },
  { id: 'online-ten', label: 'على الموعد', description: 'أكمل عشر مباريات أونلاين.', icon: 'globe', metric: 'onlineMatches', target: 10, titleId: 'regular' },
  { id: 'first-win', label: 'طعم الفوز', description: 'حقق أول فوز، منفردًا أو مع فريقك، في منافسات ميدان أونلاين.', icon: 'trophy', metric: 'onlineWins', target: 1, titleId: 'winner' },
  { id: 'five-wins', label: 'خمس انتصارات', description: 'حقق خمسة انتصارات في منافسات ميدان أونلاين.', icon: 'trophy', metric: 'onlineWins', target: 5, titleId: 'champion' },
  { id: 'twenty-five-wins', label: 'اسم في الميدان', description: 'حقق خمسة وعشرين انتصارًا في منافسات ميدان أونلاين.', icon: 'crown', metric: 'onlineWins', target: 25, titleId: 'legend' },
];
const titleNames = {
  member: 'عضو ميدان', distinctive: 'شخصية مميّزة', companion: 'رفيق ميدان', social: 'روح الشلّة',
  host: 'مضيف الجمعة', gatherer: 'صاحب الجمعة', explorer: 'مستكشف ميدان', adventurer: 'جوّال الميدان',
  challenger: 'جاهز للتحدي', regular: 'دايم على الموعد', winner: 'صاحب الانتصار', champion: 'بطل الميدان', legend: 'أسطورة الميدان',
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
