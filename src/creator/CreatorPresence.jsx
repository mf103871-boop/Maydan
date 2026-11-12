import { useEffect, useRef } from 'react';
import { useAccount } from '../shared/account/context.js';
import { creatorActivity } from './activity.js';

// Operational presence contains only navigation hints; never message text,
// room codes, drawing words, secret roles, email or device identifiers.
export function CreatorPresence({route}) {
  const account=useAccount();
  const latest=useRef({account,route}); latest.current={account,route};
  const enabled=account.ready && account.signedIn && account.me?.creator?.presence===true;
  const owner=account.user?.id;
  useEffect(() => {
    if (!enabled) return undefined;
    let active=true, busy=false, timer;
    const send=async () => {
      clearTimeout(timer);
      if (!active || document.hidden || busy) return;
      const current=latest.current;
      if (current.account.user?.id!==owner || !current.account.signedIn) return;
      const activity=creatorActivity(current.route);
      if (!activity) { timer=setTimeout(send,30000); return; }
      busy=true;
      try { await current.account.requestAuthenticated('/api/creator/presence',{method:'POST',body:activity,timeout:10000}); }
      catch { /* Presence failure never interrupts play; the TTL expires. */ }
      finally { busy=false; if(active&&!document.hidden) timer=setTimeout(send,30000); }
    };
    const visibility=()=>{clearTimeout(timer);if(!document.hidden)send();};
    document.addEventListener('visibilitychange',visibility);
    send();
    return ()=>{active=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);};
  },[enabled,owner]);
  return null;
}
