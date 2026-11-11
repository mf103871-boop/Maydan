import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton, Screen, TopBar } from '../../shared/ui/components.jsx';
import { IconBack } from '../../shared/ui/icons.jsx';
import { useAccount } from '../../shared/account/context.js';
import { entryPolicyEnabled, gameplayEntryOffer } from '../../shared/account/gameplay-policy.mjs';
import { RewardedOffer } from '../../shared/account/RewardedOffer.jsx';
import { usePlatform } from '../context.js';
import { back, getDirection, navigate } from '../router.js';
import { getGame } from '../registry.js';
import { gameModePath } from '../game-mode-navigation.js';
import { localEntryRecovery } from '../game-entry.mjs';
import { getGameModeSupport } from '../../shared/game-mode-support.mjs';
import { GameModeSheet } from './Home.jsx';
import homeStyles from './home-rebuild.css';

const readyAccess = new Set(['plus', 'trial', 'ticket']);

export function GameEntry({ id }) {
  const account = useAccount();
  // A late account/status/native reply cannot open another player's picker.
  return <Entry key={`${account.signedIn ? account.user?.id || 'loading' : 'guest'}:${id}`} id={id} account={account} />;
}

function Entry({ id, account }) {
  const game = getGame(id), offer = gameplayEntryOffer(id);
  const { sound, haptics } = usePlatform();
  const [selecting, setSelecting] = useState(false);
  const [access, setAccess] = useState(null);
  const [status, setStatus] = useState(null);
  const [desiredMode, setDesiredMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const adRequested = useRef(false), opening = useRef(false);
  const recovery = localEntryRecovery(account, id);
  const unusedGuestTrial = !account.signedIn && account.gameAccess?.(id) === 'trial';
  const onBusy = useCallback(value => { if (value) adRequested.current = true; setBusy(value); }, []);
  const onAccess = useCallback((value, next) => {
    setAccess(value); setStatus(next);
    // First free match / an existing confirmed ticket needs no extra tap.
    // A newly completed ad keeps the explicit "choose mode" confirmation.
    if (readyAccess.has(value) && !adRequested.current) setSelecting(true);
  }, []);
  useEffect(() => {
    if (!account.ready) return;
    if (account.premium || !entryPolicyEnabled(account.gameplayPolicy) || unusedGuestTrial) setSelecting(true);
  }, [account.ready, account.premium, account.gameplayPolicy, unusedGuestTrial]);
  const select = mode => {
    const target = gameModePath(id, mode);
    if (!target || opening.current || busy) return;
    if (!account.premium && entryPolicyEnabled(account.gameplayPolicy) && status?.modeAccess && !readyAccess.has(status.modeAccess[mode])) {
      adRequested.current = true; setDesiredMode(mode); setSelecting(false); setAccess(null); return;
    }
    opening.current = true;
    sound.play('whoosh'); haptics.vibrate('selection'); navigate(target);
  };
  return <Screen data-design-screen="game.entry" data-maydan-game-entry={id} dir={getDirection()} className="stack game-entry-screen" aria-label={`دخول ${game?.name || 'اللعبة'}`}>
    <style>{homeStyles}</style>
    <TopBar title={game?.name || 'اللعبة غير متاحة'} start={<IconButton label="رجوع" onClick={back} disabled={busy}><IconBack /></IconButton>} />
    {!game || !offer ? <p role="status">هذه اللعبة غير متاحة.</p> : <>
      {recovery && <section className="game-entry-recovery" aria-label="متابعة المباراة المحلية">
        <strong>{recovery.kind === 'active' ? 'مباراتك المحفوظة جاهزة للمتابعة' : 'لديك بداية مباراة قيد الاستعادة'}</strong>
        <p>{recovery.kind === 'active' ? 'تابع نفس المباراة من دون تذكرة جديدة، حتى دون اتصال.' : 'ارجع إلى نفس إعداد المباراة للتحقّق من بدايتها، دون طلب إعلان جديد.'}</p>
        <Button variant="ghost" disabled={busy} onClick={() => navigate(recovery.path)}>متابعة المباراة المحلية</Button>
      </section>}
      {!account.ready || account.signedIn && !account.user?.id ? <p role="status">جارٍ تجهيز الحساب…</p> :
        <RewardedOffer key={desiredMode || 'entry'} offer={offer.id} surface="game-entry" requiredMode={desiredMode} onAccess={onAccess} onBusy={onBusy}
          onReady={() => { if (readyAccess.has(access) && !busy) setSelecting(true); }}
          onFree={() => navigate('/')} canPresent={() => !selecting} />}
      {getGameModeSupport(id)?.online && <Button variant="ghost" disabled={busy} onClick={() => navigate(`/online/${id}?mode=online&joinOnly=1`)}>انضم إلى غرفة</Button>}
      <GameModeSheet game={selecting ? game : null} onClose={() => navigate('/')} onSelect={select} />
    </>}
  </Screen>;
}
