import React, { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAccount } from '../shared/account/context.js';
import { resolveAccountServer } from '../shared/account/api.js';
import { useSocial } from '../social/SocialProvider.jsx';
import { ProfilesClient, emptyProfiles } from './client.js';
import { useRoute } from '../platform/router.js';
import { createStorage } from '../shared/lib/storage.js';
import { LocalSessionRecorder } from './record-session.js';

const ProfileContext = createContext(null);
export const useProfiles = () => useContext(ProfileContext);
const METHODS = ['loadProfile', 'saveProfile', 'uploadImage', 'removeImage', 'beginSession', 'completeSession'];
export function ProfileProvider({ children }) {
  const account = useAccount(); const social = useSocial();
  const route = useRoute();
  const current = useRef({ account, social }); current.current = { account, social };
  const clientRef = useRef(null);
  if (!clientRef.current) {
    const client = new ProfilesClient({ request: (path, options) => current.current.account.requestAuthenticated(path, options),
      server: resolveAccountServer, changed: () => Promise.allSettled([current.current.account.refresh(), current.current.social?.refresh({ quiet: true })]) });
    client.actions = Object.fromEntries(METHODS.map(method => [method, client[method].bind(client)])); clientRef.current = client;
  }
  const client = clientRef.current;
  const pendingRef = useRef(null);
  if (!pendingRef.current) pendingRef.current = new LocalSessionRecorder({ storage: createStorage('profile-sessions'),
    beginSession: game => client.beginSession(game), completeSession: id => client.completeSession(id) });
  const pending = pendingRef.current;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const userId = account.signedIn ? account.user?.id || null : null;
  const ready = !!userId && client.userId === userId;
  useEffect(() => {
    client.start(userId); pending.updateOwner(userId); pending.flush().catch(() => {});
    return () => { pending.updateOwner(null); client.start(null); };
  }, [client, pending, userId]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden' && client.userId) {
        pending.flush().catch(() => {}); client.loadProfile().catch(() => {});
      }
    };
    window.addEventListener('online', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [client, pending]);
  const viewedId = route.name === 'profile' ? route.params.id || 'me' : null;
  const relation = viewedId ? [social?.friends?.some(friend => friend.id === viewedId),
    social?.incoming?.some(item => item.user.id === viewedId), social?.outgoing?.some(item => item.user.id === viewedId),
    social?.blocked?.some(user => user.id === viewedId)].join(':') : '';
  useEffect(() => {
    if (!ready || !viewedId) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') client.loadProfile(viewedId).catch(() => {}); };
    refresh(); const timer = setInterval(refresh, 30_000); return () => clearInterval(timer);
  }, [client, ready, viewedId, relation]);
  const safeState = client.userId === userId ? state : emptyProfiles();
  return <ProfileContext.Provider value={{ ...safeState, ...client.actions, ready }}>{children}</ProfileContext.Provider>;
}
