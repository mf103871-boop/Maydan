import { tr, getUiLocale, localeDirection } from '../../shared/i18n/core.js';
import { Avatar, GameArtwork } from '../../shared/brand/art.jsx';
import { useGameMusicScene } from '../../shared/fx/useGameMusicScene.js';
import { useCandidateDeadlineWarning } from '../../shared/fx/useDeadlineAudio.js';
import { Podium } from '../../shared/ui/components.jsx';
// طبقات التأثير المشتركة (ختم/وميض/تظليل) تعيش في document.body لا في شجرة الشاشة،
// و wait() تصفّر كل مهلة بصرية تحت «تقليل الحركة».
import { flashScreen, stampScreen, vignette, wait, burstConfetti, confetti as confettiFx } from '../../shared/fx/index.js';
// لعبة «بَديهة» (ميدان سابقًا) — الكود الأصلي منقول كما هو بأسلوب React.createElement.
// التعديلات الوحيدة: الاستيرادات أعلاه بدل المتغيرات العامة، اسم اللعبة في النصوص،
// ومفاتيح التخزين تحت النطاق maydan:badeeha (انظر keys.js).
import React from "../../design/react.js";
import { socialInterruption } from '../../social/interruption.js';
import { getCategories } from "../../data/game-content.js";
import { normalizeContentIdentity } from '../../shared/content-locale.mjs';
import MAYDAN_BETA_CSS from "./styles.css?sheet";
import { PresentationStyles } from "../../shared/ui/PresentationStyles.jsx";
import MaydanLogicBeta, {
  filterCategories,
  pointsAfterHints,
  modeTopTier,
  BANK_CONTENT_VERSION,
  currentQuestionHistoryCount,
} from "./logic.js";
import { BADEEHA_KEYS as MAYDAN_BETA_KEYS } from "./keys.js";
import { readBadeehaState, RETIRED_GAME_NOTICE } from "./persistence.js";
import { BADEEHA_REWARDED_PACKS, LOCAL_REWARDED_OFFER, REWARDED_PREVIEW, rewardedStorageKey, rewardEvent } from "../../shared/account/rewarded.js";
import { questionAssistance } from "./assistance.js";
import { CategoryCover } from "./Cover.jsx";
import { questionMedia, deckMedia } from "../../shared/media/resolve.js";
import {
  preloadMedia,
  cacheForOffline,
  isLoaded as mediaIsLoaded,
} from "../../shared/media/preload.js";

import { TOOLS, TEAM_STYLE, TYPE_PROMPT, answerText, MAYDAN_TIER_LABELS } from "./constants.js";
import { betaTeam, betaCloneTeams } from "./teams.js";
import { saveBadeehaKey, removeBadeehaKey, betaNativeMessage } from "./device.js";
import { getCtx, SFX, SOUND_RECIPES, closeSoundContext } from "./sounds.js";
import { MaydanModal } from "./Modal.js";
import { ScorePoints, OfflineMediaRowBeta } from "./parts.js";
import { QuestionVisual } from "./QuestionVisual.js";

const { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } = React;

var hBeta = React.createElement;



function MaydanBeta({ api, entry = 'home' } = {}) {
  const requestedLocale = api?.contentLocale, requestedVersion = api?.contentVersion;
  const reportContentSetup = api?.setContentSetupActive;
  const identity = useMemo(() => normalizeContentIdentity({contentLocale:requestedLocale,contentVersion:requestedVersion}), [requestedLocale, requestedVersion]);
  const CATS = useMemo(() => getCategories(identity.contentLocale, identity.contentVersion), [identity]);
  const TOTAL_Q = CATS.reduce((sum, category) => sum + category.qs.length, 0);
  const HAS_MEDIA = CATS.some(category => category.qs.some(question => question.media));
  const designPreview = api?.designPreview || null;
  const isDesignPreview = !!designPreview;
  const landingScreen = entry === 'setup' && !isDesignPreview ? 'setup' : 'home';
  const rewarded = REWARDED_PREVIEW ? api?.rewarded : null;
  const scope = rewarded?.owner;
  const storageKey = useCallback((key) => {
    const localizedKey = identity.contentLocale === 'ar' ? key : `${key}:${identity.contentLocale}:${identity.contentVersion}`;
    return scope ? rewardedStorageKey(scope, localizedKey) : localizedKey;
  }, [scope, identity]);
  const saveKey = useCallback((key, value) => isDesignPreview ? Promise.resolve() : saveBadeehaKey(storageKey(key), value), [isDesignPreview, storageKey]);
  const betaRemoveKey = useCallback((key) => isDesignPreview ? undefined : removeBadeehaKey(storageKey(key)), [isDesignPreview, storageKey]);
  const rewardMatch = useRef(null);
  const rewardRequest = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [rewardBusy, setRewardBusy] = useState(false);
  const logic = MaydanLogicBeta,
    [hydrated, setHydrated] = useState(!!designPreview),
    [screen, setScreenState] = useState(designPreview?.screen || landingScreen),
    // اتجاه الانتقال: «back» يبدّل إطارات دخول الشاشة (على .m-screen لا .m-root)
    [navDir, setNavDir] = useState("forward"),
    // حالات بصرية قصيرة العمر (تُصفَّر بمؤقّت يمرّ من wait)
    [shuffled, setShuffled] = useState(!1),
    [timerFx, setTimerFx] = useState(""),
    [launchQid, setLaunchQid] = useState(null),
    [bumpId, setBumpId] = useState(null),
    [deltaFx, setDeltaFx] = useState(null),
    [undoFx, setUndoFx] = useState(!1),
    [noticeLeaving, setNoticeLeaving] = useState(!1),
    [teams, setTeams] = useState(designPreview?.teams || [betaTeam(0), betaTeam(1)]),
    [selectedCategories, setSelectedCategories] = useState(designPreview?.selectedCategories || (scope ? [...BADEEHA_REWARDED_PACKS] : [])),
    [timerLength, setTimerLength] = useState(60),
    [mode, setMode] = useState("expert"),
    [roundSize, setRoundSize] = useState(30),
    [deck, setDeck] = useState(designPreview?.deck || {}),
    [used, setUsed] = useState({}),
    [turn, setTurn] = useState(0),
    [current, setCurrent] = useState(designPreview?.current || null),
    [timeLeft, setTimeLeft] = useState(60),
    [paused, setPaused] = useState(!!designPreview),
    [revealed, setRevealed] = useState(!!designPreview?.revealed),
    // المضيف يخفي الإجابة بعد كشفها (كي لا يراها فريق يقرأ الشاشة) ثم يظهرها عند الحسم.
    [answerHidden, setAnswerHidden] = useState(!1),
    [mixedItems, setMixedItems] = useState([]),
    [effect, setEffect] = useState({ double: !1, two: !1 }),
    [hintsUsed, setHintsUsed] = useState(0),
    [offlineMedia, setOfflineMedia] = useState({ state: "idle", done: 0, total: 0 }),
    [roundLoading, setRoundLoading] = useState(null),
    [questionBaseTeams, setQuestionBaseTeams] = useState(null),
    [history, setHistory] = useState({}),
    [results, setResults] = useState(designPreview?.results || []),
    [reports, setReports] = useState([]),
    [favorites, setFavorites] = useState([]),
    [savedActive, setSavedActive] = useState(null),
    [retiredActive, setRetiredActive] = useState(!1),
    [finalResult, setFinalResult] = useState(designPreview?.finalResult || null),
    [soundOn, setSoundOn] = useState(!designPreview),
    [categoryFilter, setCategoryFilter] = useState("all"),
    [categorySearch, setCategorySearch] = useState(""),
    [setupError, setSetupError] = useState(""),
    [showRules, setShowRules] = useState(!1),
    [showScore, setShowScore] = useState(!1),
    [confirmEnd, setConfirmEnd] = useState(!1),
    [reportQuestion, setReportQuestion] = useState(null),
    // تأكيد المسح داخل اللعبة: window.confirm لا يظهر في غلاف iOS (WKWebView بلا
    // runJavaScriptConfirmPanel يعامله كـ«إلغاء») فكان زرّا المسح لا يفعلان شيئًا هناك.
    [pendingClear, setPendingClear] = useState(null),
    [lastAction, setLastAction] = useState(null),
    [notice, setNotice] = useState(""),
    deadlineRef = useRef(null),
    pausedRef = useRef(paused),
    // آخر قيمة للمؤقت دون أن تكون تبعية لتأثير الحفظ: الحفظ كل ثانية كان يبني لقطة
    // كاملة ويعيد تسليح المؤقت مع كل تكّة.
    timeLeftRef = useRef(60),
    roundLoadRef = useRef(null),
    soundTimerRef = useRef(null),
    saveTimerRef = useRef(null),
    timeoutPlayedRef = useRef(!1),
    activeSnapshotRef = useRef(null),
    lastQuestionSoundRef = useRef(0),
    // حرس النقر المزدوج على الحكم أثناء الختم، وقفل فتح السؤال أثناء نبضة البلاطة
    judgingRef = useRef(!1),
    launchRef = useRef(!1),
    // النقاط السابقة لكل فريق: يعدّ الرقم منها عند ظهور البطاقات بعد الحكم
    prevScoresRef = useRef(new Map()),
    fxTimersRef = useRef({}),
    toastTimersRef = useRef([]),
    totalQuestions = Object.values(deck).reduce((sum, questions) => sum + questions.length, 0),
    usedCount = Object.keys(used).length,
    activeMode = logic.MODES[mode] || logic.MODES.expert,
    currentQuestion =
      current && deck[current.categoryId] ? deck[current.categoryId][current.index] : null,
    currentCategory = current ? CATS.find((category) => category.id === current.categoryId) : null,
    // إعدادات المنصة هي المرجع حين تُمرَّر: زر الكتم في شريط اللعبة يتحكم بصوت
    // بَديهة أيضًا، فلا يبقى زرّا كتم متناقضان، والاهتزاز و«حركة أقل» يُحترمان.
    platformSettings = (api && api.settings) || null,
    effectiveSoundOn = platformSettings ? platformSettings.soundOn !== !1 : soundOn,
    hapticsOn = platformSettings ? platformSettings.hapticsOn !== !1 : !0,
    reducedMotion = platformSettings ? !!platformSettings.reducedMotion : !1,
    packLocked = () => false;
  useGameMusicScene(api?.sound, 'badeeha', screen, screen === 'question' && paused);
  useCandidateDeadlineWarning(api?.sound, current ? JSON.stringify(['badeeha', current.categoryId, current.index, currentQuestion?.qid]) : null, timeLeft,
    !isDesignPreview && effectiveSoundOn && screen === 'question' && !!current && !revealed && !paused);
  pausedRef.current = paused;
  function setScreen(next, dir) {
    (setNavDir(dir || "forward"), setScreenState(next));
  }
  // صنف بصري مؤقّت: يُضبط ثم يُزال بعد مهلة تمرّ من wait (صفر تحت تقليل الحركة)
  function pulseFx(key, setter, value, ms, reset) {
    fxTimersRef.current[key] && window.clearTimeout(fxTimersRef.current[key]);
    setter(value);
    fxTimersRef.current[key] = window.setTimeout(() => setter(reset), wait(ms));
  }
  function playSfx(name) {
    if (isDesignPreview) return;
    if (!effectiveSoundOn) return;
    // ناقل الصوت المشترك يعرف كل الأسماء (scoreUp/scoreDown عبر أسمائه البديلة)؛ الجدول المحلي للبديل فقط.
    if (api && api.sound && typeof api.sound.play === "function") {
      api.sound.play(name);
      return;
    }
    if (!SFX[name]) return;
    const context = getCtx();
    if (context)
      try {
        SFX[name](context);
      } catch (error) {}
  }
  function playQuestionSound(recipe) {
    if (!effectiveSoundOn || !SOUND_RECIPES[recipe]) return;
    const now = Date.now();
    if (now - lastQuestionSoundRef.current < 450) return;
    // ناقل الصوت المشترك حين يتوفر: مستوى الصوت وكتم الخلفية يسريان على أصوات الأسئلة.
    // المهلة تُحتسب عند صدور الصوت فعلًا، فلا يبتلع طلبٌ مرفوض (كتم، سياق غير جاهز) الطلب التالي.
    if (api && api.sound && typeof api.sound.synth === "function") {
      if (api.sound.synth((context) => SOUND_RECIPES[recipe](context))) lastQuestionSoundRef.current = now;
      return;
    }
    const context = getCtx();
    if (context)
      try {
        SOUND_RECIPES[recipe](context);
        lastQuestionSoundRef.current = now;
      } catch (error) {}
  }
  useEffect(() => () => { roundLoadRef.current?.abort(); }, []);
  async function prepareRoundMedia(nextDeck) {
    const urls = deckMedia(nextDeck, CATS).filter((url) => !mediaIsLoaded(url));
    roundLoadRef.current?.abort();
    if (!urls.length) { setRoundLoading(null); playSfx("start"); return; }
    const controller = new AbortController();
    roundLoadRef.current = controller;
    setRoundLoading({ done: 0, total: urls.length });
    try {
      const result = await preloadMedia(urls, {
        signal: controller.signal,
        onProgress: ({ done, total }) => { if (!controller.signal.aborted) setRoundLoading({ done, total }); },
      });
      if (controller.signal.aborted) return;
      if (result.failed) toast(tr("بعض الوسائط لم تُحمّل؛ يمكنك إعادة المحاولة عند فتح السؤال"));
      playSfx("start");
    } catch {
      if (!controller.signal.aborted) toast(tr("تعذّر تجهيز بعض الوسائط؛ يمكنك إعادة المحاولة من السؤال"));
    } finally {
      if (roundLoadRef.current === controller && !controller.signal.aborted) {
        roundLoadRef.current = null;
        setRoundLoading(null);
      }
    }
  }
  function skipRoundLoading() {
    roundLoadRef.current?.abort();
    roundLoadRef.current = null;
    setRoundLoading(null);
    playSfx("start");
    toast(tr("بدأت الجولة؛ الوسائط غير الجاهزة ستُحمّل عند فتحها"));
  }
  function haptic(kind) {
    if (isDesignPreview || !hapticsOn) return;
    const presets = {
        selection: { style: "selection", pattern: 12 },
        light: { style: "light", pattern: 18 },
        medium: { style: "medium", pattern: 32 },
        success: { style: "success", pattern: [25, 28, 55] },
        warning: { style: "warning", pattern: [42, 28, 42] },
        error: { style: "error", pattern: 85 },
        win: { style: "success", pattern: [28, 24, 28, 32, 75] },
      },
      preset = presets[kind] || presets.selection;
    if (!betaNativeMessage({ type: "haptic", style: preset.style, pattern: preset.pattern }))
      try {
        navigator.vibrate && navigator.vibrate(preset.pattern);
      } catch (error) {}
  }
  function toast(message) {
    toastTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    (setNotice(message),
      setNoticeLeaving(!1),
      (toastTimersRef.current = [
        window.setTimeout(() => setNoticeLeaving(!0), 2400 - wait(200)),
        window.setTimeout(() => setNotice((value) => (value === message ? "" : value)), 2400),
      ]));
  }
  async function shareText(title, text) {
    if (!betaNativeMessage({ type: "share", title, text })) {
      try {
        if (navigator.share) {
          try {
            await navigator.share({ title, text });
            return;
          } catch (error) {
            // إلغاء اللاعب نهائي؛ أي رفض آخر (NotAllowedError على سطح المكتب مثلًا) يجرّب النسخ.
            if (error && error.name === "AbortError") return;
          }
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          (await navigator.clipboard.writeText(text), toast(tr("تم نسخ النص")));
          return;
        }
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
      toast(tr("تعذرت المشاركة على هذا الجهاز"));
    }
  }
  (useEffect(() => {
    if (isDesignPreview) return undefined;
    let cancelled = !1;
    return (
      (async () => {
        const restored = readBadeehaState(CATS, { getItem: key => localStorage.getItem(storageKey(key)) });
        const { history: loadedHistory, results: loadedResults, active: loadedActive,
          settings: loadedSettings, reports: loadedReports } = restored;
        cancelled ||
          (loadedHistory &&
            typeof loadedHistory == "object" &&
            !Array.isArray(loadedHistory) &&
            setHistory(loadedHistory),
          Array.isArray(loadedResults) && setResults(loadedResults),
          Array.isArray(loadedReports) && setReports(loadedReports),
          loadedSettings &&
            typeof loadedSettings == "object" &&
            (typeof loadedSettings.soundOn == "boolean" && setSoundOn(loadedSettings.soundOn),
            [30, 60, 90].includes(loadedSettings.timerLength) &&
              setTimerLength(loadedSettings.timerLength),
            logic.MODES[loadedSettings.mode] && setMode(loadedSettings.mode),
            logic.ROUND_SIZES.includes(loadedSettings.roundSize) &&
              setRoundSize(loadedSettings.roundSize),
            Array.isArray(loadedSettings.favorites) &&
              setFavorites(loadedSettings.favorites.filter((id) => CATS.some((c) => c.id === id)))),
          setSavedActive(loadedActive),
          setRetiredActive(restored.retiredActive),
          restored.invalidActive && betaRemoveKey(MAYDAN_BETA_KEYS.active),
          setHydrated(!0));
      })(),
      () => {
        cancelled = !0;
      }
    );
  }, [isDesignPreview, betaRemoveKey, logic.MODES, logic.ROUND_SIZES, scope, storageKey, CATS]),
    useEffect(() => {
      hydrated &&
        saveKey(MAYDAN_BETA_KEYS.settings, { soundOn, timerLength, mode, roundSize, favorites });
    }, [hydrated, soundOn, timerLength, mode, roundSize, favorites, saveKey]),
    useEffect(() => {
      if (!effectiveSoundOn) {
        closeQuestionSoundTimer();
        closeSoundContext();
      }
    }, [effectiveSoundOn]),
    // السياق الاحتياطي (بلا ناقل المنصة) يُغلق عند الخروج من اللعبة لا يبقى يستهلك الصوت.
    useEffect(() => () => closeSoundContext(), []),
    useEffect(() => {
      if (!hydrated || (screen !== "board" && screen !== "question")) return;
      // أثناء مهلة الحسم (650ms) النقاط مُسجَّلة والسؤال ما زال مفتوحًا؛ لا تُحفظ لقطة بهذه الحالة المختلطة.
      if (judgingRef.current) return;
      const session = {
        version: 2,
        profileSession: api?.matchSnapshot?.() || null,
        contentVersion: BANK_CONTENT_VERSION,
        contentLocale: identity.contentLocale,
        contentPackVersion: identity.contentVersion,
        updatedAt: Date.now(),
        screen,
        teams: betaCloneTeams(teams),
        selectedCategories: [...selectedCategories],
        timerLength,
        mode,
        roundSize,
        deck: logic.deckToIds(deck),
        used: { ...used },
        turn,
        current: current ? { ...current } : null,
        timeLeft: timeLeftRef.current,
        paused: screen === "question" ? !0 : paused,
        revealed,
        answerHidden,
        mixedItems: [...mixedItems],
        effect: { ...effect },
        questionBaseTeams: questionBaseTeams ? betaCloneTeams(questionBaseTeams) : null,
        // بدون هذا كان خصم التلميحات يضيع عند استئناف المباراة فيُمنح السؤال كاملًا.
        hintsUsed,
        lastAction,
        ...(scope && rewardMatch.current ? { rewardedMatchId: rewardMatch.current, rewardedConfirmed: true } : {}),
      };
      return (
        (activeSnapshotRef.current = session),
        saveTimerRef.current && window.clearTimeout(saveTimerRef.current),
        (saveTimerRef.current = window.setTimeout(
          () => saveKey(MAYDAN_BETA_KEYS.active, session),
          250,
        )),
        () => {
          saveTimerRef.current && window.clearTimeout(saveTimerRef.current);
        }
      );
    }, [
      hydrated,
      screen,
      teams,
      selectedCategories,
      timerLength,
      mode,
      roundSize,
      deck,
      used,
      turn,
      current,
      paused,
      revealed,
      answerHidden,
      mixedItems,
      effect,
      questionBaseTeams,
      hintsUsed,
      lastAction,
      saveKey,
      scope,
      identity,
    ]),
    useLayoutEffect(() => {
      reportContentSetup?.(screen === 'setup' || screen === 'home');
      return () => reportContentSetup?.(false);
    }, [reportContentSetup, screen]),
    useEffect(() => {
      // شاشة اللعب تفترض inGame=true لألعاب setup:'self'، فكان تأكيد الخروج يظهر
      // على الشاشة الأولى قبل بدء أي مباراة. اللعبة وحدها تعرف متى بدأت المباراة.
      if (!api || typeof api.setInGame != "function") return undefined;
      const playing = screen === "board" || screen === "question";
      return (api.setInGame(playing), () => api.setInGame(!1));
    }, [api, screen]),
    useEffect(() => {
      const saveOnLeave = () => {
        if (!activeSnapshotRef.current) return;
        // اللقطة تُبنى عند تغيّر الحالة لا مع كل تكّة؛ الوقت المتبقي يُؤخذ لحظة الخروج.
        saveKey(MAYDAN_BETA_KEYS.active, { ...activeSnapshotRef.current, timeLeft: timeLeftRef.current });
      };
      return (
        window.addEventListener("pagehide", saveOnLeave),
        () => window.removeEventListener("pagehide", saveOnLeave)
      );
    }, [saveKey]),
    useEffect(() => {
      try {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      } catch (error) {
        window.scrollTo(0, 0);
      }
    }, [screen]),
    useEffect(() => {
      if (isDesignPreview || screen !== "question" || !current || revealed || paused || timeLeft <= 0) return;
      deadlineRef.current || (deadlineRef.current = Date.now() + timeLeft * 1e3);
      let interval = 0;
      const tick = () => {
        // بعد الصفر لا يبقى موعد نهائي؛ لا نحسب على null ولا نستمر في التكّ بلا فائدة.
        if (!deadlineRef.current) { window.clearInterval(interval); return; }
        const next = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1e3));
        // المؤثر خارج دالة التحديث: React قد يستدعي المحدِّث مرتين في وضع التدقيق.
        if (next !== timeLeftRef.current && next > 0 && next <= 5) playSfx("tick");
        timeLeftRef.current = next;
        setTimeLeft(next);
        if (next === 0) {
          window.clearInterval(interval);
          if (!timeoutPlayedRef.current) {
            timeoutPlayedRef.current = !0;
            deadlineRef.current = null;
            playSfx("timeout");
            haptic("warning");
          }
        }
      };
      tick();
      interval = window.setInterval(tick, 250);
      return () => window.clearInterval(interval);
    }, [screen, current && `${current.categoryId}:${current.index}`, revealed, paused, effectiveSoundOn, isDesignPreview]),
    useEffect(() => {
      const onVisibility = () => {
        document.hidden &&
          screen === "question" &&
          !revealed &&
          ((deadlineRef.current = null), setPaused(!0));
      };
      return (
        document.addEventListener("visibilitychange", onVisibility),
        () => document.removeEventListener("visibilitychange", onVisibility)
      );
    }, [screen, revealed]),
    useEffect(() => {
      let pausedHere = false;
      return socialInterruption.subscribe(() => {
        if (socialInterruption.getSnapshot().paused && screen === "question" && !revealed && !pausedRef.current) {
          pausedHere = true; pausedRef.current = true; deadlineRef.current = null; setPaused(true);
        } else if (!socialInterruption.getSnapshot().paused && pausedHere) { pausedHere = false; setPaused(false); }
      });
    }, [screen, revealed]),
    // التظليل الأحمر في آخر ثلاث ثوانٍ (طبقة ثابتة في body)؛ يُطفأ عند تغيّر الشاشة أو الكشف أو التوقف
    useEffect(() => {
      if (isDesignPreview) return undefined;
      vignette(screen === "question" && !!current && !revealed && !paused && timeLeft > 0 && timeLeft <= 3);
      return () => vignette(false);
    }, [screen, current, revealed, paused, timeLeft, isDesignPreview]),
    // النقاط السابقة تُحدَّث حيث تظهر بطاقات النقاط فقط، فيعدّ الرقم من قيمة ما قبل الحكم عند العودة إلى اللوحة
    useEffect(() => {
      if (screen === "board" || screen === "result" || showScore)
        teams.forEach((team) => prevScoresRef.current.set(team.id, team.score));
    }, [teams, screen, showScore]),
    useEffect(
      () => () => {
        Object.values(fxTimersRef.current).forEach((timer) => window.clearTimeout(timer));
        toastTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      },
      [],
    ));
  function closeQuestionSoundTimer() {
    soundTimerRef.current &&
      (window.clearTimeout(soundTimerRef.current), (soundTimerRef.current = null));
  }
  function cancelQuestion() {
    if (revealed) {
      toast(tr("احسم نتيجة السؤال أولًا"));
      return;
    }
    (closeQuestionSoundTimer(),
      questionBaseTeams && setTeams(betaCloneTeams(questionBaseTeams)),
      (deadlineRef.current = null),
      setCurrent(null),
      setQuestionBaseTeams(null),
      setEffect({ double: !1, two: !1 }),
      setHintsUsed(0),
      setPaused(!1),
      setScreen("board", "back"),
      playSfx("click"));
  }
  useEffect(
    () => (
      (window.maydanBack = () =>
        pendingClear
          ? (setPendingClear(null), !0)
          : reportQuestion
          ? (setReportQuestion(null), !0)
          : showScore
            ? (setShowScore(!1), !0)
            : showRules
              ? (setShowRules(!1), !0)
              : screen === "question"
                ? (revealed ? toast(tr("احسم نتيجة السؤال أولًا")) : cancelQuestion(), !0)
                : screen === "board"
                  ? (setConfirmEnd(!0), !0)
                  : screen !== landingScreen
                    ? (setScreen(landingScreen, "back"), !0)
                    : !1),
      () => {
        delete window.maydanBack;
      }
    ),
    [screen, revealed, reportQuestion, pendingClear, showScore, showRules, questionBaseTeams, landingScreen],
  );
  function setTeamCount(count) {
    (setTeams((existing) =>
      Array.from({ length: count }, (_, index) => existing[index] || betaTeam(index)),
    ),
      setSetupError(""),
      playSfx("click"));
  }
  function setTeamName(index, name) {
    (setTeams((existing) =>
      existing.map((team, teamIndex) => (teamIndex === index ? { ...team, name } : team)),
    ),
      setSetupError(""));
  }
  function toggleCategory(categoryId) {
    if (scope) return;
    (setSetupError(""),
      setSelectedCategories((existing) =>
        existing.includes(categoryId)
          ? existing.filter((id) => id !== categoryId)
          : existing.length < 6
            ? [...existing, categoryId]
            : existing,
      ),
      playSfx("click"));
  }
  function toggleFavorite(categoryId) {
    (setFavorites((existing) =>
      existing.includes(categoryId)
        ? existing.filter((id) => id !== categoryId)
        : [...existing, categoryId],
    ),
      playSfx("click"));
  }
  // Legacy saved free-filter now includes the entire free bank.
  const visibleCategories = filterCategories(scope ? CATS.filter(category => BADEEHA_REWARDED_PACKS.includes(category.id)) : CATS, {
    filter: categoryFilter === "free" ? "all" : categoryFilter,
    search: categorySearch,
    favorites,
  });
  function randomCategories() {
    if (scope) return;
    // الاختيار العشوائي لا يسحب حزمة مقفولة أبدًا: نستبعدها من البركة قبل الخلط.
    const pool = visibleCategories.filter((category) => !packLocked(category.id));
    if (pool.length < 6) {
      setSetupError(tr("الفئات الظاهرة أقل من ست؛ وسّع التصفية أو البحث"));
      return;
    }
    (setSelectedCategories(
      logic.shuffled(pool.map((category) => category.id)).slice(0, 6),
    ),
      setSetupError(""),
      pulseFx("shuffle", setShuffled, !0, 600, !1),
      playSfx("tool"));
  }
  async function confirmRewarded(draft) {
    if (rewardRequest.current) return;
    rewardRequest.current = true;
    setRewardBusy(true);
    setSetupError("");
    const key = storageKey(MAYDAN_BETA_KEYS.active);
    const begin = async () => {
      // Record a recovery point before asking the server to commit. An
      // uncertain response keeps the same ID; a definite refusal can retry.
      const previous = readBadeehaState(CATS, { getItem: name => localStorage.getItem(storageKey(name)) }).active;
      const checkpoint = previous?.rewardedMatchId ? previous : draft;
      if (!previous?.rewardedMatchId) localStorage.setItem(key, JSON.stringify(checkpoint));
      if (!checkpoint.rewardedConfirmed) {
        if (mounted.current) setSavedActive(checkpoint);
        try {
          await rewarded.start(checkpoint.rewardedMatchId);
        } catch (error) {
          // A definitive denial never started this match. Keep the recovery
          // point only when the server result might have been committed.
          if (error.code === "REWARDED_REQUIRED") {
            const recorded = JSON.parse(localStorage.getItem(key) || "null");
            if (recorded?.rewardedMatchId === checkpoint.rewardedMatchId && !recorded.rewardedConfirmed) {
              localStorage.removeItem(key);
              if (mounted.current) setSavedActive(null);
            }
          }
          throw error;
        }
        checkpoint.rewardedConfirmed = true;
        localStorage.setItem(key, JSON.stringify(checkpoint));
        rewardEvent(LOCAL_REWARDED_OFFER, 'start');
      }
      if (!mounted.current) return;
      rewardMatch.current = checkpoint.rewardedMatchId;
      let keepProfileSession = false;
      if (!checkpoint.profileSession && !Object.keys(checkpoint.used || {}).length && checkpoint.screen === "board") {
        api?.matchStart?.();
        keepProfileSession = true;
        checkpoint.profileSession = api?.matchSnapshot?.() || null;
        await saveKey(MAYDAN_BETA_KEYS.active, checkpoint);
      }
      setSavedActive(checkpoint);
      if (mounted.current) openSavedMatch(checkpoint, keepProfileSession);
    };
    try {
      if (navigator.locks) await navigator.locks.request(key, begin);
      else await begin();
    } catch (error) {
      if (mounted.current) setSetupError(error.code === "REWARDED_REQUIRED"
        ? tr("تحتاج تذكرة جديدة لمباراة أخرى. ارجع إلى شاشة التحدّي.")
        : tr("لم نتأكد من بدء المباراة. حاول متابعة المباراة المحفوظة عند عودة الاتصال."));
    } finally {
      rewardRequest.current = false;
      if (mounted.current) setRewardBusy(false);
    }
  }
  async function beginGame() {
    if (scope && rewardRequest.current) return;
    const validation = logic.validateTeamNames(teams.map((team) => team.name));
    if (!validation.ok) {
      setSetupError(validation.message);
      return;
    }
    if (selectedCategories.length !== 6) {
      setSetupError(tr("اختر ست فئات بالضبط"));
      return;
    }
    let nextDeck;
    try {
      nextDeck = logic.buildDeck(CATS, selectedCategories, history, activeMode.tiers, roundSize);
    } catch (error) {
      setSetupError(error.message || tr("تعذر تجهيز الجولة"));
      return;
    }
    const freshTeams = teams.map((team, index) => betaTeam(index, validation.names[index]));
    if (scope) {
      const draft = { version: 2, contentVersion: BANK_CONTENT_VERSION, contentLocale: identity.contentLocale, contentPackVersion: identity.contentVersion, updatedAt: Date.now(),
        screen: "board", teams: freshTeams, selectedCategories: [...selectedCategories],
        timerLength, mode, roundSize, deck: logic.deckToIds(nextDeck), timeLeft: timerLength,
        rewardedMatchId: crypto.randomUUID(), rewardedConfirmed: false };
      void confirmRewarded(draft);
      return;
    }
    if (api?.authorizeMatch) {
      setRewardBusy(true);
      const allowed = await api.authorizeMatch({ categories: selectedCategories });
      if (mounted.current) setRewardBusy(false);
      if (!allowed || !mounted.current) return;
    }
    api?.matchStart?.();
    (setTeams(freshTeams),
      setDeck(nextDeck),
      setUsed({}),
      setTurn(0),
      setCurrent(null),
      setTimeLeft(timerLength),
      setPaused(!1),
      setRevealed(!1),
      setEffect({ double: !1, two: !1 }),
      setQuestionBaseTeams(null),
      setLastAction(null),
      setFinalResult(null),
      setConfirmEnd(!1),
      setShowScore(!1),
      setSavedActive(null),
      setRetiredActive(!1),
      setSetupError(""),
      (deadlineRef.current = null),
      (timeoutPlayedRef.current = !1),
      betaRemoveKey(MAYDAN_BETA_KEYS.active),
      prepareRoundMedia(nextDeck),
      setScreen("board"),
      haptic("medium"));
  }
  async function resumeGame() {
    if (!logic.isValidSession(CATS, savedActive)) {
      (betaRemoveKey(MAYDAN_BETA_KEYS.active),
        setSavedActive(null),
        toast(tr("تعذر استعادة المباراة القديمة")));
      return;
    }
    if (scope) {
      if (!savedActive.rewardedMatchId) return;
      void confirmRewarded(savedActive);
      return;
    }
    if (api?.authorizeMatch) {
      setRewardBusy(true);
      const allowed = await api.authorizeMatch({ categories: savedActive.selectedCategories, resume: savedActive });
      if (mounted.current) setRewardBusy(false);
      if (!allowed || !mounted.current) return;
    }
    openSavedMatch(savedActive);
  }
  function openSavedMatch(savedActive, keepProfileSession = false) {
    const restoredDeck = logic.idsToDeck(CATS, savedActive.deck);
    if (!keepProfileSession) api?.matchResume?.(savedActive.profileSession || null);
    (setTeams(betaCloneTeams(savedActive.teams)),
      setSelectedCategories([...savedActive.selectedCategories]),
      setTimerLength(savedActive.timerLength),
      setMode(savedActive.mode),
      setRoundSize(savedActive.roundSize),
      setDeck(restoredDeck),
      setUsed({ ...(savedActive.used || {}) }),
      setTurn(savedActive.turn || 0),
      setCurrent(savedActive.current ? { ...savedActive.current } : null),
      setTimeLeft(
        Number.isFinite(savedActive.timeLeft) ? savedActive.timeLeft : savedActive.timerLength,
      ),
      setPaused(!0),
      setRevealed(!!savedActive.revealed),
      setAnswerHidden(!!savedActive.answerHidden),
      setMixedItems(Array.isArray(savedActive.mixedItems) ? [...savedActive.mixedItems] : []),
      setEffect(savedActive.effect ? { ...savedActive.effect } : { double: !1, two: !1 }),
      setHintsUsed(Number.isFinite(savedActive.hintsUsed) ? savedActive.hintsUsed : 0),
      setQuestionBaseTeams(
        savedActive.questionBaseTeams ? betaCloneTeams(savedActive.questionBaseTeams) : null,
      ),
      setLastAction(savedActive.lastAction || null),
      (deadlineRef.current = null),
      (timeLeftRef.current = Number.isFinite(savedActive.timeLeft) ? savedActive.timeLeft : savedActive.timerLength),
      (timeoutPlayedRef.current = savedActive.timeLeft <= 0),
      setScreen(savedActive.screen === "question" && savedActive.current ? "question" : "board"),
      playSfx("start"));
  }
  function discardSavedGame() {
    if (scope && (rewardRequest.current || (savedActive?.rewardedMatchId && !savedActive.rewardedConfirmed))) return;
    (betaRemoveKey(MAYDAN_BETA_KEYS.active),
      setSavedActive(null),
      toast(tr("تم حذف المباراة المحفوظة")));
  }
  function openQuestion(categoryId, index) {
    const question = deck[categoryId] && deck[categoryId][index];
    if (!(!question || used[question.qid] || launchRef.current)) {
      launchRef.current = !0;
      if (
        (closeQuestionSoundTimer(),
        setQuestionBaseTeams(betaCloneTeams(teams)),
        setCurrent({ categoryId, index }),
        setTimeLeft(timerLength),
        setPaused(!1),
        setRevealed(!1),
        setEffect({ double: !1, two: !1 }),
        setHintsUsed(0),
        (timeoutPlayedRef.current = !1),
        (deadlineRef.current = Date.now() + timerLength * 1e3),
        question.type === "order")
      ) {
        let items = logic.shuffled(question.items),
          attempts = 0;
        for (; items.join("|") === question.items.join("|") && attempts < 5;)
          ((items = logic.shuffled(question.items)), (attempts += 1));
        setMixedItems(items);
      } else setMixedItems([]);
      // البلاطة تنبض (is-launch) ثم تُفتح الشاشة؛ المهلة بصرية فقط وتصفر تحت تقليل الحركة
      (setLaunchQid(question.qid),
        window.setTimeout(() => {
          ((launchRef.current = !1), setLaunchQid(null), setScreen("question"));
        }, wait(150)),
        playSfx("open"),
        haptic("selection"),
        question.type === "sound" &&
          (soundTimerRef.current = window.setTimeout(() => {
            (playQuestionSound(question.sound), (soundTimerRef.current = null));
          }, 450)));
    }
  }
  function togglePause() {
    (paused
      ? ((deadlineRef.current = Date.now() + timeLeft * 1e3),
        setPaused(!1),
        pulseFx("timer", setTimerFx, "is-resumed", 300, ""))
      : ((deadlineRef.current = null), setPaused(!0)),
      playSfx("click"));
  }
  // ختم ذهبي عند تفعيل أداة، وقفزة للمؤقت عند +30
  function toolFx(toolId) {
    stampScreen({
      text: toolId === "double" ? "×٢" : toolId === "two" ? tr("جوابان") : "+٣٠",
      tone: "gold",
      ms: 600,
    });
    toolId === "time" && pulseFx("timer", setTimerFx, "is-boost", 500, "");
  }
  // ختم الحكم ووميض الشاشة وقصاصات (دفعتان للسرقة)؛ كلها طبقات في body تُتخطّى تحت تقليل الحركة
  function verdictFx(isSteal, points) {
    if (points == null) {
      (stampScreen({ text: tr("ولا أحد"), tone: "bad" }), flashScreen("bad"));
      return;
    }
    const burst = () =>
      burstConfetti({ x: window.innerWidth / 2, y: window.innerHeight * 0.42, count: 60 });
    (stampScreen({
      text: isSteal ? tr("خطف!") : tr("صح!"),
      tone: isSteal ? "gold" : "good",
      points: `+${points}`,
    }),
      flashScreen("good"),
      burst(),
      isSteal && window.setTimeout(burst, wait(150)));
  }
  function spendTool(toolId) {
    !currentQuestion ||
      revealed ||
      timeLeft <= 0 ||
      !teams[turn].tools[toolId] ||
      (toolId === "double" && revealed) ||
      (setTeams((existing) =>
        existing.map((team, index) =>
          index === turn ? { ...team, tools: { ...team.tools, [toolId]: !1 } } : team,
        ),
      ),
      toolId === "double" && setEffect((value) => ({ ...value, double: !0 })),
      toolId === "two" && setEffect((value) => ({ ...value, two: !0 })),
      toolId === "time" &&
        (setTimeLeft((seconds) => seconds + 30),
        !paused && deadlineRef.current && (deadlineRef.current += 3e4)),
      playSfx("tool"),
      toolFx(toolId),
      haptic("light"));
  }
  function revealAnswer() {
    (closeQuestionSoundTimer(),
      (deadlineRef.current = null),
      setRevealed(!0),
      setAnswerHidden(!1),
      setPaused(!1),
      playSfx("reveal"),
      haptic("light"));
  }
  function toggleAnswerHidden() {
    (setAnswerHidden((value) => !value), playSfx("click"), haptic("light"));
  }
  function snapshotAction(label) {
    return {
      label,
      teams: betaCloneTeams(teams),
      used: { ...used },
      turn,
      history: { ...history },
    };
  }
  function finishGame(early, finishedTeams = teams, finishedUsed = used) {
    api?.matchOver?.({ completed: !early && (totalQuestions || roundSize) > 0 && Object.keys(finishedUsed).length >= (totalQuestions || roundSize) });
    const maximum = Math.max(...finishedTeams.map((team) => team.score)),
      winners = finishedTeams.filter((team) => team.score === maximum),
      record = {
        id: Date.now(),
        date: new Date().toLocaleDateString(getUiLocale(), {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
        teams: finishedTeams.map((team) => ({
          id: team.id,
          name: team.name,
          score: team.score,
          correct: team.correct,
          steals: team.steals,
        })),
        winner: winners.length === 1 ? winners[0].name : null,
        answered: Object.keys(finishedUsed).length,
        total: totalQuestions || roundSize,
        mode,
        roundSize,
        early: !!early,
      },
      nextResults = [record, ...results].slice(0, 80);
    (setTeams(betaCloneTeams(finishedTeams)),
      setResults(nextResults),
      setFinalResult(record),
      saveKey(MAYDAN_BETA_KEYS.results, nextResults),
      saveTimerRef.current &&
        (window.clearTimeout(saveTimerRef.current), (saveTimerRef.current = null)),
      betaRemoveKey(MAYDAN_BETA_KEYS.active),
      (activeSnapshotRef.current = null),
      setSavedActive(null),
      setConfirmEnd(!1),
      setShowScore(!1),
      setCurrent(null),
      setScreen("result"),
      // القصاصات على canvas المنصة بدل 28 عنصر DOM؛ قرار «تقليل الحركة» من إعدادات المنصة
      window.setTimeout(() => {
        reducedMotion || (api && api.confetti ? api.confetti : confettiFx).fire();
      }, 360),
      haptic("win"));
  }
  function judgeQuestion(winnerIndex) {
    const question = currentQuestion;
    if (!question || judgingRef.current) return;
    judgingRef.current = !0;
    const action = snapshotAction(tr("نتيجة سؤال {v0}", {v0: question.p}));
    let nextTeams = betaCloneTeams(teams);
    if (winnerIndex !== null) {
      const sameTeam = winnerIndex === turn,
        base = pointsAfterHints(question.p, hintsUsed),
        points = sameTeam && effect.double ? base * 2 : base,
        isSteal = question.type !== "closest" && !sameTeam;
      ((nextTeams = nextTeams.map((team, index) =>
        index === winnerIndex
          ? {
              ...team,
              score: team.score + points,
              correct: team.correct + 1,
              steals: team.steals + (isSteal ? 1 : 0),
            }
          : team,
      )),
        playSfx(isSteal ? "steal" : "correct"),
        haptic("success"),
        verdictFx(isSteal, points));
    } else (playSfx("wrong"), haptic("error"), verdictFx(!1, null));
    const nextUsed = { ...used, [question.qid]: !0 },
      nextHistory = { ...history, [question.qid]: Date.now() },
      nextTurn = (turn + 1) % teams.length;
    // النقاط والسجل والدور تُحسم فورًا؛ إفراغ السؤال والانتقال يُؤجَّلان ~650ms ليبقى السؤال
    // تحت الختم (صفر تحت تقليل الحركة)، والترتيب بينها كما كان.
    (setTeams(nextTeams),
      setUsed(nextUsed),
      setHistory(nextHistory),
      saveKey(MAYDAN_BETA_KEYS.history, nextHistory),
      setTurn(nextTurn),
      setLastAction(action),
      window.setTimeout(() => {
        ((judgingRef.current = !1),
          setCurrent(null),
          setQuestionBaseTeams(null),
          setEffect({ double: !1, two: !1 }),
          setHintsUsed(0),
          setRevealed(!1),
          (deadlineRef.current = null),
          Object.keys(nextUsed).length >= totalQuestions
            ? finishGame(!1, nextTeams, nextUsed)
            : setScreen("board"));
      }, wait(650)));
  }
  function undoLastAction() {
    lastAction &&
      (setTeams(betaCloneTeams(lastAction.teams)),
      setUsed({ ...lastAction.used }),
      setTurn(lastAction.turn),
      setHistory({ ...lastAction.history }),
      saveKey(MAYDAN_BETA_KEYS.history, lastAction.history),
      setLastAction(null),
      setConfirmEnd(!1),
      pulseFx("undo", setUndoFx, !0, 400, !1),
      playSfx("click"),
      haptic("selection"),
      toast(tr("تم التراجع عن آخر تعديل")));
  }
  function adjustScore(teamIndex, delta) {
    const team = teams[teamIndex];
    (setLastAction(snapshotAction(tr("تعديل {v0}{v1} نقطة", {v0: delta > 0 ? "+" : "", v1: delta}))),
      setTeams((existing) =>
        existing.map((team, index) =>
          index === teamIndex ? { ...team, score: team.score + delta } : team,
        ),
      ),
      team && pulseFx("bump", setBumpId, team.id, 400, null),
      team && pulseFx("delta", setDeltaFx, { id: team.id, value: delta, key: Date.now() }, 800, null),
      playSfx(delta > 0 ? "scoreUp" : "scoreDown"),
      haptic(delta > 0 ? "light" : "selection"));
  }
  function submitReport(reason) {
    if (!reportQuestion) return;
    const category = CATS.find((item) => item.id === reportQuestion.categoryId),
      question = reportQuestion.question,
      next = [
        {
          id: Date.now(),
          qid: question.qid,
          categoryId: category.id,
          category: category.name,
          points: question.p,
          question: question.q || TYPE_PROMPT[question.type] || question.type,
          answer: answerText(question),
          reason,
          date: new Date().toISOString(),
        },
        ...reports,
      ].slice(0, 300);
    (setReports(next),
      saveKey(MAYDAN_BETA_KEYS.reports, next),
      setReportQuestion(null),
      toast(tr("شكرًا، حُفظ البلاغ على الجهاز")));
  }
  function shareResult() {
    const record = finalResult;
    if (!record) return;
    const scores = record.teams.map((team) => `${team.name}: ${team.score}`).join(" — "),
      title = record.winner ? tr("فاز {v0} في بَديهة", {v0: record.winner}) : tr("تعادل في بَديهة");
    shareText(
      tr("بَديهة"),
      tr("{v0}\n{v1}\n{v2} من {v3} سؤالًا", {v0: title, v1: scores, v2: record.answered, v3: record.total}),
    );
  }
  function shareReports() {
    if (!reports.length) return;
    const text = reports.slice(0, 100).map((report, index) =>
      [
        `${index + 1}. [${report.category} — ${report.points}] ${report.reason}`,
        tr("السؤال: {v0}", {v0: report.question}),
        tr("الإجابة: {v0}", {v0: report.answer}),
        tr("المعرّف: {v0}", {v0: report.qid}),
      ].join(`
`),
    ).join(`

`);
    shareText(tr("تقارير أسئلة بَديهة"), text);
  }
  function clearQuestionHistory() {
    setPendingClear("history");
  }
  function clearResults() {
    setPendingClear("results");
  }
  function confirmClear() {
    pendingClear === "history"
      ? (setHistory({}), saveKey(MAYDAN_BETA_KEYS.history, {}), toast(tr("تم تصفير سجل الأسئلة")))
      : pendingClear === "results" &&
        (setResults([]), saveKey(MAYDAN_BETA_KEYS.results, []), toast(tr("تم مسح سجل النتائج")));
    setPendingClear(null);
  }
  function SoundButton() {
    // شريط المنصة يعرض زر كتم يتحكم بالإعداد نفسه؛ زر ثانٍ هنا كان يناقضه.
    if (platformSettings) return null;
    return hBeta(
      "button",
      {
        type: "button",
        className: "m-icon-btn",
        onClick: () => {
          if (soundOn) {
            (playSfx("click"), setSoundOn(!1));
            return;
          }
          if (api && api.sound && typeof api.sound.play === "function") {
            // الإيماءة نفسها تفتح ناقل المنصة؛ لا سياق ثانٍ خارج مستوى الصوت.
            (setSoundOn(!0), api.sound.play("click"));
            return;
          }
          const context = getCtx();
          (context && typeof context.resume == "function" && context.resume().catch(() => {}),
            setSoundOn(!0),
            context && SFX.click && SFX.click(context));
        },
        "aria-label": soundOn ? tr("كتم الصوت") : tr("تشغيل الصوت"),
        "aria-pressed": !soundOn,
      },
      hBeta("span", { "aria-hidden": "true" }, soundOn ? "🔊" : "🔇"),
    );
  }
  function Header({ title, back }) {
    return hBeta(
      "header",
      { "data-design-id": "header", className: "m-header" },
      hBeta(
        "div",
        null,
        hBeta("div", { className: "m-kicker" }, tr("بَديهة · لعبة جماعية")),
        hBeta("h1", { "data-design-id": "title", className: "m-title" }, title),
      ),
      hBeta(
        "div",
        { className: "m-header-actions" },
        SoundButton(),
        back &&
          hBeta(
            "button",
            {
              type: "button",
              className: "m-secondary m-small",
              "data-design-id": "back",
              onClick: () => {
                (playSfx("click"), back());
              },
            },
            tr("رجوع"),
          ),
      ),
    );
  }
  function TeamScoreCards({ detailed = !1 }) {
    const stableTeams = teams.map((team, index) => ({ ...team, originalIndex: index })),
      rankById = new Map(
        stableTeams
          .slice()
          .sort((left, right) => right.score - left.score)
          .map((team, rank) => [team.id, rank]),
      );
    return hBeta(
      "div",
      { className: "m-team-scores" },
      stableTeams.map((team) => {
        const rank = rankById.get(team.id);
        return hBeta(
          "div",
          {
            key: team.id,
            "data-design-id": "score-cards", className: `m-score-card ${turn === team.originalIndex && screen === "board" ? "is-turn" : ""} ${bumpId === team.id ? "is-bumped" : ""} ${undoFx ? "is-undone" : ""}`,
            style: { "--team-color": TEAM_STYLE[team.originalIndex].solid, "--n": team.originalIndex },
          },
          hBeta(
            "span",
            { className: "m-rank", "aria-hidden": "true" },
            ["🥇", "🥈", "🥉", "4️⃣"][rank],
          ),
          hBeta(
            "div",
            { className: "m-score-main" },
            hBeta("strong", { className: "m-team-name" }, team.name),
            detailed
              ? hBeta("small", null, tr("إجابات {v0} · سرقات {v1}", {v0: team.correct, v1: team.steals}))
              : turn === team.originalIndex &&
                  screen === "board" &&
                  hBeta("small", { className: "m-now-label" }, tr("الدور الآن")),
          ),
          hBeta(ScorePoints, { value: team.score, from: prevScoresRef.current.get(team.id) }),
          deltaFx &&
            deltaFx.id === team.id &&
            hBeta(
              "span",
              { key: deltaFx.key, className: `m-delta ${deltaFx.value < 0 ? "is-neg" : ""}`, "aria-hidden": "true", dir: "ltr" },
              `${deltaFx.value > 0 ? "+" : ""}${deltaFx.value}`,
            ),
        );
      }),
    );
  }
  // الإجابة «معروضة» فقط حين كُشفت ولم يخفها المضيف؛ الوسائط والتلميحات تتبع الحالة نفسها.
  const answerShown = revealed && !answerHidden;
  function SavedMatchCard() {
    if (!savedActive) return null;
    const savedProgress = savedActive ? Object.keys(savedActive.used || {}).length : 0;
    return hBeta(
      "div", { className: "m-saved-card" },
      hBeta("div", null,
        hBeta("b", null, tr("مباراة محفوظة")),
        hBeta("small", null, tr("{v0} من {v1} سؤالًا", {v0: savedProgress, v1: savedActive.roundSize})),
        hBeta("span", { className: "m-saved-progress", "aria-hidden": "true" },
          hBeta("i", { style: { width: `${Math.min(100, (savedProgress / savedActive.roundSize) * 100)}%` } }))),
      hBeta("button", { "data-design-id": "resume", "data-design-required": "true", type: "button", className: "m-primary", disabled: rewardBusy, onClick: resumeGame }, tr("متابعة")),
      (!scope || savedActive.rewardedConfirmed) && hBeta("button", { "data-design-id": "discard-save", type: "button", className: "m-link", disabled: rewardBusy, onClick: discardSavedGame }, tr("حذفها")),
    );
  }
  function HomeScreen() {
    return hBeta(
      "section",
      { className: "m-home" },
      hBeta("div", { className: "m-home-orbit", "aria-hidden": "true" }, "؟"),
      hBeta(
        "div",
        { className: "m-home-eyebrow" },
        hBeta("span", { "aria-hidden": "true" }),
        tr("لعبة مسابقات جماعية"),
      ),
      // الشعار حامل صلصالي: الحركة على .clay-lift والظل على الحامل، الرسم نفسه ساكن
      hBeta(
        "div",
        { className: "m-logo clay-stage clay-idle", "aria-label": tr("بَديهة") },
        hBeta("span", { className: "clay-lift" }, hBeta(GameArtwork, { game: "badeeha" })),
        hBeta("span", null, tr("بَديهة")),
      ),
      hBeta(
        "div",
        { "data-design-id": "intro", className: "m-home-copy" },
        hBeta("h1", { "data-design-id": "title", className: "m-home-title" }, tr("المعرفة تُحسم بالنقاط")),
        hBeta(
          "p",
          { className: "m-muted m-center" },
          tr("اختاروا الفئات، نافسوا أصدقاءكم، واحسموا الميدان."),
        ),
      ),
      hBeta(
        "div",
        { className: "m-home-stats", "aria-label": tr("معلومات اللعبة") },
        hBeta("span", null, hBeta("b", { dir: "ltr" }, CATS.length), tr(" فئة")),
        hBeta("span", null, hBeta("b", { dir: "ltr" }, TOTAL_Q), tr(" سؤال")),
        hBeta("span", null, HAS_MEDIA ? tr("الوسائط تُحفظ في الجهاز") : tr("تعمل دون إنترنت")),
      ),
      SavedMatchCard(),
      retiredActive && hBeta("p", { className: "m-muted m-center", role: "status" }, RETIRED_GAME_NOTICE),
      hBeta(
        "div",
        { "data-design-id": "actions", className: "m-home-actions" },
        hBeta(
          "button",
          { "data-design-id": "start", "data-design-required": "true",
            type: "button",
            className: "m-primary m-large m-hero-cta is-armed",
            onClick: () => {
              (setScreen("setup"), playSfx("click"), haptic("selection"));
            },
          },
          hBeta("span", { className: "m-cta-icon", "aria-hidden": "true" }, "▶"),
          hBeta(
            "span",
            null,
            hBeta("b", null, tr("ابدأ لعبة جديدة")),
            hBeta("small", null, tr("من فريقين إلى أربعة")),
          ),
        ),
        hBeta(
          "div",
          { className: "m-two" },
          hBeta(
            "button",
            { "data-design-id": "history",
              type: "button",
              className: "m-secondary",
              onClick: () => {
                (playSfx("click"), setScreen("history"));
              },
            },
            hBeta("span", { "aria-hidden": "true" }, "🏆"),
            tr(" النتائج"),
          ),
          hBeta(
            "button",
            { "data-design-id": "rules",
              type: "button",
              className: "m-secondary",
              onClick: () => {
                (playSfx("click"), setShowRules(!0));
              },
            },
            hBeta("span", { "aria-hidden": "true" }, "؟"),
            tr(" طريقة اللعب"),
          ),
        ),
      ),
      hBeta("div", { className: "m-beta-badge" }, tr("نسخة تجريبية · يُحفظ تقدمك تلقائيًا")),
    );
  }
  function SetupScreen() {
    // المجموعات مشتقة من أنواع أسئلة الحزمة نفسها (79 حزمة = 61 معلومات + 7 خاصة + 11 وسائط).
    const filters = [
      ["all", tr("الكل")],
      ["info", tr("معلومات")],
      ["special", tr("خاصة")],
      ["media", tr("وسائط")],
      ["favorites", tr("المفضلة")],
    ];
    return hBeta(
      "section",
      { className: "m-screen m-setup-flow" },
      Header({ title: tr("جهّزوا الميدان"), back: () => landingScreen === "setup" && api?.navigate
        ? api.navigate("/game/badeeha?mode=local", scope ? { replace: true } : undefined) : setScreen("home", "back") }),
      scope && hBeta("p", { className: "m-kicker" }, tr("تحدّي اللمّة التجريبي · الحزم الست مختارة")),
      landingScreen === "setup" && SavedMatchCard(),
      landingScreen === "setup" && retiredActive && hBeta("p", { className: "m-muted m-center", role: "status" }, RETIRED_GAME_NOTICE),
      landingScreen === "setup" && hBeta("div", { className: "m-two" },
        hBeta("button", { "data-design-id": "history", type: "button", className: "m-secondary m-small", onClick: () => setScreen("history") }, tr("النتائج السابقة")),
        hBeta("button", { "data-design-id": "rules", type: "button", className: "m-secondary m-small", onClick: () => setShowRules(!0) }, tr("طريقة اللعب"))),
      hBeta("nav", { className: "m-setup-guide", "aria-label": tr("أقسام تجهيز بديهة") },
        [["teams", tr("١ · الفرق والإعدادات")], ["categories", tr("٢ · الحزم ({v0}/6)", {v0: selectedCategories.length})]].map(([id, label]) =>
          hBeta("button", { key: id, type: "button", className: "m-secondary", "data-design-id": "setup-jump",
            onClick: event => {
              const target = event.currentTarget.closest(".m-setup-flow")?.querySelector(`[data-setup-section="${id}"]`);
              target?.focus({ preventScroll: true });
              target?.scrollIntoView({ block: "start" });
            },
          }, label),
        )),
      hBeta(
        "div",
        { className: "m-panel m-setup-panel", "data-setup-section": "teams", tabIndex: -1 },
        hBeta("h2", { className: "m-section-title" }, tr("الفرق")),
        hBeta(
          "div",
          { className: "m-segment", role: "group", "aria-label": tr("عدد الفرق") },
          [2, 3, 4].map((count) =>
            hBeta(
              "button",
              { "data-design-id": "team-count",
                key: count,
                type: "button",
                className: teams.length === count ? "selected" : "",
                onClick: () => setTeamCount(count),
                "aria-pressed": teams.length === count,
              },
              tr("{v0} فرق", {v0: count}),
            ),
          ),
        ),
        hBeta(
          "div",
          { className: "m-team-inputs" },
          teams.map((team, index) =>
            hBeta(
              "label",
              {
                key: team.id,
                className: "m-team-input",
                style: { "--team-color": TEAM_STYLE[index].solid },
              },
              hBeta("span", null, tr("الفريق {v0}", {v0: index + 1})),
              hBeta("input", {
                "data-design-id": "team-name",
                value: team.name,
                onChange: (event) => setTeamName(index, event.target.value),
                maxLength: 28,
                autoComplete: "off",
              }),
            ),
          ),
        ),
      ),
      hBeta(
        "div",
        { className: "m-panel m-setup-panel" },
        hBeta("h2", { className: "m-section-title" }, tr("نمط الصعوبة")),
        hBeta(
          "div",
          { className: "m-mode-grid" },
          Object.values(logic.MODES).map((item) =>
            hBeta(
              "button",
              { "data-design-id": "mode-choice",
                key: item.id,
                type: "button",
                className: `m-choice ${mode === item.id ? "selected" : ""}`,
                onClick: () => {
                  (setMode(item.id), playSfx("click"), haptic("selection"));
                },
                "aria-pressed": mode === item.id,
              },
              hBeta("span", { className: "m-choice-icon", "aria-hidden": "true" }, item.icon),
              hBeta("b", null, tr(item.label)),
              hBeta("small", null, tr(item.description)),
            ),
          ),
        ),
        hBeta("h2", { className: "m-section-title m-top" }, tr("طول الجولة")),
        hBeta(
          "div",
          { className: "m-segment", role: "group", "aria-label": tr("عدد الأسئلة") },
          logic.ROUND_SIZES.map((size) =>
            hBeta(
              "button",
              { "data-design-id": "round-size",
                key: size,
                type: "button",
                className: roundSize === size ? "selected" : "",
                onClick: () => {
                  (setRoundSize(size), playSfx("click"));
                },
                "aria-pressed": roundSize === size,
              },
              tr("{v0} سؤالًا", {v0: size}),
            ),
          ),
        ),
        hBeta("h2", { className: "m-section-title m-top" }, tr("وقت السؤال")),
        hBeta(
          "div",
          { className: "m-segment", role: "group", "aria-label": tr("وقت السؤال") },
          [30, 60, 90].map((seconds) =>
            hBeta(
              "button",
              { "data-design-id": "timer-length",
                key: seconds,
                type: "button",
                className: timerLength === seconds ? "selected" : "",
                onClick: () => {
                  (setTimerLength(seconds), playSfx("click"));
                },
                "aria-pressed": timerLength === seconds,
              },
              tr("{v0} ثانية", {v0: seconds}),
            ),
          ),
        ),
      ),
      hBeta(
        "div",
        { className: "m-panel m-setup-panel", "data-setup-section": "categories", tabIndex: -1 },
        hBeta(
          "div",
          { className: "m-row-between" },
          hBeta("h2", { className: "m-section-title" }, tr("اختر 6 فئات")),
          hBeta(
            "b",
            { key: selectedCategories.length, className: selectedCategories.length === 6 ? "m-count ok" : "m-count" },
            `${selectedCategories.length}/6`,
          ),
        ),
        hBeta(
          "label",
          { className: "m-search" },
          hBeta("span", { className: "sr-only" }, tr("ابحث عن فئة")),
          hBeta("span", { "aria-hidden": "true" }, "🔎"),
          hBeta("input", {
            "data-design-id": "category-search",
            value: categorySearch,
            onChange: (event) => setCategorySearch(event.target.value),
            placeholder: tr("ابحث عن فئة…"),
          }),
        ),
        hBeta(
          "div",
          { className: "m-filter-row", role: "group", "aria-label": tr("تصفية الفئات") },
          filters.map(([id, label]) =>
            hBeta(
              "button",
              {
                key: id,
                type: "button",
                "data-design-id": "category-filter",
                className: categoryFilter === id ? "selected" : "",
                onClick: () => {
                  (setCategoryFilter(id), playSfx("click"));
                },
                "aria-pressed": categoryFilter === id,
              },
              label,
            ),
          ),
        ),
        !scope && hBeta(
          "div",
          { className: "m-category-actions" },
          hBeta(
            "button",
            { "data-design-id": "random-categories", type: "button", className: "m-secondary", onClick: randomCategories },
            tr("🎲 اختيار عشوائي"),
          ),
          hBeta(
            "button",
            {
              type: "button",
              className: "m-secondary",
              "data-design-id": "categories-reset",
              onClick: () => {
                (setSelectedCategories([]), playSfx("click"));
              },
            },
            tr("مسح الاختيار"),
          ),
        ),
        hBeta(
          "div",
          { className: `m-category-picker ${shuffled ? "is-shuffled" : ""}` },
          visibleCategories.map((category, categoryIndex) => {
            const selected = selectedCategories.includes(category.id),
              favorite = favorites.includes(category.id),
              locked = packLocked(category.id),
              order = selectedCategories.indexOf(category.id) + 1;
            return hBeta(
              "div",
              { key: category.id, className: `m-category-pick ${selected ? "selected" : ""}${locked ? " is-locked" : ""}`, style: { "--k": categoryIndex } },
              hBeta(
                "button",
                { "data-design-id": "category-card",
                  type: "button",
                  className: "m-category-main",
                  onClick: () => toggleCategory(category.id),
                  "aria-pressed": selected,
                  // الزر يبقى قابلًا للنقر (النقر يفتح الجدار) لكنه يُعلن معطّلًا لقارئ الشاشة.
                  "aria-disabled": locked || scope ? "true" : undefined,
                  "aria-label": locked
                    ? tr("فئة {v0} ضمن ميدان بلس", {v0: category.name})
                    : tr("{v0} فئة {v1}", {v0: selected ? tr("إلغاء") : tr("اختيار"), v1: category.name}),
                },
                selected && hBeta("span", { className: "m-order-badge" }, order),
                hBeta(CategoryCover, { id: category.id, icon: category.icon }),
                hBeta("b", null, category.name),
                locked && hBeta("span", { className: "m-lock" }, tr("🔒 بلس")),
                hBeta("small", null, tr("حتى {v0}", {v0: modeTopTier(activeMode)})),
              ),
              hBeta(
                "button",
                { "data-design-id": "favorite",
                  type: "button",
                  className: "m-favorite",
                  onClick: () => toggleFavorite(category.id),
                  "aria-label": favorite
                    ? tr("إزالة {v0} من المفضلة", {v0: category.name})
                    : tr("إضافة {v0} إلى المفضلة", {v0: category.name}),
                  "aria-pressed": favorite,
                },
                hBeta("span", { key: favorite ? "on" : "off", "aria-hidden": "true" }, favorite ? "★" : "☆"),
              ),
            );
          }),
        ),
        visibleCategories.length === 0 &&
          hBeta("p", { className: "m-empty" }, tr("لا توجد فئات مطابقة.")),
        hBeta(
          "div",
          { className: "m-history-note" },
          hBeta("span", null, tr("لُعب {v0} سؤالًا من البنك الحالي؛ الجديد له الأولوية.", {v0: currentQuestionHistoryCount(CATS, history)})),
          hBeta(
            "button",
            { "data-design-id": "clear-history", type: "button", className: "m-link", onClick: clearQuestionHistory },
            tr("تصفير السجل"),
          ),
        ),
      ),
      selectedMediaUrls.length > 0 && hBeta(OfflineMediaRowBeta, { offlineMedia, count: selectedMediaUrls.length, onDownload: downloadSelectedMedia }),
      setupError && hBeta("p", { className: "m-error", role: "alert" }, setupError),
      hBeta(
        "button",
        { "data-design-id": "start", "data-design-required": "true",
          type: "button",
          className: `m-primary m-large m-sticky-action ${selectedCategories.length === 6 ? "is-armed" : ""}`,
          onClick: beginGame,
          disabled: selectedCategories.length !== 6 || rewardBusy,
        },
        tr("ابدأ {v0} سؤالًا · {v1}", {v0: roundSize, v1: tr(activeMode.label)}),
      ),
    );
  }
  // الحزم ذات الوسائط تحتاج الإنترنت أول مرة فقط؛ هذا الزر يجلبها مقدّمًا
  // ويضعها في مخزن العامل الخدمي، فتُلعب بعدها بلا شبكة. لا يظهر للحزم النصية.
  const selectedMediaUrls = useMemo(() => {
    const urls = [];
    for (const categoryId of selectedCategories) {
      const category = CATS.find((item) => item.id === categoryId);
      if (!category) continue;
      for (const question of category.qs) urls.push(...questionMedia(question, categoryId));
    }
    return [...new Set(urls)];
  }, [selectedCategories, CATS]);

  // تنزيل وسائط الفئات المختارة (زر «حمّل» في صف الوسائط دون إنترنت).
  async function downloadSelectedMedia() {
    const count = selectedMediaUrls.length;
    setOfflineMedia({ state: "busy", done: 0, total: count });
    const result = await cacheForOffline(selectedMediaUrls, {
      onProgress: ({ done: n, total: t }) =>
        setOfflineMedia({ state: "busy", done: n, total: t || count }),
    });
    setOfflineMedia({
      state: result && result.failed ? "error" : result && result.offlineReady ? "done" : "unsupported",
      done: count,
      total: count,
    });
  }

  function BoardScreen() {
    return hBeta(
      "section",
      { className: "m-screen" },
      hBeta(
        "header",
        { "data-design-id": "header", className: "m-board-header" },
        hBeta(
          "div",
          null,
          hBeta(
            "div",
            { className: "m-kicker" },
            tr("{v0} {v1} · {v2} سؤالًا", {v0: activeMode.icon, v1: tr(activeMode.label), v2: roundSize}),
          ),
          hBeta(
            "div",
            { className: "m-current-turn", style: { "--team-color": TEAM_STYLE[turn].solid } },
            hBeta("span", { "aria-hidden": "true" }),
            hBeta("b", null, tr("الدور الآن: {v0}", {v0: teams[turn].name})),
          ),
        ),
        hBeta(
          "div",
          { className: "m-header-actions" },
          SoundButton(),
          hBeta(
            "button",
            { "data-design-id": "scoreboard",
              type: "button",
              className: "m-icon-btn",
              onClick: () => setShowScore(!0),
              "aria-label": tr("فتح النتائج وتعديل النقاط"),
            },
            "📊",
          ),
        ),
      ),
      TeamScoreCards({}),
      hBeta(
        "div",
        { className: "m-board-grid" },
        selectedCategories.map((categoryId, categoryIndex) => {
          const category = CATS.find((item) => item.id === categoryId),
            questions = deck[categoryId] || [];
          return hBeta(
            "article",
            { key: categoryId, className: "m-board-category", style: { "--i": categoryIndex } },
            hBeta(
              "h2",
              null,
              hBeta("span", { "aria-hidden": "true" }, category.icon),
              " ",
              category.name,
            ),
            hBeta(
              "div",
              { className: "m-question-buttons" },
              questions.map((question, index) => {
                const done = !!used[question.qid];
                return hBeta(
                  "button",
                  { "data-design-id": "tier",
                    key: question.qid,
                    type: "button",
                    className: `m-tier m-tier-${question.p} ${done ? "done" : ""} ${launchQid === question.qid ? "is-launch" : ""}`,
                    style: { "--n": index },
                    disabled: done,
                    onClick: () => openQuestion(categoryId, index),
                    "aria-label": tr("{v0}، سؤال {v1} نقطة{v2}", {v0: category.name, v1: question.p, v2: done ? tr("، مستخدم") : ""}),
                  },
                  hBeta("b", { dir: "ltr" }, question.p),
                  hBeta("small", null, done ? tr("تم") : tr(MAYDAN_TIER_LABELS[question.p])),
                );
              }),
            ),
          );
        }),
      ),
      hBeta(
        "div",
        { className: "m-progress-wrap" },
        hBeta(
          "div",
          {
            className: "m-progress",
            role: "progressbar",
            "aria-valuemin": 0,
            "aria-valuemax": totalQuestions,
            "aria-valuenow": usedCount,
          },
          hBeta("span", {
            style: { width: `${totalQuestions ? (usedCount / totalQuestions) * 100 : 0}%` },
          }),
        ),
        hBeta("small", null, tr("{v0} من {v1} سؤالًا", {v0: usedCount, v1: totalQuestions})),
      ),
      hBeta(
        "div",
        { "data-design-id": "actions", className: "m-board-actions" },
        hBeta(
          "button",
          { "data-design-id": "undo",
            type: "button",
            className: "m-secondary",
            onClick: undoLastAction,
            disabled: !lastAction,
          },
          tr("↶ تراجع{v0}", {v0: lastAction ? `: ${lastAction.label}` : ""}),
        ),
        confirmEnd
          ? hBeta(
              "div",
              { className: "m-confirm-inline" },
              hBeta("span", null, tr("إنهاء المباراة؟")),
              hBeta(
                "button",
                { "data-design-id": "finish", type: "button", className: "m-danger", onClick: () => finishGame(!0) },
                tr("نعم"),
              ),
              hBeta(
                "button",
                { "data-design-id": "cancel", "data-design-required": "true", type: "button", className: "m-secondary", onClick: () => setConfirmEnd(!1) },
                "لا",
              ),
            )
          : hBeta(
              "button",
              { "data-design-id": "finish", type: "button", className: "m-link", onClick: () => setConfirmEnd(!0) },
              tr("إنهاء المباراة"),
            ),
      ),
    );
  }
  // زر إخفاء/إظهار الإجابة بعد كشفها؛ لوحة الحسم تبقى ظاهرة في الحالتين.
  function AnswerToggle() {
    return hBeta(
      "button",
      { "data-design-id": "answer-toggle",
        type: "button",
        className: "m-secondary m-small m-answer-toggle",
        onClick: toggleAnswerHidden,
        "aria-pressed": answerHidden,
      },
      hBeta("span", { "aria-hidden": "true" }, answerHidden ? "👁" : "🙈"),
      answerHidden ? tr(" إظهار الإجابة") : tr(" إخفاء الإجابة"),
    );
  }
  function QuestionScreen() {
    if (!currentQuestion || !currentCategory) return null;
    const prompt = tr(TYPE_PROMPT[currentQuestion.type]),
      assistance = questionAssistance(currentQuestion),
      questionAward = pointsAfterHints(currentQuestion.p, hintsUsed),
      fraction = Math.max(0, Math.min(1, timeLeft / timerLength)),
      danger = timeLeft <= 10;
    return hBeta(
      "section",
      { className: "m-screen m-question-screen" },
      hBeta(
        "header",
        { "data-design-id": "header", className: "m-question-header" },
        hBeta(
          "button",
          { "data-design-id": "cancel", "data-design-required": "true",
            type: "button",
            className: "m-secondary m-small",
            onClick: cancelQuestion,
            disabled: revealed,
          },
          tr("إلغاء السؤال"),
        ),
        hBeta(
          "div",
          { "data-design-id": "category", className: "m-question-meta" },
          hBeta("span", null, `${currentCategory.icon} ${currentCategory.name}`),
          hBeta(
            "b",
            { className: `m-tier-text m-tier-text-${currentQuestion.p}` },
            // مفتاحان على الرقم والتفصيل فقط: إعادة التصيير كل 250ms لا تعيد الحركة
            hBeta("span", { key: questionAward, className: "m-award", dir: "ltr" }, questionAward),
            tr(" نقطة"),
            hBeta(
              "small",
              { key: `${effect.double ? "x2" : "x1"}-${hintsUsed}` },
              // «×2» لا تنطبق على السرقة، والتلميحات تخصم ٢٥٪ لكل واحد: الرقم أعلاه
              // هو ما سيُمنح فعلًا لفريق الدور، والتفصيل هنا.
              effect.double
                ? tr("×2 لصاحب الدور · {v0}", {v0: questionAward * 2})
                : hintsUsed > 0
                  ? tr("بعد {v0} · الأصل {v1}", {v0: hintsUsed === 1 ? tr("تلميح") : hintsUsed === 2 ? tr("تلميحين") : `${hintsUsed} تلاميح`, v1: currentQuestion.p})
                  : tr(MAYDAN_TIER_LABELS[currentQuestion.p]),
            ),
          ),
        ),
        SoundButton(),
      ),
      hBeta(
        "div", { className: "m-question-status" },
        hBeta("div",
          { "data-design-id": "turn", className: "m-turn-banner", style: { "--team-color": TEAM_STYLE[turn].solid } },
          hBeta("span", { "aria-hidden": "true" }),
          hBeta("strong", null, tr("السؤال لـ {v0}", {v0: teams[turn].name})),
          effect.two && hBeta("b", null, tr("جوابان مفعّلان")),
        ),
        hBeta(
          "div",
          {
            className: `m-timer ${danger ? "danger" : ""} ${paused ? "paused" : ""} ${timerFx} ${!revealed && timeLeft <= 0 ? "is-out" : ""}`,
            style: { "--timer-fill": `${fraction * 360}deg` },
          },
          hBeta(
            "div",
            {
              "data-design-id": "timer", className: "m-timer-inner",
              role: "timer",
              "aria-live": [10, 5, 0].includes(timeLeft) ? "assertive" : "off",
              "aria-label": tr("{v0} ثانية متبقية", {v0: timeLeft}),
            },
            // الرقم يُعاد تركيبه كل ثانية في العشر الأخيرة فقط (نبضة)، والمفتاح ثابت قبلها
            hBeta("b", { dir: "ltr" }, hBeta("span", { key: danger ? timeLeft : "n" }, timeLeft)),
            paused && hBeta("small", null, tr("متوقف")),
          ),
        ),
        !revealed && timeLeft > 0 && hBeta(
          "button",
          { "data-design-id": "pause", type: "button", className: "m-secondary m-pause", onClick: togglePause },
          paused ? tr("▶ متابعة الوقت") : tr("⏸ إيقاف مؤقت"),
        ),
      ),
      !revealed &&
        timeLeft <= 0 &&
        hBeta("p", { className: "m-timeout", role: "alert" }, tr("انتهى الوقت ⏰")),
      hBeta(
        "article",
        { "data-design-id": "question", className: `m-question-card ${revealed ? "is-revealed" : ""}` },
        prompt && hBeta("p", { className: "m-prompt" }, prompt),
        !revealed && assistance && (assistance.context || assistance.shape) && hBeta(
          "aside",
          { "data-design-id": "assistance", className: "m-question-assistance", "aria-label": tr("مساعدة خفيفة بلا خصم نقاط") },
          assistance.context && hBeta("span", null, assistance.context),
          assistance.shape && hBeta("small", null, assistance.shape),
        ),
        QuestionVisual({ question: currentQuestion, packId: current ? current.categoryId : null, revealed: answerShown, hintsUsed, mixedItems,
          onHint: () => { setHintsUsed((n) => n + 1); playSfx("click"); }, onPlaySound: playQuestionSound,
          soundOn: effectiveSoundOn, volume: platformSettings?.soundVolume, sound: api?.sound, onSfx: playSfx }),
        revealed &&
          (answerShown
            ? hBeta(
                "div",
                { "data-design-id": "answer", className: "m-answer", role: "status" },
                hBeta("small", null, tr("الإجابة")),
                hBeta("strong", null, answerText(currentQuestion)),
                // الصيغ المقبولة الأخرى (اسم بلغتين، لقب) تظهر للمضيف كي لا يظلم إجابة صحيحة بصياغة مختلفة
                Array.isArray(currentQuestion.alt) &&
                  currentQuestion.alt.length > 0 &&
                  hBeta("span", { className: "m-answer-alt" }, tr("يُقبل أيضًا: {v0}", {v0: currentQuestion.alt.join(" · ")})),
                AnswerToggle(),
              )
            : hBeta(
                "div",
                { className: "m-answer is-hidden", role: "status" },
                hBeta("small", null, tr("الإجابة مخفية")),
                hBeta("strong", { "aria-hidden": "true" }, "• • •"),
                AnswerToggle(),
              )),
      ),
      !revealed &&
        hBeta(
          "div",
          { "data-design-id": "tools", className: `m-tools ${timeLeft <= 0 ? "is-out" : ""}` },
          hBeta("p", null, tr("وسائل {v0}", {v0: teams[turn].name})),
          hBeta(
            "div",
            null,
            TOOLS.map((tool) => {
              const available = teams[turn].tools[tool.id] && timeLeft > 0;
              return hBeta(
                "button",
                { "data-design-id": "tool",
                  key: tool.id,
                  type: "button",
                  className: `${available ? "" : "used"} ${effect[tool.id] ? "active" : ""}`,
                  disabled: !available,
                  onClick: () => spendTool(tool.id),
                  title: tr(tool.hint),
                },
                hBeta("span", { "aria-hidden": "true" }, tool.icon),
                hBeta("b", null, tr(tool.label)),
                hBeta("small", null, effect[tool.id] ? tr("مفعّلة") : available ? tr("متاحة") : tr("استُخدمت")),
              );
            }),
          ),
        ),
      revealed
        ? hBeta(
            "div",
            { "data-design-id": "judge", className: "m-judge" },
            hBeta(
              "div",
              { className: "m-row-between" },
              hBeta(
                "h2",
                null,
                currentQuestion.type === "closest" ? tr("من كان الأقرب؟") : tr("من أجاب إجابة صحيحة؟"),
              ),
              hBeta(
                "button",
                { "data-design-id": "report", "data-design-required": "true",
                  type: "button",
                  className: "m-link",
                  onClick: () =>
                    setReportQuestion({
                      categoryId: current.categoryId,
                      question: currentQuestion,
                    }),
                },
                tr("⚑ بلّغ عن السؤال"),
              ),
            ),
            hBeta(
              "div",
              { "data-design-id": "options-list", className: "m-judge-grid" },
              teams.map((team, index) =>
                hBeta(
                  "button",
                  { "data-design-id": "judge-team",
                    key: team.id,
                    type: "button",
                    style: { "--team-color": TEAM_STYLE[index].solid },
                    onClick: () => judgeQuestion(index),
                  },
                  hBeta("span", { "aria-hidden": "true" }, "✓"),
                  hBeta("b", null, team.name),
                  hBeta(
                    "small",
                    null,
                    index === turn && effect.double
                      ? tr("إجابة صحيحة · نقاط مضاعفة")
                      : currentQuestion.type !== "closest" && index !== turn
                        ? tr("إجابة صحيحة · سرقة")
                        : tr("إجابة صحيحة"),
                  ),
                ),
              ),
            ),
            hBeta(
              "button",
              { "data-design-id": "judge-nobody",
                type: "button",
                className: "m-secondary m-nobody",
                onClick: () => judgeQuestion(null),
              },
              tr("لم يجب أحد"),
            ),
          )
        : hBeta(
            "button",
            { "data-design-id": "reveal",
              type: "button",
              className: "m-primary m-large m-reveal-action",
              onClick: revealAnswer,
            },
            hBeta("span", { "aria-hidden": "true" }, "◉"),
            tr(" أظهر الإجابة"),
          ),
    );
  }
  function ResultScreen() {
    const record = finalResult || results[0];
    if (!record) return HomeScreen();
    const winners = record.winner
      ? [record.winner]
      : record.teams
          .filter((team) => team.score === Math.max(...record.teams.map((team2) => team2.score)))
          .map((team) => team.name);
    return hBeta(
      "section",
      { className: "m-result" },
      hBeta(Podium, { entries: record.teams, title: record.winner ? tr("فاز {v0}", {v0: winners[0]}) : tr("تعادل جميل!") }),
      hBeta("p", { className: "m-kicker" }, record.early ? tr("انتهت المباراة مبكرًا") : tr("اكتملت الجولة")),
      hBeta("div", { className: "m-result-statistics" }, record.teams.map((team) =>
        hBeta("div", { key: team.id },
          hBeta("span", { className: "clay-stage clay-static no-contact" }, hBeta("span", { className: "clay-lift" }, hBeta(Avatar, { player: team }))),
          hBeta("b", null, team.name),
          hBeta("small", null, tr("إجابات: {v0} · سرقات: {v1}", {v0: team.correct, v1: team.steals}))),
      )),
      hBeta(
        "p",
        { className: "m-muted" },
        tr("{v0} من {v1} سؤالًا · {v2}", {v0: record.answered, v1: record.total, v2: logic.MODES[record.mode] ? tr(logic.MODES[record.mode].label) : tr("بَديهة")}),
      ),
      hBeta(
        "div",
        { "data-design-id": "actions", className: "m-result-actions" },
        hBeta(
          "button",
          { "data-design-id": "start", "data-design-required": "true", type: "button", className: "m-primary m-large", disabled: rewardBusy, onClick: beginGame },
          tr("إعادة بنفس الإعدادات"),
        ),
        scope && setupError && hBeta("p", { className: "m-error", role: "alert" }, setupError),
        scope && hBeta("button", { type: "button", className: "m-secondary", disabled: rewardBusy, onClick: () => api.navigate("/game/badeeha?mode=local", { replace: true }) }, tr("العودة إلى تحدّي اللمّة")),
        hBeta(
          "button",
          { "data-design-id": "share-result", type: "button", className: "m-secondary", onClick: shareResult },
          tr("مشاركة النتيجة"),
        ),
        hBeta(
          "div",
          { className: "m-two" },
          hBeta(
            "button",
            { "data-design-id": "setup", type: "button", className: "m-secondary", onClick: () => setScreen("setup") },
            tr("لعبة جديدة"),
          ),
          hBeta(
            "button",
            { "data-design-id": "history", type: "button", className: "m-secondary", onClick: () => setScreen("history") },
            tr("سجل النتائج"),
          ),
        ),
      ),
    );
  }
  function HistoryScreen() {
    const leaderboard = {};
    results.forEach((result) =>
      result.teams.forEach((team) => {
        const key = logic.normalizeTeamName(team.name),
          item = leaderboard[key] || { name: team.name, games: 0, wins: 0, points: 0 };
        ((item.games += 1),
          (item.points += team.score),
          result.winner && logic.normalizeTeamName(result.winner) === key && (item.wins += 1),
          (leaderboard[key] = item));
      }),
    );
    const honor = Object.values(leaderboard)
      .sort((left, right) => right.wins - left.wins || right.points - left.points)
      .slice(0, 10);
    return hBeta(
      "section",
      { className: "m-screen" },
      Header({ title: tr("النتائج والتقارير"), back: () => setScreen(landingScreen, "back") }),
      hBeta(
        "div",
        { className: "m-panel" },
        hBeta("h2", { className: "m-section-title" }, tr("لوحة الشرف")),
        honor.length
          ? hBeta(
              "div",
              { className: "m-honor" },
              honor.map((item, index) =>
                hBeta(
                  "div",
                  { key: logic.normalizeTeamName(item.name) },
                  hBeta("span", null, ["🥇", "🥈", "🥉"][index] || index + 1),
                  hBeta("b", null, item.name),
                  hBeta("small", null, tr("{v0} فوز · {v1} مباراة", {v0: item.wins, v1: item.games})),
                  hBeta("strong", null, item.points),
                ),
              ),
            )
          : hBeta("p", { className: "m-empty" }, tr("تظهر لوحة الشرف بعد أول مباراة.")),
      ),
      hBeta(
        "div",
        { className: "m-panel" },
        hBeta(
          "div",
          { className: "m-row-between" },
          hBeta("h2", { className: "m-section-title" }, tr("آخر المباريات")),
          results.length > 0 &&
            hBeta(
              "button",
              { "data-design-id": "clear-results", type: "button", className: "m-link", onClick: clearResults },
              tr("مسح السجل"),
            ),
        ),
        results.length
          ? hBeta(
              "div",
              { className: "m-games-list" },
              results.slice(0, 20).map((result) =>
                hBeta(
                  "article",
                  { key: result.id },
                  hBeta(
                    "div",
                    { className: "m-row-between" },
                    hBeta("small", null, result.date),
                    hBeta("small", null, `${result.answered}/${result.total}`),
                  ),
                  hBeta(
                    "div",
                    null,
                    result.teams.map((team) =>
                      hBeta(
                        "span",
                        {
                          key: `${result.id}-${team.id || team.name}`,
                          className: result.winner === team.name ? "winner" : "",
                        },
                        `${result.winner === team.name ? "🏆 " : ""}${team.name}: ${team.score}`,
                      ),
                    ),
                  ),
                ),
              ),
            )
          : hBeta("p", { className: "m-empty" }, tr("لا توجد مباريات محفوظة بعد.")),
      ),
      hBeta(
        "div",
        { className: "m-panel" },
        hBeta(
          "div",
          { className: "m-row-between" },
          hBeta("h2", { className: "m-section-title" }, tr("بلاغات الأسئلة")),
          hBeta("b", { className: "m-count" }, reports.length),
        ),
        hBeta(
          "p",
          { className: "m-muted" },
          tr("تُحفظ البلاغات على هذا الجهاز لتجميع ملاحظات النسخة التجريبية."),
        ),
        reports.length > 0 &&
          hBeta(
            "button",
            { "data-design-id": "share-reports", type: "button", className: "m-secondary m-full", onClick: shareReports },
            tr("مشاركة تقرير الاختبار"),
          ),
      ),
    );
  }
  function RulesModal() {
    return hBeta(
      MaydanModal,
      { title: tr("كيف نلعب؟"), onClose: () => setShowRules(!1) },
      hBeta(
        "ol",
        { className: "m-rules" },
        hBeta("li", null, tr("أنشئ من فريقين إلى أربعة بأسماء مختلفة، ثم اختر ست فئات.")),
        hBeta("li", null, tr("اختر الجولة: 20 سريعة، 30 متوسطة، أو 60 كاملة.")),
        hBeta("li", null, tr("الوضع العائلي يصل إلى 600، التحدّي يضيف 800، والخبراء يضيف 1000.")),
        hBeta("li", null, tr("800 صعب جدًا، و1000 مستوى مستحيل؛ لا يظهران إلا في الوضع المناسب.")),
        hBeta(
          "li",
          null,
          tr("بعد كشف الإجابة، اختر الفريق الذي أجاب، ويمكنك إخفاء الإجابة وإظهارها متى شئت. في «الأقرب» لا تُحسب الإجابة سرقة."),
        ),
        hBeta("li", null, tr("لكل فريق: مضاعفة النقاط، جوابان، و30 ثانية إضافية؛ كل أداة مرة واحدة.")),
        hBeta(
          "li",
          null,
          tr("يمكن إلغاء السؤال قبل كشف الإجابة، والتراجع عن آخر نتيجة أو تعديل النقاط يدويًا."),
        ),
        hBeta("li", null, tr("تُحفظ المباراة تلقائيًا، ويمكن متابعتها بعد إغلاق التطبيق.")),
      ),
      hBeta(
        "button",
        { "data-design-id": "rules", type: "button", className: "m-primary m-full", onClick: () => setShowRules(!1) },
        tr("فهمت"),
      ),
    );
  }
  function ScoreModal() {
    return hBeta(
      MaydanModal,
      { title: tr("النتائج وتعديل النقاط"), onClose: () => setShowScore(!1), bottom: !0 },
      TeamScoreCards({ detailed: !0 }),
      hBeta(
        "div",
        { className: "m-adjust-list" },
        teams.map((team, index) =>
          hBeta(
            "div",
            { key: team.id },
            hBeta("b", null, team.name),
            hBeta(
              "button",
              { "data-design-id": "score-minus",
                type: "button",
                className: "m-danger",
                onClick: () => adjustScore(index, -100),
                "aria-label": tr("خصم 100 من {v0}", {v0: team.name}),
              },
              "−100",
            ),
            hBeta(
              "button",
              { "data-design-id": "score-plus",
                type: "button",
                className: "m-success",
                onClick: () => adjustScore(index, 100),
                "aria-label": tr("إضافة 100 إلى {v0}", {v0: team.name}),
              },
              "+100",
            ),
          ),
        ),
      ),
      hBeta(
        "button",
        { "data-design-id": "undo",
          type: "button",
          className: "m-secondary m-full",
          onClick: undoLastAction,
          disabled: !lastAction,
        },
        tr("↶ تراجع عن آخر تعديل"),
      ),
    );
  }
  function ReportModal() {
    const reasons = [
      tr("معلومة أو إجابة خاطئة"),
      tr("السؤال غامض"),
      tr("الصعوبة في غير مكانها"),
      tr("مشكلة في الصورة أو الصوت"),
    ];
    return hBeta(
      MaydanModal,
      { title: tr("بلاغ عن السؤال"), onClose: () => setReportQuestion(null) },
      hBeta("p", { className: "m-muted" }, tr("اختر سبب البلاغ. سيُحفظ محليًا ضمن تقرير الاختبار.")),
      hBeta(
        "div",
        { className: "m-report-reasons" },
        reasons.map((reason) =>
          hBeta(
            "button",
            { "data-design-id": "report", "data-design-required": "true",
              key: reason,
              type: "button",
              className: "m-secondary",
              onClick: () => submitReport(reason),
            },
            reason,
          ),
        ),
      ),
    );
  }
  function ClearModal() {
    const history = pendingClear === "history";
    return hBeta(
      MaydanModal,
      { title: history ? tr("تصفير سجل الأسئلة") : tr("مسح سجل النتائج"), onClose: () => setPendingClear(null) },
      hBeta("p", { className: "m-muted" }, history ? tr("هل تريد تصفير سجل الأسئلة التي لُعبت؟") : tr("هل تريد مسح سجل النتائج؟")),
      hBeta(
        "div",
        { className: "m-report-reasons" },
        hBeta(
          "button",
          { "data-design-id": history ? "clear-history" : "clear-results", type: "button", className: "m-danger", onClick: confirmClear },
          history ? tr("نعم، صفّر السجل") : tr("نعم، امسح النتائج"),
        ),
        hBeta(
          "button",
          { "data-design-id": "cancel", "data-design-required": "true", type: "button", className: "m-secondary", onClick: () => setPendingClear(null) },
          "لا",
        ),
      ),
    );
  }
  let content = null;
  return (
    screen === "home"
      ? (content = HomeScreen())
      : screen === "setup"
        ? (content = SetupScreen())
        : screen === "board"
          ? (content = BoardScreen())
          : screen === "question"
            ? (content = QuestionScreen())
            : screen === "result"
              ? (content = ResultScreen())
              : screen === "history" && (content = HistoryScreen()),
    hBeta(
      "div",
      { dir: localeDirection(getUiLocale()), className: `m-root m-screen-${screen}`, "data-dir": navDir, "data-design-screen": `badeeha.${screen}` },
      hBeta(PresentationStyles, { sheet: MAYDAN_BETA_CSS }),
      // مفتاح الشاشة يعيد تركيب القسم فتعمل حركة الدخول عند كل انتقال (كلها عناصر section)
      hBeta(React.Fragment, { key: screen }, roundLoading ? hBeta(
        "section", { className: "m-round-loading", "aria-busy": "true", "aria-label": tr("تجهيز الجولة") },
        hBeta(GameArtwork, { game: "badeeha" }),
        hBeta("h2", null, tr("نجهّز أسئلتكم")),
        hBeta("p", { role: "status" }, tr("تحميل {v0} من {v1} ملفًا", {v0: roundLoading.done.toLocaleString(getUiLocale()), v1: roundLoading.total.toLocaleString(getUiLocale())})),
        hBeta("progress", { max: roundLoading.total, value: roundLoading.done, "aria-label": tr("تحميل وسائط الجولة") }),
        hBeta("button", { "data-design-id": "continue", "data-design-required": "true", type: "button", className: "m-secondary", onClick: skipRoundLoading }, tr("متابعة اللعب الآن")),
      ) : content),
      showRules && RulesModal(),
      showScore && ScoreModal(),
      reportQuestion && ReportModal(),
      pendingClear && ClearModal(),
      notice && hBeta("div", { className: `m-toast ${noticeLeaving ? "is-leaving" : ""}`, role: "status" }, notice),
      !hydrated &&
        hBeta("div", { className: "m-hydrating", "aria-label": tr("جارٍ استعادة البيانات") }, "…"),
    )
  );
}


export default MaydanBeta;
