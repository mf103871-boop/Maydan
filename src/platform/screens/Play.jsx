// شاشة اللعب: إعداد اللاعبين/الفرق (للألعاب التي لا تدير إعدادها بنفسها) ثم مكوّن اللعبة داخل الإطار.
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Screen, TopBar, Segment } from '../../shared/ui/components.jsx';
import { PlayersSetup } from '../../shared/setup/PlayersSetup.jsx';
import { TeamsSetup } from '../../shared/setup/TeamsSetup.jsx';
import { createStorage } from '../../shared/lib/storage.js';
import { createWakeLock } from '../../shared/lib/wakeLock.js';
import { usePlatform } from '../context.js';
import { navigate, getDirection } from '../router.js';
import { getGame } from '../registry.js';
import { GameFrame } from '../GameFrame.jsx';

export function Play({ id }) {
  const game = getGame(id);
  const platform = usePlatform();
  const [stage, setStage] = useState(game && game.setup === 'self' ? 'play' : 'setup');
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [mode, setMode] = useState(game && game.players.mode === 'both' ? 'individual' : (game && game.players.mode) || 'individual');
  const [inGame, setInGame] = useState(game ? game.setup === 'self' : false);
  const [session, setSession] = useState(0);

  const storage = useMemo(() => createStorage(id), [id]);
  const wakeLock = useMemo(() => createWakeLock(), []);
  useEffect(() => { wakeLock.request(); return () => wakeLock.dispose(); }, [wakeLock]);

  const api = useMemo(() => ({
    sound: platform.sound,
    haptics: platform.haptics,
    confetti: platform.confetti,
    toast: platform.toast,
    storage,
    roster: platform.roster,
    settings: platform.settings,
    navigate,
    setInGame,
    requestExit: () => { setInGame(false); navigate('/', { replace: true }); },
    restart: () => { setSession((s) => s + 1); },
    backToSetup: () => { setInGame(false); setStage('setup'); },
  }), [platform, storage]);

  const start = useCallback((list) => {
    if (mode === 'teams') setTeams(list); else setPlayers(list);
    setInGame(true);
    setStage('play');
    setSession((s) => s + 1);
    platform.sound.play('whoosh');
  }, [mode, platform.sound]);

  if (!game) { navigate('/', { replace: true }); return null; }
  const Component = game.Component;

  return (
    <GameFrame game={game} inGame={inGame} exitMessage={game.exitMessage}>
      {stage === 'setup' ? (
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
            <PlayersSetup roster={platform.roster} setRoster={platform.setRoster} min={game.players.min} max={game.players.max} api={api} onStart={start}>
              {game.SetupOptions && <game.SetupOptions api={api} storage={storage} />}
            </PlayersSetup>
          )}
        </Screen>
      ) : (
        <Component key={session} api={api} players={players} teams={teams} mode={mode} onExit={api.requestExit} />
      )}
    </GameFrame>
  );
}
