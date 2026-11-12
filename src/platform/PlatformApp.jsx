// غلاف المنصة: المزوّدون (صوت/اهتزاز/تخزين/دفتر اللاعبين/إعدادات)، الموجّه، وانتقالات الشاشات.
import React, { useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from 'react';
import { initialUiLocale, setUiLocale, tr, gameName } from '../shared/i18n/core.js';
import { useI18n } from '../shared/i18n/react.jsx';
import playfulCss from './playful-studio.css';
import { PlusStyles } from '../plus/PlusStyles.jsx';
import { PlatformContext, usePlatform } from './context.js';
import { useRoute, navigate, getDirection, getRoute, installNativeBackBridge } from './router.js';
import { getGame } from './registry.js';
import { createStorage, clearAllPlatformData } from '../shared/lib/storage.js';
import { ACCOUNT_PREFIX } from '../shared/account/store.js';
import { createSound } from '../shared/fx/sound.js';
import { integratedPreviewAudio, integratedPreviewDefaults, registerIntegratedPreviewSound } from '../shared/fx/integrated-preview-audio.js';
import { bindNetworkAudio } from '../shared/fx/network-audio.js';
import { activeAudioOwners } from '../social/media.js';
import { createHaptics } from '../shared/fx/haptics.js';
import { confetti } from '../shared/fx/confetti.js';
import { ToastProvider, useToast, ErrorBoundary } from '../shared/ui/components.jsx';
import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';
import uiCss from '../shared/ui/ui.css';
import setupCss from '../shared/setup/setup.css';
import platformCss from './platform.css';
import brandCss from '../shared/brand/brand.css';
import { BrandFonts } from '../shared/brand/art.jsx';
import { Splash } from './screens/Splash.jsx';
import { Home } from './screens/Home.jsx';
import { GameDetails } from './screens/GameDetails.jsx';
import { GameEntry } from './screens/GameEntry.jsx';
import { Play } from './screens/Play.jsx';
import { Players } from './screens/Players.jsx';
import { Settings } from './screens/Settings.jsx';
import { CreatorDashboard } from '../creator/CreatorDashboard.jsx';
import { CreatorPresence } from '../creator/CreatorPresence.jsx';
import { TermsBoundary } from '../shared/legal/TermsBoundary.jsx';
import { startSimulatorTermsProbe } from './native-terms-probe.js';
import { Store } from './screens/Store.jsx';
import { BottomNavigation, MenuScrollRestoration } from './BottomNavigation.jsx';
import { About } from './screens/About.jsx';
import { Terms, Privacy } from './screens/Legal.jsx';
import { Online } from '../online/Online.jsx';
import { MafiaEntry } from '../games/mafia/tutorial/MafiaEntry.jsx';
import { MafiaTutorial } from '../games/mafia/tutorial/MafiaTutorial.jsx';
import { MafiaLabs } from '../games/mafia/tutorial/labs/MafiaLabs.jsx';
import onlineCss from '../online/online.css';
import { AccountProvider } from '../shared/account/AccountProvider.jsx';
import { PaywallHost } from '../shared/account/PaywallHost.jsx';
import accountCss from '../shared/account/account.css?sheet';
import { SocialProvider } from '../social/SocialProvider.jsx';
import { LammaProvider } from '../social/LammaProvider.jsx';
import { SocialUIProvider } from '../social/SocialUIProvider.jsx';
import { SocialHost } from '../social/SocialHost.jsx';
import { CallViewport } from '../social/CallViewport.jsx';
import { ProfileProvider } from '../profiles/ProfileProvider.jsx';
import { ProfileScreen } from '../profiles/ProfileScreen.jsx';
import { ModerationScreen } from '../moderation/ModerationScreen.jsx';
import { DesignRuntime } from '../design/DesignRuntime.jsx';

export const VERSION = typeof __MAYDAN_VERSION__ !== 'undefined' ? __MAYDAN_VERSION__ : '1.0.0';
const platformStorage = createStorage('platform');
const DEFAULT_SETTINGS = { soundOn: true, soundVolume: 0.75, voiceOn: false, creatorMode: false, musicOn: true, musicVolume: 0.35, musicLevel: 2, hapticsOn: true, reducedMotion: false, splashSeen: false };
// الموسيقى 3.1 أهدأ وأخفض: من حفظ مستوى الموسيقى قبلها يُنقل مرة واحدة إلى الافتراضي الجديد.
function migrateSettings(saved) {
  const defaults = { ...DEFAULT_SETTINGS, ...integratedPreviewDefaults() };
  const next = { ...defaults, ...(saved || {}) };
  next.uiLocale = initialUiLocale(saved, typeof navigator === 'undefined' ? 'ar' : navigator.language);
  if ((saved?.musicLevel || 1) < 2) { next.musicVolume = defaults.musicVolume; next.musicLevel = 2; }
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
  else if (route.name === 'game-entry') screen = <GameEntry key={`entry-${route.params.id}`} id={route.params.id} />;
  else if (route.name === 'game') screen = <GameDetails key={`game-${route.params.id}`} id={route.params.id} mode={route.params.mode} />;
  else if (route.name === 'mafia-tutorial') screen = route.params.lab||route.params.labs ? <MafiaLabs key={`mafia-labs-${route.params.lab||'hub'}`} courseId={route.params.lab}/> : <MafiaTutorial key="mafia-tutorial" />;
  else if (route.name === 'play' && route.params.id === 'mafia') screen = <MafiaEntry key="mafia-entry" />;
  else if (route.name === 'play') {
    const rewarded = typeof __MAYDAN_REWARDED_PREVIEW__ !== 'undefined' && __MAYDAN_REWARDED_PREVIEW__ && route.params.id === 'badeeha' && route.params.rewarded === '1';
    screen = getGame(route.params.id)?.onlineOnly ? <Online key={`online-${route.params.id}`} game={route.params.id} /> :
      <Play key={`play-${route.params.id}${rewarded ? '-rewarded' : ''}`} id={route.params.id} rewarded={rewarded} />;
  }
  else if (route.name === 'players') screen = <Players key="players" />;
  else if (route.name === 'friends' || route.name === 'friend-group') screen = <div key="friends" data-social-page-slot />;
  else if (route.name === 'profile') screen = <ProfileScreen key={`profile-${route.params.id || 'me'}`} profileId={route.params.id || null} />;
  else if (route.name === 'settings') screen = <Settings key="settings" />;
  else if (route.name === 'creator') screen = <CreatorDashboard key="creator" />;
  else if (route.name === 'store') screen = <Store key="store" />;
  else if (route.name === 'moderation') screen = <ModerationScreen key="moderation" />;
  else if (route.name === 'about') screen = <About key="about" />;
  else if (route.name === 'terms') screen = <Terms key="terms" />;
  else if (route.name === 'privacy') screen = <Privacy key="privacy" />;
  else if (route.name === 'online' && route.params.id === 'mafia') screen = <MafiaEntry key={`mafia-entry-${route.params.joinOnly === '1' ? 'join' : 'all'}`} joinOnly={route.params.joinOnly === '1'} />;
  else if (route.name === 'online') {
    const game = route.params.id || 'meenfina';
    const rewarded = typeof __MAYDAN_REWARDED_PREVIEW__ !== 'undefined' && __MAYDAN_REWARDED_PREVIEW__ && game === 'meenfina' && route.params.rewarded === '1';
    screen = <Online key={`online-${game}${rewarded ? '-rewarded' : ''}${route.params.joinOnly === '1' ? '-join' : ''}`} game={game} joinOnly={route.params.joinOnly === '1'} rewarded={rewarded} initialView={rewarded ? 'create' : 'public'} />;
  }
  else if (route.name === 'room') screen = <Online key={`room-${route.params.id}-${route.params.watch==='1'?'observer':'player'}`} code={route.params.id} observer={route.params.watch==='1'} />;
  return screen;
}

export function PlatformProviders({ children }) {
  const toast = useToast();
  const [settings, setSettingsState] = useState(() => migrateSettings(platformStorage.get('settings', null)));
  useLayoutEffect(() => { setUiLocale(settings.uiLocale); }, [settings.uiLocale]);
  const [roster, setRosterState] = useState(() => platformStorage.get('roster', []) || []);
  const sound = useMemo(() => createSound({ enabled: settings.soundOn, volume: settings.soundVolume, voice: settings.voiceOn, music: settings.musicOn, musicVolume: settings.musicVolume, creatorMode: settings.creatorMode, localAudition: integratedPreviewAudio() }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const haptics = useMemo(() => createHaptics({ enabled: settings.hapticsOn }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const setSettings = useCallback((patch) => {
    // Apply in the gesture itself so enabling audio can play its confirmation.
    if ('soundOn' in patch) sound.enable(patch.soundOn);
    if ('soundVolume' in patch) sound.setVolume(patch.soundVolume);
    if ('voiceOn' in patch) sound.voice.enable(patch.voiceOn);
    if ('musicOn' in patch) sound.music.enable(patch.musicOn);
    if ('creatorMode' in patch) sound.music.setCreatorMode(patch.creatorMode);
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
  useEffect(() => registerIntegratedPreviewSound(sound), [sound]);
  useEffect(() => bindNetworkAudio(sound, { available: () => !['play', 'room', 'mafia-tutorial'].includes(getRoute().name) && activeAudioOwners().length === 0 }), [sound]);
  useEffect(() => { sound.enable(settings.soundOn); }, [sound, settings.soundOn]);
  useEffect(() => { sound.setVolume(settings.soundVolume); }, [sound, settings.soundVolume]);
  useEffect(() => { sound.voice.enable(settings.voiceOn); }, [sound, settings.voiceOn]);
  useEffect(() => { sound.music.enable(settings.musicOn); }, [sound, settings.musicOn]);
  useEffect(() => { sound.music.setCreatorMode(settings.creatorMode); }, [sound, settings.creatorMode]);
  useEffect(() => { sound.music.setVolume(settings.musicVolume); }, [sound, settings.musicVolume]);
  useEffect(() => { haptics.enable(settings.hapticsOn); }, [haptics, settings.hapticsOn]);
  useEffect(() => { document.documentElement.dataset.reducedMotion = settings.reducedMotion ? 'true' : 'false'; }, [settings.reducedMotion]);
  useEffect(() => {
    const update = () => { document.documentElement.dataset.appHidden = document.hidden ? 'true' : 'false'; };
    update(); document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.largeText = settings.largeText ? 'true' : 'false';
    root.dataset.highContrast = settings.highContrast ? 'true' : 'false';
    root.dataset.visualQuality = settings.visualQuality === 'calm' ? 'calm' : 'auto';
  }, [settings.largeText, settings.highContrast, settings.visualQuality]);

  const value = useMemo(() => ({ sound, haptics, confetti, toast, settings, setSettings, roster, setRoster, navigate, storage: platformStorage, version: VERSION }), [sound, haptics, toast, settings, setSettings, roster, setRoster]);
  // الحساب داخل مزوّد المنصة: يحتاج التنبيهات (toast) والإعدادات، وتحتاجه كل الشاشات.
  return <PlatformContext.Provider value={value}><AccountProvider><SocialProvider><LammaProvider><SocialUIProvider><ProfileProvider>{children}</ProfileProvider></SocialUIProvider></LammaProvider></SocialProvider></AccountProvider></PlatformContext.Provider>;
}

// عنوان المستند يتبع الشاشة (قارئات الشاشة والتبويبات والسجل)، والألعاب تحمل اسمها.
const SCREEN_TITLES = { 'mafia-tutorial': 'تدريب مافيا', players: 'اللاعبون', friends: 'الأصدقاء', 'friend-group': 'الشِّلّة', store: 'المتجر', profile: 'الملف', settings: 'الإعدادات', about: 'عن ميدان', terms: 'شروط الاستخدام', privacy: 'سياسة الخصوصية', online: 'اللّمّة', room: 'الغرفة' };
const BASE_TITLE = 'ميدان: ألعاب جمعتنا';
const IN_GAME_ROUTES = new Set(['play', 'online', 'room', 'mafia-tutorial']);
export const UPDATE_READY_MESSAGE = 'تحديث ميدان جاهز — يعمل عند الفتح التالي.';

function Shell() {
  const { locale, localeStatus } = useI18n();
  const route = useRoute();
  const { settings, setSettings, sound, confetti, toast } = usePlatform();
  const [booted, setBooted] = useState(false);
  const [languageBooted, setLanguageBooted] = useState(settings.uiLocale !== 'en' || locale === 'en');
  useEffect(() => {
    if (settings.uiLocale !== 'en' || locale === 'en') setLanguageBooted(true);
  }, [settings.uiLocale, locale]);
  // Only the first mount waits for its dictionary. Later language changes keep
  // the live match, drafts and dialog instances mounted throughout the request.
  const usable = booted && languageBooted;
  useEffect(() => usable ? startSimulatorTermsProbe() : undefined,[usable]);
  useEffect(() => installNativeBackBridge(), []);
  useEffect(() => {
    const game = (route.name === 'game' || route.name === 'play' || route.name === 'game-entry') ? getGame(route.params.id) : null;
    const title = game ? gameName(game, locale) : tr(SCREEN_TITLES[route.name]);
    document.title = title ? `${title} · ${tr('ميدان')}` : tr(BASE_TITLE);
  }, [route.name, route.params.id, locale]);
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
  // تغيير الشاشة يقطع المؤثرات المعلّقة لكن يُبقي صوت اللمسة التي انتقلت بنا (آخر 350 مللي ثانية).
  useEffect(() => () => { sound.stop({ spare: 350 }); confetti.clear(); }, [route.path, sound, confetti]);
  // الموسيقى تتبع الشاشة: القوائم واللّمّة على مقطع «البيت»، وشاشة اللعب تختار مقطعها بنفسها
  // (الإعداد على «البيت»، ثم مقطع اللعبة عند البدء؛ انظر Play.jsx).
  const shellMusic = useRef(Symbol('menu-music'));
  useEffect(() => { sound.music.scene(shellMusic.current, 'home', route.name, 0); }, [route.name, sound]);
  useEffect(() => { const lease = shellMusic.current; return () => sound.music.releaseScene(lease); }, [sound]);
  // «مسح كل البيانات» من الشاشة الحمراء يبقي الحساب كما تفعل الإعدادات.
  const resetKeepingAccount = () => { clearAllPlatformData({ keep: [ACCOUNT_PREFIX] }); location.reload(); };
  return (
    <>
      <BrandFonts />
      <PlusStyles />
      <style>{uiCss}</style>
      <style>{setupCss}</style>
      <style>{platformCss}</style>
      <Splash visible={!booted} onDone={finishSplash} reducedMotion={settings.reducedMotion} />
      {/* حدّ خطأ حول الشاشات: خطأ تصيير واحد كان يُفرغ الصفحة بلا رجعة. */}
      {booted && !languageBooted && <main className="screen stack center" aria-busy={localeStatus.loading} lang="en" dir="ltr"><h1>Maydan</h1><p role={localeStatus.error ? 'alert' : 'status'}>{localeStatus.error ? 'Could not load English. Please try again.' : 'Loading English…'}</p>{localeStatus.error && <><button type="button" className="btn btn-primary" onClick={() => setUiLocale('en')}>Try again</button><button type="button" className="btn" lang="ar" onClick={() => setSettings({uiLocale:'ar'})}>المتابعة بالعربية</button></>}</main>}
      {usable && <TermsBoundary route={route}><CreatorPresence route={route} /><ErrorBoundary
        resetKey={route.path}
        title={tr("تعطّلت هذه الشاشة")}
        message={tr("حدث خطأ غير متوقع. يمكنك العودة إلى الرئيسية، أو مسح البيانات المحفوظة إن تكرّر الخطأ عند كل فتح.")}
        clearLabel={tr("مسح كل البيانات وإعادة التشغيل")}
        onHome={() => navigate('/', { replace: true })}
        onClear={resetKeepingAccount}
      >
        <CallViewport><ScreenHost route={route} /></CallViewport>
      </ErrorBoundary>
      <MenuScrollRestoration route={route} />
      <BottomNavigation route={route} />
      <PaywallHost />
      <ErrorBoundary title={tr("تعذّر فتح اللّمة")} message={tr("أعد فتح ميدان لتتصل بأصحابك.")} onHome={() => navigate('/')}><SocialHost /></ErrorBoundary></TermsBoundary>}
      <style>{brandCss}</style>
      <style>{onlineCss}</style>
      <PresentationStyles sheet={accountCss} />
      <style>{playfulCss}</style>
    </>
  );
}

export function PlatformApp() {
  return (
    <ToastProvider>
      <PlatformProviders>
        <DesignRuntime><Shell /></DesignRuntime>
      </PlatformProviders>
    </ToastProvider>
  );
}

export { Shell as PlatformShell };
