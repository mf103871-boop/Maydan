// غلاف المنصة: المزوّدون (صوت/اهتزاز/تخزين/دفتر اللاعبين/إعدادات)، الموجّه، وانتقالات الشاشات.
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { PlatformContext, usePlatform } from './context.js';
import { useRoute, navigate, getDirection, getRoute } from './router.js';
import { getGame } from './registry.js';
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
import { SocialProvider } from '../social/SocialProvider.jsx';
import { SocialScreen } from '../social/SocialScreen.jsx';
import { ProfileProvider } from '../profiles/ProfileProvider.jsx';
import { ProfileScreen } from '../profiles/ProfileScreen.jsx';
import { ModerationScreen } from '../moderation/ModerationScreen.jsx';

export const VERSION = typeof __MAYDAN_VERSION__ !== 'undefined' ? __MAYDAN_VERSION__ : '1.0.0';
const platformStorage = createStorage('platform');
const DEFAULT_SETTINGS = { soundOn: true, soundVolume: 0.75, musicOn: true, musicVolume: 0.35, musicLevel: 2, hapticsOn: true, reducedMotion: false, splashSeen: false };
// الموسيقى 3.1 أهدأ وأخفض: من حفظ مستوى الموسيقى قبلها يُنقل مرة واحدة إلى الافتراضي الجديد.
function migrateSettings(saved) {
  const next = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  if ((saved?.musicLevel || 1) < 2) { next.musicVolume = DEFAULT_SETTINGS.musicVolume; next.musicLevel = 2; }
  return next;
}

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
  else if (route.name === 'friends') screen = <SocialScreen key="friends" friendId={route.params.id || null} />;
  else if (route.name === 'profile') screen = <ProfileScreen key={`profile-${route.params.id || 'me'}`} profileId={route.params.id || null} />;
  else if (route.name === 'settings') screen = <Settings key="settings" />;
  else if (route.name === 'moderation') screen = <ModerationScreen key="moderation" />;
  else if (route.name === 'about') screen = <About key="about" />;
  else if (route.name === 'terms') screen = <Terms key="terms" />;
  else if (route.name === 'privacy') screen = <Privacy key="privacy" />;
  else if (route.name === 'online') screen = <Online key={`online-${route.params.id || 'meenfina'}`} game={route.params.id || 'meenfina'} />;
  else if (route.name === 'room') screen = <Online key={`room-${route.params.id}`} code={route.params.id} />;
  return screen;
}

function Providers({ children }) {
  const toast = useToast();
  const [settings, setSettingsState] = useState(() => migrateSettings(platformStorage.get('settings', {})));
  const [roster, setRosterState] = useState(() => platformStorage.get('roster', []) || []);
  const sound = useMemo(() => createSound({ enabled: settings.soundOn, volume: settings.soundVolume, music: settings.musicOn, musicVolume: settings.musicVolume }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const haptics = useMemo(() => createHaptics({ enabled: settings.hapticsOn }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const setSettings = useCallback((patch) => {
    // Apply in the gesture itself so enabling audio can play its confirmation.
    if ('soundOn' in patch) sound.enable(patch.soundOn);
    if ('soundVolume' in patch) sound.setVolume(patch.soundVolume);
    if ('musicOn' in patch) sound.music.enable(patch.musicOn);
    if ('musicVolume' in patch) sound.music.setVolume(patch.musicVolume);
    if ('hapticsOn' in patch) haptics.enable(patch.hapticsOn);
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      platformStorage.set('settings', next);
      return next;
    });
  }, [sound, haptics]);
  const setRoster = useCallback((next) => {
    setRosterState(next);
    platformStorage.set('roster', next);
  }, []);

  useEffect(() => { sound.attach(); return () => sound.dispose(); }, [sound]);
  useEffect(() => { sound.enable(settings.soundOn); }, [sound, settings.soundOn]);
  useEffect(() => { sound.setVolume(settings.soundVolume); }, [sound, settings.soundVolume]);
  useEffect(() => { sound.music.enable(settings.musicOn); }, [sound, settings.musicOn]);
  useEffect(() => { sound.music.setVolume(settings.musicVolume); }, [sound, settings.musicVolume]);
  useEffect(() => { haptics.enable(settings.hapticsOn); }, [haptics, settings.hapticsOn]);
  useEffect(() => { document.documentElement.dataset.reducedMotion = settings.reducedMotion ? 'true' : 'false'; }, [settings.reducedMotion]);

  const value = useMemo(() => ({ sound, haptics, confetti, toast, settings, setSettings, roster, setRoster, navigate, storage: platformStorage, version: VERSION }), [sound, haptics, toast, settings, setSettings, roster, setRoster]);
  // الحساب داخل مزوّد المنصة: يحتاج التنبيهات (toast) والإعدادات، وتحتاجه كل الشاشات.
  return <PlatformContext.Provider value={value}><AccountProvider><SocialProvider><ProfileProvider>{children}</ProfileProvider></SocialProvider></AccountProvider></PlatformContext.Provider>;
}

// عنوان المستند يتبع الشاشة (قارئات الشاشة والتبويبات والسجل)، والألعاب تحمل اسمها.
const SCREEN_TITLES = { players: 'اللاعبون', friends: 'الأصدقاء', profile: 'الملف', settings: 'الإعدادات', about: 'عن ميدان', terms: 'شروط الاستخدام', privacy: 'سياسة الخصوصية', online: 'اللّمّة', room: 'الغرفة' };
const BASE_TITLE = 'ميدان: ألعاب جمعتنا';
const IN_GAME_ROUTES = new Set(['play', 'online', 'room']);
export const UPDATE_READY_MESSAGE = 'تحديث ميدان جاهز — يعمل عند الفتح التالي.';

function Shell() {
  const route = useRoute();
  const { settings, setSettings, sound, confetti, toast } = usePlatform();
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    const game = (route.name === 'game' || route.name === 'play') ? getGame(route.params.id) : null;
    const title = game ? game.name : SCREEN_TITLES[route.name];
    document.title = title ? `${title} · ميدان` : BASE_TITLE;
  }, [route.name, route.params.id]);
  // عامل الخدمة يعلن «maydan-update-ready» بعد تثبيت إصدار جديد ولا يعيد تحميل الصفحة.
  // التنبيه يظهر خارج شاشات اللعب فقط؛ داخل مباراة يُؤجَّل إلى أول شاشة عادية بعدها.
  const pendingUpdate = useRef(false);
  const inGame = IN_GAME_ROUTES.has(route.name);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return undefined;
    const onMessage = (event) => {
      if (event.data?.type !== 'maydan-update-ready') return;
      pendingUpdate.current = true;
      if (!IN_GAME_ROUTES.has(getRoute().name)) { pendingUpdate.current = false; toast(UPDATE_READY_MESSAGE, { duration: 6000 }); }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [toast]);
  useEffect(() => {
    if (!booted || inGame || !pendingUpdate.current) return;
    pendingUpdate.current = false;
    toast(UPDATE_READY_MESSAGE, { duration: 6000 });
  }, [booted, inGame, toast]);
  // The shell becomes usable quickly; the mounted splash continues image work
  // in the background without starting a hidden game's timers during startup.
  const finishSplash = useCallback(() => {
    setBooted(true);
    if (!settings.splashSeen) setSettings({ splashSeen: true });
  }, [settings.splashSeen, setSettings]);
  useEffect(() => () => { sound.stop(); confetti.clear(); }, [route.path, sound, confetti]);
  // الموسيقى تتبع الشاشة: القوائم واللّمّة على مقطع «البيت»، وشاشة اللعب تختار مقطعها بنفسها
  // (الإعداد على «البيت»، ثم مقطع اللعبة عند البدء؛ انظر Play.jsx).
  useEffect(() => { if (route.name !== 'play') sound.music.play('home'); }, [route.name, sound]);
  // «مسح كل البيانات» من الشاشة الحمراء يبقي الحساب كما تفعل الإعدادات.
  const resetKeepingAccount = () => { clearAllPlatformData({ keep: [ACCOUNT_PREFIX] }); location.reload(); };
  return (
    <>
      <BrandFonts />
      <style>{uiCss}</style>
      <style>{setupCss}</style>
      <style>{platformCss}</style>
      <Splash visible={!booted} onDone={finishSplash} reducedMotion={settings.reducedMotion} />
      {/* حدّ خطأ حول الشاشات: خطأ تصيير واحد كان يُفرغ الصفحة بلا رجعة. */}
      {booted && <ErrorBoundary
        resetKey={route.path}
        title="تعطّلت هذه الشاشة"
        message="حدث خطأ غير متوقع. يمكنك العودة إلى الرئيسية، أو مسح البيانات المحفوظة إن تكرّر الخطأ عند كل فتح."
        clearLabel="مسح كل البيانات وإعادة التشغيل"
        onHome={() => navigate('/', { replace: true })}
        onClear={resetKeepingAccount}
      >
        <ScreenHost route={route} />
      </ErrorBoundary>}
      {booted && <PaywallHost />}
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
