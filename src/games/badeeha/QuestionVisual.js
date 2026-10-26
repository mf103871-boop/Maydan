// عرض السؤال بكل أنواعه (نص، صور بمؤثراتها، صوت، فيديو، اختيار، ترتيب، شفرة…). مكوّن مستقل
// تعرضه بَديهة على جهاز واحد وتعيد استعماله بَديهة أونلاين؛ كل ما يتغير يصل خصائص.
import React from "../../design/react.js";
import { questionMedia } from "../../shared/media/resolve.js";
import { arabicNormalize } from "../../shared/lib/arabicNormalize.js";
import { HINT_COST_PERCENT } from "./logic.js";
import { TYPE_PROMPT } from "./constants.js";
import { Flag } from "./Flag.js";
import { MediaBox, MediaImage, MediaAudio, FourPics, MediaVideo } from "./media.js";
const hBeta = React.createElement;
// مقارنة الإجابات بالموحّد نفسه الذي يستعمله bank:validate، فما يقبله المدقّق خيارًا صحيحًا تُبرزه الشاشة حتمًا.
const arabicKey = arabicNormalize;

// revealed: الإجابة معروضة. hintsUsed/onHint: التلميحات المفتوحة وطلب تلميح (يغيب الزر بلا onHint).
// mixedItems: ترتيب عناصر «رتّب» قبل الكشف. onPlaySound: صوت سؤال «sound» المركّب.
export function QuestionVisual({ question, packId = null, revealed = false, hintsUsed = 0, onHint = null, mixedItems = [],
  soundOn = true, volume, sound, onSfx = () => {}, onPlaySound = null }) {
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
        : hBeta(MediaImage, { question, url, effect: question.effect || "none", revealed, onSfx }),
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
  if (question.type === "audio") return hBeta("div", null, ownText, hBeta(MediaAudio, { key: url, url, revealed, soundOn, volume, sound }));
  if (question.type === "video") return hBeta("div", null, ownText, hBeta(MediaVideo, { key: url, url, soundOn, volume, sound }));
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
        onHint &&
        hBeta(
          "button",
          { "data-design-id": "hint",
            type: "button",
            className: "m-secondary m-small",
            onClick: onHint,
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
                onClick: () => onPlaySound?.(question.sound),
                disabled: !soundOn || !onPlaySound,
                "aria-label": "تشغيل صوت السؤال",
              },
              hBeta("span", { "aria-hidden": "true" }, soundOn ? "🔊" : "🔇"),
              hBeta("b", null, soundOn ? "شغّل الصوت" : "الصوت مكتوم"),
            )
          : hBeta("p", { className: "m-question-text" }, question.q);
}
