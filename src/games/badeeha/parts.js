import React from "../../design/react.js";
const { useState, useEffect, useRef } = React;
const hBeta = React.createElement;

// رقم النقاط: النص الحقيقي في العنصر (تقرؤه السكربتات وقارئ الشاشة)، والعدّ التصاعدي
// من القيمة السابقة على ::before عبر عدّاد CSS ينتقل بـ --score (يقفز فورًا حيث لا @property).
export function ScorePoints({ value, from }) {
  const [shown, setShown] = useState(Number.isFinite(from) ? from : value),
    ref = useRef(null);
  useEffect(() => {
    if (shown === value) return undefined;
    // قراءة قسرية للأسلوب كي يثبّت المتصفح القيمة السابقة قبل التغيير، وإلا قفز العدّ عند أول تركيب
    ref.current && void ref.current.offsetWidth;
    const id = window.requestAnimationFrame(() => setShown(value));
    return () => window.cancelAnimationFrame(id);
  }, [value]);
  return hBeta(
    "b",
    { ref, className: "m-points", dir: "ltr", style: { "--score": shown } },
    hBeta("span", { className: "m-points-text" }, value),
  );
}

// صف «وسائط الفئات المختارة»: مكوّن مستقل، لا دالة داخل الرسم كانت تُعاد تركيبها
// (وتفقد حالتها) مع كل ضغطة في حقل البحث.
export function OfflineMediaRowBeta({ offlineMedia, count, onDownload }) {
  const { state, done, total } = offlineMedia;
  return hBeta(
    "div",
    { className: "m-offline-row" },
    hBeta(
      "div",
      { className: "m-offline-text" },
      hBeta("b", null, "وسائط الفئات المختارة"),
      hBeta(
        "small",
        null,
        state === "busy"
          ? `يُحمَّل ${done} من ${total}…`
          : state === "done"
            ? "جاهزة للّعب دون إنترنت"
            : state === "unsupported"
              ? "التحميل المؤقت اكتمل؛ أعد فتح اللعبة لتفعيل الحفظ دون إنترنت"
            : state === "error"
              ? "تعذّر تحميل بعض الملفات؛ ستُجلب عند فتح السؤال"
              : `${count} ملفًا · حمّلها الآن لتلعبوا دون إنترنت`,
      ),
    ),
    hBeta(
      "button",
      {
        type: "button",
        className: "m-secondary m-small",
        "data-design-id": "download-pack",
        disabled: state === "busy" || state === "done",
        onClick: onDownload,
      },
      state === "busy" ? "…" : state === "done" ? "✓ جاهزة" : "حمّل",
    ),
  );
}
