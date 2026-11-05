import React, { useEffect, useState } from 'react';
import { useAccount } from '../../shared/account/context.js';
import { navigate } from '../../platform/router.js';
import { useProfiles } from '../ProfileProvider.jsx';
import { getProgressionFrame } from '../progression-catalog.js';
import { ProgressionMatchSummary, ProgressionStyles } from './ProgressionProfile.jsx';

// Read-only presentation of a server-owned receipt. This component cannot
// award XP and cannot infer a result from the score or from a client clock.
export function MatchProgression({ eventId, ownerId, notBefore, clockOffset = 0 }) {
  const account = useAccount();
  const profiles = useProfiles();
  const canRead = Boolean(account.signedIn && ownerId && account.user?.id === ownerId
    && /^(?:online|local):[a-f0-9-]{36}$/.test(eventId || ''));
  const [record, setRecord] = useState(null);
  const [retry, setRetry] = useState(0);
  const load = profiles?.loadProgressionReceipt;
  useEffect(() => {
    if (!canRead || !load) return;
    const controller = new AbortController();
    let timer;
    let attempt = 0;
    const read = async () => {
      try {
        const result = await load(eventId, controller.signal);
        if (controller.signal.aborted) return;
        if (result?.status === 'settled' && Number.isSafeInteger(result.awardedXp) && result.awardedXp >= 0) {
          setRecord({ ownerId, eventId, result });
          return;
        }
        if (result?.status === 'pending' && ++attempt < 5) {
          timer = setTimeout(read, 1500 * 2 ** (attempt - 1));
          return;
        }
        setRecord({ ownerId, eventId, retry: true });
      } catch {
        if (!controller.signal.aborted) setRecord({ ownerId, eventId, retry: true });
      }
    };
    timer = setTimeout(read, Math.max(0, (notBefore || 0) - (Date.now() + clockOffset)));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [canRead, clockOffset, eventId, load, notBefore, ownerId, retry]);

  if (!canRead || !load) return null;
  const current = record?.ownerId === ownerId && record.eventId === eventId ? record : null;
  if (!current?.result) return <p className="online-notice" role="status">
    {current?.retry ? <button type="button" className="btn btn-ghost" onClick={() => { setRecord(null); setRetry(value => value + 1); }}>تحديث تقدّم المباراة</button> : 'نجهّز تقدّمك…'}
  </p>;
  const reward = getProgressionFrame(current.result.nextReward?.itemId);
  return <><ProgressionStyles /><ProgressionMatchSummary xpEarned={current.result.awardedXp}
    nextReward={reward} onOpen={() => navigate('/profile')} /></>;
}
