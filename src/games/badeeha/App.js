import { Avatar, GameArtwork } from '../../shared/brand/art.jsx';
import { Podium } from '../../shared/ui/components.jsx';
// طبقات التأثير المشتركة (ختم/وميض/تظليل) تعيش في document.body لا في شجرة الشاشة،
// و wait() تصفّر كل مهلة بصرية تحت «تقليل الحركة».
import { flashScreen, stampScreen, vignette, wait, burstConfetti, confetti as confettiFx } from '../../shared/fx/index.js';
// لعبة «بَديهة» (ميدان سابقًا) — الكود الأصلي منقول كما هو بأسلوب React.createElement.
// التعديلات الوحيدة: الاستيرادات أعلاه بدل المتغيرات العامة، اسم اللعبة في النصوص،
// ومفاتيح التخزين تحت النطاق maydan:badeeha (انظر keys.js).
import React from "../../design/react.js";
import { socialInterruption } from '../../social/interruption.js';
import { CATS } from "../../data/categories/index.js";
import MAYDAN_BETA_CSS from "./styles.css";
import MaydanLogicBeta, {
  filterCategories,
  pointsAfterHints,
  modeTopTier,
  HINT_COST_PERCENT,
  BANK_CONTENT_VERSION,
  currentQuestionHistoryCount,
} from "./logic.js";
import { BADEEHA_KEYS as MAYDAN_BETA_KEYS } from "./keys.js";
import { readBadeehaState, RETIRED_GAME_NOTICE } from "./persistence.js";
import { questionAssistance } from "./assistance.js";
import { CategoryCover } from "./Cover.jsx";
import { FREE_PACKS } from "../../shared/account/config.js";
import { questionMedia, deckMedia } from "../../shared/media/resolve.js";
import { arabicNormalize } from "../../shared/lib/arabicNormalize.js";
import {
  preloadMedia,
  cacheForOffline,
  isLoaded as mediaIsLoaded,
} from "../../shared/media/preload.js";

import { TOOLS, TEAM_STYLE, TOTAL_Q, HAS_MEDIA, TYPE_PROMPT, answerText, MAYDAN_TIER_LABELS } from "./constants.js";
import { betaTeam, betaCloneTeams } from "./teams.js";
import { saveBadeehaKey, removeBadeehaKey, betaNativeMessage } from "./device.js";
import { getCtx, SFX, SOUND_RECIPES, closeSoundContext } from "./sounds.js";
import { Flag } from "./Flag.js";
import { MaydanModal } from "./Modal.js";
import { MediaBox, MediaImage, MediaAudio, FourPics, MediaVideo } from "./media.js";
import { ScorePoints, OfflineMediaRowBeta } from "./parts.js";

const { useState, useEffect, useRef, useMemo, useCallback } = React;

var hBeta = React.createElement;

// مقارنة الإجابات بالموحّد نفسه الذي يستعمله bank:validate، فما يقبله المدقّق
// خيارًا صحيحًا تُبرزه الشاشة حتمًا.
const arabicKey = arabicNormalize;


function MaydanBeta({ api } = {}) {
  const designPreview = api?.designPreview || null;
  const isDesignPreview = !!designPreview;
  const saveKey = useCallback((key, value) => isDesignPreview ? Promise.resolve() : saveBadeehaKey(key, value), [isDesignPreview]);
  const betaRemoveKey = useCallback((key) => isDesignPreview ? undefined : removeBadeehaKey(key), [isDesignPreview]);
  const logic = MaydanLogicBeta,
    [hydrated, setHydrated] = useState(!!designPreview),
    [screen, setScreenState] = useState(designPreview?.screen || "home"),
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
    [selectedCategories, setSelectedCategories] = useState(designPreview?.selectedCategories || []),
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
    // الاستحقاقات تصل من شاشة اللعب عبر api.account؛ بلا مزوّد لا قفل إطلاقًا.
    account = (api && api.account) || null,
    premium = !!(account && account.premium),
    packLocked = (categoryId) => !!account && account.lockedPack(categoryId);
  pausedRef.current = paused;
  // سقوط الاشتراك (انتهاء أو خروج) يسحب الحزم المقفولة من الاختيار كي لا تبدأ مباراة بها.
  useEffect(() => {
    if (premium) return;
    setSelectedCategories((existing) =>
      existing.some((categoryId) => packLocked(categoryId))
        ? existing.filter((categoryId) => !packLocked(categoryId))
        : existing,
    );
  }, [premium]); // eslint-disable-line react-hooks/exhaustive-deps
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
      if (result.failed) toast("بعض الوسائط لم تُحمّل؛ يمكنك إعادة المحاولة عند فتح السؤال");
      playSfx("start");
    } catch {
      if (!controller.signal.aborted) toast("تعذّر تجهيز بعض الوسائط؛ يمكنك إعادة المحاولة من السؤال");
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
    toast("بدأت الجولة؛ الوسائط غير الجاهزة ستُحمّل عند فتحها");
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
          (await navigator.clipboard.writeText(text), toast("تم نسخ النص"));
          return;
        }
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
      toast("تعذرت المشاركة على هذا الجهاز");
    }
  }
  (useEffect(() => {
    if (isDesignPreview) return undefined;
    let cancelled = !1;
    return (
      (async () => {
        const restored = readBadeehaState(CATS);
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
  }, [isDesignPreview, betaRemoveKey, logic.MODES, logic.ROUND_SIZES]),
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
    ]),
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
      toast("احسم نتيجة السؤال أولًا");
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
                ? (revealed ? toast("احسم نتيجة السؤال أولًا") : cancelQuestion(), !0)
                : screen === "board"
                  ? (setConfirmEnd(!0), !0)
                  : screen !== "home"
                    ? (setScreen("home", "back"), !0)
                    : !1),
      () => {
        delete window.maydanBack;
      }
    ),
    [screen, revealed, reportQuestion, pendingClear, showScore, showRules, questionBaseTeams],
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
    // حزمة مقفولة: النقر يفتح جدار «ميدان بلس» بدل أن يختارها (وإلغاء اختيار قديم يبقى ممكنًا).
    if (packLocked(categoryId) && !selectedCategories.includes(categoryId)) {
      (account.openPaywall({ reason: "pack", pack: categoryId }), playSfx("click"));
      return;
    }
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
  // مرشّح «مجاني» لا يعرفه logic.js (وهو لا يُمسّ): نمرّر "all" ثم نقصر النتيجة على الحزم المجانية.
  const visibleCategories = filterCategories(CATS, {
    filter: categoryFilter === "free" ? "all" : categoryFilter,
    search: categorySearch,
    favorites,
  }).filter((category) => categoryFilter !== "free" || FREE_PACKS.includes(category.id));
  function randomCategories() {
    // الاختيار العشوائي لا يسحب حزمة مقفولة أبدًا: نستبعدها من البركة قبل الخلط.
    const pool = visibleCategories.filter((category) => !packLocked(category.id));
    if (pool.length < 6) {
      setSetupError("الفئات المتاحة أقل من ست؛ اشترك في ميدان بلس أو وسّع التصفية");
      return;
    }
    (setSelectedCategories(
      logic.shuffled(pool.map((category) => category.id)).slice(0, 6),
    ),
      setSetupError(""),
      pulseFx("shuffle", setShuffled, !0, 600, !1),
      playSfx("tool"));
  }
  function beginGame() {
    const validation = logic.validateTeamNames(teams.map((team) => team.name));
    if (!validation.ok) {
      setSetupError(validation.message);
      return;
    }
    if (selectedCategories.length !== 6) {
      setSetupError("اختر ست فئات بالضبط");
      return;
    }
    // حزمة مقفولة بقيت في الاختيار (لقطة قديمة أو سقوط اشتراك): جدار قبل بناء اللوحة.
    if (selectedCategories.some((categoryId) => packLocked(categoryId))) {
      (setSetupError("بعض الفئات المختارة ضمن ميدان بلس"), account.openPaywall({ reason: "pack" }));
      return;
    }
    let nextDeck;
    try {
      nextDeck = logic.buildDeck(CATS, selectedCategories, history, activeMode.tiers, roundSize);
    } catch (error) {
      setSetupError(error.message || "تعذر تجهيز الجولة");
      return;
    }
    const freshTeams = teams.map((team, index) => betaTeam(index, validation.names[index]));
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
  function resumeGame() {
    if (!logic.isValidSession(CATS, savedActive)) {
      (betaRemoveKey(MAYDAN_BETA_KEYS.active),
        setSavedActive(null),
        toast("تعذر استعادة المباراة القديمة"));
      return;
    }
    // المباراة المحفوظة تبقى كما هي؛ الجدار فقط يمنع استئنافها بحزم صارت مقفولة.
    if ((savedActive.selectedCategories || []).some((categoryId) => packLocked(categoryId))) {
      account.openPaywall({ reason: "resume" });
      return;
    }
    const restoredDeck = logic.idsToDeck(CATS, savedActive.deck);
    api?.matchResume?.(savedActive.profileSession || null);
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
    (betaRemoveKey(MAYDAN_BETA_KEYS.active),
      setSavedActive(null),
      toast("تم حذف المباراة المحفوظة"));
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
      text: toolId === "double" ? "×٢" : toolId === "two" ? "جوابان" : "+٣٠",
      tone: "gold",
      ms: 600,
    });
    toolId === "time" && pulseFx("timer", setTimerFx, "is-boost", 500, "");
  }
  // ختم الحكم ووميض الشاشة وقصاصات (دفعتان للسرقة)؛ كلها طبقات في body تُتخطّى تحت تقليل الحركة
  function verdictFx(isSteal, points) {
    if (points == null) {
      (stampScreen({ text: "ولا أحد", tone: "bad" }), flashScreen("bad"));
      return;
    }
    const burst = () =>
      burstConfetti({ x: window.innerWidth / 2, y: window.innerHeight * 0.42, count: 60 });
    (stampScreen({
      text: isSteal ? "خطف!" : "صح!",
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
        date: new Date().toLocaleDateString("ar-EG", {
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
        (playSfx("win"), reducedMotion || (api && api.confetti ? api.confetti : confettiFx).fire());
      }, 360),
      haptic("win"));
  }
  function judgeQuestion(winnerIndex) {
    const question = currentQuestion;
    if (!question || judgingRef.current) return;
    judgingRef.current = !0;
    const action = snapshotAction(`نتيجة سؤال ${question.p}`);
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
      toast("تم التراجع عن آخر تعديل"));
  }
  function adjustScore(teamIndex, delta) {
    const team = teams[teamIndex];
    (setLastAction(snapshotAction(`تعديل ${delta > 0 ? "+" : ""}${delta} نقطة`)),
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
      toast("شكرًا، حُفظ البلاغ على الجهاز"));
  }
  function shareResult() {
    const record = finalResult;
    if (!record) return;
    const scores = record.teams.map((team) => `${team.name}: ${team.score}`).join(" — "),
      title = record.winner ? `فاز ${record.winner} في بَديهة` : "تعادل في بَديهة";
    shareText(
      "بَديهة",
      `${title}
${scores}
${record.answered} من ${record.total} سؤالًا`,
    );
  }
  function shareReports() {
    if (!reports.length) return;
    const text = reports.slice(0, 100).map((report, index) =>
      [
        `${index + 1}. [${report.category} — ${report.points}] ${report.reason}`,
        `السؤال: ${report.question}`,
        `الإجابة: ${report.answer}`,
        `المعرّف: ${report.qid}`,
      ].join(`
`),
    ).join(`

`);
    shareText("تقارير أسئلة بَديهة", text);
  }
  function clearQuestionHistory() {
    setPendingClear("history");
  }
  function clearResults() {
    setPendingClear("results");
  }
  function confirmClear() {
    pendingClear === "history"
      ? (setHistory({}), saveKey(MAYDAN_BETA_KEYS.history, {}), toast("تم تصفير سجل الأسئلة"))
      : pendingClear === "results" &&
        (setResults([]), saveKey(MAYDAN_BETA_KEYS.results, []), toast("تم مسح سجل النتائج"));
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
        "aria-label": soundOn ? "كتم الصوت" : "تشغيل الصوت",
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
        hBeta("div", { className: "m-kicker" }, "بَديهة · لعبة جماعية"),
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
            "رجوع",
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
              ? hBeta("small", null, `إجابات ${team.correct} · سرقات ${team.steals}`)
              : turn === team.originalIndex &&
                  screen === "board" &&
                  hBeta("small", { className: "m-now-label" }, "الدور الآن"),
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
  function QuestionVisual({ question }) {
    const revealed = answerShown;
    const packId = current ? current.categoryId : null;
    const urls = questionMedia(question, packId),
      url = urls[0] || null,
      // نصّ السؤال يظهر فوق الوسائط حين يضيف شيئًا: الترويسة تعرض عبارة النوع
      // العامة، فلا داعي لتكرارها إن كتبها كاتب الحزمة كما هي.
      ownText =
        question.q && question.q.trim() && question.q.trim() !== TYPE_PROMPT[question.type]
          ? hBeta("p", { className: "m-question-text" }, question.q)
          : null;

    if (question.type === "image")
      return hBeta(
        "div",
        null,
        ownText,
        urls.length === 4
          ? hBeta(FourPics, { question, urls, revealed })
          : hBeta(MediaImage, { question, url, effect: question.effect || "none", revealed, onSfx: playSfx }),
      );
    if (question.type === "choice") {
      const options = question.options || [],
        isAnswer = (option) => arabicKey(option) === arabicKey(question.a);
      return hBeta(
        "div",
        null,
        hBeta("p", { className: "m-statement" }, question.q),
        hBeta(
          "div",
          { className: `m-options ${options.some((o) => String(o).length > 18) ? "is-long" : ""}` },
          options.map((option, index) =>
            hBeta(
              "span",
              { key: `${option}-${index}`, className: revealed && isAnswer(option) ? "is-answer" : "" },
              option,
            ),
          ),
        ),
      );
    }
    if (question.type === "code")
      return hBeta(
        "div",
        null,
        hBeta("div", { className: "m-code", dir: question.dir || "ltr", lang: /[A-Za-z]/.test(question.q || "") ? "en" : undefined }, question.q),
        question.hint && hBeta("p", { className: "m-hint" }, `تلميح: ${question.hint}`),
      );
    if (question.type === "audio") return hBeta("div", null, ownText, hBeta(MediaAudio, { key: url, url, revealed, soundOn: effectiveSoundOn, volume: platformSettings?.soundVolume, sound: api?.sound }));
    if (question.type === "video") return hBeta("div", null, ownText, hBeta(MediaVideo, { key: url, url, soundOn: effectiveSoundOn, volume: platformSettings?.soundVolume, sound: api?.sound }));
    if (question.type === "diff")
      return hBeta(
        "div",
        null,
        ownText,
        hBeta(
          "div",
          { className: "m-diff" },
          urls.map((one, index) =>
            hBeta(
              "div",
              { key: one, className: "m-diff-side" },
              // العلامة ابنة إطار يطابق صندوق الصورة المرسوم تمامًا (لا صندوق الوسائط
              // الذي يفرض min-height:180px)، وتُوضع بـ left الفيزيائية: قياس spot.x في
              // البنك من الحافة اليسرى للصورة، بينما insetInlineStart تصير right داخل dir=rtl
              // فتقلب الموضع إلى (100 − x)%.
              hBeta(MediaBox, { url: one }, ({ onReady, onError }) =>
                hBeta(
                  "span",
                  { className: "m-diff-frame" },
                  hBeta("img", { src: one, alt: `الصورة ${index + 1}`, className: "m-media-img", onLoad: onReady, onError }),
                  revealed &&
                    question.spot &&
                    hBeta("span", {
                      className: "m-diff-spot",
                      style: { left: `${question.spot.x}%`, top: `${question.spot.y}%`, width: `${question.spot.r * 2}%` },
                      "aria-hidden": "true",
                    }),
                ),
              ),
            ),
          ),
        ),
      );
    if (question.type === "truefalse")
      return hBeta(
        "div",
        null,
        hBeta("p", { className: "m-statement" }, question.q),
        hBeta(
          "div",
          { className: "m-tf" },
          ["صح", "خطأ"].map((label) =>
            hBeta(
              "span",
              { key: label, className: revealed && String(question.a).trim() === label ? "is-answer" : "" },
              label,
            ),
          ),
        ),
      );
    if (question.type === "scramble") {
      const letters = question.letters || String(question.a || "").replace(/\s+/g, "").split("");
      return hBeta(
        "div",
        null,
        ownText,
        hBeta(
          "div",
          { className: "m-scramble", dir: "rtl" },
          (revealed ? String(question.a).replace(/\s+/g, "").split("") : letters).map((ch, index) =>
            hBeta("span", { key: `${ch}-${index}`, className: revealed ? "is-answer" : "" }, ch),
          ),
        ),
      );
    }
    if (question.type === "complete") {
      const parts = String(question.q || "").split("___");
      return hBeta(
        "p",
        { className: "m-complete" },
        parts[0],
        hBeta("span", { className: revealed ? "m-blank is-answer" : "m-blank" }, revealed ? question.a : "؟؟؟"),
        parts[1] || "",
      );
    }
    if (question.type === "common")
      return hBeta(
        "div",
        null,
        ownText,
        hBeta(
          "div",
          { className: "m-item-list" },
          (question.items || []).map((item, index) => hBeta("span", { key: `${item}-${index}` }, item)),
        ),
      );
    if (question.type === "hints") {
      const hints = question.hints || [];
      return hBeta(
        "div",
        null,
        ownText,
        hBeta(
          "div",
          { className: "m-hints" },
          hints.map((hint, index) =>
            hBeta(
              "div",
              { key: index, className: index < hintsUsed || revealed ? "is-open" : "" },
              index < hintsUsed || revealed ? hint : `تلميح ${index + 1}`,
            ),
          ),
        ),
        !revealed &&
          hintsUsed < hints.length &&
          hBeta(
            "button",
            { "data-design-id": "hint",
              type: "button",
              className: "m-secondary m-small",
              onClick: () => { setHintsUsed((n) => n + 1); playSfx("click"); },
            },
            `اطلب تلميحًا (تُخصم ${HINT_COST_PERCENT}% من النقاط)`,
          ),
      );
    }
    if (question.type === "zoom")
      return hBeta(
        "div",
        { className: "m-visual-frame" },
        question.image
          ? hBeta("img", {
              src: question.image,
              alt: "صورة السؤال",
              className: revealed ? "m-zoom-image revealed" : "m-zoom-image",
            })
          : hBeta(
              "span",
              {
                className: revealed ? "m-zoom-emoji revealed" : "m-zoom-emoji",
                style: { transformOrigin: question.origin || "50% 50%" },
                role: "img",
                "aria-label": "صورة مقرّبة",
              },
              question.emoji,
            ),
      );
    if (question.type === "pic")
      return hBeta(
        "div",
        { className: "m-silhouette" },
        question.image
          ? hBeta("img", {
              src: question.image,
              alt: "ظل الصورة",
              className: revealed ? "revealed" : "",
            })
          : hBeta(
              "span",
              { className: revealed ? "revealed" : "", role: "img", "aria-label": "ظل صورة" },
              question.emoji,
            ),
      );
    if (question.type === "emoji")
      return hBeta(
        "div",
        null,
        hBeta("div", { className: "m-emoji-line", dir: "ltr" }, question.q),
        question.hint && hBeta("p", { className: "m-hint" }, `تلميح: ${question.hint}`),
      );
    if (question.type === "order") {
      const items = revealed ? question.items : mixedItems;
      return hBeta(
        "div",
        null,
        hBeta("p", { className: "m-question-text" }, question.q),
        hBeta(
          "div",
          { className: "m-item-list" },
          items.map((item, index) =>
            hBeta(
              "span",
              { key: `${item}-${index}`, className: revealed ? "is-answer" : "" },
              `${revealed ? `${index + 1}. ` : ""}${item}`,
            ),
          ),
        ),
      );
    }
    return question.type === "odd"
      ? hBeta(
          "div",
          { className: "m-odd-grid" },
          question.items.map((item, index) =>
            hBeta(
              "div",
              {
                key: `${item}-${index}`,
                className: revealed && index === question.odd ? "is-answer" : "",
              },
              item,
            ),
          ),
        )
      : question.type === "flag"
        ? hBeta(Flag, { spec: question.flag })
        : question.type === "grid"
          ? hBeta(
              "div",
              null,
              hBeta("p", { className: "m-question-text" }, question.q),
              hBeta(
                "div",
                { className: "m-focus-grid", dir: "ltr" },
                question.grid.map((row, rowIndex) =>
                  hBeta(
                    "div",
                    { key: rowIndex, className: "m-focus-row" },
                    row.map((cell, cellIndex) =>
                      hBeta(
                        "span",
                        {
                          key: `${rowIndex}-${cellIndex}`,
                          className: revealed && cell === question.target ? "is-answer" : "",
                        },
                        cell,
                      ),
                    ),
                  ),
                ),
              ),
            )
          : question.type === "sound"
            ? hBeta(
                "button",
                { "data-design-id": "question-audio",
                  type: "button",
                  className: "m-sound-play",
                  onClick: () => playQuestionSound(question.sound),
                  disabled: !effectiveSoundOn,
                  "aria-label": "تشغيل صوت السؤال",
                },
                hBeta("span", { "aria-hidden": "true" }, effectiveSoundOn ? "🔊" : "🔇"),
                hBeta("b", null, effectiveSoundOn ? "شغّل الصوت" : "الصوت مكتوم"),
              )
            : hBeta("p", { className: "m-question-text" }, question.q);
  }
  function HomeScreen() {
    const savedProgress = savedActive ? Object.keys(savedActive.used || {}).length : 0;
    return hBeta(
      "section",
      { className: "m-home" },
      hBeta("div", { className: "m-home-orbit", "aria-hidden": "true" }, "؟"),
      hBeta(
        "div",
        { className: "m-home-eyebrow" },
        hBeta("span", { "aria-hidden": "true" }),
        "لعبة مسابقات جماعية",
      ),
      // الشعار حامل صلصالي: الحركة على .clay-lift والظل على الحامل، الرسم نفسه ساكن
      hBeta(
        "div",
        { className: "m-logo clay-stage clay-idle", "aria-label": "بَديهة" },
        hBeta("span", { className: "clay-lift" }, hBeta(GameArtwork, { game: "badeeha" })),
        hBeta("span", null, "بَديهة"),
      ),
      hBeta(
        "div",
        { "data-design-id": "intro", className: "m-home-copy" },
        hBeta("h1", { "data-design-id": "title", className: "m-home-title" }, "المعرفة تُحسم بالنقاط"),
        hBeta(
          "p",
          { className: "m-muted m-center" },
          "اختاروا الفئات، نافسوا أصدقاءكم، واحسموا الميدان.",
        ),
      ),
      hBeta(
        "div",
        { className: "m-home-stats", "aria-label": "معلومات اللعبة" },
        hBeta("span", null, hBeta("b", { dir: "ltr" }, CATS.length), " فئة"),
        hBeta("span", null, hBeta("b", { dir: "ltr" }, TOTAL_Q), " سؤال"),
        hBeta("span", null, HAS_MEDIA ? "الوسائط تُحفظ في الجهاز" : "تعمل دون إنترنت"),
      ),
      savedActive &&
        hBeta(
          "div",
          { className: "m-saved-card" },
          hBeta(
            "div",
            null,
            hBeta("b", null, "مباراة محفوظة"),
            hBeta("small", null, `${savedProgress} من ${savedActive.roundSize} سؤالًا`),
            hBeta(
              "span",
              { className: "m-saved-progress", "aria-hidden": "true" },
              hBeta("i", {
                style: {
                  width: `${Math.min(100, (savedProgress / savedActive.roundSize) * 100)}%`,
                },
              }),
            ),
          ),
          hBeta(
            "button",
            { "data-design-id": "resume", "data-design-required": "true", type: "button", className: "m-primary", onClick: resumeGame },
            "متابعة",
          ),
          hBeta(
            "button",
            { "data-design-id": "discard-save", type: "button", className: "m-link", onClick: discardSavedGame },
            "حذفها",
          ),
        ),
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
            hBeta("b", null, "ابدأ لعبة جديدة"),
            hBeta("small", null, "من فريقين إلى أربعة"),
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
            " النتائج",
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
            " طريقة اللعب",
          ),
        ),
      ),
      hBeta("div", { className: "m-beta-badge" }, "نسخة تجريبية · يُحفظ تقدمك تلقائيًا"),
    );
  }
  function SetupScreen() {
    // المجموعات مشتقة من أنواع أسئلة الحزمة نفسها (79 حزمة = 61 معلومات + 7 خاصة + 11 وسائط).
    const filters = [
      ["all", "الكل"],
      ["free", "مجاني"],
      ["info", "معلومات"],
      ["special", "خاصة"],
      ["media", "وسائط"],
      ["favorites", "المفضلة"],
    ];
    return hBeta(
      "section",
      { className: "m-screen" },
      Header({ title: "جهّزوا الميدان", back: () => setScreen("home", "back") }),
      hBeta(
        "div",
        { className: "m-panel m-setup-panel", "data-step": "١" },
        hBeta("h2", { className: "m-section-title" }, "الفرق"),
        hBeta(
          "div",
          { className: "m-segment", role: "group", "aria-label": "عدد الفرق" },
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
              `${count} فرق`,
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
              hBeta("span", null, `الفريق ${index + 1}`),
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
        { className: "m-panel m-setup-panel", "data-step": "٢" },
        hBeta("h2", { className: "m-section-title" }, "نمط الصعوبة"),
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
              hBeta("b", null, item.label),
              hBeta("small", null, item.description),
            ),
          ),
        ),
        hBeta("h2", { className: "m-section-title m-top" }, "طول الجولة"),
        hBeta(
          "div",
          { className: "m-segment", role: "group", "aria-label": "عدد الأسئلة" },
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
              `${size} سؤالًا`,
            ),
          ),
        ),
        hBeta("h2", { className: "m-section-title m-top" }, "وقت السؤال"),
        hBeta(
          "div",
          { className: "m-segment", role: "group", "aria-label": "وقت السؤال" },
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
              `${seconds} ثانية`,
            ),
          ),
        ),
      ),
      hBeta(
        "div",
        { className: "m-panel m-setup-panel", "data-step": "٣" },
        hBeta(
          "div",
          { className: "m-row-between" },
          hBeta("h2", { className: "m-section-title" }, "اختر 6 فئات"),
          hBeta(
            "b",
            { key: selectedCategories.length, className: selectedCategories.length === 6 ? "m-count ok" : "m-count" },
            `${selectedCategories.length}/6`,
          ),
        ),
        hBeta(
          "label",
          { className: "m-search" },
          hBeta("span", { className: "sr-only" }, "ابحث عن فئة"),
          hBeta("span", { "aria-hidden": "true" }, "🔎"),
          hBeta("input", {
            "data-design-id": "category-search",
            value: categorySearch,
            onChange: (event) => setCategorySearch(event.target.value),
            placeholder: "ابحث عن فئة…",
          }),
        ),
        hBeta(
          "div",
          { className: "m-filter-row", role: "group", "aria-label": "تصفية الفئات" },
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
        hBeta(
          "div",
          { className: "m-category-actions" },
          hBeta(
            "button",
            { "data-design-id": "random-categories", type: "button", className: "m-secondary", onClick: randomCategories },
            "🎲 اختيار عشوائي",
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
            "مسح الاختيار",
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
                  "aria-disabled": locked ? "true" : undefined,
                  "aria-label": locked
                    ? `فئة ${category.name} ضمن ميدان بلس`
                    : `${selected ? "إلغاء" : "اختيار"} فئة ${category.name}`,
                },
                selected && hBeta("span", { className: "m-order-badge" }, order),
                hBeta(CategoryCover, { id: category.id, icon: category.icon }),
                hBeta("b", null, category.name),
                locked && hBeta("span", { className: "m-lock" }, "🔒 بلس"),
                hBeta("small", null, `حتى ${modeTopTier(activeMode)}`),
              ),
              hBeta(
                "button",
                { "data-design-id": "favorite",
                  type: "button",
                  className: "m-favorite",
                  onClick: () => toggleFavorite(category.id),
                  "aria-label": favorite
                    ? `إزالة ${category.name} من المفضلة`
                    : `إضافة ${category.name} إلى المفضلة`,
                  "aria-pressed": favorite,
                },
                hBeta("span", { key: favorite ? "on" : "off", "aria-hidden": "true" }, favorite ? "★" : "☆"),
              ),
            );
          }),
        ),
        visibleCategories.length === 0 &&
          hBeta("p", { className: "m-empty" }, "لا توجد فئات مطابقة."),
        hBeta(
          "div",
          { className: "m-history-note" },
          hBeta("span", null, `لُعب ${currentQuestionHistoryCount(CATS, history)} سؤالًا من البنك الحالي؛ الجديد له الأولوية.`),
          hBeta(
            "button",
            { "data-design-id": "clear-history", type: "button", className: "m-link", onClick: clearQuestionHistory },
            "تصفير السجل",
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
          disabled: selectedCategories.length !== 6,
        },
        `ابدأ ${roundSize} سؤالًا · ${activeMode.label}`,
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
  }, [selectedCategories]);

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
            `${activeMode.icon} ${activeMode.label} · ${roundSize} سؤالًا`,
          ),
          hBeta(
            "div",
            { className: "m-current-turn", style: { "--team-color": TEAM_STYLE[turn].solid } },
            hBeta("span", { "aria-hidden": "true" }),
            hBeta("b", null, `الدور الآن: ${teams[turn].name}`),
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
              "aria-label": "فتح النتائج وتعديل النقاط",
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
                    "aria-label": `${category.name}، سؤال ${question.p} نقطة${done ? "، مستخدم" : ""}`,
                  },
                  hBeta("b", { dir: "ltr" }, question.p),
                  hBeta("small", null, done ? "تم" : MAYDAN_TIER_LABELS[question.p]),
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
        hBeta("small", null, `${usedCount} من ${totalQuestions} سؤالًا`),
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
          `↶ تراجع${lastAction ? `: ${lastAction.label}` : ""}`,
        ),
        confirmEnd
          ? hBeta(
              "div",
              { className: "m-confirm-inline" },
              hBeta("span", null, "إنهاء المباراة؟"),
              hBeta(
                "button",
                { "data-design-id": "finish", type: "button", className: "m-danger", onClick: () => finishGame(!0) },
                "نعم",
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
              "إنهاء المباراة",
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
      answerHidden ? " إظهار الإجابة" : " إخفاء الإجابة",
    );
  }
  function QuestionScreen() {
    if (!currentQuestion || !currentCategory) return null;
    const prompt = TYPE_PROMPT[currentQuestion.type],
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
          "إلغاء السؤال",
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
            " نقطة",
            hBeta(
              "small",
              { key: `${effect.double ? "x2" : "x1"}-${hintsUsed}` },
              // «×2» لا تنطبق على السرقة، والتلميحات تخصم ٢٥٪ لكل واحد: الرقم أعلاه
              // هو ما سيُمنح فعلًا لفريق الدور، والتفصيل هنا.
              effect.double
                ? `×2 لصاحب الدور · ${questionAward * 2}`
                : hintsUsed > 0
                  ? `بعد ${hintsUsed === 1 ? "تلميح" : hintsUsed === 2 ? "تلميحين" : `${hintsUsed} تلاميح`} · الأصل ${currentQuestion.p}`
                  : MAYDAN_TIER_LABELS[currentQuestion.p],
            ),
          ),
        ),
        SoundButton(),
      ),
      hBeta(
        "div",
        { "data-design-id": "turn", className: "m-turn-banner", style: { "--team-color": TEAM_STYLE[turn].solid } },
        hBeta("span", { "aria-hidden": "true" }),
        hBeta("strong", null, `السؤال لـ ${teams[turn].name}`),
        effect.two && hBeta("b", null, "جوابان مفعّلان"),
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
            "aria-label": `${timeLeft} ثانية متبقية`,
          },
          // الرقم يُعاد تركيبه كل ثانية في العشر الأخيرة فقط (نبضة)، والمفتاح ثابت قبلها
          hBeta("b", { dir: "ltr" }, hBeta("span", { key: danger ? timeLeft : "n" }, timeLeft)),
          paused && hBeta("small", null, "متوقف"),
        ),
      ),
      !revealed &&
        timeLeft > 0 &&
        hBeta(
          "button",
          { "data-design-id": "pause", type: "button", className: "m-secondary m-pause", onClick: togglePause },
          paused ? "▶ متابعة الوقت" : "⏸ إيقاف مؤقت",
        ),
      !revealed &&
        timeLeft <= 0 &&
        hBeta("p", { className: "m-timeout", role: "alert" }, "انتهى الوقت ⏰"),
      hBeta(
        "article",
        { "data-design-id": "question", className: `m-question-card ${revealed ? "is-revealed" : ""}` },
        prompt && hBeta("p", { className: "m-prompt" }, prompt),
        !revealed && assistance && (assistance.context || assistance.shape) && hBeta(
          "aside",
          { "data-design-id": "assistance", className: "m-question-assistance", "aria-label": "مساعدة خفيفة بلا خصم نقاط" },
          assistance.context && hBeta("span", null, assistance.context),
          assistance.shape && hBeta("small", null, assistance.shape),
        ),
        QuestionVisual({ question: currentQuestion }),
        revealed &&
          (answerShown
            ? hBeta(
                "div",
                { "data-design-id": "answer", className: "m-answer", role: "status" },
                hBeta("small", null, "الإجابة"),
                hBeta("strong", null, answerText(currentQuestion)),
                // الصيغ المقبولة الأخرى (اسم بلغتين، لقب) تظهر للمضيف كي لا يظلم إجابة صحيحة بصياغة مختلفة
                Array.isArray(currentQuestion.alt) &&
                  currentQuestion.alt.length > 0 &&
                  hBeta("span", { className: "m-answer-alt" }, `يُقبل أيضًا: ${currentQuestion.alt.join(" · ")}`),
                AnswerToggle(),
              )
            : hBeta(
                "div",
                { className: "m-answer is-hidden", role: "status" },
                hBeta("small", null, "الإجابة مخفية"),
                hBeta("strong", { "aria-hidden": "true" }, "• • •"),
                AnswerToggle(),
              )),
      ),
      !revealed &&
        hBeta(
          "div",
          { "data-design-id": "tools", className: `m-tools ${timeLeft <= 0 ? "is-out" : ""}` },
          hBeta("p", null, `وسائل ${teams[turn].name}`),
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
                  title: tool.hint,
                },
                hBeta("span", { "aria-hidden": "true" }, tool.icon),
                hBeta("b", null, tool.label),
                hBeta("small", null, effect[tool.id] ? "مفعّلة" : available ? "متاحة" : "استُخدمت"),
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
                currentQuestion.type === "closest" ? "من كان الأقرب؟" : "من أجاب إجابة صحيحة؟",
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
                "⚑ بلّغ عن السؤال",
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
                      ? "إجابة صحيحة · نقاط مضاعفة"
                      : currentQuestion.type !== "closest" && index !== turn
                        ? "إجابة صحيحة · سرقة"
                        : "إجابة صحيحة",
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
              "لم يجب أحد",
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
            " أظهر الإجابة",
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
      hBeta(Podium, { entries: record.teams, title: record.winner ? `فاز ${winners[0]}` : "تعادل جميل!" }),
      hBeta("p", { className: "m-kicker" }, record.early ? "انتهت المباراة مبكرًا" : "اكتملت الجولة"),
      hBeta("div", { className: "m-result-statistics" }, record.teams.map((team) =>
        hBeta("div", { key: team.id },
          hBeta("span", { className: "clay-stage clay-static no-contact" }, hBeta("span", { className: "clay-lift" }, hBeta(Avatar, { player: team }))),
          hBeta("b", null, team.name),
          hBeta("small", null, `إجابات: ${team.correct} · سرقات: ${team.steals}`)),
      )),
      hBeta(
        "p",
        { className: "m-muted" },
        `${record.answered} من ${record.total} سؤالًا · ${logic.MODES[record.mode] ? logic.MODES[record.mode].label : "بَديهة"}`,
      ),
      hBeta(
        "div",
        { "data-design-id": "actions", className: "m-result-actions" },
        hBeta(
          "button",
          { "data-design-id": "start", "data-design-required": "true", type: "button", className: "m-primary m-large", onClick: beginGame },
          "إعادة بنفس الإعدادات",
        ),
        hBeta(
          "button",
          { "data-design-id": "share-result", type: "button", className: "m-secondary", onClick: shareResult },
          "مشاركة النتيجة",
        ),
        hBeta(
          "div",
          { className: "m-two" },
          hBeta(
            "button",
            { "data-design-id": "setup", type: "button", className: "m-secondary", onClick: () => setScreen("setup") },
            "لعبة جديدة",
          ),
          hBeta(
            "button",
            { "data-design-id": "history", type: "button", className: "m-secondary", onClick: () => setScreen("history") },
            "سجل النتائج",
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
      Header({ title: "النتائج والتقارير", back: () => setScreen("home", "back") }),
      hBeta(
        "div",
        { className: "m-panel" },
        hBeta("h2", { className: "m-section-title" }, "لوحة الشرف"),
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
                  hBeta("small", null, `${item.wins} فوز · ${item.games} مباراة`),
                  hBeta("strong", null, item.points),
                ),
              ),
            )
          : hBeta("p", { className: "m-empty" }, "تظهر لوحة الشرف بعد أول مباراة."),
      ),
      hBeta(
        "div",
        { className: "m-panel" },
        hBeta(
          "div",
          { className: "m-row-between" },
          hBeta("h2", { className: "m-section-title" }, "آخر المباريات"),
          results.length > 0 &&
            hBeta(
              "button",
              { "data-design-id": "clear-results", type: "button", className: "m-link", onClick: clearResults },
              "مسح السجل",
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
          : hBeta("p", { className: "m-empty" }, "لا توجد مباريات محفوظة بعد."),
      ),
      hBeta(
        "div",
        { className: "m-panel" },
        hBeta(
          "div",
          { className: "m-row-between" },
          hBeta("h2", { className: "m-section-title" }, "بلاغات الأسئلة"),
          hBeta("b", { className: "m-count" }, reports.length),
        ),
        hBeta(
          "p",
          { className: "m-muted" },
          "تُحفظ البلاغات على هذا الجهاز لتجميع ملاحظات النسخة التجريبية.",
        ),
        reports.length > 0 &&
          hBeta(
            "button",
            { "data-design-id": "share-reports", type: "button", className: "m-secondary m-full", onClick: shareReports },
            "مشاركة تقرير الاختبار",
          ),
      ),
    );
  }
  function RulesModal() {
    return hBeta(
      MaydanModal,
      { title: "كيف نلعب؟", onClose: () => setShowRules(!1) },
      hBeta(
        "ol",
        { className: "m-rules" },
        hBeta("li", null, "أنشئ من فريقين إلى أربعة بأسماء مختلفة، ثم اختر ست فئات."),
        hBeta("li", null, "اختر الجولة: 20 سريعة، 30 متوسطة، أو 60 كاملة."),
        hBeta("li", null, "الوضع العائلي يصل إلى 600، التحدّي يضيف 800، والخبراء يضيف 1000."),
        hBeta("li", null, "800 صعب جدًا، و1000 مستوى مستحيل؛ لا يظهران إلا في الوضع المناسب."),
        hBeta(
          "li",
          null,
          "بعد كشف الإجابة، اختر الفريق الذي أجاب، ويمكنك إخفاء الإجابة وإظهارها متى شئت. في «الأقرب» لا تُحسب الإجابة سرقة.",
        ),
        hBeta("li", null, "لكل فريق: مضاعفة النقاط، جوابان، و30 ثانية إضافية؛ كل أداة مرة واحدة."),
        hBeta(
          "li",
          null,
          "يمكن إلغاء السؤال قبل كشف الإجابة، والتراجع عن آخر نتيجة أو تعديل النقاط يدويًا.",
        ),
        hBeta("li", null, "تُحفظ المباراة تلقائيًا، ويمكن متابعتها بعد إغلاق التطبيق."),
      ),
      hBeta(
        "button",
        { "data-design-id": "rules", type: "button", className: "m-primary m-full", onClick: () => setShowRules(!1) },
        "فهمت",
      ),
    );
  }
  function ScoreModal() {
    return hBeta(
      MaydanModal,
      { title: "النتائج وتعديل النقاط", onClose: () => setShowScore(!1), bottom: !0 },
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
                "aria-label": `خصم 100 من ${team.name}`,
              },
              "−100",
            ),
            hBeta(
              "button",
              { "data-design-id": "score-plus",
                type: "button",
                className: "m-success",
                onClick: () => adjustScore(index, 100),
                "aria-label": `إضافة 100 إلى ${team.name}`,
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
        "↶ تراجع عن آخر تعديل",
      ),
    );
  }
  function ReportModal() {
    const reasons = [
      "معلومة أو إجابة خاطئة",
      "السؤال غامض",
      "الصعوبة في غير مكانها",
      "مشكلة في الصورة أو الصوت",
    ];
    return hBeta(
      MaydanModal,
      { title: "بلاغ عن السؤال", onClose: () => setReportQuestion(null) },
      hBeta("p", { className: "m-muted" }, "اختر سبب البلاغ. سيُحفظ محليًا ضمن تقرير الاختبار."),
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
      { title: history ? "تصفير سجل الأسئلة" : "مسح سجل النتائج", onClose: () => setPendingClear(null) },
      hBeta("p", { className: "m-muted" }, history ? "هل تريد تصفير سجل الأسئلة التي لُعبت؟" : "هل تريد مسح سجل النتائج؟"),
      hBeta(
        "div",
        { className: "m-report-reasons" },
        hBeta(
          "button",
          { "data-design-id": history ? "clear-history" : "clear-results", type: "button", className: "m-danger", onClick: confirmClear },
          history ? "نعم، صفّر السجل" : "نعم، امسح النتائج",
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
      { dir: "rtl", className: `m-root m-screen-${screen}`, "data-dir": navDir, "data-design-screen": `badeeha.${screen}` },
      hBeta("style", null, MAYDAN_BETA_CSS),
      // مفتاح الشاشة يعيد تركيب القسم فتعمل حركة الدخول عند كل انتقال (كلها عناصر section)
      hBeta(React.Fragment, { key: screen }, roundLoading ? hBeta(
        "section", { className: "m-round-loading", "aria-busy": "true", "aria-label": "تجهيز الجولة" },
        hBeta(GameArtwork, { game: "badeeha" }),
        hBeta("h2", null, "نجهّز أسئلتكم"),
        hBeta("p", { role: "status" }, `تحميل ${roundLoading.done.toLocaleString("ar")} من ${roundLoading.total.toLocaleString("ar")} ملفًا`),
        hBeta("progress", { max: roundLoading.total, value: roundLoading.done, "aria-label": "تحميل وسائط الجولة" }),
        hBeta("button", { "data-design-id": "continue", "data-design-required": "true", type: "button", className: "m-secondary", onClick: skipRoundLoading }, "متابعة اللعب الآن"),
      ) : content),
      showRules && RulesModal(),
      showScore && ScoreModal(),
      reportQuestion && ReportModal(),
      pendingClear && ClearModal(),
      notice && hBeta("div", { className: `m-toast ${noticeLeaving ? "is-leaving" : ""}`, role: "status" }, notice),
      !hydrated &&
        hBeta("div", { className: "m-hydrating", "aria-label": "جارٍ استعادة البيانات" }, "…"),
    )
  );
}


export default MaydanBeta;
