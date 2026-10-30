import React from "../../design/react.js";
import { wait } from "../../shared/fx/index.js";
import { socialInterruption } from "../../social/interruption.js";
import { mulberry32 } from "../../shared/lib/rng.js";
import { preloadMedia, isLoaded as mediaIsLoaded, hasFailed as mediaHasFailed } from "../../shared/media/preload.js";
import { questionAssistance } from "./assistance.js";
import { JUMBLE_TILES, MAX_AUDIO_PLAYS } from "./constants.js";
const { useState, useEffect, useRef, useCallback } = React;
const hBeta = React.createElement;

// ── مكوّنات الوسائط ──────────────────────────────────────────────────────
// خارج مكوّن اللعبة عمدًا: مكوّن يُعرَّف داخل دالة العرض يتغير هويته مع كل إعادة
// عرض (مؤقت الثواني مثلًا)، فيُفكّ ويُركَّب من جديد ويفقد حالته — يتوقف الصوت
// وتعود قطع «إكشفني» إلى الغطاء. هنا الهوية ثابتة والحالة تبقى.
// مرجع الملف في السؤال قصير («01.webp»)، ومجلد الحزمة يكمله. الأخطاء تُعرض
// للاعب بدل أن تترك مربعًا فارغًا لا يفهمه أحد.
export function MediaBox({ url, kind, className, alt, children }) {
  // المحمَّل يُفحص أولًا: ملف أخفق مرة (جولة بلا شبكة) ثم نجح لاحقًا يبقى في
  // سجل الإخفاقات، فترتيبٌ معكوس كان يُظهر خطأً دائمًا لملف موجود فعلًا.
  const [state, setState] = useState(mediaIsLoaded(url) ? "ready" : mediaHasFailed(url) ? "error" : "loading");
  useEffect(() => {
    setState(mediaIsLoaded(url) ? "ready" : mediaHasFailed(url) ? "error" : "loading");
  }, [url]);
  if (!url) {
    return hBeta("div", { className: "m-media-box is-error" }, hBeta("p", null, "لا ملف لهذا السؤال"));
  }
  return hBeta(
    "div",
    { "data-design-id": "question-media", className: `m-media-box ${className || ""} ${state === "loading" ? "is-loading" : ""}` },
    state === "error"
      ? hBeta(
          "div",
          { className: "m-media-error", role: "status" },
          hBeta("span", { "aria-hidden": "true" }, "📡"),
          hBeta("b", null, "تعذّر تحميل الملف"),
          hBeta("small", null, navigator.onLine === false ? "لا يوجد اتصال بالإنترنت" : "تحقق من الاتصال ثم أعد المحاولة"),
          hBeta(
            "button",
            { "data-design-id": "media-retry", type: "button", className: "m-secondary m-small", onClick: () => { setState("loading"); preloadMedia([url]).then((r) => setState(r.failed === 0 ? "ready" : "error")); } },
            "أعد المحاولة",
          ),
        )
      : children({ onReady: () => setState("ready"), onError: () => setState("error") }),
    state === "loading" && hBeta("span", { className: "m-media-spinner", "aria-label": "جارٍ التحميل" }),
  );
}

// ترتيب قطع «ركّبها صح» ثابت لكل سؤال (مشتق من معرّفه) كي لا يتغير عند إعادة الرسم أو الاستئناف.
function jumbleOrder(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const random = mulberry32(h >>> 0),
    order = Array.from({ length: JUMBLE_TILES }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.every((v, i) => v === i)) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

export function MediaImage({ question, url, effect, revealed, onSfx }) {
  const [tiles, setTiles] = useState(() => (effect === "reveal" ? Array.from({ length: 12 }, (_, i) => i) : []));
  const [enlarged, setEnlarged] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  // شبكة القطع تأخذ نسبة الصورة الحقيقية، وإلا مطّت صورةً مربّعة داخل إطار 4:3
  const [ratio, setRatio] = useState(null);
  // حلّ «ركّبها صح»: نسخة شبحية من القطع تتلاشى فوق الصورة الأصلية ~350ms ثم تُزال (صفر تحت تقليل الحركة).
  const [solving, setSolving] = useState(false);
  useEffect(() => { if (effect === "reveal") setTiles(Array.from({ length: 12 }, (_, i) => i)); setEnlarged(false); setZoomed(false); setRatio(null); }, [url, effect]);
  useEffect(() => { if (!enlarged) return undefined; const onKey = (e) => { if (e.key === "Escape") { setEnlarged(false); setZoomed(false); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [enlarged]);
  useEffect(() => {
    if (effect !== "jumble" || !revealed) { setSolving(false); return undefined; }
    setSolving(true);
    const timer = window.setTimeout(() => setSolving(false), wait(350));
    return () => window.clearTimeout(timer);
  }, [revealed, effect, url]);
  const shown = revealed ? [] : tiles;
  const cls = ["m-media-img", `fx-${effect}`, questionAssistance(question) ? "is-assisted" : "", revealed ? "is-revealed" : ""].join(" ");
  // التكبير باللمس لا يكشف ما يخفيه المؤثّر: يُتاح للصورة العادية دائمًا، وللبقية بعد الكشف.
  const canEnlarge = effect === "none" || revealed;
  const jumbled = effect === "jumble" && !revealed;
  const order = effect === "jumble" ? jumbleOrder(question.qid || url) : null;
  // الضبابية والظل: المرشّح ثابت على الصورة الأولى، والكشف تلاشٍ لصورة نظيفة فوقها (لا يُحرَّك filter).
  const crossfade = effect === "blur" || effect === "silhouette" || effect === "shadow";
  return hBeta(
    MediaBox,
    { url, className: `fx-frame-${effect}`, alt: question.q || "صورة السؤال" },
    ({ onReady, onError }) =>
      hBeta(
        React.Fragment,
        null,
        hBeta(
        "div",
        {
          className: `m-media-stage ${canEnlarge ? "can-enlarge" : ""}`,
          onClick: canEnlarge ? () => { setEnlarged(true); onSfx && onSfx("click"); } : undefined,
          "data-design-id": "image-enlarge",
          role: canEnlarge ? "button" : undefined,
          tabIndex: canEnlarge ? 0 : undefined,
          onKeyDown: canEnlarge ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } } : undefined,
          "aria-label": canEnlarge ? "تكبير الصورة" : undefined,
        },
        hBeta("img", {
          src: url,
          alt: revealed ? question.a || "صورة السؤال" : "صورة السؤال",
          className: jumbled ? `${cls} is-hidden-src` : cls,
          style: effect === "zoom" ? { transformOrigin: question.origin || "50% 50%" } : null,
          onLoad: (event) => {
            const img = event.currentTarget;
            if (img && img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight);
            onReady();
          },
          onError,
          draggable: false,
        }),
        crossfade &&
          hBeta("img", {
            src: url,
            alt: "",
            "aria-hidden": "true",
            className: `m-media-img m-media-clean ${revealed ? "is-revealed" : ""}`,
            draggable: false,
          }),
        (jumbled || (revealed && solving)) &&
          hBeta(
            "div",
            { className: jumbled ? "m-jumble" : "m-jumble-ghost", "aria-hidden": "true", style: ratio ? { aspectRatio: String(ratio) } : null },
            order.map((source, slot) =>
              hBeta("i", {
                key: slot,
                style: {
                  "--k": slot,
                  backgroundImage: `url("${url}")`,
                  backgroundPosition: `${(source % 4) * (100 / 3)}% ${Math.floor(source / 4) * 50}%`,
                },
              }),
            ),
          ),
        enlarged &&
          hBeta(
            "div",
            {
              className: "m-lightbox",
              // اتجاه لاتيني للغلاف وحده: التمرير الأفقي عند التكبير يبدأ من الوسط
              // بحساب واحد، بلا اختلاف دلالة scrollLeft بين الاتجاهين.
              dir: "ltr",
              role: "dialog",
              "aria-label": "الصورة مكبّرة — اضغط خارج الصورة للإغلاق",
              onClick: (e) => { e.stopPropagation(); setEnlarged(false); setZoomed(false); },
            },
            hBeta(
              "button",
              {
                type: "button",
                "data-design-id": "media-close",
                "data-design-required": "true",
                className: "m-icon-btn m-lightbox-close",
                "aria-label": "إغلاق الصورة",
                onClick: (e) => { e.stopPropagation(); setEnlarged(false); setZoomed(false); },
              },
              "✕",
            ),
            hBeta(
              "div",
              { className: "m-lightbox-stage" },
              hBeta("img", {
                src: url,
                alt: revealed ? question.a || "صورة السؤال" : "صورة السؤال",
                className: zoomed ? "is-zoomed" : "is-fit",
                draggable: false,
                // الضغط على الصورة نفسها يبدّل بين ملء الشاشة وتكبير ٣× قابل للسحب،
                // بدل «تكبير» لم يكن يزيد الحجم أكثر من ١٪ حين كانت الشاشة هي المرجع.
                onClick: (e) => {
                  e.stopPropagation();
                  const box = e.currentTarget.closest(".m-lightbox");
                  setZoomed((v) => !v);
                  onSfx && onSfx("click");
                  box &&
                    window.requestAnimationFrame(() => {
                      ((box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2),
                        (box.scrollTop = (box.scrollHeight - box.clientHeight) / 2));
                    });
                },
                "aria-label": zoomed ? "إرجاع الصورة إلى ملء الشاشة" : "تكبير الصورة ثلاث مرات",
              }),
            ),
          ),
        effect === "reveal" &&
          hBeta(
            "div",
            { className: "m-reveal-tiles", "aria-hidden": "true" },
            Array.from({ length: 12 }, (_, i) =>
              // --k يدرّج الانقلاب عند الكشف النهائي فقط؛ كشف قطعة واحدة ينقلب فورًا
              hBeta("i", { key: i, className: shown.includes(i) ? "" : "is-open", style: { "--k": revealed ? i : 0 } }),
            ),
          ),
        ),
        // يبقى زر القطعة خارج إطار الصورة كي لا يغطيه غطاء البلاطات.
        effect === "reveal" &&
          !revealed &&
          hBeta(
            "button",
            {
              type: "button",
              "data-design-id": "tiles-reveal",
              className: "m-secondary m-small m-reveal-tile-btn",
              disabled: shown.length === 0,
              onClick: () => {
                // القرعة تُسحب مرة واحدة خارج المرشِّح: استدعاء Math.random داخله
                // كان يُعاد لكل قطعة، فتُكشف قطع بعدد عشوائي (ولا شيء أحيانًا).
                setTiles((list) => {
                  if (!list.length) return list;
                  const drop = Math.floor(Math.random() * list.length);
                  return list.filter((_, index) => index !== drop);
                });
                onSfx && onSfx("click");
              },
            },
            `اكشف قطعة (${shown.length})`,
          ),
      ),
  );
}

function useQuestionMedia(ref, soundOn, volume, sound, onInterrupt) {
  const [element, setElement] = useState(null);
  const attach = useCallback((node) => {
    ref.current = node;
    setElement(node);
  }, [ref]);
  useEffect(() => {
    if (!element) return undefined;
    element.muted = !soundOn;
    element.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : .75));
    const pause = () => { element.pause(); onInterrupt?.(); };
    if (!soundOn) pause();
    const pauseHidden = () => { if (document.hidden || socialInterruption.getSnapshot().paused) pause(); };
    const nativeAudio = (event) => {
      if (["background", "interruption-began", "media-reset"].includes(event.detail?.state)) pause();
    };
    document.addEventListener("visibilitychange", pauseHidden);
    document.addEventListener("freeze", pause);
    window.addEventListener("pagehide", pause);
    window.addEventListener("maydan-audio-lifecycle", nativeAudio);
    const unsubscribe = socialInterruption.subscribe(pauseHidden);
    return () => {
      document.removeEventListener("visibilitychange", pauseHidden);
      document.removeEventListener("freeze", pause);
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("maydan-audio-lifecycle", nativeAudio);
      unsubscribe();
    };
  }, [element, soundOn, volume, onInterrupt]);
  // يخفض المقطع الخلفية عند تشغيله ويرفعها عند توقفه أو انتهائه أو تعطّله؛ ولا يرفع إلا ما خفضه هو.
  useEffect(() => {
    if (!element) return undefined;
    let ducking = false;
    const owner = Symbol('question-media');
    const duck = () => { ducking = true; sound?.setSuppressed?.(true, owner); sound?.music?.setSuppressed?.(true, owner); sound?.setDucking?.(true, owner); };
    const release = () => { if (!ducking) return; ducking = false; sound?.setDucking?.(false, owner); sound?.setSuppressed?.(false, owner); sound?.music?.setSuppressed?.(false, owner); };
    const releasing = ["pause", "ended", "error", "abort", "emptied"];
    element.addEventListener("play", duck);
    for (const type of releasing) element.addEventListener(type, release);
    if (!element.paused && !element.ended) duck();
    return () => {
      element.pause();
      element.removeEventListener("play", duck);
      for (const type of releasing) element.removeEventListener(type, release);
      release();
    };
  }, [element, sound]);
  return attach;
}

export function MediaAudio({ url, revealed, soundOn = true, volume = .75, sound }) {
  const ref = useRef(null);
  const pending = useRef(null);
  const cancelPending = useCallback(() => { pending.current = null; }, []);
  const attach = useQuestionMedia(ref, soundOn, volume, sound, cancelPending);
  const [playing, setPlaying] = useState(false);
  // تُحتسب المرة عند بدء التشغيل من أوله؛ الإيقاف المؤقت ثم الاستئناف لا يُحتسب.
  const [plays, setPlays] = useState(0);
  // متوقف في منتصف المقطع: استئنافه ليس مرة جديدة، فلا يُقفل الزر بعد نفاد المرات
  const [midway, setMidway] = useState(false);
  useEffect(() => { cancelPending(); setPlays(0); setPlaying(false); setMidway(false); }, [url, cancelPending]);
  useEffect(() => () => { cancelPending(); if (ref.current) ref.current.pause(); }, [cancelPending]);
  const spent = !revealed && plays >= MAX_AUDIO_PLAYS,
    left = Math.max(0, MAX_AUDIO_PLAYS - plays);
  const start = (fromStart) => {
    const el = ref.current;
    if (!el || !soundOn || pending.current) return;
    const fresh = fromStart || el.currentTime === 0 || el.ended;
    if (fresh && spent) return;
    if (fromStart) el.currentTime = 0;
    // العدّ بعد تأكد التشغيل: ضغطة على مقطع ما زال يُحمَّل ثم إيقافها كانت تحرق مرة بلا صوت
    // انقطاع النظام قد يترك وعد play معلقًا؛ لا يحبس زر الإعادة ولا يسمح لوعد
    // قديم بتغيير حالة محاولة أحدث أو استهلاك مرة سماع بعد العودة.
    const attempt = {};
    pending.current = attempt;
    el.play().then(() => {
      if (pending.current !== attempt) return;
      setPlaying(!el.paused);
      if (fresh && !el.paused) setPlays((n) => n + 1);
    }).catch(() => { if (pending.current === attempt) setPlaying(false); }).finally(() => { if (pending.current === attempt) pending.current = null; });
  };
  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) start(false);
    else { el.pause(); setPlaying(false); }
  };
  return hBeta(
    MediaBox,
    { url, className: "is-audio" },
    ({ onReady, onError }) =>
      hBeta(
        "div",
        { className: `m-audio ${spent ? "is-spent" : ""}` },
        hBeta("audio", {
          ref: attach,
          muted: !soundOn,
          src: url,
          preload: "auto",
          onCanPlay: onReady,
          onError,
          // الحالة تتبع العنصر نفسه لا الأزرار فقط (إيقاف من النظام، انتهاء المقطع…)
          onPlay: () => { setPlaying(true); setMidway(false); },
          onPause: () => { cancelPending(); const el = ref.current; setPlaying(false); setMidway(!!el && el.currentTime > 0 && !el.ended); },
          onEnded: () => { setPlaying(false); setMidway(false); },
        }),
        hBeta(
          "button",
          {
            type: "button",
            "data-design-id": "audio-play",
            className: `m-audio-btn ${playing ? "is-playing" : ""}`,
            onClick: toggle,
            disabled: !soundOn || (spent && !playing && !midway),
            "aria-label": playing ? "إيقاف" : "تشغيل",
          },
          hBeta("span", { "aria-hidden": "true" }, playing ? "⏸" : "▶"),
        ),
        hBeta(
          "div",
          { className: "m-audio-meta" },
          hBeta("b", null, !soundOn ? "الصوت مكتوم — فعّله من زر الصوت" : playing ? "يعمل الآن" : spent ? "انتهت مرات السماع" : "اضغط للاستماع"),
          hBeta(
            "small",
            null,
            revealed
              ? "بعد الكشف يمكنكم إعادة السماع بلا حدّ"
              : spent
                ? "اكشفوا الإجابة لإعادة السماع"
                : `${left === 1 ? "مرة واحدة متبقية" : left === 2 ? "مرتان متبقيتان" : `${left} مرات متبقية`} من ${MAX_AUDIO_PLAYS}`,
          ),
        ),
        hBeta(
          "button",
          {
            type: "button",
            className: "m-secondary m-small",
            "data-design-id": "audio-restart",
            disabled: spent || !soundOn,
            onClick: () => start(true),
          },
          "↻ من البداية",
        ),
      ),
  );
}

// «أربع صور وكلمة»: شبكة 2×2، كل صورة بصندوقها كي لا يعطّل ملفٌ واحد البقية.
export function FourPics({ question, urls, revealed }) {
  return hBeta(
    "div",
    { className: "m-fourpics" },
    urls.map((one, index) =>
      hBeta(MediaBox, { key: one, url: one }, ({ onReady, onError }) =>
        hBeta("img", {
          src: one,
          alt: revealed ? `${question.a} — صورة ${index + 1}` : `صورة ${index + 1}`,
          className: "m-media-img",
          onLoad: onReady,
          onError,
          draggable: false,
        }),
      ),
    ),
  );
}

export function MediaVideo({ url, soundOn = true, volume = .75, sound }) {
  const ref = useRef(null);
  const attach = useQuestionMedia(ref, soundOn, volume, sound);
  return hBeta(
    MediaBox,
    { url, className: "is-video" },
    ({ onReady, onError }) =>
      hBeta("video", {
        ref: attach,
        muted: !soundOn,
        src: url,
        className: "m-media-video",
        controls: true,
        playsInline: true,
        preload: "auto",
        onLoadedData: onReady,
        onError,
      }),
  );
}
