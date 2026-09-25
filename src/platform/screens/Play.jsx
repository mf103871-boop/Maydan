// شاشة اللعب: إعداد اللاعبين/الفرق (للألعاب التي لا تدير إعدادها بنفسها) ثم مكوّن اللعبة داخل الإطار.
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Screen, TopBar, Segment } from '../../shared/ui/components.jsx';
import { PlayersSetup } from '../../shared/setup/PlayersSetup.jsx';
import { TeamsSetup } from '../../shared/setup/TeamsSetup.jsx';
import { createStorage } from '../../shared/lib/storage.js';
import { createWakeLock } from '../../shared/lib/wakeLock.js';
import { flashScreen, stampScreen, vignette, prefersReducedMotion, wait } from '../../shared/fx/index.js';
import { usePlatform } from '../context.js';
import { useAccount } from '../../shared/account/context.js';
import { useProfiles } from '../../profiles/ProfileProvider.jsx';
import { LocalSessionRecorder } from '../../profiles/record-session.js';
import { navigate, getDirection } from '../router.js';
import { getGame } from '../registry.js';
import { GameFrame } from '../GameFrame.jsx';
import { MissingGame } from './GameDetails.jsx';
import { GameLoading, useVisualReadiness } from './Splash.jsx';

// طبقات التأثير المشتركة تُمرَّر للألعاب عبر api.fx (اختصار؛ الاستيراد المباشر من shared/fx هو العقد).
const FX = { flash: flashScreen, stamp: stampScreen, vignette, reduced: prefersReducedMotion, wait };

export function Play({ id }) {
  const game = getGame(id);
  const platform = usePlatform();
  const account = useAccount();
  const profiles = useProfiles();
  const profilesRef = useRef(profiles); profilesRef.current = profiles;
  const recorderRef = useRef(null);
  if (!recorderRef.current) recorderRef.current = new LocalSessionRecorder({
    storage: createStorage('profile-sessions'),
    beginSession: (gameId) => profilesRef.current.beginSession(gameId),
    completeSession: (sessionId) => profilesRef.current.completeSession(sessionId),
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
  const [session, setSession] = useState(0);
  const [savedSession, setSavedSession] = useState(null);
  const [gameOptions, setGameOptions] = useState(null);
  const [setupValid, setSetupValid] = useState(true);
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

  const storage = useMemo(() => createStorage(id), [id]);
  const wakeLock = useMemo(() => createWakeLock(), []);
  useEffect(() => { wakeLock.request(); return () => wakeLock.dispose(); }, [wakeLock]);

  const api = useMemo(() => ({
    // الحساب والاستحقاقات: اللعبة تقرأ api.account، وتعلن انتهاء مباراة كاملة بـ api.matchOver().
    account,
    matchStart: () => recorder.start(id),
    matchSnapshot: () => recorder.marker(),
    matchResume: (marker) => recorder.resume(marker, id),
    matchOver: ({ completed = false } = {}) => { account.markTrial(id); recorder.complete(completed); },
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
    setGameOptions,
    setExitMessage,
    setBeforeExit: (handler) => setBeforeExit(() => handler),
    resumeGame: (saved) => {
      recorder.resume(saved.profileSession, id);
      setPlayers(saved.players); setGameOptions(saved.settings || null); setSavedSession(saved); setInGame(true);
      setStage('play'); setSession((s) => s + 1);
      raiseCurtain();
    },
    requestExit: () => { setInGame(false); navigate('/', { replace: true }); },
    restart: () => { recorder.start(id); setSavedSession(null); setSession((s) => s + 1); raiseCurtain(); },
    backToSetup: () => { setInGame(false); setSavedSession(null); setStage('setup'); setSetupValid(true); raiseCurtain(); },
  }), [platform, storage, raiseCurtain, account, id]);

  const start = useCallback((list) => {
    // حراسة دفاعية: لعبة استُهلكت مباراتها المجانية لا تبدأ من الإعداد إلا بـ«ميدان بلس»
    // (بَديهة setup:'self' لا تمرّ من هنا أصلًا، وقفلها في الحزم لا في المباراة).
    if (account.gameAccess(id) === 'locked') { account.openPaywall({ reason: 'trial', game: id }); return; }
    recorder.start(id);
    setSavedSession(null);
    if (mode === 'teams') setTeams(list); else setPlayers(list);
    setInGame(true);
    setStage('play');
    setSession((s) => s + 1);
    platform.sound.play('whoosh');
    raiseCurtain();
  }, [mode, platform.sound, raiseCurtain, account, id]);

  if (!game) return <MissingGame id={id} />;
  const Component = game.Component;

  return (
    <GameFrame game={game} inGame={ready && inGame} exitMessage={exitMessage || game.exitMessage} beforeExit={beforeExit}>
      {!ready ? <GameLoading game={game} progress={progress} /> : stage === 'setup' ? (
        <Screen dir={getDirection()} className="stack" style={{ '--game-accent': game.accent }} aria-label={`إعداد ${game.name}`}>
          <TopBar title="من يلعب؟" eyebrow={game.name} />
          {game.players.mode === 'both' && (
            <Segment label="نمط اللعب" accent value={mode} onChange={(v) => { setMode(v); platform.sound.play('click'); }} options={[{ value: 'individual', label: 'فردي' }, { value: 'teams', label: 'فرق' }]} />
          )}
          {mode === 'teams' ? (
            <TeamsSetup min={Math.max(2, game.players.mode === 'teams' ? game.players.min : 2)} max={Math.min(4, game.players.mode === 'teams' ? game.players.max : 4)} api={api} onStart={start}>
              {game.SetupOptions && <game.SetupOptions api={api} storage={storage} />}
            </TeamsSetup>
          ) : (
            <PlayersSetup roster={platform.roster} setRoster={platform.setRoster} min={game.players.min} max={game.players.max} api={api} onStart={start} startDisabled={!setupValid}>
              {game.SetupOptions && <game.SetupOptions api={api} storage={storage} />}
            </PlayersSetup>
          )}
        </Screen>
      ) : (
        <Component key={session} api={api} players={players} teams={teams} mode={mode} savedSession={savedSession} gameOptions={gameOptions} onExit={api.requestExit} />
      )}
      {curtain > 0 && <div key={`curtain-${curtain}`} className="game-curtain" aria-hidden="true" />}
    </GameFrame>
  );
}
