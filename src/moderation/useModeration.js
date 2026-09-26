import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useAccount } from '../shared/account/context.js';
import { ModerationClient, emptyModeration } from './client.js';

export function useModeration() {
  const account = useAccount(); const latest = useRef(account); latest.current = account;
  const clientRef = useRef(null);
  if (!clientRef.current) clientRef.current = new ModerationClient({ request: (path, options) => latest.current.requestAuthenticated(path, options) });
  const client = clientRef.current;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const userId = account.signedIn ? account.user?.id || null : null;
  useEffect(() => { client.start(userId); return () => { client.start(null); }; }, [client, userId]);
  return { state: state.userId === userId ? state : emptyModeration(), client, account };
}
