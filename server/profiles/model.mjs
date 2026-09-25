import { fail } from '../room-model.mjs';
import { PROFILE_THEMES, AVATAR_PRESETS, TITLES, ACHIEVEMENTS, PROFILE_GAME_IDS, EMPTY_STATS, achievementState } from '../../src/profiles/catalog.js';
export { PROFILE_GAME_IDS, EMPTY_STATS };

export function userId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) fail('INVALID', 400);
  return value;
}
export function revisionOf(value) {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID', 400);
  return value;
}
export function displayName(value) {
  if (typeof value !== 'string') fail('INVALID', 400);
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (Array.from(name).length < 2 || Array.from(name).length > 32 || /[@\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(name)) fail('INVALID', 400);
  return name;
}
export function publicName(value) {
  if (typeof value !== 'string') return 'لاعب ميدان';
  const normalized = value.normalize('NFKC');
  if (normalized.includes('@')) return 'لاعب ميدان';
  const name = normalized.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, '').trim();
  return Array.from(name || 'لاعب ميدان').slice(0,32).join('');
}
export function bioOf(value) {
  if (typeof value !== 'string') fail('INVALID', 400);
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (Array.from(text).length > 160 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text)) fail('INVALID', 400);
  return text;
}
export function patchOf(body, earned) {
  const allowed = new Set(['name','bio','theme','avatarPreset','selectedTitle','featuredBadges','revision']);
  if (Object.keys(body).some(key => !allowed.has(key))) fail('INVALID', 400);
  const patch = {};
  if ('name' in body) patch.name = displayName(body.name);
  if ('bio' in body) patch.bio = bioOf(body.bio);
  if ('theme' in body) {
    if (!PROFILE_THEMES.some(item => item.id === body.theme)) fail('INVALID', 400);
    patch.theme = body.theme;
  }
  if ('avatarPreset' in body) {
    if (!AVATAR_PRESETS.some(item => item.id === body.avatarPreset)) fail('INVALID', 400);
    patch.avatarPreset = body.avatarPreset;
  }
  if ('selectedTitle' in body) {
    if (body.selectedTitle !== null && (!TITLES.some(item => item.id === body.selectedTitle) || !earned.earnedTitles.includes(body.selectedTitle))) fail('NOT_EARNED', 403);
    patch.selectedTitle = body.selectedTitle;
  }
  if ('featuredBadges' in body) {
    if (!Array.isArray(body.featuredBadges) || body.featuredBadges.length > 3 || new Set(body.featuredBadges).size !== body.featuredBadges.length) fail('INVALID', 400);
    if (body.featuredBadges.some(id => !ACHIEVEMENTS.some(item => item.id === id) || !earned.earnedBadges.includes(id))) fail('NOT_EARNED', 403);
    patch.featuredBadges = body.featuredBadges;
  }
  if (!Object.keys(patch).length) fail('INVALID', 400);
  return { patch, revision: revisionOf(body.revision) };
}
export function gameOf(value) {
  if (!PROFILE_GAME_IDS.includes(value)) fail('INVALID', 400);
  return value;
}
export const imageUrl = (id, kind, version) => version ? `/api/profiles/${encodeURIComponent(id)}/images/${kind}/${version}` : null;
export function earnedState({ stats, friendCount, profile }, records = []) {
  const state = achievementState({ stats, friendCount, profile });
  const stored = new Set(records.map(row => row.achievement_id));
  const achievements = state.achievements.map(item => {
    const earned = item.earned || stored.has(item.id);
    return { ...item, earned, current: earned ? Math.max(item.current, item.target) : item.current, progress: earned ? 1 : item.progress };
  });
  return { achievements, earnedBadges: achievements.filter(a => a.earned).map(a => a.id), earnedTitles: achievements.filter(a => a.earned).map(a => a.titleId) };
}
