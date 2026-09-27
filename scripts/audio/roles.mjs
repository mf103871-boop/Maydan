// أدوار المؤثرات ومواضع الموسيقى: حدود القياس التي يفرز بها screen.mjs وافتراضات التحضير التي
// يستعملها prepare.mjs، في ملف واحد كي لا تختلف بين الفرز والتصنيع.
// ── أدوار المؤثرات: مدى المدة، حدّ الهجوم، مدى المركز الطيفي، حصّة الترددات المنخفضة، الطابع ──
export const CUE_SPEC = {
  click: { dur: [0.03, 0.35], attack: 8, centroid: [1200, 6500], lf: 0.10, kind: 'tap', pitched: 'either', title: /click|tap|button|select|switch|toggle|blip|pop|interface|tick/i },
  pop: { dur: [0.05, 0.5], attack: 12, centroid: [800, 5000], lf: 0.12, kind: 'tap', pitched: 'yes', title: /pop|bubble|blip|pluck|button|tap|select|confirm/i },
  tick: { dur: [0.02, 0.14], attack: 5, centroid: [1500, 8000], lf: 0.05, kind: 'tick', pitched: 'no', title: /tick|clock|click|timer|wood|tock/i },
  tickFast: { dur: [0.02, 0.14], attack: 5, centroid: [1800, 9000], lf: 0.05, kind: 'tick', pitched: 'no', title: /tick|clock|click|timer|beep|blip/i },
  countdown: { dur: [0.12, 0.8], attack: 25, centroid: [500, 5000], lf: 0.25, kind: 'feedback', pitched: 'yes', title: /count|beep|tone|blip|tick|bong|ready/i },
  start: { dur: [0.3, 1.8], attack: 30, centroid: [900, 5000], lf: 0.25, kind: 'feedback', pitched: 'yes', contour: 'rising', title: /start|go\b|begin|ready|whistle|level|fanfare|confirm|positive/i },
  correct: { dur: [0.15, 1.6], attack: 30, centroid: [900, 5500], lf: 0.25, kind: 'feedback', pitched: 'yes', contour: 'rising', title: /correct|success|positive|right|achiev|bonus|reward|coin|confirm|win|complete|unlock/i },
  wrong: { dur: [0.15, 1.4], attack: 30, centroid: [250, 1500], lf: 0.3, kind: 'feedback', pitched: 'yes', contour: 'falling', title: /wrong|fail|negative|error|incorrect|lose|denied|drop|down/i },
  buzzer: { dur: [0.2, 1.2], attack: 30, centroid: [250, 1600], lf: 0.35, kind: 'feedback', pitched: 'either', contour: 'falling', title: /buzz|alarm|wrong|error|game show|fail/i },
  timeout: { dur: [0.3, 1.8], attack: 30, centroid: [250, 2000], lf: 0.3, kind: 'feedback', pitched: 'yes', contour: 'falling', title: /time|clock|alarm|bell|over|end|lose|fail|bong/i },
  whoosh: { dur: [0.2, 1.2], attack: 250, centroid: [500, 6500], lf: 0.2, kind: 'whoosh', pitched: 'no', title: /whoosh|swoosh|sweep|swish|swipe|transition|air|open|close|scroll/i },
  reveal: { dur: [0.6, 3.5], attack: 60, centroid: [700, 5000], lf: 0.3, kind: 'hero', pitched: 'yes', contour: 'rising', title: /reveal|magic|sparkle|shimmer|shine|chime|mystery|unlock|discover|fantasy|twinkle|glitter|power/i },
  win: { dur: [0.8, 3.8], attack: 60, centroid: [700, 5000], lf: 0.35, kind: 'hero', pitched: 'yes', contour: 'rising', title: /win|victory|fanfare|trumpet|achiev|triumph|celebrat|complete|success|trophy|level|jingle/i },
  explosion: { dur: [0.4, 3.0], attack: 15, centroid: [100, 2500], lf: 0.75, kind: 'noise', pitched: 'no', title: /explosion|blast|boom|bomb|burst|explode|impact|hit/i },
  drumroll: { dur: [0.8, 3.5], attack: 400, centroid: [300, 5000], lf: 0.4, kind: 'hero', pitched: 'no', title: /drum ?roll|roll|drums?|percussion|tension|suspense/i },
  pass: { dur: [0.05, 0.6], attack: 30, centroid: [600, 6000], lf: 0.15, kind: 'tap', pitched: 'either', title: /skip|pass|swipe|next|slide|flip|page|whoosh|swoosh|pluck|back|drop/i },
};
export const PROVIDER_FIT = { dustyroom: 1, 'mixkit-sfx': 0.9, 'oga-kenney-ui': 0.7, 'kenney-ui': 0.7, 'kenney-interface': 0.7, 'kenney-jingles': 0.6, 'kenney-digital': 0.5, 'kenney-impact': 0.5, incompetech: 0.9, 'in-house': 0.8 };


export const SLOT = { home: { bpm: [60, 96], feel: /calm|relax|bright|groov|bouncy|mystical|uplift/i, avoid: /dark|aggress|intense|horror|somber|sad/i }, calm: { bpm: [50, 84], feel: /calm|relax|peace|gentle|mystical|contempl|somber/i, avoid: /aggress|intense|action|driving|horror|bouncy|humor/i }, tense: { bpm: [88, 130], feel: /driving|action|intense|dark|suspense|epic|groov|mysterious/i, avoid: /calm|relax|peace|humor/i }, finale: { bpm: [60, 140], feel: /bright|epic|uplift|triumph|celebr|bouncy/i, avoid: /dark|horror|sad/i } };
export const PALETTE = /oud|qanun|santur|santoor|ney|darbuka|riq|tar\b|percussion|marimba|kalimba|hang|tongue drum|harp|bells|glock|guitar|lute|flute|strings|cello|choir|piano|vibraphone|steel drum/i;


// افتراضات تحضير الملفات الخارجية حسب طابع الدور: أقصى مدة، تلاشي النهاية، مرشّح عالٍ (Hz).
export const KIND_DEFAULTS = {
  tap: { max: 0.35, fadeOut: 0.015, highpass: 120 },
  tick: { max: 0.14, fadeOut: 0.01, highpass: 150 },
  feedback: { max: 1.6, fadeOut: 0.06, highpass: 80 },
  whoosh: { max: 1.2, fadeOut: 0.08, highpass: 100 },
  hero: { max: 3.5, fadeOut: 0.25, highpass: 40 },
  noise: { max: 3.0, fadeOut: 0.2, highpass: 35 },
};
