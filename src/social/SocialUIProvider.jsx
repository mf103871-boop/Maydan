import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAccount } from '../shared/account/context.js';
import { socialInterruption } from './interruption.js';

const SocialUIContext = createContext(null);
export const useSocialUI = () => useContext(SocialUIContext);
export const conversationDraftKey = (kind, id) => `${kind}:${id}`;

function AccountSocialUI({ children, accountKey }) {
  const [stateOwner, setStateOwner] = useState(accountKey);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ type: 'list', tab: 'friends' });
  const [history, setHistory] = useState([]);
  // Deliberately memory-only: drafts disappear on sign-out and never leak to a
  // later account or to another player using browser storage on this device.
  const [drafts, setDrafts] = useState({});
  const [invite, setInvite] = useState(null);
  const owned = stateOwner === accountKey;
  useEffect(() => {
    setOpen(false); setView({ type: 'list', tab: 'friends' }); setHistory([]); setDrafts({}); setInvite(null); setStateOwner(accountKey);
  }, [accountKey]);
  const show = useCallback((next = { type: 'list', tab: 'friends' }) => {
    setView(next); setHistory([]); setOpen(true);
  }, []);
  const push = useCallback(next => { setHistory(items => [...items, view]); setView(next); setOpen(true); }, [view]);
  const close = useCallback(() => setOpen(false), []);
  const back = useCallback(() => {
    if (!history.length) { setView({ type: 'list', tab: 'friends' }); return; }
    setView(history.at(-1)); setHistory(items => items.slice(0, -1));
  }, [history]);
  const openChat = useCallback(id => show({ type: 'direct', id }), [show]);
  const openGroup = useCallback(id => show({ type: 'group', id }), [show]);
  const openProfile = useCallback(id => push({ type: 'profile', id }), [push]);
  const setDraft = useCallback((key, text) => setDrafts(current => ({ ...current, [key]: text })), []);
  const shareRoom = useCallback(detail => { setInvite(detail); show({ type: 'list', tab: 'friends' }); }, [show]);
  const clearInvite = useCallback(() => setInvite(null), []);
  useEffect(() => { if (!open) return undefined; socialInterruption.open(); return () => socialInterruption.close(); }, [open]);
  useEffect(() => {
    const handler = event => { if (event.detail?.roomCode) shareRoom(event.detail); };
    window.addEventListener('maydan-invite-friends', handler);
    return () => window.removeEventListener('maydan-invite-friends', handler);
  }, [shareRoom]);
  const value = useMemo(() => ({ open: owned && open, view: owned ? view : { type: 'list', tab: 'friends' }, show, push, close, back, openChat, openGroup, openProfile, drafts: owned ? drafts : {}, setDraft, invite: owned ? invite : null, shareRoom, clearInvite }), [owned, open, view, show, push, close, back, openChat, openGroup, openProfile, drafts, setDraft, invite, shareRoom, clearInvite]);
  return <SocialUIContext.Provider value={value}>{children}</SocialUIContext.Provider>;
}

export function SocialUIProvider({ children }) {
  const account = useAccount();
  return <AccountSocialUI accountKey={account.signedIn ? account.user?.id : 'guest'}>{children}</AccountSocialUI>;
}
