export const MENU_ITEMS = Object.freeze([
  { id: 'games', label: 'الألعاب', path: '/', icon: 'games' },
  { id: 'friends', label: 'الأصدقاء', path: '/friends', icon: 'friends' },
  { id: 'store', label: 'المتجر', path: '/store', icon: 'store' },
  { id: 'settings', label: 'الإعدادات', path: '/settings', icon: 'settings' },
]);

export function menuSection(route, previous = 'games') {
  if (route.name === 'friends' || route.name === 'friend-group') return 'friends';
  if (route.name === 'store') return 'store';
  if (['settings', 'moderation', 'about', 'terms', 'privacy'].includes(route.name)) return 'settings';
  if (route.name === 'profile') return previous;
  return 'games';
}

export function menuRouteVisible(route, socialUI) {
  if (['play', 'room', 'mafia-tutorial'].includes(route.name)) return false;
  if (route.name === 'friend-group' || (route.name === 'friends' && route.params?.id)) return false;
  if (socialUI?.presentation === 'page' && socialUI.view?.type !== 'list') return false;
  return true;
}

export function keyboardOccupiesViewport({ layoutHeight, visualHeight, scale = 1, editable = false, previouslyVisible = false }) {
  if (!Number.isFinite(layoutHeight) || !Number.isFinite(visualHeight) || visualHeight <= 0 || Math.abs(scale - 1) > .001) return false;
  return layoutHeight - visualHeight > 120 && (editable || previouslyVisible);
}

export function menuBadges(social, lamma, signedIn) {
  if (!signedIn) return { unread: 0, requests: 0 };
  const count = value => Math.max(0, Number(value) || 0);
  return {
    unread: count(social?.unreadCount) + (lamma?.groups || []).reduce((sum, group) => sum + count(group.unreadCount), 0),
    requests: (social?.incoming || []).length + (lamma?.groupInvites || []).length,
  };
}
