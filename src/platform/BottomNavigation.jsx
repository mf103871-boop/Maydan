import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAccount } from '../shared/account/context.js';
import { useSocial } from '../social/SocialProvider.jsx';
import { useLamma } from '../social/LammaProvider.jsx';
import { useSocialUI } from '../social/SocialUIProvider.jsx';
import { navigate } from './router.js';
import { usePlatform } from './context.js';
import { MENU_ITEMS, menuSection, menuRouteVisible, keyboardOccupiesViewport, menuBadges } from './menu-navigation.js';
import css from './bottom-navigation.css';

const paths = {
  games: 'M7 7h10a4 4 0 0 1 4 3.4l1 6.1a2.5 2.5 0 0 1-4.2 2.2L15 16H9l-2.8 2.7A2.5 2.5 0 0 1 2 16.5l1-6.1A4 4 0 0 1 7 7ZM7 10v5M4.5 12.5h5M16 11h.01M19 14h.01M9 7V5h6',
  friends: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  store: 'm3 9 2-6h14l2 6M3 9v2a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9ZM5 14v7h14v-7M9 21v-5h6v5M9 3v6M15 3v6',
  settings: 'm9.5 3-.6 2.3-2 .9L4.8 5.6 2.3 10l1.7 1.6v1L2.3 14l2.5 4.4 2.1-.6 2 .9.6 2.3h5l.6-2.3 2-.9 2.1.6 2.5-4.4-1.7-1.5v-1l1.7-1.5-2.5-4.4-2.1.6-2-.9-.6-2.3h-5ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
};
const editable = element => element?.matches?.('textarea,input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]),[contenteditable="true"]');

function useMenuObstructions() {
  const [state, setState] = useState({ keyboard: false, modal: false });
  useEffect(() => {
    let frame;
    const update = () => {
      frame = null;
      const visual = window.visualViewport;
      const modal = [...document.querySelectorAll('.modal-layer,.sheet-layer,[role="dialog"][aria-modal="true"]')].some(node => node.getClientRects().length > 0);
      setState(previous => {
        const keyboard = keyboardOccupiesViewport({ layoutHeight: Math.max(innerHeight, document.documentElement.clientHeight), visualHeight: visual?.height || innerHeight, scale: visual?.scale || 1, editable: editable(document.activeElement), previouslyVisible: previous.keyboard });
        return previous.keyboard === keyboard && previous.modal === modal ? previous : { keyboard, modal };
      });
    };
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(update); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    for (const event of ['resize', 'orientationchange']) window.addEventListener(event, schedule);
    for (const event of ['focusin', 'focusout']) document.addEventListener(event, schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    update();
    return () => {
      observer.disconnect(); if (frame != null) cancelAnimationFrame(frame);
      for (const event of ['resize', 'orientationchange']) window.removeEventListener(event, schedule);
      for (const event of ['focusin', 'focusout']) document.removeEventListener(event, schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, []);
  return state;
}

export function BottomNavigation({ route }) {
  const account = useAccount();
  const social = useSocial(); const lamma = useLamma(); const ui = useSocialUI();
  const { sound, haptics } = usePlatform();
  const previousSection = useRef('games');
  const active = menuSection(route, previousSection.current);
  useEffect(() => { previousSection.current = active; }, [active]);
  const { keyboard, modal } = useMenuObstructions();
  const visible = menuRouteVisible(route, ui) && !keyboard && !modal;
  const nav = useRef(null);
  const badges = menuBadges(social, lamma, account.ready && account.signedIn);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      const space = visible ? nav.current?.getBoundingClientRect().height || 0 : 0;
      const value = `${space}px`;
      if (root.style.getPropertyValue('--menu-nav-space') !== value) root.style.setProperty('--menu-nav-space', value);
      root.toggleAttribute('data-menu-nav-visible', visible);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (nav.current) observer.observe(nav.current);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [visible]);
  useEffect(() => () => { document.documentElement.style.removeProperty('--menu-nav-space'); document.documentElement.removeAttribute('data-menu-nav-visible'); }, []);
  const select = (event, item) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    sound.play('click'); haptics.vibrate('selection');
    if (route.path === item.path) {
      if (item.id === 'friends') ui?.resetSection?.();
      window.dispatchEvent(new CustomEvent('maydan-menu-reselect', { detail: { section: item.id } }));
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else navigate(item.path);
  };
  return <><style>{css}</style><nav ref={nav} className="menu-navigation" aria-label="أقسام ميدان" data-testid="menu-navigation" hidden={!visible} dir="rtl">{MENU_ITEMS.map(item => <a key={item.id} href={'#' + item.path} className={'menu-navigation-item' + (active === item.id ? ' is-active' : '')} aria-current={active === item.id ? 'page' : undefined} onClick={event => select(event, item)}><span className="menu-navigation-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[item.icon]} /></svg>{item.id === 'friends' && (badges.unread > 0 ? <b className="menu-navigation-badge" aria-label={`${badges.unread} رسالة غير مقروءة`}>{badges.unread > 99 ? '99+' : badges.unread}</b> : badges.requests > 0 ? <span className="menu-navigation-dot" aria-label="طلبات جديدة" /> : null)}</span><span>{item.label}</span></a>)}</nav></>;
}

// Keep menu scroll positions in this mounted shell, never in persistent storage.
export function MenuScrollRestoration({ route }) {
  const account = useAccount();
  const owner = account.ready && account.signedIn ? account.user?.id || 'guest' : 'guest';
  const positions = useRef(new Map());
  const current = useRef(route.path);
  const lastOwner = useRef(owner);
  useLayoutEffect(() => {
    if (lastOwner.current !== owner) {
      for (const key of positions.current.keys()) if (key.startsWith('/friends') || key.startsWith('/profile')) positions.current.delete(key);
      lastOwner.current = owner;
    }
    current.current = route.path;
    const restore = () => window.scrollTo({ top: positions.current.get(route.path) || 0, behavior: 'instant' });
    restore(); const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [route.path, owner]);
  useEffect(() => {
    const save = () => positions.current.set(current.current, window.scrollY);
    const reset = () => positions.current.set(current.current, 0);
    window.addEventListener('scroll', save, { passive: true });
    window.addEventListener('maydan-menu-reselect', reset);
    return () => { window.removeEventListener('scroll', save); window.removeEventListener('maydan-menu-reselect', reset); };
  }, []);
  return null;
}
