// Public descriptions only. These cosmetics never grant a role, charge or power.
export const MAFIA_ACHIEVEMENT_CATALOG_VERSION = 2;
export const MAFIA_ACHIEVEMENT_LIST = Object.freeze([
  { id: 'mafia_first_qualified', label: 'أول مباراة', description: 'أكمل أول مباراة مافيا مؤهلة دون انسحاب.', metric: 'qualified', target: 1, cosmeticItemId: 'noir.frame' },
  { id: 'mafia_win_town', label: 'انتصار الميدان', description: 'حقق أول فوز مؤهل بانتماء نهائي إلى أهل الميدان.', metric: 'faction_win', faction: 'town', target: 1, cosmeticItemId: null },
  { id: 'mafia_win_mafia', label: 'انتصار المافيا', description: 'حقق أول فوز مؤهل بانتماء نهائي إلى المافيا.', metric: 'faction_win', faction: 'mafia', target: 1, cosmeticItemId: null },
  { id: 'mafia_win_shadow', label: 'انتصار الرابطة', description: 'حقق أول فوز مؤهل بانتماء نهائي إلى رابطة الظل، ولو بدأت مع فريق آخر.', metric: 'faction_win', faction: 'shadow', target: 1, cosmeticItemId: null },
  { id: 'mafia_roles_three', label: 'ثلاثة اختصاصات', description: 'أكمل مباريات مؤهلة بثلاثة اختصاصات مختلفة.', metric: 'roles', target: 3, cosmeticItemId: 'noir.nameColor' },
  { id: 'mafia_factions_three', label: 'الفرق الثلاثة', description: 'أكمل مباريات مؤهلة بالانتماءات النهائية الثلاثة.', metric: 'factions', target: 3, cosmeticItemId: 'noir.cover' },
  { id: 'mafia_preview_season', label: 'موسم اللمة', description: 'أكمل عشرين مشاركة عامة مؤهلة خلال موسم اللمة التجريبي، ثم استلم شخصيتك المجانية من لوحة الموسم.', metric: 'community_season', target: 20, cosmeticItemId: 'noir.avatar' },
  { id: 'mafia_club_participation', label: 'أهل النادي', description: 'ساهم بثلاث مشاركات مؤهلة على الأقل ضمن مهمة النادي ذات العشرين مشاركة، ثم استلم ستايل المجلس.', metric: 'community_club', target: 20, cosmeticItemId: 'noir.roomTheme' },
  { id: 'mafia_ranked_preview_season', label: 'موسم المنافسة التجريبي', description: 'أكمل عشر مباريات تنافسية مؤهلة في الموسم التجريبي؛ يمنح إغلاق الموسم المعتمد إطار سهرة ميدان دون شراء.', metric: 'ranked_season', target: 10, cosmeticItemId: 'sahra.frame' },
].map(value => Object.freeze(value)));
export const MAFIA_ACHIEVEMENTS = Object.freeze(Object.fromEntries(MAFIA_ACHIEVEMENT_LIST.map(value => [value.id, value])));
export const getMafiaAchievement = id => Object.hasOwn(MAFIA_ACHIEVEMENTS, id) ? MAFIA_ACHIEVEMENTS[id] : null;
