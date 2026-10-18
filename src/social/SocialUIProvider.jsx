import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from '../shared/account/context.js';
import { socialInterruption } from './interruption.js';
import { back as routeBack, getPreviousPath, navigate, useRoute } from '../platform/router.js';
import { socialListTab, socialPagePath, socialPageView, usesSocialDrawer } from './social-navigation.js';

const SocialUIContext = createContext(null);
export const useSocialUI = () => useContext(SocialUIContext);
export const conversationDraftKey = (kind, id) => `${kind}:${id}`;
const favoritesKey = accountKey => `maydan:social-ui:favorites:${encodeURIComponent(accountKey)}`;
const loadFavorites = accountKey => {
  if (!accountKey || accountKey === 'guest') return [];
  try {
    const value = JSON.parse(localStorage.getItem(favoritesKey(accountKey)) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128))].slice(0, 5000) : [];
  } catch { return []; }
};

function AccountSocialUI({ children, accountKey }) {
  const route = useRoute();
  const [stateOwner, setStateOwner] = useState(accountKey);
  const previousIdentity = useRef(accountKey === 'guest' ? null : accountKey);
  const [listTab, setListTab] = useState('friends');
  const [surface, setSurface] = useState({ path: route.path, view: socialPageView(route) || { type: 'list', tab: 'friends' }, history: [], drawerOpen: false });
  const [listState, setListState] = useState({});
  // Deliberately memory-only: drafts disappear on sign-out and never leak to a
  // later account or to another player using browser storage on this device.
  const [drafts, setDrafts] = useState({});
  const [invite, setInvite] = useState(null);
  // Device preference only: each account owns its own IDs; no message/profile data is stored.
  const [favorites, setFavorites] = useState(() => loadFavorites(accountKey));
  const owned = stateOwner === accountKey;
  const pageView = useMemo(() => socialPageView(route, owned ? listTab : 'friends'), [route, owned, listTab]);
  const drawerOpen = owned && usesSocialDrawer(route) && surface.drawerOpen;
  const presentation = pageView ? 'page' : drawerOpen ? 'drawer' : null;
  const view = useMemo(() => {
    if (!owned) return { type: 'list', tab: 'friends' };
    if (pageView && surface.path !== route.path) return pageView;
    return pageView || drawerOpen ? surface.view : { type: 'list', tab: listTab };
  }, [owned, pageView, drawerOpen, surface.path, surface.view, route.path, listTab]);
  useEffect(() => {
    setSurface({ path: '', view: { type: 'list', tab: 'friends' }, history: [], drawerOpen: false }); setListTab('friends'); setListState({}); setDrafts({}); setInvite(null); setFavorites(loadFavorites(accountKey)); setStateOwner(accountKey);
    // A direct link belongs to the session that opened it. A new account starts
    // at its own friend list rather than reusing a previous account's selection.
    // Initial account hydration also starts at "guest". Keep an incoming deep
    // link during that first sign-in; only a previous real account owns a
    // selection that must be discarded on sign-out or account replacement.
    if (previousIdentity.current && previousIdentity.current !== accountKey && socialPageView(route)) navigate('/friends', { replace: true });
    previousIdentity.current = accountKey === 'guest' ? null : accountKey;
    // The route is intentionally read only when ownership changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);
  useEffect(() => {
    setSurface(current => current.path === route.path ? current : { path: route.path, view: socialPageView(route, listTab) || { type: 'list', tab: listTab }, history: [], drawerOpen: false });
  }, [route, listTab]);
  useEffect(() => {
    if (!owned || !accountKey || accountKey === 'guest') return;
    try { localStorage.setItem(favoritesKey(accountKey), JSON.stringify(favorites)); } catch { /* Keep the preference for this session if storage is unavailable. */ }
  }, [favorites, accountKey, owned]);
  const toggleFavorite = useCallback(id => {
    if (!owned || !accountKey || accountKey === 'guest' || !id) return;
    setFavorites(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }, [owned, accountKey]);
  const show = useCallback((next = { type: 'list', tab: 'friends' }) => {
    if (next.type === 'list') setListTab(socialListTab(next.tab));
    const drawer = usesSocialDrawer(route);
    const path = drawer ? route.path : socialPagePath(next);
    setSurface({ path, view: next, history: [], drawerOpen: drawer });
    if (!drawer) navigate(path);
  }, [route]);
  const push = useCallback(next => {
    const drawer = usesSocialDrawer(route);
    const path = drawer || pageView ? route.path : '/friends';
    setSurface(current => ({ path, view: next, history: [...(current.path === path ? current.history : []), view], drawerOpen: drawer }));
    if (!drawer && !pageView) navigate(path);
  }, [route, pageView, view]);
  // Closing is a drawer action. A game invitation may already have navigated to
  // its room before calling close, so it must never navigate away from the room.
  const close = useCallback(() => setSurface(current => ({ ...current, drawerOpen: false })), []);
  const back = useCallback(() => {
    if (surface.path === route.path && surface.history.length) {
      setSurface(current => ({ ...current, view: current.history.at(-1), history: current.history.slice(0, -1) }));
    } else if (pageView && route.path !== '/friends') {
      if (getPreviousPath() === '/friends') routeBack();
      else navigate('/friends', { replace: true });
    } else show({ type: 'list', tab: listTab });
  }, [route.path, pageView, surface.path, surface.history.length, show, listTab]);
  const openChat = useCallback(id => show({ type: 'direct', id }), [show]);
  const openGroup = useCallback(id => show({ type: 'group', id }), [show]);
  const openProfile = useCallback(id => push({ type: 'profile', id }), [push]);
  const setDraft = useCallback((key, text) => setDrafts(current => ({ ...current, [key]: text })), []);
  const shareRoom = useCallback(detail => { setInvite(detail); show({ type: 'list', tab: 'friends' }); }, [show]);
  const clearInvite = useCallback(() => setInvite(null), []);
  const updateListState = useCallback((tab, patch) => setListState(current => ({ ...current, [tab]: { ...current[tab], ...patch } })), []);
  const resetSection = useCallback(() => { setListState({}); show({ type: 'list', tab: 'friends' }); }, [show]);
  useEffect(() => { if (!drawerOpen) return undefined; socialInterruption.open(); return () => socialInterruption.close(); }, [drawerOpen]);
  useEffect(() => {
    const handler = event => { if (event.detail?.roomCode) shareRoom(event.detail); };
    window.addEventListener('maydan-invite-friends', handler);
    return () => window.removeEventListener('maydan-invite-friends', handler);
  }, [shareRoom]);
  const value = useMemo(() => ({ open: presentation !== null, drawerOpen, presentation, view, show, push, close, back, openChat, openGroup, openProfile, drafts: owned ? drafts : {}, setDraft, listState: owned ? listState : {}, updateListState, resetSection, favorites: owned ? favorites : [], toggleFavorite, invite: owned ? invite : null, shareRoom, clearInvite }), [presentation, drawerOpen, view, show, push, close, back, openChat, openGroup, openProfile, owned, drafts, setDraft, listState, updateListState, resetSection, favorites, toggleFavorite, invite, shareRoom, clearInvite]);
  return <SocialUIContext.Provider value={value}>{children}</SocialUIContext.Provider>;
}

export function SocialUIProvider({ children }) {
  const account = useAccount();
  return <AccountSocialUI accountKey={account.ready && account.signedIn && account.user?.id ? account.user.id : 'guest'}>{children}</AccountSocialUI>;
}
