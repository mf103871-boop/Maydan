// طبقات تأثير عامة ثابتة (opacity/transform فقط)، تُزال بمؤقّت وتُتخطّى تحت تقليل الحركة.
// تعيش في document.body لا في شجرة الشاشة، فلا يعيد تصيير اللعبة تشغيلها ولا تقع تحت أصل محوَّل.
export function prefersReducedMotion() {
  try { return document.documentElement.dataset.reducedMotion === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
function mount(className, ms, fill) {
  if (typeof document === 'undefined' || prefersReducedMotion()) return null;
  const el = document.createElement('div'); el.className = className; el.setAttribute('aria-hidden', 'true');
  if (fill) fill(el);
  document.body.appendChild(el); setTimeout(() => el.remove(), ms); return el;
}
// وميض ملء الشاشة: 'good' | 'bad' | 'white'
export function flashScreen(kind = 'good', ms = 560) { return mount(`fx-flash is-${kind}`, ms); }
// ختم كبير في وسط الشاشة (صح!/خطأ/خطف!) مع نقاط اختيارية تطير للأعلى.
export function stampScreen({ text, tone = 'good', points = '', ms = 650 }) {
  return mount(`fx-stamp is-${tone}`, ms, (el) => { const b = document.createElement('b'); b.textContent = text; el.appendChild(b); if (points) { const s = document.createElement('small'); s.textContent = points; el.appendChild(s); } });
}
let vig = null;
// تظليل أحمر نابض عند آخر ثوانٍ من المؤقت؛ عنصر ثابت واحد يُعاد استعماله ويستريح عند opacity 0.
export function vignette(on) {
  if (typeof document === 'undefined') return;
  if (!vig || !vig.isConnected) { vig = document.createElement('div'); vig.className = 'fx-vignette'; vig.setAttribute('aria-hidden', 'true'); document.body.appendChild(vig); }
  vig.classList.toggle('is-on', !!on && !prefersReducedMotion());
}
// كل مهلة اختيار في المعالجات تمرّ من هنا: صفر تحت تقليل الحركة.
export const wait = (ms) => (prefersReducedMotion() ? 0 : ms);
