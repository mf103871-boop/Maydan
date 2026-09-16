// غلاف المنصة: المزوّدون (صوت/اهتزاز/تخزين/دفتر اللاعبين/إعدادات)، الموجّه، وانتقالات الشاشات.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { PlatformContext, usePlatform } from './context.js';
import { useRoute, navigate, getDirection } from './router.js';
import { createStorage, clearAllPlatformData } from '../shared/lib/storage.js';
import { ACCOUNT_PREFIX } from '../shared/account/store.js';
import { createSound } from '../shared/fx/sound.js';
import { createHaptics } from '../shared/fx/haptics.js';
import { confetti } from '../shared/fx/confetti.js';
import { ToastProvider, useToast, ErrorBoundary } from '../shared/ui/components.jsx';
import uiCss from '../shared/ui/ui.css';
import setupCss from '../shared/setup/setup.css';
import platformCss from './platform.css';
import brandCss from '../shared/brand/brand.css';
import { BrandFonts } from '../shared/brand/art.jsx';
import { Splash } from './screens/Splash.jsx';
import { Home } from './screens/Home.jsx';
import { GameDetails } from './screens/GameDetails.jsx';
import { Play } from './screens/Play.jsx';
import { Players } from './screens/Players.jsx';
import { Settings } from './screens/Settings.jsx';
import { About } from './screens/About.jsx';
import { Terms, Privacy } from './screens/Legal.jsx';
import { Online } from '../online/Online.jsx';
import onlineCss from '../online/online.css';
import { AccountProvider } from '../shared/account/AccountProvider.jsx';
import { PaywallHost } from '../shared/account/PaywallHost.jsx';
import accountCss from '../shared/account/account.css';

export const VERSION = typeof __MAYDAN_VERSION__ !== 'undefined' ? __MAYDAN_VERSION__ : '1.0.0';
const platformStorage = createStorage('platform');
const DEFAULT_SETTINGS = { soundOn: true, hapticsOn: true, reducedMotion: false, splashSeen: false };

function ScreenHost({ route }) {
  // Screens animate in, with the direction taken from how the route was
  // reached (forward vs. back). There is deliberately no outgoing "ghost" of
  // the previous screen: cloning its DOM duplicates every control and ARIA
  // node for the length of the animation, which assistive tech and automated
  // clicks can reach. The directional enter animation carries the transition
  // on its own.
  let screen = null;
  // عودة الدخول (#/auth?code=) تعرض الرئيسية بينما يبدّل AccountProvider الرمز بجلسة.
  if (route.name === 'home' || route.name === 'auth') screen = <Home key="home" />;
  else if (route.name === 'game') screen = <GameDetails key={`game-${route.params.id}`} id={route.params.id} />;
  else if (route.name === 'play') screen = <Play key={`play-${route.params.id}`} id={route.params.id} />;
  else if (route.name === 'players') screen = <Players key="players" />;
  else if (route.name === 'settings') screen = <Settings key="settings" />;
  else if (route.name === 'about') screen = <About key="about" />;
  else if (route.name === 'terms') screen = <Terms key="terms" />;
  else if (route.name === 'privacy') screen = <Privacy key="privacy" />;
  else if (route.name === 'online') screen = <Online key={`online-${route.params.id || 'meenfina'}`} game={route.params.id || 'meenfina'} />;
  else if (route.name === 'room') screen = <Online key={`room-${route.params.id}`} code={route.params.id} />;
  return screen;
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
  // الحساب داخل مزوّد المنصة: يحتاج التنبيهات (toast) والإعدادات، وتحتاجه كل الشاشات.
  return <PlatformContext.Provider value={value}><AccountProvider>{children}</AccountProvider></PlatformContext.Provider>;
}

function Shell() {
  const route = useRoute();
  const { settings, setSettings } = usePlatform();
  const [booted, setBooted] = useState(false);
  // splashSeen كان يُكتب ولا يُقرأ: الافتتاحية الكاملة تُعرض مرة واحدة، ثم تقصر.
  const finishSplash = useCallback(() => {
    setBooted(true);
    if (!settings.splashSeen) setSettings({ splashSeen: true });
  }, [settings.splashSeen, setSettings]);
  // «مسح كل البيانات» من الشاشة الحمراء يبقي الحساب كما تفعل الإعدادات.
  const resetKeepingAccount = () => { clearAllPlatformData({ keep: [ACCOUNT_PREFIX] }); location.reload(); };
  return (
    <>
      <BrandFonts />
      <style>{uiCss}</style>
      <style>{setupCss}</style>
      <style>{platformCss}</style>
      {!booted && <Splash onDone={finishSplash} reducedMotion={settings.reducedMotion} duration={settings.splashSeen ? 900 : 2200} />}
      {/* حدّ خطأ حول الشاشات: خطأ تصيير واحد كان يُفرغ الصفحة بلا رجعة. */}
      <ErrorBoundary
        resetKey={route.path}
        title="تعطّلت هذه الشاشة"
        message="حدث خطأ غير متوقع. يمكنك العودة إلى الرئيسية، أو مسح البيانات المحفوظة إن تكرّر الخطأ عند كل فتح."
        clearLabel="مسح كل البيانات وإعادة التشغيل"
        onHome={() => navigate('/', { replace: true })}
        onClear={resetKeepingAccount}
      >
        <ScreenHost route={route} />
      </ErrorBoundary>
      <PaywallHost />
      <style>{brandCss}</style>
      <style>{onlineCss}</style>
      <style>{accountCss}</style>
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
