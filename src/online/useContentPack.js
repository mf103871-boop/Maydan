import { useEffect, useState } from 'react';
import { getGameContent, loadGameContent } from '../data/game-content.js';

// The socket may restore a match before its public language asset is cached.
// Gate only rendering: reconnect ownership and the server's match keep running.
export function useContentPack(state) {
  const game = state?.game || 'meenfina', locale = state?.contentLocale || 'ar', version = state?.contentVersion;
  const needed = Boolean(state) && locale === 'en' && !['mafia','ersomha'].includes(game);
  const key = needed ? `${game}:${locale}:${version || 'new-en'}` : '';
  let available = !needed;
  if (needed) { try { getGameContent(game,locale,version);available = true; } catch { /* Loading is explicit below. */ } }
  const [result,setResult] = useState({ key:'', error:false }), [attempt,setAttempt] = useState(0);
  useEffect(() => {
    if (!needed || available) return undefined;
    let current = true;
    setResult({key,error:false});
    loadGameContent(game,locale,version).then(() => { if (current) setResult({key,error:false}); }, () => { if (current) setResult({key,error:true}); });
    return () => { current = false; };
  },[game,locale,version,key,needed,available,attempt]);
  return { ready:available, error:!available && result.key === key && result.error, retry:() => setAttempt(value => value + 1) };
}
