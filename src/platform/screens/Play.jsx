import { tr } from '../../shared/i18n/core.js';
// شاشة اللعب: إعداد اللاعبين/الفرق (للألعاب التي لا تدير إعدادها بنفسها) ثم مكوّن اللعبة داخل الإطار.
import React, { useMemo, useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { socialInterruption } from '../../social/interruption.js';
import { Button, Screen, TopBar, Segment } from '../../shared/ui/components.jsx';
import { PlayersSetup } from '../../shared/setup/PlayersSetup.jsx';
import { TeamsSetup } from '../../shared/setup/TeamsSetup.jsx';
import { createStorage } from '../../shared/lib/storage.js';
import { environmentStorageKey } from '../../shared/lib/environment.js';
import { createWakeLock } from '../../shared/lib/wakeLock.js';
import { flashScreen, stampScreen, vignette, prefersReducedMotion, wait } from '../../shared/fx/index.js';
import { usePlatform } from '../context.js';
import { useAccount } from '../../shared/account/context.js';
import { useProfiles } from '../../profiles/ProfileProvider.jsx';
import { LocalSessionRecorder } from '../../profiles/record-session.js';
import { MatchProgression } from '../../profiles/progression/MatchProgression.jsx';
import { navigate, getDirection } from '../router.js';
import { getGame } from '../registry.js';
import { GameFrame } from '../GameFrame.jsx';
import { MissingGame } from './GameDetails.jsx';
import { GameLoading, useVisualReadiness } from './Splash.jsx';
import { createLocalMatchAudio } from '../../shared/fx/match-audio.js';
import { LOCAL_REWARDED_OFFER, REWARDED_PREVIEW, rewardedStart, rewardEvent } from '../../shared/account/rewarded.js';
import { LocalGameplayAccess } from '../../shared/account/local-gameplay-access.mjs';
import { gameplayOffer } from '../../shared/account/gameplay-policy.mjs';
import { RewardedOffer } from '../../shared/account/RewardedOffer.jsx';
import { contentStorage, readSavedContentIdentity } from '../../shared/lib/content-storage.js';
import { contentVersionFor } from '../../shared/content-locale.mjs';
import { gameName } from '../../shared/i18n/core.js';
import { loadGameContent } from '../../data/game-content.js';

// طبقات التأثير المشتركة تُمرَّر للألعاب عبر api.fx (اختصار؛ الاستيراد المباشر من shared/fx هو العقد).
const FX = { flash: flashScreen, stamp: stampScreen, vignette, reduced: prefersReducedMotion, wait };

export function Play({ id, rewarded = false }) {
  const game = getGame(id);
  const platform = usePlatform();
  const preferences = useMemo(() => createStorage(id), [id]);
  const [contentLocale, setContentLocale] = useState(() => preferences.get('match-content-locale', 'ar') === 'en' ? 'en' : 'ar');
  const contentVersion = contentVersionFor(contentLocale);
  const contentKey = `${id}:${contentLocale}:${contentVersion}`;
  const [pack, setPack] = useState({key:contentKey,ready:contentLocale==='ar',error:false});
  const [packAttempt, setPackAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    loadGameContent(id,contentLocale,contentVersion).then(() => {
      if (active) setPack({key:contentKey,ready:true,error:false});
    }).catch(() => {
      if (active) setPack({key:contentKey,ready:false,error:true});
    });
    return () => { active=false; };
  },[id,contentLocale,contentVersion,contentKey,packAttempt]);
  const contentReady = pack.key===contentKey && pack.ready;
  const account = useAccount();
  const demo = REWARDED_PREVIEW && rewarded && id === 'badeeha';
  const accountRef = useRef(account);
  accountRef.current = account;
  const accessStore = useMemo(() => createStorage(environmentStorageKey(`maydan:gameplay:${id}:`)), [id]);
  const access = useMemo(() => new LocalGameplayAccess({ game: id, storage: accessStore,
    getAccount: () => accountRef.current, start: rewardedStart }), [id, accessStore]);
  const [accessPrompt, setAccessPrompt] = useState(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const promptRef = useRef(null);
  const authorizingRef = useRef(false);
  const cancelAccess = useCallback(() => {
    promptRef.current?.resolve(false); promptRef.current = null; setAccessPrompt(null);
  }, []);
  const authorizeMatch = useCallback(async (options = {}) => {
    if (promptRef.current || authorizingRef.current) return false;
    authorizingRef.current = true;
    const owner = accountRef.current.signedIn ? accountRef.current.user?.id : 'guest';
    try {
      setAccessBusy(true);
      const result = await access.authorize(options);
      setAccessBusy(false);
      if ((accountRef.current.signedIn ? accountRef.current.user?.id : 'guest') !== owner) return false;
      if (result.ready) return true;
      return await new Promise(resolve => {
        promptRef.current = { resolve, options };
        setAccessPrompt(result);
      });
    } finally { authorizingRef.current = false; }
  }, [access]);
  const retryAccess = useCallback(async () => {
    const prompt = promptRef.current;
    if (!prompt || accessBusy) return;
    setAccessBusy(true);
    const result = await access.authorize(prompt.options);
    setAccessBusy(false);
    if (promptRef.current !== prompt) return;
    if (!result.ready) { setAccessPrompt(result); return; }
    promptRef.current = null; setAccessPrompt(null); prompt.resolve(true);
  }, [access, accessBusy]);
  const profiles = useProfiles();
  const [progressionReceipt, setProgressionReceipt] = useState(null);
  const profilesRef = useRef(profiles); profilesRef.current = profiles;
  const recorderRef = useRef(null);
  if (!recorderRef.current) recorderRef.current = new LocalSessionRecorder({
    storage: createStorage(environmentStorageKey('maydan:profile-sessions:')),
    beginSession: (gameId) => profilesRef.current.beginSession(gameId),
    completeSession: (sessionId) => profilesRef.current.completeSession(sessionId),
    onRecorded: (marker, result) => {
      if (result.progressionEventId) setProgressionReceipt({
        key: marker.key, ownerId: marker.ownerUserId, eventId: result.progressionEventId,
      });
    },
  });
  const recorder = recorderRef.current;
  const owner = account.signedIn ? account.user?.id || null : null;
  recorder.updateOwner(owner);
  useEffect(() => {
    const flush = () => recorder.flush().catch(() => {});
    flush(); window.addEventListener('online', flush);
    return () => { window.removeEventListener('online', flush); recorder.stop(); };
  }, [recorder, owner]);
  const { ready, progress } = useVisualReadiness();
  const [stage, setStage] = useState(game && game.setup === 'self' ? 'play' : 'setup');
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [mode, setMode] = useState(game && game.players.mode === 'both' ? 'individual' : (game && game.players.mode) || 'individual');
  const [inGame, setInGame] = useState(game ? game.setup === 'self' : false);
  const interruption = useSyncExternalStore(socialInterruption.subscribe, socialInterruption.getSnapshot, socialInterruption.getSnapshot);
  useEffect(() => { socialInterruption.setContext({ local: inGame && !accessPrompt, online: false, turnDeadline: null });
    return () => socialInterruption.setContext({ local: false }); }, [inGame, accessPrompt]);
  useEffect(() => () => { access.clear(); promptRef.current?.resolve(false); promptRef.current = null; }, [access, owner]);
  useEffect(() => { setAccessPrompt(null); }, [owner]);
  const [session, setSession] = useState(0);
  const matchOwner = useRef(owner);
  useEffect(() => {
    if (matchOwner.current === owner) return;
    matchOwner.current = owner;
    if (!accountRef.current.gameplayPolicy) return;
    cancelAccess(); access.clear();
    setInGame(false); setSavedSession(null); setGameOptions(null);
    setStage(game?.setup === 'self' ? 'play' : 'setup'); setSession(value => value + 1);
  }, [owner, access, cancelAccess, game]);
  const matchAudio = useMemo(() => createLocalMatchAudio(platform.sound, id, `${owner || 'guest'}:${session}`), [platform.sound, id, owner, session]);
  useEffect(() => { matchAudio.activate(); return () => matchAudio.dispose(); }, [matchAudio]);
  const musicOwner = useRef(Symbol('local-game-audio'));
  // مقطع اللعبة يبدأ مع المباراة (وعند إعادتها)، وشاشة الإعداد تبقى على مقطع «البيت».
  useEffect(() => {
    if (!game) return;
    platform.sound.music.scene(musicOwner.current, stage === 'play' && inGame ? id : 'home', stage, 10);
  }, [platform.sound, game, id, stage, inGame, session]);
  useEffect(() => { const lease = musicOwner.current; return () => platform.sound.music.releaseScene(lease); }, [platform.sound]);
  const [savedSession, setSavedSession] = useState(null);
  const [gameOptions, setGameOptions] = useState(null);
  const [setupValid, setSetupValid] = useState(true);
  const [selfSetupActive, setContentSetupActive] = useState(false);
  const [exitMessage, setExitMessage] = useState(null);
  const [beforeExit, setBeforeExit] = useState(null);
  // وهج أطراف عند البدء/الإعادة: لا يغطي اللعب ولا يُصيَّر تحت تقليل الحركة.
  const [curtain, setCurtain] = useState(0);
  const curtainTimer = useRef(0);
  const raiseCurtain = useCallback(() => {
    if (prefersReducedMotion()) return;
    setCurtain((c) => c + 1);
    clearTimeout(curtainTimer.current);
    curtainTimer.current = setTimeout(() => setCurtain(0), wait(240));
  }, []);
  useEffect(() => () => clearTimeout(curtainTimer.current), []);

  const storage = useMemo(() => contentStorage(id, { contentLocale, contentVersion }), [id, contentLocale, contentVersion]);
  const wakeLock = useMemo(() => createWakeLock(), []);
  useEffect(() => { wakeLock.request(); return () => wakeLock.dispose(); }, [wakeLock]);

  const api = useMemo(() => ({
    // الحساب والاستحقاقات: اللعبة تقرأ api.account، وتعلن انتهاء مباراة كاملة بـ api.matchOver().
    account,
    contentLocale,
    contentVersion,
    ...(demo && owner ? { rewarded: {
      owner,
      start: (matchId) => {
        if (accountRef.current.user?.id !== owner) throw new Error('Account changed');
        return rewardedStart(accountRef.current, matchId);
      },
    } } : {}),
    authorizeMatch,
    matchStart: () => { access.activate(); matchAudio.begin(); return recorder.start(id); },
    matchSnapshot: () => {
      const marker = recorder.marker(), gameplayAccess = access.snapshot();
      return { ...marker, ...(gameplayAccess ? { gameplayAccess } : {}), contentLocale, contentVersion };
    },
    matchResume: (marker) => { access.activate(); matchAudio.begin(); return recorder.resume(marker, id); },
    // احتفال واحد للمباراة المكتملة؛ الانسحاب أو الإلغاء لا يشغّل صوت الفوز.
    matchOver: ({ completed = false } = {}) => { if (demo && completed) rewardEvent(LOCAL_REWARDED_OFFER, 'finish'); if (completed) access.complete(); recorder.complete(completed); matchAudio.complete(completed); platform.sound.music.play('home'); },
    sound: platform.sound,
    haptics: platform.haptics,
    confetti: platform.confetti,
    toast: platform.toast,
    fx: FX,
    storage,
    roster: platform.roster,
    settings: platform.settings,
    navigate,
    setInGame,
    setSetupValid,
    setContentSetupActive,
    setGameOptions,
    setExitMessage,
    setBeforeExit: (handler) => setBeforeExit(() => handler),
    resumeGame: async (saved) => {
      let identity;
      try { identity = readSavedContentIdentity(saved); await loadGameContent(id,identity.contentLocale,identity.contentVersion); }
      catch { platform.toast(tr('نسخة محتوى هذه المباراة غير متاحة.')); return; }
      if (!await authorizeMatch({ resume: saved })) return;
      setContentLocale(identity.contentLocale);
      access.activate();
      recorder.resume(saved.profileSession, id);
      // ممنوع تُلعب بفرق: اللقطة تحمل teams بدل players، والنمط يعود إلى «فرق».
      if (Array.isArray(saved.teams)) { setTeams(saved.teams); setMode('teams'); } else setPlayers(saved.players);
      setGameOptions(saved.settings || null); setSavedSession(saved); setInGame(true);
      setStage('play'); setSession((s) => s + 1);
      raiseCurtain();
    },
    requestExit: () => { setInGame(false); navigate('/', { replace: true }); },
    restart: () => {
      access.complete();
      if (accountRef.current.gameplayPolicy) { setInGame(false); setSavedSession(null); setStage('setup'); setSetupValid(true); raiseCurtain(); return; }
      recorder.start(id); setSavedSession(null); setSession((s) => s + 1); raiseCurtain();
    },
    backToSetup: () => { setInGame(false); setSavedSession(null); setStage('setup'); setSetupValid(true); raiseCurtain(); },
  }), [platform, storage, raiseCurtain, account, id, recorder, matchAudio, demo, owner, access, authorizeMatch, contentLocale, contentVersion]);

  const start = useCallback(async (list) => {
    if (!contentReady) return;
    if (!await authorizeMatch()) return;
    access.activate();
    recorder.start(id);
    setSavedSession(null);
    if (mode === 'teams') setTeams(list); else setPlayers(list);
    setInGame(true);
    setStage('play');
    setSession((s) => s + 1);
    platform.sound.play('whoosh');
    raiseCurtain();
  }, [mode, platform.sound, raiseCurtain, id, recorder, access, authorizeMatch, contentReady]);

  if (!game) return <MissingGame id={id} />;
  if (demo && !owner) return <Screen className="stack" aria-label={tr("تحدّي اللمّة التجريبي")}>
    <TopBar title={tr("تحدّي بديهة التجريبي")} />
    <p role="status">{account.ready ? tr("سجّل الدخول لبدء التجربة أو استئنافها.") : tr("جارٍ التحقق من الحساب…")}</p>
    <Button onClick={() => navigate('/game/badeeha?mode=local', { replace: true })}>{tr("العودة إلى بديهة")}</Button>
    <Button onClick={() => navigate('/play/badeeha?mode=local', { replace: true })}>{tr("العب بديهة المجانية")}</Button>
  </Screen>;
  const Component = game.Component;

  return (
    <GameFrame game={game} inGame={ready && contentReady && inGame} exitMessage={exitMessage || game.exitMessage} beforeExit={beforeExit}>
      {ready && (stage === 'setup' || game.setup === 'self' && selfSetupActive) && !inGame && !accessPrompt && <section className="studio-local-language"><label htmlFor="local-content-locale">{tr('لغة المباراة')}</label><select id="local-content-locale" value={contentLocale} disabled={accessBusy} onChange={event => { const next = event.target.value; preferences.set('match-content-locale', next); setContentLocale(next); setSavedSession(null); setGameOptions(null); }}><option value="ar" lang="ar">{tr("العربية")}</option><option value="en" lang="en">English</option></select><small>{tr('لغة القوائم مستقلة عن لغة المباراة.')}</small></section>}
      <div inert={interruption.paused || Boolean(accessPrompt) || accessBusy || undefined} aria-hidden={interruption.paused || Boolean(accessPrompt) || undefined} style={interruption.paused || accessPrompt ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
      {!ready ? <GameLoading game={game} progress={progress} /> : !contentReady ? <section className="stack" style={{padding:24}}><p role={pack.error?'alert':'status'}>{pack.key===contentKey&&pack.error?tr('تعذّر تحميل محتوى المباراة. محفوظاتك لم تتغير.'):tr('جارٍ تحميل محتوى المباراة…')}</p>{pack.key===contentKey&&pack.error&&<Button onClick={()=>{setPack({key:contentKey,ready:false,error:false});setPackAttempt(value=>value+1);}}>{tr('إعادة المحاولة')}</Button>}</section> : stage === 'setup' ? (
        <Screen dir={getDirection()} className="stack" style={{ '--game-accent': game.accent }} aria-label={tr('إعداد {game}', {game:gameName(game)})}>
          <TopBar title={tr("من يلعب؟")} eyebrow={gameName(game)} />
          {game.players.mode === 'both' && (
            <Segment label={tr("نمط اللعب")} accent value={mode} onChange={(v) => setMode(v)} options={[{ value: 'individual', label: tr("فردي") }, { value: 'teams', label: tr("فرق") }]} />
          )}
          {mode === 'teams' ? (
            <TeamsSetup min={Math.max(2, game.players.mode === 'teams' ? game.players.min : 2)} max={Math.min(4, game.players.mode === 'teams' ? game.players.max : 4)} api={api} onStart={start}>
              {game.SetupOptions && <game.SetupOptions key={contentLocale} api={api} storage={storage} />}
            </TeamsSetup>
          ) : (
            <PlayersSetup roster={platform.roster} setRoster={platform.setRoster} min={game.players.min} max={game.players.max} api={api} onStart={start} startDisabled={!setupValid}>
              {game.SetupOptions && <game.SetupOptions key={contentLocale} api={api} storage={storage} />}
            </PlayersSetup>
          )}
        </Screen>
      ) : (
        <><Component key={`${contentLocale}:${demo || account.gameplayPolicy ? `${owner}:${session}` : session}`} api={api} players={players} teams={teams} mode={mode} savedSession={savedSession} gameOptions={gameOptions} onExit={api.requestExit} />
          {progressionReceipt && progressionReceipt.ownerId === owner && progressionReceipt.key === recorder.marker()?.key &&
            <MatchProgression key={progressionReceipt.eventId} {...progressionReceipt} />}</>
      )}
      </div>
      {accessPrompt && <section className="stack" aria-label={tr("أهلية بدء المباراة")} style={{ position: 'fixed', inset: 0, zIndex: 75, overflowY: 'auto', padding: 'max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom))', background: 'var(--bg, #fff8eb)' }}>
        <RewardedOffer offer={gameplayOffer(id, 'local')?.id} surface="local-start" onReady={retryAccess} onFree={cancelAccess} canPresent={() => !accessBusy} />
        {accessPrompt.reason === 'pending' && <p role="status">{tr("قد يكون بدء المباراة تأكد بالفعل. أعد التحقق من البداية نفسها؛ لن نطلب تذكرة ثانية.")}</p>}
        {accessPrompt.reason === 'storage' && <p role="alert">{tr("تعذّر حفظ نقطة استعادة آمنة. أتح التخزين المحلي قبل بدء المباراة.")}</p>}
        {accessPrompt.reason === 'account' && <p role="alert">{tr("هذه المباراة المحفوظة مرتبطة بحساب آخر. ارجع إلى الإعداد أو ادخل بحسابها.")}</p>}
      </section>}
      {accessBusy && <p role="status" style={{ position: 'fixed', insetInline: 16, bottom: 24, zIndex: 80 }}>{tr("جارٍ التحقق من بدء المباراة…")}</p>}
      {interruption.paused && <div className="stack center" role="status" style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'var(--bg, #fff8eb)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', justifyContent: 'center', padding: 24 }}>
        <h2>{tr("اللعبة بانتظاركم")}</h2><p>{tr("الوقت متوقف والمحتوى مخفي. سلّم الهاتف للاعب قبل المتابعة.")}</p>
        <button className="btn accent" style={{ width: 'min(100%, 320px)', minHeight: 48 }} disabled={interruption.open} onClick={() => socialInterruption.resume()}>{tr("متابعة اللعب")}</button>
      </div>}
      {curtain > 0 && <div key={`curtain-${curtain}`} className="game-curtain" aria-hidden="true" />}
    </GameFrame>
  );
}
