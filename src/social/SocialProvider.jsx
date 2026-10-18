import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { useAccount } from '../shared/account/context.js';
import { resolveAccountServer } from '../shared/account/api.js';
import { SocialClient, emptySocialState } from './client.js';

const SocialContext = createContext(null);
export const useSocial = () => useContext(SocialContext);
const METHODS = ['refresh','searchUsers','sendRequest','acceptRequest','rejectRequest','cancelRequest','openConversation','loadOlder',
  'sendMessage','retryMessage','editMessage','deleteMessage','markRead','setTyping','removeFriend','blockUser','unblockUser','reportUser','registerConversation','receiveOwnMessage'];
export function SocialProvider({ children }) {
  const account = useAccount(); const accountRef = useRef(account); accountRef.current = account;
  const clientRef = useRef(null);
  const [notification, setNotification] = useState(null);
  const clearNotification = useCallback(() => setNotification(null), []);
  if (!clientRef.current) {
    const client = new SocialClient({ request: (path, options) => accountRef.current.requestAuthenticated(path, options), server: resolveAccountServer });
    client.actions = Object.fromEntries(METHODS.map(name => [name, client[name].bind(client)]));
    clientRef.current = client;
  }
  const client = clientRef.current;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const userId = account.ready && account.signedIn && account.user?.id ? account.user.id : null;
  // Never paint one account's private data while the identity-change effect runs.
  const safeState = client.userId === userId ? state : emptySocialState();
  useEffect(() => { client.start(userId); return () => client.stop(); }, [client, userId]);
  useEffect(() => {
    const update = () => client.visibilityChanged();
    document.addEventListener('visibilitychange', update); window.addEventListener('online', update);
    const offline = () => client.update({ offline: true }); window.addEventListener('offline', offline);
    return () => { document.removeEventListener('visibilitychange', update); window.removeEventListener('online', update); window.removeEventListener('offline', offline); };
  }, [client]);
  const previous = useRef(null);
  useEffect(() => {
    if (!safeState.profile || safeState.loading) { previous.current = null; return; }
    const before = previous.current;
    if (before?.userId === userId) {
      const fresh = safeState.friends.find(f => f.unreadCount > (before.counts[f.id] || 0) && client.activeFriend !== f.id);
      if (fresh) setNotification({ id: Date.now(), userId, type: 'message', friend: fresh });
      else if (safeState.incoming.length > before.requests) setNotification({ id: Date.now(), userId, type: 'request' });
    }
    previous.current = { userId, counts: Object.fromEntries(safeState.friends.map(f => [f.id, f.unreadCount])), requests: safeState.incoming.length };
  }, [safeState.friends, safeState.incoming, safeState.profile, safeState.loading, userId, client]);
  const unreadCount = safeState.friends.reduce((n,f) => n+f.unreadCount, 0);
  return <SocialContext.Provider value={{ ...safeState, ...client.actions, unreadCount, notification: notification?.userId === userId ? notification : null, clearNotification }}>{children}</SocialContext.Provider>;
}
