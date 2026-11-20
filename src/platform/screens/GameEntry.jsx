import { tr } from '../../shared/i18n/core.js';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, IconButton, Screen, TopBar } from '../../shared/ui/components.jsx';
import { IconBack } from '../../shared/ui/icons.jsx';
import { useAccount } from '../../shared/account/context.js';
import { gameplayEntryOffer } from '../../shared/account/gameplay-policy.mjs';
import { RewardedOffer } from '../../shared/account/RewardedOffer.jsx';
import { rewardedEntryStatus } from '../../shared/account/rewarded.js';
import { usePlatform } from '../context.js';
import { back, getDirection, navigate } from '../router.js';
import { getGame } from '../registry.js';
import { gameModePath } from '../game-mode-navigation.js';
import { gameEntryPolicyState, localEntryRecovery } from '../game-entry.mjs';
import { getGameModeSupport } from '../../shared/game-mode-support.mjs';
import { GameModeSheet } from './Home.jsx';
import homeStyles from './home-rebuild.css';
import entryStyles from '../../shared/account/rewarded-entry.css';
import { MenuGameIcon } from '../MenuGameIcon.jsx';
import { getPlayfulSceneArt } from '../../shared/brand/playful-scenes.js';
import { useI18n } from '../../shared/i18n/react.jsx';
import { gameName } from '../../shared/i18n/core.js';

const readyAccess = new Set(['plus', 'trial', 'ticket']);
const visible = () => typeof document === 'undefined' || !document.hidden;

export function GameEntry({ id }) {
  const account = useAccount();
  const policy = gameEntryPolicyState(account, true);
  const unusedGuestTrial = !account.signedIn && account.gameAccess?.(id) === 'trial';
  // Readiness/revocation changes retire the picker and every late callback.
  const scope = [account.signedIn ? account.user?.id || 'loading' : 'guest', id,
    policy, account.ready, account.premium, Boolean(account.trials?.[id]), unusedGuestTrial].join(':');
  return <Entry key={scope} {...{ id, account, policy, unusedGuestTrial }} />;
}

function Entry({ id, account, policy, unusedGuestTrial }) {
  const { locale } = useI18n();
  const game = getGame(id), offer = gameplayEntryOffer(id);
  const { sound, haptics } = usePlatform();
  const [selecting, setSelecting] = useState(false);
  const [eligibility, setEligibility] = useState(null);
  const [desiredMode, setDesiredMode] = useState(null);
  const [adBusy, setAdBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [generation, setGeneration] = useState(0);
  const epoch = useRef(0), alive = useRef(false), opening = useRef(false);
  const adActive = useRef(false), deferredRefresh = useRef(false);
  const recovery = localEntryRecovery(account, id);
  const bypass = account.ready && policy !== 'pending' && (account.premium || unusedGuestTrial || policy === 'free' || policy === 'legacy');
  const current = eligibility?.epoch === epoch.current ? eligibility : null;
  const busy = adBusy || checking;
  const maySelect = bypass || readyAccess.has(current?.access);
  const picker = visible() && (bypass || selecting && maySelect);
  const invalidate = useCallback((refresh = true) => {
    epoch.current++;
    setEligibility(null); setSelecting(false); setChecking(false); opening.current = false;
    if (refresh) setGeneration(epoch.current);
  }, []);
  useLayoutEffect(() => {
    const generations = epoch;
    alive.current = true;
    return () => { alive.current = false; generations.current++; };
  }, []);
  useEffect(() => {
    const wake = () => {
      if (adActive.current) {
        deferredRefresh.current = true; setEligibility(null); setSelecting(false); return;
      }
      invalidate(visible());
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake); window.addEventListener('focus', wake);
    return () => { document.removeEventListener('visibilitychange', wake); window.removeEventListener('pageshow', wake); window.removeEventListener('focus', wake); };
  }, [invalidate]);
  const onBusy = useCallback(value => {
    if (!alive.current) return;
    adActive.current = value; setAdBusy(value);
    if (!value && deferredRefresh.current) { deferredRefresh.current = false; invalidate(); }
  }, [invalidate]);
  const onAccess = useCallback((access, status) => {
    if (!alive.current || generation !== epoch.current || !visible()) return;
    setEligibility({ epoch: generation, access, status });
    if (!readyAccess.has(access)) setSelecting(false);
    // Eligibility is an offer, not navigation. Trial/ticket waits for Continue.
  }, [generation]);
  const select = async mode => {
    const target = gameModePath(id, mode);
    if (!target || opening.current || busy || !visible() || !maySelect) return;
    opening.current = true;
    const issuedEpoch = epoch.current;
    let navigated = false;
    try {
      if (!bypass) {
        setChecking(true);
        const fresh = await rewardedEntryStatus(account, id);
        if (!alive.current || epoch.current !== issuedEpoch || !visible()) return;
        if (!readyAccess.has(fresh.modeAccess?.[mode])) {
          setDesiredMode(readyAccess.has(fresh.access) ? mode : null);
          invalidate(); return;
        }
      }
      navigated = true;
      sound.play('whoosh'); haptics.vibrate('selection'); navigate(target);
    } catch {
      if (alive.current && epoch.current === issuedEpoch) invalidate();
    } finally {
      if (alive.current && epoch.current === issuedEpoch) {
        setChecking(false);
        if (!navigated) opening.current = false;
      }
    }
  };
  const joinAction = getGameModeSupport(id)?.online ? <Button data-design-id="join-room" className="game-entry-join" variant="ghost" full disabled={busy} onClick={() => navigate(`/online/${id}?mode=online&joinOnly=1`)}>{tr("انضم إلى غرفة")}</Button> : null;
  return <Screen data-design-screen="game.entry" data-maydan-game-entry={id} dir={getDirection()} className="stack game-entry-screen" aria-label={tr("دخول {v0}", {v0: game ? gameName(game, locale) : tr("اللعبة")})}>
    <style>{homeStyles}{entryStyles}</style>
    <TopBar data-design-id="topbar" title={game ? tr("دخول {v0}", {v0:gameName(game,locale)}) : tr("اللعبة غير متاحة")} start={<IconButton data-design-id="back" label={tr("رجوع")} onClick={back} disabled={busy}><IconBack /></IconButton>} />
    {!game || !offer ? <p role="status">{tr("هذه اللعبة غير متاحة.")}</p> : <>
      {recovery && <section data-design-id="local-recovery" className="game-entry-recovery" aria-label={tr("متابعة المباراة المحلية")}>
        <div className="game-entry-recovery-art" aria-hidden="true"><img src={getPlayfulSceneArt('resume',128)} width="128" height="128" alt=""/><MenuGameIcon id={game.id}/></div>
        <strong>{recovery.kind === 'active' ? tr("مباراتك المحفوظة جاهزة للمتابعة") : tr("لديك بداية مباراة قيد الاستعادة")}</strong>
        <p>{recovery.kind === 'active' ? tr("تابع نفس المباراة من دون تذكرة جديدة، حتى دون اتصال.") : tr("ارجع إلى نفس إعداد المباراة للتحقّق من بدايتها، دون طلب إعلان جديد.")}</p>
        <Button data-design-id="resume-local" variant="primary" full disabled={busy} onClick={() => navigate(recovery.path)}>{tr("متابعة المباراة المحلية")}</Button>
      </section>}
      {policy === 'pending' || !account.ready || account.signedIn && !account.user?.id ? <><p role="status">{tr("جارٍ التحقق من أهلية المباراة…")}</p>{joinAction}</> :
        <RewardedOffer key={`${generation}:${desiredMode || 'entry'}`} offer={offer.id} surface="game-entry" compact={Boolean(recovery)} joinAction={joinAction} requiredMode={desiredMode} onAccess={onAccess} onBusy={onBusy}
          onReady={() => { if (maySelect && !busy && visible()) setSelecting(true); }}
          onFree={() => navigate('/')} canPresent={() => !picker} />}
      <GameModeSheet game={picker ? game : null} disabled={busy} onClose={() => navigate('/')} onSelect={select} />
    </>}
  </Screen>;
}
