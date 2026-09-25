import React, { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAccount } from '../shared/account/context.js';
import { resolveAccountServer } from '../shared/account/api.js';
import { useRoute } from '../platform/router.js';
import { SocialClient, emptySocialState } from './client.js';
import { usePlatform } from '../platform/context.js';

const SocialContext = createContext(null);
export const useSocial = () => useContext(SocialContext);
const METHODS = ['refresh','searchUsers','sendRequest','acceptRequest','rejectRequest','cancelRequest','openConversation','loadOlder',
  'sendMessage','retryMessage','editMessage','deleteMessage','markRead','setTyping','removeFriend','blockUser','unblockUser','reportUser'];
export function SocialProvider({ children }) {
  const account = useAccount(); const accountRef = useRef(account); accountRef.current = account;
  const { toast } = usePlatform();
  const route = useRoute(); const clientRef = useRef(null);
  if (!clientRef.current) {
    const client = new SocialClient({ request: (path, options) => accountRef.current.requestAuthenticated(path, options), server: resolveAccountServer });
    client.actions = Object.fromEntries(METHODS.map(name => [name, client[name].bind(client)]));
    clientRef.current = client;
  }
  const client = clientRef.current;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const userId = account.signedIn && account.user?.id ? account.user.id : null;
  // Never paint one account's private data while the identity-change effect runs.
  const safeState = client.userId === userId ? state : emptySocialState();
  useEffect(() => { client.start(userId); return () => client.stop(); }, [client, userId]);
  useEffect(() => {
    const update = () => client.visibilityChanged();
    document.addEventListener('visibilitychange', update); window.addEventListener('online', update);
    const offline = () => client.update({ offline: true }); window.addEventListener('offline', offline);
    return () => { document.removeEventListener('visibilitychange', update); window.removeEventListener('online', update); window.removeEventListener('offline', offline); };
  }, [client]);
  useEffect(() => { client.selectConversation(route.name === 'friends' ? route.params.id : null); }, [client, route.path, userId]);
  const previous = useRef(null);
  useEffect(() => {
    if (!safeState.profile || safeState.loading) { previous.current = null; return; }
    const before = previous.current;
    if (before?.userId === userId) {
      const fresh = safeState.friends.find(f => f.unreadCount > (before.counts[f.id] || 0) && route.params.id !== f.id);
      if (fresh) toast(`رسالة جديدة من ${fresh.name}`);
      else if (safeState.incoming.length > before.requests) toast('وصلك طلب صداقة جديد');
    }
    previous.current = { userId, counts: Object.fromEntries(safeState.friends.map(f => [f.id, f.unreadCount])), requests: safeState.incoming.length };
  }, [safeState.friends, safeState.incoming, safeState.profile, safeState.loading, userId, route.params.id, toast]);
  const unreadCount = safeState.friends.reduce((n,f) => n+f.unreadCount, 0);
  return <SocialContext.Provider value={{ ...safeState, ...client.actions, unreadCount }}>{children}</SocialContext.Provider>;
}
