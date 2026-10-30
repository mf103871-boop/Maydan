// Free preview participation rewards. These licenses grant no gameplay rights.
export const MAFIA_COMMUNITY_SEASON = Object.freeze({ id:'preview-2026-10-30', label:'موسم اللمة التجريبي', startsAt:Date.UTC(2026,9,29,21), endsAt:Date.UTC(2026,11,24,21), target:20, achievementId:'mafia_preview_season', itemId:'noir.avatar' });
export const MAFIA_CLUB_MISSION = Object.freeze({ target:20, ownTarget:3, achievementId:'mafia_club_participation', itemId:'noir.roomTheme' });
export const MAFIA_TOURNAMENT_TEMPLATE = Object.freeze({ rulesetVersion:1, mode:'classic', capacity:8, matches:3, voiceMode:'off', visibility:'private', points:{win:3,draw:1,loss:0}, reward:'recognition' });
