// ثوابت بَديهة المشتركة بين اللعبة ومكوّناتها: وسائل المساعدة، ألوان الفرق، نصوص الأنواع والشرائح.
import { CATS } from "../../data/categories/index.js";

export const TOOLS = [
    { id: "double", label: "دبل النقاط", icon: "✨", hint: "نقاط هذا السؤال ×2 إذا جاوبتوا صح" },
    { id: "two", label: "جوابين", icon: "✌️", hint: "يحق لفريقكم قول إجابتين" },
    { id: "time", label: "وقت زيادة", icon: "⏳", hint: "+30 ثانية على المؤقت" },
  ],
  TEAM_STYLE = [
    {
      solid: "#22d3ee",
      soft: "rgba(34,211,238,0.14)",
      text: "text-cyan-300",
      border: "border-cyan-400",
      name: "الفريق الأزرق",
    },
    {
      solid: "#fb7185",
      soft: "rgba(251,113,133,0.14)",
      text: "text-rose-300",
      border: "border-rose-400",
      name: "الفريق الوردي",
    },
    {
      solid: "#34d399",
      soft: "rgba(52,211,153,0.14)",
      text: "text-emerald-300",
      border: "border-emerald-400",
      name: "الفريق الأخضر",
    },
    {
      solid: "#a78bfa",
      soft: "rgba(167,139,250,0.14)",
      text: "text-violet-300",
      border: "border-violet-400",
      name: "الفريق البنفسجي",
    },
  ],
  TOTAL_Q = CATS.reduce((n, c) => n + c.qs.length, 0),
  // حزم الوسائط تحتاج الشبكة أول مرة، فلا نَعِد اللاعب بما لا نفي به.
  HAS_MEDIA = CATS.some((c) => c.qs.some((q) => q.media)),
  TYPE_PROMPT = {
    zoom: "ما هذا الشيء؟ الصورة مقرّبة جدًا",
    pic: "خمّنوا ما هذا من ظلّه",
    emoji: "ما الذي تعبّر عنه هذه الإيموجي؟",
    order: "رتّبوا العناصر بالترتيب الصحيح",
    closest: "كل فريق يقول رقمًا، والأقرب يأخذ النقاط",
    odd: "أي عنصر هو الدخيل؟ ولماذا؟",
    flag: "علم أي دولة هذا؟",
    sound: "استمعوا وخمّنوا مصدر الصوت",
    grid: "ركّزوا في الصورة قبل انتهاء الوقت",
    image: "ما الذي في الصورة؟",
    audio: "استمعوا إلى المقطع وخمّنوا",
    video: "شاهدوا المقطع وخمّنوا",
    diff: "ما الفرق بين الصورتين؟",
    truefalse: "هل العبارة صحيحة أم خاطئة؟",
    scramble: "رتّبوا الحروف لتكوين الكلمة",
    complete: "أكملوا الناقص",
    common: "ما القاسم المشترك بينها؟",
    hints: "خمّنوا، ولكم أن تطلبوا تلميحًا بثمن",
    choice: "اختاروا الإجابة الصحيحة",
    code: "فكّوا الشفرة",
  },
  // مقطع الصوت يُسمع ثلاث مرات قبل كشف الإجابة، ثم بلا حدّ.
  MAX_AUDIO_PLAYS = 3,
  JUMBLE_TILES = 12,
  answerText = (q) =>
    q.type === "order" ? q.items.map((it, i) => i + 1 + ". " + it).join("  ←  ") : q.a;
export const MAYDAN_TIER_LABELS = Object.freeze({
  200: "سهل",
  400: "متوسط",
  600: "صعب",
  800: "صعب جدًا",
  1e3: "مستحيل",
});
