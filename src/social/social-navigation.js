const LIST_TABS = new Set(['friends', 'chats', 'groups', 'requests']);
export const socialListTab = tab => LIST_TABS.has(tab) ? tab : 'friends';
export const usesSocialDrawer = route => ['play', 'room'].includes(route?.name);
export function socialPageView(route, tab = 'friends') {
  if (route?.name === 'friend-group') return { type: 'group', id: route.params?.id };
  if (route?.name !== 'friends') return null;
  return route.params?.id ? { type: 'direct', id: route.params.id } : { type: 'list', tab: socialListTab(tab) };
}
export function socialPagePath(view) {
  if (view?.type === 'direct') return `/friends/${encodeURIComponent(view.id)}`;
  if (view?.type === 'group') return `/friends/group/${encodeURIComponent(view.id)}`;
  return '/friends';
}
