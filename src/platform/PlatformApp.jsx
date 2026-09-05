// غلاف المنصة: المزوّدون (صوت/اهتزاز/تخزين/دفتر اللاعبين/إعدادات)، الموجّه، وانتقالات الشاشات.
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { PlatformContext } from './context.js';
import { useRoute, navigate, getDirection } from './router.js';
import { createStorage } from '../shared/lib/storage.js';
import { createSound } from '../shared/fx/sound.js';
import { createHaptics } from '../shared/fx/haptics.js';
import { confetti } from '../shared/fx/confetti.js';
import { ToastProvider, useToast } from '../shared/ui/components.jsx';
import uiCss from '../shared/ui/ui.css';
import setupCss from '../shared/setup/setup.css';
import platformCss from './platform.css';
import { Splash } from './screens/Splash.jsx';
import { Home } from './screens/Home.jsx';
import { GameDetails } from './screens/GameDetails.jsx';
import { Play } from './screens/Play.jsx';
import { Players } from './screens/Players.jsx';
import { Settings } from './screens/Settings.jsx';
import { About } from './screens/About.jsx';

export const VERSION = typeof __MAYDAN_VERSION__ !== 'undefined' ? __MAYDAN_VERSION__ : '1.0.0';
const platformStorage = createStorage('platform');
const DEFAULT_SETTINGS = { soundOn: true, hapticsOn: true, reducedMotion: false, splashSeen: false };

function ScreenHost({ route }) {
  // انتقال الخروج: لقطة ثابتة من الشاشة السابقة تنزلق وتتلاشى فوق الشاشة الجديدة.
  const hostRef = useRef(null);
  const ghostRef = useRef(null);
  const lastPath = useRef(route.path);
  useEffect(() => {
    if (lastPath.current === route.path) return;
    lastPath.current = route.path;
    const host = hostRef.current;
    const reduced = document.documentElement.dataset.reducedMotion === 'true';
    if (!host || reduced || !ghostRef.current) return;
    const ghost = ghostRef.current;
    ghost.innerHTML = host.dataset.snapshot || '';
    ghost.dataset.dir = getDirection();
    ghost.hidden = !ghost.innerHTML;
    const t = setTimeout(() => { ghost.innerHTML = ''; ghost.hidden = true; }, 260);
    return () => clearTimeout(t);
  }, [route.path]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    // خزّن لقطة DOM الحالية قبل كل تغيير مسار
    const snap = () => { try { host.dataset.snapshot = host.firstElementChild ? host.firstElementChild.outerHTML : ''; } catch (e) { /* ignore */ } };
    window.addEventListener('hashchange', snap, true);
    return () => window.removeEventListener('hashchange', snap, true);
  }, []);
  let screen = null;
  if (route.name === 'home') screen = <Home key="home" />;
  else if (route.name === 'game') screen = <GameDetails key={`game-${route.params.id}`} id={route.params.id} />;
  else if (route.name === 'play') screen = <Play key={`play-${route.params.id}`} id={route.params.id} />;
  else if (route.name === 'players') screen = <Players key="players" />;
  else if (route.name === 'settings') screen = <Settings key="settings" />;
  else if (route.name === 'about') screen = <About key="about" />;
  return (
    <>
      <div ref={hostRef} data-route={route.path}>{screen}</div>
      <div ref={ghostRef} className="screen-ghost" aria-hidden="true" hidden />
    </>
  );
}

function Providers({ children }) {
  const toast = useToast();
  const [settings, setSettingsState] = useState(() => ({ ...DEFAULT_SETTINGS, ...(platformStorage.get('settings', {}) || {}) }));
  const [roster, setRosterState] = useState(() => platformStorage.get('roster', []) || []);
  const sound = useMemo(() => createSound({ enabled: settings.soundOn }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const haptics = useMemo(() => createHaptics({ enabled: settings.hapticsOn }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const setSettings = useCallback((patch) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      platformStorage.set('settings', next);
      return next;
    });
  }, []);
  const setRoster = useCallback((next) => {
    setRosterState(next);
    platformStorage.set('roster', next);
  }, []);

  useEffect(() => { sound.enable(settings.soundOn); }, [sound, settings.soundOn]);
  useEffect(() => { haptics.enable(settings.hapticsOn); }, [haptics, settings.hapticsOn]);
  useEffect(() => { document.documentElement.dataset.reducedMotion = settings.reducedMotion ? 'true' : 'false'; }, [settings.reducedMotion]);

  const value = useMemo(() => ({ sound, haptics, confetti, toast, settings, setSettings, roster, setRoster, navigate, storage: platformStorage, version: VERSION }), [sound, haptics, toast, settings, setSettings, roster, setRoster]);
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

function Shell() {
  const route = useRoute();
  const [booted, setBooted] = useState(false);
  return (
    <>
      <style>{uiCss}</style>
      <style>{setupCss}</style>
      <style>{platformCss}</style>
      {!booted && <Splash onDone={() => setBooted(true)} />}
      <ScreenHost route={route} />
    </>
  );
}

export function PlatformApp() {
  return (
    <ToastProvider>
      <Providers>
        <Shell />
      </Providers>
    </ToastProvider>
  );
}
